const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const SRC = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(SRC, 'utf8');
const AUDIO_ONLY = /getUserMedia\(\{\s*audio:\s*\{\s*mandatory:\s*\{\s*chromeMediaSource:\s*'desktop'\s*\}\s*\}\s*,\s*video:\s*false\s*\}\)/;
function fnText(name) {
    const at = html.indexOf('async function ' + name + '(');
    if (at < 0) return null;
    let i = html.indexOf('{', at), depth = 0;
    for (let j = i; j < html.length; j++) {
        depth += html[j] === '{' ? 1 : html[j] === '}' ? -1 : 0;
        if (depth === 0) return html.slice(at, j + 1);
    }
    return null;
}
const helper = fnText('captureDesktopAudioOnly');
const crashSite = AUDIO_ONLY.test(html);
const sourceOk = !!helper && !crashSite;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anc-audio-'));
const body = helper ? helper + "\nasync function run(id) { return captureDesktopAudioOnly(id); }" : "async function run(id) { return navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: false }); }";
fs.writeFileSync(path.join(dir, 'pre.js'), "const { contextBridge, ipcRenderer } = require('electron');\ncontextBridge.exposeInMainWorld('api', { srcId: () => ipcRenderer.invoke('src'), done: (r) => ipcRenderer.send('done', r) });\n");
fs.writeFileSync(path.join(dir, 'page.html'), "<!doctype html><html><body><script>\n" + body + "\n(async () => { try { const id = await window.api.srcId(); const s = await run(id); await new Promise(r => setTimeout(r, 2500)); const a = s.getAudioTracks()[0]; window.api.done({ audio: s.getAudioTracks().length, video: s.getVideoTracks().length, state: a && a.readyState }); } catch (e) { window.api.done({ error: e.name + ' ' + e.message }); } })();\n</script></body></html>\n");
fs.writeFileSync(path.join(dir, 'main.js'), "const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');\nconst path = require('path');\napp.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');\nipcMain.handle('src', async () => (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }))[0].id);\nipcMain.on('done', (_, r) => { console.log('RESULT ' + JSON.stringify(r)); app.quit(); });\napp.whenReady().then(() => {\n    const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'pre.js'), contextIsolation: true } });\n    w.webContents.on('render-process-gone', (_, d) => { console.log('GONE reason=' + d.reason + ' exit=' + d.exitCode); app.quit(); });\n    w.loadFile(path.join(__dirname, 'page.html'));\n});\nsetTimeout(() => { console.log('TIMEOUT'); app.quit(); }, 25000);\n");
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'anc-audio-probe', version: '1.0.0', main: 'main.js' }));
const proc = spawn(require(path.join(__dirname, '..', 'node_modules', 'electron')), [path.join(dir, 'main.js')], { stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
proc.stdout.on('data', d => { out += d.toString(); });
proc.stderr.on('data', d => { out += d.toString(); });
proc.on('close', () => {
    const gone = /GONE reason=/.exec(out);
    const res = /RESULT (\{.*\})/.exec(out);
    const r = res ? JSON.parse(res[1]) : null;
    const runtimeOk = !gone && !!r && r.audio >= 1 && r.video === 0 && r.state === 'live';
    console.log('source=' + path.basename(SRC));
    console.log('has captureDesktopAudioOnly helper: ' + !!helper);
    console.log('has audio-only getUserMedia(video:false): ' + crashSite);
    console.log('renderer: ' + (gone ? gone[0] : 'alive') + ' ' + (res ? res[1] : out.trim().split('\n').slice(-2).join(' | ')));
    if (!sourceOk) { console.log('FAIL desktop audio is requested without a video constraint, which kills the renderer (bad_message 263) and drops the host to Chromium capture'); process.exit(1); }
    if (!runtimeOk) { console.log('FAIL helper did not return a live audio-only stream'); process.exit(1); }
    console.log('PASS desktop audio captured with a 2x2 video decoy, renderer alive, audio track live, no video track');
});
