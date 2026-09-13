const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const io = require('socket.io-client');
const root = path.join(__dirname, '..');
const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const viewerHtml = fs.readFileSync(path.join(root, 'viewer.html'), 'utf8');
let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'ok' : 'FAIL') + ' ' + name); cond || fail++; };
ok('rooms stay after the host socket drops', /Keep the room/.test(serverJs) && !/HOST_GRACE_MS/.test(serverJs));
ok('last room code is persisted', /room\.json/.test(serverJs) && /loadStickyRoom/.test(serverJs));
ok('host republishes the room on a timer', /_roomPulse/.test(indexHtml));
ok('a new viewer still gets an offer while another pc is live', /lastViewerId/.test(indexHtml) && /viewerId === lastViewerId/.test(indexHtml));
ok('viewer sanitizes room code', viewerHtml.includes(".replace(/\\s+/g, '-')") && viewerHtml.includes(".replace(/[^A-Z0-9-]/g, '')"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amni-rooms-'));
fs.mkdirSync(path.join(tmp, 'amni-connect'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'amni-connect', 'room.json'), JSON.stringify({ id: 'ANTMAN-PC' }));
fs.writeFileSync(path.join(tmp, 'amni-connect', 'tunnel.json'), JSON.stringify({ hostname: 'connect.test.example', token: 'x' }));
const PORT = 33994;
const child = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, PORT: String(PORT), APPDATA: tmp, ALLOWED_ORIGINS: '*' }, stdio: ['ignore', 'pipe', 'pipe'] });
const req = (method, p, headers = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, json: j }); }); });
  r.on('error', reject); r.end();
});
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const sock = (extra = {}) => io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], extraHeaders: extra });
(async () => {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { await wait(200); try { up = (await req('GET', '/health')).status === 200; } catch (_) {} }
  ok('test server up', up);
  const listed = (await req('GET', '/rooms')).json;
  ok('sticky room exists before any host connects', listed && listed.rooms && listed.rooms.some(r => r.id === 'ANTMAN-PC' && r.host === false));
  const early = await new Promise((resolve) => {
    const s = sock();
    const t = setTimeout(() => { s.close(); resolve('timeout'); }, 3000);
    s.on('connect', () => s.emit('join-room', 'antman pc'));
    s.on('room-joined', (id) => { clearTimeout(t); s.close(); resolve(id); });
    s.on('error', (e) => { clearTimeout(t); s.close(); resolve(String(e)); });
  });
  ok('join with spaces still hits the sticky code', early === 'ANTMAN-PC');
  const host = sock();
  const created = await new Promise((resolve) => {
    host.on('connect', () => host.emit('create-room', 'ANTMAN-PC'));
    host.on('room-created', resolve);
  });
  ok('host claims the sticky room', created === 'ANTMAN-PC');
  let joinedN = 0;
  host.on('viewer-joined', () => joinedN++);
  const waiter = sock();
  await new Promise((resolve) => { waiter.on('connect', () => waiter.emit('join-room', 'ANTMAN-PC')); waiter.on('room-joined', resolve); });
  await wait(100);
  const afterFirst = joinedN;
  ok('join notifies the host once', afterFirst === 1);
  host.emit('create-room', 'ANTMAN-PC');
  await wait(200);
  ok('same-host reclaim does not re-fire viewer-joined', joinedN === afterFirst);
  waiter.close();
  host.close();
  await wait(200);
  const afterDrop = await new Promise((resolve) => {
    const s = sock();
    const t = setTimeout(() => { s.close(); resolve('timeout'); }, 3000);
    s.on('connect', () => s.emit('join-room', 'ANTMAN-PC'));
    s.on('room-joined', (id) => { clearTimeout(t); s.close(); resolve(id); });
    s.on('error', (e) => { clearTimeout(t); s.close(); resolve(String(e)); });
  });
  ok('join still works after the host socket drops', afterDrop === 'ANTMAN-PC');
  ok('/rooms is loopback only', (await req('GET', '/rooms', { Host: 'connect.test.example' })).status === 403);
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `${fail} FAILED` : 'all ok');
  process.exit(fail ? 1 : 0);
})();
