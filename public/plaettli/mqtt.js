// Minimal MQTT 3.1.1 client over WebSocket: connect (with last will), subscribe,
// publish (QoS 0/1, retained), keepalive and automatic reconnect. No dependencies.
const enc = new TextEncoder();
const dec = new TextDecoder();

function varint(n) {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0);
  return out;
}
const str = (s) => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
const packet = (first, body) => new Uint8Array([first, ...varint(body.length), ...body]);

export class Mqtt {
  /**
   * opts: { will: { topic, payload, retain }, keepalive, onMessage(topic, text), onStatus(online) }
   */
  constructor(url, opts = {}) {
    this.url = url;
    this.opts = { keepalive: 30, ...opts };
    this.subs = [];
    this.ids = 1;
    this.acks = new Map();
    this.closed = false;
    this.online = false;
    this.backoff = 1000;
  }

  connect() {
    if (this.closed) return Promise.reject(new Error('closed'));
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.url, ['mqtt']); } catch (e) { this.ready = null; return reject(e); }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let buf = new Uint8Array(0);
      const fail = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.ready = null;
        clearInterval(this.pinger);
        if (this.online) { this.online = false; this.opts.onStatus?.(false); }
        for (const [, a] of this.acks) a.reject(new Error('disconnected'));
        this.acks.clear();
        reject(new Error('disconnected'));
        if (!this.closed) {
          clearTimeout(this.retry);
          this.retry = setTimeout(() => this.connect().catch(() => {}), this.backoff);
          this.backoff = Math.min(this.backoff * 2, 15000);
        }
      };
      ws.onerror = fail;
      ws.onclose = fail;
      ws.onopen = () => {
        const w = this.opts.will;
        const clientId = `pl${Math.random().toString(36).slice(2, 12)}`;
        let flags = 0x02; // clean session
        let payload = str(clientId);
        if (w) {
          flags |= 0x04 | (w.retain ? 0x20 : 0);
          const msg = enc.encode(w.payload ?? '');
          payload = [...payload, ...str(w.topic), msg.length >> 8, msg.length & 255, ...msg];
        }
        const ka = this.opts.keepalive;
        ws.send(packet(0x10, [...str('MQTT'), 4, flags, ka >> 8, ka & 255, ...payload]));
      };
      ws.onmessage = (e) => {
        const chunk = new Uint8Array(e.data);
        const merged = new Uint8Array(buf.length + chunk.length);
        merged.set(buf); merged.set(chunk, buf.length);
        buf = merged;
        for (;;) {
          if (buf.length < 2) break;
          let len = 0, mult = 1, i = 1, b;
          do { if (i >= buf.length) { len = -1; break; } b = buf[i++]; len += (b & 127) * mult; mult *= 128; } while (b & 128);
          if (len < 0 || buf.length < i + len) break;
          this.handle(buf[0], buf.subarray(i, i + len), resolve, fail);
          buf = buf.slice(i + len);
        }
      };
    });
    return this.ready;
  }

  handle(first, body, resolve, fail) {
    const type = first >> 4;
    if (type === 2) { // CONNACK
      if (body[1] !== 0) return fail();
      this.online = true;
      this.backoff = 1000;
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.send(new Uint8Array([0xc0, 0])), this.opts.keepalive * 500);
      this.subAck = this.subs.length ? this.sendSubscribe(this.subs) : Promise.resolve();
      this.opts.onStatus?.(true);
      resolve();
    } else if (type === 3) { // PUBLISH
      const qos = (first >> 1) & 3;
      const tlen = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tlen));
      let p = 2 + tlen;
      if (qos > 0) { this.send(new Uint8Array([0x40, 2, body[p], body[p + 1]])); p += 2; }
      this.opts.onMessage?.(topic, dec.decode(body.subarray(p)));
    } else if (type === 4 || type === 9) { // PUBACK / SUBACK
      const id = (body[0] << 8) | body[1];
      this.acks.get(id)?.resolve();
      this.acks.delete(id);
    }
  }

  send(bytes) { if (this.ws?.readyState === 1) this.ws.send(bytes); }

  nextId() { this.ids = (this.ids % 65535) + 1; return this.ids; }

  waitAck(id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.acks.delete(id); reject(new Error('timeout')); }, 8000);
      this.acks.set(id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    });
  }

  sendSubscribe(topics) {
    const id = this.nextId();
    const body = [id >> 8, id & 255];
    for (const t of topics) body.push(...str(t), 0);
    const ack = this.waitAck(id);
    this.send(packet(0x82, body));
    return ack;
  }

  /** Subscribes now and again after every reconnect (retained messages arrive each time). */
  async subscribe(topics) {
    this.subs.push(...topics);
    if (this.online) return this.sendSubscribe(topics);
    await this.connect(); // CONNACK subscribes to everything in this.subs
    return this.subAck;
  }

  /** payload '' with retain:true deletes the retained message. */
  async publish(topic, payload, { retain = false, qos = 0 } = {}) {
    if (!this.online) await this.connect(); // while connected this sends right away (no await before send)
    const msg = enc.encode(payload);
    const body = [...str(topic)];
    let ack;
    if (qos > 0) { const id = this.nextId(); body.push(id >> 8, id & 255); ack = this.waitAck(id); }
    this.send(packet(0x30 | (qos << 1) | (retain ? 1 : 0), [...body, ...msg]));
    return ack;
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    clearInterval(this.pinger);
    try { this.send(new Uint8Array([0xe0, 0])); this.ws?.close(); } catch { /* already closed */ }
    this.ws = null;
  }
}
