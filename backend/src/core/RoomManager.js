const crypto = require('crypto');
const Room = require('./Room');
const { ROOM_CODE_CHARACTERS, ROOM_CLEANUP_DELAY } = require('../config/constants');

class RoomManager {
  constructor(timerManager) {
    this.rooms = new Map();
    this.timerManager = timerManager;
  }

  createToken() {
    return crypto.randomBytes(24).toString('base64url');
  }

  makeRoomCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => ROOM_CODE_CHARACTERS[crypto.randomInt(ROOM_CODE_CHARACTERS.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(bossId, bossName) {
    const room = new Room({
      roomId: this.makeRoomCode(),
      bossId,
      bossName,
      bossResumeToken: this.createToken()
    });
    this.rooms.set(room.roomId, room);
    return room;
  }

  getRoomForSocket(socket) {
    return socket.data.roomId ? this.rooms.get(socket.data.roomId) || null : null;
  }

  scheduleCleanup(room) {
    this.timerManager.setCleanupTimer(room, () => this.removeRoom(room), ROOM_CLEANUP_DELAY);
  }

  removeRoom(room) {
    this.timerManager.clearRoomTimer(room);
    this.timerManager.clearManagerTimer(room);
    this.timerManager.clearCleanupTimer(room);
    this.rooms.delete(room.roomId);
  }
}

module.exports = RoomManager;
