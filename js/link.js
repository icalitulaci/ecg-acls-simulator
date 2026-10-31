// Pairing transport.
//
// GitHub Pages only serves static files, so the two devices talk through free public MQTT
// relays over secure WebSockets. The pairing code is the channel name. We connect to several
// relays at once and send every message through all of them, so one relay being down (or
// blocked by a school network) doesn't break the session. Duplicates are dropped by id.
// A BroadcastChannel is also used so two tabs in the same browser work even offline.
//
// Override the relays with ?relay=wss://host:port/path (repeatable), e.g. for a self-hosted broker.

const DEFAULT_RELAYS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

const APP = 'acls-monsim';
const PREFIX = 'acls-monsim/v1/';
const KEEPALIVE = 30; // seconds

export function relayList() {
  const custom = new URLSearchParams(location.search).getAll('relay').filter((u) => /^wss?:\/\//i.test(u));
  return custom.length ? custom : DEFAULT_RELAYS;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomId(len = 12) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

// ---- minimal MQTT 3.1.1 (QoS 0) packet helpers

const u16 = (n) => [(n >> 8) & 255, n & 255];

function mqttString(s) {
  const b = enc.encode(s);
  return [...u16(b.length), ...b];
}

function packet(first, body) {
  const head = [first];
  let n = body.length;
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    head.push(d);
  } while (n > 0);
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

class MqttSocket {
  constructor(url, handlers) {
    this.url = url;
    this.h = handlers;
    this.ws = null;
    this.up = false;
    this.closed = false;
    this.subs = new Set();
    this.pending = new Map(); // retained publishes waiting for a connection
    this.pid = 1;
    this.retry = 0;
    this.buf = new Uint8Array(0);
    this.clientId = 'acls' + randomId(16);
    this.open();
  }

  open() {
    if (this.closed) return;
    let ws;
    try {
      ws = new WebSocket(this.url, ['mqtt']);
    } catch {
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.buf = new Uint8Array(0);
    ws.onopen = () => {
      // CONNECT, clean session
      const body = [...mqttString('MQTT'), 4, 0x02, ...u16(KEEPALIVE), ...mqttString(this.clientId)];
      this.raw(packet(0x10, body));
    };
    ws.onmessage = (ev) => {
      this.lastRx = Date.now();
      if (ev.data instanceof ArrayBuffer) this.feed(new Uint8Array(ev.data));
    };
    ws.onclose = ws.onerror = () => this.lost(ws);
  }

  raw(bytes) {
    try {
      if (this.ws && this.ws.readyState === 1) this.ws.send(bytes);
    } catch {
      /* ignore */
    }
  }

  feed(chunk) {
    const b = this.buf.length ? concat(this.buf, chunk) : chunk;
    let i = 0;
    for (;;) {
      if (b.length - i < 2) break;
      let len = 0, mult = 1, j = i + 1, byte, complete = true;
      do {
        if (j >= b.length) { complete = false; break; }
        byte = b[j++];
        len += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128 && mult <= 2097152);
      if (!complete || j + len > b.length) break;
      this.handle(b[i], b.subarray(j, j + len));
      i = j + len;
    }
    this.buf = b.slice(i);
  }

  handle(first, body) {
    const type = first >> 4;
    if (type === 2) {
      // CONNACK
      if (body[1] !== 0) {
        this.ws?.close();
        return;
      }
      this.up = true;
      this.retry = 0;
      this.lastRx = Date.now();
      for (const t of this.subs) this.sendSubscribe(t);
      for (const [t, p] of this.pending) this.sendPublish(t, p, true);
      this.pending.clear();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastRx > KEEPALIVE * 1500) this.ws?.close();
        else this.raw(packet(0xc0, []));
      }, 15000);
      this.h.status();
    } else if (type === 3) {
      // PUBLISH
      const qos = (first >> 1) & 3;
      const tl = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tl));
      let p = 2 + tl;
      if (qos > 0) {
        if (qos === 1) this.raw(packet(0x40, [body[p], body[p + 1]])); // PUBACK
        p += 2;
      }
      this.h.message(topic, dec.decode(body.subarray(p)));
    }
    // SUBACK / PINGRESP need no handling.
  }

  lost(ws) {
    if (ws !== this.ws) return;
    this.ws = null;
    const wasUp = this.up;
    this.up = false;
    clearInterval(this.pingTimer);
    if (wasUp) this.h.status();
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.closed) return;
    const delay = Math.min(15000, 1000 * 2 ** this.retry) + Math.random() * 500;
    this.retry = Math.min(this.retry + 1, 5);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  sendSubscribe(topic) {
    const id = this.pid;
    this.pid = (this.pid % 65535) + 1;
    this.raw(packet(0x82, [...u16(id), ...mqttString(topic), 0]));
  }

  sendPublish(topic, payload, retain) {
    const body = concat(new Uint8Array(mqttString(topic)), enc.encode(payload));
    this.raw(packet(0x30 | (retain ? 1 : 0), body));
  }

  subscribe(topic) {
    this.subs.add(topic);
    if (this.up) this.sendSubscribe(topic);
  }

  publish(topic, payload, retain) {
    if (this.up) this.sendPublish(topic, payload, retain);
    else if (retain) this.pending.set(topic, payload);
  }

  close() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    if (this.up) this.raw(packet(0xe0, []));
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.up = false;
  }
}

export class Link {
  constructor(code, { onMessage = () => {}, onStatus = () => {} } = {}) {
    this.code = code;
    this.base = PREFIX + code + '/';
    this.id = randomId();
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.seen = new Set();
    this.seenOrder = [];
    this.sockets = relayList().map(
      (url) =>
        new MqttSocket(url, {
          message: (topic, payload) => this.receive(topic, payload),
          status: () => this.onStatus(this.status()),
        }),
    );
    try {
      this.bc = new BroadcastChannel(PREFIX + code);
      this.bc.onmessage = (e) => {
        const d = e.data;
        if (d && typeof d.t === 'string' && typeof d.p === 'string') this.receive(this.base + d.t, d.p);
      };
    } catch {
      this.bc = null;
    }
  }

  status() {
    return { up: this.sockets.filter((s) => s.up).length, total: this.sockets.length };
  }

  subscribe(name) {
    for (const s of this.sockets) s.subscribe(this.base + name);
  }

  // data === null with retain clears the retained message on the relays.
  publish(name, data, retain = false) {
    const payload = data == null ? '' : JSON.stringify({ app: APP, mid: randomId(), from: this.id, d: data });
    for (const s of this.sockets) s.publish(this.base + name, payload, retain);
    if (this.bc && payload) this.bc.postMessage({ t: name, p: payload });
  }

  receive(topic, payload) {
    if (!topic.startsWith(this.base) || !payload || payload.length > 16000) return;
    let m;
    try {
      m = JSON.parse(payload);
    } catch {
      return;
    }
    if (!m || m.app !== APP || typeof m.mid !== 'string' || m.from === this.id) return;
    if (this.seen.has(m.mid)) return;
    this.seen.add(m.mid);
    this.seenOrder.push(m.mid);
    if (this.seenOrder.length > 400) this.seen.delete(this.seenOrder.shift());
    this.onMessage(topic.slice(this.base.length), m.d);
  }

  close() {
    for (const s of this.sockets) s.close();
    try {
      this.bc?.close();
    } catch {
      /* ignore */
    }
  }
}
