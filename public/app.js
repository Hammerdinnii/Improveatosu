// pp.farm SPA frontend
// Simple hash-free client-side router with 5 views:
//   /             home / landing / public lookup
//   /dashboard    authed personal dashboard + recommendations
//   /history      authed PP history chart
//   /favorites    authed saved maps
//   /trending     public "most recommended" leaderboard

const app = document.getElementById('app');
const navLinks = document.getElementById('navLinks');
const navUser = document.getElementById('navUser');

let currentUser = null; // null = not logged in
let modeCache = 'osu';

// ---------------- bootstrapping ----------------
(async function init() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    currentUser = data.user;
  } catch (e) { console.error(e); }

  renderNav();
  window.addEventListener('popstate', () => route());
  document.body.addEventListener('click', interceptLinks);
  route();
})();

function interceptLinks(e) {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#') || a.target === '_blank') return;
  // Only intercept our own routes
  if (['/', '/dashboard', '/history', '/favorites', '/trending'].includes(href)) {
    e.preventDefault();
    navigate(href);
  }
}

function navigate(path) {
  history.pushState({}, '', path);
  route();
}

function renderNav() {
  // highlight active link
  const path = location.pathname;
  navLinks.querySelectorAll('a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === path);
  });

  if (currentUser) {
    navUser.innerHTML = `
      <img src="${currentUser.avatar_url || ''}" alt="" onerror="this.style.display='none'"/>
      <span class="u-name">${escapeHtml(currentUser.username)}</span>
      <button class="u-logout" id="logoutBtn">Logout</button>
    `;
    document.getElementById('logoutBtn').addEventListener('click', logout);
  } else {
    navUser.innerHTML = `<a class="btn" href="/api/auth/login">Login with osu!</a>`;
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  renderNav();
  navigate('/');
}

function route() {
  renderNav();
  const path = location.pathname;
  if (path === '/' || path === '/home') return renderHome();
  if (path === '/dashboard') return renderDashboard();
  if (path === '/history') return renderHistory();
  if (path === '/favorites') return renderFavorites();
  if (path === '/trending') return renderTrending();
  return renderHome();
}

// ---------------- helpers ----------------
function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function numFmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }
function shortNum(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return n.toString();
}
function hoursFmt(sec) { return sec ? Math.round(sec/3600).toLocaleString() + 'h' : '—'; }
function fmtLen(sec) {
  if (!sec) return '?';
  return Math.floor(sec/60) + ':' + String(sec%60).padStart(2, '0');
}

function loader() { return `<div class="loader-screen"><div class="spinner big"></div></div>`; }

function setStatus(msg, kind = 'loading', containerId = 'statusArea') {
  const c = document.getElementById(containerId);
  if (!c) return;
  const icon = kind === 'loading' ? '<span class="spinner"></span>' : kind === 'error' ? '✕' : 'ℹ';
  c.innerHTML = `<div class="status ${kind}">${icon} ${msg}</div>`;
}

function clearStatus(id = 'statusArea') {
  const c = document.getElementById(id);
  if (c) c.innerHTML = '';
}

function modeSelector(mode) {
  return `
    <select id="modeSelect">
      <option value="osu" ${mode==='osu'?'selected':''}>osu! (standard)</option>
      <option value="taiko" ${mode==='taiko'?'selected':''}>taiko</option>
      <option value="fruits" ${mode==='fruits'?'selected':''}>catch</option>
      <option value="mania" ${mode==='mania'?'selected':''}>mania</option>
    </select>
  `;
}

// ---------------- HOME ----------------
function renderHome() {
  const authError = new URLSearchParams(location.search).get('auth_error');
  const errMsg = authError ? `<div class="status error">✕ Login failed: ${escapeHtml(authError)}</div>` : '';

  app.innerHTML = `
    <section class="hero slide-in">
      <h1>Improve osu scores<br/><span class="accent">smarter</span>.</h1>
      <p>Pull your osu! top plays, analyze your skill profile, and get a curated list of maps scoped to your level — picked to push your PP without wasting retries on stuff too hard or too easy.</p>
      <div class="hero-actions">
        ${currentUser
          ? `<a class="btn" href="/dashboard">Go to dashboard →</a>`
          : `<a class="btn" href="/api/auth/login">🔐 Login with osu!</a>`}
        <a class="btn secondary" href="/trending">Browse trending maps</a>
      </div>
    </section>

    ${errMsg}

    <section class="slide-in" style="margin-bottom: 48px;">
      <h3 style="font-family: var(--font-display); font-size: 18px; margin-bottom: 16px; color: var(--text-dim); font-weight: 600;">Or look up any player</h3>
      <div class="lookup-row">
        <input id="lookupUser" type="text" placeholder="osu! username (e.g. mrekk)" autocomplete="off" />
        ${modeSelector('osu')}
        <button id="lookupBtn">Analyze →</button>
      </div>
      <div id="statusArea"></div>
      <div id="lookupResult"></div>
    </section>

    <section class="features slide-in">
      <div class="feature">
        <div class="icon">🎯</div>
        <h3>Smart profiling</h3>
        <p>PP-weighted analysis of your top 100 plays — star rating, BPM, accuracy, mod preferences.</p>
      </div>
      <div class="feature">
        <div class="icon">🚀</div>
        <h3>Four strategies</h3>
        <p>Push PP, farm easy plays, stay in your comfort zone, or chase reach plays. Your call.</p>
      </div>
      <div class="feature">
        <div class="icon">📈</div>
        <h3>PP history</h3>
        <p>Track your rank, PP, and accuracy over time with automatic snapshots on every session.</p>
      </div>
      <div class="feature">
        <div class="icon">⭐</div>
        <h3>Favorites</h3>
        <p>Save maps you want to try later. Your personal pp-farming to-do list.</p>
      </div>
      <div class="feature">
        <div class="icon">🔥</div>
        <h3>Trending</h3>
        <p>See what maps the community is grinding right now, per mode and strategy.</p>
      </div>
      <div class="feature">
        <div class="icon">🔐</div>
        <h3>One-click login</h3>
        <p>Sign in with osu! — no passwords, no credentials to set up. We store only what we need.</p>
      </div>
    </section>
  `;

  document.getElementById('lookupBtn').addEventListener('click', publicLookup);
  document.getElementById('lookupUser').addEventListener('keydown', e => {
    if (e.key === 'Enter') publicLookup();
  });
}

async function publicLookup() {
  const username = document.getElementById('lookupUser').value.trim();
  const mode = document.getElementById('modeSelect').value;
  if (!username) return;
  modeCache = mode;

  setStatus(`Fetching profile for ${username}…`);
  const resultEl = document.getElementById('lookupResult');
  resultEl.innerHTML = '';

  try {
    const res = await fetch(`/api/recommend/public?user=${encodeURIComponent(username)}&mode=${mode}&strategy=push`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      setStatus(err.error || 'Request failed', 'error');
      return;
    }
    const data = await res.json();
    clearStatus();

    resultEl.innerHTML = `
      ${renderProfileBlock(data.user)}
      <section class="slide-in" style="margin-bottom: 32px;">
        <div class="section-header">
          <h3>Recommended maps</h3>
          <span class="sub">public view · ${mode}</span>
        </div>
        <div class="map-list">
          ${data.recommendations.map(m => renderMapCard(m, false)).join('')}
        </div>
      </section>
    `;
  } catch (e) {
    setStatus('Error: ' + e.message, 'error');
  }
}

// ---------------- DASHBOARD ----------------
async function renderDashboard() {
  if (!currentUser) {
    app.innerHTML = `
      <section class="hero slide-in">
        <h1>Login <span class="accent">required</span></h1>
        <p>The dashboard uses your osu! account to personalize recommendations. Login takes one click — we never see your password.</p>
        <div class="hero-actions">
          <a class="btn" href="/api/auth/login">🔐 Login with osu!</a>
          <a class="btn secondary" href="/">Back to home</a>
        </div>
      </section>
    `;
    return;
  }

  app.innerHTML = `
    <div class="section-header" style="margin-bottom: 24px;">
      <h3 style="font-size: 36px;">Dashboard</h3>
      <div style="display: flex; gap: 10px; align-items: center;">
        <span class="sub">mode</span>
        ${modeSelector(modeCache)}
      </div>
    </div>
    <div id="statusArea"></div>
    <div id="dashboardBody">${loader()}</div>
  `;

  document.getElementById('modeSelect').addEventListener('change', (e) => {
    modeCache = e.target.value;
    loadDashboard('push');
  });

  await loadDashboard('push');
}

let dashboardData = null;

async function loadDashboard(strategy) {
  const body = document.getElementById('dashboardBody');
  setStatus(`Loading ${strategy} recommendations for ${modeCache}…`);

  try {
    const res = await fetch(`/api/recommend?mode=${modeCache}&strategy=${strategy}`);
    if (res.status === 401) {
      app.innerHTML = `<div class="status error">Session expired. <a href="/api/auth/login" style="color:var(--pink)">Login again</a>.</div>`;
      return;
    }
    if (!res.ok) throw new Error((await res.json()).error || 'Failed');

    dashboardData = await res.json();
    const favs = await fetch('/api/favorites').then(r => r.json()).catch(() => ({favorites:[]}));
    const favSet = new Set((favs.favorites || []).map(f => f.beatmap_id));

    clearStatus();
    body.innerHTML = `
      ${renderProfileBlock(dashboardData.user)}
      ${renderSkillSummary(dashboardData.analysis)}

      <section class="slide-in">
        <div class="section-header">
          <h3>Recommended maps</h3>
          <span class="sub">click tabs to switch strategy</span>
        </div>
        <div class="tabs">
          ${['push','farm','comfort','stretch'].map(k => {
            const labels = { push: '🚀 Push PP', farm: '🌾 Farm', comfort: '🛋 Comfort', stretch: '🔥 Reach' };
            return `<button class="tab ${k===strategy?'active':''}" data-strategy="${k}">${labels[k]}</button>`;
          }).join('')}
        </div>
        <div class="map-list">
          ${dashboardData.recommendations.map(m => renderMapCard(m, true, favSet)).join('')}
        </div>
      </section>
    `;

    // Tab switching
    body.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => loadDashboard(btn.dataset.strategy));
    });
    // Favorite buttons
    body.querySelectorAll('.fav-btn').forEach(b => b.addEventListener('click', toggleFavorite));
  } catch (e) {
    setStatus('Error: ' + e.message, 'error');
  }
}

async function toggleFavorite(e) {
  const btn = e.currentTarget;
  const id = btn.dataset.id;
  const meta = JSON.parse(btn.dataset.meta);
  const isFav = btn.classList.contains('active');
  try {
    if (isFav) {
      await fetch(`/api/favorites/${id}`, { method: 'DELETE' });
      btn.classList.remove('active');
      btn.textContent = '☆ Save';
    } else {
      await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(meta),
      });
      btn.classList.add('active');
      btn.textContent = '★ Saved';
    }
  } catch (err) { alert('Failed: ' + err.message); }
}

// ---------------- HISTORY ----------------
async function renderHistory() {
  if (!currentUser) {
    app.innerHTML = authRequired('History');
    return;
  }

  app.innerHTML = `
    <div class="section-header">
      <h3 style="font-size: 36px;">PP history</h3>
      <div style="display: flex; gap: 10px; align-items: center;">
        <span class="sub">mode</span>
        ${modeSelector(modeCache)}
      </div>
    </div>
    <div id="statusArea"></div>
    <div id="historyBody">${loader()}</div>
  `;

  document.getElementById('modeSelect').addEventListener('change', (e) => {
    modeCache = e.target.value;
    loadHistory();
  });

  await loadHistory();
}

async function loadHistory() {
  const body = document.getElementById('historyBody');
  try {
    const res = await fetch(`/api/history?mode=${modeCache}`);
    if (res.status === 401) { app.innerHTML = authRequired('History'); return; }
    const data = await res.json();
    const history = data.history || [];

    if (history.length < 2) {
      body.innerHTML = `
        <div class="empty">
          <div class="icon">📈</div>
          <h3>Not enough data yet</h3>
          <p>History is captured each time you open your dashboard. Come back after a few sessions to see your PP curve.</p>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div class="chart-wrap slide-in">
        <canvas id="ppChart"></canvas>
      </div>
      <div class="stats-grid">
        ${statCard('First snapshot', new Date(history[0].snapshot_at * 1000).toLocaleDateString())}
        ${statCard('Latest PP', Math.round(history[history.length-1].pp) + 'pp')}
        ${statCard('Δ PP', formatDelta(history[history.length-1].pp - history[0].pp) + 'pp')}
        ${statCard('Δ Global rank', formatRankDelta(history[0].global_rank, history[history.length-1].global_rank))}
        ${statCard('Snapshots', history.length)}
      </div>
    `;
    drawChart(history);
  } catch (e) {
    setStatus('Error: ' + e.message, 'error');
  }
}

function formatDelta(d) {
  if (d > 0) return '+' + d.toFixed(0);
  return d.toFixed(0);
}

function formatRankDelta(from, to) {
  if (!from || !to) return '—';
  const d = from - to;  // positive = improved (rank went down numerically)
  if (d > 0) return `▲ ${d.toLocaleString()}`;
  if (d < 0) return `▼ ${Math.abs(d).toLocaleString()}`;
  return '—';
}

function drawChart(history) {
  const canvas = document.getElementById('ppChart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = 340;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);

  const pad = { t: 30, r: 30, b: 40, l: 60 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;

  const pps = history.map(s => s.pp);
  const minPP = Math.min(...pps) * 0.995;
  const maxPP = Math.max(...pps) * 1.005;
  const ts = history.map(s => s.snapshot_at);
  const minT = ts[0], maxT = ts[ts.length-1];

  const x = t => pad.l + ((t - minT) / (maxT - minT || 1)) * cw;
  const y = p => pad.t + (1 - (p - minPP) / (maxPP - minPP || 1)) * ch;

  // Background grid
  ctx.strokeStyle = 'rgba(45, 27, 85, 0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yy = pad.t + (i / 4) * ch;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(pad.l + cw, yy); ctx.stroke();

    const pp = maxPP - (i / 4) * (maxPP - minPP);
    ctx.fillStyle = '#6b5d8a';
    ctx.font = '11px JetBrains Mono';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(pp) + 'pp', pad.l - 10, yy + 4);
  }

  // Area fill
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
  grad.addColorStop(0, 'rgba(255, 102, 170, 0.4)');
  grad.addColorStop(1, 'rgba(255, 102, 170, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x(history[0].snapshot_at), pad.t + ch);
  history.forEach(s => ctx.lineTo(x(s.snapshot_at), y(s.pp)));
  ctx.lineTo(x(history[history.length-1].snapshot_at), pad.t + ch);
  ctx.closePath();
  ctx.fill();

  // Line
  ctx.strokeStyle = '#ff66aa';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  history.forEach((s, i) => {
    const px = x(s.snapshot_at), py = y(s.pp);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // Points
  ctx.fillStyle = '#ff66aa';
  history.forEach(s => {
    ctx.beginPath();
    ctx.arc(x(s.snapshot_at), y(s.pp), 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // X-axis labels (first and last)
  ctx.fillStyle = '#6b5d8a';
  ctx.font = '11px JetBrains Mono';
  ctx.textAlign = 'left';
  ctx.fillText(new Date(minT * 1000).toLocaleDateString(), pad.l, h - 15);
  ctx.textAlign = 'right';
  ctx.fillText(new Date(maxT * 1000).toLocaleDateString(), pad.l + cw, h - 15);
}

// ---------------- FAVORITES ----------------
async function renderFavorites() {
  if (!currentUser) {
    app.innerHTML = authRequired('Favorites');
    return;
  }

  app.innerHTML = `
    <div class="section-header">
      <h3 style="font-size: 36px;">Favorite maps</h3>
      <span class="sub">your pp-farming to-do list</span>
    </div>
    <div id="favBody">${loader()}</div>
  `;

  try {
    const res = await fetch('/api/favorites');
    const { favorites = [] } = await res.json();
    const body = document.getElementById('favBody');
    if (!favorites.length) {
      body.innerHTML = `
        <div class="empty">
          <div class="icon">⭐</div>
          <h3>No saved maps yet</h3>
          <p>Click the ☆ Save button on any recommendation in your dashboard to add it here.</p>
          <div style="margin-top: 20px;"><a class="btn" href="/dashboard">Go to dashboard</a></div>
        </div>
      `;
      return;
    }

    body.innerHTML = `<div class="map-list">${favorites.map(f => {
      const m = {
        id: f.beatmap_id, beatmapset_id: f.beatmapset_id,
        title: f.title, artist: f.artist, version: f.version,
        creator: '', stars: f.stars, bpm: null, length: null, playcount: null,
        cover_url: `https://assets.ppy.sh/beatmaps/${f.beatmapset_id}/covers/card@2x.jpg`,
        url: `https://osu.ppy.sh/beatmapsets/${f.beatmapset_id}#${f.mode}/${f.beatmap_id}`,
      };
      return renderMapCard(m, true, new Set(favorites.map(x => x.beatmap_id)), true);
    }).join('')}</div>`;

    body.querySelectorAll('.fav-btn').forEach(b => b.addEventListener('click', async (e) => {
      await toggleFavorite(e);
      renderFavorites();
    }));
  } catch (e) {
    document.getElementById('favBody').innerHTML = `<div class="status error">Error: ${escapeHtml(e.message)}</div>`;
  }
}

// ---------------- TRENDING ----------------
async function renderTrending() {
  app.innerHTML = `
    <div class="section-header">
      <h3 style="font-size: 36px;">Trending maps</h3>
      <div style="display: flex; gap: 10px; align-items: center;">
        <span class="sub">mode</span>
        ${modeSelector(modeCache)}
      </div>
    </div>
    <div class="tabs" id="trendingTabs">
      ${['push','farm','comfort','stretch'].map((k, i) => {
        const labels = { push: '🚀 Push PP', farm: '🌾 Farm', comfort: '🛋 Comfort', stretch: '🔥 Reach' };
        return `<button class="tab ${i===0?'active':''}" data-strategy="${k}">${labels[k]}</button>`;
      }).join('')}
    </div>
    <div id="trendingBody">${loader()}</div>
  `;

  document.getElementById('modeSelect').addEventListener('change', (e) => {
    modeCache = e.target.value;
    const s = document.querySelector('#trendingTabs .active').dataset.strategy;
    loadTrending(s);
  });
  document.querySelectorAll('#trendingTabs .tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#trendingTabs .tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      loadTrending(b.dataset.strategy);
    });
  });

  await loadTrending('push');
}

async function loadTrending(strategy) {
  const body = document.getElementById('trendingBody');
  body.innerHTML = loader();
  try {
    const res = await fetch(`/api/trending?mode=${modeCache}&strategy=${strategy}`);
    const { trending = [] } = await res.json();
    if (!trending.length) {
      body.innerHTML = `
        <div class="empty">
          <div class="icon">🔥</div>
          <h3>Not enough data yet</h3>
          <p>Trending fills up as players use this. Check back soon, or run a recommendation to contribute.</p>
        </div>
      `;
      return;
    }
    body.innerHTML = `<div class="map-list">${trending.map((t, i) => `
      <div class="map-card">
        <img class="map-cover" src="${t.cover_url || ''}" onerror="this.style.display='none'" alt=""/>
        <div class="map-info">
          <div class="map-title">#${i+1} · ${escapeHtml(t.title || '—')} [${escapeHtml(t.version || '')}]</div>
          <div class="map-artist">${escapeHtml(t.artist || '')} · ${escapeHtml(t.creator || '—')}</div>
          <div class="map-meta">
            <span class="badge stars">★ ${(t.stars||0).toFixed(2)}</span>
            <span class="badge bpm">${Math.round(t.bpm||0)} BPM</span>
            <span class="badge length">${fmtLen(t.length)}</span>
            <span>🔁 ${numFmt(t.count)} recs</span>
          </div>
        </div>
        <div class="map-action">
          <a class="map-link" href="https://osu.ppy.sh/beatmapsets/${t.beatmapset_id}#${modeCache}/${t.beatmap_id}" target="_blank" rel="noopener">Open →</a>
        </div>
      </div>
    `).join('')}</div>`;
  } catch (e) {
    body.innerHTML = `<div class="status error">Error: ${escapeHtml(e.message)}</div>`;
  }
}

// ---------------- shared renderers ----------------
function renderProfileBlock(u) {
  const s = u.statistics || {};
  const ranks = s.grade_counts || {};
  return `
    <section class="profile-block slide-in">
      <div class="profile-head">
        <img class="avatar" src="${u.avatar_url || ''}" alt="" onerror="this.style.display='none'"/>
        <div class="profile-info">
          <h2>${escapeHtml(u.username)}</h2>
          <div class="meta">
            <span>🌍 ${escapeHtml(u.country?.name || u.country_code || '—')}</span>
            <span>#${numFmt(s.global_rank)} global</span>
            <span>#${numFmt(s.country_rank)} ${escapeHtml(u.country_code || '')}</span>
            <span>${numFmt(Math.round(s.pp || 0))}pp</span>
          </div>
        </div>
      </div>
      <div class="stats-grid">
        ${statCard('Accuracy', (s.hit_accuracy ?? 0).toFixed(2) + '%')}
        ${statCard('Playcount', numFmt(s.play_count))}
        ${statCard('Level', Math.floor(s.level?.current || 0))}
        ${statCard('Play time', hoursFmt(s.play_time))}
        ${statCard('Ranked score', shortNum(s.ranked_score))}
        ${statCard('Max combo', numFmt(s.maximum_combo))}
        ${statCard('SS · S · A', `${(ranks.ss||0)+(ranks.ssh||0)} · ${(ranks.s||0)+(ranks.sh||0)} · ${ranks.a||0}`)}
      </div>
    </section>
  `;
}

function statCard(label, value) {
  return `<div class="stat">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
  </div>`;
}

function renderSkillSummary(a) {
  if (!a) return '';
  const bpmBand = a.weightedBPM < 160 ? 'slow to mid' : a.weightedBPM < 200 ? 'mid' : a.weightedBPM < 230 ? 'high' : 'very high';
  const lengthBand = a.weightedLength < 90 ? 'short' : a.weightedLength < 180 ? 'mid-length' : 'long';
  const target = Math.round(a.avgTop10 * 1.15);

  return `
    <section class="slide-in">
      <div class="section-header">
        <h3>Your skill profile</h3>
        <span class="sub">derived from top 100 plays</span>
      </div>
      <div class="profile-summary">
        Your top play is worth <span class="num">${Math.round(a.topPP)}pp</span>. Average of your top 10 is <span class="num">${Math.round(a.avgTop10)}pp</span>.<br/>
        Your PP-weighted star rating sits at <strong>${a.weightedStars.toFixed(2)}★</strong>, with most top plays landing between <strong>${a.starRange.p25.toFixed(2)}★ and ${a.starRange.p75.toFixed(2)}★</strong>.<br/>
        You perform best around <strong>${Math.round(a.weightedBPM)} BPM</strong> (${bpmBand}), on <strong>${lengthBand}</strong> maps (~${Math.round(a.weightedLength/60)}min), averaging <strong>${a.weightedAcc.toFixed(2)}%</strong> accuracy on your top plays.<br/><br/>
        <strong>PP-gain target:</strong> a new play worth ~<span class="num">${target}pp</span> or more would enter your top 10 and raise your profile.
      </div>
    </section>
    ${renderModAnalysis(a.modAnalysis)}
  `;
}

function renderModAnalysis(modAnalysis) {
  if (!modAnalysis || !modAnalysis.length) return '';

  const ranked = modAnalysis.slice().sort((a, b) => b.avgPP - a.avgPP);
  const topMod = ranked[0];
  const nm = modAnalysis.find(m => m.mod === 'NM');

  const medals = ['🥇', '🥈', '🥉'];
  const rows = ranked.slice(0, 5).map((m, i) => {
    const medal = medals[i] || '  ';
    const modLabel = m.mod === 'NM' ? 'NoMod' : m.mod;
    const pct = m.percentage.toFixed(0);
    const avgPP = Math.round(m.avgPP);
    const avgAcc = m.avgAcc.toFixed(2);
    const top = Math.round(m.topPP);

    let delta = '';
    if (m.ppDeltaVsNM != null) {
      const sign = m.ppDeltaVsNM >= 0 ? '+' : '';
      const color = m.ppDeltaVsNM >= 0 ? 'var(--success)' : 'var(--danger)';
      delta = ` <span style="color:${color}; font-size: 12px; font-family: var(--font-mono);">${sign}${m.ppDeltaVsNM.toFixed(1)}% vs NM</span>`;
    }

    return `
      <div class="mod-row">
        <div class="mod-rank">${medal}</div>
        <div class="mod-name"><strong>${modLabel}</strong>${delta}</div>
        <div class="mod-stat"><span class="mod-stat-label">usage</span><span class="mod-stat-val">${pct}%</span></div>
        <div class="mod-stat"><span class="mod-stat-label">avg pp</span><span class="mod-stat-val">${avgPP}</span></div>
        <div class="mod-stat"><span class="mod-stat-label">avg acc</span><span class="mod-stat-val">${avgAcc}%</span></div>
        <div class="mod-stat"><span class="mod-stat-label">best</span><span class="mod-stat-val">${top}pp</span></div>
      </div>
    `;
  }).join('');

  let insight = '';
  if (nm && topMod && topMod.mod !== 'NM' && nm.avgPP > 0) {
    const ppGain = ((topMod.avgPP - nm.avgPP) / nm.avgPP * 100).toFixed(0);
    const accDrop = (nm.avgAcc - topMod.avgAcc).toFixed(2);
    const topLabel = topMod.mod === 'NM' ? 'NoMod' : topMod.mod;
    insight = `💡 <strong>${topLabel}</strong> gives you <strong>~${ppGain}% more pp</strong> than NoMod on average` +
      (accDrop > 0.1 ? `, though your accuracy drops ${accDrop}%. Still your best mod by a wide margin.` : ` with no accuracy loss. Lean into it.`);
  } else if (topMod && topMod.mod === 'NM') {
    insight = `💡 You play mostly <strong>NoMod</strong> and that's where you earn pp. Try experimenting with <strong>HD</strong> or <strong>HR</strong> for extra multipliers on comfortable maps.`;
  }

  return `
    <section class="slide-in" style="margin-top: 24px;">
      <div class="section-header">
        <h3>Your mod playstyle</h3>
        <span class="sub">ranked by avg pp per play</span>
      </div>
      <div class="mod-analysis">
        <div class="mod-rows">
          ${rows}
        </div>
        ${insight ? `<div class="mod-insight">${insight}</div>` : ''}
      </div>
    </section>
  `;
}

function renderMapCard(m, showFav, favSet = new Set(), isFavView = false) {
  const meta = {
    beatmap_id: m.id,
    beatmapset_id: m.beatmapset_id,
    title: m.title,
    artist: m.artist,
    version: m.version,
    stars: m.stars,
    mode: m.mode || modeCache,
  };
  const isFav = favSet.has(m.id);
  return `
    <div class="map-card">
      <img class="map-cover" src="${m.cover_url || ''}" alt="" onerror="this.style.display='none'"/>
      <div class="map-info">
        <div class="map-title">${escapeHtml(m.title || 'Unknown')} [${escapeHtml(m.version || '')}]</div>
        <div class="map-artist">${escapeHtml(m.artist || '')}${m.creator ? ' · mapped by ' + escapeHtml(m.creator) : ''}</div>
        <div class="map-meta">
          <span class="badge stars">★ ${(m.stars || 0).toFixed(2)}</span>
          ${m.bpm ? `<span class="badge bpm">${Math.round(m.bpm)} BPM</span>` : ''}
          ${m.length ? `<span class="badge length">${fmtLen(m.length)}</span>` : ''}
          ${m.playcount ? `<span>▶ ${numFmt(m.playcount)} plays</span>` : ''}
        </div>
      </div>
      <div class="map-action">
        ${m.estPP ? `<div class="pp-estimate">+${Math.round(m.estPP)}<span class="pp-label">est. pp</span></div>` : ''}
        <div style="display: flex; gap: 6px;">
          ${showFav && currentUser ? `<button class="fav-btn ${isFav?'active':''}" data-id="${m.id}" data-meta='${escapeHtml(JSON.stringify(meta))}'>${isFav ? '★ Saved' : '☆ Save'}</button>` : ''}
          <a class="map-link" href="${m.url}" target="_blank" rel="noopener">Open →</a>
        </div>
      </div>
    </div>
  `;
}

function authRequired(pageName) {
  return `
    <section class="hero slide-in">
      <h1>${escapeHtml(pageName)} <span class="accent">requires login</span></h1>
      <p>Sign in with your osu! account to access this page.</p>
      <div class="hero-actions">
        <a class="btn" href="/api/auth/login">🔐 Login with osu!</a>
        <a class="btn secondary" href="/">Back home</a>
      </div>
    </section>
  `;
}
