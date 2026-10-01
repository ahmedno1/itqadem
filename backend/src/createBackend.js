const crypto = require('crypto');
const gameRules = require('../../shared/gameRules');
const { PORT, MANAGER_GAME_GRACE, MANAGER_LOBBY_GRACE, MANAGER_GAME_VOTE_DELAY,
  MANAGER_LOBBY_VOTE_DELAY, PRIVATE_PREVIEW_DURATION,
  DEFENSE_ENDING_DURATION, ELIMINATION_PAUSE, ELIMINATION_SPIN_DURATION,
  ELIMINATION_REVEAL_DURATION } = require('./config/constants');
const { createApp } = require('./app');
const RoomManager = require('./core/RoomManager');
const TimerManager = require('./core/TimerManager');
const registerSocketHandlers = require('./socket');
const { server, io } = createApp();
const timerManager = new TimerManager();
const roomManager = new RoomManager(timerManager);
const rooms = roomManager.rooms;

function createToken() {
  return roomManager.createToken();
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function sendError(socket, callback, message) {
  const response = { ok: false, error: message };
  if (typeof callback === 'function') callback(response);
  socket.emit('roomError', response);
}

function getRoomForSocket(socket) {
  return roomManager.getRoomForSocket(socket);
}

function getPlayerBySocket(room, socketId) {
  return room.getPlayerBySocket(socketId);
}

function getRole(room, socket) {
  return room.getRole(socket.id);
}

function stopVoiceSpeaking(room, socketId) {
  const speaker = room.voiceSpeakers.get(socketId);
  if (!speaker) return;
  room.voiceSpeakers.delete(socketId);
  io.to(room.roomId).emit('voiceSpeaking', { ...speaker, active: false });
}

function publicRoomState(room, socket) {
  return room.getSanitizedState(socket.id);
}

function publishRoom(room) {
  for (const socketId of io.sockets.adapter.rooms.get(room.roomId) || []) {
    const client = io.sockets.sockets.get(socketId);
    if (client?.connected) {
      client.emit('roomState', publicRoomState(room, client));
    }
  }
}

function replyWithRoom(socket, callback, room, extra = {}) {
  const response = { ok: true, ...extra, state: publicRoomState(room, socket) };
  if (typeof callback === 'function') callback(response);
  socket.emit('roomState', response.state);
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function distributeTraps(room, targets, authors) {
  const answers = authors.map((player) => ({ authorId: player.id, text: room.trapAnswers.get(player.id) }));

  if (authors.length < targets.length) return false;

  if (authors.some((author) => !targets.some((target) => target.id === author.id))) {
    const shuffledAnswers = shuffle(answers);
    targets.forEach((target, index) => room.assignedTraps.set(target.id, shuffledAnswers[index % shuffledAnswers.length].text));
    return true;
  }

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const shuffledAnswers = shuffle(answers);
    if (targets.every((target, index) => target.id !== shuffledAnswers[index].authorId)) {
      targets.forEach((target, index) => room.assignedTraps.set(target.id, shuffledAnswers[index].text));
      return true;
    }
  }

  const offset = crypto.randomInt(1, authors.length);
  targets.forEach((target, index) => {
    const answer = answers[(index + offset) % answers.length];
    room.assignedTraps.set(target.id, answer.text);
  });
  return true;
}

function configureTrapDirection(room) {
  const active = activePlayers(room);
  const eliminated = room.players.filter((player) => player.isEliminated && player.isConnected);
  const originalCount = room.originalPlayerCount || room.players.length;
  const reverseDirection = gameRules.shouldUseEliminatedAuthors({
    round: room.round,
    finalRound: room.finalRound,
    activeCount: active.length,
    originalPlayerCount: originalCount
  });
  room.trapTargetIds = active.map((player) => player.id);
  room.trapAuthorIds = (reverseDirection ? eliminated : connectedPlayers(room)).map((player) => player.id);
}

function clearRoomTimer(room) {
  timerManager.clearRoomTimer(room);
}

function clearManagerTimer(room) {
  timerManager.clearManagerTimer(room);
}

function connectedPlayers(room) {
  return room.players.filter((player) => player.isConnected && player.socketId);
}

function activePlayers(room) {
  return connectedPlayers(room).filter((player) => !player.isEliminated);
}

function startDefenseTurn(room) {
  clearRoomTimer(room);
  room.status = 'DEFENSE';
  room.defenseOrder = activePlayers(room).map((player) => player.id);
  room.turnIndex = 0;
  room.trapRevealed = false;
  room.defenseEndsAt = null;
  room.trapAuthorIds = [];
  room.trapTargetIds = [];

  if (room.defenseOrder.length === 0) {
    room.turnEndsAt = null;
    publishRoom(room);
    return;
  }

  beginCurrentDefense(room);
}

function beginCurrentDefense(room) {
  const playerId = room.defenseOrder[room.turnIndex];
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player || !player.isConnected) {
    advanceDefense(room);
    return;
  }

  room.status = 'DEFENSE';
  room.trapRevealed = false;
  room.turnEndsAt = null;
  room.defenseEndsAt = null;
  publishRoom(room);
  const playerSocket = io.sockets.sockets.get(player.socketId);
  playerSocket?.emit('privateTrap', { text: room.assignedTraps.get(player.id) || '' });
  timerManager.setRoomTimer(room, () => revealCurrentDefenseTrap(room, true), PRIVATE_PREVIEW_DURATION);
}

function revealCurrentDefenseTrap(room, automatic = false) {
  if (room.status !== 'DEFENSE' || room.trapRevealed) return false;
  clearRoomTimer(room);
  const playerId = room.defenseOrder[room.turnIndex];
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player) return false;

  room.trapRevealed = true;
  io.to(room.roomId).emit('trapRevealed', {
    playerId: player.id,
    playerName: player.name,
    answer: room.assignedTraps.get(player.id) || '',
    automatic
  });
  publishRoom(room);
  return true;
}

function beginElimination(room) {
  clearRoomTimer(room);
  if (room.finalRound && activePlayers(room).length === 1) {
    room.status = 'FINAL_CHALLENGE';
    room.finalStage = 'DECISION';
    room.finalistId = activePlayers(room)[0].id;
    room.finalQuestion = room.currentQuestion;
    room.turnEndsAt = null;
    room.defenseEndsAt = null;
    publishRoom(room);
    return;
  }
  room.status = 'ELIMINATION';
  room.turnEndsAt = null;
  room.defenseEndsAt = null;
  room.defenseOrder = [];
  room.turnIndex = 0;
  publishRoom(room);
}

function advanceDefense(room) {
  if (!['DEFENSE', 'DEFENSE_ENDING'].includes(room.status)) return;
  clearRoomTimer(room);
  room.defenseEndsAt = null;
  const currentPlayerId = room.defenseOrder[room.turnIndex];
  if (currentPlayerId) room.assignedTraps.delete(currentPlayerId);
  room.trapRevealed = false;

  while (room.turnIndex < room.defenseOrder.length - 1) {
    room.turnIndex += 1;
    const nextPlayer = room.players.find((player) => player.id === room.defenseOrder[room.turnIndex]);
    if (nextPlayer?.isConnected) {
      beginCurrentDefense(room);
      return;
    }
  }
  beginElimination(room);
}

function tryStartDefense(room) {
  if (room.status !== 'SUBMIT_TRAPS') return;
  const targets = activePlayers(room).filter((player) => room.trapTargetIds.includes(player.id));
  const authors = connectedPlayers(room).filter((player) => room.trapAuthorIds.includes(player.id));
  if (targets.length === 0 || authors.length === 0 || !authors.every((player) => room.trapAnswers.has(player.id))) return;

  if (!distributeTraps(room, targets, authors)) return;
  startDefenseTurn(room);
}

function resetForNextRound(room) {
  room.round += 1;
  room.status = 'BOSS_QUESTION';
  room.currentQuestion = '';
  room.trapAnswers.clear();
  room.assignedTraps.clear();
  room.defenseOrder = [];
  room.turnIndex = 0;
  room.turnEndsAt = null;
  room.trapRevealed = false;
  room.eliminatedPlayerId = null;
  room.finalStage = null;
  room.finalistId = null;
  room.finalQuestion = '';
  room.finalDefense = '';
  room.finalDecision = null;
  room.eliminationPending = null;
  room.finalRound = false;
  configureTrapDirection(room);
  publishRoom(room);
}

function clearRoom(room) {
  roomManager.removeRoom(room);
}

function scheduleCleanup(room) {
  roomManager.scheduleCleanup(room);
}

function resetRoomToLobby(room) {
  clearRoomTimer(room);
  clearManagerTimer(room);
  room.status = 'LOBBY';
  room.originalPlayerCount = 0;
  room.currentQuestion = '';
  room.round = 1;
  room.turnIndex = 0;
  room.defenseOrder = [];
  room.turnEndsAt = null;
  room.defenseEndsAt = null;
  room.trapRevealed = false;
  room.trapAnswers.clear();
  room.assignedTraps.clear();
  room.trapAuthorIds = [];
  room.trapTargetIds = [];
  room.finalRound = false;
  room.finalStage = null;
  room.finalistId = null;
  room.finalQuestion = '';
  room.finalDefense = '';
  room.finalDecision = null;
  room.eliminatedPlayerId = null;
  room.eliminationPending = null;
  room.managerVote = null;
  room.managerResumeDeadline = null;
  room.managerVoteAvailableAt = null;
  room.pausedStatus = null;
  room.players.forEach((player) => {
    player.isEliminated = false;
  });
  publishRoom(room);
}

function pauseForManagerDeparture(room) {
  if (room.managerResumeDeadline || (room.status === 'FINAL_CHALLENGE' && room.finalStage === 'COMPLETE')) return;
  const isLobby = room.status === 'LOBBY';
  const now = Date.now();
  room.pausedStatus = isLobby ? null : room.status;
  if (!isLobby) {
    clearRoomTimer(room);
    room.status = 'MANAGER_PAUSED';
  }
  room.managerResumeDeadline = now + (isLobby ? MANAGER_LOBBY_GRACE : MANAGER_GAME_GRACE);
  room.managerVoteAvailableAt = now + (isLobby ? MANAGER_LOBBY_VOTE_DELAY : MANAGER_GAME_VOTE_DELAY);
  room.managerVote = null;
  clearManagerTimer(room);
  timerManager.setManagerTimer(room, () => {
    if (room.bossConnected) return;
    room.managerExpired = true;
    if (room.status !== 'LOBBY') resetRoomToLobby(room);
    else {
      room.managerResumeDeadline = null;
      room.managerVoteAvailableAt = Date.now();
      publishRoom(room);
    }
  }, isLobby ? MANAGER_LOBBY_GRACE : MANAGER_GAME_GRACE);
  publishRoom(room);
}

function restoreAfterManagerReconnect(room) {
  clearManagerTimer(room);
  const pausedStatus = room.pausedStatus;
  room.managerResumeDeadline = null;
  room.managerVoteAvailableAt = null;
  room.pausedStatus = null;
  room.managerVote = null;
  if (pausedStatus) {
    room.status = pausedStatus === 'DEFENSE_ENDING' ? 'DEFENSE' : pausedStatus;
    if (pausedStatus === 'DEFENSE' && room.defenseOrder.length > 0 && !room.trapRevealed) beginCurrentDefense(room);
    else publishRoom(room);
  } else {
    publishRoom(room);
  }
}

function transferManager(room, target) {
  const oldBoss = {
    id: crypto.randomUUID(),
    socketId: room.bossId,
    resumeToken: roomManager.createToken(),
    name: room.bossName,
    isEliminated: false,
    isConnected: room.bossConnected
  };
  room.players = room.players.filter((player) => player.id !== target.id);
  room.players.push(oldBoss);
  room.bossId = target.socketId;
  room.bossName = target.name;
  room.bossResumeToken = target.resumeToken;
  room.bossConnected = true;
  room.managerExpired = false;
  resetRoomToLobby(room);
}

function finishManagerVote(room) {
  if (!room.managerVote) return false;
  const connectedCount = connectedPlayers(room).length + (room.bossConnected ? 1 : 0);
  const counts = new Map();
  for (const candidateId of room.managerVote.votes.values()) {
    counts.set(candidateId, (counts.get(candidateId) || 0) + 1);
  }
  const candidates = room.players.filter((player) => player.isConnected && !player.isEliminated);
  if (candidates.length === 0) return false;
  const winner = candidates.find((player) => (counts.get(player.id) || 0) > connectedCount / 2);
  if (!winner && room.managerVote.votes.size < connectedCount) return false;
  const highestVotes = Math.max(...candidates.map((player) => counts.get(player.id) || 0));
  const tiedCandidates = candidates.filter((player) => (counts.get(player.id) || 0) === highestVotes);
  const selectedWinner = winner || tiedCandidates[crypto.randomInt(tiedCandidates.length)];
  if (!selectedWinner) return false;
  transferManager(room, selectedWinner);
  return true;
}

function validateText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

registerSocketHandlers(io, {
  io,
  rooms,
  roomManager,
  timerManager,
  getRoomForSocket,
  getPlayerBySocket,
  getRole,
  sendError,
  normalizeName,
  validateText,
  replyWithRoom,
  publicRoomState,
  publishRoom,
  restoreAfterManagerReconnect,
  startDefenseTurn,
  transferManager,
  resetRoomToLobby,
  connectedPlayers,
  finishManagerVote,
  stopVoiceSpeaking,
  pauseForManagerDeparture,
  tryStartDefense,
  advanceDefense,
  scheduleCleanup,
  activePlayers,
  configureTrapDirection,
  revealCurrentDefenseTrap,
  clearRoomTimer,
  resetForNextRound
});

module.exports = { server, PORT };
