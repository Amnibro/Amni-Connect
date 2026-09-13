const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const serverPath = process.argv[2] || path.join(root, 'server.js');
const viewerPath = process.argv[3] || path.join(root, 'viewer.html');
const indexPath = process.argv[4] || path.join(root, 'index.html');
const serverJs = fs.readFileSync(serverPath, 'utf8');
const viewer = fs.readFileSync(viewerPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'ok' : 'FAIL') + ' ' + name); cond || fail++; };
ok('server treats 100.64/10 meshnet as a direct peer address', /100\\\.\(6\[4-9\]/.test(serverJs) && /function lanIp/.test(serverJs));
ok('server exposes /ice-servers', /app\.get\('\/ice-servers'/.test(serverJs));
ok('viewer loads ICE from the host before joining', /await loadIce\(origin\); socket\.emit\('join-room'/.test(viewer) && /let ICE = /.test(viewer));
ok('host loads ICE on signaling connect', /loadIce\(\);/.test(index) && /let ICE_SERVERS = /.test(index));
const PORT = 33992, SECRET = 'a'.repeat(64), URL_ = 'turn:203.0.113.9:3478';
const child = spawn(process.execPath, [serverPath], { env: { ...process.env, PORT: String(PORT), AMNI_CHAT_TURN_SECRET: SECRET, AMNI_CHAT_TURN_URL: URL_ }, stdio: ['ignore', 'pipe', 'pipe'] });
const get = (p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => resolve({ status: r.statusCode, body: b })); }).on('error', reject));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { await wait(200); try { up = (await get('/viewer')).status === 200; } catch (_) {} }
  ok('test server up', up);
  let j = null;
  try { j = JSON.parse((await get('/ice-servers')).body); } catch (_) {}
  ok('/ice-servers returns JSON with turn', !!j && j.turn === true && Array.isArray(j.iceServers));
  const turn = j && j.iceServers.find(s => (s.urls || []).includes(URL_));
  ok('TURN entry carries expiry:amni username', !!turn && /^\d+:amni$/.test(turn.username || ''));
  ok('credential is base64 HMAC-SHA1(secret, username)', !!turn && turn.credential === crypto.createHmac('sha1', SECRET).update(turn.username).digest('base64'));
  ok('username expiry is in the future', !!turn && +turn.username.split(':')[0] > Math.floor(Date.now() / 1000) + 3600);
  child.kill();
  console.log(fail ? `${fail} FAILED` : 'all ok');
  process.exit(fail ? 1 : 0);
})();
