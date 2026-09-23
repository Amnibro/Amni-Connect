const fs = require('fs');
const path = require('path');
const SRC = process.argv[2] || path.join(__dirname, '..', 'main.js');
const js = fs.readFileSync(SRC, 'utf8');
const at = js.indexOf("ipcMain.handle('start-hw-capture'");
const handler = at < 0 ? '' : js.slice(at, js.indexOf("ipcMain.handle('update-hw-capture'"));
const waits = /await waitRust\(\s*(\d+)\s*\)/.exec(handler);
const readyOnConnect = /rustClient\.on\('connect'[^\n]*rustReady = true/.test(js);
const clearedOnClose = /rustClient\.on\('close'[^\n]*rustReady = false/.test(js);
const poll = /function waitRust\(ms\)[\s\S]{0,400}?rustReady \|\| Date\.now\(\) - at > ms/.test(js);
console.log('source=' + path.basename(SRC));
console.log('start-hw-capture awaits the backend: ' + (waits ? waits[1] + ' ms budget' : 'no'));
console.log('rustReady set on connect / cleared on close: ' + readyOnConnect + ' / ' + clearedOnClose);
console.log('waitRust polls until ready or budget: ' + poll);
if (!waits || Number(waits[1]) < 3000) { console.log('FAIL start-hw-capture answers no-backend when the elevated daemon has not connected yet, so every cold boot runs on Chromium capture'); process.exit(1); }
if (!readyOnConnect || !clearedOnClose || !poll) { console.log('FAIL backend readiness is not tracked on the control socket'); process.exit(1); }
console.log('PASS hardware capture waits up to ' + waits[1] + ' ms for the elevated daemon before falling back');
