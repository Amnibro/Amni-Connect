require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3389;
const ALLOWED_ORIGINS = (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS === '*')
  ? '*'
  : process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim());
const DATA_ROOT = process.env.APPDATA ? path.join(process.env.APPDATA, 'amni-connect') : __dirname;
const INBOX_DIR = process.env.INBOX_DIR || path.join(DATA_ROOT, 'received-files');
fs.mkdirSync(INBOX_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] }, maxHttpBufferSize: 4e6 });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, INBOX_DIR),
    filename: (_, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${path.basename(file.originalname).replace(/[^\w.\-]/g, '_')}`)
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  // roomId is appended before the file, so an upload must name a live room code.
  fileFilter: (req, _file, cb) => cb(null, rooms.has(roomCode(req.body && req.body.roomId)))
});

const auth = require('./auth').createAuth(DATA_ROOT);
const CLOUD = process.env.AMNI_CLOUD === '1';
const cloud = CLOUD ? require('./cloud').createCloud(DATA_ROOT, fs.readFileSync(path.join(DATA_ROOT, 'auth-secret'), 'utf8').trim()) : null;
app.use(express.json({ limit: '64kb' }));
cloud && app.use((req, res, next) => cloud.ipOk(req.headers, req.socket.remoteAddress) || devHeader(req.headers) || /^\/api\/devices\/pair\/(start|poll)$/.test(req.path) ? next() : (console.log(`[cloud] denied ${req.headers['cf-connecting-ip'] || req.socket.remoteAddress} ${req.method} ${req.path} ${String(req.headers['user-agent'] || '').slice(0, 80)}`), res.status(403).type('text').send('Forbidden')));
cloud ? (cloud.routes(app), app.get(['/auth/status', '/auth/me'], (req, res) => res.json({ enabled: false, cloud: true, authed: !!cloud.userOf(req.headers) }))) : auth.routes(app);
const devHeader = (h) => { const [deviceId, secret] = String((h && h['x-amni-device']) || '').split(':'); return cloud && deviceId ? cloud.deviceAuth({ deviceId, secret }) : null; };
const allowedReq = (h) => cloud ? !!(cloud.userOf(h) || devHeader(h)) : auth.allowed(h);
const gate = (req, res, next) => allowedReq(req.headers) ? next() : res.status(401).json({ error: cloud ? 'sign in' : 'passkey required', authRequired: true });
const assets = new Map();
const asset = (rel) => assets.get(rel) || fs.readFileSync(path.join(__dirname, rel));
const SIO_DIR = path.join('node_modules', 'socket.io-client', 'dist');
app.get('/socket.io-client/:file', (req, res) => {
  const file = path.basename(String(req.params.file || ''));
  if (!/^[\w.-]+\.(js|map)$/.test(file)) return res.status(404).end();
  try {
    res.type(file.endsWith('.map') ? 'application/json' : 'application/javascript').send(asset(path.join(SIO_DIR, file)));
  } catch (_) { res.status(404).end(); }
});
app.get(['/', '/app', '/invite/:token'], (req, res, next) => {
  if (!cloud) return req.path === '/' ? next() : res.status(404).end();
  res.set('Cache-Control', 'no-store');
  try { res.type('html').send(asset('cloud.html')); } catch (e) { res.status(500).type('text').send('cloud.html unreadable'); }
});
app.get(['/', '/viewer'], (_, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('CDN-Cache-Control', 'no-store');
  res.set('Cloudflare-CDN-Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    res.type('html').send(asset('viewer.html'));
  } catch (e) { res.status(500).type('text').send('viewer.html unreadable: ' + (e && e.message)); }
});
app.get('/health', (_, res) => res.json({ status: 'ok', port: PORT }));
app.get('/qr', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url required' });
  try {
    const QR = require('qrcode');
    const png = await QR.toBuffer(url, { type: 'png', margin: 1, width: 240 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.end(png);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/upload', gate, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ status: 'error', message: err.message });
    if (!req.file) return res.status(400).json({ status: 'error', message: 'No file received' });
    const roomId = (req.body.roomId || '').toUpperCase();
    const room = rooms.get(roomId);
    room?.host?.emit('file-received', { name: req.file.originalname, size: req.file.size, savedAs: req.file.filename });
    res.json({ status: 'ok', savedAs: req.file.filename });
  });
});

const rooms = new Map();
let relayedInput = null;
const ROOM_FILE = path.join(DATA_ROOT, 'room.json');
const roomCode = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '');
function persistRoom(id) {
  try { fs.writeFileSync(ROOM_FILE, JSON.stringify({ id })); } catch (_) {}
}
function loadStickyRoom() {
  try {
    const id = roomCode(JSON.parse(fs.readFileSync(ROOM_FILE, 'utf8')).id);
    if (id.length >= 4) rooms.set(id, { host: null, viewers: new Set() });
  } catch (_) {}
}
loadStickyRoom();
function viewerInfo(socket) {
  if (socket.data && socket.data.user) return { id: socket.id, label: socket.data.user.name, from: String((socket.handshake.headers && socket.handshake.headers['cf-connecting-ip']) || sockIp(socket) || ''), role: socket.data.role, user: socket.data.user.id };
  const sess = auth.session(socket.handshake.headers);
  const ip = sockIp(socket);
  const cf = String((socket.handshake.headers && socket.handshake.headers['cf-connecting-ip']) || '').trim();
  const from = cf || ip || '';
  return { id: socket.id, label: (sess && sess.n) || from || 'viewer', from };
}
function viewersOf(room) {
  return [...room.viewers].filter((v) => v.connected).map(viewerInfo);
}
function emitOccupancy(room) {
  if (room.host && room.host.connected) room.host.emit('session-viewers', viewersOf(room));
}
function claimRoom(socket, id) {
  const existing = rooms.get(id);
  if (existing) {
    if (existing.host && existing.host !== socket && existing.host.connected) return null;
    const hostChanged = existing.host !== socket;
    if (existing.host && existing.host !== socket) { try { existing.host.leave(id); } catch (_) {} }
    existing.host = socket;
    socket.join(id);
    persistRoom(id);
    socket.emit('room-created', id);
    if (hostChanged) {
      for (const v of existing.viewers) { if (v.connected) socket.emit('viewer-joined', viewerInfo(v)); }
    }
    emitOccupancy(existing);
    return id;
  }
  rooms.set(id, { host: socket, viewers: new Set() });
  socket.join(id);
  persistRoom(id);
  socket.emit('room-created', id);
  socket.emit('session-viewers', []);
  return id;
}

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.warn(`Amni-Connect signaling already running on port ${PORT}, reusing existing instance`);
    return;
  }
  console.error('Amni-Connect signaling server error:', err);
});

// Room codes are the only secret while REQUIRE_PASSKEY is off: cap wrong guesses per client.
const joinFails = new Map(), JOIN_FAIL_MAX = 20, JOIN_FAIL_WINDOW_MS = 10 * 60 * 1000;
function clientKey(socket) {
  const ip = sockIp(socket);
  const cf = String((socket.handshake.headers && socket.handshake.headers['cf-connecting-ip']) || '').trim();
  return cf && /^(127\.0\.0\.1|::1)$/.test(ip) ? cf : ip;
}
function sockIp(socket) {
  let a = socket.handshake?.address || socket.conn?.remoteAddress || '';
  if (a.startsWith('::ffff:')) a = a.slice(7);
  return a;
}
function lanIp(ip) {
  if (!ip) return '';
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return ip;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return ip;
  const m = String(ip).match(/^172\.(\d+)\./);
  return m && +m[1] >= 16 && +m[1] <= 31 ? ip : '';
}
const TURN_TTL_SECS = 86400;
function iceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const secret = process.env.AMNI_CHAT_TURN_SECRET, url = process.env.AMNI_CHAT_TURN_URL;
  if (!secret || !url) return { iceServers: servers, ttlSecs: TURN_TTL_SECS, turn: false };
  const username = `${Math.floor(Date.now() / 1000) + TURN_TTL_SECS}:amni`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  servers.push({ urls: [url], username, credential });
  return { iceServers: servers, ttlSecs: TURN_TTL_SECS, turn: true };
}
app.get('/ice-servers', gate, (_, res) => { res.set('Cache-Control', 'no-store'); res.json(iceServers()); });
app.get('/rooms', (req, res) => {
  if (!auth.isLoopback(req)) return res.status(403).json({ error: 'host window only' });
  res.json({ rooms: [...rooms].map(([id, r]) => ({ id, host: !!(r.host && r.host.connected), viewers: r.viewers.size, people: viewersOf(r) })) });
});
if (cloud) cloud.setKick((deviceId, userId) => {
  const room = rooms.get(deviceId);
  if (!room) return;
  for (const v of [...room.viewers]) if (!userId || (v.data.user && v.data.user.id === userId)) { try { v.emit('kicked', { roomId: deviceId }); } catch (_) {} setTimeout(() => { try { v.disconnect(true); } catch (_) {} }, 30); }
  if (!userId && room.host) { try { room.host.emit('device-removed'); room.host.disconnect(true); } catch (_) {} rooms.delete(deviceId); }
});
cloud && io.use((socket, next) => cloud.deviceAuth(socket.handshake.auth) || cloud.ipOk(socket.handshake.headers, socket.handshake.address) ? next() : (console.log(`[cloud] denied socket ${socket.handshake.headers['cf-connecting-ip'] || socket.handshake.address}`), next(new Error('forbidden'))));
io.on('connection', (socket) => {
  const mine = lanIp(sockIp(socket));
  if (mine) socket.emit('your-lan', mine);
  const deviceId = cloud ? cloud.deviceAuth(socket.handshake.auth) : null;
  if (cloud && socket.handshake.auth && socket.handshake.auth.deviceId && !deviceId) { socket.emit('device-removed'); return socket.disconnect(true); }
  if (deviceId) { socket.data.device = deviceId; cloud.markOnline(deviceId, socket); socket.on('disconnect', () => cloud.markOffline(deviceId, socket)); }
  socket.on('create-room', (customId) => {
    if (cloud) { if (!deviceId) return socket.emit('error', 'Link this computer to an account first'); if (!claimRoom(socket, deviceId)) socket.emit('error', 'This computer is already hosting from another window'); return; }
    if (auth.isRemote(socket.handshake.headers)) return socket.emit('error', 'Hosting is only available from the host window');
    let id = roomCode(customId);
    if (id.length < 4) id = uuidv4().slice(0, 8).toUpperCase();
    // A host reconnecting to its own fixed room code must RECLAIM it, not
    // silently drift to a random id -- that stranded the PC under an unguessable room and
    // looked like "no room" from the phone. Only bump to a random id if a LIVE host holds it.
    if (!claimRoom(socket, id)) claimRoom(socket, uuidv4().slice(0, 8).toUpperCase());
  });

  socket.on('join-room', (roomId) => {
    if (cloud) {
      const hh = socket.handshake.headers, u = (!hh.origin || (() => { try { return new URL(hh.origin).host === hh.host; } catch (_) { return false; } })()) && cloud.userOf(hh), id = roomCode(roomId), r = u && cloud.role(u.id, id), room = r && rooms.get(id);
      if (!u) return socket.emit('error', 'Sign in at ' + (socket.handshake.headers.host || 'connect.amni-scient.com') + ' first');
      if (!r) return socket.emit('error', 'You do not have access to this computer');
      socket.data.user = { id: u.id, name: u.name }; socket.data.role = r;
      if (!room || !room.host || !room.host.connected) { if (!room) rooms.set(id, { host: null, viewers: new Set() }); }
      const rm = rooms.get(id); socket.join(id); rm.viewers.add(socket); socket.emit('room-joined', id);
      if (rm.host && rm.host.connected) { rm.host.emit('viewer-joined', viewerInfo(socket)); emitOccupancy(rm); } else socket.emit('error', 'This computer is offline');
      return;
    }
    if (!auth.allowed(socket.handshake.headers)) { socket.emit('auth-required'); return socket.emit('error', 'Passkey required'); }
    const who = clientKey(socket), now = Date.now(), fails = joinFails.get(who);
    if (fails && now - fails.t < JOIN_FAIL_WINDOW_MS && fails.n >= JOIN_FAIL_MAX) return socket.emit('error', 'Too many wrong room codes - try again later');
    const id = roomCode(roomId);
    const room = rooms.get(id);
    if (!room) {
      const f = fails && now - fails.t < JOIN_FAIL_WINDOW_MS ? fails : { n: 0, t: now };
      f.n++; joinFails.set(who, f);
      if (joinFails.size > 5000) for (const [k, v] of joinFails) if (now - v.t >= JOIN_FAIL_WINDOW_MS) joinFails.delete(k);
      return socket.emit('error', 'Room not found');
    }
    socket.join(id);
    room.viewers.add(socket);
    socket.emit('room-joined', id);
    if (room.host && room.host.connected) {
      room.host.emit('viewer-joined', viewerInfo(socket));
      emitOccupancy(room);
      const vLan = lanIp(sockIp(socket));
      const hLan = lanIp(sockIp(room.host));
      if (hLan) socket.emit('peer-lan', hLan);
      if (vLan) room.host.emit('peer-lan', vLan);
    }
  });

  socket.on('kick-viewer', (data) => {
    const id = roomCode(data && data.roomId);
    const room = rooms.get(id);
    if (!room || room.host !== socket) return;
    const want = data && data.viewerId;
    for (const v of [...room.viewers]) {
      if (!v.connected) continue;
      if (want && want !== '*' && v.id !== want) continue;
      try { v.emit('kicked', { roomId: id }); } catch (_) {}
      setTimeout(() => { try { v.disconnect(true); } catch (_) {} }, 30);
    }
  });

  const route = (ev) => socket.on(ev, (data) => {
    if (!data) return;
    const room = rooms.get(roomCode(data.roomId));
    if (cloud && !(room && (room.host === socket || room.viewers.has(socket)))) return;
    const out = { ...data, from: socket.id };
    if (room && room.host === socket) return (data.to ? socket.to(String(data.to)) : socket.to(data.roomId)).emit(ev, out);
    if (room && room.host && room.host.connected) return room.host.emit(ev, out);
    socket.to(data.roomId).emit(ev, out);
  });
  ['offer', 'answer', 'ice-candidate'].forEach(route);
  socket.on('sv', (data) => {
    const room = data && rooms.get(roomCode(data.roomId));
    if (!room || (!cloud && !auth.allowed(socket.handshake.headers))) return;
    if (room.host === socket) return data.to && [...room.viewers].some(v => v.id === String(data.to)) && socket.to(String(data.to)).emit('sv', data);
    if (room.viewers.has(socket) && room.host && room.host.connected && ['want', 'ack', 'key', 'stop'].includes(data.t)) room.host.emit('sv', { t: data.t, seq: Number(data.seq) || 0, roomId: data.roomId, from: socket.id });
  });

  socket.on('input-event', (data) => {
    if (socket.data.role === 'view') return socket.emit('input-dropped', { reason: 'view-only' });
    if (!cloud && !auth.allowed(socket.handshake.headers)) return socket.emit('input-dropped', { reason: 'passkey required' });
    const room = rooms.get(roomCode(data.roomId));
    // Never drop input silently -- a dead relay used to look identical to a working one,
    // because video rides WebRTC peer-to-peer and keeps flowing after signaling dies.
    if (!room) return socket.emit('input-dropped', { roomId: data.roomId, reason: 'no-room' });
    if (!room.viewers.has(socket)) return socket.emit('input-dropped', { roomId: data.roomId, reason: 'not-joined' });
    if (relayedInput && !cloud) relayedInput(data);
    if (room.host && room.host.connected) room.host.emit('input-event', data);
  });

  socket.on('disconnect', () => {
    for (const [, room] of rooms) {
      // Keep the room. An 8s delete made "Room not found" the default after a
      // renderer crash or a quiet socket drop; video on an old viewer kept working
      // so it looked like the host was up. The next phone then missed the code.
      if (room.host === socket) room.host = null;
      else if (room.viewers.has(socket)) {
        room.viewers.delete(socket);
        if (room.host && room.host.connected) room.host.emit('viewer-left', { id: socket.id });
        emitOccupancy(room);
      }
    }
  });
});

// RDP scanners on forwarded :3389 stall without HTTP headers. A 5s headersTimeout
// also dropped Cloudflare tunnel keep-alives (cloudflared -> localhost:3389), which
// the edge reports as HTTP 502. Give proxies a minute; disable the socket idle timer.
server.headersTimeout = 60000;
server.requestTimeout = 0;
server.keepAliveTimeout = 65000;
server.timeout = 0;
server.on('connection', (sock) => {
  const ip = sock.remoteAddress || '';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') sock.setTimeout(0);
});
server.listen(PORT, '0.0.0.0', () => console.log(`Amni-Connect signaling server on port ${PORT}\nMobile viewer: http://<your-ip>:${PORT}/viewer`));
server.setRelayedInput = (fn) => { relayedInput = fn; };
module.exports = server;
