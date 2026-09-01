const fs = require('fs');
const path = require('path');
const vh = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf8');
const ih = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sj = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function sliceFn(src, name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unclosed ' + name);
}
const g = { ourLan: '', peerLan: '' };
eval(sliceFn(vh, 'rfc1918') + '\n' + sliceFn(vh, 'classifyIcePath') + '\n' + sliceFn(vh, 'rewriteLocal') + '\n' + sliceFn(vh, 'mungeSdp') + '\n' + sliceFn(vh, 'keyFromDom') + '\n' + sliceFn(sj, 'sockIp') + '\n' + sliceFn(sj, 'lanIp'));
let fail = 0;
function ok(name, cond) { if (!cond) { console.error('FAIL', name); fail++; } else console.log('ok', name); }
ok('priv 192', rfc1918('192.168.1.20'));
ok('priv 10', rfc1918('10.0.0.5'));
ok('priv 172', rfc1918('172.16.4.1'));
ok('not pub', !rfc1918('8.8.8.8'));
ok('not empty', !rfc1918(''));
const hostHost = classifyIcePath({ localCandidateId: 'l', remoteCandidateId: 'r' }, { l: { candidateType: 'host', address: 'uuid.local' }, r: { candidateType: 'host', address: '192.168.1.4' } });
ok('mdns host-host is lan', hostHost.lan && hostHost.label === 'lan host-host');
const stun = classifyIcePath({ localCandidateId: 'l', remoteCandidateId: 'r' }, { l: { candidateType: 'srflx', address: '1.2.3.4' }, r: { candidateType: 'srflx', address: '5.6.7.8' } });
ok('srflx is wan', !stun.lan && stun.label === 'wan srflx-srflx');
ok('rfc1918 prflx is lan', classifyIcePath({ localCandidateId: 'l', remoteCandidateId: 'r' }, { l: { candidateType: 'prflx', address: '10.0.0.2' }, r: { candidateType: 'prflx', address: '10.0.0.9' } }).lan);
const ev = keyFromDom({ type: 'keydown', key: ' ', code: 'Space' });
ok('space maps', ev.key === 'Space' && ev.type === 'key-down' && ev.code === 'Space');
ok('letter', keyFromDom({ type: 'keyup', key: 'a', code: 'KeyA' }).code === 'KeyA');
const rw = rewriteLocal({ candidate: 'candidate:1 1 udp 2122260223 abcdef.local 54321 typ host', sdpMid: '0' }, '192.168.1.40');
ok('rewrite mdns', rw && rw.candidate.includes('192.168.1.40') && !rw.candidate.includes('.local'));
ok('rewrite skip stun', rewriteLocal({ candidate: 'candidate:2 1 udp 1686052607 8.8.8.8 9 typ srflx' }, '192.168.1.40') === null);
ok('strip mapped', lanIp(sockIp({ handshake: { address: '::ffff:10.1.2.3' } })) === '10.1.2.3');
ok('drop public', lanIp(sockIp({ handshake: { address: '8.8.8.8' } })) === '');
const ms = mungeSdp({ type: 'offer', sdp: 'a=candidate:1 1 UDP 2122260223 deadbeef.local 9 typ host\r\n' }, '192.168.4.8');
ok('sdp munge', ms.sdp.includes('192.168.4.8') && !ms.sdp.includes('.local'));
ok('host ships munge', ih.includes('function setLocalMunged') && ih.includes('await setLocalMunged(await pc.createOffer())'));
if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('all pass');
