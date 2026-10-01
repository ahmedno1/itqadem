function registerRoomHandlers(socket, dependencies) {
  const {
    io, rooms, roomManager, timerManager, getRoomForSocket, getPlayerBySocket, getRole,
    sendError, normalizeName, validateText, replyWithRoom, publishRoom,
    restoreAfterManagerReconnect, startDefenseTurn, transferManager, resetRoomToLobby,
    connectedPlayers, finishManagerVote, stopVoiceSpeaking, pauseForManagerDeparture,
    tryStartDefense, advanceDefense, scheduleCleanup, publicRoomState
  } = dependencies;

  socket.on('createRoom', (payload = {}, callback) => {
    const bossName = normalizeName(payload.name || payload.bossName);
    if (!validateText(bossName, 40)) return sendError(socket, callback, 'يرجى إدخال اسم مدير صحيح (40 حرفاً كحد أقصى).');

    const room = roomManager.createRoom(socket.id, bossName);
    socket.data.roomId = room.roomId;
    socket.join(room.roomId);
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
    if (room.bannedNames.has(normalized)) return sendError(socket, callback, 'تم منع هذا الاسم من دخول الغرفة. استخدم غرفة أخرى.');
    if (room.bossName.toLocaleLowerCase() === normalized || room.players.some((player) => player.name.toLocaleLowerCase() === normalized)) {
      return sendError(socket, callback, 'هذا الاسم مستخدم في الغرفة بالفعل. اختر اسماً آخر.');
    }
    const player = {
      id: require('crypto').randomUUID(),
      socketId: socket.id,
      resumeToken: roomManager.createToken(),
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
    timerManager.clearCleanupTimer(room);

    let role;
    let name;
    if (room.bossResumeToken === payload.resumeToken) {
      if (room.managerExpired) {
        const formerManager = {
          id: require('crypto').randomUUID(),
          socketId: socket.id,
          resumeToken: payload.resumeToken,
          name: room.bossName,
          isEliminated: false,
          isConnected: true
        };
        room.players.push(formerManager);
        room.bossId = null;
        room.bossResumeToken = null;
        room.bossConnected = false;
        room.managerExpired = false;
        room.managerResumeDeadline = null;
        role = 'player';
        name = formerManager.name;
      } else {
        room.bossId = socket.id;
        room.bossConnected = true;
        restoreAfterManagerReconnect(room);
        role = 'boss';
        name = room.bossName;
      }
    } else {
      const player = room.players.find((entry) => entry.resumeToken === payload.resumeToken);
      if (!player || room.bannedNames.has(player.name.toLocaleLowerCase())) return sendError(socket, callback, 'تم منع هذا اللاعب من دخول الغرفة.');
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

  socket.on('transferManager', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const target = room?.players.find((player) => player.id === payload.playerId);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'تسليم الإدارة متاح للمدير فقط.');
    if (room.status !== 'LOBBY') return sendError(socket, callback, 'يمكن تغيير المدير قبل بدء اللعبة فقط.');
    if (!target?.isConnected || target.isEliminated) return sendError(socket, callback, 'المتقدم المحدد غير متصل أو غير متاح.');
    transferManager(room, target);
    if (typeof callback === 'function') callback({ ok: true, state: publicRoomState(room, socket) });
  });

  socket.on('kickPlayer', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const target = room?.players.find((player) => player.id === payload.playerId);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'طرد اللاعبين متاح للمدير فقط.');
    if (room.status !== 'LOBBY') return sendError(socket, callback, 'يمكن طرد اللاعبين من غرفة الانتظار فقط.');
    if (!target) return sendError(socket, callback, 'لم يتم العثور على اللاعب.');
    target.isConnected = false;
    const targetSocket = io.sockets.sockets.get(target.socketId);
    targetSocket?.disconnect(true);
    publishRoom(room);
    if (typeof callback === 'function') callback({ ok: true, state: publicRoomState(room, socket) });
  });

  socket.on('banPlayer', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const target = room?.players.find((player) => player.id === payload.playerId);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'منع اللاعبين متاح للمدير فقط.');
    if (room.status !== 'LOBBY') return sendError(socket, callback, 'يمكن منع اللاعبين من غرفة الانتظار فقط.');
    if (!target) return sendError(socket, callback, 'لم يتم العثور على اللاعب.');
    room.bannedNames.add(target.name.toLocaleLowerCase());
    const targetSocket = io.sockets.sockets.get(target.socketId);
    room.players = room.players.filter((player) => player.id !== target.id);
    targetSocket?.disconnect(true);
    publishRoom(room);
    if (typeof callback === 'function') callback({ ok: true, state: publicRoomState(room, socket) });
  });

  socket.on('restartRoom', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'إعادة الغرفة متاحة للمدير فقط.');
    if (room.status !== 'FINAL_CHALLENGE' || room.finalStage !== 'COMPLETE') return sendError(socket, callback, 'يمكن إعادة الغرفة بعد انتهاء اللعبة فقط.');
    resetRoomToLobby(room);
    if (typeof callback === 'function') callback({ ok: true, state: publicRoomState(room, socket) });
  });

  socket.on('startManagerVote', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const postGameVote = room?.status === 'FINAL_CHALLENGE' && room.finalStage === 'COMPLETE';
    const managerAwayVote = room && !room.bossConnected
      && ['LOBBY', 'MANAGER_PAUSED'].includes(room.status)
      && Number.isFinite(room.managerVoteAvailableAt)
      && Date.now() >= room.managerVoteAvailableAt;
    if (!room || (!postGameVote && !managerAwayVote)) return sendError(socket, callback, 'لم يحن وقت التصويت على المدير بعد.');
    if (room.managerVote) return sendError(socket, callback, 'يوجد تصويت مدير قائم بالفعل.');
    room.managerVote = { votes: new Map() };
    publishRoom(room);
    if (typeof callback === 'function') callback({ ok: true, state: publicRoomState(room, socket) });
  });

  socket.on('castManagerVote', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const target = room?.players.find((player) => player.id === payload.playerId);
    if (!room?.managerVote) return sendError(socket, callback, 'لا يوجد تصويت مدير قائم.');
    if (!getRole(room, socket)) return sendError(socket, callback, 'انضم إلى الغرفة للتصويت.');
    if (!target?.isConnected || target.isEliminated) return sendError(socket, callback, 'المرشح غير متاح للتصويت.');
    room.managerVote.votes.set(socket.id, target.id);
    if (!finishManagerVote(room)) publishRoom(room);
    if (typeof callback === 'function') callback({ ok: true, state: publicRoomState(room, socket) });
  });

  socket.on('leaveRoom', (payload, callback) => {
    const room = getRoomForSocket(socket);
    if (room) {
      stopVoiceSpeaking(room, socket.id);
      if (room.bossId === socket.id) {
        room.bossConnected = false;
        pauseForManagerDeparture(room);
      } else {
        const player = getPlayerBySocket(room, socket.id);
        if (player) player.isConnected = false;
      }
      const departingPlayer = getPlayerBySocket(room, socket.id);
      socket.leave(room.roomId);
      socket.data.roomId = null;
      publishRoom(room);
      if (room.status === 'SUBMIT_TRAPS') tryStartDefense(room);
      if (['DEFENSE', 'DEFENSE_ENDING'].includes(room.status) && departingPlayer?.id === room.defenseOrder[room.turnIndex]) {
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
      pauseForManagerDeparture(room);
    } else {
      const player = getPlayerBySocket(room, socket.id);
      if (player) player.isConnected = false;
    }
    publishRoom(room);

    if (room.status === 'SUBMIT_TRAPS') tryStartDefense(room);
    if (['DEFENSE', 'DEFENSE_ENDING'].includes(room.status) && room.defenseOrder[room.turnIndex] === getPlayerBySocket(room, socket.id)?.id) {
      advanceDefense(room);
    }
    if (!room.bossConnected && connectedPlayers(room).length === 0) scheduleCleanup(room);
  });
}

module.exports = registerRoomHandlers;
