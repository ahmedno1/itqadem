const AtqadamGameRules = {
  getSurvivorThreshold(originalPlayerCount) {
    return Math.floor(Number(originalPlayerCount) / 2);
  },

  shouldUseEliminatedAuthors({ round, finalRound, activeCount, originalPlayerCount }) {
    return Boolean(finalRound)
      || (Number(round) > 1 && Number(activeCount) <= this.getSurvivorThreshold(originalPlayerCount));
  },

  getTrapAuthorIds({ players, round, finalRound, originalPlayerCount }) {
    const activePlayers = players.filter((player) => player.status !== 'eliminated');
    const eliminatedPlayers = players.filter((player) => player.status === 'eliminated');
    return this.shouldUseEliminatedAuthors({
      round,
      finalRound,
      activeCount: activePlayers.length,
      originalPlayerCount
    })
      ? eliminatedPlayers.map((player) => player.id)
      : players.map((player) => player.id);
  },

  shouldStartFinalDecision({ finalRound, activeCount }) {
    return Boolean(finalRound) && Number(activeCount) === 1;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AtqadamGameRules;
}

if (typeof window !== 'undefined') {
  window.AtqadamGameRules = AtqadamGameRules;
}