const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const BIN = process.argv[2] || path.join(__dirname, '..', 'rust', 'target', 'release', 'amni-control.exe');
const MAGIC = 0x31434E41, KIND_HELLO = 1;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function parse(buf, onPkt) {
    let b = buf;
    while (b.length >= 16) {
        if (b.readUInt32LE(0) !== MAGIC) { b = b.subarray(1); continue; }
        const len = b.readUInt32LE(4);
        if (b.length < 16 + len) break;
        onPkt(b.readUInt16LE(8), b.subarray(16, 16 + len));
        b = b.subarray(16 + len);
    }
    return b;
}
async function connect(port) {
    return new Promise((res, rej) => {
        const s = new net.Socket();
        s.once('error', rej);
        s.connect(port, '127.0.0.1', () => res(s));
    });
}
(async () => {
    const proc = spawn(BIN, [], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    await wait(1500);
    let ctl, vid;
    try { ctl = await connect(7878); vid = await connect(7879); }
    catch (e) { proc.kill(); console.log('FAIL could not connect: ' + e.message); process.exit(1); }
    let hellos = 0, tail = Buffer.alloc(0);
    vid.on('data', c => { tail = parse(Buffer.concat([tail, c]), (kind) => { if (kind === KIND_HELLO) hellos++; }); });
    ctl.write(JSON.stringify({ type: 'capture-start', fps: 30, kbps: 4000, output: 0 }) + '\n');
    await wait(3000);
    const first = hellos;
    ctl.write(JSON.stringify({ type: 'capture-start', fps: 30, kbps: 4000, output: 0 }) + '\n');
    await wait(3000);
    const second = hellos;
    ctl.write(JSON.stringify({ type: 'capture-stop' }) + '\n');
    await wait(400);
    ctl.destroy(); vid.destroy(); proc.kill();
    console.log('binary=' + path.basename(BIN));
    console.log('hello after first capture-start: ' + first);
    console.log('hello after second capture-start: ' + second);
    if (first < 1) { console.log('FAIL no hello on the first capture-start (capture never opened): ' + err.trim().split('\n').slice(-3).join(' | ')); process.exit(1); }
    if (second <= first) { console.log('FAIL second capture-start on a live session sent no hw-hello, so a renderer reload can never re-attach'); process.exit(1); }
    console.log('PASS hw-hello re-broadcast on capture-start for a live session');
})();
