(function () {
  const EVENTS = Object.freeze({
    createRoom: 'createRoom',
    joinRoom: 'joinRoom',
    reconnectRoom: 'reconnectRoom',
    roomState: 'roomState',
    roomError: 'roomError',
    sendChatMessage: 'sendChatMessage',
    chatMessage: 'chatMessage',
    sendReaction: 'sendReaction',
    reaction: 'reaction',
    voiceSignal: 'voiceSignal',
    voiceSpeaking: 'voiceSpeaking',
    trapRevealed: 'trapRevealed',
    defenseEnding: 'defenseEnding',
    eliminationResult: 'eliminationResult'
  });

  function createSocket() {
    return io();
  }

  function emitWithAck(socket, eventName, payload = {}, timeout = 10000) {
    return new Promise((resolve) => {
      socket.timeout(timeout).emit(eventName, payload, (timeoutError, response) => {
        resolve({ timeoutError, response });
      });
    });
  }

  window.AtqadamCommunication = {
    EVENTS,
    createSocket,
    emitWithAck
  };
})();