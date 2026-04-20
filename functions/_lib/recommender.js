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
// Recommendation generation
// ------------------------------------------------------------
export async function generateRecommendations(env, analysis, mode, strategyKey) {
  const strat = STRATEGIES[strategyKey] || STRATEGIES.push;
  const { min: starMin, max: starMax } = strat.stars(analysis.starRange);

  const bpmLow = Math.max(60, Math.round(analysis.weightedBPM - 30));
  const bpmHigh = Math.round(analysis.weightedBPM + 30);

  const modeIdx = { osu: 0, taiko: 1, fruits: 2, mania: 3 }[mode];

  // Try targeted query first (stars + bpm), fall back to broader query
  const queries = [
    `stars>${starMin.toFixed(2)} stars<${starMax.toFixed(2)} bpm>${bpmLow} bpm<${bpmHigh}`,
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
    if (candidates.length >= 60) break;
  }

  // Score each candidate
  const scored = candidates.map(bm => {
    const estPP = estimatePP(bm.difficulty_rating, strat.accTarget, bm.total_length, mode);
    const bpmDist = Math.abs(bm.bpm - analysis.weightedBPM);
    const bpmPenalty = bpmDist / 100;
    const popBoost = Math.log10((bm.playcount || 1) + 10) / 10;
    const score = estPP - bpmPenalty * 5 + popBoost * 20;
    return { ...bm, estPP, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 25);
}

// Heuristic PP estimate for ranking candidates only (NOT real osu! PP)
function estimatePP(stars, accPct, lengthSec, mode) {
  const accFactor = Math.pow(accPct / 100, 24);
  const exponent = mode === 'mania' ? 2.1 : mode === 'taiko' ? 2.25 : 2.4;
  const base = Math.pow(stars, exponent) * 8;
  const lengthFactor = Math.min(1.3, 1 + (lengthSec - 120) / 600);
  return base * accFactor * lengthFactor;
}
