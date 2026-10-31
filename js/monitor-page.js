// The device that shows the patient monitor. It generates a pairing code, waits for a
// controller, then renders whatever state the controller sends.
import { Link, randomId } from './link.js';
import { MonitorView } from './monitor-view.js';
import { sanitize } from './state.js';
import { qrSvg } from './qr.js';
import { fmtCode, load, store, controllerUrl, icon } from './util.js';

const CODE_KEY = 'acls-monsim.monitor-code';

function newCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}

export function startMonitor(root, { audio, onExit }) {
  root.innerHTML = `
    <div class="monitor-page">
      <div class="mon-host"></div>
      <div class="sound-hint" hidden>${icon('soundOff')} Tap anywhere to enable sound</div>
      <div class="pair" hidden>
        <div class="pair-card">
          <div class="pair-brand">${icon('ecg')} ACLS Monitor Simulator</div>
          <h1>Pair the instructor's phone</h1>
          <div class="pair-main">
            <div class="pair-qr"></div>
            <div class="pair-info">
              <div class="pair-label">Pairing code</div>
              <div class="pair-code"></div>
              <ol class="pair-steps">
                <li>On the instructor's phone, scan the QR code, or open <b class="pair-url"></b> and tap <b>Controller</b>.</li>
                <li>Enter the code above. The monitor starts as soon as the phone connects.</li>
              </ol>
              <div class="pair-status"><span class="dot"></span><span class="txt">Connecting…</span></div>
            </div>
          </div>
          <form class="pair-join" hidden>
            <input inputmode="numeric" autocomplete="off" maxlength="7" placeholder="6-digit code" aria-label="Existing pairing code">
            <button type="submit" class="btn primary">Join</button>
          </form>
          <div class="pair-actions">
            <button type="button" class="btn primary" data-act="close" hidden>Back to monitor</button>
            <button type="button" class="btn ghost" data-act="new">New code</button>
            <button type="button" class="btn ghost" data-act="join">Join an existing code</button>
            <button type="button" class="btn ghost" data-act="exit">Exit</button>
          </div>
        </div>
      </div>
    </div>`;

  const page = root.querySelector('.monitor-page');
  const pair = root.querySelector('.pair');
  const soundHint = root.querySelector('.sound-hint');
  const view = new MonitorView(root.querySelector('.mon-host'), { audio });

  view.el.extra.innerHTML = `
    <button type="button" class="mon-btn code" title="Pairing code"></button>
    <span class="mon-link" title="Relay connection"><span class="dot"></span></span>
    <button type="button" class="mon-btn sound" title="Sound"></button>
    <button type="button" class="mon-btn fs" title="Full screen">${icon('fullscreen')}</button>
    <button type="button" class="mon-btn exit" title="Exit monitor">${icon('close')}</button>`;
  const btnCode = view.el.extra.querySelector('.code');
  const btnSound = view.el.extra.querySelector('.sound');
  const btnFs = view.el.extra.querySelector('.fs');
  const linkDot = view.el.extra.querySelector('.mon-link');
  const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  if (!fsSupported) btnFs.hidden = true;

  const monId = randomId(8);
  let code = load(CODE_KEY);
  let link = null;
  let applied = null;
  let appliedRev = 0;
  let startedAt = Date.now();

  function connect(c, clear) {
    link?.close();
    code = c;
    store(CODE_KEY, c);
    applied = null;
    appliedRev = 0;
    startedAt = Date.now();
    link = new Link(c, { onMessage, onStatus: renderStatus });
    link.subscribe('state');
    // A brand-new code: wipe any stale retained state another session may have left.
    if (clear) link.publish('state', null, true);
    btnCode.textContent = `#${c}`;
    root.querySelector('.pair-code').textContent = fmtCode(c);
    const url = controllerUrl(c);
    root.querySelector('.pair-url').textContent = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
    root.querySelector('.pair-qr').innerHTML = qrSvg(url);
    renderStatus();
    heartbeat();
  }

  function onMessage(kind, data) {
    if (kind !== 'state') return;
    const s = sanitize(data);
    if (!s || s.rev <= appliedRev) return;
    appliedRev = s.rev;
    applied = s;
    view.applyState(s);
    showPair(false);
    heartbeat();
  }

  // Lets the controller know we're here and which state we're showing.
  function heartbeat() {
    link?.publish('mon', { id: monId, rev: appliedRev, state: applied });
  }
  const hbTimer = setInterval(heartbeat, 3000);

  function renderStatus() {
    if (!link) return;
    const { up } = link.status();
    const st = root.querySelector('.pair-status');
    const txt = st.querySelector('.txt');
    let cls, msg;
    if (up > 0) {
      cls = 'ok';
      msg = 'Online, waiting for the controller…';
    } else if (Date.now() - startedAt < 7000) {
      cls = 'wait';
      msg = 'Connecting to relay…';
    } else {
      cls = 'bad';
      msg = "Can't reach the relay servers. Check this device's internet connection.";
    }
    st.className = `pair-status ${cls}`;
    txt.textContent = msg;
    linkDot.className = `mon-link ${cls}`;
  }
  const statusTimer = setInterval(renderStatus, 2000);

  function showPair(on) {
    pair.hidden = !on;
    root.querySelector('[data-act="close"]').hidden = !applied;
    if (!on) root.querySelector('.pair-join').hidden = true;
  }

  function renderSound() {
    const ready = audio.ready;
    btnSound.innerHTML = icon(ready ? 'soundOn' : 'soundOff');
    btnSound.classList.toggle('muted', !ready);
    soundHint.hidden = ready;
  }
  const offAudio = audio.onChange(renderSound);

  // Any tap unlocks audio (browsers require a gesture).
  const onFirstTap = () => {
    audio.unlock();
    renderSound();
  };
  page.addEventListener('pointerdown', onFirstTap);

  btnSound.addEventListener('click', () => {
    audio.unlock();
    renderSound();
  });
  btnCode.addEventListener('click', () => showPair(true));
  btnFs.addEventListener('click', () => {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else {
      const el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    }
  });
  view.el.extra.querySelector('.exit').addEventListener('click', () => {
    if (confirm('Leave monitor mode?')) onExit();
  });

  pair.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') showPair(false);
    else if (act === 'new') connect(newCode(), true);
    else if (act === 'join') {
      const f = root.querySelector('.pair-join');
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector('input').focus();
    } else if (act === 'exit') onExit();
  });
  root.querySelector('.pair-join').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const c = input.value.replace(/\D/g, '');
    if (c.length !== 6) {
      input.focus();
      return;
    }
    input.value = '';
    connect(c, false);
    showPair(true);
  });

  // Keep the screen awake while the monitor is up.
  let wakeLock = null;
  async function requestWake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      /* not supported / denied */
    }
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') requestWake();
  };
  document.addEventListener('visibilitychange', onVisible);
  requestWake();

  // Hide the cursor and the corner buttons when idle.
  let idleTimer;
  const wake = () => {
    page.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => page.classList.add('idle'), 3500);
  };
  page.addEventListener('pointermove', wake);
  page.addEventListener('pointerdown', wake);
  wake();

  const fresh = !/^\d{6}$/.test(code || '');
  connect(fresh ? newCode() : code, fresh);
  showPair(true);
  renderSound();

  return () => {
    clearInterval(hbTimer);
    clearInterval(statusTimer);
    clearTimeout(idleTimer);
    offAudio();
    document.removeEventListener('visibilitychange', onVisible);
    try {
      wakeLock?.release();
    } catch {
      /* ignore */
    }
    link?.close();
    view.destroy();
  };
}
