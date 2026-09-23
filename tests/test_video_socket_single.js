const fs = require('fs');
const net = require('net');
const path = require('path');
const TARGET = process.argv[2] || path.join(__dirname, '..', 'main.js');
const PORT = Number(process.env.TEST_VIDEO_PORT || 7989);
const HW_MAGIC = 0x31434E41;
const SIZE = 40000;
const src = fs.readFileSync(TARGET, 'utf8');
const carve = (name) => {
  const at = src.indexOf(`function ${name}(`);
  at < 0 && (() => { throw new Error(`${name} not found in ${TARGET}`); })();
  let i = src.indexOf('{', at);
  for (let depth = 0, j = i; j < src.length; j++) {
    src[j] === '{' && depth++;
    src[j] === '}' && --depth === 0 && (i = j + 1, j = src.length);
  }
  return src.slice(at, i);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (mark) => {
  const h = Buffer.alloc(16);
  h.writeUInt32LE(HW_MAGIC, 0);
  h.writeUInt32LE(SIZE, 4);
  h.writeUInt16LE(2, 8);
  h.writeUInt16LE(1, 10);
  h.writeUInt32LE(7, 12);
  return Buffer.concat([h, Buffer.alloc(SIZE, mark)]);
};
const fail = (msg) => { console.log(`FAIL ${msg}`); process.exitCode = 1; };
(async () => {
  console.log(`target=${path.relative(path.join(__dirname, '..'), TARGET)}`);
  const live = [];
  const server = net.createServer((sock) => {
    const mark = 0xa0 + live.length;
    live.push(sock);
    sock.on('error', () => {});
    const f = frame(mark);
    sock.write(f.subarray(0, 9000));
    setTimeout(() => sock.writable && sock.write(f.subarray(9000)), 300);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const ctx = {
    net, VIDEO_PORT: PORT, HW_MAGIC, Buffer, Date, videoClient: null, videoBuf: Buffer.alloc(0),
    helloWait: null, hwPending: false, hwPendingAt: 0, got: [],
    mainWindow: { webContents: { send: (ch, m) => ch === 'hw-video' && ctx.got.push(m) } }
  };
  const api = new Function('ctx', `with (ctx) { ${carve('onVideoData')} ; ${carve('connectVideoClient')} ; return { connectVideoClient, onVideoData }; }`)(ctx);
  ctx.onVideoData = api.onVideoData;
  api.connectVideoClient();
  await sleep(200);
  ctx.videoClient?.destroy();
  api.connectVideoClient();
  await sleep(150);
  api.connectVideoClient();
  await sleep(900);
  const open = live.filter((s) => !s.destroyed).length;
  const bad = ctx.got.filter((m) => m.payload.length !== SIZE || m.payload.some((b) => b !== m.payload[0])).length;
  console.log(`sockets the host opened=${live.length} still open=${open}`);
  console.log(`frames delivered=${ctx.got.length} spliced or wrong length=${bad}`);
  open === 1 || fail(`the host holds ${open} video sockets at once, so two ANC1 streams append into one videoBuf and every frame parses from the wrong bytes`);
  bad === 0 || fail(`${bad} delivered frames are spliced from more than one socket, which is a black screen with working input`);
  ctx.got.length > 0 || fail('no frame reached the renderer at all');
  process.exitCode || console.log('PASS one video socket, frames arrive whole');
  live.forEach((s) => s.destroy());
  ctx.videoClient?.destroy();
  server.close();
})();
