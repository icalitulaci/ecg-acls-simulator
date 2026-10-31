// Small shared helpers.

export const fmtCode = (c) => `${c.slice(0, 3)} ${c.slice(3)}`;

export function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// sessionStorage: survives a refresh of this tab, but a new visit starts fresh.
export function sload(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function sstore(key, value) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}

export function store(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}

// URL of the controller for a given pairing code (used for the QR code).
export function controllerUrl(code) {
  const q = new URLSearchParams();
  q.set('join', code);
  for (const r of new URLSearchParams(location.search).getAll('relay')) q.append('relay', r);
  return `${location.origin}${location.pathname}?${q}`;
}

const PATHS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  soundOn: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  soundOff: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M5 11h3l1.5-3 2.5 6 1.5-3H19"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  ecg: '<path d="M2 12h4l2-5 4 10 2-5h8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  cuff: '<circle cx="12" cy="13" r="7"/><path d="M12 13l3-3M12 3v3"/>',
};

export const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
