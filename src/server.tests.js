import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import socketIoClient from 'socket.io-client';
import createServer from './server';

const PORT = 5428;
const SERVER_URL = `http://localhost:${PORT}`;
const TEST_ID = '7914';
const LEADER_TOKEN = 'token';
const FOLLOWER_ID = '8634';
const MESSAGE = 'test-message';
let server;
const sockets = [];

const io = (query) => {
  const socket = socketIoClient(SERVER_URL, {
    transports: ['websocket'],
    query,
  });
  sockets.push(socket);
  return socket;
};

beforeEach(() => {
  server = createServer(PORT);
});

afterEach(async () => {
  sockets.forEach(s => s.close());
  sockets.length = 0;
  await new Promise(resolve => server.close(resolve));
});

const getEvent = (socket, eventName) =>
  new Promise(resolve => socket.once(eventName, (...args) => resolve(args)));

it('can\'t connect without id', async () => {
  const socket = io();
  const [message] = await getEvent(socket, 'error');
  expect(message).to.be.equal('id is missed');
});

it('can\'t connect with the same id', async () => {
  io({ id: TEST_ID });
  const socket = io({ id: TEST_ID });
  const [message] = await getEvent(socket, 'error');
  expect(message).to.be.equal(`Already connected with this id: ${TEST_ID}`);
});

const leaderWithOneFollower = async () => {
  const follower = io({ id: FOLLOWER_ID });
  await getEvent(follower, 'connect');
  const leader = io({ id: TEST_ID, token: LEADER_TOKEN });
  leader.emit('add-follower', FOLLOWER_ID);
  const [[fid]] = await Promise.all([
    getEvent(leader, 'follower-connected'),
    getEvent(follower, 'added-to-group'),
  ]);
  expect(fid).to.be.equal(FOLLOWER_ID);
  return [follower, leader];
};

describe('leader interface', () => {
  it('connect', async () => {
    const socket = io({ id: TEST_ID, token: LEADER_TOKEN });
    await getEvent(socket, 'connect');
  });

  it('connect after follower is connected', leaderWithOneFollower);

  it('add follower', async () => {
    const leader = io({ id: TEST_ID, token: LEADER_TOKEN });
    const follower = io({ id: FOLLOWER_ID });
    await getEvent(follower, 'connect');
    leader.emit('add-follower', FOLLOWER_ID);
    await Promise.all([
      getEvent(follower, 'added-to-group'),
      getEvent(leader, 'follower-connected'),
    ]);
  });

  it('emits exception on adding the same follower twice', async () => {
    const [, leader] = await leaderWithOneFollower();
    leader.emit('add-follower', FOLLOWER_ID);
    const message = (await getEvent(leader, 'exception'))[0];
    expect(message).to.be.equal(`Client with id ${FOLLOWER_ID} is already added to group`);
  });

  it('remove follower', async () => {
    const [follower, leader] = await leaderWithOneFollower();
    leader.emit('remove-follower', FOLLOWER_ID);
    await getEvent(follower, 'removed-from-group');
  });

  it('message to follower', async () => {
    const [follower, leader] = await leaderWithOneFollower();
    leader.emit('message-to-follower', FOLLOWER_ID, MESSAGE);
    const [message] = await getEvent(follower, 'message-from-leader');
    expect(message).to.be.equal(MESSAGE);
  });

  it('leader left the group', async () => {
    const [follower, leader] = await leaderWithOneFollower();
    leader.close();
    await getEvent(follower, 'leader-disconnected');
  });

  it('get all followers', async () => {
    const [, leader] = await leaderWithOneFollower();
    leader.emit('get-all-followers');
    const followers = await getEvent(leader, 'get-all-followers');
    expect(followers[0][0]).to.be.equal(FOLLOWER_ID);
  });
});

describe('follower interface', () => {
  it('connect', async () => {
    const socket = io({ id: TEST_ID });
    await getEvent(socket, 'connect');
  });

  it('connect after leader is connected', async () => {
    const leader = io({ id: TEST_ID, token: LEADER_TOKEN });
    await getEvent(leader, 'connect');
    leader.emit('add-follower', FOLLOWER_ID);
    const follower = io({ id: FOLLOWER_ID });
    const [[fid]] = await Promise.all([
      getEvent(leader, 'follower-connected'),
      getEvent(follower, 'added-to-group'),
    ]);
    expect(fid).to.be.equal(FOLLOWER_ID);
  });

  it('message to leader', async () => {
    const [follower, leader] = await leaderWithOneFollower();
    follower.emit('message-to-leader', MESSAGE);
    const [fid, message] = await getEvent(leader, 'message-from-follower');
    expect(fid).to.be.equal(FOLLOWER_ID);
    expect(message).to.be.equal(MESSAGE);
  });

  it('leave group', async () => {
    const [follower, leader] = await leaderWithOneFollower();
    follower.emit('leave-group');
    const [[fid]] = await Promise.all([
      getEvent(leader, 'follower-removed'),
      getEvent(follower, 'removed-from-group'),
    ]);
    expect(fid).to.be.equal(FOLLOWER_ID);
  });

  it('emits exception on leaving when is not in group', async () => {
    const follower = io({ id: FOLLOWER_ID });
    await getEvent(follower, 'connect');
    follower.emit('leave-group');
    const message = (await getEvent(follower, 'exception'))[0];
    expect(message).to.be.equal('Not in a group');
  });

  it('emit event on disconnect', async () => {
    const [follower, leader] = await leaderWithOneFollower();
    follower.close();
    const [id] = await getEvent(leader, 'follower-disconnected');
    expect(id).to.be.equal(FOLLOWER_ID);
  });
});

it('message to all', async () => {
  const [follower, leader] = await leaderWithOneFollower();
  const checkMessage = async (socket) => {
    const [message] = await getEvent(socket, 'message');
    expect(message).to.be.equal(MESSAGE);
  };
  leader.emit('message-to-all', MESSAGE);
  await checkMessage(follower);
  follower.emit('message-to-all', MESSAGE);
  await checkMessage(leader);
});
