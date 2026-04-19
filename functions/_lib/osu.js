// osu! API v2 client with KV caching and automatic app-token management.
// Two auth paths:
//   1. Client-credentials (app token) — used for public data lookups
//   2. Authorization-code (user token) — used for logged-in user's private data

import { now } from './utils.js';

const TOKEN_URL = 'https://osu.ppy.sh/oauth/token';
const API_BASE = 'https://osu.ppy.sh/api/v2';

// ------------------------------------------------------------
// App (client-credentials) token — cached in KV for the whole Worker.
// osu! app tokens last 24h; we refresh 5min before expiry.
// ------------------------------------------------------------
const APP_TOKEN_KEY = 'osu:app_token';

export async function getAppToken(env) {
  const cached = await env.CACHE.get(APP_TOKEN_KEY, { type: 'json' });
  if (cached && cached.expires > now() + 300) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      client_id: env.OSU_CLIENT_ID,
      client_secret: env.OSU_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'public',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`osu! app auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const record = { token: data.access_token, expires: now() + data.expires_in };

  // Cache just shy of actual TTL
  await env.CACHE.put(APP_TOKEN_KEY, JSON.stringify(record), {
    expirationTtl: Math.max(300, data.expires_in - 300),
  });
  return record.token;
}

// ------------------------------------------------------------
// User OAuth flow: exchange code for tokens, refresh when needed.
// ------------------------------------------------------------
export async function exchangeCodeForTokens(env, code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      client_id: env.OSU_CLIENT_ID,
      client_secret: env.OSU_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: env.OSU_REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OAuth code exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function refreshUserToken(env, refresh_token) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.OSU_CLIENT_ID,
      client_secret: env.OSU_CLIENT_SECRET,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
  return res.json();
}

// ------------------------------------------------------------
// Generic API helper with KV caching
// ------------------------------------------------------------
export async function apiGet(env, path, { token, cacheTtl = 0, cacheKey = null } = {}) {
  // Cache first
  if (cacheTtl && cacheKey) {
    const hit = await env.CACHE.get(cacheKey, { type: 'json' });
    if (hit) return hit;
  }

  const bearer = token || await getAppToken(env);
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${bearer}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`osu! API ${res.status}: ${text || path}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();

  if (cacheTtl && cacheKey) {
    await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: cacheTtl });
  }
  return data;
}

// ------------------------------------------------------------
// Specific endpoints used by the app
// ------------------------------------------------------------
export async function getUser(env, username, mode = 'osu') {
  const key = `osu:user:${username.toLowerCase()}:${mode}`;
  return apiGet(env, `/users/${encodeURIComponent(username)}/${mode}?key=username`, {
    cacheTtl: 600,
    cacheKey: key,
  });
}

export async function getUserById(env, id, mode = 'osu') {
  const key = `osu:userid:${id}:${mode}`;
  return apiGet(env, `/users/${id}/${mode}`, { cacheTtl: 600, cacheKey: key });
}

export async function getTopScores(env, userId, mode = 'osu', limit = 100) {
  const key = `osu:top:${userId}:${mode}:${limit}`;
  return apiGet(env, `/users/${userId}/scores/best?mode=${mode}&limit=${limit}`, {
    cacheTtl: 600,
    cacheKey: key,
  });
}

export async function searchBeatmapsets(env, query, modeIdx) {
  const key = `osu:search:${modeIdx}:${query}`;
  const data = await apiGet(env, `/beatmapsets/search?q=${encodeURIComponent(query)}&m=${modeIdx}&s=ranked&sort=plays_desc`, {
    cacheTtl: 3600,
    cacheKey: key,
  });
  return data;
}

// Current authenticated user (requires user token, "identify" scope)
export async function getMe(env, userToken) {
  return apiGet(env, '/me', { token: userToken });
}
