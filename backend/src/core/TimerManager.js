class TimerManager {
  clearRoomTimer(room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
  }

  setRoomTimer(room, callback, delay) {
    this.clearRoomTimer(room);
    room.timer = setTimeout(() => {
      room.timer = null;
      callback();
    }, delay);
    return room.timer;
  }

  clearManagerTimer(room) {
    if (room.managerTimer) clearTimeout(room.managerTimer);
    room.managerTimer = null;
  }

  setManagerTimer(room, callback, delay) {
    this.clearManagerTimer(room);
    room.managerTimer = setTimeout(() => {
      room.managerTimer = null;
      callback();
    }, delay);
    return room.managerTimer;
  }

  clearCleanupTimer(room) {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }

  setCleanupTimer(room, callback, delay) {
    this.clearCleanupTimer(room);
    room.cleanupTimer = setTimeout(() => {
      room.cleanupTimer = null;
      callback();
    }, delay);
    return room.cleanupTimer;
  }
}

module.exports = TimerManager;
