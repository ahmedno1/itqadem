const crypto = require('crypto');

const ALLOWED_REACTIONS = ['👏', '😂', '🔥', '💯', '❤️', '😮'];

function registerChatHandlers(socket, { io, getRoomForSocket, getRole, getPlayerBySocket, sendError }) {
  socket.on('sendChatMessage', (payload = {}, callback) => {
    const room = getRoomForSocket(socket);
    const role = room && getRole(room, socket);
    const player = room && getPlayerBySocket(room, socket.id);
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!room || !role) return sendError(socket, callback, 'انضم إلى الغرفة لإرسال رسالة.');
    if (text.length < 1 || text.length > 300) return sendError(socket, callback, 'اكتب رسالة من 1 إلى 300 حرف.');
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
    if (!room || !role) return sendError(socket, callback, 'انضم إلى الغرفة لإرسال تفاعل.');
    if (room.status !== 'DEFENSE') return sendError(socket, callback, 'التفاعلات متاحة أثناء مرحلة التبرير فقط.');
    if (!ALLOWED_REACTIONS.includes(payload.emoji)) return sendError(socket, callback, 'هذا التفاعل غير متاح.');

    io.to(room.roomId).emit('reaction', {
      emoji: payload.emoji,
      name: role === 'boss' ? room.bossName : player.name,
      sentAt: Date.now()
    });
    if (typeof callback === 'function') callback({ ok: true });
  });
}

module.exports = registerChatHandlers;
