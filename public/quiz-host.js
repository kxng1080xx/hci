'use strict';
// Quiz dialog on the projector page. Uses $, reduced, adminKey and session from results.js.
// Add ?quiz=<url> to the results URL to show a custom short link for the quiz.

(() => {
  const dlg = $('quiz'), body = $('qd-body'), nextBtn = $('qd-next'), endBtn = $('qd-end'), status = $('qd-status');
  const SHAPES = ['▲', '◆', '●', '■'];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fmt = (n) => n.toLocaleString('en');
  const quizUrl = new URLSearchParams(location.search).get('quiz') || location.origin + '/quiz';

  let S = null, offset = 0, key = '', view = null, pollTimer = null, tickTimer = null, seen = new Set();

  async function poll() {
    clearTimeout(pollTimer);
    const t0 = Date.now();
    try {
      const res = await fetch('/api/quiz', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      S = await res.json();
      offset = S.now - (t0 + Date.now()) / 2;
      if (status.textContent === 'Reconnecting…') status.textContent = '';
      tick();
    } catch {
      status.textContent = 'Reconnecting…';
    }
    if (dlg.open) pollTimer = setTimeout(poll, 1000);
  }

  function phaseNow() {
    const t = Date.now() + offset;
    if (S.phase === 'ready' && t >= S.startAt) return 'question';
    if (S.phase === 'question' && t >= S.endsAt) return 'timeup';
    return S.phase;
  }

  function tick() {
    if (!S) return;
    const phase = phaseNow();
    const k = phase + ':' + S.q + ':' + S.startAt;
    if (k !== key) {
      key = k;
      view = VIEWS[phase]();
      body.replaceChildren(view.el);
    }
    view.update?.();
    controls(phase);
  }

  function controls(phase) {
    $('qd-phase').textContent = {
      lobby: `Lobby · ${S.players} joined`, final: 'Final results',
    }[phase] || `Question ${S.q + 1} of ${S.total}`;
    const last = S.q >= S.total - 1;
    nextBtn.hidden = phase === 'final';
    nextBtn.textContent = phase === 'lobby' ? 'Start quiz' : phase === 'reveal' && last ? 'Show podium' : 'Next question';
    nextBtn.disabled = phase !== 'lobby' && phase !== 'reveal';
    endBtn.hidden = !(phase === 'ready' || phase === 'question' || phase === 'timeup');
  }

  /* ---------- Views ---------- */

  function lobby() {
    const el = document.createElement('div');
    el.className = 'qd-lobby';
    el.innerHTML = `<div class="qd-join">
        <p class="sub">Join the quiz at</p>
        <p class="big">${esc(quizUrl.replace(/^https?:\/\//, ''))}</p>
        ${window.qrcode ? '<div class="qr" role="img" aria-label="QR code for the quiz link"></div>' : ''}
      </div>
      <div>
        <p class="big-count"><span class="n">0</span> <span class="sub">players</span></p>
        <div class="roster"></div>
      </div>`;
    if (window.qrcode) {
      const qr = qrcode(0, 'M');
      qr.addData(quizUrl);
      qr.make();
      $$('.qr', el)[0].innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    }
    let rkey = '';
    return {
      el,
      update() {
        $$('.n', el)[0].textContent = S.players;
        const k = S.roster.map((p) => p.nickname + p.avatar).join('|');
        if (k === rkey) return;
        rkey = k;
        $$('.roster', el)[0].replaceChildren(...S.roster.map((p) => {
          const id = p.avatar + p.nickname;
          const d = document.createElement('span');
          d.className = 'pl' + (seen.has(id) ? ' old' : '');
          d.innerHTML = `<span class="av" aria-hidden="true">${esc(p.avatar)}</span>`;
          d.append(p.nickname);
          seen.add(id);
          return d;
        }));
      },
    };
  }

  const head = () => `<p class="qd-eyebrow">Question ${S.q + 1} of ${S.total}</p><h3>${esc(S.question.text)}</h3>`;
  const tiles = (extra = () => '') => `<div class="qd-tiles">${S.question.options.map((o, i) =>
    `<div class="qd-tile t${i}"><span class="fillbar"></span><span class="shape" aria-hidden="true">${SHAPES[i]}</span><span class="txt">${esc(o)}</span>${extra(i)}</div>`).join('')}</div>`;

  function ready() {
    const el = document.createElement('div');
    el.className = 'qd-body-inner';
    el.style.cssText = 'display:grid;gap:22px';
    el.innerHTML = `${head()}<div class="qd-count"></div>`;
    const num = el.querySelector('.qd-count');
    return {
      el,
      update() {
        const n = Math.max(1, Math.ceil((S.startAt - Date.now() - offset) / 1000));
        if (num.textContent === String(n)) return;
        num.textContent = n;
        if (!reduced) num.animate([{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 400, easing: 'cubic-bezier(.2,.8,.2,1)' });
      },
    };
  }

  function question(timeup) {
    const el = document.createElement('div');
    el.style.cssText = 'display:grid;gap:18px';
    el.innerHTML = `${head()}
      <div class="qd-timer"><span></span></div>
      <div class="qd-meta"><span><b class="secs"></b> ${timeup ? '' : 'left'}</span><span><b class="ans"></b> answered</span></div>
      ${tiles()}`;
    const bar = el.querySelector('.qd-timer span');
    return {
      el,
      update() {
        const left = Math.max(0, S.endsAt - Date.now() - offset);
        bar.style.width = (left / S.limit) * 100 + '%';
        bar.classList.toggle('low', left < 5000);
        el.querySelector('.secs').textContent = left ? Math.ceil(left / 1000) + 's' : "Time's up!";
        el.querySelector('.ans').textContent = `${S.answered} / ${S.players}`;
      },
    };
  }

  function board(list, from = 0) {
    return `<ol class="board">${list.map((p, i) =>
      `<li style="animation-delay:${i * 80}ms"><span class="pos">${from + i + 1}</span><span class="av" aria-hidden="true">${esc(p.avatar)}</span><span class="nm">${esc(p.nickname)}</span><span class="sc">${fmt(p.score)}${p.gained ? `<small>+${fmt(p.gained)}</small>` : ''}</span></li>`).join('')}</ol>`;
  }

  function reveal() {
    const el = document.createElement('div');
    el.className = 'qd-reveal';
    const total = S.counts.reduce((a, b) => a + b, 0);
    el.innerHTML = `<div>${head()}
        ${tiles((i) => `${i === S.correct ? '<span class="check" aria-label="Correct answer">✓</span>' : ''}<span class="n">${S.counts[i]}</span>`)}
        <p class="qd-why">${esc(S.why)}</p>
      </div>
      <div><p class="qd-eyebrow">Leaderboard</p>${S.leaders.length ? board(S.leaders.slice(0, 5)) : '<p class="empty">No players yet.</p>'}</div>`;
    const tileEls = [...el.querySelectorAll('.qd-tile')];
    // Show the spread first, then reveal which one was right.
    requestAnimationFrame(() => tileEls.forEach((t, i) => {
      t.querySelector('.fillbar').style.width = total ? (S.counts[i] / total) * 100 + '%' : '0';
    }));
    setTimeout(() => tileEls.forEach((t, i) => t.classList.add(i === S.correct ? 'right' : 'wrong')), reduced ? 0 : 900);
    return { el };
  }

  function final() {
    const el = document.createElement('div');
    el.style.cssText = 'display:grid;gap:24px';
    const [p1, p2, p3] = S.leaders;
    const step = (p, n) => `<div class="step p${n}">${p ? `<div class="who"><span class="av" aria-hidden="true">${esc(p.avatar)}</span><span class="nm">${esc(p.nickname)}</span><span class="sc">${fmt(p.score)} pts</span></div>` : ''}<div class="block">${n}</div></div>`;
    el.innerHTML = `<div class="podium">${step(p2, 2)}${step(p1, 1)}${step(p3, 3)}</div>
      ${S.leaders.length > 3 ? `<div class="qd-rest">${board(S.leaders.slice(3), 3)}</div>` : ''}`;
    return { el };
  }

  const VIEWS = { lobby, ready, question: () => question(false), timeup: () => question(true), reveal, final };

  /* ---------- Host controls ---------- */

  async function send(action, extra = {}) {
    if (!adminKey) {
      adminKey = prompt('Admin key (needed to run the quiz)') || '';
      session.set(adminKey);
      if (!adminKey) return false;
    }
    const res = await fetch('/api/quiz/control', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ action, ...extra }),
    }).catch(() => null);
    if (res?.status === 403) { adminKey = ''; session.set(''); status.textContent = 'Wrong admin key'; return false; }
    if (!res?.ok) { status.textContent = 'Could not reach the server. Try again.'; return false; }
    status.textContent = '';
    await poll();
    return true;
  }

  nextBtn.onclick = async () => {
    if (!S) return;
    nextBtn.disabled = true;
    await send('next', { from: S.q });
    tick();
  };
  endBtn.onclick = () => send('close');
  $('qd-reset').onclick = () => {
    if (confirm('Reset the quiz? This removes every player and score.')) { seen = new Set(); send('reset'); }
  };

  $('quiz-open').onclick = () => {
    dlg.showModal();
    key = '';
    poll();
    tickTimer = setInterval(tick, 200);
  };
  $('qd-x').onclick = () => dlg.close();
  dlg.addEventListener('close', () => { clearTimeout(pollTimer); clearInterval(tickTimer); });

  function $$(sel, root) { return [...root.querySelectorAll(sel)]; }
})();
