const dgram = require('dgram');
const crypto = require('crypto');
const http = require('http');
const target = (process.argv[2] || 'http://127.0.0.1:3389');
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(b)); }).on('error', rej));
const MAGIC = 0x2112A442;
function attr(type, val) { const pad = (4 - (val.length % 4)) % 4; const h = Buffer.alloc(4); h.writeUInt16BE(type, 0); h.writeUInt16BE(val.length, 2); return Buffer.concat([h, val, Buffer.alloc(pad)]); }
function msg(type, attrs, tid) { const h = Buffer.alloc(20); h.writeUInt16BE(type, 0); h.writeUInt16BE(attrs.length, 2); h.writeUInt32BE(MAGIC, 4); tid.copy(h, 8); return Buffer.concat([h, attrs]); }
function withIntegrity(type, attrs, tid, key) { const body = Buffer.concat(attrs); const pre = msg(type, Buffer.concat([body, Buffer.alloc(24)]), tid); const mac = crypto.createHmac('sha1', key).update(pre.subarray(0, 20 + body.length)).digest(); return msg(type, Buffer.concat([body, attr(0x0008, mac)]), tid); }
function parse(buf) { const out = { type: buf.readUInt16BE(0), attrs: {} }; let o = 20; const end = 20 + buf.readUInt16BE(2); while (o + 4 <= end) { const t = buf.readUInt16BE(o), l = buf.readUInt16BE(o + 2); out.attrs[t] = buf.subarray(o + 4, o + 4 + l); o += 4 + l + ((4 - (l % 4)) % 4); } return out; }
function xorAddr(v, tid) { const port = v.readUInt16BE(2) ^ (MAGIC >>> 16); const ip = [...v.subarray(4, 8)].map((b, i) => b ^ Buffer.from([0x21, 0x12, 0xA4, 0x42])[i]).join('.'); return ip + ':' + port; }
(async () => {
  const j = JSON.parse(await get(target + '/ice-servers'));
  const turn = j.iceServers.find(s => (s.urls || []).some(u => u.startsWith('turn:')));
  if (!turn) { console.log('no TURN entry from', target); process.exit(1); }
  const [host, port] = turn.urls[0].replace('turn:', '').split(':');
  const sock = dgram.createSocket('udp4');
  const send = (b) => sock.send(b, +port, host);
  const tid = () => crypto.randomBytes(12);
  let t1 = tid(), t2 = null, realm = null, nonce = null, phase = 'binding';
  const timer = setTimeout(() => { console.log('TIMEOUT in phase', phase, '->', host + ':' + port, 'unreachable from here'); process.exit(2); }, 5000);
  sock.on('message', (buf) => {
    const p = parse(buf);
    if (phase === 'binding' && p.type === 0x0101) { console.log('STUN binding ok, mapped', xorAddr(p.attrs[0x0020], t1)); phase = 'alloc1'; t2 = tid(); send(msg(0x0003, attr(0x0019, Buffer.from([17, 0, 0, 0])), t2)); return; }
    if (phase === 'alloc1' && p.type === 0x0113) { realm = p.attrs[0x0014].toString(); nonce = p.attrs[0x0015]; phase = 'alloc2'; const key = crypto.createHash('md5').update(`${turn.username}:${realm}:${turn.credential}`).digest(); const t3 = tid(); t2 = t3; send(withIntegrity(0x0003, [attr(0x0019, Buffer.from([17, 0, 0, 0])), attr(0x0006, Buffer.from(turn.username)), attr(0x0014, Buffer.from(realm)), attr(0x0015, nonce)], t3, key)); return; }
    if (phase === 'alloc2') { clearTimeout(timer); if (p.type === 0x0103) { console.log('TURN ALLOCATE OK relayed', xorAddr(p.attrs[0x0016], t2), 'realm', realm); process.exit(0); } const e = p.attrs[0x0009]; console.log('TURN allocate rejected', e ? (e[2] * 100 + e[3]) + ' ' + e.subarray(4).toString() : 'type ' + p.type.toString(16)); process.exit(3); }
  });
  send(msg(0x0001, Buffer.alloc(0), t1));
})();
