const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;
const ROOM_CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CLEANUP_DELAY = 30 * 60 * 1000;
const DEFENSE_DURATION = 60 * 1000;
const ELIMINATION_PAUSE = 2500;
const rooms = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/img', express.static(path.join(__dirname, 'img')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Game server is running' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const io = new Server(server, {
  cors: {
    origin: false,
    methods: ['GET', 'POST']
  }
});

function createToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function makeRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ROOM_CODE_CHARACTERS[crypto.randomInt(ROOM_CODE_CHARACTERS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function sendError(socket, callback, message) {
  const response = { ok: false, error: message };
  if (typeof callback === 'function') callback(response);
  socket.emit('roomError', response);
}

function getRoomForSocket(socket) {
  const roomId = socket.data.roomId;
  return roomId ? rooms.get(roomId) : null;
}

function getPlayerBySocket(room, socketId) {
  return room.players.find((player) => player.socketId === socketId) || null;
}

function getRole(room, socket) {
  if (room.bossId === socket.id) return 'boss';
  if (getPlayerBySocket(room, socket.id)) return 'player';
  return null;
}

function stopVoiceSpeaking(room, socketId) {
  const speaker = room.voiceSpeakers.get(socketId);
  if (!speaker) return;
  room.voiceSpeakers.delete(socketId);
  io.to(room.roomId).emit('voiceSpeaking', { ...speaker, active: false });
}

function publicRoomState(room, socket) {
  const role = getRole(room, socket);
  const me = room.players.find((player) => player.socketId === socket.id) || null;
  const speaker = room.defenseOrder[room.turnIndex];
  const speakerPlayer = room.players.find((player) => player.id === speaker) || null;
  const finalist = room.players.find((player) => player.id === room.finalistId) || null;

  return {
    roomId: room.roomId,
    bossId: room.bossId,
    bossName: room.bossName,
    bossConnected: room.bossConnected,
    status: room.status,
    serverNow: Date.now(),
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      isEliminated: player.isEliminated,
      isConnected: player.isConnected,
      hasSubmittedTrap: room.trapAnswers.has(player.id)
    })),
    currentQuestion: room.currentQuestion,
    round: room.round,
    turnIndex: room.turnIndex,
    currentSpeaker: speakerPlayer ? { id: speakerPlayer.id, name: speakerPlayer.name, socketId: speakerPlayer.socketId } : null,
    turnEndsAt: room.turnEndsAt,
    trapRevealed: room.trapRevealed,
    revealedTrap: room.trapRevealed ? room.assignedTraps.get(speaker) || '' : '',
    finalStage: room.finalStage,
    finalist: finalist ? { id: finalist.id, name: finalist.name, isEliminated: finalist.isEliminated } : null,
    finalQuestion: room.finalQuestion,
    finalDefense: room.finalDefense,
    finalDecision: room.finalDecision,
    eliminatedPlayerId: room.eliminatedPlayerId,
    voicePeers: [
      ...(room.bossConnected ? [{ socketId: room.bossId, name: room.bossName, role: 'boss' }] : []),
      ...room.players
        .filter((player) => player.isConnected && player.socketId)
        .map((player) => ({ socketId: player.socketId, name: player.name, role: 'player' }))
    ],
    voiceSpeakers: Array.from(room.voiceSpeakers.values()),
    chatMessages: room.chatMessages.slice(-50),
    role,
    meId: me?.id || (role === 'boss' ? room.bossId : null),
    isMyTurn: Boolean(me && speaker === me.id),
    myTrap: me && speaker === me.id ? room.assignedTraps.get(me.id) || '' : ''
  };
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

function distributeTraps(room, participants) {
  const answers = participants.map((player) => ({ authorId: player.id, text: room.trapAnswers.get(player.id) }));

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const shuffledAnswers = shuffle(answers);
    if (participants.every((player, index) => player.id !== shuffledAnswers[index].authorId)) {
      participants.forEach((player, index) => room.assignedTraps.set(player.id, shuffledAnswers[index].text));
      return true;
    }
  }

  const offset = crypto.randomInt(1, participants.length);
  participants.forEach((player, index) => {
    const answer = answers[(index + offset) % answers.length];
    room.assignedTraps.set(player.id, answer.text);
  });
  return true;
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
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

  room.trapRevealed = false;
  room.turnEndsAt = Date.now() + DEFENSE_DURATION;
  publishRoom(room);
  const playerSocket = io.sockets.sockets.get(player.socketId);
  playerSocket?.emit('privateTrap', { text: room.assignedTraps.get(player.id) || '' });
  room.timer = setTimeout(() => advanceDefense(room), DEFENSE_DURATION);
}

function beginElimination(room) {
  clearRoomTimer(room);
  room.status = 'ELIMINATION';
  room.turnEndsAt = null;
  room.defenseOrder = [];
  room.turnIndex = 0;
  publishRoom(room);
}

function advanceDefense(room) {
  if (room.status !== 'DEFENSE') return;
  clearRoomTimer(room);
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
  const participants = connectedPlayers(room);
  if (participants.length < 2 || !participants.every((player) => room.trapAnswers.has(player.id))) return;

  distributeTraps(room, participants);
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
  publishRoom(room);
}

function clearRoom(room) {
  clearRoomTimer(room);
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  rooms.delete(room.roomId);
}

function scheduleCleanup(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => clearRoom(room), ROOM_CLEANUP_DELAY);
}

function validateText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

io.on('connection', (socket) => {
  socket.emit('welcome', { text: 'مرحباً بك في لعبة أتقدم للوظيفة' });

  socket.on('createRoom', (payload = {}, callback) => {
    const bossName = normalizeName(payload.name || payload.bossName);
    if (!validateText(bossName, 40)) return sendError(socket, callback, 'يرجى إدخال اسم مدير صحيح (40 حرفاً كحد أقصى).');

    const roomId = makeRoomCode();
    const room = {
      roomId,
      bossId: socket.id,
      bossName,
      bossResumeToken: createToken(),
      bossConnected: true,
      status: 'LOBBY',
      players: [],
      currentQuestion: '',
      turnIndex: 0,
      round: 1,
      defenseOrder: [],
      turnEndsAt: null,
      trapRevealed: false,
      trapAnswers: new Map(),
      assignedTraps: new Map(),
      finalStage: null,
      finalistId: null,
      finalQuestion: '',
      finalDefense: '',
      finalDecision: null,
      eliminatedPlayerId: null,
      chatMessages: [],
      voiceSpeakers: new Map(),
      timer: null,
      cleanupTimer: null
    };
    rooms.set(roomId, room);
    socket.data.roomId = roomId;
    socket.join(roomId);
    replyWithRoom(socket, callback, room, { resumeToken: room.bossResumeToken, role: 'boss', name: bossName });
    publishRoom(room);
  });

  socket.on('joinRoom', (payload = {}, callback) => {
    const roomId = String(payload.roomId || payload.code || '').trim().toUpperCase();
    const name = normalizeName(payload.name);
    const room = rooms.get(roomId);
    if (!room) return sendError(socket, callback, 'لم يتم العثور على الغرفة. تحقق من الرمز وحاول مجدداً.');
    if (room.status !== 'LOBBY') return sendError(socket, callback, 'بدأت اللعبة بالفعل ولا يمكن الانضمام الآن.');
    if (!validateText(name, 40)) return sendError(socket, callback, 'يرجى إدخال اسم صحيح (40 حرفاً كحد أقصى).');
    const normalized = name.toLocaleLowerCase();
    if (room.bossName.toLocaleLowerCase() === normalized || room.players.some((player) => player.name.toLocaleLowerCase() === normalized)) {
      return sendError(socket, callback, 'هذا الاسم مستخدم في الغرفة بالفعل. اختر اسماً آخر.');
    }
    if (room.players.length >= 8) return sendError(socket, callback, 'الغرفة مكتملة (8 متقدمين كحد أقصى).');

    const player = {
      id: crypto.randomUUID(),
      socketId: socket.id,
      resumeToken: createToken(),
      name,
      isEliminated: false,
      isConnected: true
    };
    room.players.push(player);
    socket.data.roomId = roomId;
    socket.join(roomId);
    replyWithRoom(socket, callback, room, { resumeToken: player.resumeToken, role: 'player', name });
    publishRoom(room);
  });

  socket.on('reconnectRoom', (payload = {}, callback) => {
    const roomId = String(payload.roomId || '').trim().toUpperCase();
    const room = rooms.get(roomId);
    if (!room || typeof payload.resumeToken !== 'string') return sendError(socket, callback, 'تعذر استعادة الغرفة؛ قد تكون انتهت صلاحيتها.');
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    let role;
    let name;
    if (room.bossResumeToken === payload.resumeToken) {
      room.bossId = socket.id;
      room.bossConnected = true;
      role = 'boss';
      name = room.bossName;
    } else {
      const player = room.players.find((entry) => entry.resumeToken === payload.resumeToken);
      if (!player) return sendError(socket, callback, 'تعذر استعادة اللاعب في هذه الغرفة.');
      player.socketId = socket.id;
      player.isConnected = true;
      role = 'player';
      name = player.name;
    }

    socket.data.roomId = roomId;
    socket.join(roomId);
    if (room.status === 'DEFENSE' && room.defenseOrder.length === 0) startDefenseTurn(room);
    replyWithRoom(socket, callback, room, { resumeToken: payload.resumeToken, role, name });
    publishRoom(room);
    if (room.status === 'DEFENSE' && room.defenseOrder[room.turnIndex] === getPlayerBySocket(room, socket.id)?.id) {
      socket.emit('privateTrap', { text: room.assignedTraps.get(room.defenseOrder[room.turnIndex]) || '' });
    }
  });

  socket.on('startGame', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'هذا الإجراء متاح للمدير فقط.');
    if (room.status !== 'LOBBY') return sendError(socket, callback, 'بدأت اللعبة بالفعل.');
    if (activePlayers(room).length < 4) return sendError(socket, callback, 'تحتاج الغرفة إلى أربعة متقدمين متصلين على الأقل.');
    room.status = 'BOSS_QUESTION';
    room.round = 1;
    publishRoom(room);
    replyWithRoom(socket, callback, room);
  });

  socket.on('submitBossQuestion', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'هذا الإجراء متاح للمدير فقط.');
    if (room.status !== 'BOSS_QUESTION') return sendError(socket, callback, 'الغرفة ليست في مرحلة سؤال المدير.');
    const question = typeof payload.question === 'string' ? payload.question.trim() : '';
    if (!validateText(question, 500)) return sendError(socket, callback, 'اكتب سؤالاً لا يتجاوز 500 حرف.');

    room.currentQuestion = question;
    room.trapAnswers.clear();
    room.assignedTraps.clear();
    room.status = 'SUBMIT_TRAPS';
    publishRoom(room);
    replyWithRoom(socket, callback, room);
  });

  socket.on('submitTrapAnswer', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const player = room && getPlayerBySocket(room, socket.id);
    if (!room || !player) return sendError(socket, callback, 'انضم إلى الغرفة كمتقدم أولاً.');
    if (room.status !== 'SUBMIT_TRAPS') return sendError(socket, callback, 'الغرفة لا تستقبل إجابات في هذه المرحلة.');
    const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
    if (!validateText(answer, 500)) return sendError(socket, callback, 'اكتب إجابة لا تتجاوز 500 حرف.');
    if (room.trapAnswers.has(player.id)) return sendError(socket, callback, 'تم إرسال إجابتك بالفعل في هذه الجولة.');

    room.trapAnswers.set(player.id, answer);
    if (typeof callback === 'function') callback({ ok: true });
    publishRoom(room);
    tryStartDefense(room);
  });

  socket.on('sendChatMessage', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const role = room && getRole(room, socket);
    const player = room && getPlayerBySocket(room, socket.id);
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!room || !role) return sendError(socket, callback, 'انضم إلى الغرفة لإرسال رسالة.');
    if (!validateText(text, 300)) return sendError(socket, callback, 'اكتب رسالة من 1 إلى 300 حرف.');
    const now = Date.now();
    if (now - (socket.data.lastChatAt || 0) < 500) return sendError(socket, callback, 'انتظر لحظة قبل إرسال رسالة أخرى.');

    socket.data.lastChatAt = now;
    const message = {
      id: crypto.randomUUID(),
      name: role === 'boss' ? room.bossName : player.name,
      text,
      sentAt: now
    };
    room.chatMessages.push(message);
    room.chatMessages = room.chatMessages.slice(-50);
    io.to(room.roomId).emit('chatMessage', message);
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('sendReaction', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const role = room && getRole(room, socket);
    const player = room && getPlayerBySocket(room, socket.id);
    const allowedReactions = ['👏', '😂', '🔥', '💯', '❤️', '😮'];
    if (!room || !role) return sendError(socket, callback, 'انضم إلى الغرفة لإرسال تفاعل.');
    if (room.status !== 'DEFENSE') return sendError(socket, callback, 'التفاعلات متاحة أثناء مرحلة التبرير فقط.');
    if (!allowedReactions.includes(payload.emoji)) return sendError(socket, callback, 'هذا التفاعل غير متاح.');

    io.to(room.roomId).emit('reaction', {
      emoji: payload.emoji,
      name: role === 'boss' ? room.bossName : player.name,
      sentAt: Date.now()
    });
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('voiceSignal', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const targetSocketId = payload.targetSocketId;
    const signal = payload.signal;
    const roomSocketIds = room && io.sockets.adapter.rooms.get(room.roomId);
    if (!room || !getRole(room, socket) || typeof targetSocketId !== 'string' || !roomSocketIds?.has(targetSocketId)) {
      return sendError(socket, callback, 'تعذر إنشاء الاتصال الصوتي داخل هذه الغرفة.');
    }

    const isDescription = signal?.type === 'description'
      && ['offer', 'answer'].includes(signal.description?.type)
      && typeof signal.description.sdp === 'string'
      && signal.description.sdp.length <= 16000;
    const isCandidate = signal?.type === 'candidate'
      && signal.candidate
      && typeof signal.candidate.candidate === 'string'
      && signal.candidate.candidate.length <= 2000;
    if (!isDescription && !isCandidate) return sendError(socket, callback, 'بيانات الاتصال الصوتي غير صالحة.');

    io.to(targetSocketId).emit('voiceSignal', { from: socket.id, signal });
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('voiceSpeaking', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const role = room && getRole(room, socket);
    const player = room && getPlayerBySocket(room, socket.id);
    if (!room || !role) return sendError(socket, callback, 'انضم إلى الغرفة لإظهار حالة التحدث.');

    if (payload.active === true) {
      const speaker = {
        socketId: socket.id,
        name: role === 'boss' ? room.bossName : player.name
      };
      room.voiceSpeakers.set(socket.id, speaker);
      io.to(room.roomId).emit('voiceSpeaking', { ...speaker, active: true });
    } else {
      stopVoiceSpeaking(room, socket.id);
    }
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('revealTrap', (payload, callback) => {
    const room = getRoomForSocket(socket);
    const player = room && getPlayerBySocket(room, socket.id);
    const currentId = room?.defenseOrder[room.turnIndex];
    if (!room || room.status !== 'DEFENSE' || !player || player.id !== currentId) {
      return sendError(socket, callback, 'لا يمكنك كشف البطاقة في هذا الدور.');
    }
    if (room.trapRevealed) return sendError(socket, callback, 'تم كشف البطاقة بالفعل.');
    room.trapRevealed = true;
    const answer = room.assignedTraps.get(player.id) || '';
    io.to(room.roomId).emit('trapRevealed', {
      playerId: player.id,
      playerName: player.name,
      answer,
      turnEndsAt: room.turnEndsAt
    });
    publishRoom(room);
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('finishDefense', (payload, callback) => {
    const room = getRoomForSocket(socket);
    const player = room && getPlayerBySocket(room, socket.id);
    if (!room || room.status !== 'DEFENSE' || !player || room.defenseOrder[room.turnIndex] !== player.id) {
      return sendError(socket, callback, 'لا يمكنك إنهاء هذا الدور.');
    }
    if (typeof callback === 'function') callback({ ok: true });
    advanceDefense(room);
  });

  socket.on('eliminatePlayer', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'هذا الإجراء متاح للمدير فقط.');
    if (room.status !== 'ELIMINATION') return sendError(socket, callback, 'الغرفة ليست في مرحلة الاستبعاد.');
    if (room.eliminatedPlayerId) return sendError(socket, callback, 'تم اختيار اللاعب المستبعد بالفعل.');
    const target = room.players.find((player) => player.id === payload.playerId && !player.isEliminated);
    if (!target) return sendError(socket, callback, 'المتقدم المحدد غير متاح للاستبعاد.');

    target.isEliminated = true;
    room.eliminatedPlayerId = target.id;
    room.status = 'ELIMINATION';
    const survivors = room.players.filter((player) => !player.isEliminated);
    io.to(room.roomId).emit('eliminationResult', {
      eliminatedPlayerId: target.id,
      eliminatedPlayerName: target.name,
      survivors: survivors.map((player) => ({ id: player.id, name: player.name }))
    });
    publishRoom(room);
    if (typeof callback === 'function') callback({ ok: true });

    clearRoomTimer(room);
    room.timer = setTimeout(() => {
      if (survivors.length <= 1) {
        room.status = 'FINAL_CHALLENGE';
        room.finalStage = 'QUESTION';
        room.finalistId = survivors[0]?.id || null;
        room.currentQuestion = '';
        room.finalQuestion = '';
        room.finalDefense = '';
        room.finalDecision = null;
        room.turnEndsAt = null;
        publishRoom(room);
      } else {
        resetForNextRound(room);
      }
    }, ELIMINATION_PAUSE);
  });

  socket.on('submitFinalQuestion', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'هذا الإجراء متاح للمدير فقط.');
    if (room.status !== 'FINAL_CHALLENGE' || room.finalStage !== 'QUESTION') return sendError(socket, callback, 'الغرفة ليست جاهزة للسؤال النهائي.');
    const question = typeof payload.question === 'string' ? payload.question.trim() : '';
    if (!validateText(question, 500)) return sendError(socket, callback, 'اكتب سؤالاً لا يتجاوز 500 حرف.');
    room.finalQuestion = question;
    room.finalStage = 'DEFENSE';
    publishRoom(room);
    replyWithRoom(socket, callback, room);
  });

  socket.on('submitFinalDefense', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const player = room && getPlayerBySocket(room, socket.id);
    const finalist = room?.players.find((entry) => !entry.isEliminated);
    if (!room || room.status !== 'FINAL_CHALLENGE' || room.finalStage !== 'DEFENSE' || !player || player.id !== finalist?.id) {
      return sendError(socket, callback, 'الدفاع النهائي متاح للمتقدم الأخير فقط.');
    }
    const defense = typeof payload.defense === 'string' ? payload.defense.trim() : '';
    if (!validateText(defense, 1000)) return sendError(socket, callback, 'اكتب دفاعاً لا يتجاوز 1000 حرف.');
    room.finalDefense = defense;
    room.finalStage = 'DECISION';
    publishRoom(room);
    replyWithRoom(socket, callback, room);
  });

  socket.on('finalDecision', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'هذا الإجراء متاح للمدير فقط.');
    if (room.status !== 'FINAL_CHALLENGE' || room.finalStage !== 'DECISION') return sendError(socket, callback, 'لا يمكن حسم النتيجة الآن.');
    if (!['accept', 'reject'].includes(payload.decision)) return sendError(socket, callback, 'القرار غير صالح.');
    const finalist = room.players.find((player) => player.id === room.finalistId);
    if (!finalist) return sendError(socket, callback, 'لم يتم العثور على المتقدم الأخير.');
    finalist.isEliminated = payload.decision === 'reject';
    room.finalDecision = payload.decision;
    room.finalStage = 'COMPLETE';
    publishRoom(room);
    replyWithRoom(socket, callback, room);
  });

  socket.on('leaveRoom', (payload, callback) => {
    const room = getRoomForSocket(socket);
    if (room) {
      stopVoiceSpeaking(room, socket.id);
      if (room.bossId === socket.id) {
        room.bossConnected = false;
      } else {
        const player = getPlayerBySocket(room, socket.id);
        if (player) player.isConnected = false;
      }
      const departingPlayer = getPlayerBySocket(room, socket.id);
      socket.leave(room.roomId);
      socket.data.roomId = null;
      publishRoom(room);
      if (room.status === 'SUBMIT_TRAPS') tryStartDefense(room);
      if (room.status === 'DEFENSE' && departingPlayer?.id === room.defenseOrder[room.turnIndex]) {
        advanceDefense(room);
      }
      if (!room.bossConnected && connectedPlayers(room).length === 0) scheduleCleanup(room);
    }
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('disconnect', () => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    stopVoiceSpeaking(room, socket.id);
    if (room.bossId === socket.id) {
      room.bossConnected = false;
    } else {
      const player = getPlayerBySocket(room, socket.id);
      if (player) player.isConnected = false;
    }
    publishRoom(room);

    if (room.status === 'SUBMIT_TRAPS') tryStartDefense(room);
    if (room.status === 'DEFENSE' && room.defenseOrder[room.turnIndex] === getPlayerBySocket(room, socket.id)?.id) {
      advanceDefense(room);
    }
    if (!room.bossConnected && connectedPlayers(room).length === 0) scheduleCleanup(room);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
