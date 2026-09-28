const socket = io();
const app = document.getElementById('app');
const topBarActions = document.getElementById('top-bar-actions');
const ONLINE_SESSION_KEY = 'atqadam-online-session-v1';

let onlineSession = null;
let onlineState = null;
let onlineMessage = '';
let onlineEliminationResult = null;
let onlineCountdownTimer = null;
let onlineConnectionStatus = 'connected';
let onlineAudioContext = null;
let onlineServerOffset = 0;

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
  localGameState.players = [
    createPlayer(),
    createPlayer(),
    createPlayer(),
    createPlayer()
  ];
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

function emitOnlineEvent(eventName, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(10000).emit(eventName, payload, (timeoutError, response) => {
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
  const isBoss = state.role === 'boss';
  let screen = '';

  if (state.status === 'LOBBY') {
    const connectedCount = state.players.filter((player) => player.isConnected).length;
    screen = `${onlineHeader(state)}
      <h2>غرفة الانتظار</h2>
      <div class="room-code-box"><span>رمز الغرفة</span><strong>${escapeHtml(state.roomId)}</strong><button class="mini-btn" type="button" data-action="online-copy-code">نسخ الرمز</button></div>
      <p class="online-instruction">شارك الرمز مع المتقدمين. يبدأ المدير اللعبة بعد انضمام أربعة متقدمين على الأقل.</p>
      ${onlinePlayerList(state.players)}
      ${isBoss
        ? `<button class="game-btn" type="button" data-action="online-start" ${connectedCount < 4 ? 'disabled' : ''}>ابدأ المقابلة (${connectedCount}/4)</button>`
        : '<div class="online-waiting">بانتظار المدير لبدء المقابلة</div>'}`;
  } else if (state.status === 'BOSS_QUESTION') {
    screen = `${onlineHeader(state)}<span class="meta-badge">الجولة ${state.round}</span>
      <h2>${isBoss ? 'اكتب سؤال المقابلة' : 'المدير يجهز سؤال المقابلة'}</h2>
      ${isBoss
        ? '<div class="field-group"><label for="online-boss-question">سؤال المقابلة</label><textarea id="online-boss-question" maxlength="500" placeholder="اكتب السؤال للجميع" required></textarea><button class="game-btn" type="button" data-action="online-send-question">إرسال السؤال</button></div>'
        : '<div class="online-waiting">سيظهر السؤال هنا فور إرساله</div>'}`;
  } else if (state.status === 'SUBMIT_TRAPS') {
    const me = state.players.find((player) => player.id === state.meId);
    screen = `${onlineHeader(state)}<span class="meta-badge">الجولة ${state.round}</span>
      <h2>${isBoss ? 'إجابات المتقدمين' : 'أرسل إجابتك التوريطية'}</h2>
      <div class="info-box"><p>سؤال المدير</p><strong>${escapeHtml(state.currentQuestion)}</strong></div>
      ${isBoss
        ? `<div class="online-waiting">${state.players.filter((player) => player.hasSubmittedTrap).length} من ${state.players.filter((player) => player.isConnected).length} أجابوا</div>${onlinePlayerList(state.players)}`
        : me?.hasSubmittedTrap
          ? '<div class="online-waiting">وصلت إجابتك. بانتظار بقية الغرفة.</div>'
          : '<div class="field-group"><label for="online-trap-answer">إجابتك</label><textarea id="online-trap-answer" maxlength="500" placeholder="اكتب إجابتك بسرية" required></textarea><button class="game-btn" type="button" data-action="online-send-trap">إرسال الإجابة</button></div>'}`;
  } else if (state.status === 'DEFENSE') {
    const currentSpeaker = state.currentSpeaker?.name || 'بانتظار متقدم متصل';
    const count = state.turnEndsAt ? Math.max(0, Math.ceil((state.turnEndsAt - (Date.now() + onlineServerOffset)) / 1000)) : 0;
    if (state.isMyTurn) {
      screen = `${onlineHeader(state)}<span class="status-pill">دورك في التبرير</span>
        <h2>${escapeHtml(currentSpeaker)}</h2><div class="timer-box"><span data-online-countdown>${count}</span><span>ث</span></div>
        <div class="trap-card-wrap"><div class="trap-card ${state.trapRevealed ? 'is-flipped' : ''}" data-action="online-reveal" role="button" tabindex="0" aria-label="كشف الإجابة التوريطية">
          <div class="card-face card-front">${state.trapRevealed ? 'الإجابة المكشوفة' : 'بطاقتك مغلقة'}</div><div class="card-face card-back">${escapeHtml(state.myTrap || 'لا توجد إجابة مخصصة.')}</div>
        </div></div>
        ${state.trapRevealed ? '<button class="game-btn" type="button" data-action="online-finish-defense">أنهيت التبرير</button>' : '<button class="secondary-btn" type="button" data-action="online-reveal">اكشف البطاقة</button>'}`;
    } else {
      screen = `${onlineHeader(state)}<span class="status-pill">بث مباشر للتبرير</span>
        <h2>المتحدث الآن: ${escapeHtml(currentSpeaker)}</h2><div class="timer-box"><span data-online-countdown>${count}</span><span>ث</span></div>
        <div class="info-box"><p>سؤال المدير</p><strong>${escapeHtml(state.currentQuestion)}</strong></div>
        <div class="live-answer">${state.trapRevealed ? `<span>الإجابة التوريطية</span><strong>${escapeHtml(state.revealedTrap || '—')}</strong>` : '<span>البطاقة ما زالت مغلقة</span>'}</div>`;
    }
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
    const finalQuestionPanel = ['DEFENSE', 'DECISION', 'COMPLETE'].includes(state.finalStage)
      ? `<div class="info-box"><p>السؤال النهائي</p><strong>${escapeHtml(state.finalQuestion)}</strong></div>`
      : '';
    const finalAction = state.finalStage === 'QUESTION' && isBoss
      ? '<div class="field-group"><label for="online-final-question">السؤال النهائي</label><textarea id="online-final-question" maxlength="500" placeholder="اكتب السؤال الأخير" required></textarea><button class="game-btn" type="button" data-action="online-send-final-question">إرسال السؤال</button></div>'
      : state.finalStage === 'DEFENSE' && state.meId === finalist?.id
        ? `<div class="field-group"><label for="online-final-defense">دفاعك النهائي</label><textarea id="online-final-defense" maxlength="1000" placeholder="اكتب دفاعك" required></textarea><button class="game-btn" type="button" data-action="online-send-final-defense">إرسال الدفاع</button></div>`
        : state.finalStage === 'DEFENSE'
          ? '<div class="online-waiting">المتقدم الأخير يجهز دفاعه</div>'
        : state.finalStage === 'DECISION' && isBoss
          ? `<div class="result-box"><p>دفاع ${escapeHtml(finalist?.name || 'المتقدم الأخير')}</p><strong>${escapeHtml(state.finalDefense)}</strong><p class="final-decision-prompt">هل يبقى في الوظيفة أم يُستبعد هو أيضاً؟</p></div><div class="footer-actions"><button class="game-btn" type="button" data-action="online-final-decision" data-decision="accept">الإبقاء عليه في الوظيفة</button><button class="secondary-btn" type="button" data-action="online-final-decision" data-decision="reject">استبعاده هو أيضاً</button></div>`
          : state.finalStage === 'DECISION'
            ? `<div class="result-box"><p>دفاع ${escapeHtml(finalist?.name || 'المتقدم الأخير')}</p><strong>${escapeHtml(state.finalDefense)}</strong></div><div class="online-waiting">المدير يختار الآن الإبقاء على المتقدم أو استبعاده</div>`
          : state.finalStage === 'COMPLETE'
            ? `<div class="victory-panel ${state.finalDecision === 'accept' ? 'accepted' : 'rejected'}"><span>${state.finalDecision === 'accept' ? 'بقي في الوظيفة' : 'استُبعد من الوظيفة'}</span><strong>${escapeHtml(finalist?.name || 'المتقدم الأخير')}</strong></div>`
            : '<div class="online-waiting">بانتظار الخطوة التالية من المدير والمتقدم الأخير</div>';
    screen = `${onlineHeader(state)}<span class="status-pill">التحدي النهائي</span><h2>المتقدم الأخير: ${escapeHtml(finalist?.name || '—')}</h2>${finalQuestionPanel}${finalAction}`;
  }

  app.innerHTML = `<section class="screen-card online-room-screen">${screen}${onlineMessage ? `<div class="online-message">${escapeHtml(onlineMessage)}</div>` : ''}</section>`;
  startOnlineCountdown(state.turnEndsAt);
}

function startOnlineCountdown(turnEndsAt) {
  clearOnlineCountdown();
  if (!turnEndsAt) return;
  const updateCountdown = () => {
    const element = document.querySelector('[data-online-countdown]');
    if (!element) {
      clearOnlineCountdown();
      return;
    }
    element.textContent = String(Math.max(0, Math.ceil((turnEndsAt - (Date.now() + onlineServerOffset)) / 1000)));
  };
  updateCountdown();
  onlineCountdownTimer = setInterval(updateCountdown, 250);
}

function leaveOnlineRoom() {
  emitOnlineEvent('leaveRoom').finally(() => {
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
  const currentPlayer = localGameState.players[localGameState.currentPlayerIndex];
  if (!currentPlayer) {
    finishTrapPhase();
    return;
  }

  localGameState.phase = 'handoff';
  saveGameState();

  app.innerHTML = `
    <section class="screen-card handoff-screen">
      <div class="status-pill">مرّر الجهاز</div>
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
  const currentPlayer = localGameState.players[localGameState.currentPlayerIndex];
  if (!currentPlayer) {
    finishTrapPhase();
    return;
  }

  localGameState.phase = 'trap-input';
  saveGameState();

  app.innerHTML = `
    <section class="screen-card">
      <div class="player-meta">
        <span class="status-pill">إجابة التوريط</span>
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

  app.innerHTML = `
    <section class="screen-card final-screen">
      <div class="status-pill">حسم المدير</div>
      <h2>هل يبقى المتقدم الأخير أم يُستبعد؟</h2>
      <div class="result-box">
        <p>السؤال النهائي:</p>
        <strong>${escapeHtml(localGameState.currentQuestion)}</strong>
        <br /><br />
        <p>دفاع المتقدم:</p>
        <strong>${escapeHtml(localGameState.finalDefenseText || 'لم يتم إدخال دفاع.')}</strong>
      </div>

      <div class="footer-actions">
        <button class="game-btn" type="button" data-action="final-decision" data-result="accept">الإبقاء عليه في الوظيفة</button>
        <button class="secondary-btn" type="button" data-action="final-decision" data-result="reject">استبعاده هو أيضاً</button>
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
  localGameState.currentRound = 1;
  localGameState.currentQuestion = '';
  localGameState.turnIndex = 0;
  localGameState.currentPlayerIndex = 0;
  localGameState.finalDefenseText = '';
  localGameState.countdown = 60;
  localGameState.finalWinner = '';
  localGameState.finalistId = '';
  localGameState.lastDecision = '';
  saveGameState();
  return true;
}

function finishTrapPhase() {
  const trapEntries = localGameState.players
    .filter((player) => player.submittedTrap && player.submittedTrap.trim())
    .map((player) => ({ author: player.Name, text: player.submittedTrap.trim() }));

  const activePlayers = getActivePlayers();
  const usedKeys = new Set();

  activePlayers.forEach((player) => {
    player.assignedTrap = '';
    const shuffledEntries = shuffleArray(trapEntries);
    const match = shuffledEntries.find((entry) => {
      const key = `${entry.author}::${entry.text}`;
      return entry.author !== player.Name && !usedKeys.has(key);
    });

    if (match) {
      player.assignedTrap = match.text;
      usedKeys.add(`${match.author}::${match.text}`);
    } else {
      const fallback = trapEntries.find(
        (entry) => entry.author !== player.Name && !usedKeys.has(`${entry.author}::${entry.text}`)
      );

      if (fallback) {
        player.assignedTrap = fallback.text;
        usedKeys.add(`${fallback.author}::${fallback.text}`);
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
    localGameState.phase = 'elimination';
    saveGameState();
    buildBossEliminationScreen();
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
    localGameState.phase = 'final';
    localGameState.finalistId = activePlayers[0]?.id || '';
    localGameState.currentQuestion = '';
    saveGameState();
    buildFinalChallengeScreen();
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

  localGameState.players.forEach((player) => {
    player.submittedTrap = '';
    player.assignedTrap = '';
    player.cardRevealed = false;
  });

  saveGameState();
  buildHandoffScreen();
}

function handleReadyHandoff() {
  const currentPlayer = localGameState.players[localGameState.currentPlayerIndex];
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

  if (localGameState.currentPlayerIndex < localGameState.players.length) {
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
  localGameState.finalWinner = result === 'accept' ? (finalist?.Name || 'المتقدم') : localGameState.bossName || 'المدير';
  localGameState.phase = 'completed';
  saveGameState();

  app.innerHTML = `
    <section class="screen-card final-screen">
      <div class="status-pill">نهاية اللعبة</div>
      <h2>النتيجة النهائية</h2>
      <div class="result-box">
        <p>${result === 'accept' ? `تم الإبقاء على ${escapeHtml(finalist?.Name || 'المتقدم')} في الوظيفة.` : `تم استبعاد ${escapeHtml(finalist?.Name || 'المتقدم')} أيضاً.`}</p>
        <strong>${escapeHtml(localGameState.finalWinner)}</strong>
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
          ? `تم الإبقاء على ${escapeHtml(finalist?.Name || 'المتقدم')} في الوظيفة.`
          : `تم استبعاد ${escapeHtml(finalist?.Name || 'المتقدم')} أيضاً.`;
      app.innerHTML = `
        <section class="screen-card final-screen">
          <div class="status-pill">نهاية اللعبة</div>
          <h2>النتيجة النهائية</h2>
          <div class="result-box">
            <p>${outcomeText}</p>
            <strong>${escapeHtml(savedState.finalWinner)}</strong>
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
      emitOnlineEvent('finishDefense');
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
  if (onlineSession && onlineState) renderOnlineRoom();
});

socket.on('roomState', (state) => {
  if (!onlineSession || state.roomId !== onlineSession.roomId) return;
  if (onlineState && onlineState.round !== state.round) onlineEliminationResult = null;
  if (state.status === 'FINAL_CHALLENGE' && state.finalStage === 'COMPLETE' && onlineState?.finalStage !== 'COMPLETE') {
    playOnlineOutcome(state.finalDecision);
  }
  onlineState = state;
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

app.addEventListener('click', handleGameAction);
app.addEventListener('submit', handleOnlineForm);
document.addEventListener('click', (event) => {
  const topAction = event.target.closest('[data-top-action]');
  if (!topAction) {
    return;
  }

  handleTopBarAction(topAction.dataset.topAction);
});

renderTopBarActions();
if (onlineSession) {
  showOnlineEntryScreen();
  reconnectOnlineSession();
} else {
  restoreGameSession();
}
