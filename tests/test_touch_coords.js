// Extracts touchTargetRect/getVideoRect/screenCoord from viewer.html and checks letterboxing math.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf8');

const i0 = src.indexOf('function sourceSize()');
const i1 = src.indexOf('function clampPan()', i0);
if (i0 < 0 || i1 < 0) throw new Error('could not extract coord helpers from viewer.html');
const body = src.slice(i0, i1);

if (!src.includes('#zoom-container{position:absolute;inset:0;')) {
  console.error('FAIL: #zoom-container must fill #viewer-screen with absolute inset');
  process.exit(1);
}
if (!src.includes('function touchTargetRect()')) {
  console.error('FAIL: touchTargetRect() missing');
  process.exit(1);
}

function runSuite(label, overlayRect, toolbarTop, source, taps) {
  let hwUsing = false;
  let lastSrcSize = { w: 0, h: 0 };
  const toolbar = {
    getBoundingClientRect: () => ({ top: toolbarTop, bottom: toolbarTop + 56, left: 0, height: 56 })
  };
  const sandbox = {
    hwUsing,
    pc: null,
    lastSrcSize,
    document: {
      getElementById(id) {
        if (id === 'toolbar') return toolbar;
        if (id === 'remote-canvas') return { width: source.w, height: source.h };
        if (id === 'remote-video') return { videoWidth: source.w, videoHeight: source.h };
        throw new Error('unexpected id ' + id);
      }
    },
    overlay: { getBoundingClientRect: () => overlayRect },
    window: { visualViewport: null, getComputedStyle: () => ({ display: 'flex' }) }
  };
  const fn = new Function(
    'document', 'overlay', 'hwUsing', 'pc', 'lastSrcSize', 'window',
    body + '\nreturn { getVideoRect, screenCoord, touchTargetRect };'
  );
  const { getVideoRect, screenCoord } = fn(
    sandbox.document, sandbox.overlay, sandbox.hwUsing, sandbox.pc, sandbox.lastSrcSize, sandbox.window
  );
  let pass = 0;
  taps.forEach(([tap, expect, name]) => {
    const sc = screenCoord(tap.x, tap.y);
    const ok = Math.abs(sc.x - expect.x) < 0.002 && Math.abs(sc.y - expect.y) < 0.002;
    if (ok) pass++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} ${name}  -> (${sc.x.toFixed(3)}, ${sc.y.toFixed(3)})`);
    if (!ok) console.log(`        expected (${expect.x}, ${expect.y}), videoRect=`, getVideoRect());
  });
  return pass;
}

let pass = 0;
const overlay = { left: 0, top: 44, width: 390, height: 700, bottom: 744, right: 390 };
const toolbarTop = 688; // 56px toolbar at bottom of overlay

const usableH = toolbarTop - overlay.top;
const picH1080 = overlay.width / (1920 / 1080);
const top1080 = overlay.top + (usableH - picH1080) / 2;

pass += runSuite('1080p toolbar clip', overlay, toolbarTop, { w: 1920, h: 1080 }, [
  [{ x: 195, y: top1080 + picH1080 / 2 }, { x: 0.5, y: 0.5 }, 'center tap'],
  [{ x: 0, y: top1080 }, { x: 0, y: 0 }, 'top-left of picture'],
  [{ x: 390, y: top1080 + picH1080 }, { x: 1, y: 1 }, 'bottom-right of picture']
]);

const uwPicH = 390 / (3440 / 1440);
const uwTop = 44 + (644 - uwPicH) / 2;
pass += runSuite('ultrawide portrait', { left: 0, top: 44, width: 390, height: 700, bottom: 744, right: 390 }, toolbarTop, { w: 3440, h: 1440 }, [
  [{ x: 195, y: uwTop + uwPicH / 2 }, { x: 0.5, y: 0.5 }, 'center tap'],
  [{ x: 0, y: uwTop }, { x: 0, y: 0 }, 'top-left of picture'],
  [{ x: 390, y: uwTop + uwPicH }, { x: 1, y: 1 }, 'bottom-right of picture']
]);

console.log(`\n${pass}/6 passed`);
process.exit(pass === 6 ? 0 : 1);
