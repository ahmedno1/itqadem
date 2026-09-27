const socket = io();
const app = document.getElementById('app');
const topBarActions = document.getElementById('top-bar-actions');

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

  while (localGameState.players.length < 4) {
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
  const playerInputs = Array.from(document.querySelectorAll('[data-player-index]'));
  if (playerInputs.length === 0) {
    return;
  }

  const nextPlayers = Array.from({ length: playerInputs.length }, (_, index) => {
    const input = playerInputs[index];
    const name = input ? input.value.trim() : '';

    if (localGameState.players[index]) {
      localGameState.players[index].Name = name;
      return localGameState.players[index];
    }

    return createPlayer(name);
  });

  localGameState.players = nextPlayers;
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

function buildMenuScreen() {
  clearTimer();
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
        <h2>أتقدم للوظيفة</h2>
      </div>

      <div class="actions">
        <button class="game-btn" data-action="start-local-mode">
          <span>ابدأ اللعبة</span>
          <small>Pass &amp; Play</small>
        </button>
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
      <h2>قرار النتيجة</h2>
      <div class="result-box">
        <p>السؤال النهائي:</p>
        <strong>${escapeHtml(localGameState.currentQuestion)}</strong>
        <br /><br />
        <p>دفاع المتقدم:</p>
        <strong>${escapeHtml(localGameState.finalDefenseText || 'لم يتم إدخال دفاع.')}</strong>
      </div>

      <div class="footer-actions">
        <button class="game-btn" type="button" data-action="final-decision" data-result="accept">قبول في الوظيفة</button>
        <button class="secondary-btn" type="button" data-action="final-decision" data-result="reject">رفض</button>
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
  localGameState.lastDecision = result;
  localGameState.finalWinner = result === 'accept' ? 'المتقدم' : 'المدير';
  localGameState.phase = 'completed';
  saveGameState();

  app.innerHTML = `
    <section class="screen-card final-screen">
      <div class="status-pill">نهاية اللعبة</div>
      <h2>النتيجة النهائية</h2>
      <div class="result-box">
        <p>${result === 'accept' ? 'تم قبول المتقدم في الوظيفة.' : 'تم رفض المتقدم، وفاز المدير.'}</p>
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
      app.innerHTML = `
        <section class="screen-card final-screen">
          <div class="status-pill">نهاية اللعبة</div>
          <h2>النتيجة النهائية</h2>
          <div class="result-box">
            <p>${savedState.lastDecision === 'accept' ? 'تم قبول المتقدم في الوظيفة.' : 'تم رفض المتقدم، وفاز المدير.'}</p>
            <strong>${escapeHtml(savedState.finalWinner)}</strong>
          </div>
          <div class="footer-actions">
            <button class="game-btn" type="button" data-action="restart-game">ابدأ لعبة جديدة</button>
            <button class="secondary-btn" type="button" data-action="exit-to-menu">الخروج إلى القائمة</button>
          </div>
        </section>
      `;
      break;
    default:
      buildMenuScreen();
      break;
  }
}

function handleGameAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) {
    return;
  }

  const { action, result, playerName, playerIndex } = button.dataset;

  switch (action) {
    case 'start-local-mode':
      resetPlayers();
      buildSetupScreen();
      break;
    case 'add-player':
      syncPlayersFromInputs();
      ensurePlayerList();
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
      ensurePlayerList();
      if (localGameState.players.length <= 2) {
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

socket.on('welcome', (payload) => {
  console.log(payload.text);
});

app.addEventListener('click', handleGameAction);
document.addEventListener('click', (event) => {
  const topAction = event.target.closest('[data-top-action]');
  if (!topAction) {
    return;
  }

  handleTopBarAction(topAction.dataset.topAction);
});

renderTopBarActions();
restoreGameSession();
