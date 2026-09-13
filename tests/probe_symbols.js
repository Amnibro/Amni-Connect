const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const out = path.join(process.env.LOCALAPPDATA, 'Temp', 'symbox.txt');
const ps1 = path.join(process.env.LOCALAPPDATA, 'Temp', 'symbox.ps1');
fs.writeFileSync(ps1, [
  'Add-Type -AssemblyName System.Windows.Forms',
  "$f = New-Object System.Windows.Forms.Form; $f.Text='AmniSymTest'; $f.Width=700; $f.Height=200; $f.TopMost=$true; $f.StartPosition='Manual'; $f.Left=200; $f.Top=200",
  "$t = New-Object System.Windows.Forms.TextBox; $t.Multiline=$true; $t.Dock='Fill'; $f.Controls.Add($t)",
  '$timer = New-Object System.Windows.Forms.Timer; $timer.Interval=6500',
  "$timer.Add_Tick({ [IO.File]::WriteAllText('" + out + "', $t.Text); $f.Close() })",
  '$f.Add_Shown({ $f.Activate(); $t.Focus(); $timer.Start() })',
  '[void]$f.ShowDialog()'
].join('\r\n'));
(async () => {
  try { fs.unlinkSync(out); } catch (_) {}
  process.argv.includes('--nospawn') || spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', ps1], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  await wait(2500);
  const seq = process.argv[2] || "`1234567890-=[];',./~!@#$%^&*()_+{}|:\"<>?abcXYZ";
  const s = net.connect(7878, '127.0.0.1');
  await new Promise(r => s.on('connect', r));
  s.write(JSON.stringify({ type: 'mouse-move', x: 500 / 3440, y: 320 / 1440 }) + '\n'); await wait(150); s.write(JSON.stringify({ type: 'mouse-click' }) + '\n'); await wait(400);
  for (const ch of seq) { s.write(JSON.stringify({ type: 'key-down', key: ch }) + '\n'); s.write(JSON.stringify({ type: 'key-up', key: ch }) + '\n'); await wait(35); }
  s.destroy();
  await wait(5000);
  const got = fs.readFileSync(out, 'utf8');
  console.log('sent :', seq);
  console.log('typed:', got);
  console.log('missing:', JSON.stringify([...seq].filter(c => !got.includes(c)).join('')));
})();
