'use strict';
// Projector page: polls /api/results every 3 s. The API returns aggregates only.

const $ = (id) => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const BAD = color('--bad'), GOOD = color('--good'), SURFACE = color('--surface'), LINE = color('--line');
const WORDS = ['Frustrated', 'Confused', 'Anxious', 'Blamed', 'Annoyed', 'Calm', 'Helped', 'In control'];
const FACES = ['😡', '😟', '😐', '🙂', '😌'];

const session = {
  get() { try { return sessionStorage.getItem('hci_admin') || ''; } catch { return ''; } },
  set(v) { try { v ? sessionStorage.setItem('hci_admin', v) : sessionStorage.removeItem('hci_admin'); } catch {} },
};
let adminKey = session.get();

/* ---------- Join link and QR. Add ?join=<url> to show a custom short link instead. ---------- */

const joinUrl = new URLSearchParams(location.search).get('join') || location.origin;
$('join-url').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
if (window.qrcode) {
  const qr = qrcode(0, 'M');
  qr.addData(joinUrl);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

/* ---------- Face gauges: needle eases from 1 (😡) to 5 (😌) ---------- */

function gauge(el, label) {
  el.innerHTML = `<svg viewBox="0 0 200 128" aria-hidden="true">
      <path class="g-track" pathLength="1" d="M20 100 A80 80 0 0 1 180 100"/>
      <path class="g-fill" pathLength="1" d="M20 100 A80 80 0 0 1 180 100" style="stroke:var(--c);opacity:0"/>
      <text class="g-face" x="20" y="128" text-anchor="middle">😡</text>
      <text class="g-face" x="180" y="128" text-anchor="middle">😌</text>
      <g class="needle"><line x1="100" y1="100" x2="100" y2="36"/><circle cx="100" cy="100" r="8"/></g>
    </svg>
    <div class="g-value">–</div>
    <div class="g-label"><span class="tag" style="background:var(--c)"></span>${label}</div>`;
  const needle = el.querySelector('.needle'), fill = el.querySelector('.g-fill'), value = el.querySelector('.g-value');
  return (avg) => {
    const frac = avg == null ? 0.5 : (avg - 1) / 4;
    needle.style.transform = `rotate(${-90 + frac * 180}deg)`;
    fill.style.opacity = avg == null ? 0 : 1;
    fill.style.strokeDasharray = `${frac} 1`;
    value.textContent = avg == null ? '–' : avg.toFixed(1);
  };
}
const gaugeBad = gauge($('gauge-bad'), 'Bad design');
const gaugeGood = gauge($('gauge-good'), 'Good design');

/* ---------- Charts ---------- */

Chart.defaults.color = color('--text-2');
Chart.defaults.borderColor = LINE;
Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
Chart.defaults.font.size = 18;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.animation.duration = reduced ? 0 : 900;
Chart.defaults.plugins.legend.align = 'end';
Chart.defaults.plugins.legend.labels.boxWidth = 16;

// Draws each bar's value at its tip so numbers are readable from the back of the room.
Chart.register({
  id: 'valueLabels',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts.format) return;
    const { ctx } = chart, horizontal = chart.options.indexAxis === 'y';
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = horizontal ? 'left' : 'center';
    ctx.textBaseline = horizontal ? 'middle' : 'bottom';
    chart.data.datasets.forEach((ds, i) => chart.getDatasetMeta(i).data.forEach((bar, j) => {
      const v = ds.data[j];
      if (v == null || v <= 0) return;
      ctx.fillText(opts.format(v), horizontal ? bar.x + 8 : bar.x, horizontal ? bar.y : bar.y - 6);
    }));
    ctx.restore();
  },
});

const bars = (bg) => ({ backgroundColor: bg, borderColor: SURFACE, borderWidth: 2, borderRadius: 6, borderSkipped: 'start', maxBarThickness: 100 });

const feelChart = new Chart($('chart-feel'), {
  type: 'bar',
  data: {
    labels: ['Sign up', 'Payment'],
    datasets: [
      { label: 'Bad design', data: [null, null], ...bars(BAD) },
      { label: 'Good design', data: [null, null], ...bars(GOOD) },
    ],
  },
  options: {
    layout: { padding: { top: 26 } },
    scales: {
      y: { min: 0, max: 5, ticks: { stepSize: 1, callback: (v) => (v ? `${FACES[v - 1]} ${v}` : '') } },
      x: { grid: { display: false } },
    },
    plugins: { valueLabels: { format: (v) => v.toFixed(1) } },
  },
});

const wordsChart = new Chart($('chart-words'), {
  type: 'bar',
  data: {
    labels: WORDS,
    datasets: [
      { label: 'Bad design', data: WORDS.map(() => 0), ...bars(BAD), borderWidth: 1 },
      { label: 'Good design', data: WORDS.map(() => 0), ...bars(GOOD), borderWidth: 1 },
    ],
  },
  options: {
    indexAxis: 'y',
    datasets: { bar: { categoryPercentage: 0.9, barPercentage: 0.95 } },
    layout: { padding: { right: 56 } },
    scales: {
      x: { min: 0, suggestedMax: 60, ticks: { callback: (v) => v + '%' } },
      y: { grid: { display: false } },
    },
    plugins: {
      valueLabels: { format: (v) => Math.round(v) + '%' },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${Math.round(c.raw)}%` } },
    },
  },
});

// Attempts and seconds have different scales, so they get separate charts rather than a dual axis.
const effortChart = (id, format) => new Chart($(id), {
  type: 'bar',
  data: { labels: ['Bad', 'Good'], datasets: [{ label: id.slice(6), data: [0, 0], ...bars([BAD, GOOD]) }] },
  options: {
    layout: { padding: { top: 26 } },
    scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
    plugins: { legend: { display: false }, valueLabels: { format } },
  },
});
const attemptsChart = effortChart('chart-attempts', (v) => v.toFixed(1));
const secondsChart = effortChart('chart-seconds', (v) => Math.round(v) + 's');

/* ---------- Live counts, wall, floating emoji ---------- */

function setCount(id, n) {
  const el = $(id);
  if (el.textContent === String(n)) return;
  el.textContent = n;
  if (reduced) return;
  el.classList.remove('pop');
  void el.offsetWidth; // restart the animation
  el.classList.add('pop');
}

let wallIds = new Set();
function renderWall(items) {
  const track = $('wall');
  const key = items.map((w) => w.id + ':' + (w.nick || '')).join();
  if (track.dataset.key === key) return;
  track.dataset.key = key;
  if (!items.length) {
    track.className = 'wall-track';
    track.innerHTML = '<p class="empty">Optional one-word answers will appear here.</p>';
    wallIds = new Set();
    return;
  }
  const copy = document.createElement('div');
  copy.className = 'wall-copy';
  for (const w of items) {
    const el = document.createElement('span');
    el.className = 'word' + (wallIds.has(w.id) ? ' old' : '');
    el.style.setProperty('--c', w.design === 'bad' ? BAD : GOOD);
    el.innerHTML = `<b>${w.design === 'bad' ? 'Bad' : 'Good'}</b>`;
    el.append(w.text);
    if (w.nick) {
      const s = document.createElement('small');
      s.textContent = '– ' + w.nick;
      el.append(s);
    }
    copy.append(el);
  }
  wallIds = new Set(items.map((w) => w.id));
  track.replaceChildren(copy);
  const overflow = copy.offsetHeight > track.parentElement.clientHeight;
  track.className = 'wall-track' + (overflow && !reduced ? ' scrolling' : '');
  if (overflow && !reduced) {
    const twin = copy.cloneNode(true);
    twin.setAttribute('aria-hidden', 'true');
    track.append(twin);
    track.style.setProperty('--dur', Math.max(20, items.length * 2.5) + 's');
  }
}

let prevHist = null;
function floatNew(hist) {
  if (prevHist && !reduced) {
    let budget = 12;
    for (const design of ['bad', 'good']) {
      hist[design].forEach((c, i) => {
        for (let k = c - prevHist[design][i]; k > 0 && budget > 0; k--, budget--) spawn(FACES[i], design);
      });
    }
  }
  prevHist = hist;
}
function spawn(face, design) {
  const el = document.createElement('span');
  el.className = 'float-emoji';
  el.textContent = face;
  el.setAttribute('aria-hidden', 'true');
  el.style.left = 4 + Math.random() * 88 + 'vw';
  el.style.filter = `drop-shadow(0 0 12px ${design === 'bad' ? BAD : GOOD})`;
  document.body.append(el);
  const drift = (Math.random() - 0.5) * 140;
  el.animate([
    { transform: 'translateY(0) scale(.8)', opacity: 0 },
    { opacity: 1, offset: 0.1 },
    { transform: `translate(${drift / 2}px, -50vh) scale(1.1) rotate(${drift / 8}deg)`, opacity: 1, offset: 0.6 },
    { transform: `translate(${drift}px, -105vh) scale(1)`, opacity: 0 },
  ], { duration: 4500 + Math.random() * 2000, delay: Math.random() * 1500, easing: 'ease-out', fill: 'backwards' }).onfinish = () => el.remove();
}

/* ---------- Update + polling ---------- */

const avg = (h) => {
  const n = h.reduce((a, b) => a + b, 0);
  return n ? h.reduce((s, c, i) => s + c * (i + 1), 0) / n : null;
};

function update(d) {
  setCount('c-joined', d.joined);
  for (const r of [1, 2, 3, 4]) setCount('c-' + r, d.rounds[r]?.n ?? 0);

  gaugeBad(avg(d.hist.bad));
  gaugeGood(avg(d.hist.good));

  const f = (r) => d.rounds[r]?.feeling ?? null;
  feelChart.data.datasets[0].data = [f(1), f(2)];
  feelChart.data.datasets[1].data = [f(3), f(4)];
  feelChart.update();

  ['bad', 'good'].forEach((design, i) => {
    const n = d.designs[design]?.n || 0;
    wordsChart.data.datasets[i].data = WORDS.map((w) => (n ? ((d.words[design][w] || 0) / n) * 100 : 0));
  });
  wordsChart.update();

  attemptsChart.data.datasets[0].data = ['bad', 'good'].map((k) => d.designs[k]?.attempts ?? 0);
  attemptsChart.update();
  secondsChart.data.datasets[0].data = ['bad', 'good'].map((k) => d.designs[k]?.seconds ?? 0);
  secondsChart.update();

  renderWall(d.wall);
  floatNew(d.hist);

  if (nickBox.checked && !d.nicknames) {
    nickBox.checked = false;
    adminKey = '';
    session.set('');
    $('status').textContent = 'Wrong admin key';
  }
}

let last = '';
async function poll() {
  try {
    const res = await fetch('/api/results', {
      cache: 'no-store',
      headers: nickBox.checked && adminKey ? { 'x-admin-key': adminKey } : {},
    });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    if (text !== last) {
      last = text;
      update(JSON.parse(text));
    }
    if ($('status').textContent === 'Reconnecting…') $('status').textContent = '';
  } catch {
    $('status').textContent = 'Reconnecting…';
  }
  setTimeout(poll, 3000);
}

/* ---------- Presenter controls ---------- */

const nickBox = $('show-nicks');
nickBox.onchange = () => {
  if (nickBox.checked && !adminKey) {
    adminKey = prompt('Admin key (needed to show nicknames)') || '';
    session.set(adminKey);
    if (!adminKey) nickBox.checked = false;
  }
  last = ''; // force a redraw on the next poll
};

$('reset').onclick = async () => {
  const key = prompt('Admin key to reset ALL responses');
  if (!key || !confirm('Delete every response and participant? This cannot be undone.')) return;
  const res = await fetch('/api/reset', { method: 'POST', headers: { 'x-admin-key': key } }).catch(() => null);
  $('status').textContent = res?.ok ? 'Reset done' : res?.status === 403 ? 'Wrong admin key' : 'Reset failed';
  if (res?.ok) { adminKey = key; session.set(key); last = ''; }
};

poll();
