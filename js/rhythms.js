// Rhythm catalogue: names, grouping and the heart-rate range that makes sense for each.

export const GROUPS = [
  { id: 'sinus', name: 'Sinus' },
  { id: 'supra', name: 'Supraventricular' },
  { id: 'block', name: 'AV blocks' },
  { id: 'vent', name: 'Ventricular' },
  { id: 'arrest', name: 'Cardiac arrest' },
];

// hr: [min, max] typical rate (null = no countable rate). The HR control isn't limited to it;
//     switching to the rhythm resets HR to def only if the current HR is outside it.
// pulse: default pulse state. locked: pulse can't be turned on (VF / asystole / PEA).
// ectopy: PVCs can be added on top of this rhythm.
export const RHYTHMS = [
  { id: 'nsr', group: 'sinus', name: 'Normal sinus rhythm', short: 'NSR', hr: [60, 100], def: 78, ectopy: true },
  { id: 'sbrady', group: 'sinus', name: 'Sinus bradycardia', short: 'Sinus brady', hr: [20, 59], def: 44, ectopy: true },
  { id: 'stach', group: 'sinus', name: 'Sinus tachycardia', short: 'Sinus tach', hr: [101, 180], def: 124, ectopy: true },

  { id: 'svt', group: 'supra', name: 'Supraventricular tachycardia', short: 'SVT', hr: [150, 260], def: 186 },
  { id: 'afib', group: 'supra', name: 'Atrial fibrillation', short: 'A-fib', hr: [40, 200], def: 112, ectopy: true },
  { id: 'aflutter', group: 'supra', name: 'Atrial flutter', short: 'A-flutter', hr: [50, 175], def: 75 },
  { id: 'junctional', group: 'supra', name: 'Junctional rhythm', short: 'Junctional', hr: [30, 100], def: 50 },

  { id: 'avb1', group: 'block', name: '1st-degree AV block', short: '1st degree', hr: [40, 100], def: 68, ectopy: true },
  { id: 'avb2i', group: 'block', name: '2nd-degree AV block type I (Wenckebach)', short: '2nd° type I', hr: [30, 90], def: 56 },
  { id: 'avb2ii', group: 'block', name: '2nd-degree AV block type II (Mobitz II)', short: '2nd° type II', hr: [25, 80], def: 44 },
  { id: 'avb3', group: 'block', name: '3rd-degree (complete) AV block', short: '3rd degree', hr: [20, 60], def: 34 },

  { id: 'idio', group: 'vent', name: 'Idioventricular rhythm', short: 'Idioventricular', hr: [20, 110], def: 38 },
  { id: 'vt', group: 'vent', name: 'Ventricular tachycardia', short: 'V-tach', hr: [100, 250], def: 172 },
  { id: 'torsades', group: 'vent', name: 'Torsades de pointes', short: 'Torsades', hr: [150, 300], def: 232, pulse: false },

  { id: 'vf_coarse', group: 'arrest', name: 'Ventricular fibrillation (coarse)', short: 'VF coarse', hr: null, pulse: false, locked: true },
  { id: 'vf_fine', group: 'arrest', name: 'Ventricular fibrillation (fine)', short: 'VF fine', hr: null, pulse: false, locked: true },
  { id: 'asystole', group: 'arrest', name: 'Asystole', short: 'Asystole', hr: null, pulse: false, locked: true },
  { id: 'pea', group: 'arrest', name: 'Pulseless electrical activity', short: 'PEA', hr: [20, 150], def: 58, pulse: false, locked: true },
];

export const RHYTHM_MAP = Object.fromEntries(RHYTHMS.map((r) => [r.id, r]));

export const ECTOPY = [
  { id: 'none', name: 'None' },
  { id: 'occ', name: 'Occasional' },
  { id: 'freq', name: 'Frequent' },
  { id: 'bigem', name: 'Bigeminy' },
  { id: 'trigem', name: 'Trigeminy' },
];

export const defaultPulse = (id) => RHYTHM_MAP[id]?.pulse !== false;
