const io = require('socket.io')(process.env.PORT || 8079);

io.on('connection', (socket) => {
  const { key } = socket.handshake.query;

  const room = io.sockets.adapter.rooms[key];
  const clientsCount = room ? Object.keys(room.sockets).length : 0;

  if (clientsCount >= 2) {
    socket.disconnect();
    return;
  }

  socket.join(key);

  if (clientsCount === 1) {
    io.to(key).emit('ready');
  } else {
    socket.emit('first');
  }

  ['ice-candidate', 'description'].forEach(event =>
    socket.on(event, data => socket.to(key).emit(event, data)));
});
