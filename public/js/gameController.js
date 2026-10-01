import { createAudioManager } from './modules/audioManager.js';
import {
  chatMessageMarkup as renderChatMessageMarkup,
  sortedEmojiCatalog as sortEmojiCatalog,
  emojiPickerMarkup,
  stickerPickerMarkup
} from './modules/chatUI.js';
import { createUI, escapeHtml } from './modules/ui.js';
import { createVoiceChat } from './modules/voiceChat.js';

const socket = window.AtqadamCommunication.createSocket();
const app = document.getElementById('app');
const ui = createUI(app);
const topBarActions = document.getElementById('top-bar-actions');
const ONLINE_SESSION_KEY = 'atqadam-online-session-v1';
const EMOJI_USAGE_KEY = window.AtqadamEmojiCatalog.STORAGE_KEY;
const SETTINGS_STORAGE_KEY = 'atqadam-settings-v1';
const DEFAULT_SETTINGS = { theme: 'mint', voiceMode: 'push-to-talk', soundEnabled: true };

let userSettings = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    return {
      theme: ['mint', 'night', 'sunset'].includes(stored.theme) ? stored.theme : DEFAULT_SETTINGS.theme,
      voiceMode: ['push-to-talk', 'toggle'].includes(stored.voiceMode) ? stored.voiceMode : DEFAULT_SETTINGS.voiceMode,
      soundEnabled: typeof stored.soundEnabled === 'boolean' ? stored.soundEnabled : DEFAULT_SETTINGS.soundEnabled
    };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
})();
const audioManager = createAudioManager(() => userSettings.soundEnabled);

let onlineSession = null;
let onlineState = null;
let onlineMessage = '';
let onlineEliminationResult = null;
let onlineEliminationSpin = null;
let onlineEliminationSpinTimer = null;
let onlineEliminationSoundTimer = null;
let onlineEliminationRevealTimer = null;
let onlineEliminationNameTimer = null;
let onlineCountdownTimer = null;
let onlineConnectionStatus = 'connected';
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
let onlineManagerVotePromptedAt = null;
let openPlayerMenuId = null;
const voiceChat = createVoiceChat({
  socket,
  getState: () => onlineState,
  getSession: () => onlineSession,
  getConnectionStatus: () => onlineConnectionStatus,
  setMessage: setOnlineMessage,
  getButtonLabel: getVoiceButtonLabel
});

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

function getThemeLogoPath() {
  return userSettings.theme === 'sunset' ? '/img/sunsit_logo.png' : '/img/logo.png';
}

function saveUserSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(userSettings));
  } catch (error) {
    console.warn('Unable to save settings:', error);
  }
  document.documentElement.dataset.theme = userSettings.theme;
  const logo = document.querySelector('.hero-logo img');
  if (logo) logo.src = getThemeLogoPath();
}

function openSettingsDialog() {
  document.getElementById('settings-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'settings-modal';
  modal.className = 'confirm-modal settings-modal';
  modal.innerHTML = `
    <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="settings-header"><h2 id="settings-title">الإعدادات</h2><button type="button" data-settings-close aria-label="إغلاق الإعدادات">×</button></header>
      <div class="settings-fields">
        <fieldset class="settings-choice-group theme-choice-group">
          <legend>ثيم الموقع</legend>
          <div class="theme-options">
            <label class="theme-option" data-theme-choice="mint">
              <input type="radio" name="setting-theme" data-setting="theme" value="mint" ${userSettings.theme === 'mint' ? 'checked' : ''}>
              <span class="theme-preview theme-preview-mint" aria-hidden="true"><i></i><b></b><em></em></span>
              <strong>الأساسي</strong><small>ألوان اللعبة المشرقة ولمساتها المرحة</small>
            </label>
            <label class="theme-option" data-theme-choice="night">
              <input type="radio" name="setting-theme" data-setting="theme" value="night" ${userSettings.theme === 'night' ? 'checked' : ''}>
              <span class="theme-preview theme-preview-night" aria-hidden="true"><i></i><b></b><em></em></span>
              <strong>ليلي</strong><small>ألوان داكنة مريحة مع هوية اللعبة</small>
            </label>
            <label class="theme-option" data-theme-choice="sunset">
              <input type="radio" name="setting-theme" data-setting="theme" value="sunset" ${userSettings.theme === 'sunset' ? 'checked' : ''}>
              <span class="theme-preview theme-preview-sunset" aria-hidden="true"><i></i><b></b><em></em></span>
              <strong>غروب</strong><small>درجات دافئة مستوحاة من ألوان الغروب</small>
            </label>
          </div>
        </fieldset>
        <fieldset class="settings-choice-group">
          <legend>طريقة التحدث</legend>
          <label class="settings-option">
            <input type="radio" name="setting-voice-mode" data-setting="voiceMode" value="push-to-talk" ${userSettings.voiceMode === 'push-to-talk' ? 'checked' : ''}>
            <span><strong>اضغط باستمرار للتحدث</strong><small>يعمل الميكروفون أثناء الضغط فقط</small></span>
          </label>
          <label class="settings-option">
            <input type="radio" name="setting-voice-mode" data-setting="voiceMode" value="toggle" ${userSettings.voiceMode === 'toggle' ? 'checked' : ''}>
            <span><strong>تشغيل وإيقاف بالنقر</strong><small>انقر مرة للتشغيل ومرة أخرى للإيقاف</small></span>
          </label>
        </fieldset>
        <label class="settings-toggle" for="setting-sound"><span>الأصوات والمؤثرات</span><input id="setting-sound" type="checkbox" data-setting="soundEnabled" ${userSettings.soundEnabled ? 'checked' : ''}></label>
      </div>
      <button class="game-btn settings-done" type="button" data-settings-close>تم</button>
    </section>
  `;
  document.body.appendChild(modal);
  modal.querySelector('[data-settings-close]').focus();
}

function renderTopBarActions() {
  if (!topBarActions) {
    return;
  }

  topBarActions.innerHTML = `
    <button class="top-bar-btn settings-trigger" type="button" data-top-action="settings" aria-label="الإعدادات">⚙ <span>الإعدادات</span></button>
    ${onlineSession && onlineState
      ? '<button class="top-bar-btn" type="button" data-top-action="leave-online">مغادرة الغرفة</button>'
      : '<button class="top-bar-btn secondary" type="button" data-top-action="restart-game" data-game-top-action>إعادة اللعبة</button><button class="top-bar-btn" type="button" data-top-action="exit-to-menu" data-game-top-action>الخروج</button>'}
  `;

  syncTopBarVisibility();
}

function syncTopBarVisibility() {
  if (!topBarActions) {
    return;
  }

  topBarActions.hidden = false;
  const showGameActions = document.body.classList.contains('game-started');
  topBarActions.querySelectorAll('[data-game-top-action]').forEach((button) => {
    button.hidden = !showGameActions;
  });
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

function requestLeaveOnlineConfirmation() {
  showConfirmDialog({
    title: 'مغادرة الغرفة',
    message: 'هل أنت متأكد أنك تريد مغادرة الغرفة؟ ستحتاج إلى رمز الغرفة للعودة لاحقاً.',
    confirmText: 'نعم، غادر الغرفة',
    onConfirm: () => leaveOnlineRoom()
  });
}

function requestManagerTransferConfirmation(playerId, playerName) {
  showConfirmDialog({
    title: 'تسليم الإدارة',
    message: `هل أنت متأكد أنك تريد تسليم إدارة الغرفة إلى ${playerName}؟ ستعود لاعباً داخل الغرفة.`,
    confirmText: 'نعم، سلّم الإدارة',
    onConfirm: () => emitOnlineEvent('transferManager', { playerId })
  });
}

function requestKickConfirmation(playerId, playerName, permanent = false) {
  showConfirmDialog({
    title: permanent ? 'منع اللاعب' : 'طرد اللاعب',
    message: permanent
      ? `هل أنت متأكد من منع ${playerName} من هذه الغرفة؟ لن يتمكن من العودة إليها حتى تتغير الغرفة.`
      : `هل أنت متأكد من طرد ${playerName} مؤقتاً؟ يمكنه العودة باستخدام رمز الغرفة نفسه.`,
    confirmText: permanent ? 'نعم، امنعه' : 'نعم، اطرده',
    onConfirm: () => emitOnlineEvent(permanent ? 'banPlayer' : 'kickPlayer', { playerId })
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
  stopEliminationSpin();
  if (onlineEliminationRevealTimer) {
    clearTimeout(onlineEliminationRevealTimer);
    onlineEliminationRevealTimer = null;
  }
  if (onlineEliminationNameTimer) {
    clearTimeout(onlineEliminationNameTimer);
    onlineEliminationNameTimer = null;
  }
}

const playOnlineOutcome = (decision) => audioManager.playOutcome(decision);
const primeOnlineAudio = () => audioManager.prime();
const playDefenseCountdownTick = () => audioManager.playDefenseCountdownTick();
const playEliminationSpinTick = (progress = 0.5) => audioManager.playEliminationSpinTick(progress);

function stopEliminationSpin() {
  if (onlineEliminationSpinTimer) {
    clearInterval(onlineEliminationSpinTimer);
    onlineEliminationSpinTimer = null;
  }
  if (onlineEliminationSoundTimer) {
    clearTimeout(onlineEliminationSoundTimer);
    onlineEliminationSoundTimer = null;
  }
}

function buildEliminationWheelSvg(candidates, selectedId = '') {
  const center = 180;
  const radius = 166;
  const labelRadius = 104;
  const segmentCount = Math.max(candidates.length, 1);
  const segmentAngle = 360 / segmentCount;
  const colors = ['#11D2AD', '#8B45DB', '#FFD166', '#FF8A65', '#54A0FF', '#FF6B9D'];
  const point = (angle, distance) => {
    const radians = (angle - 90) * Math.PI / 180;
    return { x: center + Math.cos(radians) * distance, y: center + Math.sin(radians) * distance };
  };
  const segments = candidates.map((candidate, index) => {
    const startAngle = index * segmentAngle;
    const endAngle = startAngle + segmentAngle;
    const start = point(startAngle, radius);
    const end = point(endAngle, radius);
    const label = point(startAngle + segmentAngle / 2, labelRadius);
    const largeArc = segmentAngle > 180 ? 1 : 0;
    const fontSize = Math.max(10, Math.min(16, 150 / Math.max(candidate.name.length, 8)));
    return `<path class="wheel-sector${candidate.id === selectedId ? ' selected' : ''}" d="M ${center} ${center} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z" fill="${colors[index % colors.length]}"/><text class="wheel-sector-label${candidate.id === selectedId ? ' selected' : ''}" x="${label.x}" y="${label.y}" font-size="${fontSize}">${escapeHtml(candidate.name)}</text>`;
  }).join('');
  return `<svg class="elimination-wheel-svg" viewBox="0 0 360 360" role="img" aria-label="عجلة أسماء اللاعبين"><circle class="wheel-rim" cx="180" cy="180" r="169"/>${segments}<circle class="wheel-center" cx="180" cy="180" r="42"/><text class="wheel-center-label" x="180" y="184">الحظ</text></svg>`;
}

function startEliminationSpin(spin) {
  stopEliminationSpin();
  onlineEliminationSpin = spin;
  const endsAt = spin.endsAt || Date.now() + 8000;
  const scheduleSound = () => {
    const remaining = endsAt - (Date.now() + onlineServerOffset);
    if (remaining <= 0) {
      onlineEliminationSoundTimer = null;
      return;
    }
    const duration = Math.max(spin.duration || 8000, 1);
    const progress = Math.min(1, Math.max(0, 1 - remaining / duration));
    playEliminationSpinTick(progress);
    const delay = progress < 0.15 ? 310 : progress < 0.65 ? 95 : 270;
    onlineEliminationSoundTimer = setTimeout(scheduleSound, Math.min(delay, remaining));
  };
  const update = () => {
    const countdownElement = document.querySelector('[data-elimination-countdown]');
    if (countdownElement) {
      countdownElement.textContent = String(Math.max(0, Math.ceil((endsAt - (Date.now() + onlineServerOffset)) / 1000)));
    }
    if (Date.now() + onlineServerOffset >= endsAt) {
      clearInterval(onlineEliminationSpinTimer);
      onlineEliminationSpinTimer = null;
    }
  };
  onlineEliminationSpinTimer = setInterval(update, 180);
  scheduleSound();
  renderOnlineRoom();
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
  renderTopBarActions();
  ui.render(`
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
      ${onlineSession ? `<div class="saved-room-return"><strong>لديك غرفة محفوظة</strong><span>${escapeHtml(onlineSession.name || 'اللاعب')} في الغرفة ${escapeHtml(onlineSession.roomId || '')}</span><button class="game-btn" type="button" data-action="online-reconnect-now">العودة إلى آخر غرفة</button></div>` : ''}
      <div class="footer-actions"><button class="secondary-btn" type="button" data-action="online-back-menu">العودة</button></div>
    </section>
  `);
}

function onlinePlayerList(players, allowElimination = false, allowManagerTransfer = false, allowLobbyModeration = false) {
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
      ${allowLobbyModeration && player.isConnected
        ? `<span class="lobby-player-actions"><button class="player-menu-toggle" type="button" data-action="online-player-menu-toggle" data-player-id="${escapeHtml(player.id)}" aria-label="خيارات ${escapeHtml(player.name)}" aria-expanded="${openPlayerMenuId === player.id}">•••</button><span class="player-menu${openPlayerMenuId === player.id ? ' is-open' : ''}"><button class="mini-btn" type="button" data-action="online-transfer-manager" data-player-id="${escapeHtml(player.id)}" data-player-name="${escapeHtml(player.name)}">تسليم الإدارة</button><button class="mini-btn" type="button" data-action="online-kick-player" data-player-id="${escapeHtml(player.id)}" data-player-name="${escapeHtml(player.name)}">طرد</button><button class="mini-btn danger" type="button" data-action="online-ban-player" data-player-id="${escapeHtml(player.id)}" data-player-name="${escapeHtml(player.name)}">منع</button></span></span>`
        : allowManagerTransfer && player.isConnected
        ? `<button class="mini-btn" type="button" data-action="online-transfer-manager" data-player-id="${escapeHtml(player.id)}" data-player-name="${escapeHtml(player.name)}">تسليم الإدارة</button>`
        : allowElimination && !player.isEliminated
        ? `<button class="mini-btn" type="button" data-action="online-eliminate" data-player-id="${escapeHtml(player.id)}">استبعاد</button>`
        : `<span class="online-player-status">${player.hasSubmittedTrap ? 'أرسل الإجابة' : (player.isEliminated ? 'مخرب' : 'في الانتظار')}</span>`}
    </div>`;
  }).join('')}</div>`;
}

function onlineHeader(state) {
  const connection = onlineConnectionStatus === 'connected' ? 'متصل بالخادم' : 'جارٍ استعادة الاتصال';
  return `<div class="player-meta">
    <span class="status-pill">المدير: ${escapeHtml(state.bossName)}</span>
    <span class="online-connection ${onlineConnectionStatus}">${connection}</span>
    ${state.role !== 'boss' ? `<span class="online-manager-presence ${state.bossConnected ? 'connected' : 'disconnected'}">المدير: ${state.bossConnected ? 'متصل' : 'انقطع الاتصال'}</span>` : ''}
  </div>`;
}

function managerRecoveryMarkup(state) {
  const canVote = Number.isFinite(state.managerVoteAvailableAt)
    && Date.now() + onlineServerOffset >= state.managerVoteAvailableAt;
  if (state.managerVote?.active) {
    return `<div class="manager-recovery-panel"><strong>تصويت اختيار مدير جديد</strong>${state.managerVote.candidates.map((candidate) => `<button class="secondary-btn" type="button" data-action="online-cast-manager-vote" data-player-id="${escapeHtml(candidate.id)}">التصويت لـ ${escapeHtml(candidate.name)} (${state.managerVote.counts?.[candidate.id] || 0})</button>`).join('')}</div>`;
  }
  return `<div class="manager-recovery-panel"><strong>${state.status === 'MANAGER_PAUSED' ? 'اللعبة متوقفة مؤقتاً بانتظار عودة المدير' : 'بانتظار عودة المدير إلى الغرفة'}</strong><span class="manager-recovery-countdown">المهلة المتبقية: <b data-manager-countdown>--</b> ثانية</span>${canVote
    ? '<button class="secondary-btn" type="button" data-action="online-start-manager-vote">بدء التصويت لتغيير المدير</button>'
    : '<span>سيظهر خيار التصويت بعد انتهاء مهلة الانتظار.</span>'}</div>`;
}

function chatMessageMarkup(message) {
  return renderChatMessageMarkup(message, stickerCatalog, escapeHtml);
}

function sortedEmojiCatalog() {
  return sortEmojiCatalog({
    emojiCatalog,
    emojiSelectedGroup,
    emojiSortMode,
    recentEmojis,
    emojiUsage
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

  picker.innerHTML = emojiPickerMarkup({
    emojiCatalog,
    emojiSelectedGroup,
    emojiSortMode,
    recentEmojis,
    emojiUsage,
    emojiShowAll,
    escapeHtml
  });
}

function renderStickerPicker() {
  const picker = document.querySelector('[data-sticker-picker]');
  if (!picker) return;
  picker.hidden = !stickerPickerOpen;
  if (!stickerPickerOpen) return;
  picker.innerHTML = stickerPickerMarkup(stickerCatalog, escapeHtml);
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
  const isVoicePressed = voiceChat.isPressed();
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
        ? `<button class="push-to-talk${isVoicePressed ? ' is-pressed' : ''}" type="button" data-action="online-ptt" aria-pressed="${isVoicePressed}">${getVoiceButtonLabel()}</button>`
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

function getVoiceButtonLabel(active = voiceChat.isPressed()) {
  if (active) return 'تتحدث الآن...';
  return userSettings.voiceMode === 'toggle' ? 'تشغيل الميكروفون' : 'اضغط للتحدث';
}

function renderOnlineRoom() {
  if (!onlineSession || !onlineState) return;
  if (Number.isFinite(onlineState.serverNow)) {
    onlineServerOffset = onlineState.serverNow - Date.now();
  }
  clearOnlineCountdown();
  document.body.classList.add('game-started');
  if (!topBarActions.querySelector('[data-top-action="leave-online"]')) {
    renderTopBarActions();
  }

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
      ${onlinePlayerList(state.players, false, isBoss, isBoss)}
      ${isBoss
        ? `<button class="game-btn" type="button" data-action="online-start" ${connectedCount < 2 ? 'disabled' : ''}>ابدأ المقابلة (${connectedCount} متصل)</button>
          `
        : state.managerAway ? managerRecoveryMarkup(state) : '<div class="online-waiting">بانتظار المدير لبدء المقابلة</div>'}`;
  } else if (state.status === 'MANAGER_PAUSED') {
    screen = `${onlineHeader(state)}<span class="status-pill">توقف مؤقت</span>
      <h2>بانتظار عودة المدير</h2>
      <div class="manager-waiting-countdown"><span data-manager-countdown>30</span><small>ثانية قبل العودة إلى غرفة الانتظار</small></div>
      ${managerRecoveryMarkup(state)}`;
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
    const spinCandidates = onlineEliminationSpin?.candidates || state.eliminationCandidates || [];
    const isWheelReveal = Boolean(onlineEliminationSpin?.revealUntil && onlineEliminationSpin.revealUntil > Date.now());
    const showWheel = state.eliminationPending || isWheelReveal;
    const showResultName = Boolean(isWheelReveal && onlineEliminationSpin?.revealNameAt && onlineEliminationSpin.revealNameAt <= Date.now());
    const segmentCount = Math.max(spinCandidates.length, 1);
    const selectedIndex = spinCandidates.findIndex((candidate) => candidate.id === onlineEliminationSpin?.selectedId);
    const finalWheelRotation = selectedIndex >= 0 ? 1080 - (selectedIndex * (360 / segmentCount)) : 0;
    const spinBanner = showWheel
      ? `<div class="elimination-spin-panel"><div class="elimination-wheel${isWheelReveal ? ' is-revealed' : ''}" style="--wheel-duration: ${Math.max(3, ((onlineEliminationSpin?.endsAt || state.eliminationEndsAt || Date.now() + 8000) - (Date.now() + onlineServerOffset)) / 1000)}s; --wheel-final-rotation: ${finalWheelRotation}deg"><div class="wheel-pointer"></div>${buildEliminationWheelSvg(spinCandidates, onlineEliminationSpin?.selectedId)}${showResultName ? `<strong class="elimination-name-reveal">${escapeHtml(onlineEliminationResult?.eliminatedPlayerName || 'الاسم المختار')}</strong>` : ''}</div></div>`
      : '';
    const resultBanner = eliminated
      && !isWheelReveal
      ? `<div class="elimination-result"><div class="dramatic-card eliminated"><span>تم الاستبعاد</span><strong>${escapeHtml(eliminated)}</strong></div><div class="dramatic-card survivor"><span>الناجون</span><strong>${state.players.filter((player) => !player.isEliminated).map((player) => escapeHtml(player.name)).join('، ') || '—'}</strong></div></div>`
      : '';
    screen = `${onlineHeader(state)}<h2>${isBoss && !state.eliminationPending && !eliminated && !isWheelReveal ? 'اختر المتقدم المستبعد' : 'قرار الاستبعاد'}</h2>${spinBanner}${resultBanner}
      ${isBoss && !state.eliminationPending && !eliminated && !isWheelReveal ? onlinePlayerList(state.players, true) : '<div class="online-waiting">سيبدأ المدير الجولة التالية بعد إعلان النتيجة</div>'}`;
  } else if (state.status === 'FINAL_CHALLENGE') {
    const finalist = state.finalist || state.players.find((player) => !player.isEliminated);
    const managerEndActions = state.finalStage === 'COMPLETE'
      ? state.managerVote?.active
        ? `<div class="manager-vote-panel"><strong>تصويت اختيار المدير الجديد</strong>${state.managerVote.candidates.map((candidate) => `<button class="secondary-btn" type="button" data-action="online-cast-manager-vote" data-player-id="${escapeHtml(candidate.id)}">التصويت لـ ${escapeHtml(candidate.name)} (${state.managerVote.counts?.[candidate.id] || 0})</button>`).join('')}</div>`
        : `<div class="manager-restart-actions"><button class="game-btn" type="button" data-action="online-restart-same" ${isBoss ? '' : 'disabled'}>إعادة اللعب بالمدير نفسه</button><button class="secondary-btn" type="button" data-action="online-start-manager-vote">التصويت لمدير جديد</button></div>`
      : '';
    const finalAction = state.finalStage === 'DECISION' && isBoss
      ? `<div class="info-box"><p>سؤال الجولة الأخيرة</p><strong>${escapeHtml(state.finalQuestion || state.currentQuestion)}</strong></div><div class="result-box"><p>الناجي الأخير من جولات التبرير</p><strong>${escapeHtml(finalist?.name || '—')}</strong><p class="final-decision-prompt">هل فاز المتقدم الأخير أم يُستبعد مع الباقين؟</p></div><div class="footer-actions"><button class="game-btn" type="button" data-action="online-final-decision" data-decision="accept">إعلان فوزه</button><button class="secondary-btn" type="button" data-action="online-final-decision" data-decision="reject">استبعاده مع الباقين</button></div>`
          : state.finalStage === 'DECISION'
            ? `<div class="info-box"><p>سؤال الجولة الأخيرة</p><strong>${escapeHtml(state.finalQuestion || state.currentQuestion)}</strong></div><div class="online-waiting">المدير يقرر الآن إن كان ${escapeHtml(finalist?.name || 'المتقدم الأخير')} قد فاز أم سيُستبعد مع الباقين</div>`
          : state.finalStage === 'COMPLETE'
            ? finalist
              ? `<div class="victory-panel ${state.finalDecision === 'accept' ? 'accepted' : 'rejected'}"><span>${state.finalDecision === 'accept' ? 'فاز باللعبة' : 'استُبعد مع الباقين'}</span><strong>${escapeHtml(finalist.name)}</strong></div>${managerEndActions}`
              : `<div class="victory-panel rejected"><span>تم استبعاد جميع المتقدمين</span><strong>لا يوجد فائز</strong></div>${managerEndActions}`
            : '<div class="online-waiting">بانتظار قرار الجولة الأخيرة</div>';
    screen = `${onlineHeader(state)}<span class="status-pill">حسم الجولة الأخيرة</span><h2>الناجي الأخير: ${escapeHtml(finalist?.name || 'لا يوجد لاعب باقٍ')}</h2>${finalAction}`;
  }

  ui.render(`<section class="screen-card online-room-screen${isNewDefenseSpeaker ? ' is-new-defense-speaker' : ''}${state.status === 'DEFENSE_ENDING' ? ' is-defense-ending' : ''}">${screen}<div id="online-message" class="online-message" ${onlineMessage ? '' : 'hidden'}>${escapeHtml(onlineMessage)}</div>${onlineSocialTools(state)}</section>`);
  renderEmojiPicker();
  renderStickerPicker();
  voiceChat.sync(state);
  if (state.status === 'DEFENSE_ENDING') {
    startOnlineCountdown(state.defenseEndsAt, '[data-defense-ending-countdown]', true);
  } else if (state.managerAway && state.managerResumeDeadline) {
    startOnlineCountdown(state.managerResumeDeadline, '[data-manager-countdown]');
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
    if (selector === '[data-manager-countdown]'
      && onlineState?.managerVoteAvailableAt
      && Date.now() + onlineServerOffset >= onlineState.managerVoteAvailableAt
      && !onlineState.managerVote
      && onlineManagerVotePromptedAt !== onlineState.managerVoteAvailableAt) {
      onlineManagerVotePromptedAt = onlineState.managerVoteAvailableAt;
      clearOnlineCountdown();
      renderOnlineRoom();
      return;
    }
    if (withSound && count > 0 && count !== previousCount) playDefenseCountdownTick();
    previousCount = count;
  };
  updateCountdown();
  onlineCountdownTimer = setInterval(updateCountdown, 250);
}

function leaveOnlineRoom() {
  emitOnlineEvent('leaveRoom').finally(() => {
    voiceChat.closeAll();
    onlineState = null;
    onlineEliminationResult = null;
    onlineMessage = 'غادرت الغرفة. يمكنك العودة إليها من الزر الموجود أدناه.';
    clearOnlineCountdown();
    document.body.classList.remove('game-started');
    showOnlineEntryScreen();
  });
}

function buildMenuScreen() {
  clearTimer();
  clearOnlineCountdown();
  localGameState.phase = 'menu';
  document.body.classList.remove('game-started');
  syncTopBarVisibility();
  saveGameState();
  ui.render(`
    <section class="screen-card hero-card">
      <div class="title-wrap">
        <div class="hero-logo" aria-label="شعار لعبة أتقدم للوظيفة">
          <img src="${getThemeLogoPath()}" alt="شعار أتقدم للوظيفة" />
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
  `);
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

  ui.render(`
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
  `);
}

function buildBossQuestionScreen() {
  localGameState.phase = 'boss-question';
  saveGameState();

  ui.render(`
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
  `);
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

  ui.render(`
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
  `);
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

  ui.render(`
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
  `);
}

function buildDefenseScreen() {
  const currentPlayer = getCurrentDefensePlayer();
  if (!currentPlayer) {
    buildBossEliminationScreen();
    return;
  }

  localGameState.phase = 'defense';
  saveGameState();

  ui.render(`
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
  `);

  const countdownValue = document.getElementById('countdown-value');
  if (countdownValue) {
    countdownValue.textContent = localGameState.countdown;
  }
}

function buildBossEliminationScreen() {
  const activePlayers = getActivePlayers();
  localGameState.phase = 'elimination';
  saveGameState();

  ui.render(`
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
  `);
}

function buildFinalChallengeScreen() {
  const finalist = getActivePlayers()[0];
  localGameState.phase = 'final';
  saveGameState();

  ui.render(`
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
  `);
}

function buildFinalDefenseScreen() {
  const finalist = getActivePlayers()[0];
  localGameState.phase = 'final-defense';
  saveGameState();

  ui.render(`
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
  `);
}

function buildBossDecisionScreen() {
  localGameState.phase = 'decision';
  saveGameState();
  const finalist = getActivePlayers()[0];

  ui.render(`
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
  `);
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

  ui.render(`
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
  `);
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
    case 'settings':
      openSettingsDialog();
      break;
    case 'restart-game':
      requestRestartConfirmation();
      break;
    case 'exit-to-menu':
      requestExitConfirmation();
      break;
    case 'leave-online':
      requestLeaveOnlineConfirmation();
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
      ui.render(`
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
      `);
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
    case 'online-ptt':
      if (userSettings.voiceMode === 'toggle') {
        if (voiceChat.isPressed()) voiceChat.stop();
        else voiceChat.start();
      }
      break;
    case 'open-online':
      onlineMessage = '';
      showOnlineEntryScreen();
      break;
    case 'online-back-menu':
      onlineMessage = '';
      buildMenuScreen();
      break;
    case 'online-reconnect-now':
      reconnectOnlineSession();
      break;
    case 'online-start':
      emitOnlineEvent('startGame');
      break;
    case 'online-transfer-manager':
      openPlayerMenuId = null;
      requestManagerTransferConfirmation(button.dataset.playerId, button.dataset.playerName || 'اللاعب المحدد');
      break;
    case 'online-kick-player':
      openPlayerMenuId = null;
      requestKickConfirmation(button.dataset.playerId, button.dataset.playerName || 'اللاعب المحدد');
      break;
    case 'online-ban-player':
      openPlayerMenuId = null;
      requestKickConfirmation(button.dataset.playerId, button.dataset.playerName || 'اللاعب المحدد', true);
      break;
    case 'online-player-menu-toggle':
      openPlayerMenuId = openPlayerMenuId === button.dataset.playerId ? null : button.dataset.playerId;
      renderOnlineRoom();
      break;
    case 'online-restart-same':
      emitOnlineEvent('restartRoom');
      break;
    case 'online-start-manager-vote':
      emitOnlineEvent('startManagerVote');
      break;
    case 'online-cast-manager-vote':
      emitOnlineEvent('castManagerVote', { playerId: button.dataset.playerId });
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
      primeOnlineAudio();
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
  updateVoiceSpeakerIndicators();
  voiceChat.handleDisconnect();
  if (onlineSession && onlineState) {
    onlineMessage = 'انقطع الاتصال. يمكنك العودة إلى آخر غرفة من الزر أدناه.';
    showOnlineEntryScreen();
  }
});

socket.on('roomState', (state) => {
  if (!onlineSession || state.roomId !== onlineSession.roomId) return;
  if (onlineState && onlineState.round !== state.round) onlineEliminationResult = null;
  if (onlineState && onlineState.round !== state.round) {
    onlineEliminationSpin = null;
    stopEliminationSpin();
    if (onlineEliminationRevealTimer) {
      clearTimeout(onlineEliminationRevealTimer);
      onlineEliminationRevealTimer = null;
    }
  }
  if (state.status === 'FINAL_CHALLENGE' && state.finalStage === 'COMPLETE' && onlineState?.finalStage !== 'COMPLETE') {
    playOnlineOutcome(state.finalDecision);
  }
  onlineState = state;
  if (state.status === 'ELIMINATION' && state.eliminationPending && !onlineEliminationSpin) {
    startEliminationSpin({
      endsAt: state.eliminationEndsAt,
      candidates: state.eliminationCandidates || []
    });
  }
  if (onlineSession && state.sessionToken && (state.role !== onlineSession.role || state.sessionToken !== onlineSession.resumeToken)) {
    saveOnlineSession({
      ...onlineSession,
      resumeToken: state.sessionToken,
      role: state.role,
      name: state.role === 'boss' ? state.bossName : onlineSession.name
    });
  }
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
  stopEliminationSpin();
  onlineEliminationResult = payload;
  const revealCandidates = payload?.survivors
    ? [
      ...payload.survivors,
      { id: payload.eliminatedPlayerId, name: payload.eliminatedPlayerName }
    ]
    : (onlineEliminationSpin?.candidates || onlineState?.eliminationCandidates || []);
  onlineEliminationSpin = {
    candidates: revealCandidates,
    selectedId: payload.eliminatedPlayerId,
    revealUntil: Date.now() + 4000
  };
  onlineEliminationSpin.revealNameAt = Date.now() + 700;
  if (onlineEliminationRevealTimer) clearTimeout(onlineEliminationRevealTimer);
  if (onlineEliminationNameTimer) clearTimeout(onlineEliminationNameTimer);
  if (onlineState) renderOnlineRoom();
  onlineEliminationNameTimer = setTimeout(() => {
    onlineEliminationNameTimer = null;
    if (onlineState) renderOnlineRoom();
  }, 700);
  onlineEliminationRevealTimer = setTimeout(() => {
    onlineEliminationSpin = null;
    onlineEliminationRevealTimer = null;
    if (onlineState) renderOnlineRoom();
  }, 4000);
});

socket.on('eliminationSpin', (payload) => {
  if (!onlineState || onlineState.status !== 'ELIMINATION') return;
  startEliminationSpin(payload);
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
  await voiceChat.handleSignal(from, signal);
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
document.addEventListener('change', (event) => {
  const control = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
    ? event.target
    : null;
  const setting = control?.dataset.setting;
  if (!setting || !Object.hasOwn(userSettings, setting)) return;
  if (setting === 'voiceMode' && voiceChat.isPressed()) voiceChat.stop();
  userSettings[setting] = control instanceof HTMLInputElement && control.type === 'checkbox'
    ? control.checked
    : control.value;
  saveUserSettings();
  document.querySelectorAll('[data-action="online-ptt"]').forEach((button) => {
    button.textContent = getVoiceButtonLabel();
    button.setAttribute('aria-pressed', String(voiceChat.isPressed()));
  });
});
document.addEventListener('pointerdown', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-action="online-ptt"]') : null;
  if (!button || userSettings.voiceMode !== 'push-to-talk') return;
  event.preventDefault();
  voiceChat.start();
});
document.addEventListener('pointerup', () => {
  if (userSettings.voiceMode === 'push-to-talk') voiceChat.stop();
});
document.addEventListener('pointercancel', () => {
  if (userSettings.voiceMode === 'push-to-talk') voiceChat.stop();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) voiceChat.stop();
});
window.addEventListener('blur', voiceChat.stop);
document.addEventListener('click', (event) => {
  const settingsModal = document.getElementById('settings-modal');
  if (settingsModal && (event.target === settingsModal || event.target.closest('[data-settings-close]'))) {
    settingsModal.remove();
    return;
  }
  const topAction = event.target.closest('[data-top-action]');
  if (!topAction) {
    return;
  }

  handleTopBarAction(topAction.dataset.topAction);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.getElementById('settings-modal')?.remove();
});

saveUserSettings();
renderTopBarActions();
loadEmojiCatalog();
if (onlineSession) {
  showOnlineEntryScreen();
  reconnectOnlineSession();
} else {
  restoreGameSession();
}
