const socket = window.AtqadamCommunication.createSocket();
const app = document.getElementById('app');
const topBarActions = document.getElementById('top-bar-actions');
const ONLINE_SESSION_KEY = 'atqadam-online-session-v1';
const EMOJI_USAGE_KEY = window.AtqadamEmojiCatalog.STORAGE_KEY;

let onlineSession = null;
let onlineState = null;
let onlineMessage = '';
let onlineEliminationResult = null;
let onlineCountdownTimer = null;
let onlineConnectionStatus = 'connected';
let onlineAudioContext = null;
let onlineServerOffset = 0;
let onlineChatOpen = false;
let onlineChatMessages = [];
let onlineVoiceSpeakers = new Map();
let onlinePreviousSpeakerId = null;
let emojiCatalog = [];
let stickerCatalog = [];
let emojiUsage = {};
let recentEmojis = [];
let emojiSortMode = 'groups';
let emojiSelectedGroup = 'all';
let emojiShowAll = false;
let emojiPickerOpen = false;
let stickerPickerOpen = false;
let voiceConnections = new Map();
let localVoiceStream = null;
let voiceStreamRequest = null;
let voicePressed = false;
let onlineSpeakingSent = false;

try {
  const emojiUsageState = window.AtqadamEmojiCatalog.readUsage();
  emojiUsage = emojiUsageState.counts;
  recentEmojis = emojiUsageState.recent;
} catch (error) {
  localStorage.removeItem(EMOJI_USAGE_KEY);
}

try {
  onlineSession = JSON.parse(localStorage.getItem(ONLINE_SESSION_KEY) || 'null');
} catch (error) {
  localStorage.removeItem(ONLINE_SESSION_KEY);
}

let localGameState = window.AtqadamGameState
  ? window.AtqadamGameState.getStoredState() || window.AtqadamGameState.defaultGameState()
  : {
      bossName: '',
      players: [],
      currentRound: 1,
      currentQuestion: '',
      turnIndex: 0,
      phase: 'menu',
      currentPlayerIndex: 0,
      defenseQueue: [],
      finalDefenseText: '',
      timerId: null,
      countdown: 60,
      finalWinner: '',
      lastDecision: ''
    };

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function saveGameState() {
  if (window.AtqadamGameState) {
    window.AtqadamGameState.saveState(localGameState);
  }
}

function clearSavedState() {
  if (window.AtqadamGameState) {
    window.AtqadamGameState.clearState();
  }
}

function clearTimer() {
  if (localGameState.timerId) {
    clearInterval(localGameState.timerId);
    localGameState.timerId = null;
  }
}

function createPlayer(name = '') {
  return {
    id: window.crypto?.randomUUID?.() || `player-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    Name: name,
    status: 'active',
    submittedTrap: '',
    assignedTrap: '',
    cardRevealed: false
  };
}

function resetPlayers() {
  localGameState.players = [createPlayer(), createPlayer()];
  localGameState.originalPlayerCount = 2;
  localGameState.trapWriterQueue = [];
  localGameState.finalRound = false;
  saveGameState();
}

function ensurePlayerList() {
  if (!Array.isArray(localGameState.players)) {
    localGameState.players = [];
  }

  while (localGameState.players.length < 2) {
    localGameState.players.push(createPlayer());
  }

  localGameState.players = localGameState.players.map((player) => ({
    ...createPlayer(),
    ...player,
    id: player.id || `player-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }));

  if (localGameState.players.length > 8) {
    localGameState.players = localGameState.players.slice(0, 8);
  }
}

function syncPlayersFromInputs() {
  const bossNameInput = document.getElementById('boss-name');
  if (bossNameInput) {
    localGameState.bossName = bossNameInput.value;
  }

  const playerInputs = Array.from(document.querySelectorAll('input[data-player-index]'))
    .sort((first, second) => Number(first.dataset.playerIndex) - Number(second.dataset.playerIndex));
  if (playerInputs.length === 0) {
    saveGameState();
    return;
  }

  localGameState.players = playerInputs.map((input) => {
    const index = Number(input.dataset.playerIndex);
    const player = localGameState.players[index] || createPlayer();
    player.Name = input.value.trim();
    return player;
  });

  saveGameState();
}

function getActivePlayers() {
  return localGameState.players.filter((player) => player.status === 'active');
}

function getCurrentDefensePlayer() {
  const playerId = localGameState.defenseQueue[localGameState.turnIndex];
  if (!playerId) {
    return null;
  }
  return localGameState.players.find((player) => player.id === playerId) || null;
}

function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildQuickActions() {
  return '';
}

function renderTopBarActions() {
  if (!topBarActions) {
    return;
  }

  topBarActions.innerHTML = `
    <button class="top-bar-btn secondary" type="button" data-top-action="restart-game">إعادة اللعبة</button>
    <button class="top-bar-btn" type="button" data-top-action="exit-to-menu">الخروج</button>
  `;

  const showActions = document.body.classList.contains('game-started');
  topBarActions.hidden = !showActions;
}

function syncTopBarVisibility() {
  if (!topBarActions) {
    return;
  }

  topBarActions.hidden = !document.body.classList.contains('game-started');
}

function showConfirmDialog({ title, message, confirmText = 'تأكيد', cancelText = 'إلغاء', onConfirm }) {
  const existingModal = document.getElementById('confirm-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement('div');
  modal.id = 'confirm-modal';
  modal.className = 'confirm-modal';
  modal.innerHTML = `
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div class="confirm-icon">!</div>
      <h3 id="confirm-title">${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      <div class="confirm-actions">
        <button class="confirm-btn danger" type="button" data-confirm="accept">${escapeHtml(confirmText)}</button>
        <button class="confirm-btn" type="button" data-confirm="cancel">${escapeHtml(cancelText)}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const acceptButton = modal.querySelector('[data-confirm="accept"]');
  const cancelButton = modal.querySelector('[data-confirm="cancel"]');

  const close = () => modal.remove();

  acceptButton.addEventListener('click', () => {
    close();
    if (typeof onConfirm === 'function') {
      onConfirm();
    }
  });

  cancelButton.addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      close();
    }
  });
}

function requestRestartConfirmation() {
  showConfirmDialog({
    title: 'إعادة اللعبة',
    message: 'هل أنت متأكد أنك تريد إعادة اللعبة؟ سيتم مسح جميع البيانات الحالية.',
    confirmText: 'نعم، أعد اللعبة',
    onConfirm: () => restartGame()
  });
}

function requestExitConfirmation() {
  showConfirmDialog({
    title: 'الخروج إلى القائمة',
    message: 'هل أنت متأكد أنك تريد العودة إلى القائمة؟ سيتم حفظ تقدمك الحالي ويمكنك متابعة اللعب لاحقاً.',
    confirmText: 'نعم، ارجع للقائمة',
    onConfirm: () => exitToMenu()
  });
}

function setOnlineMessage(message) {
  onlineMessage = message || '';
  const messageElement = document.getElementById('online-message');
  if (messageElement) {
    messageElement.textContent = onlineMessage;
    messageElement.hidden = !onlineMessage;
  }
}

function saveOnlineSession(session) {
  onlineSession = session;
  try {
    localStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    onlineMessage = 'تعذر حفظ بيانات الاستعادة على هذا الجهاز.';
  }
}

function clearOnlineCountdown() {
  if (onlineCountdownTimer) {
    clearInterval(onlineCountdownTimer);
    onlineCountdownTimer = null;
  }
}

function playOnlineOutcome(decision) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    onlineAudioContext ||= new AudioContextClass();
    onlineAudioContext.resume();
    const notes = decision === 'accept' ? [523.25, 659.25, 783.99] : [392, 293.66, 220];
    notes.forEach((frequency, index) => {
      const oscillator = onlineAudioContext.createOscillator();
      const gain = onlineAudioContext.createGain();
      const startAt = onlineAudioContext.currentTime + index * 0.13;
      oscillator.frequency.value = frequency;
      oscillator.type = 'triangle';
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);
      oscillator.connect(gain);
      gain.connect(onlineAudioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.23);
    });
  } catch (error) {
    console.warn('Unable to play the online result sound:', error);
  }
}

function primeOnlineAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    onlineAudioContext ||= new AudioContextClass();
    onlineAudioContext.resume();
  } catch (error) {
    console.warn('Unable to enable online audio:', error);
  }
}

function playDefenseCountdownTick() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    onlineAudioContext ||= new AudioContextClass();
    onlineAudioContext.resume();
    const oscillator = onlineAudioContext.createOscillator();
    const gain = onlineAudioContext.createGain();
    const now = onlineAudioContext.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(gain);
    gain.connect(onlineAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.17);
  } catch (error) {
    console.warn('Unable to play the defense countdown:', error);
  }
}

function emitOnlineEvent(eventName, payload = {}) {
  return new Promise((resolve) => {
    AtqadamCommunication.emitWithAck(socket, eventName, payload).then(({ timeoutError, response }) => {
      if (timeoutError) {
        setOnlineMessage('تعذر الاتصال بالخادم. تحقق من الاتصال ثم حاول مجدداً.');
        resolve(false);
        return;
      }

      if (!response?.ok) {
        setOnlineMessage(response?.error || 'تعذر تنفيذ الطلب.');
        resolve(false);
        return;
      }

      setOnlineMessage('');
      if (response.state) {
        onlineState = response.state;
        renderOnlineRoom();
      }
      resolve(true);
    });
  });
}

function enterOnlineRoom(response) {
  if (!response?.ok || !response.state || !response.resumeToken) {
    setOnlineMessage(response?.error || 'تعذر فتح الغرفة.');
    return;
  }

  saveOnlineSession({
    roomId: response.state.roomId,
    resumeToken: response.resumeToken,
    role: response.role,
    name: response.name
  });
  onlineState = response.state;
  onlinePreviousSpeakerId = null;
  onlineMessage = '';
  onlineEliminationResult = null;
  document.body.classList.add('game-started');
  renderOnlineRoom();
}

function emitEntryEvent(eventName, payload) {
  setOnlineMessage('جارٍ الاتصال بالغرفة...');
  socket.timeout(10000).emit(eventName, payload, (timeoutError, response) => {
    if (timeoutError) {
      setOnlineMessage('انتهت مهلة الاتصال بالخادم. تحقق من الاتصال وحاول مجدداً.');
      return;
    }
    if (response?.ok) enterOnlineRoom(response);
    else setOnlineMessage(response?.error || 'تعذر فتح الغرفة.');
  });
}

function showOnlineEntryScreen() {
  clearOnlineCountdown();
  document.body.classList.remove('game-started');
  syncTopBarVisibility();
  app.innerHTML = `
    <section class="screen-card online-entry-screen">
      <div class="player-meta"><span class="status-pill">اللعب الجماعي عبر الإنترنت</span></div>
      <h2>أنشئ غرفة أو انضم إلى أصدقائك</h2>
      <div id="online-message" class="online-message" ${onlineMessage ? '' : 'hidden'}>${escapeHtml(onlineMessage)}</div>
      <div class="online-entry-grid">
        <form class="online-form" data-online-form="create">
          <h3>إنشاء غرفة</h3>
          <label for="online-boss-name">اسم المدير</label>
          <input id="online-boss-name" type="text" maxlength="40" autocomplete="name" placeholder="اكتب اسمك" required />
          <button class="game-btn" type="submit">إنشاء غرفة</button>
        </form>
        <form class="online-form" data-online-form="join">
          <h3>الانضمام إلى غرفة</h3>
          <label for="online-room-code">رمز الغرفة</label>
          <input id="online-room-code" type="text" maxlength="4" inputmode="text" autocomplete="off" placeholder="مثال: X7K2" required />
          <label for="online-player-name">اسم المتقدم</label>
          <input id="online-player-name" type="text" maxlength="40" autocomplete="name" placeholder="اكتب اسمك" required />
          <button class="secondary-btn" type="submit">انضمام</button>
        </form>
      </div>
      <div class="footer-actions"><button class="secondary-btn" type="button" data-action="online-back-menu">العودة</button></div>
    </section>
  `;
}

function onlinePlayerList(players, allowElimination = false) {
  return `<div class="online-players-list">${players.map((player) => {
    const playerClasses = [
      player.isEliminated ? 'is-eliminated' : '',
      player.isConnected ? '' : 'is-disconnected'
    ].filter(Boolean).join(' ');
    const connectionLabel = player.isConnected ? 'متصل' : 'انقطع الاتصال';
    const roleLabel = player.isEliminated ? 'مخرب' : 'متقدم';
    return `<div class="online-player-row ${playerClasses}">
      <div><strong>${escapeHtml(player.name)}</strong><small>${roleLabel}</small></div>
      <span class="online-connection-state ${player.isConnected ? 'connected' : 'disconnected'}">${connectionLabel}</span>
      ${allowElimination && !player.isEliminated
        ? `<button class="mini-btn" type="button" data-action="online-eliminate" data-player-id="${escapeHtml(player.id)}">استبعاد</button>`
        : `<span class="online-player-status">${player.hasSubmittedTrap ? 'أرسل الإجابة' : (player.isEliminated ? 'مخرب' : 'في الانتظار')}</span>`}
    </div>`;
  }).join('')}</div>`;
}

function onlineHeader(state) {
  const connection = onlineConnectionStatus === 'connected' ? 'متصل بالخادم' : 'جارٍ استعادة الاتصال';
  return `<div class="player-meta">
    <span class="status-pill">غرفة ${escapeHtml(state.roomId)}</span>
    <span class="online-connection ${onlineConnectionStatus}">${connection}</span>
    ${state.role !== 'boss' ? `<span class="online-manager-presence ${state.bossConnected ? 'connected' : 'disconnected'}">المدير: ${state.bossConnected ? 'متصل' : 'انقطع الاتصال'}</span>` : ''}
  </div>`;
}

function chatMessageMarkup(message) {
  const sticker = stickerCatalog.find((entry) => entry.emoji === message.text.trim());
  if (sticker) {
    return `<li class="online-chat-message is-sticker"><strong>${escapeHtml(message.name)}</strong><img class="chat-sticker" src="${escapeHtml(sticker.src)}" alt="${escapeHtml(sticker.alt || sticker.name)}" title="${escapeHtml(sticker.name)}" /></li>`;
  }

  let text = escapeHtml(message.text);
  stickerCatalog.filter((entry) => entry.emoji && entry.src).forEach((entry) => {
    const image = `<img class="chat-inline-emoji" src="${escapeHtml(entry.src)}" alt="${escapeHtml(entry.alt || entry.name)}" title="${escapeHtml(entry.name)}" />`;
    text = text.split(escapeHtml(entry.emoji)).join(image);
  });
  return `<li class="online-chat-message"><strong>${escapeHtml(message.name)}</strong><span>${text}</span></li>`;
}

function sortedEmojiCatalog() {
  const recentOrder = new Map(recentEmojis.map((emoji, index) => [emoji, index]));
  return emojiCatalog.filter((entry) => emojiSelectedGroup === 'all' || entry.category === emojiSelectedGroup).sort((first, second) => {
    if (emojiSortMode === 'groups') return first.index - second.index;
    if (emojiSortMode === 'recent') {
      const firstRecent = recentOrder.get(first.emoji) ?? Number.MAX_SAFE_INTEGER;
      const secondRecent = recentOrder.get(second.emoji) ?? Number.MAX_SAFE_INTEGER;
      return firstRecent - secondRecent || first.index - second.index;
    }
    return (emojiUsage[second.emoji] || 0) - (emojiUsage[first.emoji] || 0) || first.index - second.index;
  });
}

function saveEmojiUsage() {
  window.AtqadamEmojiCatalog.saveUsage({ counts: emojiUsage, recent: recentEmojis });
}

function recordEmojiUsage(emoji) {
  const usage = { counts: emojiUsage, recent: recentEmojis };
  window.AtqadamEmojiCatalog.recordUsage(usage, emoji);
  emojiUsage = usage.counts;
  recentEmojis = usage.recent;
  if (emojiPickerOpen) renderEmojiPicker();
}

function renderEmojiPicker() {
  const picker = document.querySelector('[data-emoji-picker]');
  if (!picker) return;
  picker.hidden = !emojiPickerOpen;
  if (!emojiPickerOpen) return;

  const sorted = sortedEmojiCatalog();
  const visible = emojiShowAll ? sorted : sorted.slice(0, 28);
  const groups = [...new Set(emojiCatalog.map((entry) => entry.category))];
  picker.innerHTML = `<label class="emoji-group-filter"><span>المجموعة</span><select data-action="emoji-category" aria-label="اختيار مجموعة الإيموجي">
      <option value="all" ${emojiSelectedGroup === 'all' ? 'selected' : ''}>كل المجموعات</option>
      ${groups.map((group) => `<option value="${escapeHtml(group)}" ${emojiSelectedGroup === group ? 'selected' : ''}>${escapeHtml(group)}</option>`).join('')}
    </select></label>
    <div class="emoji-sort-controls" role="group" aria-label="ترتيب الإيموجي">
      <button type="button" data-action="emoji-sort" data-sort="groups" aria-pressed="${emojiSortMode === 'groups'}">حسب المجموعة</button>
      <button type="button" data-action="emoji-sort" data-sort="popular" aria-pressed="${emojiSortMode === 'popular'}">الأكثر استخداماً</button>
      <button type="button" data-action="emoji-sort" data-sort="recent" aria-pressed="${emojiSortMode === 'recent'}">الأخيرة</button>
    </div>
    <div class="emoji-picker-grid">${visible.map((entry) => `<button type="button" data-action="chat-emoji-select" data-emoji="${escapeHtml(entry.emoji)}" aria-label="إدراج ${escapeHtml(entry.emoji)}" title="${escapeHtml(entry.emoji)}">${escapeHtml(entry.emoji)}</button>`).join('')}</div>
    ${sorted.length > visible.length ? `<button type="button" class="emoji-show-more" data-action="emoji-show-all">عرض باقي الإيموجي (${sorted.length - visible.length})</button>` : ''}`;
}

function renderStickerPicker() {
  const picker = document.querySelector('[data-sticker-picker]');
  if (!picker) return;
  picker.hidden = !stickerPickerOpen;
  if (!stickerPickerOpen) return;
  picker.innerHTML = stickerCatalog.length
    ? `<div class="sticker-picker-grid">${stickerCatalog.map((sticker) => `<button type="button" data-action="chat-sticker-send" data-sticker-token="${escapeHtml(sticker.emoji)}" aria-label="إرسال ملصق ${escapeHtml(sticker.name || sticker.emoji)}" title="${escapeHtml(sticker.name || sticker.emoji)}"><img src="${escapeHtml(sticker.src)}" alt="${escapeHtml(sticker.alt || sticker.name)}" /><span>${escapeHtml(sticker.name || sticker.emoji)}</span></button>`).join('')}</div>`
    : '<p class="sticker-picker-empty">لا توجد ملصقات مخصصة في الكتالوج.</p>';
}

async function loadEmojiCatalog() {
  try {
    const response = await fetch('/emoji-catalog.json');
    if (!response.ok) throw new Error('Emoji catalog request failed');
    const catalog = await response.json();
    emojiCatalog = (catalog.groups || []).flatMap((group) => (group.emojis || []).map((emoji) => ({
      emoji,
      category: group.name,
      index: 0
    })));
    stickerCatalog = (catalog.groups || []).flatMap((group) => (group.customEmojis || [])
      .filter((entry) => typeof entry.token === 'string' && typeof entry.src === 'string')
      .map((entry) => ({
        emoji: entry.token,
        category: group.name,
        src: entry.src,
        alt: entry.alt,
        name: entry.name
      })));
    emojiCatalog.forEach((entry, index) => { entry.index = index; });
    renderEmojiPicker();
    renderStickerPicker();
    const messageList = document.querySelector('.online-chat-messages');
    if (messageList) {
      messageList.innerHTML = onlineChatMessages.map(chatMessageMarkup).join('');
      messageList.scrollTop = messageList.scrollHeight;
    }
  } catch (error) {
    console.warn('Unable to load the emoji catalog:', error);
  }
}

function voiceSpeakerBadge(speaker) {
  if (!speaker) return '';
  const initial = Array.from(speaker.name || '?')[0];
  const isSpeaking = onlineVoiceSpeakers.has(speaker.socketId);
  return `<div class="online-current-speaker${isSpeaking ? ' is-speaking' : ''}" data-speaker-socket-id="${escapeHtml(speaker.socketId || '')}" aria-label="المتحدث الآن: ${escapeHtml(speaker.name)}">
    <span class="online-speaker-avatar">${escapeHtml(initial)}</span>
    <span class="online-speaker-copy"><strong>المتحدث الآن</strong><span>${escapeHtml(speaker.name)}</span></span>
    <span class="voice-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
  </div>`;
}

function activeVoiceSpeakersMarkup() {
  const speakers = [...onlineVoiceSpeakers.values()];
  return `<div class="online-active-speakers" data-online-active-speakers ${speakers.length ? '' : 'hidden'} aria-live="polite">
    ${speakers.map((speaker) => `<span class="online-active-speaker"><span class="online-speaker-avatar">${escapeHtml(Array.from(speaker.name || '?')[0])}</span><strong>${escapeHtml(speaker.name)}</strong><span class="voice-wave" aria-hidden="true"><i></i><i></i><i></i></span></span>`).join('')}
  </div>`;
}

function updateVoiceSpeakerIndicators() {
  const container = document.querySelector('[data-online-active-speakers]');
  if (container) {
    container.outerHTML = activeVoiceSpeakersMarkup();
  }
  document.querySelectorAll('[data-speaker-socket-id]').forEach((indicator) => {
    indicator.classList.toggle('is-speaking', onlineVoiceSpeakers.has(indicator.dataset.speakerSocketId));
  });
}

function onlineSocialTools(state) {
  const messages = Array.isArray(state.chatMessages) ? state.chatMessages : onlineChatMessages;
  onlineChatMessages = messages.slice(-50);
  const canTalk = onlineConnectionStatus === 'connected';
  const reactions = ['👏', '😂', '🔥', '💯', '❤️', '😮'];

  return `<div class="online-social-tools">
    <div class="online-social-actions">
      <button class="secondary-btn online-chat-toggle" type="button" data-action="online-chat-toggle" aria-expanded="${onlineChatOpen}">
        المحادثة <span class="chat-count">${onlineChatMessages.length}</span>
      </button>
      ${state.status === 'DEFENSE'
        ? `<div class="online-reactions" aria-label="تفاعلات سريعة">${reactions.map((emoji) => `<button type="button" class="reaction-btn" data-action="online-reaction" data-emoji="${emoji}" aria-label="إرسال ${emoji}">${emoji}</button>`).join('')}</div>`
        : ''}
      ${canTalk
        ? `<button class="push-to-talk${voicePressed ? ' is-pressed' : ''}" type="button" data-action="online-ptt" aria-pressed="${voicePressed}">اضغط للتحدث</button>`
        : ''}
    </div>
    ${activeVoiceSpeakersMarkup()}
    <section class="online-chat-drawer${onlineChatOpen ? ' is-open' : ''}" aria-label="محادثة الغرفة" aria-hidden="${!onlineChatOpen}">
      <header class="online-chat-header"><strong>محادثة الغرفة</strong><button type="button" data-action="online-chat-close" aria-label="إغلاق المحادثة">×</button></header>
      <ol class="online-chat-messages" aria-live="polite">${onlineChatMessages.map(chatMessageMarkup).join('')}</ol>
      <form class="online-chat-form" data-online-form="chat">
        <input name="message" type="text" maxlength="300" autocomplete="off" placeholder="اكتب رسالة..." aria-label="رسالة جديدة" required />
        <button class="chat-emoji-toggle" type="button" data-action="chat-emoji-toggle" aria-label="عرض الإيموجي" aria-expanded="${emojiPickerOpen}">😀</button>
        <button class="chat-sticker-toggle" type="button" data-action="chat-sticker-toggle" aria-label="عرض الملصقات" aria-expanded="${stickerPickerOpen}">🖼️</button>
        <button type="submit" aria-label="إرسال الرسالة">إرسال</button>
      </form>
      <div class="emoji-picker" data-emoji-picker ${emojiPickerOpen ? '' : 'hidden'}></div>
      <div class="sticker-picker" data-sticker-picker ${stickerPickerOpen ? '' : 'hidden'}></div>
    </section>
  </div><div class="online-reaction-layer" aria-live="polite"></div>`;
}

function closeVoiceConnection(peerSocketId, peer) {
  peer.connection.ontrack = null;
  peer.connection.onicecandidate = null;
  peer.connection.onnegotiationneeded = null;
  peer.connection.close();
  peer.remoteAudio?.remove();
  voiceConnections.delete(peerSocketId);
}

function sendVoiceSignal(targetSocketId, signal) {
  socket.emit('voiceSignal', { targetSocketId, signal });
}

function createVoiceConnection(peerInfo) {
  const connection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  const peer = {
    connection,
    makingOffer: false,
    ignoreOffer: false,
    settingRemoteAnswer: false,
    pendingCandidates: [],
    polite: socket.id.localeCompare(peerInfo.socketId) > 0,
    remoteAudio: null
  };
  voiceConnections.set(peerInfo.socketId, peer);

  connection.onicecandidate = (event) => {
    if (event.candidate) sendVoiceSignal(peerInfo.socketId, { type: 'candidate', candidate: event.candidate.toJSON() });
  };
  connection.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await connection.setLocalDescription();
      sendVoiceSignal(peerInfo.socketId, { type: 'description', description: connection.localDescription.toJSON() });
    } catch (error) {
      console.warn('Unable to negotiate the voice connection:', error);
    } finally {
      peer.makingOffer = false;
    }
  };
  connection.ontrack = (event) => {
    if (!peer.remoteAudio) {
      peer.remoteAudio = document.createElement('audio');
      peer.remoteAudio.autoplay = true;
      peer.remoteAudio.playsInline = true;
      peer.remoteAudio.dataset.voicePeer = peerInfo.socketId;
      document.body.appendChild(peer.remoteAudio);
    }
    peer.remoteAudio.srcObject = event.streams[0];
    peer.remoteAudio.play().catch(() => {});
  };

  if (localVoiceStream) {
    localVoiceStream.getAudioTracks().forEach((track) => connection.addTrack(track, localVoiceStream));
  }
  return peer;
}

function syncVoiceConnections(state) {
  const peers = Array.isArray(state.voicePeers) ? state.voicePeers : [];
  const activePeerIds = new Set(peers.map((peer) => peer.socketId).filter((id) => id && id !== socket.id));
  for (const [peerSocketId, peer] of voiceConnections) {
    if (!activePeerIds.has(peerSocketId)) closeVoiceConnection(peerSocketId, peer);
  }
  if (typeof RTCPeerConnection === 'undefined') return;
  peers.forEach((peerInfo) => {
    if (peerInfo.socketId !== socket.id && !voiceConnections.has(peerInfo.socketId)) createVoiceConnection(peerInfo);
  });
  if (!canUsePushToTalk(state)) {
    voicePressed = false;
    setVoiceTrackEnabled(false);
  }
}

function canUsePushToTalk(state = onlineState) {
  return Boolean(state && onlineSession && onlineConnectionStatus === 'connected');
}

function setVoiceTrackEnabled(enabled) {
  if (localVoiceStream) {
    localVoiceStream.getAudioTracks().forEach((track) => { track.enabled = enabled; });
  }
  document.querySelectorAll('[data-action="online-ptt"]').forEach((button) => {
    button.classList.toggle('is-pressed', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? 'تتحدث الآن...' : 'اضغط للتحدث';
  });
  if (!enabled && !socket.connected) onlineSpeakingSent = false;
  if (socket.connected && onlineSession && enabled !== onlineSpeakingSent && (!enabled || localVoiceStream)) {
    socket.emit('voiceSpeaking', { active: enabled });
    onlineSpeakingSent = enabled;
  }
}

async function startPushToTalk() {
  if (!canUsePushToTalk()) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setOnlineMessage('المتصفح لا يدعم استخدام الميكروفون في هذه الصفحة.');
    return;
  }
  voicePressed = true;
  setVoiceTrackEnabled(true);
  try {
    if (!localVoiceStream) {
      voiceStreamRequest ||= navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      localVoiceStream = await voiceStreamRequest;
      voiceStreamRequest = null;
      localVoiceStream.getAudioTracks().forEach((track) => { track.enabled = voicePressed && canUsePushToTalk(); });
      voiceConnections.forEach((peer) => {
        localVoiceStream.getAudioTracks().forEach((track) => {
          if (!peer.connection.getSenders().some((sender) => sender.track === track)) peer.connection.addTrack(track, localVoiceStream);
        });
      });
    }
    setVoiceTrackEnabled(voicePressed && canUsePushToTalk());
  } catch (error) {
    voiceStreamRequest = null;
    voicePressed = false;
    setVoiceTrackEnabled(false);
    setOnlineMessage('تعذر تشغيل الميكروفون. تحقق من الإذن واستخدام اتصال آمن.');
  }
}

function stopPushToTalk() {
  voicePressed = false;
  setVoiceTrackEnabled(false);
}

function closeVoiceConnections() {
  voiceConnections.forEach((peer, peerSocketId) => closeVoiceConnection(peerSocketId, peer));
  if (localVoiceStream) localVoiceStream.getTracks().forEach((track) => track.stop());
  localVoiceStream = null;
  voiceStreamRequest = null;
  voicePressed = false;
}

function renderOnlineRoom() {
  if (!onlineSession || !onlineState) return;
  if (Number.isFinite(onlineState.serverNow)) {
    onlineServerOffset = onlineState.serverNow - Date.now();
  }
  clearOnlineCountdown();
  document.body.classList.add('game-started');
  topBarActions.innerHTML = '<button class="top-bar-btn" type="button" data-top-action="leave-online">مغادرة الغرفة</button>';
  topBarActions.hidden = false;

  const state = onlineState;
  const speakerId = state.currentSpeaker?.id || null;
  const isNewDefenseSpeaker = state.status === 'DEFENSE' && speakerId && onlinePreviousSpeakerId && speakerId !== onlinePreviousSpeakerId;
  if (state.status === 'DEFENSE' && speakerId) onlinePreviousSpeakerId = speakerId;
  const isBoss = state.role === 'boss';
  let screen = '';

  if (state.status === 'LOBBY') {
    const connectedCount = state.players.filter((player) => player.isConnected).length;
    screen = `${onlineHeader(state)}
      <h2>غرفة الانتظار</h2>
      <div class="room-code-box"><span>رمز الغرفة</span><strong>${escapeHtml(state.roomId)}</strong><button class="mini-btn" type="button" data-action="online-copy-code">نسخ الرمز</button></div>
      <p class="online-instruction">شارك الرمز مع المتقدمين. تبدأ اللعبة عند اتصال متقدمين اثنين على الأقل.</p>
      ${onlinePlayerList(state.players)}
      ${isBoss
        ? `<button class="game-btn" type="button" data-action="online-start" ${connectedCount < 2 ? 'disabled' : ''}>ابدأ المقابلة (${connectedCount} متصل)</button>`
        : '<div class="online-waiting">بانتظار المدير لبدء المقابلة</div>'}`;
  } else if (state.status === 'BOSS_QUESTION') {
    screen = `${onlineHeader(state)}<span class="meta-badge">الجولة ${state.round}</span>
      <h2>${isBoss ? 'اكتب سؤال المقابلة' : 'المدير يجهز سؤال المقابلة'}</h2>
      ${isBoss
        ? '<div class="field-group"><label for="online-boss-question">سؤال المقابلة</label><textarea id="online-boss-question" maxlength="500" placeholder="اكتب السؤال للجميع" required></textarea><button class="game-btn" type="button" data-action="online-send-question">إرسال السؤال</button></div>'
        : '<div class="online-waiting">سيظهر السؤال هنا فور إرساله</div>'}`;
  } else if (state.status === 'SUBMIT_TRAPS') {
    const me = state.players.find((player) => player.id === state.meId);
    const isTrapWriter = Boolean(me?.canSubmitTrap);
    screen = `${onlineHeader(state)}<span class="meta-badge">الجولة ${state.round}</span>
      <h2>${isBoss ? 'إجابات التوريط' : isTrapWriter ? 'أرسل إجابتك التوريطية' : 'بانتظار إجابات المستبعدين'}</h2>
      <div class="info-box"><p>سؤال المدير</p><strong>${escapeHtml(state.currentQuestion)}</strong></div>
      ${isBoss
        ? `<div class="online-waiting">${state.players.filter((player) => player.hasSubmittedTrap).length} من ${state.players.filter((player) => player.isConnected).length} أجابوا</div>${onlinePlayerList(state.players)}`
        : !isTrapWriter
          ? '<div class="online-waiting">في هذه المرحلة يكتب اللاعبون المستبعدون إجابات التوريط، ثم يحاول الناجون تبريرها.</div>'
        : me?.hasSubmittedTrap
          ? '<div class="online-waiting">وصلت إجابتك. بانتظار بقية الغرفة.</div>'
          : '<div class="field-group"><label for="online-trap-answer">إجابتك</label><textarea id="online-trap-answer" maxlength="500" placeholder="اكتب إجابتك بسرية" required></textarea><button class="game-btn" type="button" data-action="online-send-trap">إرسال الإجابة</button></div>'}`;
  } else if (state.status === 'DEFENSE') {
    const currentSpeaker = state.currentSpeaker?.name || 'بانتظار متقدم متصل';
    if (state.isMyTurn) {
      screen = `${onlineHeader(state)}<span class="status-pill">دورك في التبرير</span>
        <h2>${escapeHtml(currentSpeaker)}</h2>${voiceSpeakerBadge(state.currentSpeaker)}
        ${!state.trapRevealed ? `<div class="private-trap-preview"><span>معاينة خاصة بك فقط</span><strong>${escapeHtml(state.myTrap || 'لا توجد إجابة مخصصة.')}</strong><small>ستظهر للجميع عند الكشف أو بعد 20 ثانية.</small></div>` : ''}
        <div class="trap-card-wrap"><div class="trap-card ${state.trapRevealed ? 'is-flipped' : ''}" aria-label="بطاقة الإجابة التوريطية">
          <div class="card-face card-front">${state.trapRevealed ? 'الإجابة التوريطية' : 'بطاقتك جاهزة للكشف'}</div><div class="card-face card-back"><strong>${escapeHtml(state.myTrap || 'لا توجد إجابة مخصصة.')}</strong></div>
        </div></div>
        ${state.trapRevealed ? '<div class="online-waiting">تابع التبرير؛ المدير ينهي دورك عند الاكتفاء.</div>' : '<button class="game-btn" type="button" data-action="online-reveal">كشف البطاقة للمدير والجميع</button>'}`;
    } else {
      screen = `${onlineHeader(state)}<span class="status-pill">بث مباشر للتبرير</span>
        <h2>المتحدث الآن: ${escapeHtml(currentSpeaker)}</h2>${voiceSpeakerBadge(state.currentSpeaker)}
        <div class="info-box"><p>سؤال المدير</p><strong>${escapeHtml(state.currentQuestion)}</strong></div>
        <div class="trap-card-wrap public-trap-card-wrap"><div class="trap-card ${state.trapRevealed ? 'is-flipped' : ''}">
          <div class="card-face card-front">${state.trapRevealed ? 'الإجابة التوريطية' : 'البطاقة ما زالت مغلقة'}</div><div class="card-face card-back"><strong>${escapeHtml(state.revealedTrap || '—')}</strong></div>
        </div></div>
        ${isBoss ? '<button class="game-btn" type="button" data-action="online-finish-defense">إنهاء تبرير اللاعب</button>' : ''}`;
    }
  } else if (state.status === 'DEFENSE_ENDING') {
    screen = `${onlineHeader(state)}<span class="status-pill">انتقال إلى المتقدم التالي</span>
      <h2>انتهى التبرير</h2>${voiceSpeakerBadge(state.currentSpeaker)}
      <div class="defense-ending-countdown"><span data-defense-ending-countdown>3</span><small>استعدوا للدور التالي</small></div>
      <div class="trap-card-wrap public-trap-card-wrap"><div class="trap-card is-flipped">
        <div class="card-face card-front">انتهى الدور</div><div class="card-face card-back"><strong>${escapeHtml(state.revealedTrap || '—')}</strong></div>
      </div></div>`;
  } else if (state.status === 'ELIMINATION') {
    const eliminated = onlineEliminationResult?.eliminatedPlayerName
      || state.players.find((player) => player.id === state.eliminatedPlayerId)?.name;
    const resultBanner = eliminated
      ? `<div class="elimination-result"><div class="dramatic-card eliminated"><span>تم الاستبعاد</span><strong>${escapeHtml(eliminated)}</strong></div><div class="dramatic-card survivor"><span>الناجون</span><strong>${state.players.filter((player) => !player.isEliminated).map((player) => escapeHtml(player.name)).join('، ') || '—'}</strong></div></div>`
      : '';
    screen = `${onlineHeader(state)}<h2>${isBoss ? 'اختر المتقدم المستبعد' : 'قرار الاستبعاد'}</h2>${resultBanner}
      ${isBoss && !eliminated ? onlinePlayerList(state.players, true) : '<div class="online-waiting">سيبدأ المدير الجولة التالية بعد إعلان النتيجة</div>'}`;
  } else if (state.status === 'FINAL_CHALLENGE') {
    const finalist = state.finalist || state.players.find((player) => !player.isEliminated);
    const finalAction = state.finalStage === 'DECISION' && isBoss
      ? `<div class="info-box"><p>سؤال الجولة الأخيرة</p><strong>${escapeHtml(state.finalQuestion || state.currentQuestion)}</strong></div><div class="result-box"><p>الناجي الأخير من جولات التبرير</p><strong>${escapeHtml(finalist?.name || '—')}</strong><p class="final-decision-prompt">هل فاز المتقدم الأخير أم يُستبعد مع الباقين؟</p></div><div class="footer-actions"><button class="game-btn" type="button" data-action="online-final-decision" data-decision="accept">إعلان فوزه</button><button class="secondary-btn" type="button" data-action="online-final-decision" data-decision="reject">استبعاده مع الباقين</button></div>`
          : state.finalStage === 'DECISION'
            ? `<div class="info-box"><p>سؤال الجولة الأخيرة</p><strong>${escapeHtml(state.finalQuestion || state.currentQuestion)}</strong></div><div class="online-waiting">المدير يقرر الآن إن كان ${escapeHtml(finalist?.name || 'المتقدم الأخير')} قد فاز أم سيُستبعد مع الباقين</div>`
          : state.finalStage === 'COMPLETE'
            ? finalist
              ? `<div class="victory-panel ${state.finalDecision === 'accept' ? 'accepted' : 'rejected'}"><span>${state.finalDecision === 'accept' ? 'فاز باللعبة' : 'استُبعد مع الباقين'}</span><strong>${escapeHtml(finalist.name)}</strong></div>`
              : '<div class="victory-panel rejected"><span>تم استبعاد جميع المتقدمين</span><strong>لا يوجد فائز</strong></div>'
            : '<div class="online-waiting">بانتظار قرار الجولة الأخيرة</div>';
    screen = `${onlineHeader(state)}<span class="status-pill">حسم الجولة الأخيرة</span><h2>الناجي الأخير: ${escapeHtml(finalist?.name || 'لا يوجد لاعب باقٍ')}</h2>${finalAction}`;
  }

  app.innerHTML = `<section class="screen-card online-room-screen${isNewDefenseSpeaker ? ' is-new-defense-speaker' : ''}${state.status === 'DEFENSE_ENDING' ? ' is-defense-ending' : ''}">${screen}<div id="online-message" class="online-message" ${onlineMessage ? '' : 'hidden'}>${escapeHtml(onlineMessage)}</div>${onlineSocialTools(state)}</section>`;
  renderEmojiPicker();
  renderStickerPicker();
  syncVoiceConnections(state);
  if (state.status === 'DEFENSE_ENDING') {
    startOnlineCountdown(state.defenseEndsAt, '[data-defense-ending-countdown]', true);
  }
}

function startOnlineCountdown(turnEndsAt, selector = '[data-online-countdown]', withSound = false) {
  clearOnlineCountdown();
  if (!turnEndsAt) return;
  let previousCount = null;
  const updateCountdown = () => {
    const element = document.querySelector(selector);
    if (!element) {
      clearOnlineCountdown();
      return;
    }
    const count = Math.max(0, Math.ceil((turnEndsAt - (Date.now() + onlineServerOffset)) / 1000));
    element.textContent = String(count);
    if (withSound && count > 0 && count !== previousCount) playDefenseCountdownTick();
    previousCount = count;
  };
  updateCountdown();
  onlineCountdownTimer = setInterval(updateCountdown, 250);
}

function leaveOnlineRoom() {
  emitOnlineEvent('leaveRoom').finally(() => {
    closeVoiceConnections();
    localStorage.removeItem(ONLINE_SESSION_KEY);
    onlineSession = null;
    onlineState = null;
    onlineEliminationResult = null;
    onlineMessage = '';
    clearOnlineCountdown();
    buildMenuScreen();
  });
}

function buildMenuScreen() {
  clearTimer();
  clearOnlineCountdown();
  localGameState.phase = 'menu';
  document.body.classList.remove('game-started');
  syncTopBarVisibility();
  saveGameState();

  app.innerHTML = `
    <section class="screen-card hero-card">
      <div class="title-wrap">
        <div class="hero-logo" aria-label="شعار لعبة أتقدم للوظيفة">
          <img src="/img/logo.png" alt="شعار أتقدم للوظيفة" />
        </div>
      </div>

      <div class="actions">
        <button class="game-btn" data-action="start-local-mode">
          <span>ابدأ اللعبة</span>
          <small>Pass &amp; Play</small>
        </button>
        <button class="secondary-btn" type="button" data-action="open-online">اللعب الجماعي أونلاين</button>
      </div>
    </section>
  `;
}

function buildSetupScreen() {
  localGameState.phase = 'setup';
  document.body.classList.add('game-started');

  if (!Array.isArray(localGameState.players) || localGameState.players.length === 0) {
    resetPlayers();
  } else {
    ensurePlayerList();
  }

  syncTopBarVisibility();
  saveGameState();

  app.innerHTML = `
    <section class="screen-card">
      <div class="player-meta">
        <span class="status-pill">إعداد اللعبة</span>
      </div>

      <h2>إدخال الأسماء</h2>

      <div class="field-group">
        <label for="boss-name">اسم المدير</label>
        <input id="boss-name" type="text" value="${escapeHtml(localGameState.bossName)}" placeholder="اكتب اسم المدير" />
      </div>

      <div class="players-list" id="players-list">
        ${localGameState.players
          .map(
            (player, index) => `
              <div class="player-row">
                <input
                  type="text"
                  data-player-index="${index}"
                  value="${escapeHtml(player.Name || '')}"
                  placeholder="اسم المتقدم ${index + 1}"
                />
                <button
                  class="mini-btn"
                  type="button"
                  data-action="remove-player"
                  data-player-index="${index}"
                  ${localGameState.players.length <= 2 ? 'disabled' : ''}
                >
                  حذف
                </button>
              </div>
            `
          )
          .join('')}
      </div>

      <div class="footer-actions">
        <button class="secondary-btn" type="button" data-action="add-player">+ إضافة متقدم</button>
        <button class="game-btn" type="button" data-action="start-game">ابدأ اللعبة</button>
      </div>

      ${buildQuickActions()}
    </section>
  `;
}

function buildBossQuestionScreen() {
  localGameState.phase = 'boss-question';
  saveGameState();

  app.innerHTML = `
    <section class="screen-card">
      <div class="player-meta">
        <span class="status-pill">الجولة ${localGameState.currentRound}</span>
      </div>

      <h2>مرحلة السؤال</h2>
      <p>المدير: <strong>${escapeHtml(localGameState.bossName)}</strong></p>

      <div class="field-group">
        <label for="boss-question">اكتب سؤال المقابلة</label>
        <textarea id="boss-question" placeholder="مثال: ما الذي يميزك عن غيرك في العمل؟">${escapeHtml(localGameState.currentQuestion)}</textarea>
      </div>

      <div class="footer-actions">
        <button class="game-btn" type="button" data-action="save-boss-question">حفظ السؤال</button>
      </div>

      ${buildQuickActions()}
    </section>
  `;
}

function buildHandoffScreen() {
  const writerId = localGameState.trapWriterQueue[localGameState.currentPlayerIndex];
  const currentPlayer = localGameState.players.find((player) => player.id === writerId);
  if (!currentPlayer) {
    finishTrapPhase();
    return;
  }

  localGameState.phase = 'handoff';
  saveGameState();
  const writerRole = currentPlayer.status === 'eliminated' ? 'المستبعد يكتب التوريط' : 'المتقدم يكتب التوريط';

  app.innerHTML = `
    <section class="screen-card handoff-screen">
      <div class="status-pill">${writerRole}</div>
      <h2>مرّر الجهاز إلى</h2>
      <div class="handoff-box">
        <p>اللاعب التالي</p>
        <div class="large-name">${escapeHtml(currentPlayer.Name)}</div>
      </div>

      <div class="footer-actions">
        <button class="game-btn" type="button" data-action="ready-handoff">جاهز</button>
      </div>

      ${buildQuickActions()}
    </section>
  `;
}

function buildTrapInputScreen() {
  const writerId = localGameState.trapWriterQueue[localGameState.currentPlayerIndex];
  const currentPlayer = localGameState.players.find((player) => player.id === writerId);
  if (!currentPlayer) {
    finishTrapPhase();
    return;
  }

  localGameState.phase = 'trap-input';
  saveGameState();
  const writerRole = currentPlayer.status === 'eliminated' ? 'إجابة توريط من لاعب مستبعد' : 'إجابة توريط';

  app.innerHTML = `
    <section class="screen-card">
      <div class="player-meta">
        <span class="status-pill">${writerRole}</span>
      </div>

      <h2>${escapeHtml(currentPlayer.Name)}</h2>
      <div class="info-box">
        <p>السؤال الحالي</p>
        <strong>${escapeHtml(localGameState.currentQuestion || 'لم يتم إدخال سؤال بعد.')}</strong>
      </div>

      <div class="field-group">
        <label for="trap-answer">اكتب إجابتك التوريطية</label>
        <textarea id="trap-answer" placeholder="مثال: كنت أعدّ الأمر مجرد مزحة ...">${escapeHtml(currentPlayer.submittedTrap)}</textarea>
      </div>

      <div class="footer-actions">
        <button class="game-btn" type="button" data-action="save-trap-answer">حفظ الإجابة</button>
      </div>

      ${buildQuickActions()}
    </section>
  `;
}

function buildDefenseScreen() {
  const currentPlayer = getCurrentDefensePlayer();
  if (!currentPlayer) {
    buildBossEliminationScreen();
    return;
  }

  localGameState.phase = 'defense';
  saveGameState();

  app.innerHTML = `
    <section class="screen-card defense-screen">
      <div class="player-meta">
        <span class="status-pill">التبرير</span>
        <span class="meta-badge">الجولة ${localGameState.currentRound}</span>
      </div>

      <h2>${escapeHtml(currentPlayer.Name)}</h2>

      <div class="timer-box">
        <span id="countdown-value">${localGameState.countdown}</span>
        <span>ث</span>
      </div>

      <div class="trap-card-wrap">
        <div class="trap-card ${currentPlayer.cardRevealed ? 'is-flipped' : ''}" data-action="flip-card" role="button" tabindex="0" aria-label="فتح بطاقة الإجابة">
          <div class="card-face card-front">بطاقة مغلقة</div>
          <div class="card-face card-back">${escapeHtml(currentPlayer.assignedTrap || 'لا توجد إجابة مخصصة.')}</div>
        </div>
      </div>

      <div class="footer-actions">
        <button class="secondary-btn" type="button" data-action="flip-card">فتح البطاقة</button>
        <button class="game-btn" type="button" data-action="finish-defense">أنهيت التبرير</button>
      </div>

      ${buildQuickActions()}
    </section>
  `;

  const countdownValue = document.getElementById('countdown-value');
  if (countdownValue) {
    countdownValue.textContent = localGameState.countdown;
  }
}

function buildBossEliminationScreen() {
  const activePlayers = getActivePlayers();
  localGameState.phase = 'elimination';
  saveGameState();

  app.innerHTML = `
    <section class="screen-card">
      <div class="player-meta">
        <span class="status-pill">استبعاد</span>
      </div>

      <h2>اختر لاعباً لاستبعاده</h2>
      <p>المدير: <strong>${escapeHtml(localGameState.bossName)}</strong></p>

      <div class="elimination-list">
        ${activePlayers
          .map(
            (player) => `
              <button class="choice-btn" type="button" data-action="eliminate-player" data-player-name="${escapeHtml(player.id)}">
                ${escapeHtml(player.Name)}
              </button>
            `
          )
          .join('')}
      </div>

      ${buildQuickActions()}
    </section>
  `;
}

function buildFinalChallengeScreen() {
  const finalist = getActivePlayers()[0];
  localGameState.phase = 'final';
  saveGameState();

  app.innerHTML = `
    <section class="screen-card final-screen">
      <div class="status-pill">الجولة النهائية</div>
      <h2>المتقدم الأخير</h2>
      <div class="info-box">
        <p>المتقدم النهائي</p>
        <div class="large-name">${escapeHtml(finalist ? finalist.Name : '—')}</div>
      </div>

      <div class="field-group">
        <label for="final-question">السؤال القاضي</label>
        <textarea id="final-question" placeholder="اكتب السؤال النهائي الذي يقرر مستقبل المتقدم..."></textarea>
      </div>

      <div class="footer-actions">
        <button class="game-btn" type="button" data-action="save-final-question">ابدأ السؤال النهائي</button>
      </div>

      ${buildQuickActions()}
    </section>
  `;
}

function buildFinalDefenseScreen() {
  const finalist = getActivePlayers()[0];
  localGameState.phase = 'final-defense';
  saveGameState();

  app.innerHTML = `
    <section class="screen-card final-screen">
      <div class="status-pill">دفاع نهائي</div>
      <h2>${escapeHtml(finalist ? finalist.Name : 'المتقدم')}</h2>
      <div class="info-box">
        <p>السؤال:</p>
        <strong>${escapeHtml(localGameState.currentQuestion)}</strong>
      </div>

      <div class="field-group">
        <label for="final-defense-text">اكتب دفاعك النهائي</label>
        <textarea id="final-defense-text" placeholder="وضح لماذا يستحق الوظيفة..."></textarea>
      </div>

      <div class="footer-actions">
        <button class="game-btn" type="button" data-action="submit-final-defense">تأكيد الدفاع</button>
      </div>

      ${buildQuickActions()}
    </section>
  `;
}

function buildBossDecisionScreen() {
  localGameState.phase = 'decision';
  saveGameState();
  const finalist = getActivePlayers()[0];

  app.innerHTML = `
    <section class="screen-card final-screen">
      <div class="status-pill">حسم الجولة الأخيرة</div>
      <h2>هل فاز المتقدم الأخير أم يُستبعد مع الباقين؟</h2>
      <div class="result-box">
        <p>سؤال الجولة:</p>
        <strong>${escapeHtml(localGameState.currentQuestion)}</strong>
        <p>الناجي الأخير:</p>
        <strong>${escapeHtml(finalist?.Name || '—')}</strong>
      </div>

      <div class="footer-actions">
        <button class="game-btn" type="button" data-action="final-decision" data-result="accept">إعلان فوزه</button>
        <button class="secondary-btn" type="button" data-action="final-decision" data-result="reject">استبعاده مع الباقين</button>
      </div>

      ${buildQuickActions()}
    </section>
  `;
}

function validatePlayerNames() {
  const rawNames = Array.from(document.querySelectorAll('[data-player-index]'))
    .map((input) => input.value.trim())
    .filter(Boolean);

  const bossName = document.getElementById('boss-name')?.value.trim();

  if (!bossName) {
    alert('يرجى إدخال اسم المدير.');
    return false;
  }

  if (rawNames.length < 2) {
    alert('يجب إدخال اسمين على الأقل للمتقدمين.');
    return false;
  }

  if (rawNames.some((name) => name.length > 40)) {
    alert('Please keep player names to 40 characters or fewer.');
    return false;
  }

  if (new Set(rawNames.map((name) => name.toLocaleLowerCase())).size !== rawNames.length) {
    alert('Please use a unique name for each player.');
    return false;
  }

  localGameState.bossName = bossName;
  localGameState.players = rawNames.map((name) => createPlayer(name));
  localGameState.originalPlayerCount = localGameState.players.length;
  localGameState.currentRound = 1;
  localGameState.currentQuestion = '';
  localGameState.turnIndex = 0;
  localGameState.currentPlayerIndex = 0;
  localGameState.finalDefenseText = '';
  localGameState.countdown = 60;
  localGameState.finalWinner = '';
  localGameState.finalistId = '';
  localGameState.lastDecision = '';
  localGameState.trapWriterQueue = [];
  localGameState.finalRound = false;
  saveGameState();
  return true;
}

function finishTrapPhase() {
  const trapEntries = localGameState.players
    .filter((player) => localGameState.trapWriterQueue.includes(player.id) && player.submittedTrap && player.submittedTrap.trim())
    .map((player) => ({ authorId: player.id, text: player.submittedTrap.trim() }));

  const activePlayers = getActivePlayers();
  const usedKeys = new Set();

  activePlayers.forEach((player) => {
    player.assignedTrap = '';
    const shuffledEntries = shuffleArray(trapEntries);
    const match = shuffledEntries.find((entry) => {
      const key = `${entry.authorId}::${entry.text}`;
      return entry.authorId !== player.id && !usedKeys.has(key);
    });

    if (match) {
      player.assignedTrap = match.text;
      usedKeys.add(`${match.authorId}::${match.text}`);
    } else {
      const fallback = trapEntries.find(
        (entry) => entry.authorId !== player.id && !usedKeys.has(`${entry.authorId}::${entry.text}`)
      );

      if (fallback) {
        player.assignedTrap = fallback.text;
        usedKeys.add(`${fallback.authorId}::${fallback.text}`);
      } else {
        player.assignedTrap = 'لا توجد إجابة مناسبة في هذه الجولة.';
      }
    }
  });

  localGameState.defenseQueue = activePlayers.map((player) => player.id);
  localGameState.turnIndex = 0;
  localGameState.countdown = 60;
  localGameState.phase = 'defense';
  startDefenseTimer();
  saveGameState();
  buildDefenseScreen();
}

function startDefenseTimer() {
  clearTimer();
  if (!Number.isFinite(localGameState.countdown) || localGameState.countdown <= 0) {
    localGameState.countdown = 60;
  }
  localGameState.phase = 'defense';

  localGameState.timerId = setInterval(() => {
    if (localGameState.phase !== 'defense') {
      clearTimer();
      return;
    }

    localGameState.countdown -= 1;
    saveGameState();

    const timerValue = document.getElementById('countdown-value');
    if (timerValue) {
      timerValue.textContent = localGameState.countdown;
    }

    if (localGameState.countdown <= 0) {
      clearTimer();
      advanceDefense();
    }
  }, 1000);
}

function advanceDefense() {
  const currentPlayer = getCurrentDefensePlayer();
  if (currentPlayer) {
    currentPlayer.cardRevealed = false;
  }

  if (localGameState.turnIndex >= localGameState.defenseQueue.length - 1) {
    clearTimer();
    if (localGameState.finalRound && getActivePlayers().length === 1) {
      localGameState.phase = 'decision';
      localGameState.finalistId = getActivePlayers()[0].id;
      saveGameState();
      buildBossDecisionScreen();
    } else {
      localGameState.phase = 'elimination';
      saveGameState();
      buildBossEliminationScreen();
    }
    return;
  }

  localGameState.turnIndex += 1;
  localGameState.countdown = 60;
  saveGameState();
  buildDefenseScreen();
  startDefenseTimer();
}

function startNextRound() {
  localGameState.currentRound += 1;
  localGameState.currentQuestion = '';
  localGameState.turnIndex = 0;
  localGameState.currentPlayerIndex = 0;
  localGameState.phase = 'boss-question';
  saveGameState();
  buildBossQuestionScreen();
}

function evaluateElimination(playerName) {
  const target = localGameState.players.find((player) => player.id === playerName);
  if (!target) {
    return;
  }

  target.status = 'eliminated';
  saveGameState();

  const activePlayers = getActivePlayers();
  if (activePlayers.length <= 1) {
    localGameState.finalistId = activePlayers[0]?.id || '';
    localGameState.finalDefenseText = '';
    if (activePlayers.length === 1) {
      localGameState.finalRound = true;
      startNextRound();
    } else {
      finalizeDecision('reject');
    }
    return;
  }

  startNextRound();
}

function beginGameFlow() {
  if (!validatePlayerNames()) {
    return;
  }

  document.body.classList.add('game-started');
  localGameState.phase = 'boss-question';
  saveGameState();
  buildBossQuestionScreen();
}

function saveBossQuestion() {
  const bossQuestion = document.getElementById('boss-question')?.value.trim();
  if (!bossQuestion) {
    alert('يرجى إدخال السؤال قبل المتابعة.');
    return;
  }

  if (bossQuestion.length > 500) {
    alert('Please keep the question to 500 characters or fewer.');
    return;
  }

  localGameState.currentQuestion = bossQuestion;
  localGameState.phase = 'trap';
  localGameState.currentPlayerIndex = 0;
  const activePlayers = getActivePlayers();
  const eliminatedPlayers = localGameState.players.filter((player) => player.status === 'eliminated');
  const originalCount = localGameState.originalPlayerCount || localGameState.players.length;
  const reverseDirection = window.AtqadamGameRules.shouldUseEliminatedAuthors({
    round: localGameState.currentRound,
    finalRound: localGameState.finalRound,
    activeCount: activePlayers.length,
    originalPlayerCount: originalCount
  });
  localGameState.trapWriterQueue = (reverseDirection
    ? eliminatedPlayers
    : localGameState.players.filter((player) => player.status === 'active' || player.status === 'eliminated')).map((player) => player.id);

  localGameState.players.forEach((player) => {
    player.submittedTrap = '';
    player.assignedTrap = '';
    player.cardRevealed = false;
  });

  saveGameState();
  buildHandoffScreen();
}

function handleReadyHandoff() {
  const writerId = localGameState.trapWriterQueue[localGameState.currentPlayerIndex];
  const currentPlayer = localGameState.players.find((player) => player.id === writerId);
  if (!currentPlayer) {
    finishTrapPhase();
    return;
  }

  localGameState.phase = 'trap-input';
  saveGameState();
  buildTrapInputScreen();
}

function handleTrapSave() {
  const answerField = document.getElementById('trap-answer');
  const answer = answerField ? answerField.value.trim() : '';

  if (!answer) {
    alert('يرجى كتابة إجابة التوريط قبل المتابعة.');
    return;
  }

  if (answer.length > 500) {
    alert('Please keep answers to 500 characters or fewer.');
    return;
  }

  const currentPlayer = localGameState.players[localGameState.currentPlayerIndex];
  if (!currentPlayer) {
    finishTrapPhase();
    return;
  }

  currentPlayer.submittedTrap = answer;
  saveGameState();

  localGameState.currentPlayerIndex += 1;
  saveGameState();

  if (localGameState.currentPlayerIndex < localGameState.trapWriterQueue.length) {
    buildHandoffScreen();
  } else {
    finishTrapPhase();
  }
}

function saveFinalQuestion() {
  const finalQuestion = document.getElementById('final-question')?.value.trim();
  if (!finalQuestion) {
    alert('يرجى إدخال السؤال القاضي.');
    return;
  }

  if (finalQuestion.length > 500) {
    alert('Please keep the question to 500 characters or fewer.');
    return;
  }

  localGameState.currentQuestion = finalQuestion;
  localGameState.phase = 'final-defense';
  saveGameState();
  buildFinalDefenseScreen();
}

function submitFinalDefense() {
  const defenseText = document.getElementById('final-defense-text')?.value.trim();
  if (!defenseText) {
    alert('يرجى كتابة دفاع المتقدم قبل الحسم.');
    return;
  }

  if (defenseText.length > 1000) {
    alert('Please keep the final defense to 1,000 characters or fewer.');
    return;
  }

  localGameState.finalDefenseText = defenseText;
  localGameState.phase = 'decision';
  saveGameState();
  buildBossDecisionScreen();
}

function finalizeDecision(result) {
  if (!['accept', 'reject'].includes(result)) {
    return;
  }
  clearTimer();
  const finalist = getActivePlayers()[0];
  if (result === 'reject' && finalist) {
    finalist.status = 'eliminated';
  }
  localGameState.lastDecision = result;
  localGameState.finalistId = finalist?.id || localGameState.finalistId || '';
  localGameState.finalWinner = result === 'accept' ? (finalist?.Name || 'المتقدم') : '';
  localGameState.phase = 'completed';
  saveGameState();

  const outcomeText = result === 'accept'
    ? `فاز ${escapeHtml(finalist?.Name || 'المتقدم')} باللعبة.`
    : finalist
      ? `تم استبعاد ${escapeHtml(finalist.Name)} مع الباقين؛ لا يوجد فائز.`
      : 'تم استبعاد جميع المتقدمين؛ لا يوجد فائز.';
  const outcomeName = result === 'accept' ? localGameState.finalWinner : finalist?.Name || 'لا يوجد فائز';

  app.innerHTML = `
    <section class="screen-card final-screen">
      <div class="status-pill">نهاية اللعبة</div>
      <h2>النتيجة النهائية</h2>
      <div class="result-box">
        <p>${outcomeText}</p>
        <strong>${escapeHtml(outcomeName)}</strong>
      </div>

      <div class="footer-actions">
        <button class="game-btn" type="button" data-action="restart-game">ابدأ لعبة جديدة</button>
        <button class="secondary-btn" type="button" data-action="exit-to-menu">الخروج إلى القائمة</button>
      </div>
    </section>
  `;
}

function restartGame() {
  clearTimer();
  clearSavedState();
  localGameState = window.AtqadamGameState.defaultGameState();
  resetPlayers();
  buildSetupScreen();
}

function exitToMenu() {
  clearTimer();
  localGameState.phase = 'menu';
  saveGameState();
  buildMenuScreen();
}

function handleTopBarAction(action) {
  switch (action) {
    case 'restart-game':
      requestRestartConfirmation();
      break;
    case 'exit-to-menu':
      requestExitConfirmation();
      break;
    case 'leave-online':
      leaveOnlineRoom();
      break;
    default:
      break;
  }
}

function restoreGameSession() {
  if (!window.AtqadamGameState) {
    buildMenuScreen();
    return;
  }

  const savedState = window.AtqadamGameState.getStoredState();
  if (!savedState || savedState.phase === 'menu') {
    document.body.classList.remove('game-started');
    syncTopBarVisibility();
    buildMenuScreen();
    return;
  }

  localGameState = savedState;
  document.body.classList.add('game-started');
  syncTopBarVisibility();

  switch (savedState.phase) {
    case 'setup':
      buildSetupScreen();
      break;
    case 'boss-question':
      buildBossQuestionScreen();
      break;
    case 'handoff':
      buildHandoffScreen();
      break;
    case 'trap-input':
      buildTrapInputScreen();
      break;
    case 'defense':
      buildDefenseScreen();
      startDefenseTimer();
      break;
    case 'elimination':
      buildBossEliminationScreen();
      break;
    case 'final':
      buildFinalChallengeScreen();
      break;
    case 'final-defense':
      buildFinalDefenseScreen();
      break;
    case 'decision':
      buildBossDecisionScreen();
      break;
    case 'completed':
      {
        const finalist = savedState.players.find((player) => player.id === savedState.finalistId)
          || savedState.players.find((player) => player.status === 'active');
        const outcomeText = savedState.lastDecision === 'accept'
          ? `فاز ${escapeHtml(finalist?.Name || 'المتقدم')} باللعبة.`
          : finalist
            ? `تم استبعاد ${escapeHtml(finalist.Name)} مع الباقين؛ لا يوجد فائز.`
            : 'تم استبعاد جميع المتقدمين؛ لا يوجد فائز.';
        const outcomeName = savedState.lastDecision === 'accept' ? savedState.finalWinner : finalist?.Name || 'لا يوجد فائز';
      app.innerHTML = `
        <section class="screen-card final-screen">
          <div class="status-pill">نهاية اللعبة</div>
          <h2>النتيجة النهائية</h2>
          <div class="result-box">
            <p>${outcomeText}</p>
            <strong>${escapeHtml(outcomeName)}</strong>
          </div>
          <div class="footer-actions">
            <button class="game-btn" type="button" data-action="restart-game">ابدأ لعبة جديدة</button>
            <button class="secondary-btn" type="button" data-action="exit-to-menu">الخروج إلى القائمة</button>
          </div>
        </section>
      `;
      break;
      }
    default:
      buildMenuScreen();
      break;
  }
}

function handleGameAction(event) {
  const button = event.target instanceof Element ? event.target.closest('[data-action]') : null;
  if (!button) {
    return;
  }

  const { action, result, playerName, playerIndex } = button.dataset;

  switch (action) {
    case 'open-online':
      onlineMessage = '';
      showOnlineEntryScreen();
      break;
    case 'online-back-menu':
      onlineMessage = '';
      buildMenuScreen();
      break;
    case 'online-start':
      emitOnlineEvent('startGame');
      break;
    case 'online-send-question': {
      const question = document.getElementById('online-boss-question')?.value.trim() || '';
      emitOnlineEvent('submitBossQuestion', { question });
      break;
    }
    case 'online-send-trap': {
      const answer = document.getElementById('online-trap-answer')?.value.trim() || '';
      emitOnlineEvent('submitTrapAnswer', { answer });
      break;
    }
    case 'online-reveal':
      emitOnlineEvent('revealTrap');
      break;
    case 'online-finish-defense':
      primeOnlineAudio();
      emitOnlineEvent('finishDefenseTurn');
      break;
    case 'online-eliminate':
      emitOnlineEvent('eliminatePlayer', { playerId: button.dataset.playerId });
      break;
    case 'online-send-final-question': {
      const question = document.getElementById('online-final-question')?.value.trim() || '';
      emitOnlineEvent('submitFinalQuestion', { question });
      break;
    }
    case 'online-send-final-defense': {
      const defense = document.getElementById('online-final-defense')?.value.trim() || '';
      emitOnlineEvent('submitFinalDefense', { defense });
      break;
    }
    case 'online-final-decision':
      emitOnlineEvent('finalDecision', { decision: button.dataset.decision });
      break;
    case 'online-chat-toggle':
      onlineChatOpen = !onlineChatOpen;
      renderOnlineRoom();
      if (onlineChatOpen) document.querySelector('.online-chat-form input')?.focus();
      break;
    case 'online-chat-close':
      onlineChatOpen = false;
      renderOnlineRoom();
      break;
    case 'online-reaction':
      recordEmojiUsage(button.dataset.emoji);
      emitOnlineEvent('sendReaction', { emoji: button.dataset.emoji });
      break;
    case 'chat-emoji-toggle':
      emojiPickerOpen = !emojiPickerOpen;
      if (emojiPickerOpen) {
        stickerPickerOpen = false;
        document.querySelector('.chat-sticker-toggle')?.setAttribute('aria-expanded', 'false');
      }
      button.setAttribute('aria-expanded', String(emojiPickerOpen));
      renderEmojiPicker();
      renderStickerPicker();
      break;
    case 'emoji-sort':
      emojiSortMode = ['recent', 'popular'].includes(button.dataset.sort) ? button.dataset.sort : 'groups';
      renderEmojiPicker();
      break;
    case 'emoji-show-all':
      emojiShowAll = true;
      renderEmojiPicker();
      break;
    case 'chat-emoji-select': {
      const input = document.querySelector('.online-chat-form input');
      if (!input) break;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.setRangeText(button.dataset.emoji, start, end, 'end');
      recordEmojiUsage(button.dataset.emoji);
      input.focus();
      break;
    }
    case 'chat-sticker-toggle':
      stickerPickerOpen = !stickerPickerOpen;
      if (stickerPickerOpen) {
        emojiPickerOpen = false;
        document.querySelector('.chat-emoji-toggle')?.setAttribute('aria-expanded', 'false');
      }
      button.setAttribute('aria-expanded', String(stickerPickerOpen));
      renderEmojiPicker();
      renderStickerPicker();
      break;
    case 'chat-sticker-send': {
      const stickerToken = button.dataset.stickerToken;
      if (!stickerToken) break;
      emitOnlineEvent('sendChatMessage', { text: stickerToken });
      break;
    }
    case 'online-ptt':
      break;
    case 'online-copy-code':
      navigator.clipboard?.writeText(onlineState?.roomId || '').then(() => {
        onlineMessage = 'تم نسخ رمز الغرفة.';
        renderOnlineRoom();
      }).catch(() => {
        onlineMessage = 'تعذر نسخ الرمز تلقائياً. يمكنك نسخه يدوياً.';
        renderOnlineRoom();
      });
      break;
    case 'start-local-mode':
      onlineSession = null;
      onlineState = null;
      resetPlayers();
      buildSetupScreen();
      break;
    case 'add-player':
      syncPlayersFromInputs();
      if (!Array.isArray(localGameState.players)) {
        localGameState.players = [];
      }
      if (localGameState.players.length >= 8) {
        alert('يمكن إضافة ما يصل إلى 8 متقدمين كحد أقصى.');
        return;
      }
      localGameState.players.push(createPlayer());
      saveGameState();
      buildSetupScreen();
      break;
    case 'remove-player':
      syncPlayersFromInputs();
      if (localGameState.players.length <= 2) {
        return;
      }
      if (!Number.isInteger(Number(playerIndex)) || Number(playerIndex) < 0 || Number(playerIndex) >= localGameState.players.length) {
        return;
      }
      localGameState.players.splice(Number(playerIndex), 1);
      saveGameState();
      buildSetupScreen();
      break;
    case 'start-game':
      beginGameFlow();
      break;
    case 'save-boss-question':
      saveBossQuestion();
      break;
    case 'ready-handoff':
      handleReadyHandoff();
      break;
    case 'save-trap-answer':
      handleTrapSave();
      break;
    case 'flip-card': {
      const activePlayer = getCurrentDefensePlayer();
      if (activePlayer) {
        activePlayer.cardRevealed = true;
        saveGameState();
      }
      buildDefenseScreen();
      break;
    }
    case 'finish-defense':
      advanceDefense();
      break;
    case 'eliminate-player':
      evaluateElimination(playerName);
      break;
    case 'save-final-question':
      saveFinalQuestion();
      break;
    case 'submit-final-defense':
      submitFinalDefense();
      break;
    case 'final-decision':
      finalizeDecision(result);
      break;
    case 'restart-game':
      requestRestartConfirmation();
      break;
    case 'exit-to-menu':
      requestExitConfirmation();
      break;
    default:
      break;
  }
}

function handleOnlineForm(event) {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (!form) return;
  event.preventDefault();

  if (form.dataset.onlineForm === 'chat') {
    const input = form.elements.namedItem('message');
    const text = input?.value.trim() || '';
    emitOnlineEvent('sendChatMessage', { text }).then((sent) => {
      if (sent && input) input.value = '';
    });
    return;
  }

  if (form.dataset.onlineForm === 'create') {
    const name = document.getElementById('online-boss-name')?.value.trim() || '';
    emitEntryEvent('createRoom', { name });
    return;
  }

  if (form.dataset.onlineForm === 'join') {
    const roomId = document.getElementById('online-room-code')?.value.trim().toUpperCase() || '';
    const name = document.getElementById('online-player-name')?.value.trim() || '';
    emitEntryEvent('joinRoom', { roomId, name });
  }
}

let onlineReconnectInProgress = false;

function reconnectOnlineSession() {
  if (!onlineSession || onlineReconnectInProgress) return;
  onlineReconnectInProgress = true;
  onlineConnectionStatus = 'reconnecting';
  socket.emit('reconnectRoom', onlineSession, (response) => {
    onlineReconnectInProgress = false;
    if (response?.ok) {
      onlineConnectionStatus = 'connected';
      saveOnlineSession({ ...onlineSession, role: response.role, name: response.name });
      onlineState = response.state;
      onlineMessage = '';
      renderOnlineRoom();
    } else {
      localStorage.removeItem(ONLINE_SESSION_KEY);
      onlineSession = null;
      onlineState = null;
      onlineMessage = response?.error || 'تعذرت استعادة الغرفة.';
      showOnlineEntryScreen();
    }
  });
}

socket.on('welcome', (payload) => {
  console.log(payload.text);
});

socket.on('connect', () => {
  onlineConnectionStatus = 'connected';
  reconnectOnlineSession();
});

socket.on('disconnect', () => {
  onlineConnectionStatus = 'disconnected';
  onlineVoiceSpeakers.clear();
  onlineSpeakingSent = false;
  updateVoiceSpeakerIndicators();
  voiceConnections.forEach((peer, peerSocketId) => closeVoiceConnection(peerSocketId, peer));
  stopPushToTalk();
  if (onlineSession && onlineState) renderOnlineRoom();
});

socket.on('roomState', (state) => {
  if (!onlineSession || state.roomId !== onlineSession.roomId) return;
  if (onlineState && onlineState.round !== state.round) onlineEliminationResult = null;
  if (state.status === 'FINAL_CHALLENGE' && state.finalStage === 'COMPLETE' && onlineState?.finalStage !== 'COMPLETE') {
    playOnlineOutcome(state.finalDecision);
  }
  onlineState = state;
  onlineVoiceSpeakers = new Map((state.voiceSpeakers || []).map((speaker) => [speaker.socketId, speaker]));
  onlineConnectionStatus = 'connected';
  renderOnlineRoom();
});

socket.on('roomError', (payload) => {
  if (onlineSession) {
    onlineMessage = payload?.error || 'حدث خطأ في الغرفة.';
    renderOnlineRoom();
  } else {
    setOnlineMessage(payload?.error || 'حدث خطأ في الغرفة.');
  }
});

socket.on('trapRevealed', (payload) => {
  if (!onlineState || !onlineSession || payload.playerId !== onlineState.currentSpeaker?.id) return;
  onlineState = { ...onlineState, trapRevealed: true, revealedTrap: payload.answer };
  renderOnlineRoom();
});

socket.on('eliminationResult', (payload) => {
  onlineEliminationResult = payload;
  if (onlineState) renderOnlineRoom();
});

socket.on('chatMessage', (message) => {
  if (!onlineSession || !onlineState) return;
  if (!onlineChatMessages.some((entry) => entry.id === message.id)) onlineChatMessages.push(message);
  onlineChatMessages = onlineChatMessages.slice(-50);
  onlineState.chatMessages = onlineChatMessages;
  const list = document.querySelector('.online-chat-messages');
  if (list) {
    list.insertAdjacentHTML('beforeend', chatMessageMarkup(message));
    while (list.children.length > 50) list.firstElementChild.remove();
    list.scrollTop = list.scrollHeight;
  }
  const count = document.querySelector('.chat-count');
  if (count) count.textContent = String(onlineChatMessages.length);
});

socket.on('reaction', (payload) => {
  if (!onlineSession || !onlineState || onlineState.status !== 'DEFENSE') return;
  const layer = document.querySelector('.online-reaction-layer');
  if (!layer) return;
  const item = document.createElement('div');
  item.className = 'floating-reaction';
  item.innerHTML = `<span>${escapeHtml(payload.emoji)}</span><small>${escapeHtml(payload.name)}</small>`;
  layer.appendChild(item);
  window.setTimeout(() => item.remove(), 2600);
});

socket.on('voiceSignal', async ({ from, signal } = {}) => {
  const peer = voiceConnections.get(from);
  if (!peer || !signal) return;
  const connection = peer.connection;
  try {
    if (signal.type === 'description') {
      const description = signal.description;
      const readyForOffer = !peer.makingOffer
        && (connection.signalingState === 'stable' || peer.settingRemoteAnswer);
      const offerCollision = description.type === 'offer' && !readyForOffer;
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;
      if (offerCollision && peer.polite) await connection.setLocalDescription({ type: 'rollback' });
      peer.settingRemoteAnswer = description.type === 'answer';
      await connection.setRemoteDescription(description);
      peer.settingRemoteAnswer = false;
      for (const candidate of peer.pendingCandidates.splice(0)) {
        await connection.addIceCandidate(candidate);
      }
      if (description.type === 'offer') {
        await connection.setLocalDescription();
        sendVoiceSignal(from, { type: 'description', description: connection.localDescription.toJSON() });
      }
    } else if (signal.type === 'candidate' && signal.candidate) {
      if (!connection.remoteDescription) {
        peer.pendingCandidates.push(signal.candidate);
        return;
      }
      try {
        await connection.addIceCandidate(signal.candidate);
      } catch (error) {
        if (!peer.ignoreOffer) throw error;
      }
    }
  } catch (error) {
    console.warn('Unable to apply the voice signal:', error);
  }
});

socket.on('voiceSpeaking', (payload = {}) => {
  if (!onlineSession || !payload.socketId) return;
  if (payload.active) onlineVoiceSpeakers.set(payload.socketId, payload);
  else onlineVoiceSpeakers.delete(payload.socketId);
  updateVoiceSpeakerIndicators();
});

app.addEventListener('click', handleGameAction);
app.addEventListener('submit', handleOnlineForm);
app.addEventListener('change', (event) => {
  const select = event.target instanceof HTMLSelectElement ? event.target : null;
  if (!select || select.dataset.action !== 'emoji-category') return;
  emojiSelectedGroup = select.value;
  emojiShowAll = false;
  renderEmojiPicker();
});
document.addEventListener('pointerdown', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-action="online-ptt"]') : null;
  if (!button) return;
  event.preventDefault();
  startPushToTalk();
});
document.addEventListener('pointerup', stopPushToTalk);
document.addEventListener('pointercancel', stopPushToTalk);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPushToTalk();
});
window.addEventListener('blur', stopPushToTalk);
document.addEventListener('click', (event) => {
  const topAction = event.target.closest('[data-top-action]');
  if (!topAction) {
    return;
  }

  handleTopBarAction(topAction.dataset.topAction);
});

renderTopBarActions();
loadEmojiCatalog();
if (onlineSession) {
  showOnlineEntryScreen();
  reconnectOnlineSession();
} else {
  restoreGameSession();
}
