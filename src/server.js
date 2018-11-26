import Server from 'socket.io';
import sendPushNotification from './push';

export default (port) => {
  const io = Server(port);

  const getGroupName = leaderId => `${leaderId}-group`;
  const leaderIds = {};
  const leaderTokens = {};

  // eslint-disable-next-line no-underscore-dangle
  io.engine.generateId = req => req._query.id || 'invalid-id';

  io.sockets.use((socket, next) => {
    const { id } = socket.handshake.query;
    if (!id) next(new Error('id is missed'));
    else if (io.sockets.sockets[id]) {
      next(new Error(`Already connected with this id: ${id}`));
    } else next();
  });

  io.on('connection', (socket) => {
    const { id, token } = socket.handshake.query;

    socket.on('message-to-all', message =>
      socket
        .to(getGroupName(token ? id : leaderIds[id]))
        .emit('message', message));

    if (token) {
      const groupName = getGroupName(id);
      socket.join(groupName);
      leaderTokens[id] = token;

      const addFollower = async (fid) => {
        if (leaderIds[fid]) {
          socket.emit('exception', `Client with id ${fid} is already added to group`);
          return;
        }
        leaderIds[fid] = id;
        const fSocket = io.sockets.sockets[fid];
        if (fSocket) {
          fSocket.join(groupName);
          fSocket.emit('added-to-group');
          socket.emit('follower-connected', fid);
        }
      };
      const removeFollower = async (fid) => {
        delete leaderIds[fid];
        const fSocket = io.sockets.sockets[fid];
        if (fSocket) {
          fSocket.leave(groupName);
          fSocket.emit('removed-from-group');
        }
      };
      socket.on('get-all-followers', () => {
        const followers = Object.keys(io.sockets.sockets);
        followers.splice(followers.indexOf(id), 1);
        socket.emit('get-all-followers', followers);
      });

      socket.on('add-follower', addFollower);
      socket.on('remove-follower', removeFollower);

      socket.on('message-to-follower', (fid, message) =>
        socket.to(fid).emit('message-from-leader', message));

      socket.on('disconnect', () =>
        socket.to(getGroupName(id)).emit('leader-disconnected'));
    } else {
      if (leaderIds[id]) {
        socket.join(getGroupName(leaderIds[id]));
        socket.emit('added-to-group');
        socket.to(leaderIds[id]).emit('follower-connected', id);
      }

      socket.on('message-to-leader', (message) => {
        if (socket.to(leaderIds[id]).connected) {
          socket.to(leaderIds[id]).emit('message-from-follower', id, message);
        } else {
          sendPushNotification(leaderTokens[leaderIds[id]], id, message);
        }
      });

      socket.on('leave-group', () => {
        const leaderId = leaderIds[id];
        if (!leaderId) {
          socket.emit('exception', 'Not in a group');
          return;
        }
        socket
          .leave(getGroupName(leaderId))
          .emit('removed-from-group');
        socket.to(leaderId).emit('follower-removed', id);
        delete leaderIds[id];
      });

      socket.on('disconnect', () =>
        socket.to(leaderIds[id]).emit('follower-disconnected', id));
    }
  });

  return io;
};
