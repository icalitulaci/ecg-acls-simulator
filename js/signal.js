// Synthetic patient signals: ECG (lead II), SpO2 plethysmograph and capnography.
//
// The ECG is built from scheduled events (P waves, QRS-T complexes, flutter waves) that are
// summed together, plus continuous "background" activity for fibrillation. Atrial and
// ventricular events are scheduled separately, which is what makes AV blocks, PVCs with
// compensatory pauses and AV dissociation come out naturally.

const TAU = Math.PI * 2;
const LOOKAHEAD = 0.7; // seconds of beats scheduled ahead of "now"

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const gauss = (x, m, s) => { const d = (x - m) / s; return Math.exp(-0.5 * d * d); };
const agauss = (x, m, sl, sr) => { const d = (x - m) / (x < m ? sl : sr); return Math.exp(-0.5 * d * d); };
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const rnd = (a, b) => a + Math.random() * (b - a);

// QT shortens with rate (Fridericia-like). Returns approx. Q-onset → T-end in seconds.
const qtFor = (rr) => 0.40 * Math.cbrt(clamp(rr, 0.25, 2.2));

// ---- waveform building blocks: { a, b, fn(dt) } with dt relative to the anchor (R peak / P peak)

function pWave(amp = 0.13, w = 0.022) {
  return { a: -4 * w, b: 4 * w, fn: (dt) => amp * gauss(dt, 0, w) };
}

function narrowQRS(rr, { w = 1, amp = 1, tAmp = 0.28 } = {}) {
  const qt = qtFor(rr), k = qt / 0.4, tp = qt - 0.12;
  const sl = 0.055 * k, sr = 0.04 * k;
  return {
    a: -0.06 * w,
    b: tp + 3.2 * sr,
    fn: (dt) =>
      amp * (-0.10 * gauss(dt, -0.026 * w, 0.008 * w) + 1.15 * gauss(dt, 0, 0.0105 * w) - 0.28 * gauss(dt, 0.026 * w, 0.009 * w)) +
      tAmp * agauss(dt, tp, sl, sr),
  };
}

// Ventricular escape / idioventricular complex: wide, with discordant T.
function wideQRS(rr, amp = 1) {
  const tp = qtFor(rr) - 0.06;
  return {
    a: -0.12,
    b: tp + 0.3,
    fn: (dt) => amp * (0.95 * agauss(dt, 0, 0.03, 0.035) - 0.32 * gauss(dt, 0.075, 0.03) - 0.38 * agauss(dt, tp, 0.075, 0.06)),
  };
}

function pvcQRS(amp = 1) {
  return {
    a: -0.12,
    b: 0.6,
    fn: (dt) => amp * (1.45 * agauss(dt, 0, 0.028, 0.034) - 0.30 * gauss(dt, 0.075, 0.028) - 0.50 * agauss(dt, 0.31, 0.075, 0.06)),
  };
}

function vtQRS(rr, amp = 1) {
  const s = clamp(rr / 0.35, 0.75, 1.35);
  return {
    a: -0.12,
    b: 0.32 * s + 0.12,
    fn: (dt) => amp * (1.5 * agauss(dt, 0, 0.03 * s, 0.04 * s) - 0.85 * agauss(dt, 0.13 * s, 0.045 * s, 0.06 * s)),
  };
}

// Torsades: sinusoidal complexes whose amplitude (and polarity) is modulated by e.
function tdpQRS(rr, e) {
  const s = clamp(rr / 0.27, 0.8, 1.25);
  return {
    a: -0.11,
    b: 0.34 * s,
    fn: (dt) => e * (1.15 * gauss(dt, 0, 0.032 * s) - 0.85 * gauss(dt, 0.115 * s, 0.045 * s)),
  };
}

// One flutter wave (negative sawtooth in lead II), lasting exactly one flutter cycle.
function fWave(T, amp = 0.2) {
  return {
    a: 0,
    b: T,
    fn: (dt) => {
      const p = dt / T;
      return p < 0.7 ? -amp * (p / 0.7) : -amp * (1 - smooth((p - 0.7) / 0.3));
    },
  };
}

function plethPulse(rr, amp) {
  const s = clamp(rr / 0.85, 0.45, 1.25);
  return {
    a: -0.01,
    b: 0.95 * s,
    fn: (dt) => amp * (agauss(dt, 0.13 * s, 0.055 * s, 0.17 * s) + 0.2 * gauss(dt, 0.4 * s, 0.07 * s)),
  };
}

// ---- continuous background activity

function vfWave(t, s) {
  const v =
    0.55 * Math.sin(TAU * 4.2 * t + 6 * Math.sin(TAU * 0.21 * t + s)) +
    0.33 * Math.sin(TAU * 5.6 * t + 7 * Math.sin(TAU * 0.29 * t + 2 * s)) +
    0.22 * Math.sin(TAU * 3.1 * t + 5 * Math.sin(TAU * 0.17 * t + 3 * s)) +
    0.12 * Math.sin(TAU * 7.8 * t + 4 * Math.sin(TAU * 0.43 * t + s));
  return v * (0.72 + 0.28 * Math.sin(TAU * 0.19 * t + s) * Math.sin(TAU * 0.061 * t + 1.3));
}

const BACKGROUND = {
  afib: (t, s) =>
    0.045 * Math.sin(TAU * 5.3 * t + 3 * Math.sin(TAU * 0.37 * t + s)) +
    0.032 * Math.sin(TAU * 6.8 * t + 2.4 * Math.sin(TAU * 0.52 * t + 2 * s)) +
    0.022 * Math.sin(TAU * 8.6 * t + s),
  vf_coarse: (t, s) => vfWave(t, s),
  vf_fine: (t, s) => 0.24 * vfWave(t, s),
};

// Rhythms whose cycle starts with an atrial event before the QRS.
const P_LED = new Set(['nsr', 'sbrady', 'stach', 'avb1', 'avb2i', 'avb2ii', 'pea']);

export class PatientSignal {
  constructor() {
    this.ev = []; // ECG events {t, a, b, fn, r}
    this.pl = []; // pleth events
    this.beats = []; // R-wave times not yet reported (for QRS beeps)
    this.bg = []; // background components {fn, on, off}
    this.v = { hr: 75, sys: 120, rr: 14, etco2: 38 };
    this.rhythm = null;
    this.pulse = true;
    this.ectopy = 'none';
    this.cursor = 0;
    this.cursorA = 0;
    this.cursorV = 0;
    this.lastR = -10;
    this.seed = Math.random() * 100;
    this.co2 = { last: null, phase: 0.7, val: 0 };
    this.lastPrune = 0;
    this.k = 0; // cycle counter for block patterns
    this.sincePVC = 0;
    this.skipNext = false;
  }

  setVitals(v) {
    this.v.hr = v.hr;
    this.v.sys = v.sys;
    this.v.rr = v.rr;
    this.v.etco2 = v.etco2;
  }

  get beatInterval() {
    return 60 / clamp(this.v.hr || 60, 10, 320);
  }

  // Change rhythm (or pulse / ectopy, or force a re-time after a big HR jump).
  setRhythm(rhythm, pulse, ectopy, now) {
    this.pulse = pulse;
    this.ectopy = ectopy || 'none';
    // Drop everything that hasn't started yet; let the complex in progress finish.
    this.ev = this.ev.filter((e) => e.t + e.a <= now);
    this.pl = this.pl.filter((e) => e.t + e.a <= now);
    const kept = this.ev.filter((e) => e.r).map((e) => e.t);
    this.beats = this.beats.filter((b) => b <= now || kept.includes(b));
    this.lastR = kept.length ? Math.max(...kept) : Math.min(this.lastR, now);

    if (rhythm !== this.rhythm) {
      for (const b of this.bg) if (b.off == null) b.off = now;
      const fn = BACKGROUND[rhythm];
      if (fn) this.bg.push({ fn, on: now, off: null });
      this.rhythm = rhythm;
    }
    this.restart(now);
  }

  restart(now) {
    const rr = this.beatInterval;
    const lead = P_LED.has(this.rhythm) ? this.prInterval() : 0;
    const first = this.lastR + Math.min(rr, 1.2) - lead;
    this.cursor = Math.max(first, now + 0.05);
    this.cursorA = this.cursor;
    this.cursorV = Math.max(this.lastR + Math.min(rr, 1.5), now + 0.1) + rnd(0, 0.3);
    if (this.rhythm === 'avb3') this.cursor = Math.min(this.cursorA, this.cursorV);
    this.k = 0;
    this.fc = 0;
    this.skipNext = false;
  }

  // PR shortens a little as the rate rises (0.18 s at 40 bpm → 0.12 s at 150+).
  prInterval() {
    const shorten = clamp(((this.v.hr || 75) - 75) * 0.0006, -0.02, 0.04);
    return (this.rhythm === 'avb1' ? 0.30 : 0.16) - shorten;
  }

  ensure(t) {
    if (this.rhythm == null) return;
    if (this.cursor < t - 2) {
      // The page was asleep: don't try to replay the missed beats.
      this.lastR = Math.max(this.lastR, t - 1);
      this.restart(t);
    }
    let guard = 0;
    while (this.cursor < t + LOOKAHEAD && guard++ < 64) this.step();
    if (t - this.lastPrune > 0.5) {
      this.lastPrune = t;
      this.ev = this.ev.filter((e) => e.t + e.b > t - 0.05);
      this.pl = this.pl.filter((e) => e.t + e.b > t - 0.05);
      this.bg = this.bg.filter((b) => b.off == null || t < b.off + 0.6);
    }
  }

  addP(t, shape) {
    this.ev.push({ t, ...shape });
  }

  addQRS(t, shape, perf = 1) {
    this.ev.push({ t, ...shape, r: true });
    this.beats.push(t);
    const prevRR = t - this.lastR;
    this.lastR = t;
    if (this.pulse && perf > 0) {
      const rrF = clamp(Math.sqrt(clamp(prevRR, 0.2, 2) / 0.85), 0.4, 1.25);
      const bp = 0.55 + 0.45 * clamp((this.v.sys - 50) / 70, 0, 1);
      this.pl.push({ t: t + 0.2, ...plethPulse(this.beatInterval, perf * rrF * bp) });
    }
  }

  pvcDue() {
    const e = this.ectopy;
    if (e === 'none') return false;
    this.sincePVC++;
    let due = false;
    if (e === 'bigem') due = true;
    else if (e === 'trigem') due = this.sincePVC >= 2;
    else if (e === 'occ') due = this.sincePVC >= 3 && Math.random() < 0.09;
    else if (e === 'freq') due = this.sincePVC >= 1 && Math.random() < 0.28;
    if (due) this.sincePVC = 0;
    return due;
  }

  step() {
    const rr = this.beatInterval;
    switch (this.rhythm) {
      case 'nsr': case 'sbrady': case 'stach': case 'avb1': case 'pea':
        return this.stepSinus(rr);
      case 'svt':
        this.addQRS(this.cursor, narrowQRS(rr, { tAmp: 0.22 }), 0.8);
        this.cursor += rr * rnd(0.996, 1.004);
        return;
      case 'junctional':
        this.addP(this.cursor - 0.07, pWave(-0.09, 0.02)); // retrograde P
        this.addQRS(this.cursor, narrowQRS(rr), 1);
        this.cursor += rr * rnd(0.99, 1.01);
        return;
      case 'afib':
        return this.stepAfib(rr);
      case 'aflutter':
        return this.stepFlutter();
      case 'avb2i':
        return this.stepWenckebach(rr);
      case 'avb2ii':
        return this.stepMobitz(rr);
      case 'avb3':
        return this.stepCHB(rr);
      case 'idio':
        this.addQRS(this.cursor, wideQRS(rr), 0.7);
        this.cursor += rr * rnd(0.98, 1.02);
        return;
      case 'vt':
        this.addQRS(this.cursor, vtQRS(rr), 0.45);
        this.cursor += rr * rnd(0.99, 1.01);
        return;
      case 'torsades': {
        const e = 1.25 * Math.sin((TAU * this.cursor) / 3.4 + this.seed);
        this.addQRS(this.cursor, tdpQRS(rr, e), 0.25);
        this.cursor += rr * rnd(0.88, 1.12);
        return;
      }
      default:
        // VF / asystole: continuous background only.
        this.cursor += 0.25;
    }
  }

  stepSinus(rr) {
    const t = this.cursor;
    const pr = this.prInterval();
    const next = rr * rnd(0.985, 1.015);
    this.addP(t, pWave(this.rhythm === 'stach' ? 0.12 : 0.13));
    if (this.skipNext) {
      // This P lands in the PVC's refractory period: not conducted → compensatory pause.
      this.skipNext = false;
    } else {
      const tr = t + pr;
      this.addQRS(tr, narrowQRS(rr), 1);
      if (this.pvcDue()) {
        const coupling = clamp(0.55 * rr, 0.34, 0.62);
        this.addQRS(tr + coupling, pvcQRS(), 0.3);
        // At slow rates the next sinus beat still conducts (interpolated PVC).
        this.skipNext = rr - coupling < 0.5;
      }
    }
    this.cursor += next;
  }

  stepAfib(rr) {
    const t = this.cursor;
    this.addQRS(t, narrowQRS(rr, { tAmp: 0.2 }), 1);
    let next = rr * (0.62 + 0.76 * Math.random()); // irregularly irregular
    if (this.pvcDue()) {
      const c = clamp(0.5 * rr, 0.3, 0.6);
      this.addQRS(t + c, pvcQRS(), 0.3);
      next = Math.max(next, c + 0.45 + Math.random() * 0.3 * rr);
    }
    this.cursor += next;
  }

  stepFlutter() {
    const hr = clamp(this.v.hr, 30, 320);
    const n = clamp(Math.round(300 / hr), 1, 8); // conduction ratio, keeps atrial rate ≈ 300
    const T = 60 / (hr * n);
    const t = this.cursor;
    this.ev.push({ t, ...fWave(T) });
    this.fc = (this.fc || 0) + 1;
    if (this.fc >= n) {
      this.fc = 0;
      this.addQRS(t + 0.24, narrowQRS(60 / hr, { tAmp: 0.16 }), 1);
    }
    this.cursor += T;
  }

  // 4:3 Wenckebach — PR lengthens until a P wave isn't conducted.
  stepWenckebach(rr) {
    const t = this.cursor;
    const i = this.k++ % 4;
    this.addP(t, pWave());
    if (i < 3) this.addQRS(t + [0.20, 0.31, 0.37][i], narrowQRS(rr), 1);
    this.cursor += rr * 0.75;
  }

  // 3:2 Mobitz II — constant PR, then a dropped beat; slightly wide QRS.
  stepMobitz(rr) {
    const t = this.cursor;
    const i = this.k++ % 3;
    this.addP(t, pWave());
    if (i < 2) this.addQRS(t + 0.18, narrowQRS(rr, { w: 1.7, tAmp: 0.24 }), 1);
    this.cursor += rr * (2 / 3);
  }

  // Complete heart block: atria and ventricles each at their own rate.
  stepCHB(rr) {
    const atrial = 60 / Math.max(72, this.v.hr + 32);
    if (this.cursorA <= this.cursorV) {
      this.addP(this.cursorA, pWave());
      this.cursorA += atrial * rnd(0.98, 1.02);
    } else {
      const wide = this.v.hr < 45;
      this.addQRS(this.cursorV, wide ? wideQRS(rr, 0.9) : narrowQRS(rr), wide ? 0.75 : 1);
      this.cursorV += rr * rnd(0.99, 1.01);
    }
    this.cursor = Math.min(this.cursorA, this.cursorV);
  }

  // ---- sampling (call with monotonically increasing t)

  sampleECG(t) {
    this.ensure(t);
    let v = 0.03 * Math.sin(TAU * 0.13 * t + this.seed) + 0.018 * Math.sin(TAU * 0.29 * t + 2 * this.seed) + (Math.random() - 0.5) * 0.012;
    for (const e of this.ev) {
      const d = t - e.t;
      if (d >= e.a && d <= e.b) v += e.fn(d);
    }
    for (const b of this.bg) {
      const w = smooth((t - b.on) / 0.5) * (b.off == null ? 1 : 1 - smooth((t - b.off) / 0.5));
      if (w > 0) v += w * b.fn(t, this.seed);
    }
    return v;
  }

  samplePleth(t) {
    this.ensure(t);
    let v = (Math.random() - 0.5) * 0.008;
    for (const e of this.pl) {
      const d = t - e.t;
      if (d >= e.a && d <= e.b) v += e.fn(d);
    }
    return v;
  }

  sampleCO2(t) {
    const c = this.co2;
    let dt = c.last == null ? 0 : t - c.last;
    c.last = t;
    if (dt < 0 || dt > 1) dt = 0;
    const rr = this.v.rr, et = this.v.etco2;
    if (!(rr >= 1)) {
      // apnoea: fall back to zero and stay there
      c.val += (0 - c.val) * Math.min(1, dt * 10);
      c.phase = 0.999;
      return c.val;
    }
    const T = 60 / rr;
    c.phase = (c.phase + dt / T) % 1;
    const E = 0.62; // expiratory fraction of the breath
    const p = c.phase;
    let f;
    if (p < E) {
      const x = p * T, rise = Math.min(0.35, 0.22 * E * T);
      f = x < rise ? 0.9 * smooth(x / rise) : 0.9 + 0.1 * Math.min(1, (x - rise) / (E * T - rise));
    } else {
      const x = (p - E) * T, fall = Math.min(0.22, 0.1 * T);
      f = x < fall ? 1 - smooth(x / fall) : 0;
    }
    c.val = f * et;
    return c.val;
  }

  // Number of QRS complexes that occurred up to `now` since the last call.
  takeBeats(now) {
    let n = 0;
    while (this.beats.length && this.beats[0] <= now) {
      const b = this.beats.shift();
      if (now - b < 0.3) n++;
    }
    return n;
  }
}
