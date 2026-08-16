const fs = require('fs');
const path = require('path');
const START = "overlay.addEventListener('touchmove', (e) => {";
const END = '}, { passive: false });';
function extractTouchmove(file) {
  const src = fs.readFileSync(file, 'utf8');
  const i = src.indexOf(START);
  if (i < 0) throw new Error(`touchmove handler not found in ${file}`);
  const open = i + START.length;
  const close = src.indexOf(END, open);
  if (close < 0) throw new Error(`touchmove terminator not found in ${file}`);
  return src.slice(open, src.lastIndexOf('}', close));
}
function makeHandler(body) {
  return new Function('sandbox', 'e', `with (sandbox) { ${body} }`);
}
function drive(body, { zoom, mode }) {
  const sent = [];
  const sandbox = {
    triLast: null,
    pinchLast: null,
    pinchMoved: false,
    lastTouch: { clientX: 100, clientY: 100 },
    touchStartPos: { x: 100, y: 100 },
    isDragging: false,
    longPressTimer: null,
    isDragLock: false,
    dragLockActive: false,
    currentZoom: zoom,
    touchMode: mode,
    panX: 0,
    panY: 0,
    DRAG_THRESHOLD: 9,
    sendInput: ev => sent.push(ev),
    screenCoord: (x, y) => ({ x: x / 1000, y: y / 1000 }),
    getVideoRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    clampPan: () => {},
    applyTransform: () => {},
    setDragMode: () => {},
    setZoom: () => true
  };
  const e = { preventDefault: () => {}, touches: [{ clientX: 160, clientY: 140 }] };
  makeHandler(body)(sandbox, e);
  return { sent, sandbox };
}
const cases = [
  { name: 'zoomed touch drag sends mouse-move', zoom: 3, mode: 'touch', want: 'mouse-move' },
  { name: 'unzoomed touch drag sends mouse-move', zoom: 1, mode: 'touch', want: 'mouse-move' },
  { name: 'zoomed trackpad drag sends mouse-move-rel', zoom: 3, mode: 'trackpad', want: 'mouse-move-rel' }
];
function run(file, label) {
  const body = extractTouchmove(file);
  let pass = 0;
  const fails = [];
  cases.forEach(c => {
    const { sent } = drive(body, c);
    const got = sent.filter(s => s.type === c.want);
    got.length > 0 ? pass++ : fails.push(`${c.name}: expected ${c.want}, got [${sent.map(s => s.type).join(',') || 'nothing'}]`);
  });
  console.log(`${label}: ${pass}/${cases.length} passed`);
  fails.forEach(f => console.log(`  FAIL ${f}`));
  return { pass, total: cases.length };
}
const repo = path.join(__dirname, '..');
const backupPath = path.join(repo, 'backups', 'viewer.html.v1.5.2_pre_zoom_input_gate.bak');
const fixed = run(path.join(repo, 'viewer.html'), 'FIXED   viewer.html');
const backup = fs.existsSync(backupPath) ? run(backupPath, 'BACKUP  pre-fix') : null;
if (!backup) console.log('BACKUP  pre-fix: skipped (backups/ is gitignored - sensitivity check only runs in the dev tree)');
const ok = fixed.pass === fixed.total && (!backup || backup.pass < backup.total);
console.log(ok
  ? `\nOK - fix passes all ${fixed.total}${backup ? `, backup fails ${backup.total - backup.pass} (test is sensitive to the bug)` : ''}`
  : `\nINVALID - fixed=${fixed.pass}/${fixed.total}${backup ? ` backup=${backup.pass}/${backup.total}; a test that also passes on the backup proves nothing` : ''}`);
process.exit(ok ? 0 : 1);
