(function () {
  const STORAGE_KEY = 'atqadam-game-state-v1';

  function defaultGameState() {
    return {
      bossName: '',
      players: [],
      currentRound: 1,
      currentQuestion: '',
      turnIndex: 0,
      phase: 'menu',
      currentPlayerIndex: 0,
      defenseQueue: [],
      finalDefenseText: '',
      countdown: 60,
      finalWinner: '',
      finalistId: '',
      lastDecision: '',
      timerId: null
    };
  }

  function getStoredState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      const state = {
        ...defaultGameState(),
        ...parsed,
        players: Array.isArray(parsed.players) ? parsed.players : [],
        defenseQueue: Array.isArray(parsed.defenseQueue) ? parsed.defenseQueue : [],
        timerId: null
      };
      if (!Number.isFinite(state.countdown) || state.countdown < 0 || state.countdown > 60) state.countdown = 60;
      state.players = state.players.map((player, index) => ({
        Name: typeof player?.Name === 'string' ? player.Name : '',
        id: typeof player?.id === 'string' ? player.id : `restored-player-${index}-${Date.now()}`,
        status: player?.status === 'eliminated' ? 'eliminated' : 'active',
        submittedTrap: typeof player?.submittedTrap === 'string' ? player.submittedTrap : '',
        assignedTrap: typeof player?.assignedTrap === 'string' ? player.assignedTrap : '',
        cardRevealed: Boolean(player?.cardRevealed)
      }));
      return state;
    } catch (error) {
      console.warn('Unable to restore saved game state:', error);
      try { localStorage.removeItem(STORAGE_KEY); } catch (removeError) { console.warn('Unable to clear invalid saved state:', removeError); }
      return null;
    }
  }

  function saveState(state) {
    const payload = {
      ...state,
      timerId: null
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (error) {
      console.warn('Unable to save game state:', error);
      return false;
    }
  }

  function clearState() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (error) {
      console.warn('Unable to clear saved game state:', error);
      return false;
    }
  }

  window.AtqadamGameState = {
    STORAGE_KEY,
    defaultGameState,
    getStoredState,
    saveState,
    clearState
  };
})();
