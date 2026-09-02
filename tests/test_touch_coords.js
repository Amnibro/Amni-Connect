// Extracts getVideoRect/screenCoord from viewer.html and checks letterboxing math.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf8');

const i0 = src.indexOf('function mediaSurface()');
const i1 = src.indexOf('function clampPan()', i0);
if (i0 < 0 || i1 < 0) throw new Error('could not extract coord helpers from viewer.html');
const body = src.slice(i0, i1);

const css = src.match(/#viewer-screen\{[^}]+\}/);
if (!css || !css[0].includes('padding-bottom:var(--toolbar-h)')) {
  console.error('FAIL: #viewer-screen must reserve toolbar height (padding-bottom:var(--toolbar-h))');
  process.exit(1);
}
if (!src.includes('#zoom-container{flex:1 1 auto;min-height:0;')) {
  console.error('FAIL: #zoom-container must flex-fill above toolbar');
  process.exit(1);
}

function runSuite(label, overlayRect, source, taps) {
  let hwUsing = false;
  let lastSrcSize = { w: 0, h: 0 };
  const sandbox = {
    hwUsing,
    pc: null,
    lastSrcSize,
    document: {
      getElementById(id) {
        if (id === 'remote-canvas') {
          return { width: source.w, height: source.h, getBoundingClientRect: () => overlayRect };
        }
        if (id === 'remote-video') {
          return { videoWidth: source.w, videoHeight: source.h, getBoundingClientRect: () => overlayRect };
        }
        throw new Error('unexpected id ' + id);
      }
    },
    overlay: { getBoundingClientRect: () => overlayRect },
    window: { visualViewport: null }
  };
  const fn = new Function(
    'document', 'overlay', 'hwUsing', 'pc', 'lastSrcSize', 'window',
    body + '\nreturn { getVideoRect, screenCoord };'
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

const overlay = { left: 0, top: 44, width: 390, height: 644 };
pass += runSuite('1080p', overlay, { w: 1920, h: 1080 }, [
  [{ x: 195, y: 44 + 322 }, { x: 0.5, y: 0.5 }, 'center tap'],
  [{ x: 0, y: 44 + 82 }, { x: 0, y: 0 }, 'top-left of picture'],
  [{ x: 390, y: 44 + 562 }, { x: 1, y: 1 }, 'bottom-right of picture']
]);

const uwW = 390, uwH = 644;
const uwPicH = uwW / (3440 / 1440);
const uwTop = 44 + (uwH - uwPicH) / 2;
pass += runSuite('ultrawide portrait', { left: 0, top: 44, width: uwW, height: uwH }, { w: 3440, h: 1440 }, [
  [{ x: 195, y: uwTop + uwPicH / 2 }, { x: 0.5, y: 0.5 }, 'center tap'],
  [{ x: 0, y: uwTop }, { x: 0, y: 0 }, 'top-left of picture'],
  [{ x: uwW, y: uwTop + uwPicH }, { x: 1, y: 1 }, 'bottom-right of picture']
]);

const deskPicW = 900 * (3440 / 1440);
const deskLeft = (1600 - deskPicW) / 2;
pass += runSuite('ultrawide wide', { left: 0, top: 0, width: 1600, height: 900 }, { w: 3440, h: 1440 }, [
  [{ x: deskLeft + deskPicW / 2, y: 450 }, { x: 0.5, y: 0.5 }, 'center tap'],
  [{ x: deskLeft, y: 0 }, { x: 0, y: 0 }, 'top-left of picture'],
  [{ x: deskLeft + deskPicW, y: 900 }, { x: 1, y: 1 }, 'bottom-right of picture']
]);

console.log(`\n${pass}/9 passed`);
process.exit(pass === 9 ? 0 : 1);
