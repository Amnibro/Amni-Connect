// Pulls the REAL origin-resolution lines out of viewer.html and drives them against
// mocked location/host values, the same way tests/test_zoom_input_gate.js extracts the
// real touchmove handler instead of retyping it.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf8');

const m = src.match(/const proto = location\.protocol[\s\S]*?const origin = [^\n]*\n/);
if (!m) { console.error('FAIL: could not extract origin resolution from viewer.html'); process.exit(1); }
const body = m[0];
console.log('extracted from viewer.html:');
console.log(body.trim().split('\n').map(l => '    ' + l.trim()).join('\n'));
console.log();

const resolve = new Function('location', 'host', body + '\nreturn origin;');

const cases = [
  // page served on...                     host param            expected socket origin
  [{ protocol: 'http:',  port: '3389' }, '192.168.1.216',      'http://192.168.1.216:3389',      'LAN, explicit 3389'],
  [{ protocol: 'https:', port: ''     }, 'x.trycloudflare.com','https://x.trycloudflare.com:443','tunnel on default 443'],
  [{ protocol: 'https:', port: ''     }, 'm.tailnet.ts.net',   'https://m.tailnet.ts.net:443',   'Tailscale Funnel'],
  [{ protocol: 'http:',  port: '34389'}, 'home.duckdns.org',   'http://home.duckdns.org:34389',  'forwarded custom port'],
  [{ protocol: 'https:', port: '8443' }, 'rd.example.com',     'https://rd.example.com:8443',    'https non-default port'],
  [{ protocol: 'http:',  port: ''     }, '1.2.3.4',            'http://1.2.3.4:3389',            'http default 80 falls to 3389'],
  [{ protocol: 'http:',  port: '3389' }, '1.2.3.4:34389',      'http://1.2.3.4:34389',           'host carries its own port'],
];

let pass = 0, fail = 0;
for (const [loc, host, expect, label] of cases) {
  const got = resolve(loc, host);
  const ok = got === expect;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(30)} ${got}`);
  if (!ok) console.log(`        expected ${expect}`);
}
console.log(`\n${pass} passed, ${fail} failed`);

// the pre-fix line, to prove the test is actually sensitive to the bug
const old = new Function('location', 'host',
  "const port = location.port || 3389;\nconst proto = location.protocol === 'https:' ? 'https' : 'http';\nreturn `${proto}://${host}:${port}`;");
const brokeOn = old({ protocol: 'https:', port: '' }, 'x.trycloudflare.com');
console.log(`\nsensitivity check: the old line produced ${brokeOn} for the tunnel case`);
console.log(`  regression caught: ${brokeOn !== 'https://x.trycloudflare.com:443'}`);
process.exit(fail ? 1 : 0);
