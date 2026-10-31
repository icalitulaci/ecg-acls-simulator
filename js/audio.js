// QRS beeps and alarm tones via WebAudio. Browsers only allow sound after a user tap,
// so unlock() must be called from a click/touch handler.

export class MonitorAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.listeners = new Set();
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.7;
        this.master.connect(this.ctx.destination);
        this.ctx.onstatechange = () => this.emit();
      }
      if (this.ctx.state !== 'running') this.ctx.resume().then(() => this.emit(), () => {});
      // iOS needs a sound started inside the gesture to fully unlock.
      const buf = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
    this.emit();
    return this.ready;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.ready);
  }

  tone(freq, at, dur, vol, type) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.006);
    g.gain.setValueAtTime(vol, at + Math.max(0.01, dur - 0.015));
    g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(at);
    o.stop(at + dur + 0.03);
  }

  // Pitch follows SpO2 like on real monitors (lower saturation → lower tone).
  beep(spo2) {
    if (!this.ready) return;
    const f = spo2 == null ? 700 : 440 * Math.pow(2, (Math.max(50, Math.min(100, spo2)) - 70) / 24);
    this.tone(f, this.ctx.currentTime + 0.005, 0.07, 0.25, 'triangle');
  }

  // priority: 3 = high (red), 2 = medium (yellow), 1 = low / technical
  alarm(priority) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + 0.02;
    if (priority >= 3) {
      for (const [dt, f] of [[0, 988], [0.16, 988], [0.32, 988], [0.7, 988], [0.86, 988]]) this.tone(f, t + dt, 0.11, 0.07, 'square');
    } else if (priority === 2) {
      for (const dt of [0, 0.28, 0.56]) this.tone(660, t + dt, 0.18, 0.07, 'square');
    } else {
      for (const dt of [0, 0.32]) this.tone(523, t + dt, 0.16, 0.05, 'square');
    }
  }
}
