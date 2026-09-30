'use strict';
// Quiz player. Polls /api/quiz every second; the host moves everyone on together from the results page.
// Wrong answers get the same hostile "bad design" treatment as rounds 1-2 of the demo; right answers get the calm one.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const FADE = [{ opacity: 0.3 }, { opacity: 1 }];
function anim(el, frames, opts, fallback = FADE) {
  if (!el) return null;
  if (reduced.matches) return fallback ? el.animate(fallback, { duration: 200 }) : null;
  return el.animate(frames, opts);
}

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const AVATARS = ['🦊', '🐼', '🐸', '🐙', '🦉', '🐯', '🐨', '🦄', '🐧', '🐢', '🦁', '🐝', '🐳', '🦖', '🐵', '🐰'];
const SHAPES = ['▲', '◆', '●', '■'];
const ordinal = (n) => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
const fmt = (n) => n.toLocaleString('en');

// Same participant ID as the demo, so one phone is one player.
const pid = store.get('hci_pid') || (() => {
  const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  store.set('hci_pid', id);
  return id;
})();

/* ---------- Network ---------- */

let S = null; // last state from the server
let offset = 0; // server clock minus phone clock
let picked = null; // { q, startAt, choice } while the answer is in flight

async function post(url, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status !== 429 && res.status < 500) return res;
    } catch {}
    await sleep(700 * (i + 1));
  }
  return null;
}

let pollTimer;
async function poll() {
  clearTimeout(pollTimer);
  const t0 = Date.now();
  try {
    const res = await fetch('/api/quiz?pid=' + pid, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const s = await res.json();
    offset = s.now - (t0 + Date.now()) / 2;
    S = s;
    $('.footer').textContent = 'HCI demo: Emotion quiz.';
    tick();
  } catch {
    $('.footer').textContent = 'Reconnecting…';
  }
  pollTimer = setTimeout(poll, 1000);
}

/* ---------- Screen plumbing ---------- */

let screenKey = 'loading', current = null;

// Work out what to show from the last state plus the local clock, so the countdown and
// "time's up" switch on time even between polls.
function view() {
  if (!S) return ['loading'];
  if (!S.me) return ['joining'];
  const t = Date.now() + offset;
  let phase = S.phase;
  if (phase === 'ready' && t >= S.startAt) phase = 'question';
  if (phase === 'question' && t >= S.endsAt) phase = 'timeup';
  const id = `${S.q}:${S.startAt}`;
  const mine = picked && picked.q === S.q && picked.startAt === S.startAt;
  if ((phase === 'question' || phase === 'timeup') && (S.me.answered || mine)) return ['waiting', id];
  if (phase === 'lobby' || phase === 'final') return [phase];
  return [phase, id];
}

function tick() {
  const [name, id] = view();
  const key = name + (id ? ':' + id : '');
  if (key !== screenKey) {
    screenKey = key;
    render(name);
  } else {
    current?.update?.();
  }
  updateBar();
  const d = $('#join');
  if (name === 'joining' && !d.open) openJoin();
  if (name !== 'joining' && d.open && !d.dataset.editing) d.close();
}

function render(name) {
  timers.forEach(clearTimeout);
  timers = [];
  if ($('#bad-modal').open) $('#bad-modal').close();
  document.body.className = 'quiz-page theme-neutral';
  current = SCREENS[name]();
  const app = $('#app');
  app.replaceChildren(current.el);
  if (!current.quiet) {
    anim(current.el, [{ transform: 'translateX(100%)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
  current.enter?.();
}

function updateBar() {
  const bar = $('.quiz-bar');
  bar.hidden = !S?.me;
  if (!S?.me) return;
  $('.me-avatar', bar).textContent = S.me.avatar;
  $('.me-name', bar).textContent = S.me.nickname;
  $('.me-score', bar).textContent = fmt(S.me.score) + ' pts';
}

/* ---------- Stress meter (same as the demo) ---------- */

function setStress(level, mode) {
  level = Math.max(5, Math.min(100, level));
  store.set('hci_quiz_stress', level);
  const fill = $('.stress-fill');
  fill.style.transition = mode === 'good' ? 'width 1.4s cubic-bezier(.2,.8,.2,1), background-color 1.4s ease' : 'none';
  fill.style.width = level + '%';
  fill.style.backgroundColor = `hsl(${120 - level * 1.2} 85% 42%)`;
  $('.stress-face').textContent = level > 75 ? '😡' : level > 50 ? '😟' : level > 30 ? '😐' : '😌';
  if (mode === 'bad') {
    anim($('.stress'), [{ transform: 'scale(1)' }, { transform: 'scale(1.5) rotate(-8deg)' }, { transform: 'scale(.9) rotate(5deg)' }, { transform: 'scale(1)' }],
      { duration: 350, easing: 'linear' }, null);
  }
}
const stress = () => store.get('hci_quiz_stress', 25);

/* ---------- Effects ---------- */

let audio;
// Must run inside a tap handler, or iOS keeps the audio context locked.
function unlockAudio() {
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
}
function beep() {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
  o.type = 'square';
  o.frequency.setValueAtTime(220, t);
  o.frequency.setValueAtTime(140, t + 0.15);
  g.gain.setValueAtTime(0.12, t);
  g.gain.setValueAtTime(0, t + 0.35);
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + 0.4);
}
function chime() {
  if (!audio) return;
  const t = audio.currentTime;
  [660, 880, 1320].forEach((f, i) => {
    const o = audio.createOscillator(), g = audio.createGain(), s = t + i * 0.11;
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(0.1, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.5);
    o.connect(g).connect(audio.destination);
    o.start(s);
    o.stop(s + 0.55);
  });
}

function punish() {
  beep();
  anim($('.flash'), [{ opacity: 0 }, { opacity: 0.5 }, { opacity: 0 }], { duration: 300, easing: 'linear' }, null);
  anim($('#app'), [0, -16, 16, -14, 14, -9, 9, -4, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 450, easing: 'linear' }, null);
  try { navigator.vibrate?.([120, 60, 120]); } catch {}
}

function slamIn(el) {
  anim(el, [
    { transform: 'scale(1.3)' },
    { transform: 'scale(.92)', offset: 0.18 },
    { transform: 'scale(1.04) translateX(-8px)', offset: 0.36 },
    { transform: 'translateX(7px)', offset: 0.52 },
    { transform: 'translateX(-5px)', offset: 0.68 },
    { transform: 'translateX(3px)', offset: 0.84 },
    { transform: 'none' },
  ], { duration: 480, easing: 'linear' }, null);
}

function sparkle(anchor, count = 26) {
  if (reduced.matches || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#14b8a6'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'confetti';
    p.style.left = r.left + r.width / 2 + 'px';
    p.style.top = r.top + r.height / 2 + 'px';
    p.style.background = colors[i % colors.length];
    document.body.append(p);
    const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 110;
    p.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) rotate(${Math.random() * 360}deg) scale(.5)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => p.remove();
  }
}

// Effects play once per question, not again on refresh.
function firstTime(key) {
  if (store.get('hci_quiz_seen') === key) return false;
  store.set('hci_quiz_seen', key);
  return true;
}

/* ---------- Join dialog ---------- */

function openJoin(editing = false) {
  const d = $('#join'), grid = $('.avatar-grid', d), nick = $('#q-nick', d);
  const chosen = S?.me?.avatar || store.get('hci_quiz_avatar') || AVATARS[Math.floor(Math.random() * AVATARS.length)];
  grid.innerHTML = AVATARS.map((a, i) =>
    `<label class="avatar-opt"><input type="radio" name="avatar" value="${a}" aria-label="Avatar ${i + 1}" ${a === chosen ? 'checked' : ''}><span aria-hidden="true">${a}</span></label>`).join('');
  nick.value = S?.me?.nickname || store.get('hci_quiz_nick', '');
  $('#q-nick-msg', d).textContent = '';
  d.dataset.editing = editing ? '1' : '';
  d.showModal();
  anim(d, [{ opacity: 0, transform: 'translateY(24px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

function setupJoin() {
  const d = $('#join'), form = $('form', d), nick = $('#q-nick', d), msg = $('#q-nick-msg', d), btn = $('button', form);
  d.addEventListener('cancel', (e) => { if (!S?.me) e.preventDefault(); });
  d.addEventListener('close', () => { d.dataset.editing = ''; });
  d.addEventListener('change', (e) => {
    if (e.target.name !== 'avatar') return;
    anim(e.target.nextElementSibling, [{ transform: 'scale(1)' }, { transform: 'scale(1.4) rotate(-10deg)' }, { transform: 'scale(1.15)' }],
      { duration: 400, easing: 'ease-out' }, null);
  });
  nick.oninput = () => { if (nick.value.trim()) msg.textContent = ''; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    unlockAudio();
    const nickname = nick.value.trim().slice(0, 20);
    const avatar = $('input[name=avatar]:checked', form)?.value || AVATARS[0];
    if (!nickname) {
      msg.textContent = 'Please add a nickname, so you can find yourself on the leaderboard.';
      nick.focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Joining…';
    const res = await post('/api/quiz/join', { pid, nickname, avatar });
    btn.disabled = false;
    btn.textContent = 'Join quiz';
    if (!res?.ok) {
      msg.textContent = "We couldn't reach the quiz. Check your Wi-Fi and try again.";
      return;
    }
    store.set('hci_quiz_nick', nickname);
    store.set('hci_quiz_avatar', avatar);
    d.close();
    poll();
  };
}

/* ---------- Screens ---------- */

function loading() {
  return { el: h('<section class="screen card-neutral center"><div class="spinner-calm big"></div><p>Connecting to the quiz…</p></section>'), quiet: true };
}

function joining() {
  return { el: h(`<section class="screen card-neutral center">
    <div class="big-emoji" aria-hidden="true">🧠</div>
    <h1>Emotion quiz</h1>
    <p>Join, then watch the big screen. Faster correct answers score more points.</p>
  </section>`), quiet: true };
}

function lobby() {
  const el = h(`<section class="screen card-neutral center lobby">
    <p class="eyebrow">You're in!</p>
    <div class="lobby-avatar" aria-hidden="true">${esc(S.me.avatar)}</div>
    <h1>${esc(S.me.nickname)}</h1>
    <p>Waiting for the host to start… <span class="players"></span></p>
    <button class="linklike" type="button">Change nickname or avatar</button>
  </section>`);
  $('button', el).onclick = () => openJoin(true);
  const update = () => { $('.players', el).textContent = `${S.players} ${S.players === 1 ? 'player' : 'players'} joined.`; };
  update();
  return { el, update };
}

const qHead = () => `<p class="eyebrow">Question ${S.q + 1} of ${S.total}</p><h2 class="q-text">${esc(S.question.text)}</h2>`;

function ready() {
  const el = h(`<section class="screen card-neutral center">
    ${qHead()}
    <div class="countdown" aria-live="off"></div>
    <p class="hint">Get ready…</p>
  </section>`);
  const num = $('.countdown', el);
  const update = () => {
    const n = Math.max(1, Math.ceil((S.startAt - Date.now() - offset) / 1000));
    if (num.textContent === String(n)) return;
    num.textContent = n;
    anim(num, [{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 400, easing: 'cubic-bezier(.2,.8,.2,1)' });
  };
  update();
  return { el, update };
}

function timerBar() {
  return '<div class="timer" aria-hidden="true"><span class="timer-fill"></span></div><p class="timer-row"><span class="secs"></span><span class="count"></span></p>';
}
function updateTimer(el) {
  const left = Math.max(0, S.endsAt - Date.now() - offset);
  $('.timer-fill', el).style.width = (left / S.limit) * 100 + '%';
  $('.timer-fill', el).classList.toggle('low', left < 5000);
  $('.secs', el).textContent = Math.ceil(left / 1000) + 's';
  $('.count', el).textContent = `${S.answered} of ${S.players} answered`;
}

function question() {
  const el = h(`<section class="screen quiz-q">
    <div class="card-neutral">${qHead()}</div>
    ${timerBar()}
    <div class="tiles">
      ${S.question.options.map((o, i) => `<button type="button" class="tile t${i}" data-i="${i}"><span class="shape" aria-hidden="true">${SHAPES[i]}</span><span>${esc(o)}</span></button>`).join('')}
    </div>
  </section>`);
  const q = S.q, startAt = S.startAt;
  $$('.tile', el).forEach((b, i) => {
    b.onclick = async () => {
      if (picked?.q === q && picked.startAt === startAt) return;
      unlockAudio();
      picked = { q, startAt, choice: i };
      anim(b, [{ transform: 'scale(1)' }, { transform: 'scale(.94)' }, { transform: 'scale(1.03)' }], { duration: 180, easing: 'ease-out' }, null);
      $$('.tile', el).forEach((t) => t !== b && t.classList.add('dim'));
      await sleep(reduced.matches ? 0 : 180);
      tick();
      await post('/api/quiz/answer', { pid, q, choice: i });
      poll();
    };
  });
  const update = () => updateTimer(el);
  update();
  return { el, update };
}

function waiting() {
  const choice = picked?.q === S.q && picked.startAt === S.startAt ? picked.choice : null;
  const el = h(`<section class="screen card-neutral center">
    ${choice != null ? `<div class="locked t${choice}"><span class="shape" aria-hidden="true">${SHAPES[choice]}</span><span>${esc(S.question.options[choice])}</span></div>` : ''}
    <h2 class="wait-title">Answer locked in</h2>
    <div class="spinner-calm big" aria-hidden="true"></div>
    <p class="count"></p>
  </section>`);
  const update = () => {
    const over = Date.now() + offset >= S.endsAt;
    $('.wait-title', el).textContent = over ? "Time's up!" : 'Answer locked in';
    $('.count', el).textContent = over ? 'Revealing the answer…' : `Waiting for everyone else… ${S.answered} of ${S.players} answered.`;
  };
  update();
  return { el, update };
}

function timeup() {
  return { el: h(`<section class="screen card-neutral center">
    <h2>Time's up!</h2>
    <div class="spinner-calm big" aria-hidden="true"></div>
    <p>Revealing the answer…</p>
  </section>`) };
}

// Wrong or no answer: the hostile "bad design" feedback from rounds 1-2.
function revealBad(noAnswer) {
  const code = noAnswer ? 'ERROR 408: NO INPUT RECEIVED. TIMEOUT.' : 'ANSWER REJECTED. ERROR 0x0F: INCORRECT.';
  const el = h(`<section class="screen">
    <div class="win95 app95">
      <div class="win-title"><span>RESULT.TXT</span><span aria-hidden="true">_ □ ✕</span></div>
      <div class="win-body result95">
        <p class="big95">${noAnswer ? 'TIMEOUT' : 'INCORRECT'}</p>
        <p>POINTS AWARDED: 0</p>
        <p>SCORE: ${fmt(S.me.score)}</p>
        <p>RANK: #${S.me.rank}</p>
        <p class="small95">AWAIT FURTHER INSTRUCTIONS.</p>
      </div>
    </div>
  </section>`);
  return {
    el, quiet: true,
    enter() {
      document.body.className = 'quiz-page theme-bad';
      if (!firstTime(`${S.q}:${S.startAt}`)) { setStress(stress()); return; }
      punish();
      setStress(stress() + 30, 'bad');
      const modal = $('#bad-modal');
      $('p', modal).textContent = code;
      modal.showModal();
      slamIn(modal);
    },
  };
}

// Correct: the calm "good design" feedback from rounds 3-4.
function revealGood() {
  const moved = S.me.prevRank - S.me.rank;
  const el = h(`<section class="screen">
    <div class="card-good center good-result">
      <svg class="big-tick" viewBox="0 0 52 52" aria-hidden="true"><circle pathLength="1" cx="26" cy="26" r="23"/><path pathLength="1" d="M15 27l7 7 15-15"/></svg>
      <h1>Correct!</h1>
      <p class="gain">+${fmt(S.me.points)} points</p>
      <p class="why">${esc(S.why)}</p>
      <p class="rank-line">You're in <b>${ordinal(S.me.rank)}</b> place${moved > 0 ? `, up ${moved} ${moved === 1 ? 'place' : 'places'}` : ''}. Nice work!</p>
    </div>
  </section>`);
  return {
    el,
    enter() {
      document.body.className = 'quiz-page theme-good';
      const first = firstTime(`${S.q}:${S.startAt}`);
      setStress(Math.min(stress(), 55));
      if (!first) return;
      chime();
      later(() => { setStress(Math.max(8, stress() - 30), 'good'); sparkle($('.big-tick', el)); }, 350);
      anim($('.gain', el), [{ opacity: 0, transform: 'translateY(10px) scale(.8)' }, { opacity: 1, transform: 'scale(1.15)' }, { transform: 'none' }],
        { duration: 600, delay: 400, easing: 'ease-out', fill: 'backwards' });
    },
  };
}

function reveal() {
  if (S.me.choice == null) return revealBad(true);
  return S.me.correct ? revealGood() : revealBad(false);
}

function final() {
  const r = S.me.rank, medal = ['🥇', '🥈', '🥉'][r - 1];
  const el = h(`<section class="screen card-neutral center done">
    <div class="big-emoji" aria-hidden="true">${medal || esc(S.me.avatar)}</div>
    <h1>${medal ? 'On the podium!' : 'Thanks for playing!'}</h1>
    <p class="reveal-text">You finished <b>${ordinal(r)}</b> of ${S.players} with ${fmt(S.me.score)} points.</p>
    <p class="hint">Look at the big screen for the final podium.</p>
  </section>`);
  return {
    el,
    enter() {
      document.body.className = 'quiz-page theme-good';
      setStress(8, 'good');
      if (medal && firstTime('final:' + S.startAt)) { chime(); later(() => sparkle($('.big-emoji', el), 40), 300); }
    },
  };
}

const SCREENS = { loading, joining, lobby, ready, question, waiting, timeup, reveal, final };

let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, ms));

setupJoin();
setStress(stress());
render('loading');
poll();
setInterval(tick, 200);
