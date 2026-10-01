class Room {
  constructor({ roomId, bossId, bossName, bossResumeToken }) {
    Object.assign(this, {
      roomId,
      bossId,
      bossName,
      bossResumeToken,
      bossConnected: true,
      status: 'LOBBY',
      players: [],
      originalPlayerCount: 0,
      currentQuestion: '',
      turnIndex: 0,
      round: 1,
      defenseOrder: [],
      turnEndsAt: null,
      defenseEndsAt: null,
      trapRevealed: false,
      trapAnswers: new Map(),
      assignedTraps: new Map(),
      trapAuthorIds: [],
      trapTargetIds: [],
      finalRound: false,
      finalStage: null,
      finalistId: null,
      finalQuestion: '',
      finalDefense: '',
      finalDecision: null,
      eliminatedPlayerId: null,
      eliminationPending: null,
      chatMessages: [],
      voiceSpeakers: new Map(),
      managerVote: null,
      managerResumeDeadline: null,
      managerVoteAvailableAt: null,
      pausedStatus: null,
      managerTimer: null,
      managerExpired: false,
      bannedNames: new Set(),
      timer: null,
      cleanupTimer: null
    });
  }

  getPlayerBySocket(socketId) {
    return this.players.find((player) => player.socketId === socketId) || null;
  }

  getRole(socketId) {
    if (this.bossId === socketId) return 'boss';
    if (this.getPlayerBySocket(socketId)) return 'player';
    return null;
  }

  getSanitizedState(socketId) {
    const role = this.getRole(socketId);
    const me = this.getPlayerBySocket(socketId);
    const speaker = this.defenseOrder[this.turnIndex];
    const speakerPlayer = this.players.find((player) => player.id === speaker) || null;
    const finalist = this.players.find((player) => player.id === this.finalistId) || null;
    const sessionToken = role === 'boss'
      ? this.bossResumeToken
      : me?.resumeToken || null;
    const managerVoteCounts = new Map();
    for (const candidateId of this.managerVote?.votes.values() || []) {
      managerVoteCounts.set(candidateId, (managerVoteCounts.get(candidateId) || 0) + 1);
    }
    const managerVote = this.managerVote
      ? {
        active: true,
        counts: Object.fromEntries(managerVoteCounts),
        candidates: this.players
          .filter((player) => player.isConnected && !player.isEliminated)
          .map((player) => ({ id: player.id, name: player.name }))
      }
      : null;

    return {
      roomId: this.roomId,
      bossId: this.bossId,
      bossName: this.bossName,
      bossConnected: this.bossConnected,
      status: this.status,
      serverNow: Date.now(),
      players: this.players.map((player) => ({
        id: player.id,
        name: player.name,
        isEliminated: player.isEliminated,
        isConnected: player.isConnected,
        hasSubmittedTrap: this.trapAnswers.has(player.id),
        canSubmitTrap: this.trapAuthorIds.includes(player.id)
      })),
      currentQuestion: this.currentQuestion,
      round: this.round,
      turnIndex: this.turnIndex,
      currentSpeaker: speakerPlayer ? { id: speakerPlayer.id, name: speakerPlayer.name, socketId: speakerPlayer.socketId } : null,
      turnEndsAt: this.turnEndsAt,
      defenseEndsAt: this.defenseEndsAt,
      trapRevealed: this.trapRevealed,
      revealedTrap: this.trapRevealed ? this.assignedTraps.get(speaker) || '' : '',
      finalStage: this.finalStage,
      finalist: finalist ? { id: finalist.id, name: finalist.name, isEliminated: finalist.isEliminated } : null,
      finalQuestion: this.finalQuestion,
      finalDefense: this.finalDefense,
      finalDecision: this.finalDecision,
      sessionToken,
      managerVote,
      managerAway: !this.bossConnected,
      managerResumeDeadline: this.managerResumeDeadline,
      managerVoteAvailableAt: this.managerVoteAvailableAt,
      pausedStatus: this.pausedStatus,
      managerExpired: this.managerExpired,
      finalRound: this.finalRound,
      eliminationPending: Boolean(this.eliminationPending),
      eliminationEndsAt: this.eliminationPending?.endsAt || null,
      eliminationCandidates: this.eliminationPending?.candidates || [],
      trapAuthorIds: this.trapAuthorIds,
      trapTargetIds: this.trapTargetIds,
      eliminatedPlayerId: this.eliminatedPlayerId,
      voicePeers: [
        ...(this.bossConnected ? [{ socketId: this.bossId, name: this.bossName, role: 'boss' }] : []),
        ...this.players
          .filter((player) => player.isConnected && player.socketId)
          .map((player) => ({ socketId: player.socketId, name: player.name, role: 'player' }))
      ],
      voiceSpeakers: Array.from(this.voiceSpeakers.values()),
      chatMessages: this.chatMessages.slice(-50),
      role,
      meId: me?.id || (role === 'boss' ? this.bossId : null),
      isMyTurn: Boolean(me && speaker === me.id),
      myTrap: this.status === 'DEFENSE' && me && speaker === me.id ? this.assignedTraps.get(me.id) || '' : ''
    };
  }
}

module.exports = Room;
