const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
process.env.APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'amni-viewer-'));
process.env.PORT = '0';
const server = require('../server');
const get = (port, url) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path: url }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body, type: res.headers['content-type'] || '' }));
  }).on('error', (e) => resolve({ status: 0, body: String(e.message), type: '' }));
});
let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        ${detail}`}`);
};
const ready = () => new Promise((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
(async () => {
  await ready();
  const port = server.address().port;
  console.log(`signaling on port ${port}`);
  const viewer = await get(port, '/viewer');
  check(viewer.status === 200, 'GET /viewer answers 200', `status ${viewer.status} body ${viewer.body.slice(0, 120)}`);
  check(/<!DOCTYPE html>/i.test(viewer.body), 'GET /viewer returns the page', viewer.body.slice(0, 120));
  check(viewer.body.includes('clipboard-bar'), 'page is viewer.html, not an error page', viewer.body.slice(0, 120));
  check(!/ENOENT/.test(viewer.body), 'no ENOENT in the response', viewer.body.slice(0, 200));
  const client = await get(port, '/socket.io-client/socket.io.min.js');
  check(client.status === 200 && client.body.length > 1000, 'socket.io client still served', `status ${client.status} size ${client.body.length}`);
  const walk = await get(port, '/socket.io-client/..%2f..%2fserver.js');
  check(walk.status === 404 || !walk.body.includes('INBOX_DIR'), 'no path traversal out of the client dir', `status ${walk.status}`);
  const express = require('express');
  const gone = path.join(os.tmpdir(), `${'3ef4320b-5a1f-4ec8-9c4a-125f2e0007a3'}.tmp.html`);
  const old = express();
  old.get('/viewer', (_, res) => res.sendFile(gone));
  const oldServer = old.listen(0, '127.0.0.1');
  await new Promise((r) => oldServer.once('listening', r));
  const broke = await get(oldServer.address().port, '/viewer');
  oldServer.close();
  console.log(`\nsensitivity check: the old res.sendFile line answered ${broke.status} with ${broke.body.replace(/\s+/g, ' ').slice(0, 140)}`);
  check(broke.status !== 200 && /ENOENT/.test(broke.body), 'old sendFile path reproduces the phone error', `status ${broke.status}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
})();
