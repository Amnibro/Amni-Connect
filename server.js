require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3389;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS === '*' ? '*' : (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] } });

app.use('/socket.io-client', express.static(path.join(__dirname, 'node_modules', 'socket.io-client', 'dist')));
app.get('/viewer', (_, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, 'viewer.html'));
});
app.get('/health', (_, res) => res.json({ status: 'ok', port: PORT }));

const rooms = new Map();

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
    if (!roomId || rooms.has(roomId)) roomId = uuidv4().slice(0, 8).toUpperCase();
    
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
    if (room) room.host.emit('input-event', data);
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms) {
      if (room.host === socket) { io.to(roomId).emit('host-disconnected'); rooms.delete(roomId); }
      else if (room.viewers.has(socket)) room.viewers.delete(socket);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Amni-Connect signaling server on port ${PORT}\nMobile viewer: http://<your-ip>:${PORT}/viewer`));
module.exports = server;
