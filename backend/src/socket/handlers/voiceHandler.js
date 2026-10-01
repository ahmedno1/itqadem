function registerVoiceHandlers(socket, { io, getRoomForSocket, getRole, getPlayerBySocket, sendError, stopVoiceSpeaking }) {
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
}

module.exports = registerVoiceHandlers;
