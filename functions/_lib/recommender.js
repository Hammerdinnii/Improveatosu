// Skill analysis and recommendation engine.
// Takes a user's top 100 plays, derives a weighted skill profile,
// then searches osu!'s beatmap library for maps that fit the profile
// according to one of 4 strategies.

import { searchBeatmapsets } from './osu.js';

// ------------------------------------------------------------
// Analysis: compute PP-weighted skill profile from top plays
// ------------------------------------------------------------
export function analyzeSkill(scores, user) {
  const rated = scores.filter(s => s.pp && s.beatmap);
  if (!rated.length) {
    return null;
  }

  const pps = rated.map(s => s.pp);
  const totalPP = pps.reduce((a, b) => a + b, 0);
  const w = i => pps[i] / totalPP; // normalized weight

  const weighted = (fn) => rated.reduce((acc, s, i) => acc + fn(s) * w(i), 0);

  const weightedStars = weighted(s => s.beatmap.difficulty_rating);
  const weightedBPM = weighted(s => s.beatmap.bpm);
  const weightedLength = weighted(s => s.beatmap.total_length);
  const weightedAcc = weighted(s => s.accuracy * 100);

  // percentiles of star ratings
  const stars = rated.map(s => s.beatmap.difficulty_rating).sort((a, b) => a - b);
  const pct = (p) => {
    const i = (stars.length - 1) * p;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return stars[lo] + (stars[hi] - stars[lo]) * (i - lo);
  };

  // Deep mod analysis: per-mod performance metrics
  const modStats = {};
  rated.forEach(s => {
    // Normalize mod key — ignore meaningless mods like NF/SO/SD that don't affect pp
    const meaningful = (s.mods || []).filter(m => !['NF', 'SO', 'SD', 'PF'].includes(m));
    const key = meaningful.length ? [...meaningful].sort().join('') : 'NM';
    if (!modStats[key]) {
      modStats[key] = { count: 0, totalPP: 0, totalAcc: 0, topPP: 0, plays: [] };
    }
    modStats[key].count++;
    modStats[key].totalPP += s.pp;
    modStats[key].totalAcc += s.accuracy * 100;
    modStats[key].topPP = Math.max(modStats[key].topPP, s.pp);
    modStats[key].plays.push({ pp: s.pp, acc: s.accuracy * 100 });
  });

  // Compute averages and rank by effectiveness (weighted pp contribution)
  const modAnalysis = Object.entries(modStats).map(([mod, s]) => ({
    mod,
    count: s.count,
    percentage: (s.count / rated.length) * 100,
    avgPP: s.totalPP / s.count,
    avgAcc: s.totalAcc / s.count,
    topPP: s.topPP,
    // "effectiveness" = avg pp per play — the real measure of which mod gets you pp
    effectiveness: s.totalPP / s.count,
  }));

  // Sort by effectiveness (avg pp per play), not count
  modAnalysis.sort((a, b) => b.effectiveness - a.effectiveness);

  // Compare each mod to NM baseline for pp-gain insights
  const nmStats = modAnalysis.find(m => m.mod === 'NM');
  modAnalysis.forEach(m => {
    if (nmStats && m.mod !== 'NM' && nmStats.avgPP > 0) {
      m.ppDeltaVsNM = ((m.avgPP - nmStats.avgPP) / nmStats.avgPP) * 100;
      m.accDeltaVsNM = m.avgAcc - nmStats.avgAcc;
    } else {
      m.ppDeltaVsNM = null;
      m.accDeltaVsNM = null;
    }
  });

  // Keep legacy `topMods` for anything else that might use it
  const topMods = modAnalysis
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(m => [m.mod, m.count]);

  const ownedBeatmaps = new Set(rated.map(s => s.beatmap.id));

  return {
    topPP: pps[0],
    avgTop10: pps.slice(0, 10).reduce((a, b) => a + b, 0) / Math.min(10, pps.length),
    avgAll: totalPP / pps.length,
    totalPP,
    weightedStars,
    weightedBPM,
    weightedLength,
    weightedAcc,
    starRange: {
      p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p90: pct(0.9),
    },
    topMods,
    modAnalysis,
    ownedBeatmaps,
    user,
  };
}

// ------------------------------------------------------------
// Strategy parameters
// ------------------------------------------------------------
const STRATEGIES = {
  push: {
    label: 'Push PP',
    description: 'Maps slightly above your current top plays — best realistic PP upside.',
    stars: (s) => ({ min: s.p75, max: s.p90 + 0.4 }),
    length: { min: 90, max: 300 },
    accTarget: 96,
  },
  farm: {
    label: 'Farm',
    description: 'Shorter, easier maps where consistent high accuracy nets easy PP.',
    stars: (s) => ({ min: Math.max(2, s.p50 - 0.5), max: s.p75 }),
    length: { min: 60, max: 180 },
    accTarget: 95,
  },
  comfort: {
    label: 'Comfort zone',
    description: 'Comfortably within your range — good for SS attempts and accuracy runs.',
    stars: (s) => ({ min: s.p25, max: s.p50 }),
    length: { min: 60, max: 300 },
    accTarget: 97,
  },
  stretch: {
    label: 'Reach plays',
    description: 'Significantly harder than your current top. High ceiling, high failure.',
    stars: (s) => ({ min: s.p90, max: s.p90 + 1.0 }),
    length: { min: 60, max: 300 },
    accTarget: 94,
  },
};

export function strategyInfo() {
  return Object.entries(STRATEGIES).map(([key, v]) => ({
    key, label: v.label, description: v.description,
  }));
}

// ------------------------------------------------------------
// Mod multipliers for pp estimation and star-rating scaling.
// These are heuristic approximations, not real osu! algorithms.
// ------------------------------------------------------------
const MOD_MULTIPLIERS = {
  // How much each mod scales effective star rating.
  // Used to "reverse-search" maps at a lower base SR when looking for HDDT candidates.
  starScale: {
    DT: 1.40, NC: 1.40,
    HT: 0.70,
    HR: 1.06,
    HD: 1.00, // HD doesn't change SR
    EZ: 0.50,
    FL: 1.12,
  },
  // Flat pp multiplier on top of whatever the SR-based pp calculation gives
  ppMultiplier: {
    DT: 1.00, NC: 1.00, // DT's pp gain comes through the SR scale
    HT: 0.30,
    HR: 1.06,
    HD: 1.06,
    EZ: 0.50,
    FL: 1.12,
  },
};

// Parse a mod string like "DTHD" into individual mods
function parseMods(modString) {
  if (!modString || modString === 'NM') return [];
  const mods = [];
  for (let i = 0; i < modString.length; i += 2) {
    mods.push(modString.slice(i, i + 2));
  }
  return mods;
}

// Compute combined star-rating scale and pp multiplier for a mod combo
function getModEffect(modString) {
  const mods = parseMods(modString);
  let starScale = 1.0;
  let ppMult = 1.0;
  mods.forEach(m => {
    starScale *= (MOD_MULTIPLIERS.starScale[m] ?? 1.0);
    ppMult *= (MOD_MULTIPLIERS.ppMultiplier[m] ?? 1.0);
  });
  return { starScale, ppMult };
}

// ------------------------------------------------------------
// Recommendation generation — produces 3 buckets (top mod / 2nd mod / NoMod)
// Now with per-user history awareness and per-request randomization for variety.
//
// Options:
//   userId  — if provided, fetch recent recommendation history and apply recency penalty
//   seed    — seeds the random jitter; pass a fresh value (e.g. Date.now()) per request
//             to get different ordering each time. Same seed = same result (useful for tests).
// ------------------------------------------------------------
export async function generateRecommendations(env, analysis, mode, strategyKey, options = {}) {
  const strat = STRATEGIES[strategyKey] || STRATEGIES.push;
  const modeIdx = { osu: 0, taiko: 1, fruits: 2, mania: 3 }[mode];
  const seed = options.seed ?? Date.now();
  const userId = options.userId ?? null;

  // Fetch recent recommendation history for this user (last 3 days)
  // Maps shown more recently and more often get higher penalties.
  let recentHistory = new Map(); // beatmap_id -> shown_count
  if (userId && env.DB) {
    try {
      const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86400;
      const result = await env.DB.prepare(`
        SELECT beatmap_id, shown_count
        FROM user_recommendation_log
        WHERE user_id = ? AND mode = ? AND last_shown > ?
      `).bind(userId, mode, threeDaysAgo).all();
      for (const row of (result.results || [])) {
        recentHistory.set(row.beatmap_id, row.shown_count);
      }
    } catch (e) {
      console.warn('Failed to load user rec history:', e.message);
    }
  }

  // Pick the user's top 2 non-NM mods by effectiveness (avg pp).
  // Fall back gracefully if the user doesn't have much mod variety.
  const rankedMods = (analysis.modAnalysis || [])
    .slice()
    .sort((a, b) => b.avgPP - a.avgPP)
    .filter(m => m.count >= 2); // ignore mods they've only used once

  const nonNmMods = rankedMods.filter(m => m.mod !== 'NM').slice(0, 2);
  const hasNmBucket = (analysis.modAnalysis || []).some(m => m.mod === 'NM' && m.count >= 2);

  // Build bucket definitions. Each bucket runs an independent search.
  const buckets = [];
  nonNmMods.forEach(m => {
    buckets.push({
      modKey: m.mod,
      label: m.mod,
      mod: m,
    });
  });
  if (hasNmBucket || buckets.length === 0) {
    buckets.push({ modKey: 'NM', label: 'NoMod', mod: rankedMods.find(x => x.mod === 'NM') });
  }

  // Run searches in parallel for speed
  const bucketResults = await Promise.all(
    buckets.map((b, idx) => generateForMod(
      env, analysis, strat, mode, modeIdx, b.modKey,
      recentHistory, seed + idx * 1009 // different seed per bucket
    ))
  );

  // Attach metadata
  return buckets.map((b, i) => ({
    mod: b.modKey,
    label: b.modKey === 'NM' ? 'NoMod' : b.modKey,
    stats: b.mod ? {
      percentage: b.mod.percentage,
      avgPP: b.mod.avgPP,
      avgAcc: b.mod.avgAcc,
      ppDeltaVsNM: b.mod.ppDeltaVsNM,
    } : null,
    recommendations: bucketResults[i],
  }));
}

async function generateForMod(env, analysis, strat, mode, modeIdx, modKey, recentHistory = new Map(), seed = Date.now()) {
  const { starScale, ppMult } = getModEffect(modKey);

  // For NoMod, search at user's normal star range.
  // For a mod that scales SR up (like DT), search for maps with LOWER base SR,
  // because the mod will push them up to where the player belongs.
  const baseRange = strat.stars(analysis.starRange);
  const starMin = baseRange.min / starScale;
  const starMax = baseRange.max / starScale;

  const bpmLow = Math.max(60, Math.round(analysis.weightedBPM - 30));
  const bpmHigh = Math.round(analysis.weightedBPM + 30);

  const hasDT = modKey.includes('DT') || modKey.includes('NC');
  const hasHT = modKey.includes('HT');
  const bpmDivisor = hasDT ? 1.5 : hasHT ? 0.75 : 1.0;
  const searchBpmLow = Math.max(60, Math.round(bpmLow / bpmDivisor));
  const searchBpmHigh = Math.round(bpmHigh / bpmDivisor);

  // Pull a wider candidate pool than before so the variety selector has options to play with
  const queries = [
    `stars>${starMin.toFixed(2)} stars<${starMax.toFixed(2)} bpm>${searchBpmLow} bpm<${searchBpmHigh}`,
    `stars>${starMin.toFixed(2)} stars<${starMax.toFixed(2)}`,
  ];

  const seen = new Set();
  const candidates = [];

  for (const q of queries) {
    try {
      const result = await searchBeatmapsets(env, q, modeIdx);
      const sets = result.beatmapsets || [];
      for (const set of sets) {
        for (const bm of (set.beatmaps || [])) {
          if (bm.mode_int !== modeIdx) continue;
          if (analysis.ownedBeatmaps.has(bm.id)) continue;
          if (seen.has(bm.id)) continue;
          if (bm.difficulty_rating < starMin || bm.difficulty_rating > starMax) continue;
          if (bm.total_length < strat.length.min || bm.total_length > strat.length.max) continue;
          seen.add(bm.id);
          candidates.push({ ...bm, beatmapset: set });
        }
      }
    } catch (e) {
      console.warn('Search query failed:', q, e.message);
    }
    // Aim for ~50 candidates so variety logic has room to work
    if (candidates.length >= 50) break;
  }

  if (candidates.length === 0) return [];

  // Score each candidate using mod-aware pp estimation
  const effectiveBpmTarget = analysis.weightedBPM / bpmDivisor;
  const scored = candidates.map(bm => {
    const effectiveStars = bm.difficulty_rating * starScale;
    const basePP = estimatePP(effectiveStars, strat.accTarget, bm.total_length, mode);
    const estPP = basePP * ppMult;

    const bpmDist = Math.abs(bm.bpm - effectiveBpmTarget);
    const bpmPenalty = bpmDist / 100;
    const popBoost = Math.log10((bm.playcount || 1) + 10) / 10;
    const baseScore = estPP - bpmPenalty * 5 + popBoost * 20;

    return {
      ...bm,
      estPP,
      effectiveStars,
      baseScore,
      appliedMod: modKey,
    };
  });

  // First sort by base score to identify the "elite" tier
  // (top 20% of pp upside — these maps stay reachable even with variety)
  scored.sort((a, b) => b.baseScore - a.baseScore);
  const eliteCutoff = Math.max(5, Math.floor(scored.length * 0.2));
  scored.forEach((c, i) => { c.isElite = i < eliteCutoff; });

  // Apply variety transformations:
  // 1. Recency penalty — maps shown recently to this user get demoted
  // 2. Random jitter (seeded) — breaks ties and creates per-request variation
  scored.forEach((c, i) => {
    let finalScore = c.baseScore;

    // Recency penalty: each prior showing reduces score by 8% of base score, capped at 50%
    const recentlyShown = recentHistory.get(c.id) || 0;
    if (recentlyShown > 0) {
      const penaltyFactor = Math.min(0.5, recentlyShown * 0.08);
      // Elite picks are protected — they can drop in rank but never get fully buried
      const adjustedPenalty = c.isElite ? penaltyFactor * 0.4 : penaltyFactor;
      finalScore *= (1 - adjustedPenalty);
    }

    // Seeded random jitter: ±20% on score (or ±10% for elite picks)
    const rng = mulberry32(seed + c.id);
    const jitterRange = c.isElite ? 0.10 : 0.20;
    const jitter = (rng() * 2 - 1) * jitterRange;
    finalScore *= (1 + jitter);

    c.finalScore = finalScore;
  });

  // Sort by final score and take top 15
  scored.sort((a, b) => b.finalScore - a.finalScore);
  return scored.slice(0, 15);
}

// Seeded random number generator (mulberry32) — gives reproducible randomness per seed
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Heuristic PP estimate for ranking candidates only (NOT real osu! PP)
function estimatePP(stars, accPct, lengthSec, mode) {
  const accFactor = Math.pow(accPct / 100, 24);
  const exponent = mode === 'mania' ? 2.1 : mode === 'taiko' ? 2.25 : 2.4;
  const base = Math.pow(stars, exponent) * 8;
  const lengthFactor = Math.min(1.3, 1 + (lengthSec - 120) / 600);
  return base * accFactor * lengthFactor;
}
