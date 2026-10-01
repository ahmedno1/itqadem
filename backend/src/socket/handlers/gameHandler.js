const {
  DEFENSE_ENDING_DURATION,
  ELIMINATION_PAUSE,
  ELIMINATION_SPIN_DURATION,
  ELIMINATION_REVEAL_DURATION
} = require('../../config/constants');

function registerGameHandlers(socket, dependencies) {
  const {
    io, getRoomForSocket, getPlayerBySocket, sendError, validateText, activePlayers,
    publishRoom, replyWithRoom, configureTrapDirection, tryStartDefense,
    revealCurrentDefenseTrap, clearRoomTimer, timerManager, advanceDefense,
    resetForNextRound
  } = dependencies;

  socket.on('startGame', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'هذا الإجراء متاح للمدير فقط.');
    if (room.status !== 'LOBBY') return sendError(socket, callback, 'بدأت اللعبة بالفعل.');
    if (activePlayers(room).length < 2) return sendError(socket, callback, 'تحتاج الغرفة إلى متقدمين متصلين على الأقل لبدء اللعبة.');
    room.status = 'BOSS_QUESTION';
    room.round = 1;
    room.originalPlayerCount = activePlayers(room).length;
    room.finalRound = false;
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
    configureTrapDirection(room);
    room.status = 'SUBMIT_TRAPS';
    publishRoom(room);
    replyWithRoom(socket, callback, room);
  });

  socket.on('submitTrapAnswer', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const player = room && getPlayerBySocket(room, socket.id);
    if (!room || !player) return sendError(socket, callback, 'انضم إلى الغرفة كمتقدم أولاً.');
    if (room.status !== 'SUBMIT_TRAPS') return sendError(socket, callback, 'الغرفة لا تستقبل إجابات في هذه المرحلة.');
    if (!room.trapAuthorIds.includes(player.id)) return sendError(socket, callback, 'في هذه الجولة يكتب المستبعدون إجابات التوريط.');
    const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
    if (!validateText(answer, 500)) return sendError(socket, callback, 'اكتب إجابة لا تتجاوز 500 حرف.');
    if (room.trapAnswers.has(player.id)) return sendError(socket, callback, 'تم إرسال إجابتك بالفعل في هذه الجولة.');

    room.trapAnswers.set(player.id, answer);
    if (typeof callback === 'function') callback({ ok: true });
    publishRoom(room);
    tryStartDefense(room);
  });

  socket.on('revealTrap', (payload, callback) => {
    const room = getRoomForSocket(socket);
    const player = room && getPlayerBySocket(room, socket.id);
    const currentId = room?.defenseOrder[room.turnIndex];
    if (!room || room.status !== 'DEFENSE' || !player || player.id !== currentId) {
      return sendError(socket, callback, 'لا يمكنك كشف البطاقة في هذا الدور.');
    }
    if (room.trapRevealed) return sendError(socket, callback, 'تم كشف البطاقة بالفعل.');
    revealCurrentDefenseTrap(room, false);
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('finishDefenseTurn', (payload, callback) => {
    const room = getRoomForSocket(socket);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'إنهاء التبرير متاح للمدير فقط.');
    if (room.status !== 'DEFENSE') return sendError(socket, callback, 'لا يوجد تبرير نشط لإنهائه.');
    if (!room.trapRevealed) revealCurrentDefenseTrap(room, true);
    clearRoomTimer(room);
    room.status = 'DEFENSE_ENDING';
    room.defenseEndsAt = Date.now() + DEFENSE_ENDING_DURATION;
    publishRoom(room);
    io.to(room.roomId).emit('defenseEnding', { endsAt: room.defenseEndsAt, duration: DEFENSE_ENDING_DURATION });
    if (typeof callback === 'function') callback({ ok: true });
    timerManager.setRoomTimer(room, () => advanceDefense(room), DEFENSE_ENDING_DURATION);
  });

  socket.on('eliminatePlayer', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    if (!room || room.bossId !== socket.id) return sendError(socket, callback, 'هذا الإجراء متاح للمدير فقط.');
    if (room.status !== 'ELIMINATION') return sendError(socket, callback, 'الغرفة ليست في مرحلة الاستبعاد.');
    if (room.eliminatedPlayerId || room.eliminationPending) return sendError(socket, callback, 'تم اختيار اللاعب المستبعد بالفعل.');
    const target = room.players.find((player) => player.id === payload.playerId && !player.isEliminated);
    if (!target) return sendError(socket, callback, 'المتقدم المحدد غير متاح للاستبعاد.');

    const candidates = activePlayers(room).map((player) => ({ id: player.id, name: player.name }));
    const endsAt = Date.now() + ELIMINATION_SPIN_DURATION;
    room.eliminationPending = { playerId: target.id, playerName: target.name, candidates, endsAt };
    io.to(room.roomId).emit('eliminationSpin', { duration: ELIMINATION_SPIN_DURATION, endsAt, candidates });
    publishRoom(room);
    if (typeof callback === 'function') callback({ ok: true });

    clearRoomTimer(room);
    timerManager.setRoomTimer(room, () => {
      const pending = room.eliminationPending;
      if (!pending) return;
      const eliminated = room.players.find((player) => player.id === pending.playerId);
      if (!eliminated) return;
      eliminated.isEliminated = true;
      room.eliminatedPlayerId = eliminated.id;
      room.eliminationPending = null;
      const survivors = room.players.filter((player) => !player.isEliminated);
      io.to(room.roomId).emit('eliminationResult', {
        eliminatedPlayerId: eliminated.id,
        eliminatedPlayerName: eliminated.name,
        survivors: survivors.map((player) => ({ id: player.id, name: player.name }))
      });
      publishRoom(room);
      timerManager.setRoomTimer(room, () => {
        if (survivors.length <= 1) {
          room.finalRound = survivors.length === 1;
          room.round += 1;
          room.status = survivors.length === 1 ? 'BOSS_QUESTION' : 'FINAL_CHALLENGE';
          room.finalStage = survivors.length === 1 ? null : 'COMPLETE';
          room.finalistId = survivors[0]?.id || null;
          room.currentQuestion = '';
          room.finalQuestion = '';
          room.finalDefense = '';
          room.finalDecision = survivors.length === 1 ? null : 'reject';
          room.trapAnswers.clear();
          room.assignedTraps.clear();
          room.turnEndsAt = null;
          room.defenseEndsAt = null;
          publishRoom(room);
        } else {
          resetForNextRound(room);
        }
      }, ELIMINATION_REVEAL_DURATION);
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
}

module.exports = registerGameHandlers;
