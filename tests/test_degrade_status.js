const fs = require('fs');
const path = require('path');
const TARGET = process.argv[2] || path.join(__dirname, '..', 'main.js');
const src = fs.readFileSync(TARGET, 'utf8');
const carve = (name) => {
  const at = src.indexOf(`function ${name}(`);
  at < 0 && (() => { throw new Error(`${name} not found in ${TARGET}`); })();
  let i = src.indexOf('{', at);
  for (let depth = 0, j = i; j < src.length; j++) {
    src[j] === '{' && depth++;
    src[j] === '}' && --depth === 0 && (i = j + 1, j = src.length);
  }
  return src.slice(at, i);
};
const ctx = {
  lastPong: 0, elevatedTask: false, mediumReplaced: false, hwWanted: false, hwDead: false, lastDegraded: '',
  restartRust: () => {}, hostLog: () => {}, mainWindow: { webContents: { send: (ch, m) => ctx.sent.push([ch, m]) } },
  hostStatus: (m) => ctx.lines.push(m), lines: [], sent: []
};
const onRustData = new Function('ctx', `with (ctx) { ${carve('onRustData')} ; return onRustData; }`)(ctx);
const pong = (o) => onRustData(Buffer.from(JSON.stringify({ type: 'pong', errs: 0, rebuilds: 0, misses: 0, direct: false, elevated: true, display: [1920, 1080], last: '', ...o }) + '\n'));
const fail = (msg) => { console.log(`FAIL ${msg}`); process.exitCode = 1; };
console.log(`target=${path.relative(path.join(__dirname, '..'), TARGET)}`);
const stuck = { direct: true, errs: 0, misses: 0, last: 'move did not land target=878,547 cursor=967,703 misses=1' };
for (let i = 0; i < 6; i++) pong(stuck);
const repeats = ctx.lines.filter((l) => /degraded/.test(l)).length;
console.log(`six identical pongs produced ${ctx.lines.length} status lines (${repeats} saying degraded): ${JSON.stringify(ctx.lines.slice(0, 2))}`);
ctx.lines.length > 1 && fail(`the same backend state logged ${ctx.lines.length} times, so the panel fills with one repeated line every 5 seconds`);
repeats > 0 && fail('a healed backend with errs=0 misses=0 is still reported as degraded because the stale last string is echoed');
ctx.lines.length = 0;
pong({ direct: true, errs: 0, misses: 2, last: 'move did not land target=10,10 cursor=99,99 misses=2' });
ctx.lines.length === 1 || fail(`a real fault should log once, got ${ctx.lines.length}`);
ctx.lines.length = 0;
pong({ direct: true, errs: 0, misses: 0, last: '' });
pong({ direct: true, errs: 1, misses: 0, last: 'move-abs failed' });
ctx.lines.some((l) => /errs=1/.test(l)) || fail('a new fault after the backend healed is never reported');
ctx.lines.length = 0;
ctx.hwWanted = true;
onRustData(Buffer.from(JSON.stringify({ type: 'capture-status', ok: false, reason: 'membuf out of memory' }) + '\n'));
onRustData(Buffer.from(JSON.stringify({ type: 'capture-status', ok: false, reason: 'membuf out of memory' }) + '\n'));
const dead = ctx.sent.filter(([ch]) => ch === 'hw-dead');
console.log(`capture death notices to the renderer: ${dead.length}`);
dead.length === 1 || fail(`a dead hardware capture should tell the renderer exactly once, got ${dead.length}`);
ctx.sent.length = 0;
ctx.hwDead = false;
onRustData(Buffer.from(JSON.stringify({ type: 'capture-status', ok: false, reason: '' }) + '\n'));
onRustData(Buffer.from(JSON.stringify({ type: 'capture-status', ok: false }) + '\n'));
ctx.sent.some(([ch]) => ch === 'hw-dead') && fail('a status with no reason is the gap between encoder rebuilds, and it must not restart capture');
process.exitCode || console.log('PASS one line per state change, and a dead capture reaches the renderer once');
