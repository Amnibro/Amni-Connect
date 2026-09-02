const fs = require('fs');
const path = require('path');
const ih = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const vh = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf8');
const mj = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
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
eval(sliceFn(ih, 'rankVideoCodec') + '\n' + sliceFn(ih, 'packScreenPackets') + '\n' + sliceFn(ih, 'lockEncodeParams') + '\n' + sliceFn(ih, 'encodeWasDownscaled') + '\n' + sliceFn(ih, 'pasteChord') + '\n' + sliceFn(vh, 'assembleScreen') + '\n' + sliceFn(vh, 'updateCrisp') + '\n' + sliceFn(vh, 'applyTransform') + '\n' + sliceFn(vh, 'sourceSize'));
let fail = 0;
function ok(name, cond) { if (!cond) { console.error('FAIL', name); fail++; } else console.log('ok', name); }

ok('h264 first', rankVideoCodec({ mimeType: 'video/H264' }) < rankVideoCodec({ mimeType: 'video/VP9' }));
ok('vp8 last', rankVideoCodec({ mimeType: 'video/vp8' }) > rankVideoCodec({ mimeType: 'video/av1' }));
ok('host prefers codecs', ih.includes('function preferDesktopCodecs') && ih.includes('preferDesktopCodecs(pc)'));
ok('viewer prefers codecs', vh.includes('function preferDesktopCodecs') && vh.includes('preferDesktopCodecs(pc)'));
ok('content hint', ih.includes("contentHint = 'detail'"));
ok('keep resolution', ih.includes("degradationPreference = 'maintain-resolution'") && ih.includes('scaleResolutionDownBy = 1'));
ok('lock after addTrack', ih.includes('preferDesktopCodecs(pc)') && ih.includes('applyBitrate()'));
const locked = lockEncodeParams({ encodings: [{ scaleResolutionDownBy: 4, maxBitrate: 1 }] }, 12000);
ok('lock forces 1x', locked.encodings[0].scaleResolutionDownBy === 1 && locked.encodings[0].maxBitrate === 12000000 && locked.degradationPreference === 'maintain-resolution');
ok('detect scale>1', encodeWasDownscaled({ encodings: [{ scaleResolutionDownBy: 2 }] }, 1920, 1920));
ok('detect frame shrink', encodeWasDownscaled(null, 1280, 1920));
ok('native not downscaled', !encodeWasDownscaled({ encodings: [{ scaleResolutionDownBy: 1 }] }, 1920, 1920));
ok('no host backdrop-filter', !/header\s*\{[^}]*backdrop-filter/.test(ih) && !/\.panel\s*\{[^}]*backdrop-filter/.test(ih));
ok('tray hosting', ih.includes('id="trayToggle"') && ih.includes('hideToTray') && mj.includes('trayHost') && mj.includes('backgroundThrottling: false') && mj.includes('disable-renderer-backgrounding'));
ok('input channel high', ih.includes("createDataChannel('input'") && ih.includes("priority: 'high'") && vh.includes("e.channel.label === 'input'"));
ok('screen channel low', ih.includes("priority: 'low'") && ih.includes('bufferedAmount > 256000'));
ok('input fire-forget', mj.includes("ipcMain.on('send-input-event'") && mj.includes('hwPending'));
const chord = pasteChord();
ok('paste is ctrl+v', chord.length === 4 && chord[0].key === 'Control' && chord[1].key === 'v' && chord[3].key === 'Control');
ok('viewer paste+voice', vh.includes('function pasteToPc') && vh.includes('function toggleVoice') && vh.includes('type: \'paste\''));
ok('setup exe', require('fs').readFileSync(require('path').join(__dirname, '..', 'package.json'), 'utf8').includes('Amni-Connect-Setup') && mj.includes('function rustBinPath'));
ok('github publish', require('fs').readFileSync(require('path').join(__dirname, '..', 'package.json'), 'utf8').includes('"provider": "github"') && mj.includes('electron-updater'));
ok('linux packages', (() => {
  const pj = require('fs').readFileSync(require('path').join(__dirname, '..', 'package.json'), 'utf8');
  return pj.includes('AppImage') && pj.includes('"deb"') && pj.includes('"rpm"') && pj.includes('build/amni-control') && require('fs').existsSync(require('path').join(__dirname, '..', 'scripts', 'install-linux.sh'));
})());
ok('linux install script', require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'install-linux.sh'), 'utf8').includes('--deb') && require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'install-linux.sh'), 'utf8').includes('AppImage'));
ok('default source', /id="resolutionSelect"[\s\S]*value="source" selected/.test(ih));
ok('default 60fps', /id="fpsSelect"[\s\S]*value="60" selected/.test(ih));
ok('default 12mbps', ih.includes('value="12000"') && ih.includes('WAN_DEFAULT_KBPS = 12000'));
ok('lan floor 16', ih.includes('LAN_FLOOR_KBPS = 16000') && ih.includes('Math.max(next, LAN_FLOOR_KBPS)'));
ok('no css zoom transition', !/#zoom-container\{[^}]*transition/.test(vh.replace(/\s/g, '')) && vh.includes("c.style.transition = 'none'"));
ok('pixelated when zoomed', vh.includes("currentZoom > 1.02 ? 'pixelated'"));
ok('hw capture ipc', mj.includes('start-hw-capture') && mj.includes('VIDEO_PORT') && mj.includes('0x31434E41'));

const SCREEN_CHUNK = 60000;
const au = new Uint8Array([1, 2, 3, 4, 5]);
const parts = packScreenPackets(au, true, 7);
ok('single packet', parts.length === 1 && parts[0][0] === 1 && parts[0][1] === 1);
hwParts = new Map();
const got = assembleScreen(parts[0]);
ok('assemble single', got && got.key && got.au.length === 5 && got.au[0] === 1);

const big = new Uint8Array(70000);
big[0] = 9; big[69999] = 8;
const chunked = packScreenPackets(big, false, 3);
ok('chunked', chunked.length === 2 && chunked[0][0] === 2);
hwParts = new Map();
ok('assemble wait', assembleScreen(chunked[0]) === null);
const joined = assembleScreen(chunked[1]);
ok('assemble join', joined && !joined.key && joined.au.length === 70000 && joined.au[0] === 9 && joined.au[69999] === 8);

let currentZoom = 2, videoMode = '', canvasMode = '';
const fakeV = { style: { set imageRendering(v) { videoMode = v; } } };
const fakeC = { style: { set imageRendering(v) { canvasMode = v; } }, width: 1920, height: 1080 };
const fakeZ = { style: {} };
const document = { getElementById: (id) => id === 'remote-video' ? fakeV : id === 'remote-canvas' ? fakeC : id === 'zoom-container' ? fakeZ : null };
updateCrisp();
ok('crisp zoomed', videoMode === 'pixelated' && canvasMode === 'pixelated');
currentZoom = 1;
updateCrisp();
ok('auto at 1x', videoMode === 'auto');
var panX = 0, panY = 0;
applyTransform(false);
ok('transform no transition', fakeZ.style.transition === 'none');

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('all pass');
