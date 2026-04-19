// Session management backed by D1.
// Flow:
//  1. GET /api/auth/login → redirect to osu! authorize
//  2. osu! redirects back to /api/auth/callback?code=...&state=...
//  3. Exchange code → store user + tokens in D1 → issue session cookie
//  4. Subsequent requests send cookie → we load session + user from D1

import { redirect, parseCookies, cookie, clearCookie, randomId, sign, verify, now, error } from './utils.js';
import { exchangeCodeForTokens, refreshUserToken, getMe } from './osu.js';

const SESSION_COOKIE = 'ppfarm_sid';
const SESSION_TTL_DAYS = 30;

// ------------------------------------------------------------
// OAuth: begin
// ------------------------------------------------------------
export async function authLogin(request, env) {
  const state = randomId(16);
  const signed = await sign(state, env.SESSION_SECRET);
  const combined = `${state}.${signed}`;

  const authUrl = new URL('https://osu.ppy.sh/oauth/authorize');
  authUrl.searchParams.set('client_id', env.OSU_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', env.OSU_REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'identify public');
  authUrl.searchParams.set('state', combined);

  // Set state as short-lived cookie so we can verify on callback
  return new Response(null, {
    status: 302,
    headers: {
      'location': authUrl.toString(),
      'set-cookie': cookie('ppfarm_oauth_state', combined, { maxAge: 600 }),
    },
  });
}

// ------------------------------------------------------------
// OAuth: callback
// ------------------------------------------------------------
export async function authCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const err = url.searchParams.get('error');

  if (err) return redirect(`/?auth_error=${encodeURIComponent(err)}`);
  if (!code || !returnedState) return redirect('/?auth_error=missing_params');

  // Validate state
  const cookies = parseCookies(request);
  const stored = cookies['ppfarm_oauth_state'];
  if (!stored || stored !== returnedState) return redirect('/?auth_error=state_mismatch');

  const [statePayload, stateSig] = returnedState.split('.');
  if (!statePayload || !stateSig) return redirect('/?auth_error=malformed_state');
  const valid = await verify(statePayload, stateSig, env.SESSION_SECRET);
  if (!valid) return redirect('/?auth_error=bad_signature');

  // Exchange code for tokens
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(env, code);
  } catch (e) {
    console.error(e);
    return redirect('/?auth_error=exchange_failed');
  }

  // Fetch user profile using their token
  let me;
  try {
    me = await getMe(env, tokens.access_token);
  } catch (e) {
    console.error(e);
    return redirect('/?auth_error=profile_failed');
  }

  const tokenExpires = now() + (tokens.expires_in || 86400);

  // Upsert user
  await env.DB.prepare(`
    INSERT INTO users (osu_id, username, country_code, avatar_url, access_token, refresh_token, token_expires, created_at, last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(osu_id) DO UPDATE SET
      username = excluded.username,
      country_code = excluded.country_code,
      avatar_url = excluded.avatar_url,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expires = excluded.token_expires,
      last_login = excluded.last_login
  `).bind(
    me.id, me.username, me.country_code || null, me.avatar_url || null,
    tokens.access_token, tokens.refresh_token || null, tokenExpires,
    now(), now(),
  ).run();

  // Create session
  const sessionId = randomId(32);
  const expiresAt = now() + SESSION_TTL_DAYS * 86400;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(sessionId, me.id, now(), expiresAt).run();

  // Snapshot initial PP so history graphs have a starting point
  await recordPPSnapshot(env, me.id, 'osu', me.statistics);

  const headers = new Headers();
  headers.append('location', '/dashboard');
  headers.append('set-cookie', cookie(SESSION_COOKIE, sessionId, { maxAge: SESSION_TTL_DAYS * 86400 }));
  headers.append('set-cookie', clearCookie('ppfarm_oauth_state'));
  return new Response(null, { status: 302, headers });
}

// ------------------------------------------------------------
// Logout
// ------------------------------------------------------------
export async function authLogout(request, env) {
  const cookies = parseCookies(request);
  const sid = cookies[SESSION_COOKIE];
  if (sid) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  }
  return new Response(null, {
    status: 302,
    headers: { 'location': '/', 'set-cookie': clearCookie(SESSION_COOKIE) },
  });
}

// ------------------------------------------------------------
// Load session (returns {user, token} or null)
// Also auto-refreshes expired user tokens.
// ------------------------------------------------------------
export async function loadSession(request, env) {
  const cookies = parseCookies(request);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;

  const row = await env.DB.prepare(`
    SELECT s.user_id, s.expires_at,
           u.username, u.country_code, u.avatar_url,
           u.access_token, u.refresh_token, u.token_expires
    FROM sessions s
    JOIN users u ON u.osu_id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?
  `).bind(sid, now()).first();

  if (!row) return null;

  let accessToken = row.access_token;
  if (row.token_expires <= now() + 60 && row.refresh_token) {
    try {
      const fresh = await refreshUserToken(env, row.refresh_token);
      accessToken = fresh.access_token;
      await env.DB.prepare(`
        UPDATE users SET access_token = ?, refresh_token = ?, token_expires = ? WHERE osu_id = ?
      `).bind(accessToken, fresh.refresh_token || row.refresh_token, now() + (fresh.expires_in || 86400), row.user_id).run();
    } catch (e) {
      console.error('Token refresh failed:', e);
      // fall through — their access_token might still work briefly
    }
  }

  return {
    user: {
      id: row.user_id,
      username: row.username,
      country_code: row.country_code,
      avatar_url: row.avatar_url,
    },
    token: accessToken,
  };
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
export async function recordPPSnapshot(env, userId, mode, stats) {
  if (!stats) return;
  try {
    await env.DB.prepare(`
      INSERT INTO pp_snapshots (user_id, mode, pp, global_rank, country_rank, accuracy, playcount, snapshot_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      userId, mode,
      stats.pp || 0,
      stats.global_rank || null,
      stats.country_rank || null,
      stats.hit_accuracy || null,
      stats.play_count || null,
      now(),
    ).run();
  } catch (e) {
    console.error('PP snapshot failed:', e);
  }
}

export async function requireAuth(request, env) {
  const session = await loadSession(request, env);
  if (!session) throw new AuthError('Not authenticated', 401);
  return session;
}

export class AuthError extends Error {
  constructor(msg, status = 401) { super(msg); this.status = status; }
}

export async function meHandler(request, env) {
  const session = await loadSession(request, env);
  if (!session) return new Response(JSON.stringify({ user: null }), {
    headers: { 'content-type': 'application/json' },
  });
  return new Response(JSON.stringify({ user: session.user }), {
    headers: { 'content-type': 'application/json' },
  });
}
