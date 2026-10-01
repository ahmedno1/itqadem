const registerRoomHandlers = require('./handlers/roomHandler');
const registerGameHandlers = require('./handlers/gameHandler');
const registerChatHandlers = require('./handlers/chatHandler');
const registerVoiceHandlers = require('./handlers/voiceHandler');

function registerSocketHandlers(io, dependencies) {
  io.on('connection', (socket) => {
    socket.emit('welcome', { text: 'مرحباً بك في لعبة أتقدم للوظيفة' });
    registerRoomHandlers(socket, dependencies);
    registerGameHandlers(socket, dependencies);
    registerChatHandlers(socket, dependencies);
    registerVoiceHandlers(socket, dependencies);
  });
}

module.exports = registerSocketHandlers;
