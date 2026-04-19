// Catch-all for /api/* requests in Cloudflare Pages Functions.
// File path determines the route: functions/api/[[path]].js matches /api/anything
// `context.env` has KV/D1 bindings + secrets, `context.request` is the request.

import { json, error, now } from '../_lib/utils.js';
import {
  authLogin, authCallback, authLogout, meHandler,
  loadSession, requireAuth, recordPPSnapshot, AuthError,
} from '../_lib/auth.js';
import { getUser, getUserById, getTopScores } from '../_lib/osu.js';
import { analyzeSkill, generateRecommendations, strategyInfo } from '../_lib/recommender.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    return await route(request, env, context, url);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    console.error('API error:', e);
    return error(e.message || 'Internal error', 500);
  }
}

async function route(request, env, context, url) {
  const path = url.pathname;
  const method = request.method;

  // --- Auth ---
  if (path === '/api/auth/login' && method === 'GET') return authLogin(request, env);
  if (path === '/api/auth/callback' && method === 'GET') return authCallback(request, env);
  if (path === '/api/auth/logout' && method === 'POST') return authLogout(request, env);
  if (path === '/api/auth/me' && method === 'GET') return meHandler(request, env);

  // --- Strategies metadata ---
  if (path === '/api/strategies' && method === 'GET') {
    return json({ strategies: strategyInfo() });
  }

  // --- Public profile analysis ---
  if (path === '/api/analyze' && method === 'GET') {
    const username = (url.searchParams.get('user') || '').trim();
    const mode = url.searchParams.get('mode') || 'osu';
    if (!username) return error('Missing "user" param');
    if (!['osu', 'taiko', 'fruits', 'mania'].includes(mode)) return error('Invalid mode');

    const user = await getUser(env, username, mode);
    const scores = await getTopScores(env, user.id, mode, 100);
    const analysis = analyzeSkill(scores, user);
    if (!analysis) return json({ user, analysis: null, note: 'No ranked plays in this mode.' });

    return json({ user: publicUserSummary(user), analysis: publicAnalysis(analysis) });
  }

  // --- Public recommendations ---
  if (path === '/api/recommend/public' && method === 'GET') {
    const username = (url.searchParams.get('user') || '').trim();
    const mode = url.searchParams.get('mode') || 'osu';
    const strategy = url.searchParams.get('strategy') || 'push';
    if (!username) return error('Missing "user" param');

    const user = await getUser(env, username, mode);
    const scores = await getTopScores(env, user.id, mode, 100);
    const analysis = analyzeSkill(scores, user);
    if (!analysis) return json({ recommendations: [] });

    const recs = await generateRecommendations(env, analysis, mode, strategy);
    context.waitUntil(logRecommendations(env, recs, mode, strategy));
    return json({ user: publicUserSummary(user), recommendations: publicRecs(recs) });
  }

  // --- Personalized recommendations (authed) ---
  if (path === '/api/recommend' && method === 'GET') {
    const session = await requireAuth(request, env);
    const mode = url.searchParams.get('mode') || 'osu';
    const strategy = url.searchParams.get('strategy') || 'push';

    const user = await getUserById(env, session.user.id, mode);
    const scores = await getTopScores(env, user.id, mode, 100);
    const analysis = analyzeSkill(scores, user);
    if (!analysis) return json({ recommendations: [] });

    context.waitUntil(recordPPSnapshot(env, user.id, mode, user.statistics));

    const recs = await generateRecommendations(env, analysis, mode, strategy);
    context.waitUntil(logRecommendations(env, recs, mode, strategy));

    return json({
      user: publicUserSummary(user),
      analysis: publicAnalysis(analysis),
      recommendations: publicRecs(recs),
    });
  }

  // --- PP History ---
  if (path === '/api/history' && method === 'GET') {
    const session = await requireAuth(request, env);
    const mode = url.searchParams.get('mode') || 'osu';
    const rows = await env.DB.prepare(`
      SELECT pp, global_rank, country_rank, accuracy, playcount, snapshot_at
      FROM pp_snapshots
      WHERE user_id = ? AND mode = ?
      ORDER BY snapshot_at ASC
      LIMIT 365
    `).bind(session.user.id, mode).all();
    return json({ history: rows.results || [] });
  }

  // --- Favorites ---
  if (path === '/api/favorites' && method === 'GET') {
    const session = await requireAuth(request, env);
    const rows = await env.DB.prepare(`
      SELECT * FROM favorites WHERE user_id = ? ORDER BY saved_at DESC
    `).bind(session.user.id).all();
    return json({ favorites: rows.results || [] });
  }

  if (path === '/api/favorites' && method === 'POST') {
    const session = await requireAuth(request, env);
    const body = await request.json().catch(() => ({}));
    const { beatmap_id, beatmapset_id, title, artist, version, stars, mode } = body;
    if (!beatmap_id || !title) return error('Missing fields');
    await env.DB.prepare(`
      INSERT OR IGNORE INTO favorites (user_id, beatmap_id, beatmapset_id, title, artist, version, stars, mode, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(session.user.id, beatmap_id, beatmapset_id, title, artist || '', version || '', stars || 0, mode || 'osu', now()).run();
    return json({ ok: true });
  }

  const favMatch = path.match(/^\/api\/favorites\/(\d+)$/);
  if (favMatch && method === 'DELETE') {
    const session = await requireAuth(request, env);
    const beatmapId = parseInt(favMatch[1], 10);
    await env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND beatmap_id = ?')
      .bind(session.user.id, beatmapId).run();
    return json({ ok: true });
  }

  // --- Trending ---
  if (path === '/api/trending' && method === 'GET') {
    const mode = url.searchParams.get('mode') || 'osu';
    const strategy = url.searchParams.get('strategy') || 'push';

    const rows = await env.DB.prepare(`
      SELECT r.beatmap_id, r.count,
             b.beatmapset_id, b.title, b.artist, b.creator, b.version,
             b.stars, b.bpm, b.length, b.cover_url, b.playcount
      FROM recommendation_counts r
      LEFT JOIN beatmap_cache b ON b.beatmap_id = r.beatmap_id
      WHERE r.mode = ? AND r.strategy = ?
      ORDER BY r.count DESC
      LIMIT 20
    `).bind(mode, strategy).all();

    return json({ trending: rows.results || [] });
  }

  return error('Not found', 404);
}

// ---------- helpers ----------
async function logRecommendations(env, recs, mode, strategy) {
  if (!recs || !recs.length) return;
  const ts = now();
  const batch = [];

  for (const bm of recs.slice(0, 10)) {
    batch.push(env.DB.prepare(`
      INSERT INTO recommendation_counts (beatmap_id, mode, strategy, count, last_updated)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(beatmap_id, mode, strategy) DO UPDATE SET
        count = count + 1, last_updated = excluded.last_updated
    `).bind(bm.id, mode, strategy, ts));

    const set = bm.beatmapset || {};
    batch.push(env.DB.prepare(`
      INSERT INTO beatmap_cache (beatmap_id, beatmapset_id, title, artist, creator, version, stars, bpm, length, mode, cover_url, playcount, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(beatmap_id) DO UPDATE SET
        stars = excluded.stars, playcount = excluded.playcount, cached_at = excluded.cached_at
    `).bind(
      bm.id, set.id || bm.beatmapset_id, set.title || '', set.artist || '',
      set.creator || '', bm.version || '', bm.difficulty_rating || 0,
      bm.bpm || 0, bm.total_length || 0, mode,
      set.covers?.['card@2x'] || set.covers?.card || '',
      bm.playcount || 0, ts,
    ));
  }

  try { await env.DB.batch(batch); }
  catch (e) { console.error('logRecommendations batch failed:', e); }
}

function publicUserSummary(u) {
  const s = u.statistics || {};
  const ranks = s.grade_counts || {};
  return {
    id: u.id,
    username: u.username,
    country: u.country,
    country_code: u.country_code,
    avatar_url: u.avatar_url,
    statistics: {
      pp: s.pp,
      global_rank: s.global_rank,
      country_rank: s.country_rank,
      hit_accuracy: s.hit_accuracy,
      play_count: s.play_count,
      play_time: s.play_time,
      total_score: s.total_score,
      ranked_score: s.ranked_score,
      maximum_combo: s.maximum_combo,
      level: s.level,
      grade_counts: ranks,
    },
  };
}

function publicAnalysis(a) {
  return {
    topPP: a.topPP,
    avgTop10: a.avgTop10,
    avgAll: a.avgAll,
    totalPP: a.totalPP,
    weightedStars: a.weightedStars,
    weightedBPM: a.weightedBPM,
    weightedLength: a.weightedLength,
    weightedAcc: a.weightedAcc,
    starRange: a.starRange,
    topMods: a.topMods,
  };
}

function publicRecs(recs) {
  return recs.map(bm => {
    const set = bm.beatmapset || {};
    return {
      id: bm.id,
      beatmapset_id: set.id || bm.beatmapset_id,
      title: set.title,
      artist: set.artist,
      creator: set.creator,
      version: bm.version,
      stars: bm.difficulty_rating,
      bpm: bm.bpm,
      length: bm.total_length,
      mode: bm.mode,
      playcount: bm.playcount,
      cover_url: set.covers?.['card@2x'] || set.covers?.card,
      url: `https://osu.ppy.sh/beatmapsets/${set.id || bm.beatmapset_id}#${bm.mode || 'osu'}/${bm.id}`,
      estPP: bm.estPP,
    };
  });
}
