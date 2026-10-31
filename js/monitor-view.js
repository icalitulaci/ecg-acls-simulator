// Patient-monitor renderer. Used full-screen on the monitor device and as a compact live
// preview on the controller.
import { PatientSignal } from './signal.js';
import { RHYTHM_MAP } from './rhythms.js';
import { NUM_KEYS } from './state.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const SAMPLE_DT = 1 / 500;

const TEMPLATE = `
  <div class="mon-top">
    <div class="mon-id"><span class="mon-tag">ADULT</span><span class="mon-sim">SIM</span></div>
    <div class="mon-alarm" role="status" aria-live="polite"></div>
    <div class="mon-right"><span class="mon-clock"></span><span class="mon-extra"></span></div>
  </div>
  <div class="mon-body">
    <div class="mon-waves">
      <div class="wave ecg"><canvas></canvas><div class="wave-label">II <small>x1</small></div><div class="wave-msg"></div></div>
      <div class="wave pleth"><canvas></canvas><div class="wave-label">Pleth</div><div class="wave-msg"></div></div>
      <div class="wave co2"><canvas></canvas><div class="wave-label">CO₂</div><div class="wave-scale"><span class="hi">50</span><span>0</span></div><div class="wave-msg"></div></div>
    </div>
    <div class="mon-nums">
      <div class="num hr">
        <div class="num-head"><span class="num-label">HR</span><span class="num-unit">bpm</span></div>
        <div class="num-lim">120<br>50</div>
        <span class="num-heart" aria-hidden="true">♥</span>
        <div class="num-val">---</div>
      </div>
      <div class="num spo2">
        <div class="num-head"><span class="num-label">SpO₂</span><span class="num-unit">%</span></div>
        <div class="num-lim">100<br>90</div>
        <div class="num-val">---</div>
        <div class="num-sub">PR <b class="pr">---</b></div>
      </div>
      <div class="num nibp">
        <div class="num-head"><span class="num-label">NIBP</span><span class="num-unit">mmHg</span><span class="num-time"></span></div>
        <div class="num-val">---/---</div>
        <div class="num-sub map">(---)</div>
      </div>
      <div class="num co2">
        <div class="num-head"><span class="num-label">EtCO₂</span><span class="num-unit">mmHg</span></div>
        <div class="num-val">---</div>
        <div class="num-sub">awRR <b class="awrr">---</b></div>
      </div>
      <div class="num temp">
        <div class="num-head"><span class="num-label">Temp</span><span class="num-unit">°C</span></div>
        <div class="num-val">--.-</div>
      </div>
    </div>
  </div>`;

class Sweep {
  constructor(canvas, opt) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = opt.color;
    this.sample = opt.sample;
    this.map = opt.map;
    this.lw = opt.lw || 2;
    this.gap = opt.gap || 14;
    this.w = 0;
    this.h = 0;
    this.t = null;
    this.reset();
  }

  reset() {
    this.abs = 0;
    this.clearAbs = 0;
    this.py = null;
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.c.width = Math.max(1, Math.round(w * dpr));
    this.c.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    const secs = clamp(w / 125, 3, 8); // ≈ 25 mm/s on typical screens
    this.pxs = w / secs;
    this.reset();
  }

  clearRange(a, b) {
    const W = this.w, H = this.h;
    if (b - a >= W) {
      this.ctx.clearRect(0, 0, W, H);
      return;
    }
    const s = a % W, e = s + (b - a);
    const x0 = Math.floor(s);
    if (e <= W) this.ctx.clearRect(x0, 0, Math.ceil(e) - x0 + 1, H);
    else {
      this.ctx.clearRect(x0, 0, W - x0, H);
      this.ctx.clearRect(0, 0, Math.ceil(e - W) + 1, H);
    }
  }

  advance(from, to) {
    if (this.t == null || this.t < from) this.t = from;
    const n = Math.floor((to - this.t) / SAMPLE_DT);
    if (n <= 0) return;
    const W = this.w, H = this.h;
    if (W < 4 || H < 4) {
      for (let i = 0; i < n; i++) this.sample((this.t += SAMPLE_DT));
      return;
    }
    const ctx = this.ctx;
    const step = SAMPLE_DT * this.pxs;
    const end = this.abs + n * step;
    if (end + this.gap > this.clearAbs) {
      this.clearRange(this.clearAbs, end + this.gap);
      this.clearAbs = end + this.gap;
    }
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.lw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let x = this.abs % W;
    if (this.py != null) ctx.moveTo(x, this.py);
    for (let i = 0; i < n; i++) {
      this.t += SAMPLE_DT;
      const y = clamp(this.map(this.sample(this.t)), 0.015, 0.985) * H;
      this.abs += step;
      const nx = this.abs % W;
      if (this.py == null || nx < x) ctx.moveTo(nx, y);
      else ctx.lineTo(nx, y);
      x = nx;
      this.py = y;
    }
    ctx.stroke();
  }
}

function setText(el, txt) {
  if (el && el.textContent !== txt) el.textContent = txt;
}

export class MonitorView {
  constructor(root, { compact = false, audio = null } = {}) {
    this.root = root;
    this.compact = compact;
    this.audio = audio;
    this.sig = new PatientSignal();
    this.state = null;
    this.cur = {};
    this.tr = {};
    this.hrJitter = 0;
    this.alarmList = [];
    this.alarmIdx = 0;
    this.lastAlarmSound = -100;
    this.lastAlarmTop = 0;
    this.cuff = null;
    this.nibpTime = null;

    root.classList.add('mon');
    if (compact) root.classList.add('compact');
    root.innerHTML = TEMPLATE;
    const q = (s) => root.querySelector(s);
    this.el = {
      alarm: q('.mon-alarm'),
      clock: q('.mon-clock'),
      extra: q('.mon-extra'),
      ecgMsg: q('.wave.ecg .wave-msg'),
      plMsg: q('.wave.pleth .wave-msg'),
      co2Msg: q('.wave.co2 .wave-msg'),
      co2Hi: q('.wave-scale .hi'),
      hr: q('.num.hr'),
      hrVal: q('.num.hr .num-val'),
      heart: q('.num-heart'),
      spo2: q('.num.spo2'),
      spo2Val: q('.num.spo2 .num-val'),
      pr: q('.num.spo2 .pr'),
      nibp: q('.num.nibp'),
      nibpVal: q('.num.nibp .num-val'),
      nibpMap: q('.num.nibp .map'),
      nibpTime: q('.num.nibp .num-time'),
      co2: q('.num.co2'),
      co2Val: q('.num.co2 .num-val'),
      awrr: q('.num.co2 .awrr'),
      temp: q('.num.temp'),
      tempVal: q('.num.temp .num-val'),
    };

    this.co2Scale = 50;
    const lw = compact ? 1.6 : 2.2;
    this.waves = [
      new Sweep(q('.wave.ecg canvas'), {
        color: '#3dff74', lw,
        sample: (t) => { const v = this.sig.sampleECG(t); return this.state.show.ecg ? v : 0; },
        map: (v) => 0.6 - v * 0.31,
      }),
      new Sweep(q('.wave.pleth canvas'), {
        color: '#3be3ff', lw,
        sample: (t) => { const v = this.sig.samplePleth(t); return this.state.show.spo2 ? v : 0; },
        map: (v) => 0.86 - v * 0.66,
      }),
      new Sweep(q('.wave.co2 canvas'), {
        color: '#ffd84d', lw,
        sample: (t) => { const v = this.sig.sampleCO2(t); return this.state.show.co2 ? v : 0; },
        map: (v) => 0.92 - (v / this.co2Scale) * 0.8,
      }),
    ];

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(root);
    this.frame = this.frame.bind(this);
    this.running = false;
  }

  resize() {
    for (const w of this.waves) w.resize();
  }

  start() {
    if (this.running || !this.state) return;
    this.running = true;
    this.lastT = null;
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    this.ro.disconnect();
  }

  // Apply a new state from the controller.
  applyState(s) {
    const now = performance.now() / 1000;
    const prev = this.state;
    const first = !prev;
    const rhythmChanged = first || prev.rhythm !== s.rhythm;
    this.state = s;

    let hrJump = false;
    for (const k of NUM_KEYS) {
      const to = s[k];
      if (first) {
        this.cur[k] = to;
        continue;
      }
      if (prev[k] === to) continue;
      const instant = !(s.trend > 0) || (k === 'hr' && rhythmChanged);
      if (k === 'hr' && !rhythmChanged && instant && Math.abs(this.cur.hr - to) / Math.max(this.cur.hr, 1) > 0.08) hrJump = true;
      if (instant) {
        this.cur[k] = to;
        delete this.tr[k];
      } else {
        this.tr[k] = { from: this.cur[k], to, t0: now, dur: s.trend };
      }
    }
    this.sig.setVitals(this.cur);
    if (rhythmChanged || prev.pulse !== s.pulse || prev.ectopy !== s.ectopy || hrJump) {
      this.sig.setRhythm(s.rhythm, s.pulse, s.ectopy, now);
    }
    if (first) this.nibpTime = new Date();
    else if (s.nibp !== prev.nibp) this.cuff = { t0: now, dur: 6.5 };
    else if (prev.sys !== s.sys || prev.dia !== s.dia || (s.show.nibp && !prev.show.nibp)) this.nibpTime = new Date();
    if (!s.alarms) this.alarmList = [];
    this.updateMessages();
    this.refreshNumbers();
    this.evaluateAlarms(now, true);
    if (first) this.start();
  }

  frame() {
    if (!this.running) return;
    try {
      this.tick(performance.now() / 1000);
    } catch (err) {
      console.error(err);
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  tick(now) {
    const s = this.state;
    for (const k in this.tr) {
      const tr = this.tr[k];
      const f = (now - tr.t0) / tr.dur;
      if (f >= 1) {
        this.cur[k] = tr.to;
        delete this.tr[k];
      } else {
        this.cur[k] = tr.from + (tr.to - tr.from) * f;
      }
    }
    this.sig.setVitals(this.cur);

    const need = Math.max(s.etco2, this.cur.etco2);
    const scale = need > 46 ? 75 : 50;
    if (scale !== this.co2Scale) {
      this.co2Scale = scale;
      setText(this.el.co2Hi, String(scale));
    }

    let from = this.lastT ?? now;
    if (now - from > 1) from = now - 0.02; // after a stall (hidden tab), don't replay
    for (const w of this.waves) w.advance(from, now);
    this.lastT = now;

    const beats = this.sig.takeBeats(now);
    if (beats && s.show.ecg) {
      this.el.heart.classList.add('on');
      clearTimeout(this.heartTimer);
      this.heartTimer = setTimeout(() => this.el.heart.classList.remove('on'), 130);
      if (this.audio && s.sound.beep) this.audio.beep(s.show.spo2 && s.pulse ? this.cur.spo2 : null);
    }

    if (!(now - this.lastNum < 0.25)) {
      this.lastNum = now;
      this.refreshNumbers(now);
    }
    if (!(now - this.lastAlarmEval < 1)) {
      this.lastAlarmEval = now;
      this.evaluateAlarms(now);
    }
    if (!this.compact && !(now - this.lastClock < 1)) {
      this.lastClock = now;
      setText(this.el.clock, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
  }

  updateMessages() {
    const s = this.state;
    setText(this.el.ecgMsg, s.show.ecg ? '' : 'LEADS OFF');
    setText(this.el.plMsg, !s.show.spo2 ? 'SpO₂ PROBE OFF' : !s.pulse ? 'NON-PULSATILE' : '');
    setText(this.el.co2Msg, s.show.co2 ? '' : 'CO₂ NOT CONNECTED');
  }

  refreshNumbers(now = performance.now() / 1000) {
    const s = this.state;
    if (!s) return;
    const c = this.cur;
    const R = RHYTHM_MAP[s.rhythm];

    if (!(now - this.lastJitter < 1.5)) {
      this.lastJitter = now;
      this.hrJitter = s.rhythm === 'afib' || s.rhythm === 'torsades' ? Math.round((Math.random() - 0.5) * 8) : 0;
    }
    const hr = R.hr && s.show.ecg ? Math.max(0, Math.round(c.hr + this.hrJitter)) : null;
    setText(this.el.hrVal, hr == null ? '---' : String(hr));

    const perf = s.pulse && s.show.spo2;
    setText(this.el.spo2Val, perf ? String(Math.round(c.spo2)) : '---');
    setText(this.el.pr, perf && R.hr ? String(Math.round(c.hr)) : '---');

    if (this.cuff) {
      const f = (now - this.cuff.t0) / this.cuff.dur;
      if (f >= 1) {
        this.cuff = null;
        this.nibpTime = new Date();
      } else {
        const p = f < 0.3 ? 15 + (f / 0.3) * 150 : 165 - ((f - 0.3) / 0.7) * 120;
        setText(this.el.nibpVal, `${Math.round(p)}`);
        setText(this.el.nibpMap, 'measuring…');
        this.el.nibp.classList.add('measuring');
      }
    }
    if (!this.cuff) {
      this.el.nibp.classList.remove('measuring');
      if (s.show.nibp && s.pulse) {
        const sys = Math.round(c.sys), dia = Math.round(c.dia);
        setText(this.el.nibpVal, `${sys}/${dia}`);
        setText(this.el.nibpMap, `(${Math.round(dia + (sys - dia) / 3)})`);
      } else {
        setText(this.el.nibpVal, '---/---');
        setText(this.el.nibpMap, s.show.nibp ? 'no reading' : '(---)');
      }
      const t = this.nibpTime;
      setText(this.el.nibpTime, s.show.nibp && t ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
    }

    setText(this.el.co2Val, s.show.co2 ? String(Math.round(c.etco2)) : '---');
    setText(this.el.awrr, s.show.co2 ? String(Math.round(c.rr)) : '---');
    setText(this.el.tempVal, s.show.temp ? c.temp.toFixed(1) : '--.-');
  }

  evaluateAlarms(now, immediate = false) {
    const s = this.state;
    const c = this.cur;
    const A = [];
    const flags = { hr: 0, spo2: 0, nibp: 0, co2: 0 };
    const add = (p, text, card) => {
      A.push({ p, text });
      if (card) flags[card] = Math.max(flags[card], p);
    };
    if (s.alarms) {
      const R = RHYTHM_MAP[s.rhythm];
      if (s.show.ecg) {
        if (s.rhythm === 'vf_coarse' || s.rhythm === 'vf_fine') add(3, 'VENT FIB', 'hr');
        else if (s.rhythm === 'asystole') add(3, 'ASYSTOLE', 'hr');
        else if (s.rhythm === 'vt' || s.rhythm === 'torsades') add(3, 'V-TACH', 'hr');
        else if (R.hr) {
          if (c.hr > 150) add(3, 'EXTREME TACHY', 'hr');
          else if (c.hr > 120) add(2, 'HR HIGH', 'hr');
          else if (c.hr < 40) add(3, 'EXTREME BRADY', 'hr');
          else if (c.hr < 50) add(2, 'HR LOW', 'hr');
        }
      } else add(1, 'ECG LEADS OFF');
      if (s.show.spo2) {
        if (!s.pulse) add(2, 'SpO₂ NO PULSE', 'spo2');
        else if (c.spo2 < 85) add(3, 'SpO₂ LOW', 'spo2');
        else if (c.spo2 < 90) add(2, 'SpO₂ LOW', 'spo2');
      } else add(1, 'SpO₂ PROBE OFF');
      if (s.show.nibp && s.pulse && !this.cuff) {
        if (c.sys < 80) add(3, 'NIBP SYS LOW', 'nibp');
        else if (c.sys < 90) add(2, 'NIBP SYS LOW', 'nibp');
        else if (c.sys > 180) add(2, 'NIBP SYS HIGH', 'nibp');
      }
      if (s.show.co2) {
        if (c.rr < 1) add(3, 'APNEA', 'co2');
        else if (c.rr < 8) add(2, 'awRR LOW', 'co2');
        else if (c.rr > 30) add(2, 'awRR HIGH', 'co2');
        if (c.rr >= 1 && c.etco2 < 20) add(2, 'EtCO₂ LOW', 'co2');
        else if (c.etco2 > 50) add(2, 'EtCO₂ HIGH', 'co2');
      }
    }
    A.sort((a, b) => b.p - a.p);
    this.alarmList = A;

    for (const k of ['hr', 'spo2', 'nibp', 'co2']) {
      const el = this.el[k];
      el.classList.toggle('alarm-hi', flags[k] === 3);
      el.classList.toggle('alarm-med', flags[k] === 2);
    }

    // Banner: cycle through active alarms.
    if (!A.length) {
      setText(this.el.alarm, '');
      this.el.alarm.className = 'mon-alarm';
    } else {
      this.alarmTick = (this.alarmTick || 0) + 1;
      if (!immediate && this.alarmTick % 2 === 0) this.alarmIdx++;
      const a = A[this.alarmIdx % A.length];
      const stars = a.p === 3 ? '***' : a.p === 2 ? '**' : '';
      setText(this.el.alarm, `${stars} ${a.text}`.trim());
      this.el.alarm.className = 'mon-alarm ' + (a.p === 3 ? 'hi' : a.p === 2 ? 'med' : 'low');
    }

    // Alarm sound: repeat according to the highest priority.
    const top = A.length ? A[0].p : 0;
    if (this.audio && s.sound.alarm && top) {
      const every = top === 3 ? 6 : top === 2 ? 10 : 20;
      if (top > this.lastAlarmTop || now - this.lastAlarmSound > every) {
        this.audio.alarm(top);
        this.lastAlarmSound = now;
      }
    }
    this.lastAlarmTop = top;
  }
}
