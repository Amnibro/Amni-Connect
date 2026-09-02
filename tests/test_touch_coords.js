// Maps taps to the laid-out media box, not a JS letterbox of the overlay.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf8');

if (src.includes('object-fit:contain')) {
  console.error('FAIL: video must not object-fit:contain inside a stretched box');
  process.exit(1);
}
if (!src.includes('id="media-fit"') || !src.includes('function layoutMediaFit()') || !src.includes('function containSize(')) {
  console.error('FAIL: media-fit layout helpers missing');
  process.exit(1);
}
if (src.includes('function touchTargetRect()') || src.includes('getSettings')) {
  console.error('FAIL: old overlay-clip / getSettings mapping must stay gone');
  process.exit(1);
}

const i0 = src.indexOf('function sourceSize()');
const i1 = src.indexOf('function clampPan()', i0);
if (i0 < 0 || i1 < 0) throw new Error('could not extract coord helpers from viewer.html');
const body = src.slice(i0, i1);

function runSuite(label, overlayRect, pictureRect, taps) {
  const fit = {
    offsetWidth: pictureRect.width,
    getBoundingClientRect: () => pictureRect
  };
  const sandbox = {
    hwUsing: false,
    overlay: { getBoundingClientRect: () => overlayRect },
    document: {
      getElementById(id) {
        if (id === 'media-fit') return fit;
        if (id === 'remote-canvas') return { width: 0, height: 0 };
        if (id === 'remote-video') return { videoWidth: 1920, videoHeight: 1080 };
        throw new Error('unexpected id ' + id);
      }
    }
  };
  const fn = new Function(
    'document', 'overlay', 'hwUsing',
    body + '\nreturn { getVideoRect, screenCoord, containSize };'
  );
  const { getVideoRect, screenCoord, containSize } = fn(
    sandbox.document, sandbox.overlay, sandbox.hwUsing
  );
  let pass = 0;
  taps.forEach(([tap, expect, name]) => {
    const sc = screenCoord(tap.x, tap.y);
    const ok = Math.abs(sc.x - expect.x) < 0.002 && Math.abs(sc.y - expect.y) < 0.002;
    if (ok) pass++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} ${name}  -> (${sc.x.toFixed(3)}, ${sc.y.toFixed(3)})`);
    if (!ok) console.log(`        expected (${expect.x}, ${expect.y}), videoRect=`, getVideoRect());
  });
  const boxed = containSize(390, 700, 1920, 1080);
  const boxOk = boxed && boxed.w === 390 && boxed.h === 219;
  console.log(`  ${boxOk ? 'PASS' : 'FAIL'}  ${label} containSize 1080p in portrait box -> ${JSON.stringify(boxed)}`);
  if (boxOk) pass++;
  return pass;
}

const overlay = { left: 0, top: 44, width: 390, height: 700, bottom: 744, right: 390 };
const picH = 219;
const picTop = 44 + (700 - picH) / 2;
const picture = { left: 0, top: picTop, width: 390, height: picH, bottom: picTop + picH, right: 390 };

let pass = runSuite('portrait 1080p', overlay, picture, [
  [{ x: 195, y: picTop + picH / 2 }, { x: 0.5, y: 0.5 }, 'center of picture'],
  [{ x: 0, y: picTop }, { x: 0, y: 0 }, 'top-left of picture'],
  [{ x: 390, y: picTop + picH }, { x: 1, y: 1 }, 'bottom-right of picture']
]);

console.log(`\n${pass}/4 passed`);
process.exit(pass === 4 ? 0 : 1);
