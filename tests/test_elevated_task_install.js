const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const nshPath = process.argv[2] || path.join(root, 'scripts', 'installer.nsh');
const mainPath = process.argv[3] || path.join(root, 'main.js');
const rustPath = process.argv[4] || path.join(root, 'rust', 'src', 'main.rs');
const nsh = fs.readFileSync(nshPath, 'utf8');
const rustMain = fs.readFileSync(rustPath, 'utf8');
const mainJs = fs.readFileSync(mainPath, 'utf8');
let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'ok' : 'FAIL') + ' ' + name); cond || fail++; };
ok('installer registers the task while elevated', /schtasks \/create \/tn AmniControlElevated \/xml/.test(nsh));
ok('installer writes UTF-16LE with BOM', /FileWriteUTF16LE \/BOM/.test(nsh));
ok('installer task command is the packed daemon', /<Command>\$INSTDIR\\resources\\amni-control\.exe<\/Command>/.test(nsh));
ok('uninstaller ends the task before deleting it', /schtasks \/end \/tn AmniControlElevated/.test(nsh) && /taskkill \/F \/IM amni-control\.exe/.test(nsh));
ok('app retries registration through elevate.exe', /elevate\.exe/.test(mainJs) && /'-wait', 'schtasks'/.test(mainJs));
ok('app restarts the daemon after a UAC registration', /via === 'uac' && restartRust/.test(mainJs));
ok('daemon reports its own elevation in pong', /fn is_elevated\(\)/.test(rustMain) && /TokenElevation/.test(rustMain) && rustMain.includes('\\"elevated\\":{}'));
ok('app replaces an adopted medium daemon through the task', /msg\.elevated === false && elevatedTask && !mediumReplaced/.test(mainJs) && /rustWrite\(\{ type: 'ping' \}\); hostStatus\('Rust input backend connected'\)/.test(mainJs));
ok('app decodes schtasks /query as UTF-8 unless a BOM says UTF-16', /buf\[0\] === 0xff && buf\[1\] === 0xfe \? buf\.toString\('utf16le'\) : buf\.toString\('utf8'\)/.test(mainJs));
const lines = [...nsh.matchAll(/FileWriteUTF16LE (?:\/BOM )?\$0 `([^`]*)`/g)].map(m => m[1].replace(/\$\\r\$\\n/g, '\r\n').replace(/\$INSTDIR/g, 'C:\\Program Files\\Amni-Connect'));
ok('installer XML has the full task body', lines.length >= 19 && lines.join('').includes('<RunLevel>HighestAvailable</RunLevel>'));
if (process.platform === 'win32' && lines.length) {
  const xml = path.join(require('os').tmpdir(), 'amni-control-task-test.xml');
  fs.writeFileSync(xml, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(lines.join(''), 'utf16le')]));
  const name = 'AmniControlElevatedTest';
  const env = { ...process.env, MSYS2_ARG_CONV_EXCL: '*' };
  const c = spawnSync('schtasks', ['/create', '/tn', name, '/xml', xml, '/f'], { env, encoding: 'utf8' });
  const admin = !/denied/i.test(c.stderr + c.stdout);
  admin ? ok('Task Scheduler accepts the installer XML', c.status === 0) : console.log('skip live registration (not elevated)');
  if (admin && c.status === 0) {
    const q = spawnSync('schtasks', ['/query', '/tn', name, '/xml'], { env });
    const cmd = (q.stdout.toString(q.stdout[0] === 0xff ? 'utf16le' : 'utf8').match(/<Command>([^<]*)<\/Command>/) || [])[1] || '';
    ok('registered Command is the packed daemon path', cmd === 'C:\\Program Files\\Amni-Connect\\resources\\amni-control.exe');
    spawnSync('schtasks', ['/delete', '/tn', name, '/f'], { env });
  }
}
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
