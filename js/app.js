// Entry point: home screen + routing between monitor and controller.
//   ?monitor        → this device is the patient monitor
//   ?join=123456    → this device is the controller for that code (?join alone asks for it)
import { MonitorAudio } from './audio.js';
import { startMonitor } from './monitor-page.js';
import { startHost, renderConnect } from './host-page.js';
import { icon } from './util.js';

const root = document.getElementById('app');
const audio = new MonitorAudio();
let cleanup = null;

function navigate(params, replace = false) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  for (const r of new URLSearchParams(location.search).getAll('relay')) q.append('relay', r);
  const s = q.toString().replace(/=(?=&|$)/g, '');
  const url = location.pathname + (s ? `?${s}` : '');
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  route();
}

function show(mode, render) {
  try {
    cleanup?.();
  } catch (e) {
    console.error(e);
  }
  cleanup = null;
  root.innerHTML = '';
  document.body.dataset.mode = mode;
  window.scrollTo(0, 0);
  cleanup = render() || null;
}

function renderHome() {
  root.innerHTML = `
    <main class="page home">
      <header class="hero">
        <div class="hero-mark">${icon('ecg')}</div>
        <h1>ACLS Monitor Simulator</h1>
        <p class="lead">Turn any screen into a patient monitor and control the rhythm and vital signs from your phone. Nothing to install.</p>
      </header>
      <div class="roles">
        <button type="button" class="role" data-role="monitor">
          <span class="role-icon">${icon('monitor')}</span>
          <span class="role-text"><b>Monitor</b><small>Show the patient monitor on this screen. Use the laptop, TV or tablet the students will watch.</small></span>
        </button>
        <button type="button" class="role" data-role="host">
          <span class="role-icon">${icon('phone')}</span>
          <span class="role-text"><b>Controller</b><small>For the instructor: change the rhythm and vitals on the paired monitor.</small></span>
        </button>
      </div>
      <ol class="how">
        <li><b>Open this page on the monitor screen</b> and tap <em>Monitor</em>. A 6-digit pairing code appears.</li>
        <li><b>On your phone</b>, scan the QR code, or open this page, tap <em>Controller</em> and type the code.</li>
        <li><b>Pick a rhythm, adjust vitals or run a scenario.</b> The monitor updates instantly.</li>
      </ol>
      <p class="fine">For training only. Not a medical device. Pairing goes through free public relay servers, so don't enter any patient information.</p>
    </main>`;
  root.querySelector('[data-role="monitor"]').addEventListener('click', () => {
    audio.unlock(); // this tap counts as the gesture browsers need for sound
    navigate({ monitor: '' });
  });
  root.querySelector('[data-role="host"]').addEventListener('click', () => navigate({ join: '' }));
}

function route() {
  const q = new URLSearchParams(location.search);
  if (q.has('monitor')) {
    show('monitor', () => startMonitor(root, { audio, onExit: () => navigate({}) }));
    return;
  }
  if (q.has('join')) {
    const code = (q.get('join') || '').replace(/\D/g, '');
    if (code.length === 6) show('host', () => startHost(root, code, { onExit: () => navigate({ join: '' }) }));
    else show('connect', () => renderConnect(root, { onConnect: (c) => navigate({ join: c }), onBack: () => navigate({}) }));
    return;
  }
  show('home', renderHome);
}

window.addEventListener('popstate', route);
route();
