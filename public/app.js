'use strict';
// Participant app. Nothing typed into the fake sign-up or payment forms ever leaves the phone:
// those inputs have no names, no form action, and are never read by send().

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// Web Animations with a reduced-motion fallback: a short fade by default, or nothing when fallback is null.
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

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const ROUNDS = {
  1: { design: 'bad', task: 'signup' },
  2: { design: 'bad', task: 'payment' },
  3: { design: 'good', task: 'signup' },
  4: { design: 'good', task: 'payment' },
};
const STEPS = ['welcome', 'r1', 'f1', 'r2', 'f2', 'switch', 'r3', 'f3', 'r4', 'f4', 'done'];
const WORDS = ['Frustrated', 'Confused', 'Anxious', 'Blamed', 'Annoyed', 'Calm', 'Helped', 'In control'];
const POSITIVE = ['Calm', 'Helped', 'In control'];
const FACES = ['😡', '😟', '😐', '🙂', '😌'];
const FACE_LABELS = ['Very negative', 'Negative', 'Neutral', 'Positive', 'Very positive'];
const TASK_TEXT = {
  signup: 'Create an account with username: <b>student</b> and password: <b>hello123</b>',
  payment: 'Pay <b>J$2,500</b> for a concert ticket. Use card <b>4000&nbsp;0000&nbsp;0000&nbsp;0002</b>, expiry <b>12/28</b>, CVV <b>123</b>.',
};

// crypto.randomUUID needs HTTPS; getRandomValues also works over plain http on the local network.
const pid = store.get('hci_pid') || (() => {
  const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  store.set('hci_pid', id);
  return id;
})();

let state = store.get('hci_state', {});
if (!STEPS.includes(state.step)) state = { step: 'welcome', stress: 25 };
const save = () => store.set('hci_state', state);

/* ---------- Network: queue in localStorage so answers survive flaky classroom Wi-Fi ---------- */

let flushing = false;
function send(url, body) {
  store.set('hci_queue', [...store.get('hci_queue', []), { url, body }]);
  flush();
}
async function flush() {
  if (flushing) return;
  flushing = true;
  let item;
  while ((item = store.get('hci_queue', [])[0])) {
    try {
      const res = await fetch(item.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item.body) });
      if (res.status === 429 || res.status >= 500) break; // retry later; 4xx means the data is invalid, so drop it
    } catch { break; }
    store.set('hci_queue', store.get('hci_queue', []).slice(1)); // server upserts, so a duplicate send is harmless
  }
  flushing = false;
  if (store.get('hci_queue', []).length) setTimeout(flush, 5000);
}

/* ---------- Screen plumbing ---------- */

let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, ms));
let round = null;

function go(step) {
  state.step = step;
  save();
  render();
}

function render() {
  timers.forEach(clearTimeout);
  timers = [];
  const step = state.step;
  const kind = { r: 'round', f: 'feel' }[step[0]] || step;
  const n = +step.slice(1) || 0;

  document.body.className = kind === 'round' ? `theme-${ROUNDS[n].design}` : 'theme-neutral';
  $('.topbar').hidden = !n;
  $('.stress').hidden = kind !== 'round';
  $$('.progress li').forEach((li, i) => {
    li.classList.toggle('done', i + 1 < n || (kind === 'feel' && i + 1 === n));
    if (i + 1 === n) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });

  const screen = kind === 'round' ? ROUND_SCREENS[n](n) : SCREENS[kind](n);
  const app = $('#app');
  app.replaceChildren(screen);
  if (kind !== 'switch') {
    anim(screen, [{ transform: 'translateX(100%)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

const taskBox = (n) => `<div class="task"><span class="task-label">Round ${n} of 4 · Your task</span><p>${TASK_TEXT[ROUNDS[n].task]}</p></div>`;
const skipLink = '<p class="skip" hidden><a href="#">Skip to next step</a></p>';

function startRound(n, screen) {
  round = { n, attempts: 0, start: Date.now(), end: 0, skipped: false };
  const skip = $('.skip', screen);
  const showSkip = () => {
    if (!skip.hidden) return;
    skip.hidden = false;
    anim(skip, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  };
  later(showSkip, 90_000);
  $('a', skip).onclick = (e) => {
    e.preventDefault();
    round.skipped = true;
    finishRound();
  };
  return showSkip;
}

function finishRound() {
  const seconds = Math.round(((round.end || Date.now()) - round.start) / 1000);
  state.metrics = { round: round.n, attempts: round.attempts, seconds: Math.min(seconds, 3600), skipped: round.skipped };
  go('f' + round.n);
}

/* ---------- Stress meter ---------- */

function setStress(level, mode) {
  level = Math.max(5, Math.min(100, level));
  state.stress = level;
  save();
  const fill = $('.stress-fill');
  fill.style.transition = mode === 'good' ? 'width 1.4s cubic-bezier(.2,.8,.2,1), background-color 1.4s ease' : 'none';
  fill.style.width = level + '%';
  fill.style.backgroundColor = `hsl(${120 - level * 1.2} 85% 42%)`; // green -> yellow -> red
  $('.stress-face').textContent = level > 75 ? '😡' : level > 50 ? '😟' : level > 30 ? '😐' : '😌';
  if (mode === 'bad') {
    anim($('.stress'), [{ transform: 'scale(1)' }, { transform: 'scale(1.5) rotate(-8deg)' }, { transform: 'scale(.9) rotate(5deg)' }, { transform: 'scale(1)' }],
      { duration: 350, easing: 'linear' }, null);
  }
}
const bumpStress = (delta, mode) => setStress(state.stress + delta, mode);

/* ---------- BAD design effects ---------- */

let audio;
// Must run inside the tap handler, or iOS keeps the audio context locked for the later beep.
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

function punish() {
  beep();
  anim($('.flash'), [{ opacity: 0 }, { opacity: 0.5 }, { opacity: 0 }], { duration: 300, easing: 'linear' }, null);
  anim($('#app'), [0, -16, 16, -14, 14, -9, 9, -4, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 450, easing: 'linear' }, null);
}

// A fake "processing" spinner that hangs, then vanishes with no transition.
async function hang(screen) {
  const el = $('.hang', screen);
  el.hidden = false;
  await sleep(2000 + Math.random() * 1000);
  el.hidden = true;
}

// Strike the typed text through, then erase it character by character so the user watches it go.
async function wipe(inputs) {
  inputs = inputs.filter((i) => i.value);
  if (reduced.matches) { inputs.forEach((i) => (i.value = '')); return; }
  inputs.forEach((i) => i.classList.add('struck'));
  await sleep(450);
  const longest = Math.max(0, ...inputs.map((i) => i.value.length));
  for (let k = 0; k < longest; k++) {
    inputs.forEach((i) => (i.value = i.value.slice(0, -1)));
    await sleep(45);
  }
  inputs.forEach((i) => i.classList.remove('struck'));
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

/* ---------- Round 1: sign up, BAD ---------- */

function roundBadSignup(n) {
  const s = h(`<section class="screen">
    ${taskBox(n)}
    <div class="win95 app95">
      <div class="win-title"><span>NewUserRegistration.exe</span><span aria-hidden="true">_ □ ✕</span></div>
      <form class="win-body" novalidate autocomplete="off">
        <label>USERNAME:<input autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <label>PASSWORD:<input type="password" autocomplete="off"></label>
        <label>CONFIRM PASSWORD:<input type="password" autocomplete="off"></label>
        <button class="btn95">SUBMIT</button>
      </form>
      <div class="hang" hidden><span class="hourglass"></span>PLEASE WAIT...</div>
    </div>
    ${skipLink}
  </section>`);
  const showSkip = startRound(n, s);
  setStress(state.stress);
  const form = $('form', s), inputs = $$('input', form), modal = $('#bad-modal');
  let busy = false;

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    unlockAudio();
    round.attempts++;
    inputs.forEach((i) => (i.readOnly = true));
    await hang(s);
    punish();
    bumpStress(28, 'bad');
    modal.showModal();
    slamIn(modal);
    await new Promise((r) => modal.addEventListener('close', r, { once: true }));
    await wipe(inputs);
    inputs.forEach((i) => (i.readOnly = false));
    if (round.attempts >= 3) showSkip();
    busy = false;
  };
  return s;
}

/* ---------- Round 2: payment, BAD ---------- */

function roundBadPayment(n) {
  const s = h(`<section class="screen">
    ${taskBox(n)}
    <div class="gateway">
      <div class="gw-head">SECURE PAYMENT GATEWAY v2.1</div>
      <div class="banner-bad" role="alert" hidden>
        <p>TRANSACTION FAILED. ERROR 51. CONTACT YOUR ADMINISTRATOR.</p>
        <p class="extra" hidden>Do not refresh this page.</p>
      </div>
      <form novalidate autocomplete="off">
        <p class="gw-amount">AMOUNT DUE: J$2,500.00</p>
        <label>CARD NO.<input inputmode="numeric" autocomplete="off"></label>
        <div class="gw-row">
          <label>EXP<input autocomplete="off"></label>
          <label>CVV<input inputmode="numeric" autocomplete="off"></label>
        </div>
        <button class="btn-gw">PROCESS</button>
      </form>
      <div class="hang" hidden><span class="hourglass"></span>PROCESSING... DO NOT PRESS BACK</div>
    </div>
    ${skipLink}
  </section>`);
  const showSkip = startRound(n, s);
  setStress(state.stress);
  const form = $('form', s), inputs = $$('input', form), banner = $('.banner-bad', s);
  let busy = false;

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    unlockAudio();
    round.attempts++;
    inputs.forEach((i) => (i.readOnly = true));
    banner.hidden = true;
    await hang(s);
    banner.hidden = false;
    $('.extra', banner).hidden = round.attempts < 2;
    slamIn(banner);
    punish();
    bumpStress(28, 'bad');
    await wipe(inputs);
    inputs.forEach((i) => (i.readOnly = false));
    if (round.attempts >= 3) showSkip();
    busy = false;
  };
  return s;
}

/* ---------- GOOD design helpers ---------- */

const TICK = '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// kind: 'error' | 'ok' | ''. Messages live in aria-live regions and slide in beside their field.
function setMsg(field, text, kind) {
  const msg = $('.msg', field), input = $('input', field);
  const wasValid = field.classList.contains('valid');
  field.classList.toggle('invalid', kind === 'error');
  field.classList.toggle('valid', kind === 'ok');
  input.setAttribute('aria-invalid', String(kind === 'error'));
  if (kind === 'ok' && !wasValid) bumpStress(-10, 'good');
  if (msg.textContent === text) return;
  msg.textContent = text;
  if (text) anim(msg, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 250, easing: 'ease-out' });
}

function succeed(box, text) {
  round.end = Date.now();
  box.innerHTML = `<svg class="big-tick" viewBox="0 0 52 52" aria-hidden="true"><circle pathLength="1" cx="26" cy="26" r="23"/><path pathLength="1" d="M15 27l7 7 15-15"/></svg><p></p>`;
  $('p', box).textContent = text;
  const btn = h('<button class="btn primary" type="button">Continue</button>');
  btn.onclick = finishRound;
  box.append(btn);
  anim(box, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'ease-out' });
  sparkle($('.big-tick', box));
  setStress(8, 'good');
  later(() => btn.focus(), 700);
}

function sparkle(anchor) {
  if (reduced.matches) return;
  const r = anchor.getBoundingClientRect();
  const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#14b8a6'];
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('span');
    p.className = 'confetti';
    p.style.left = r.left + r.width / 2 + 'px';
    p.style.top = r.top + r.height / 2 + 'px';
    p.style.background = colors[i % colors.length];
    document.body.append(p);
    const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 90;
    p.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) rotate(${Math.random() * 360}deg) scale(.5)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => p.remove();
  }
}

function field(id, label, attrs = '', before = '', after = '') {
  return `<div class="field">
    <label for="${id}">${label}</label>
    ${before}
    <div class="input-wrap"><input id="${id}" autocomplete="off" aria-describedby="${id}-hint ${id}-msg" ${attrs}>${TICK}</div>
    <p class="msg" id="${id}-msg" aria-live="polite"></p>
    ${after}
  </div>`;
}

/* ---------- Round 3: sign up, GOOD ---------- */

const TAKEN = ['student', 'admin', 'test'];
function checkUser(v) {
  v = v.trim();
  if (!v) return ['error', 'Please choose a username.'];
  if (TAKEN.includes(v.toLowerCase())) return ['error', `Sorry, '${v}' is already taken. Try ${v}27 or ${v}_ja.`, [v + '27', v + '_ja']];
  if (v.length < 3) return ['error', `Usernames need at least 3 characters. You have ${v.length}.`];
  if (!/^[\w.-]+$/.test(v)) return ['error', 'Sorry, use only letters, numbers, dots, dashes or underscores.'];
  return ['ok', 'Great, that username is free.'];
}
function checkPass(v) {
  const len = v.length, num = /\d/.test(v);
  if (len >= 8 && num) return ['ok', 'That password works.'];
  if (len >= 8) return ['error', `Use at least 8 characters. You have ${len}, now add a number.`];
  if (num) return ['error', `Use at least 8 characters. You have ${len}, so add ${8 - len} more.`];
  return ['error', `Use at least 8 characters, including one number. You have ${len} so far.`];
}

function roundGoodSignup(n) {
  const s = h(`<section class="screen">
    ${taskBox(n)}
    <form class="card-good" novalidate autocomplete="off">
      <h2>Create your account</h2>
      ${field('g-user', 'Username', 'autocapitalize="off" autocorrect="off" spellcheck="false"', '', '<div class="suggest"></div>')}
      ${field('g-pass', 'Password', 'type="password"', '<p class="hint" id="g-pass-hint">At least 8 characters, including one number.</p>')}
      <button class="btn primary">Create account</button>
      <div class="success" role="status"></div>
    </form>
    ${skipLink}
  </section>`);
  startRound(n, s);
  setStress(state.stress);
  later(() => setStress(55, 'good'), 500);

  const form = $('form', s);
  const [userF, passF] = $$('.field', form);
  const user = $('input', userF), pass = $('input', passF);
  pass.closest('.input-wrap').insertAdjacentHTML('beforeend', '<button type="button" class="reveal" aria-pressed="false">Show</button>');
  const reveal = $('.reveal', passF);
  reveal.onclick = () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    reveal.textContent = show ? 'Hide' : 'Show';
    reveal.setAttribute('aria-pressed', String(show));
  };

  const suggest = $('.suggest', userF);
  function validateUser(force) {
    if (!force && !user.value.trim()) return true;
    const [kind, text, names = []] = checkUser(user.value);
    setMsg(userF, text, kind);
    if (suggest.dataset.names !== names.join()) {
      suggest.dataset.names = names.join();
      suggest.replaceChildren(...names.map((name, i) => {
        const b = h(`<button type="button" class="chip-suggest"></button>`);
        b.textContent = name;
        b.setAttribute('aria-label', `Use ${name}`);
        b.onclick = () => { user.value = name; validateUser(true); pass.focus(); };
        anim(b, [0, -9, 0, -3, 0].map((y) => ({ transform: `translateY(${y}px)` })),
          { duration: 700, delay: 250 + i * 120, easing: 'ease-out' }, null);
        return b;
      }));
    }
    return kind === 'ok';
  }
  function validatePass(force) {
    if (!force && !pass.value) return true;
    const [kind, text] = checkPass(pass.value);
    setMsg(passF, text, kind);
    return kind === 'ok';
  }
  let debounce;
  user.oninput = () => { clearTimeout(debounce); debounce = setTimeout(validateUser, 350); };
  pass.oninput = () => validatePass();

  form.onsubmit = (e) => {
    e.preventDefault();
    if (round.end) return;
    round.attempts++;
    const okUser = validateUser(true), okPass = validatePass(true);
    if (!okUser || !okPass) {
      bumpStress(5, 'good');
      (okUser ? pass : user).focus();
      return;
    }
    user.readOnly = pass.readOnly = true;
    $('button.primary', form).hidden = true;
    suggest.replaceChildren();
    succeed($('.success', form), `Your account is ready. Welcome, ${user.value.trim()}!`);
  };
  return s;
}

/* ---------- Round 4: payment, GOOD ---------- */

const CHECKS = {
  'g-card': (v) => v.replace(/\D/g, '').length === 16 ? ['ok', ''] : ['error', `Card numbers have 16 digits. You have ${v.replace(/\D/g, '').length}.`],
  'g-exp': (v) => /^(0[1-9]|1[0-2])\/\d{2}$/.test(v) ? ['ok', ''] : ['error', 'Please use the format MM/YY, for example 12/28.'],
  'g-cvv': (v) => /^\d{3,4}$/.test(v) ? ['ok', ''] : ['error', 'The CVV is the 3 digits on the back of your card.'],
};
const FORMAT = {
  'g-card': (v) => v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 '),
  'g-exp': (v) => { const d = v.replace(/\D/g, '').slice(0, 4); return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; },
  'g-cvv': (v) => v.replace(/\D/g, '').slice(0, 4),
};

function roundGoodPayment(n) {
  const s = h(`<section class="screen">
    ${taskBox(n)}
    <form class="card-good" novalidate autocomplete="off">
      <h2>Checkout</h2>
      <div class="order"><span>Concert ticket × 1</span><strong>J$2,500</strong></div>
      ${field('g-card', 'Card number', 'inputmode="numeric" placeholder="1234 5678 9012 3456"')}
      <div class="row">
        ${field('g-exp', 'Expiry', 'inputmode="numeric" placeholder="MM/YY"')}
        ${field('g-cvv', 'CVV', 'inputmode="numeric" placeholder="123"')}
      </div>
      <button class="btn primary">Pay J$2,500</button>
      <div class="processing" role="status" hidden><span class="spinner-calm"></span>Checking with your bank…</div>
      <div class="decline-area" aria-live="polite"></div>
      <div class="success" role="status"></div>
    </form>
    ${skipLink}
  </section>`);
  startRound(n, s);
  setStress(state.stress);
  later(() => setStress(40, 'good'), 500);

  const form = $('form', s), fields = $$('.field', form), payBtn = $('button.primary', form);
  const area = $('.decline-area', form), card = $('#g-card', form);
  let revealed = false, busy = false;

  const check = (f, force) => {
    const input = $('input', f);
    if (!force && !input.value) return false;
    const [kind, text] = CHECKS[input.id](input.value);
    // While typing, only confirm success or clear an old error; full errors wait for blur or submit.
    if (force || kind === 'ok' || f.classList.contains('invalid')) setMsg(f, text, kind);
    return kind === 'ok';
  };
  for (const f of fields) {
    const input = $('input', f);
    input.oninput = () => { input.value = FORMAT[input.id](input.value); check(f); };
    input.onblur = () => input.value && check(f, true);
  }

  function decline() {
    area.innerHTML = `<div class="notice-amber">
      <div class="shield"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l7.5 3v5.8c0 4.6-3.2 8.6-7.5 10.2-4.3-1.6-7.5-5.6-7.5-10.2V5.5z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg><span>Not charged</span></div>
      <p>Sorry, your card was declined, and you have not been charged. This usually means the bank blocked it or funds are low. Check your card details, or try another card.</p>
      <button type="button" class="btn secondary">Use another card</button>
      <p class="demo-hint" hidden>For this demo, use <b>4242&nbsp;4242&nbsp;4242&nbsp;4242</b>.</p>
    </div>`;
    const notice = $('.notice-amber', area), another = $('.btn', area), hint = $('.demo-hint', area);
    anim(notice, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 250, easing: 'ease-out' });
    anim($('.shield', area), [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 200, easing: 'ease-out', fill: 'backwards' });
    anim(another, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 350, delay: 450, easing: 'ease-out', fill: 'backwards' });
    fields[0].classList.remove('valid');
    fields[0].classList.add('invalid'); // soft amber glow on the card field only
    notice.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth' });
    card.setAttribute('aria-invalid', 'true');
    const showHint = () => {
      hint.hidden = false;
      another.hidden = true;
      anim(hint, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 250, easing: 'ease-out' });
    };
    if (revealed) showHint();
    another.onclick = () => {
      revealed = true;
      showHint();
      card.value = '';
      fields[0].classList.remove('valid', 'invalid');
      card.focus();
      bumpStress(-10, 'good');
    };
    bumpStress(6, 'good');
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy || round.end) return;
    round.attempts++;
    const bad = fields.filter((f) => !check(f, true));
    if (bad.length) { $('input', bad[0]).focus(); return; }
    busy = true;
    payBtn.disabled = true;
    area.replaceChildren();
    $('.processing', form).hidden = false;
    await sleep(900);
    $('.processing', form).hidden = true;
    payBtn.disabled = false;
    busy = false;
    if (card.value.replace(/\D/g, '') !== '4242424242424242') return decline();
    area.replaceChildren();
    payBtn.hidden = true;
    fields.forEach((f) => ($('input', f).readOnly = true));
    succeed($('.success', form), 'Payment complete. J$2,500 paid, and your ticket is on its way. Enjoy the concert!');
  };
  return s;
}

const ROUND_SCREENS = { 1: roundBadSignup, 2: roundBadPayment, 3: roundGoodSignup, 4: roundGoodPayment };

/* ---------- Welcome, feelings, interstitial, done ---------- */

function welcome() {
  const s = h(`<section class="screen card-neutral">
    <p class="eyebrow">Live class demo</p>
    <h1>How do error messages make you feel?</h1>
    <p>You'll complete 4 quick tasks. After each one, tell us how you felt.</p>
    <div>
      <label for="nick" class="lbl">Nickname (optional)</label>
      <input id="nick" class="text" maxlength="20" autocomplete="off">
    </div>
    <p class="hint">Your answers are anonymous. Nothing you type into the tasks is ever sent or saved.</p>
    <button class="btn primary" type="button">Start</button>
  </section>`);
  const nick = $('#nick', s);
  nick.value = state.nickname || '';
  $('button', s).onclick = () => {
    state.nickname = nick.value.trim().slice(0, 20);
    state.stress = 25;
    send('/api/join', { pid, nickname: state.nickname });
    go('r1');
  };
  return s;
}

function feel(n) {
  const s = h(`<section class="screen card-neutral feel">
    <p class="eyebrow">Round ${n} of 4 complete</p>
    <fieldset>
      <legend>How did that error make you feel?</legend>
      <div class="emojis">
        ${FACES.map((f, i) => `<label class="emo"><input type="radio" name="feel" value="${i + 1}" aria-label="${i + 1}: ${FACE_LABELS[i]}"><span class="emo-face" aria-hidden="true">${f}</span></label>`).join('')}
      </div>
      <div class="scale-ends" aria-hidden="true"><span>Very negative</span><span>Very positive</span></div>
    </fieldset>
    <fieldset>
      <legend class="sub">Which words fit?</legend>
      <div class="chips">
        ${WORDS.map((w) => `<label class="chip" data-tone="${POSITIVE.includes(w) ? 'pos' : 'neg'}"><input type="checkbox" value="${w}"><span>${w}</span></label>`).join('')}
      </div>
    </fieldset>
    <div>
      <label for="comment" class="lbl">One word or sentence (optional)</label>
      <input id="comment" class="text" maxlength="80" autocomplete="off">
    </div>
    <button class="btn primary" type="button" disabled aria-describedby="need">Submit</button>
    <p class="hint center" id="need">Pick a face to continue.</p>
  </section>`);
  const submit = $('.btn', s);

  s.addEventListener('change', (e) => {
    if (e.target.name !== 'feel') return;
    submit.disabled = false;
    $('#need', s).hidden = true;
    anim(e.target.nextElementSibling, [
      { transform: 'scale(1)' }, { transform: 'scale(1.45) rotate(-10deg)' }, { transform: 'scale(1.3) rotate(7deg)' },
      { transform: 'scale(1.3) rotate(-3deg)' }, { transform: 'scale(1.3)' },
    ], { duration: 500, easing: 'ease-out' }, null);
  });

  submit.onclick = () => {
    const picked = $('input[name=feel]:checked', s);
    const m = state.metrics?.round === n ? state.metrics : { attempts: 0, seconds: 0, skipped: false };
    send('/api/response', {
      pid, round: n, design: ROUNDS[n].design, task: ROUNDS[n].task,
      feeling: +picked.value,
      words: $$('.chips input:checked', s).map((i) => i.value),
      comment: $('#comment', s).value.trim().slice(0, 80),
      attempts: m.attempts, seconds: m.seconds, skipped: m.skipped,
    });
    floatUp(picked.nextElementSibling);
    go(n === 2 ? 'switch' : n === 4 ? 'done' : 'r' + (n + 1));
  };
  return s;
}

// Like a reaction on a video call: the chosen emoji drifts up and fades out.
function floatUp(face) {
  if (reduced.matches) return;
  const r = face.getBoundingClientRect();
  const el = h(`<span class="floater" aria-hidden="true">${face.textContent}</span>`);
  el.style.left = r.left + 'px';
  el.style.top = r.top + 'px';
  document.body.append(el);
  el.animate([
    { transform: 'translateY(0) scale(1.3)', opacity: 1 },
    { transform: 'translateY(-60px) scale(1.8) rotate(-8deg)', opacity: 1, offset: 0.3 },
    { transform: 'translateY(-260px) scale(2.2) rotate(6deg)', opacity: 0 },
  ], { duration: 1400, easing: 'ease-out' }).onfinish = () => el.remove();
}

function interstitial() {
  const s = h(`<section class="switch">
    <div class="glitch-layer" aria-hidden="true">
      <div class="glitch" data-text="ERROR 51">ERROR 51</div>
      <svg class="crack" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path pathLength="1" d="M52 0 L47 17 L56 29 L44 46 L54 61 L46 79 L51 100"/>
        <path pathLength="1" d="M47 17 L29 24 L10 19 L0 23"/>
        <path pathLength="1" d="M44 46 L68 52 L88 43 L100 47"/>
        <path pathLength="1" d="M54 61 L31 71 L12 68 L0 74"/>
      </svg>
    </div>
    <div class="calm">
      <div class="calm-inner">
        <h1>Now let's try that again, with better design.</h1>
        <p>Same two tasks. Different error messages.</p>
        <button class="btn primary" type="button">Continue</button>
      </div>
    </div>
  </section>`);
  $('button', s).onclick = () => go('r3');
  return s;
}

function done() {
  const s = h(`<section class="screen card-neutral done">
    <div class="big-emoji" aria-hidden="true">🙏</div>
    <h1>Thank you!</h1>
    <p class="reveal-text">Rounds 1 and 2 used poor error design. Rounds 3 and 4 used good error design. Look at the screen to see how the class felt.</p>
    <button class="linklike" type="button">Start again</button>
  </section>`);
  anim($('.reveal-text', s), [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
    { duration: 600, delay: 500, easing: 'ease-out', fill: 'backwards' });
  $('.linklike', s).onclick = () => {
    state = { step: 'welcome', stress: 25, nickname: state.nickname };
    save();
    render();
  };
  return s;
}

const SCREENS = { welcome, feel, switch: interstitial, done };

flush();
render();
