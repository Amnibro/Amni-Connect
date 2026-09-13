// v1.5.17: moves ride a lossy `move` channel, one per frame; the move before a click goes
// reliable on the input stream; the host drops moves whose seq went backwards.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const viewer = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf8');
const host = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('cannot extract ' + from);
  return src.slice(a, b);
}

function viewerSandbox(opts) {
  const sent = [];
  const chan = (label, open) => ({ readyState: open ? 'open' : 'closed', send: (m) => sent.push([label, JSON.parse(m)]) });
  let rafCb = null;
  const sb = {
    dataChannel: null, socket: { connected: false, emit: () => {} }, roomId: 'X',
    paintLinkChips: () => { sb.paints = (sb.paints || 0) + 1; },
    showToast: () => {}, setStatus: () => {}, Date,
    requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
    cancelAnimationFrame: () => { rafCb = null; },
    frame: () => { const cb = rafCb; rafCb = null; cb && cb(); },
    sent
  };
  vm.createContext(sb);
  vm.runInContext(extract(viewer, "let inputPath = 'none'", 'let lastRightClick = 0;'), sb);
  sb.__ic = chan('input', true);
  sb.__mc = chan('move', opts.moveOpen);
  vm.runInContext('inputChannel = __ic; moveChannel = __mc;', sb);
  return sb;
}

let fails = 0;
function check(name, ok, detail) { console.log((ok ? '  PASS ' : '  FAIL ') + name + (ok ? '' : ' :: ' + detail)); if (!ok) fails++; }

// 1. ten moves in one frame -> one packet on the move channel carrying the last position
{
  const sb = viewerSandbox({ moveOpen: true });
  for (let i = 0; i < 10; i++) sb.sendInput({ type: 'mouse-move', x: i / 10, y: 0.5 });
  check('no send before the frame', sb.sent.length === 0, JSON.stringify(sb.sent));
  sb.frame();
  check('one move per frame', sb.sent.length === 1, JSON.stringify(sb.sent));
  check('last position wins', sb.sent[0][1].ev.x === 0.9, JSON.stringify(sb.sent[0]));
  check('rides move channel with seq', sb.sent[0][0] === 'move' && sb.sent[0][1].seq === 1, JSON.stringify(sb.sent[0]));
  check('chips painted once, not per move', sb.paints === 1, String(sb.paints));
}
// 2. move then click -> the move flushes reliable on the input channel, before the click
{
  const sb = viewerSandbox({ moveOpen: true });
  sb.sendInput({ type: 'mouse-move', x: 0.3, y: 0.3 });
  sb.sendInput({ type: 'mouse-click' });
  check('move precedes click', sb.sent.length === 2 && sb.sent[0][1].ev.type === 'mouse-move' && sb.sent[1][1].ev.type === 'mouse-click', JSON.stringify(sb.sent));
  check('pre-click move is reliable', sb.sent[0][0] === 'input' && sb.sent[1][0] === 'input', JSON.stringify(sb.sent));
  check('reliable move still numbered', sb.sent[0][1].seq === 1 && sb.sent[1][1].seq === undefined, JSON.stringify(sb.sent));
  sb.frame();
  check('nothing left pending', sb.sent.length === 2, JSON.stringify(sb.sent));
}
// 3. trackpad deltas accumulate within a frame
{
  const sb = viewerSandbox({ moveOpen: true });
  sb.sendInput({ type: 'mouse-move-rel', dx: 0.01, dy: 0.02 });
  sb.sendInput({ type: 'mouse-move-rel', dx: 0.01, dy: -0.01 });
  sb.frame();
  const ev = sb.sent[0][1].ev;
  check('rel deltas summed', sb.sent.length === 1 && Math.abs(ev.dx - 0.02) < 1e-9 && Math.abs(ev.dy - 0.01) < 1e-9, JSON.stringify(sb.sent));
}
// 4. move channel not open -> falls back to the input channel, still one per frame
{
  const sb = viewerSandbox({ moveOpen: false });
  for (let i = 0; i < 5; i++) sb.sendInput({ type: 'mouse-move', x: 0.1 * i, y: 0 });
  sb.frame();
  check('fallback to input channel', sb.sent.length === 1 && sb.sent[0][0] === 'input', JSON.stringify(sb.sent));
}
// 5. host drops a move whose seq went backwards; a reload arrives on a fresh channel
{
  const sb = { lastMoveSeq: 0 };
  vm.createContext(sb);
  vm.runInContext(extract(host, 'function staleMove(seq)', 'function applyViewerMsg'), sb);
  const r = [sb.staleMove(1), sb.staleMove(3), sb.staleMove(2), sb.staleMove(4), sb.staleMove(undefined), sb.staleMove(1)];
  check('in-order accepted, late dropped, unnumbered passes', JSON.stringify(r) === JSON.stringify([false, false, true, false, false, true]), JSON.stringify(r));
  check('a viewer reload is a new channel: host resets the counter on open', /onopen = \(\) => \{ lastMoveSeq = 0;/.test(host), '');
}
// 6. host creates the lossy channel and the viewer listens for it
check('host creates move channel unordered/no-retransmit', /createDataChannel\('move', \{ ordered: false, maxRetransmits: 0/.test(host), '');
check('viewer binds move channel', viewer.includes("e.channel.label === 'move'"), '');
check('host filters stale moves before IPC', /staleMove\(data\.seq\)\)[^\n]*return;/.test(host) && host.indexOf('staleMove(data.seq)') < host.indexOf('sendInputEvent(data.ev)'), '');

// Sensitivity: the v1.5.16 backup must fail the coalescing check
{
  const bak = path.join(__dirname, '..', 'backups', 'viewer.html.v1.5.16_pre_move_channel.bak');
  if (fs.existsSync(bak)) {
    const old = fs.readFileSync(bak, 'utf8');
    const sent = [];
    const sb = { dataChannel: null, socket: { connected: false }, roomId: 'X', paintLinkChips: () => {}, showToast: () => {}, setStatus: () => {}, Date, sent };
    vm.createContext(sb);
    vm.runInContext(extract(old, "let inputPath = 'none'", 'let lastRightClick = 0;'), sb);
    sb.__ic = { readyState: 'open', send: (m) => sent.push(JSON.parse(m)) };
    vm.runInContext('inputChannel = __ic;', sb);
    for (let i = 0; i < 10; i++) sb.sendInput({ type: 'mouse-move', x: i / 10, y: 0.5 });
    console.log('  sensitivity: backup sends ' + sent.length + ' packets for 10 moves (fix sends 1)');
    if (sent.length !== 10) fails++;
  }
}
console.log(fails ? fails + ' FAILED' : 'all pass');
process.exit(fails ? 1 : 0);
