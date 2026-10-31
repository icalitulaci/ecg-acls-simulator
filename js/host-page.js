// The instructor's controller: pick rhythms, adjust vitals, run scenarios.
import { Link } from './link.js';
import { MonitorView } from './monitor-view.js';
import { RHYTHMS, RHYTHM_MAP, GROUPS, ECTOPY, defaultPulse } from './rhythms.js';
import { defaultState, sanitize, cloneState, diffCount, PRESETS, applyPreset, TRENDS, NUM_KEYS } from './state.js';
import { fmtCode, load, store, icon, requestFullscreen, exitFullscreen, fullscreenElement } from './util.js';
import { startQuiz, quizCounts, resetQuiz } from './quiz.js';

const AUTOSEND_KEY = 'acls-monsim.autosend';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const HR_RANGE = [20, 300]; // the HR slider covers this for every rhythm
const SINUS = { sbrady: 'sinus bradycardia', nsr: 'normal sinus rhythm', stach: 'sinus tachycardia' };
const sinusName = (hr) => (hr < 60 ? 'sinus bradycardia' : hr > 100 ? 'sinus tachycardia' : 'normal sinus rhythm');

// ---------------------------------------------------------------- connect screen

export function renderConnect(root, { onConnect, onBack }) {
  root.innerHTML = `
    <main class="page connect">
      <button type="button" class="link-btn back">${icon('back')} Back</button>
      <div class="connect-card">
        <div class="connect-icon">${icon('phone')}</div>
        <h1>Controller</h1>
        <p class="muted">Enter the 6-digit pairing code shown on the monitor screen.</p>
        <form class="code-form">
          <input class="code-input" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="000 000" aria-label="Pairing code">
          <button class="btn primary big" type="submit">Connect</button>
        </form>
        <p class="form-error" hidden>Codes are 6 digits.</p>
      </div>
    </main>`;
  const input = root.querySelector('.code-input');
  const err = root.querySelector('.form-error');
  const go = (c) => {
    if (!/^\d{6}$/.test(c)) {
      err.hidden = false;
      input.focus();
      return;
    }
    onConnect(c);
  };
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '').slice(0, 6);
    input.value = d.length > 3 ? fmtCode(d) : d;
    err.hidden = true;
    if (d.length === 6) go(d);
  });
  root.querySelector('.code-form').addEventListener('submit', (e) => {
    e.preventDefault();
    go(input.value.replace(/\D/g, ''));
  });
  root.querySelector('.back').addEventListener('click', onBack);
  setTimeout(() => input.focus(), 50);
}

// ---------------------------------------------------------------- controller

const VITAL_ROWS = [
  { key: 'hr', label: 'Heart rate', unit: 'bpm', show: 'ecg', on: 'Leads on', off: 'Leads off', step: 1 },
  { key: 'spo2', label: 'SpO₂', unit: '%', show: 'spo2', on: 'Probe on', off: 'Probe off', min: 50, max: 100, step: 1 },
  { key: 'bp', label: 'Blood pressure', unit: 'mmHg', show: 'nibp', on: 'Cuff on', off: 'Cuff off' },
  { key: 'rr', label: 'Resp rate', unit: '/min', show: 'co2', on: 'Capno on', off: 'Capno off', min: 0, max: 50, step: 1 },
  { key: 'etco2', label: 'EtCO₂', unit: 'mmHg', show: 'co2', on: 'Capno on', off: 'Capno off', min: 0, max: 80, step: 1 },
  { key: 'temp', label: 'Temperature', unit: '°C', show: 'temp', on: 'Probe on', off: 'Probe off', min: 32, max: 42, step: 0.1 },
];
const BP = { sys: { min: 40, max: 240 }, dia: { min: 20, max: 150 } };

function sliderHtml(key, label) {
  return `
    <div class="vrow-ctl" data-key="${key}">
      ${label ? `<span class="ctl-label">${label}</span>` : ''}
      <button type="button" class="step" data-d="-1" aria-label="Decrease ${label || key}">−</button>
      <input type="range" aria-label="${label || key}">
      <button type="button" class="step" data-d="1" aria-label="Increase ${label || key}">+</button>
    </div>`;
}

function vitalRowHtml(r) {
  const controls = r.key === 'bp' ? sliderHtml('sys', 'SYS') + sliderHtml('dia', 'DIA') : sliderHtml(r.key, '');
  const extra = r.key === 'bp' ? `<button type="button" class="pill action cycle">${icon('cuff')} Cycle NIBP</button>` : '';
  return `
    <div class="vrow" data-row="${r.key}">
      <div class="vrow-top">
        <span class="vrow-label">${r.label}</span>
        <span class="vrow-val"><b></b><small>${r.unit}</small></span>
        <span class="vrow-btns">${extra}<button type="button" class="pill show" data-show="${r.show}"></button></span>
      </div>
      ${controls}
      <div class="vrow-note" hidden></div>
    </div>`;
}

const HOST_HEADER = `
    <header class="host-bar">
      <button type="button" class="icon-btn" data-act="exit" aria-label="Disconnect">${icon('back')}</button>
      <div class="host-title">
        <div class="host-name">Controller</div>
        <div class="host-code">Code <b></b></div>
      </div>
      <div class="host-conn">
        <div class="conn-line conn-relay"><span class="dot"></span><span class="txt">Connecting…</span></div>
        <div class="conn-line conn-mon"><span class="dot"></span><span class="txt">Waiting for monitor…</span></div>
      </div>
    </header>
    <div class="conn-hint" role="status" hidden></div>`;

const SOLO_HEADER = `
    <header class="host-bar">
      <button type="button" class="icon-btn" data-act="exit" aria-label="Back to start">${icon('back')}</button>
      <div class="host-title">
        <div class="host-name">Solo practice</div>
        <div class="host-code">This device only, no pairing</div>
      </div>
      <button type="button" class="btn primary quiz-btn" data-act="quiz">${icon('cards')} Quiz</button>
    </header>`;

const HOST_PREVIEW = `
        <section class="card preview-card">
          <div class="card-head"><h2>Live monitor</h2><span class="card-tags"><span class="trend-tag" hidden></span><span class="live-tag">LIVE</span></span></div>
          <div class="preview"></div>
          <div class="preview-rhythm"></div>
        </section>`;

// Solo: no rhythm name under the monitor, so it can be used for practice.
const SOLO_PREVIEW = `
        <section class="card preview-card">
          <div class="card-head"><h2>Monitor</h2><span class="card-tags"><span class="trend-tag" hidden></span><button type="button" class="pill action" data-act="full">${icon('fullscreen')} Full screen</button></span></div>
          <div class="solo-stage"><div class="preview"></div></div>
        </section>
        <section class="card quiz-card">
          <div class="card-head"><h2>Rhythm quiz</h2><small class="muted">Flashcards, Anki-style</small></div>
          <p class="quiz-intro">A random rhythm fills the screen with no labels. Name it, reveal the answer, then rate yourself. Rhythms you miss come back sooner.</p>
          <div class="quiz-stats"><span><b class="qs-new"></b> new</span><span><b class="qs-learn"></b> learning</span><span><b class="qs-due"></b> due</span></div>
          <div class="quiz-actions">
            <button type="button" class="btn primary big" data-act="quiz">Start quiz</button>
            <button type="button" class="link-btn" data-act="quiz-reset">Reset progress</button>
          </div>
        </section>`;

const controllerTemplate = (solo) => `
  <div class="host${solo ? ' solo' : ''}">
    ${solo ? SOLO_HEADER : HOST_HEADER}
    <div class="host-grid">
      <div class="col">
        ${solo ? SOLO_PREVIEW : HOST_PREVIEW}
        <section class="card">
          <div class="card-head"><h2>Rhythm</h2></div>
          <div class="rhythm-current"></div>
          <div class="rhythm-groups"></div>
          <div class="rhythm-opts">
            <label class="switch-row pulse-row">
              <span><b>Palpable pulse</b><small class="pulse-note"></small></span>
              <input type="checkbox" class="sw pulse">
            </label>
            <div class="ectopy-row"><span class="opt-label">PVCs</span><div class="seg ectopy"></div></div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Scenarios</h2><small class="muted">Sets rhythm and all vitals</small></div>
          <div class="presets"></div>
        </section>
      </div>
      <div class="col">
        <section class="card">
          <div class="card-head"><h2>Vital signs</h2></div>
          <div class="vitals">${VITAL_ROWS.map(vitalRowHtml).join('')}</div>
          <div class="trend-row">
            <span class="opt-label">Change vitals over</span>
            <div class="seg trend"></div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Settings</h2></div>
          <label class="switch-row"><span><b>Live updates</b><small>Off: prepare changes first, then tap ${solo ? 'Apply' : 'Send'}</small></span><input type="checkbox" class="sw autosend"></label>
          <label class="switch-row"><span><b>QRS beep</b><small>Pitch drops as SpO₂ falls</small></span><input type="checkbox" class="sw beep"></label>
          <label class="switch-row"><span><b>Alarm sounds</b></span><input type="checkbox" class="sw alarmsnd"></label>
          <label class="switch-row"><span><b>Alarms</b><small>Banner, flashing numbers and tones</small></span><input type="checkbox" class="sw alarms"></label>
        </section>
        <p class="fine">Training simulator only. Not a medical device.</p>
      </div>
    </div>
    <div class="send-bar" hidden>
      <span class="send-count"></span>
      <button type="button" class="btn ghost" data-act="discard">Discard</button>
      <button type="button" class="btn primary" data-act="send">${solo ? 'Apply' : 'Send to monitor'}</button>
    </div>
  </div>`;

export function startHost(root, code, opts) {
  return startController(root, { ...opts, code });
}

export function startSolo(root, opts) {
  return startController(root, { ...opts, solo: true });
}

function startController(root, { code = '', solo = false, audio = null, onExit }) {
  root.innerHTML = controllerTemplate(solo);
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  if (!solo) $('.host-code b').textContent = fmtCode(code);

  let live = defaultState(); // what the monitor shows (last sent / adopted)
  let draft = cloneState(live); // what the controls show
  let maxRev = 0;
  let autoSend = load(AUTOSEND_KEY) !== '0';
  let commitTimer = null;
  let trendEnd = 0;
  let lastResend = 0;
  const connectedAt = Date.now();
  const monitors = new Map();

  // In solo mode this device is the monitor too, so it plays the sounds.
  const preview = new MonitorView($('.preview'), { compact: true, audio: solo ? audio : null });
  preview.applyState(cloneState(live));

  const link = solo ? null : new Link(code, { onMessage, onStatus: renderConn, onConnect: () => ping() });
  link?.subscribe('state');
  link?.subscribe('mon');
  const ping = () => link?.publish('host', { id: link.id, rev: live.rev });
  const pingTimer = solo ? null : setInterval(ping, 3000);

  // ---- sync logic

  const nextRev = () => (maxRev = Math.max(Date.now(), maxRev + 1));

  function publish() {
    link?.publish('state', live, true);
    preview.applyState(cloneState(live));
    renderAll();
  }

  function commit() {
    clearTimeout(commitTimer);
    commitTimer = null;
    const prev = live;
    live = cloneState(draft);
    live.rev = draft.rev = nextRev();
    const numChanged = NUM_KEYS.some((k) => prev[k] !== live[k]);
    if (numChanged) trendEnd = live.trend > 0 ? Date.now() + live.trend * 1000 : 0;
    publish();
  }

  // Settings that always go out immediately, even with staged changes pending.
  function pushNow(mutate) {
    mutate(draft);
    live = cloneState(live);
    mutate(live);
    live.rev = draft.rev = nextRev();
    publish();
  }

  function adopt(s) {
    maxRev = Math.max(maxRev, s.rev);
    if (s.rev <= live.rev) return;
    const pending = diffCount(draft, live) > 0;
    live = s;
    if (!pending) draft = cloneState(s);
    else Object.assign(draft, { rev: s.rev, nibp: s.nibp, alarms: s.alarms, sound: { ...s.sound } });
    preview.applyState(cloneState(live));
    renderAll();
  }

  function onMessage(kind, data) {
    if (kind === 'state') {
      const s = sanitize(data);
      if (s) adopt(s);
    } else if (kind === 'mon') {
      if (!data || typeof data.id !== 'string') return;
      const rev = typeof data.rev === 'number' ? data.rev : 0;
      monitors.set(data.id.slice(0, 32), { seen: Date.now(), rev });
      const s = data.state ? sanitize(data.state) : null;
      if (s) adopt(s);
      const now = Date.now();
      if (live.rev > 0 && rev < live.rev && now - lastResend > 1000) {
        lastResend = now;
        link.publish('state', live, true);
      } else if (live.rev === 0 && rev === 0 && now - connectedAt > 1500) {
        // Fresh monitor and nothing set yet: start it with the current state.
        live.rev = draft.rev = nextRev();
        publish();
      }
      renderConn();
    }
  }

  function changed(throttle = false) {
    if (autoSend) {
      if (throttle) {
        if (!commitTimer) commitTimer = setTimeout(commit, 120);
      } else commit();
    }
    renderAll();
  }

  function flush() {
    if (autoSend && commitTimer) commit();
  }

  // ---- build dynamic controls

  const groupsEl = $('.rhythm-groups');
  for (const g of GROUPS) {
    const wrap = document.createElement('div');
    wrap.className = `rgroup g-${g.id}`;
    const h = document.createElement('div');
    h.className = 'rgroup-name';
    h.textContent = g.name;
    const list = document.createElement('div');
    list.className = 'chips';
    for (const r of RHYTHMS.filter((x) => x.group === g.id)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip rhythm';
      b.dataset.id = r.id;
      b.textContent = r.short;
      b.title = r.name;
      list.append(b);
    }
    wrap.append(h, list);
    groupsEl.append(wrap);
  }
  groupsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.chip.rhythm');
    if (!b) return;
    const R = RHYTHM_MAP[b.dataset.id];
    if (draft.rhythm === R.id) return;
    draft.rhythm = R.id;
    if (R.hr && (draft.hr < R.hr[0] || draft.hr > R.hr[1])) draft.hr = R.def;
    draft.pulse = defaultPulse(R.id);
    if (!R.ectopy) draft.ectopy = 'none';
    changed();
  });

  function buildSeg(el, items, onPick) {
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.v = String(it.v);
      b.textContent = it.label;
      el.append(b);
    }
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) onPick(b.dataset.v);
    });
  }
  buildSeg($('.seg.ectopy'), ECTOPY.map((e) => ({ v: e.id, label: e.name })), (v) => {
    draft.ectopy = v;
    changed();
  });
  buildSeg($('.seg.trend'), TRENDS.map((t) => ({ v: t.s, label: t.label })), (v) => {
    draft.trend = live.trend = Number(v);
    renderAll();
  });

  $('.sw.pulse').addEventListener('change', (e) => {
    draft.pulse = e.target.checked;
    changed();
  });

  const presetsEl = $('.presets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `preset tone-${p.tone}`;
    b.dataset.id = p.id;
    const n = document.createElement('b');
    n.textContent = p.name;
    const s = document.createElement('small');
    s.textContent = p.note;
    b.append(n, s);
    presetsEl.append(b);
  }
  presetsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.preset');
    if (!b) return;
    draft = applyPreset(draft, PRESETS.find((p) => p.id === b.dataset.id));
    changed();
    b.classList.add('flash');
    setTimeout(() => b.classList.remove('flash'), 400);
  });

  // Vital sliders and steppers
  function limits(key) {
    if (key === 'hr') return { min: HR_RANGE[0], max: HR_RANGE[1], step: 1 };
    if (key === 'sys' || key === 'dia') return { ...BP[key], step: 1 };
    const r = VITAL_ROWS.find((x) => x.key === key);
    return { min: r.min, max: r.max, step: r.step };
  }

  function setValue(key, v) {
    const L = limits(key);
    v = clamp(Math.round(v / L.step) * L.step, L.min, L.max);
    if (L.step < 1) v = Math.round(v * 10) / 10;
    draft[key] = v;
    if (key === 'sys' && draft.dia > v - 10) draft.dia = Math.max(BP.dia.min, v - 10);
    if (key === 'dia' && draft.sys < v + 10) draft.sys = Math.min(BP.sys.max, v + 10);
  }

  for (const ctl of $$('.vrow-ctl')) {
    const key = ctl.dataset.key;
    const range = ctl.querySelector('input');
    range.addEventListener('input', () => {
      setValue(key, Number(range.value));
      changed(true);
    });
    range.addEventListener('change', flush);
    for (const btn of ctl.querySelectorAll('.step')) {
      const d = Number(btn.dataset.d);
      const bump = () => {
        setValue(key, draft[key] + d * limits(key).step);
        changed(true);
      };
      let hold, rep;
      const stop = () => {
        clearTimeout(hold);
        clearInterval(rep);
        flush();
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        bump();
        hold = setTimeout(() => (rep = setInterval(bump, 70)), 400);
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
      btn.addEventListener('click', (e) => {
        if (e.detail === 0) {
          bump(); // keyboard
          flush();
        }
      });
    }
  }

  $('.vitals').addEventListener('click', (e) => {
    const show = e.target.closest('.pill.show');
    if (show) {
      const k = show.dataset.show;
      draft.show[k] = !draft.show[k];
      changed();
      return;
    }
    if (e.target.closest('.pill.cycle')) {
      // Run a cuff measurement now, with the BP currently set on the controller.
      live = cloneState(live);
      live.sys = draft.sys;
      live.dia = draft.dia;
      live.show.nibp = draft.show.nibp = true;
      live.nibp = draft.nibp = live.nibp + 1;
      live.rev = draft.rev = nextRev();
      publish();
    }
  });

  // Settings
  $('.sw.autosend').addEventListener('change', (e) => {
    autoSend = e.target.checked;
    store(AUTOSEND_KEY, autoSend ? '1' : '0');
    if (autoSend && diffCount(draft, live) > 0) commit();
    renderAll();
  });
  $('.sw.beep').addEventListener('change', (e) => pushNow((s) => (s.sound.beep = e.target.checked)));
  $('.sw.alarmsnd').addEventListener('change', (e) => pushNow((s) => (s.sound.alarm = e.target.checked)));
  $('.sw.alarms').addEventListener('change', (e) => pushNow((s) => (s.alarms = e.target.checked)));

  root.querySelector('.host').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'exit') onExit();
    else if (act === 'quiz') openQuiz();
    else if (act === 'full') enterFull();
    else if (act === 'quiz-reset') {
      if (confirm('Reset all quiz progress on this device?')) {
        resetQuiz();
        renderQuizStats();
      }
    } else if (act === 'send') commit();
    else if (act === 'discard') {
      draft = cloneState(live);
      renderAll();
    }
  });

  // ---- rendering

  function renderAll() {
    const R = RHYTHM_MAP[draft.rhythm];
    const staged = !autoSend;

    $('.rhythm-current').textContent = R.name;
    for (const b of $$('.chip.rhythm')) {
      b.classList.toggle('on', b.dataset.id === draft.rhythm);
      b.classList.toggle('is-live', staged && b.dataset.id === live.rhythm && live.rhythm !== draft.rhythm);
    }
    const pulse = $('.sw.pulse');
    pulse.checked = draft.pulse;
    pulse.disabled = !!R.locked;
    $('.pulse-row').classList.toggle('disabled', !!R.locked);
    $('.pulse-note').textContent = R.locked
      ? 'Never palpable in this rhythm'
      : draft.pulse
        ? 'Pleth, SpO₂ and BP readings shown'
        : 'Pulseless: no pleth, SpO₂ or BP reading';
    $('.ectopy-row').hidden = !R.ectopy;
    for (const b of $$('.seg.ectopy button')) b.classList.toggle('on', b.dataset.v === draft.ectopy);
    for (const b of $$('.seg.trend button')) b.classList.toggle('on', Number(b.dataset.v) === draft.trend);

    for (const ctl of $$('.vrow-ctl')) {
      const key = ctl.dataset.key;
      const L = limits(key);
      const range = ctl.querySelector('input');
      range.min = L.min;
      range.max = L.max;
      range.step = L.step;
      range.value = draft[key];
    }
    for (const row of $$('.vrow')) {
      const k = row.dataset.row;
      const vb = row.querySelector('.vrow-val b');
      let note = '';
      if (k === 'bp') vb.textContent = `${draft.sys}/${draft.dia}`;
      else if (k === 'temp') vb.textContent = draft.temp.toFixed(1);
      else vb.textContent = String(draft[k]);
      const showKey = row.querySelector('.pill.show').dataset.show;
      const cfg = VITAL_ROWS.find((x) => x.key === k);
      const pill = row.querySelector('.pill.show');
      pill.textContent = draft.show[showKey] ? cfg.on : cfg.off;
      pill.classList.toggle('off', !draft.show[showKey]);
      pill.setAttribute('aria-pressed', String(draft.show[showKey]));
      let disabled = false;
      if (k === 'hr' && !R.hr) {
        disabled = true;
        note = 'No countable rate in this rhythm. The monitor shows ---.';
      } else if (k === 'hr' && draft.rhythm === 'aflutter') {
        note = `Ventricular rate, conducted ${clamp(Math.round(300 / draft.hr), 1, 8)}:1.`;
      } else if (k === 'hr' && (draft.rhythm === 'avb3' || draft.rhythm === 'avb2i' || draft.rhythm === 'avb2ii')) {
        note = 'Ventricular rate. P waves run faster.';
      } else if (k === 'hr' && SINUS[draft.rhythm] && sinusName(draft.hr) !== SINUS[draft.rhythm]) {
        note = `At ${draft.hr} bpm this reads as ${sinusName(draft.hr)}.`;
      } else if (k === 'hr' && R.hr && (draft.hr < R.hr[0] || draft.hr > R.hr[1])) {
        note = `Outside the usual ${R.hr[0]}–${R.hr[1]} bpm for ${R.short}.`;
      }
      if ((k === 'spo2' || k === 'bp') && !draft.pulse) note = 'No pulse: the monitor shows --- for this.';
      row.classList.toggle('disabled', disabled);
      for (const el of row.querySelectorAll('input, .step')) el.disabled = disabled;
      const ne = row.querySelector('.vrow-note');
      ne.hidden = !note;
      ne.textContent = note;
      const differs = staged && (k === 'bp' ? draft.sys !== live.sys || draft.dia !== live.dia : draft[k] !== live[k]);
      row.classList.toggle('staged', differs);
    }

    $('.sw.autosend').checked = autoSend;
    $('.sw.beep').checked = draft.sound.beep;
    $('.sw.alarmsnd').checked = draft.sound.alarm;
    $('.sw.alarms').checked = draft.alarms;

    const n = diffCount(draft, live);
    $('.send-bar').hidden = autoSend || n === 0;
    $('.send-count').textContent = `${n} change${n === 1 ? '' : 's'} ready`;
    root.querySelector('.host').classList.toggle('has-send-bar', !autoSend && n > 0);

    if (!solo) {
      const LR = RHYTHM_MAP[live.rhythm];
      $('.preview-rhythm').textContent = `${LR.name}${LR.hr ? ` · ${live.hr} bpm` : ''} · ${live.pulse ? 'pulse' : 'no pulse'}`;
    }
    renderConn();
  }

  function renderTrend(now) {
    const tag = $('.trend-tag');
    const left = Math.ceil((trendEnd - now) / 1000);
    tag.hidden = !(left > 0);
    if (left > 0) tag.textContent = `Trending ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }

  function renderConn() {
    if (solo) {
      renderTrend(Date.now());
      return;
    }
    const { up } = link.status();
    const relay = $('.conn-line.conn-relay');
    const now = Date.now();
    let cls, txt;
    if (up > 0) [cls, txt] = ['ok', `Online (${up} relay${up === 1 ? '' : 's'})`];
    else if (now - connectedAt < 7000) [cls, txt] = ['wait', 'Connecting…'];
    else [cls, txt] = ['bad', 'Offline: check internet'];
    relay.className = `conn-line conn-relay ${cls}`;
    relay.querySelector('.txt').textContent = txt;

    const active = [...monitors.values()].filter((m) => now - m.seen < 8000);
    const mon = $('.conn-line.conn-mon');
    if (!active.length) [cls, txt] = ['wait', 'Waiting for monitor…'];
    else {
      const synced = active.every((m) => m.rev >= live.rev);
      cls = synced ? 'ok' : 'wait';
      txt = `${active.length > 1 ? `${active.length} monitors` : 'Monitor'} ${synced ? 'connected ✓' : 'updating…'}`;
    }
    mon.className = `conn-line conn-mon ${cls}`;
    mon.querySelector('.txt').textContent = txt;

    // After a while with nobody answering, explain what to check.
    const hint = $('.conn-hint');
    let msg = '';
    if (!active.length && now - connectedAt > 10000) {
      msg = up > 0
        ? `No monitor is answering on code ${fmtCode(code)}. Check this matches the code on the monitor screen (it gets a new code each time Monitor is opened). If it does, the two devices may be on networks that block different relay servers: try putting both on the same Wi-Fi or a phone hotspot.`
        : "This phone can't reach the relay servers. Check its internet connection, or switch between Wi-Fi and mobile data.";
    }
    hint.hidden = !msg;
    if (hint.textContent !== msg) hint.textContent = msg;
    renderTrend(now);
  }
  const connTimer = setInterval(() => {
    // A waiting monitor and no state found on the relay: start it with the current state.
    const now = Date.now();
    if (!solo && live.rev === 0 && now - connectedAt > 1500 && [...monitors.values()].some((m) => m.rev === 0 && now - m.seen < 8000)) {
      live.rev = draft.rev = nextRev();
      publish();
    }
    renderConn();
  }, 1000);

  // ---- solo: full-screen monitor and quiz

  const stage = $('.solo-stage');
  let closeQuiz = null;
  let wentNative = false;

  function enterFull() {
    if (!stage) return;
    audio?.unlock();
    stage.classList.add('is-full');
    document.body.classList.add('quiz-open');
    preview.setCompact(false);
    wentNative = false;
    requestFullscreen(stage);
  }

  function exitFull() {
    if (!stage?.classList.contains('is-full')) return;
    stage.classList.remove('is-full');
    document.body.classList.remove('quiz-open');
    preview.setCompact(true);
    if (fullscreenElement() === stage) exitFullscreen();
  }

  const onFsChange = () => {
    if (!stage) return;
    if (fullscreenElement() === stage) wentNative = true;
    else if (wentNative) exitFull(); // left browser fullscreen with Esc / system gesture
  };
  const onKeyFull = (e) => {
    if (e.key === 'Escape' && stage?.classList.contains('is-full') && !fullscreenElement()) exitFull();
  };

  function renderQuizStats() {
    if (!solo) return;
    const c = quizCounts();
    $('.qs-new').textContent = c.fresh;
    $('.qs-learn').textContent = c.learning;
    $('.qs-due').textContent = c.due;
  }

  function openQuiz() {
    if (closeQuiz) return;
    exitFull();
    audio?.unlock();
    preview.stop(); // only one monitor beeping at a time
    closeQuiz = startQuiz({
      audio,
      beep: draft.sound.beep,
      onClose: () => {
        closeQuiz = null;
        preview.start();
        renderQuizStats();
      },
    });
  }

  if (solo) {
    preview.el.extra.innerHTML = `<button type="button" class="mon-btn" data-act="unfull" title="Exit full screen">${icon('close')}<span>Exit full screen</span></button>`;
    preview.el.extra.querySelector('[data-act="unfull"]').addEventListener('click', exitFull);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('keydown', onKeyFull);
    root.addEventListener('pointerdown', () => audio?.unlock());
    renderQuizStats();
  }

  renderAll();

  return () => {
    clearInterval(connTimer);
    if (pingTimer) clearInterval(pingTimer);
    clearTimeout(commitTimer);
    closeQuiz?.();
    exitFull();
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    document.removeEventListener('keydown', onKeyFull);
    link?.close();
    preview.destroy();
  };
}
