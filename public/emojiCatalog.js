(function () {
  const STORAGE_KEY = 'atqadam-emoji-usage-v1';

  function readUsage() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        counts: saved.counts && typeof saved.counts === 'object' ? saved.counts : {},
        recent: Array.isArray(saved.recent) ? saved.recent : []
      };
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
      return { counts: {}, recent: [] };
    }
  }

  function saveUsage(usage) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
    } catch (error) {
      console.warn('Unable to save emoji usage:', error);
    }
  }

  function recordUsage(usage, emoji) {
    usage.counts[emoji] = (usage.counts[emoji] || 0) + 1;
    usage.recent = [emoji, ...usage.recent.filter((entry) => entry !== emoji)].slice(0, 40);
    saveUsage(usage);
  }

  window.AtqadamEmojiCatalog = {
    STORAGE_KEY,
    readUsage,
    saveUsage,
    recordUsage
  };
})();