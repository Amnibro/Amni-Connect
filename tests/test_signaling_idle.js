// Console isolation + idle websocket timeouts. Live wait proves :3389 no longer
// kills a quiet socket.io client at 10s (the v1.5.6 server.timeout).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const io = require('socket.io-client');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const rustMain = fs.readFileSync(path.join(root, 'rust', 'src', 'main.rs'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok', name);
  else { console.log('FAIL', name); fail++; }
}

ok('windowsHide spawn', /windowsHide:\s*true/.test(mainJs) && /detached:\s*process\.platform === 'win32'/.test(mainJs));
ok('windows subsystem', rustMain.includes('windows_subsystem = "windows"') && rustMain.includes('FreeConsole'));
ok('no short server.timeout', /server\.timeout\s*=\s*0/.test(serverJs) && /server\.requestTimeout\s*=\s*0/.test(serverJs));
ok('headersTimeout long enough for tunnel', /server\.headersTimeout\s*=\s*60000/.test(serverJs) && /server\.keepAliveTimeout\s*=\s*65000/.test(serverJs));
ok('cors defaults to star', /ALLOWED_ORIGINS === '\*'\)/.test(serverJs) && /!\s*process\.env\.ALLOWED_ORIGINS/.test(serverJs));
ok('close hides not quits', /window hidden — signaling still listening/.test(mainJs));
ok('minimize hides not throttles', /window hidden — minimize/.test(mainJs) && /setRelayedInput/.test(mainJs));
ok('viewer-joined keeps live pc for the same viewer', /keeping live WebRTC/.test(indexHtml) && /info\.id === lastViewerId/.test(indexHtml));

const PORT = 33991;
const child = spawn(process.execPath, [path.join(root, 'server.js')], {
  env: { ...process.env, PORT: String(PORT), ALLOWED_ORIGINS: '*' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let buf = '';
const ready = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server start timeout')), 8000);
  const onData = (d) => {
    buf += d.toString();
    if (buf.includes('signaling server on port')) { clearTimeout(t); resolve(); }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (c) => reject(new Error('server exited ' + c + '\n' + buf)));
});

(async () => {
  try {
    await ready;
    const sock = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => {
      sock.on('connect', resolve);
      sock.on('connect_error', reject);
      setTimeout(() => reject(new Error('connect timeout')), 5000);
    });
    await new Promise((r) => setTimeout(r, 11000));
    ok('websocket still up after 11s', sock.connected);
    sock.close();
  } catch (e) {
    ok('live idle websocket (' + e.message + ')', false);
  } finally {
    child.kill();
    console.log(fail ? fail + ' failed' : 'all pass');
    process.exit(fail ? 1 : 0);
  }
})();
