// The shared "patient state" the controller sends to the monitor, plus presets and validation.
import { RHYTHM_MAP, ECTOPY, defaultPulse } from './rhythms.js';

export const TRENDS = [
  { s: 0, label: 'Instant' },
  { s: 10, label: '10 s' },
  { s: 30, label: '30 s' },
  { s: 60, label: '1 min' },
  { s: 120, label: '2 min' },
];

export const SHOW_KEYS = ['ecg', 'spo2', 'nibp', 'co2', 'temp'];
export const NUM_KEYS = ['hr', 'spo2', 'sys', 'dia', 'rr', 'etco2', 'temp'];

export const LIMITS = {
  hr: [10, 300],
  spo2: [40, 100],
  sys: [30, 260],
  dia: [10, 180],
  rr: [0, 60],
  etco2: [0, 99],
  temp: [30, 43],
};

export function defaultState() {
  return {
    rev: 0,
    rhythm: 'nsr',
    hr: 78,
    pulse: true,
    ectopy: 'none',
    spo2: 98,
    sys: 124,
    dia: 78,
    rr: 14,
    etco2: 38,
    temp: 36.8,
    show: { ecg: true, spo2: true, nibp: true, co2: true, temp: true },
    trend: 0,
    sound: { beep: true, alarm: true },
    alarms: true,
    nibp: 0, // bumped by the controller to run a cuff measurement on the monitor
  };
}

export const cloneState = (s) => JSON.parse(JSON.stringify(s));

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// Messages arrive over public relays, so never trust their shape.
export function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = defaultState();
  if (isNum(raw.rev)) s.rev = raw.rev;
  if (typeof raw.rhythm === 'string' && RHYTHM_MAP[raw.rhythm]) s.rhythm = raw.rhythm;
  else return null;
  for (const k of NUM_KEYS) if (isNum(raw[k])) s[k] = clamp(raw[k], LIMITS[k][0], LIMITS[k][1]);
  s.temp = Math.round(s.temp * 10) / 10;
  if (typeof raw.pulse === 'boolean') s.pulse = raw.pulse;
  if (RHYTHM_MAP[s.rhythm].locked) s.pulse = false;
  if (ECTOPY.some((e) => e.id === raw.ectopy)) s.ectopy = raw.ectopy;
  if (raw.show && typeof raw.show === 'object') {
    for (const k of SHOW_KEYS) if (typeof raw.show[k] === 'boolean') s.show[k] = raw.show[k];
  }
  if (isNum(raw.trend)) s.trend = clamp(raw.trend, 0, 600);
  if (raw.sound && typeof raw.sound === 'object') {
    if (typeof raw.sound.beep === 'boolean') s.sound.beep = raw.sound.beep;
    if (typeof raw.sound.alarm === 'boolean') s.sound.alarm = raw.sound.alarm;
  }
  if (typeof raw.alarms === 'boolean') s.alarms = raw.alarms;
  if (isNum(raw.nibp)) s.nibp = Math.max(0, Math.floor(raw.nibp));
  return s;
}

// Fields that count as a "change" for the staged-send counter.
const DIFF_KEYS = ['rhythm', 'hr', 'pulse', 'ectopy', 'spo2', 'sys', 'dia', 'rr', 'etco2', 'temp'];
export function diffCount(a, b) {
  let n = 0;
  for (const k of DIFF_KEYS) if (a[k] !== b[k]) n++;
  for (const k of SHOW_KEYS) if (a.show[k] !== b.show[k]) n++;
  return n;
}

// tone: ok | warn | arrest (only used for colouring the buttons)
export const PRESETS = [
  { id: 'stable', name: 'Stable', note: 'NSR 78 · normal vitals', tone: 'ok',
    s: { rhythm: 'nsr', hr: 78, spo2: 98, sys: 124, dia: 78, rr: 14, etco2: 38, temp: 36.8 } },
  { id: 'brady', name: 'Symptomatic brady', note: 'Sinus brady 38 · BP 78/44', tone: 'warn',
    s: { rhythm: 'sbrady', hr: 38, spo2: 93, sys: 78, dia: 44, rr: 18, etco2: 34 } },
  { id: 'chb', name: 'Complete heart block', note: '3rd degree 32 · BP 74/40', tone: 'warn',
    s: { rhythm: 'avb3', hr: 32, spo2: 92, sys: 74, dia: 40, rr: 20, etco2: 33 } },
  { id: 'svt', name: 'Unstable SVT', note: 'SVT 190 · BP 82/50', tone: 'warn',
    s: { rhythm: 'svt', hr: 190, spo2: 95, sys: 82, dia: 50, rr: 24, etco2: 31 } },
  { id: 'afrvr', name: 'A-fib with RVR', note: 'A-fib 150 · BP 98/62', tone: 'warn',
    s: { rhythm: 'afib', hr: 150, spo2: 94, sys: 98, dia: 62, rr: 22, etco2: 34 } },
  { id: 'vtpulse', name: 'VT with pulse', note: 'V-tach 170 · BP 104/66', tone: 'warn',
    s: { rhythm: 'vt', hr: 170, pulse: true, spo2: 95, sys: 104, dia: 66, rr: 20, etco2: 35 } },
  { id: 'pvt', name: 'Pulseless VT', note: 'Shockable', tone: 'arrest',
    s: { rhythm: 'vt', hr: 180, pulse: false, rr: 10, etco2: 14 } },
  { id: 'vf', name: 'VF arrest', note: 'Coarse VF · shockable', tone: 'arrest',
    s: { rhythm: 'vf_coarse', rr: 10, etco2: 14 } },
  { id: 'tdp', name: 'Torsades', note: 'Polymorphic VT · shockable', tone: 'arrest',
    s: { rhythm: 'torsades', hr: 232, pulse: false, rr: 10, etco2: 13 } },
  { id: 'asys', name: 'Asystole', note: 'Non-shockable', tone: 'arrest',
    s: { rhythm: 'asystole', rr: 10, etco2: 12 } },
  { id: 'pea', name: 'PEA', note: 'Organised rhythm, no pulse', tone: 'arrest',
    s: { rhythm: 'pea', hr: 52, rr: 10, etco2: 15 } },
  { id: 'rosc', name: 'ROSC', note: 'Sinus tach 108 · EtCO₂ 42', tone: 'ok',
    s: { rhythm: 'stach', hr: 108, pulse: true, spo2: 94, sys: 96, dia: 60, rr: 10, etco2: 42 } },
];

export function applyPreset(base, preset) {
  const s = cloneState(base);
  Object.assign(s, preset.s);
  s.pulse = preset.s.pulse ?? defaultPulse(s.rhythm);
  if (RHYTHM_MAP[s.rhythm].locked) s.pulse = false;
  s.ectopy = 'none';
  for (const k of SHOW_KEYS) s.show[k] = true;
  return s;
}
