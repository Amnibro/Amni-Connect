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
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS === '*' ? '*' : (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
const INBOX_DIR = process.env.INBOX_DIR || path.join(__dirname, 'received-files');
fs.mkdirSync(INBOX_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] } });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, INBOX_DIR),
    filename: (_, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${path.basename(file.originalname).replace(/[^\w.\-]/g, '_')}`)
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

app.use('/socket.io-client', express.static(path.join(__dirname, 'node_modules', 'socket.io-client', 'dist')));
app.get('/viewer', (_, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, 'viewer.html'));
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

app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ status: 'error', message: err.message });
    if (!req.file) return res.status(400).json({ status: 'error', message: 'No file received' });
    const roomId = (req.body.roomId || '').toUpperCase();
    const room = rooms.get(roomId);
    room?.host.emit('file-received', { name: req.file.originalname, size: req.file.size, savedAs: req.file.filename });
    res.json({ status: 'ok', savedAs: req.file.filename });
  });
});

const rooms = new Map();
const HOST_GRACE_MS = 8000;

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.warn(`Amni-Connect signaling already running on port ${PORT}, reusing existing instance`);
    return;
  }
  console.error('Amni-Connect signaling server error:', err);
});

io.on('connection', (socket) => {
  socket.on('create-room', (customId) => {
    let roomId = (customId && typeof customId === 'string' && customId.trim().length >= 4) 
      ? customId.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') 
      : uuidv4().slice(0, 8).toUpperCase();
    // A host reconnecting to its own fixed room code must RECLAIM it, not
    // silently drift to a random id -- that stranded the PC under an unguessable room and
    // looked like "no room" from the phone. Only bump to a random id if a LIVE host holds it.
    if (!roomId) {
      roomId = uuidv4().slice(0, 8).toUpperCase();
    } else {
      const existing = rooms.get(roomId);
      if (existing && existing.host && existing.host !== socket && existing.host.connected) {
        roomId = uuidv4().slice(0, 8).toUpperCase();
      } else if (existing) {
        if (existing.host && existing.host !== socket) { try { existing.host.leave(roomId); } catch (_) {} }
        rooms.delete(roomId);
      }
    }
    
    rooms.set(roomId, { host: socket, viewers: new Set() });
    socket.join(roomId);
    socket.emit('room-created', roomId);
  });

  socket.on('join-room', (roomId) => {
    const room = rooms.get(roomId?.toUpperCase());
    if (!room) return socket.emit('error', 'Room not found');
    const id = roomId.toUpperCase();
    socket.join(id);
    room.viewers.add(socket);
    socket.emit('room-joined', id);
    room.host.emit('viewer-joined', socket.id);
  });

  socket.on('offer', (data) => socket.to(data.roomId).emit('offer', data));
  socket.on('answer', (data) => socket.to(data.roomId).emit('answer', data));
  socket.on('ice-candidate', (data) => socket.to(data.roomId).emit('ice-candidate', data));

  socket.on('input-event', (data) => {
    const room = rooms.get(data.roomId?.toUpperCase());
    // Never drop input silently -- a dead relay used to look identical to a working one,
    // because video rides WebRTC peer-to-peer and keeps flowing after signaling dies.
    if (room && room.host && room.host.connected) room.host.emit('input-event', data);
    else socket.emit('input-dropped', { roomId: data.roomId, reason: room ? 'host-offline' : 'no-room' });
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms) {
      if (room.host === socket) {
        // Grace period: a host whose websocket blips reclaims the room on reconnect
        // (index.html re-emits create-room). Only tear the session down if it stays gone.
        setTimeout(() => {
          const cur = rooms.get(roomId);
          if (cur && cur.host === socket) { io.to(roomId).emit('host-disconnected'); rooms.delete(roomId); }
        }, HOST_GRACE_MS);
      }
      else if (room.viewers.has(socket)) room.viewers.delete(socket);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Amni-Connect signaling server on port ${PORT}\nMobile viewer: http://<your-ip>:${PORT}/viewer`));
module.exports = server;
