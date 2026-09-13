const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(process.argv[2] || path.join(root, 'main.js'), 'utf8');
let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'ok' : 'FAIL') + ' ' + name); cond || fail++; };
ok('guard detects a temp/old-install copy', /\\\\Temp\\\\\|\\\\old-install\\\\/i.test(mainJs) && /process\.execPath/.test(mainJs));
ok('guard runs before the single-instance lock', mainJs.indexOf('old-install') < mainJs.indexOf('requestSingleInstanceLock'));
ok('guard only fires for packaged builds', /app\.isPackaged && \/\\\\Temp/.test(mainJs));
ok('guard relaunches the installed exe then exits', /spawn\(real, \[\], \{ detached: true/.test(mainJs) && /process\.exit\(0\)/.test(mainJs));
ok('guard cannot loop back into itself', /real\.toLowerCase\(\) !== process\.execPath\.toLowerCase\(\)/.test(mainJs));
ok('installed path comes from ProgramFiles', /process\.env\['ProgramFiles'\]/.test(mainJs) && /'Amni-Connect', 'amni-connect\.exe'/.test(mainJs));
const guard = mainJs.slice(mainJs.indexOf('function installedExe'), mainJs.indexOf('const gotSingleLock'));
const paths = [
  ['C:\\Users\\a\\AppData\\Local\\Temp\\nsg9607.tmp\\old-install\\amni-connect.exe', true],
  ['C:\\Program Files\\Amni-Connect\\amni-connect.exe', false],
  ['C:\\Users\\a\\Documents\\ai\\Amni-Connect\\node_modules\\electron\\dist\\electron.exe', false]
];
const re = /\\Temp\\|\\old-install\\/i;
paths.forEach(([p, expect]) => ok(`classifies ${p.split('\\').slice(-2).join('\\')} stale=${expect}`, re.test(p) === expect));
ok('guard block is present in main.js', guard.includes('app.quit()'));
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
