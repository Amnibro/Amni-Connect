const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function pngRGBA(w, h, px) {
  const raw = Buffer.alloc((1 + w * 4) * h);
  for (let y = 0; y < h; y++) {
    raw[(1 + w * 4) * y] = 0;
    px.copy(raw, (1 + w * 4) * y + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function fill(w, h) {
  const p = Buffer.alloc(w * h * 4);
  const cx = (w - 1) / 2, cy = (h - 1) / 2, r = w * 0.38;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy), i = (y * w + x) * 4;
      if (d <= r) { p[i] = 0xc8; p[i + 1] = 0x9b; p[i + 2] = 0x4e; p[i + 3] = 255; }
      else if (d <= r + 1.4) { p[i] = 0x5a; p[i + 1] = 0x48; p[i + 2] = 0xb0; p[i + 3] = 255; }
    }
  }
  return p;
}
function icoFromPng(png, w) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);
  const ent = Buffer.alloc(16);
  ent[0] = w === 256 ? 0 : w;
  ent[1] = w === 256 ? 0 : w;
  ent.writeUInt16LE(1, 4);
  ent.writeUInt16LE(32, 6);
  ent.writeUInt32LE(png.length, 8);
  ent.writeUInt32LE(22, 12);
  return Buffer.concat([dir, ent, png]);
}
const dest = path.join(__dirname, '..', 'assets');
fs.mkdirSync(dest, { recursive: true });
const png32 = pngRGBA(32, 32, fill(32, 32));
const png256 = pngRGBA(256, 256, fill(256, 256));
fs.writeFileSync(path.join(dest, 'icon.png'), png32);
fs.writeFileSync(path.join(dest, 'icon.ico'), icoFromPng(png256, 256));
console.log('wrote', png32.length, 'png +', png256.length, 'ico');
