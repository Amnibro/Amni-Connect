const { spawnSync, spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BIN = process.argv[2] || path.join(__dirname, '..', 'rust', 'target', 'release', 'amni-control.exe');
const CTL = Number(process.env.TEST_CTL_PORT || 7978);
const VID = Number(process.env.TEST_VIDEO_PORT || 7979);
const HOLD_MS = Number(process.env.TEST_HOLD_MS || 30000);
const GROWTH_MB = Number(process.env.TEST_GROWTH_MB || 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = (pid) => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`], { encoding: 'utf8' });
  return Math.round(Number((r.stdout || '0').trim() || 0) / 1048576);
};
const alive = (pid) => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Count`], { encoding: 'utf8' });
  return Number((r.stdout || '0').trim()) > 0;
};
const connect = (port) => new Promise((res, rej) => {
  const s = net.createConnection({ host: '127.0.0.1', port }, () => res(s));
  s.on('error', rej);
});
const fail = (msg) => { console.log(`FAIL ${msg}`); process.exitCode = 1; };
(async () => {
  fs.existsSync(BIN) || (() => { throw new Error(`missing binary ${BIN}`); })();
  const appdata = fs.mkdtempSync(path.join(os.tmpdir(), 'amni-leak-'));
  const log = path.join(appdata, 'amni-connect', 'amni-control.log');
  const child = spawn(BIN, [], { env: { ...process.env, APPDATA: appdata, AMNI_CTL_PORT: String(CTL), AMNI_VIDEO_PORT: String(VID) }, stdio: 'ignore', windowsHide: true });
  const pid = child.pid;
  console.log(`binary=${path.basename(BIN)} pid=${pid} ctl=${CTL} video=${VID}`);
  try {
    await sleep(2500);
    const video = await connect(VID);
    let bytes = 0;
    let atTen = 0;
    video.on('data', (b) => { bytes += b.length; });
    const ctl = await connect(CTL);
    ctl.write(JSON.stringify({ type: 'capture-start', fps: 60, kbps: 12000, output: 0 }) + '\n');
    await sleep(3000);
    const base = ws(pid);
    let peak = base;
    for (let waited = 0; waited < HOLD_MS; waited += 2000) {
      await sleep(2000);
      alive(pid) && (peak = Math.max(peak, ws(pid)));
      waited === 8000 && (atTen = bytes);
    }
    const tail = bytes - atTen;
    const up = alive(pid);
    const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    const oom = /0x8007000E|Not enough memory/i.test(text);
    const died = /capture (membuf|loop ended|session)/i.test(text);
    console.log(`working set base=${base}MB peak=${peak}MB growth=${peak - base}MB`);
    console.log(`video bytes total=${bytes} after-first-10s=${tail} process alive=${up}`);
    console.log(`daemon log oom=${oom} capture-error=${died}`);
    oom && fail('the encoder ran out of memory, so hardware capture dies and the viewer falls back to Chromium');
    peak - base > GROWTH_MB && fail(`working set grew ${peak - base}MB over ${HOLD_MS / 1000}s, the encoder is leaking every frame`);
    tail <= 0 && fail('no encoded video after the first 10 seconds, hardware capture stopped');
    up || fail('the daemon exited during capture');
    process.exitCode || console.log(`PASS hardware capture held ${HOLD_MS / 1000}s with flat memory`);
  } finally {
    try { child.kill(); } catch (e) { void e; }
    await sleep(600);
    alive(pid) && spawnSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`]);
    await sleep(400);
    console.log(`cleanup: leftover processes for pid ${pid}: ${alive(pid) ? 1 : 0}`);
  }
})();
