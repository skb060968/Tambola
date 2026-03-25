/**
 * Tambola Main Entry Point
 *
 * Wires all modules together: home screen, offline/online game flows,
 * marking, claiming, sound, persistence, and service worker.
 */

import { generateTickets, deserializeTicket } from './ticket-generator.js';
import {
  createGameState,
  drawNumber,
  markNumber,
  getClaimablePatterns,
  getNearPatterns,
  getRecentCalls,
  saveGameState,
  loadGameState,
  clearSavedGame,
} from './game-engine.js';
import { validateClaim } from './claim-validator.js';
import {
  renderTicket,
  renderNumberBoard,
  renderSpinningBall,
  resetBall,
  renderRecentCalls,
  showCelebration,
  showClaimButtons,
  updateMarkedCount,
  switchView,
  showNearPatternIndicator,
  showToast,
  renderWinnerSummary,
  renderLobbyPlayers,
  renderReadyIndicators,
} from './ui.js';
import {
  createRoom,
  joinRoom,
  rejoinRoom,
  listenRoom,
  broadcastDraw,
  submitClaim,
  startGame,
  endGame,
  resetRoom,
  setupDisconnectHandler,
  removePlayer,
  firebaseRetry,
} from './firebase-sync.js';
import { initAudio, playSound, toggleMute, isMuted, speakNumber, speakAnnouncement } from './sound-manager.js';
import { db } from './firebase-config.js';
import { ref, get } from 'firebase/database';

/* ======= STATE ======= */

let state = null; // GameState from game-engine
let gameMode = 'offline'; // 'offline' | 'online'
let selectedPlayerCount = 3; // default from HTML active button

// Online state
let roomCode = null;
let playerIndex = null; // this player's index in the room
let isHost = false;
let playerNames = [];
let unsubscribeRoom = null;
let lastKnownDrawIndex = 0;

/* ======= DOM REFERENCES ======= */

const btnOffline = document.getElementById('btn-offline');
const btnOnline = document.getElementById('btn-online');
const offlineSetup = document.getElementById('offline-setup');
const onlineChoice = document.getElementById('online-choice');
const playerCountBtns = document.querySelectorAll('.player-count-btn');
const btnStartOffline = document.getElementById('btn-start-offline');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const joinRoomForm = document.getElementById('join-room-form');
const btnSubmitJoin = document.getElementById('btn-submit-join');
const roomCodeInput = document.getElementById('room-code-input');
const playerNameInput = document.getElementById('player-name-input');

const lobbyRoomCode = document.getElementById('lobby-room-code');
const btnStartGame = document.getElementById('btn-start-game');
const lobbyWaiting = document.getElementById('lobby-waiting');

const btnDraw = document.getElementById('btn-draw');
const autoMarkToggle = document.getElementById('auto-mark-toggle');
const muteToggle = document.getElementById('mute-toggle');
const autoDrawControls = document.getElementById('auto-draw-controls');
const autoDrawToggle = document.getElementById('auto-draw-toggle');
const autoDrawSpeed = document.getElementById('auto-draw-speed');

const btnPlayAgain = document.getElementById('btn-play-again');
const btnHome = document.getElementById('btn-home');

let autoDrawTimer = null;

/* ======= HELPERS ======= */

/** Saves online session info to localStorage for reconnection after app close/refresh. */
function saveOnlineSession() {
  if (gameMode === 'online' && roomCode != null && playerIndex != null) {
    localStorage.setItem('tambola_session', JSON.stringify({
      roomCode,
      playerIndex,
      isHost,
    }));
  }
}

/** Clears saved online session. */
function clearOnlineSession() {
  localStorage.removeItem('tambola_session');
}

/** Loads saved online session from localStorage. */
function loadOnlineSession() {
  try {
    const raw = localStorage.getItem('tambola_session');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

const PATTERN_LABELS = {
  earlyFive: 'Early Five',
  firstLine: 'First Line',
  secondLine: 'Second Line',
  thirdLine: 'Third Line',
  fullHouse: 'Full House',
};

/** Shows a custom name input modal. Returns a promise that resolves with the name or null. */
function showNameModal(title = 'Enter your name') {
  return new Promise((resolve) => {
    const modal = document.getElementById('name-modal');
    const input = document.getElementById('name-modal-input');
    const submitBtn = document.getElementById('name-modal-submit');
    const cancelBtn = document.getElementById('name-modal-cancel');
    const titleEl = document.getElementById('name-modal-title');

    if (!modal || !input || !submitBtn) {
      resolve(prompt(title));
      return;
    }

    titleEl.textContent = title;
    input.value = '';
    modal.hidden = false;
    input.focus();

    function submit() {
      const val = input.value.trim();
      if (!val) { input.focus(); return; }
      modal.hidden = true;
      cleanup();
      resolve(val);
    }

    function cancel() {
      modal.hidden = true;
      cleanup();
      resolve(null);
    }

    function onKey(e) {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    }

    function cleanup() {
      submitBtn.removeEventListener('click', submit);
      if (cancelBtn) cancelBtn.removeEventListener('click', cancel);
      input.removeEventListener('keydown', onKey);
    }

    submitBtn.addEventListener('click', submit);
    if (cancelBtn) cancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', onKey);
  });
}

/** Starts the auto-draw timer. */
function startAutoDraw() {
  stopAutoDraw();
  const interval = parseInt(autoDrawSpeed.value, 10) * 1000;
  autoDrawTimer = setInterval(() => {
    if (!state || state.gameOver) { stopAutoDraw(); return; }
    if (gameMode === 'offline') {
      handleOfflineDraw();
    } else if (isHost) {
      handleOnlineDraw();
    }
  }, interval);
}

/** Stops the auto-draw timer. */
function stopAutoDraw() {
  if (autoDrawTimer) {
    clearInterval(autoDrawTimer);
    autoDrawTimer = null;
  }
}

/** Returns an array of player display names for the current game. */
function getPlayerNames() {
  if (gameMode === 'online') return playerNames;
  const names = [];
  for (let i = 0; i < (state ? state.playerCount : selectedPlayerCount); i++) {
    names.push(`Player ${i + 1}`);
  }
  return names;
}

/** Checks if the game is over: all 5 patterns won OR all 90 numbers drawn. */
function checkGameOver() {
  if (!state) return false;
  const allPatternsWon = Object.values(state.claims).every((c) => c.won);
  const allNumbersDrawn = state.drawnNumbers.length >= 90;
  return allPatternsWon || allNumbersDrawn;
}

/** Switches to the results view and renders the winner summary. */
function showResults() {
  renderWinnerSummary(state.claims, getPlayerNames());

  // Reset Play Again button state
  btnPlayAgain.disabled = false;
  btnPlayAgain.textContent = 'Play Again';
  btnPlayAgain.dataset.hostReady = '';

  // In online mode, show ready indicators and listen for ready signals
  const readyContainer = document.getElementById('ready-indicators');
  if (gameMode === 'online' && roomCode) {
    renderReadyIndicators(getPlayerNames(), []);

    // Listen for ready signals from Firebase
    const { ref: dbRef, onValue: dbOnValue, off: dbOff } = window._fbImports || {};
    import('firebase/database').then(({ ref: r, onValue: ov, off: o }) => {
      const readyRef = r(db, `tambola-rooms/${roomCode}/ready`);
      const readyHandler = (snapshot) => {
        const data = snapshot.val() || {};
        const readyIndices = Object.keys(data)
          .filter((k) => data[k] === true)
          .map((k) => parseInt(k.replace('player_', ''), 10))
          .filter((n) => !isNaN(n));
        const leftIndices = Object.keys(data)
          .filter((k) => data[k] === 'left')
          .map((k) => parseInt(k.replace('player_', ''), 10))
          .filter((n) => !isNaN(n));
        renderReadyIndicators(getPlayerNames(), readyIndices, leftIndices);
      };
      ov(readyRef, readyHandler);

      // Store cleanup for when we leave results
      window._readyCleanup = () => {
        o(readyRef, 'value', readyHandler);
        window._readyCleanup = null;
      };
    });
  } else if (readyContainer) {
    readyContainer.hidden = true;
  }

  switchView('results');
}

/* ======= GAME UI UPDATE ======= */

/**
 * Refreshes all game UI elements after a draw or mark:
 * tickets, number board, recent calls, marked count, claim buttons, near-pattern indicators.
 */
function updateGameUI() {
  if (!state) return;

  // Render number board
  renderNumberBoard(state.drawnNumbers, 'number-board');

  // Render recent calls
  renderRecentCalls(getRecentCalls(state, 5));

  // Render tickets
  const ticketContainer = document.getElementById('ticket-container');
  if (ticketContainer) ticketContainer.innerHTML = '';

  if (gameMode === 'offline') {
    // Offline: show all player tickets
    for (let i = 0; i < state.playerCount; i++) {
      const containerId = `ticket-player-${i}`;
      const div = document.createElement('div');
      div.id = containerId;
      div.className = 'ticket-wrapper';
      if (ticketContainer) ticketContainer.appendChild(div);
      renderTicket(state.tickets[i], state.markedNumbers[i], containerId, `Player ${i + 1}`);

      // Attach manual mark click handlers
      attachTicketClickHandlers(containerId, i);
    }
  } else {
    // Online: show only this player's ticket
    const containerId = 'ticket-player-self';
    const div = document.createElement('div');
    div.id = containerId;
    div.className = 'ticket-wrapper';
    if (ticketContainer) ticketContainer.appendChild(div);
    const name = playerNames[playerIndex] || `Player ${playerIndex + 1}`;
    renderTicket(state.tickets[playerIndex], state.markedNumbers[playerIndex], containerId, name);
    attachTicketClickHandlers(containerId, playerIndex);
  }

  // Update marked count (for offline, show first player; for online, show self)
  const displayPlayer = gameMode === 'offline' ? 0 : playerIndex;
  updateMarkedCount(state.markedNumbers[displayPlayer].size);

  // Update claim buttons
  updateClaimButtons();

  // Update near-pattern indicators
  updateNearPatterns();
}

/** Attaches click handlers to ticket cells for manual marking. */
function attachTicketClickHandlers(containerId, pIndex) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const cells = container.querySelectorAll('.ticket-cell.has-number');
  cells.forEach((cell) => {
    cell.addEventListener('click', () => {
      if (state.autoMark) return; // auto-mark is on, ignore manual taps
      const num = parseInt(cell.dataset.number, 10);
      if (isNaN(num)) return;
      handleManualMark(pIndex, num);
    });
  });
}

/** Handles manual marking of a number on a player's ticket. */
function handleManualMark(pIndex, number) {
  const result = markNumber(state, pIndex, number);
  if (!result.success) {
    showToast(result.reason || 'Number not called yet');
    playSound('error');
    return;
  }
  state = result.state;
  playSound('mark');
  updateGameUI();
  if (gameMode === 'offline') saveGameState(state);
}

/** Updates claim button states and wires click handlers. */
function updateClaimButtons() {
  if (!state) return;

  // In offline mode, any player can claim (shared screen).
  // We check claimable for all players and merge.
  let claimable = [];
  if (gameMode === 'offline') {
    for (let i = 0; i < state.playerCount; i++) {
      claimable = claimable.concat(getClaimablePatterns(state, i));
    }
    // Deduplicate
    claimable = [...new Set(claimable)];
  } else {
    claimable = getClaimablePatterns(state, playerIndex);
  }

  showClaimButtons(claimable, state.claims, (pattern) => {
    handleClaim(pattern);
  });
}

/** Updates near-pattern indicators on tickets. */
function updateNearPatterns() {
  if (!state) return;

  let nearPatterns = [];
  if (gameMode === 'offline') {
    for (let i = 0; i < state.playerCount; i++) {
      nearPatterns = nearPatterns.concat(getNearPatterns(state, i));
    }
    nearPatterns = [...new Set(nearPatterns)];
  } else {
    nearPatterns = getNearPatterns(state, playerIndex);
  }

  showNearPatternIndicator(nearPatterns);
}

/** Handles a claim attempt. In offline mode, finds which player can claim. */
function handleClaim(pattern) {
  if (!state) return;

  if (state.claims[pattern] && state.claims[pattern].won) {
    showToast('This pattern has already been won!');
    playSound('error');
    return;
  }

  if (gameMode === 'online') {
    // Online: validate locally first, then submit via Firebase
    const ticket = state.tickets[playerIndex];
    const marked = state.markedNumbers[playerIndex];
    const called = new Set(state.drawnNumbers);
    const result = validateClaim(ticket, marked, called, pattern);

    if (result.valid) {
      submitClaim(roomCode, playerIndex, pattern).catch((err) => {
        console.error('Failed to submit claim:', err);
        showToast('Failed to submit claim. Try again.');
      });
      // UI update will come via Firebase listener
      state.claims[pattern] = { won: true, winner: playerIndex };
      const name = playerNames[playerIndex] || `Player ${playerIndex + 1}`;
      showCelebration(pattern, name);
      speakAnnouncement(name, PATTERN_LABELS[pattern] || pattern).then(() => playSound('win'));
      updateGameUI();
      if (checkGameOver()) showResults();
    } else {
      showToast(result.reason || 'Invalid claim');
      playSound('error');
    }
    return;
  }

  // Offline: find the first player who can validly claim this pattern
  const called = new Set(state.drawnNumbers);
  for (let i = 0; i < state.playerCount; i++) {
    const ticket = state.tickets[i];
    const marked = state.markedNumbers[i];
    const result = validateClaim(ticket, marked, called, pattern);

    if (result.valid) {
      state.claims[pattern] = { won: true, winner: i };
      const name = `Player ${i + 1}`;
      showCelebration(pattern, name);
      speakAnnouncement(name, PATTERN_LABELS[pattern] || pattern).then(() => playSound('win'));
      updateGameUI();
      saveGameState(state);
      if (checkGameOver()) {
        state.gameOver = true;
        saveGameState(state);
        setTimeout(() => showResults(), 2800);
      }
      return;
    }
  }

  // No player can validly claim
  showToast('No player has completed this pattern yet');
  playSound('error');
}

/* ======= OFFLINE GAME FLOW ======= */

/** Starts a new offline game with the selected player count. */
function startOfflineGame() {
  gameMode = 'offline';
  const tickets = generateTickets(selectedPlayerCount);
  state = createGameState(selectedPlayerCount, tickets);
  state.autoMark = autoMarkToggle.checked;

  switchView('game');
  resetBall();
  updateGameUI();

  // Show auto-draw controls for offline
  if (autoDrawControls) autoDrawControls.hidden = false;
  // Show End Game for offline too
  const btnEndGame = document.getElementById('btn-end-game');
  if (btnEndGame) btnEndGame.hidden = false;

  // Enable draw button
  btnDraw.disabled = false;
  btnDraw.hidden = false;
}

/** Handles the draw button click in offline mode. */
function handleOfflineDraw() {
  if (!state || state.gameOver) return;

  const result = drawNumber(state);
  if (!result) {
    // Pool exhausted
    state.gameOver = true;
    saveGameState(state);
    showToast('All 90 numbers have been drawn!');
    setTimeout(() => showResults(), 1500);
    return;
  }

  state = result.newState;
  const drawnNum = result.number;

  // Disable draw button during animation
  btnDraw.disabled = true;

  playSound('draw');

  renderSpinningBall(drawnNum, () => {
    speakNumber(drawnNum);
    updateGameUI();
    saveGameState(state);

    // Check game over after draw
    if (checkGameOver()) {
      state.gameOver = true;
      saveGameState(state);
      setTimeout(() => showResults(), 1500);
      return;
    }

    btnDraw.disabled = false;
  });
}

/* ======= ONLINE GAME FLOW ======= */

/** Sets up the lobby view after creating or joining a room. */
function setupLobby() {
  switchView('lobby');
  lobbyRoomCode.textContent = roomCode;

  if (isHost) {
    btnStartGame.hidden = false;
    lobbyWaiting.hidden = true;
  } else {
    btnStartGame.hidden = true;
    lobbyWaiting.hidden = false;
  }

  // Set up disconnect handler
  setupDisconnectHandler(roomCode, playerIndex);

  // Listen for room changes
  if (unsubscribeRoom) unsubscribeRoom();

  unsubscribeRoom = listenRoom(roomCode, {
    onPlayersChange: (players) => {
      // Convert Firebase players object to array
      const playerArr = [];
      const keys = Object.keys(players).sort();
      keys.forEach((key) => {
        playerArr.push(players[key]);
      });
      playerNames = playerArr.map((p) => p.name || 'Unknown');

      renderLobbyPlayers(playerArr, isHost, (removeIndex) => {
        if (isHost) {
          removePlayer(roomCode, removeIndex).catch((err) => {
            console.error('Failed to remove player:', err);
          });
        }
      });
    },

    onStatusChange: async (status) => {
      if (status === 'lobby' && !isHost) {
        // Room reset for new round — go back to lobby
        state = null;
        lastKnownDrawIndex = 0;
        switchView('lobby');
        lobbyRoomCode.textContent = roomCode;
        btnStartGame.hidden = true;
        lobbyWaiting.hidden = false;
        return;
      }

      if (status === 'ended' && !isHost && state) {
        // Host ended the game midway — go to results
        stopAutoDraw();
        state.gameOver = true;
        showToast('Host ended the game');
        showResults();
        return;
      }

      if (status === 'active' && !isHost && !state) {
        // Game started by host — fetch tickets and build local state
        try {
          const roomRef = ref(db, `tambola-rooms/${roomCode}`);
          const snapshot = await firebaseRetry(() => get(roomRef));
          if (snapshot.exists()) {
            const roomData = snapshot.val();
            const ticketStrings = roomData.tickets || {};
            const ticketKeys = Object.keys(ticketStrings).sort();
            const tickets = ticketKeys.map((key) => deserializeTicket(ticketStrings[key]));

            // Map this player's Firebase key to local array index
            const myKey = `player_${playerIndex}`;
            const myLocalIndex = ticketKeys.indexOf(myKey);
            if (myLocalIndex === -1) {
              showToast('Your ticket was not found.');
              return;
            }

            state = createGameState(tickets.length, tickets);
            state.mode = 'online';
            state.autoMark = autoMarkToggle.checked;
            lastKnownDrawIndex = 0;

            // Update playerIndex to local array index for UI rendering
            playerIndex = myLocalIndex;

            // Rebuild player names from sorted keys
            if (roomData.players) {
              playerNames = ticketKeys.map((k) => {
                const p = roomData.players[k];
                return p ? p.name || 'Unknown' : 'Unknown';
              });
            }

            // Apply any already-drawn numbers
            if (roomData.game && roomData.game.drawnNumbers) {
              handleOnlineGameUpdate(roomData.game);
            }
          }
        } catch (err) {
          console.error('Failed to fetch room data:', err);
          showToast('Failed to load game data.');
        }
        setupOnlineGameView();
      }
    },

    onGameUpdate: (gameData) => {
      handleOnlineGameUpdate(gameData);
    },

    onMarksChange: () => {
      // Marks sync handled via onGameUpdate for simplicity
    },

    onRoomDeleted: () => {
      // Host deleted the room — notify and send everyone home
      if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
      clearOnlineSession();
      roomCode = null;
      playerIndex = null;
      isHost = false;
      playerNames = [];
      gameMode = 'offline';
      state = null;
      switchView('home');
      offlineSetup.hidden = true;
      onlineChoice.hidden = true;
      showToast('Host has left. Room closed.', 3000);
    },
  });
}

/** Host starts the online game. */
async function handleHostStartGame() {
  if (!isHost || !roomCode) return;

  // Count players from the lobby
  const count = playerNames.length;
  if (count < 1) {
    showToast('Need at least 1 player to start');
    return;
  }

  const tickets = generateTickets(count);
  state = createGameState(count, tickets);
  state.mode = 'online';
  state.autoMark = autoMarkToggle.checked;
  lastKnownDrawIndex = 0;

  try {
    await startGame(roomCode, tickets);
    setupOnlineGameView();
  } catch (err) {
    console.error('Failed to start game:', err);
    showToast('Failed to start game. Try again.');
  }
}

/** Sets up the game view for online play. */
function setupOnlineGameView() {
  switchView('game');
  resetBall();

  // If not host, we need to reconstruct state from Firebase data
  // The listenRoom callback will provide ticket data
  if (!isHost && !state) {
    // State will be built when onGameUpdate fires with ticket data
    // For now, just show the view
    btnDraw.hidden = true;
    btnDraw.disabled = true;
  }

  const btnEndGame = document.getElementById('btn-end-game');

  if (isHost) {
    btnDraw.hidden = false;
    btnDraw.disabled = false;
    if (autoDrawControls) autoDrawControls.hidden = false;
    if (btnEndGame) btnEndGame.hidden = false;
  } else {
    btnDraw.hidden = true;
    if (autoDrawControls) autoDrawControls.hidden = true;
    if (btnEndGame) btnEndGame.hidden = true;
  }

  if (state) updateGameUI();
}

/** Handles game updates from Firebase for online mode. */
function handleOnlineGameUpdate(gameData) {
  if (!gameData) return;

  // If state hasn't been built yet (non-host joining active game),
  // try to reconstruct from Firebase ticket data
  if (!state && !isHost) {
    // We need tickets from the parent room data — listenRoom fires with full room data
    // The tickets are at the room level, not inside game. We'll build state when we have them.
    return;
  }

  if (!state) return;

  // Detect new drawn number
  const drawnNumbers = gameData.drawnNumbers || [];
  const currentDrawIndex = gameData.drawIndex || drawnNumbers.length;

  if (currentDrawIndex > lastKnownDrawIndex && drawnNumbers.length > 0) {
    const newNumber = gameData.currentNumber || drawnNumbers[drawnNumbers.length - 1];
    lastKnownDrawIndex = currentDrawIndex;

    // Update local state with new drawn numbers
    if (state) {
      state.drawnNumbers = [...drawnNumbers];
      state.remainingPool = state.remainingPool.filter((n) => !drawnNumbers.includes(n));

      // Auto-mark if enabled
      if (state.autoMark) {
        const calledSet = new Set(drawnNumbers);
        state.markedNumbers = state.markedNumbers.map((marks, i) => {
          const ticket = state.tickets[i];
          const ticketNums = ticket.flat().filter((v) => v > 0);
          const updated = new Set(marks);
          ticketNums.forEach((n) => {
            if (calledSet.has(n)) updated.add(n);
          });
          return updated;
        });
      }
    }

    // Animate the new number (only for non-host, host already animated)
    if (!isHost) {
      playSound('draw');
      renderSpinningBall(newNumber, () => {
        speakNumber(newNumber);
        updateGameUI();
      });
    }
  }

  // Check for new claims from Firebase
  if (gameData.claims && state) {
    let claimChanged = false;
    for (const [pattern, claimData] of Object.entries(gameData.claims)) {
      if (claimData.won && state.claims[pattern] && !state.claims[pattern].won) {
        state.claims[pattern] = { won: true, winner: claimData.winner };
        const winnerName = playerNames[claimData.winner] || `Player ${claimData.winner + 1}`;
        showCelebration(pattern, winnerName);
        speakAnnouncement(winnerName, PATTERN_LABELS[pattern] || pattern).then(() => playSound('win'));
        claimChanged = true;
      }
    }
    if (claimChanged) {
      updateGameUI();
      if (checkGameOver()) {
        state.gameOver = true;
        setTimeout(() => showResults(), 2800);
      }
    }
  }
}

/** Handles the draw button click in online mode (host only). */
async function handleOnlineDraw() {
  if (!isHost || !state || state.gameOver) return;

  const result = drawNumber(state);
  if (!result) {
    state.gameOver = true;
    showToast('All 90 numbers have been drawn!');
    try {
      await endGame(roomCode);
    } catch (_) {}
    setTimeout(() => showResults(), 1500);
    return;
  }

  state = result.newState;
  const drawnNum = result.number;
  lastKnownDrawIndex = state.drawnNumbers.length;

  btnDraw.disabled = true;
  playSound('draw');

  // Broadcast to all players
  broadcastDraw(roomCode, drawnNum).catch((err) => {
    console.error('Failed to broadcast draw:', err);
    showToast('Failed to sync draw. Try again.');
  });

  renderSpinningBall(drawnNum, () => {
    speakNumber(drawnNum);
    updateGameUI();

    if (checkGameOver()) {
      state.gameOver = true;
      endGame(roomCode).catch(() => {});
      setTimeout(() => showResults(), 1500);
      return;
    }

    btnDraw.disabled = false;
  });
}

/* ======= RESUME PROMPT ======= */

/** Checks for a saved game and prompts the user to resume or start new. */
function checkResume() {
  const saved = loadGameState();
  if (!saved) return;

  const resume = confirm('A saved game was found. Would you like to resume?');
  if (resume) {
    state = saved;
    gameMode = state.mode || 'offline';
    switchView('game');
    updateGameUI();
    btnDraw.disabled = false;
    btnDraw.hidden = false;
  } else {
    clearSavedGame();
  }
}

/* ======= HOME SCREEN WIRING ======= */

function wireHomeScreen() {
  // Offline / Online mode toggle
  btnOffline.addEventListener('click', () => {
    offlineSetup.hidden = false;
    onlineChoice.hidden = true;
  });

  btnOnline.addEventListener('click', () => {
    onlineChoice.hidden = false;
    offlineSetup.hidden = true;
  });

  // Back buttons
  const btnBackOffline = document.getElementById('btn-back-offline');
  const btnBackOnline = document.getElementById('btn-back-online');

  if (btnBackOffline) {
    btnBackOffline.addEventListener('click', () => {
      offlineSetup.hidden = true;
    });
  }

  if (btnBackOnline) {
    btnBackOnline.addEventListener('click', () => {
      onlineChoice.hidden = true;
      joinRoomForm.hidden = true;
      btnCreateRoom.hidden = false;
      btnJoinRoom.hidden = false;
    });
  }

  // Player count selection
  playerCountBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      playerCountBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPlayerCount = parseInt(btn.dataset.count, 10);
    });
  });

  // Start offline game
  btnStartOffline.addEventListener('click', () => {
    startOfflineGame();
  });

  // Create room
  btnCreateRoom.addEventListener('click', async () => {
    const name = await showNameModal('Enter your name');
    if (!name) return;

    try {
      const result = await createRoom(name);
      roomCode = result.roomCode;
      playerIndex = result.playerIndex;
      isHost = true;
      playerNames = [name];
      gameMode = 'online';
      setupLobby();
      saveOnlineSession();
    } catch (err) {
      console.error('Failed to create room:', err);
      showToast('Failed to create room. Check your connection.');
    }
  });

  // Show join form, hide create button
  btnJoinRoom.addEventListener('click', () => {
    joinRoomForm.hidden = false;
    btnCreateRoom.hidden = true;
    btnJoinRoom.hidden = true;
  });

  // Submit join
  btnSubmitJoin.addEventListener('click', async () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    const name = playerNameInput.value.trim();

    if (!code || code.length !== 4) {
      showToast('Please enter a valid 4-character room code');
      return;
    }
    if (!name) {
      showToast('Please enter your name');
      return;
    }

    try {
      const result = await joinRoom(code, name);
      if (!result.success) {
        showToast(result.reason || 'Failed to join room');
        return;
      }
      roomCode = code;
      playerIndex = result.playerIndex;
      isHost = false;
      gameMode = 'online';
      setupLobby();
      saveOnlineSession();
    } catch (err) {
      console.error('Failed to join room:', err);
      showToast('Failed to join room. Check your connection.');
    }
  });
}

/* ======= LOBBY WIRING ======= */

function wireLobby() {
  btnStartGame.addEventListener('click', () => {
    handleHostStartGame();
  });

  const btnLeaveLobby = document.getElementById('btn-leave-lobby');
  if (btnLeaveLobby) {
    btnLeaveLobby.addEventListener('click', async () => {
      if (isHost && roomCode) {
        // Host leaving: delete the entire room
        try {
          const { ref: dbRef, remove: dbRemove } = await import('firebase/database');
          const roomRef = dbRef(db, `tambola-rooms/${roomCode}`);
          await dbRemove(roomRef);
        } catch (_) {}
      } else if (roomCode && playerIndex != null) {
        // Player leaving: just remove themselves
        try {
          await removePlayer(roomCode, playerIndex);
        } catch (_) {}
      }
      // Clean up local state
      if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
      clearOnlineSession();
      roomCode = null;
      playerIndex = null;
      isHost = false;
      playerNames = [];
      gameMode = 'offline';
      switchView('home');
      offlineSetup.hidden = true;
      onlineChoice.hidden = true;
      joinRoomForm.hidden = true;
      btnCreateRoom.hidden = false;
      btnJoinRoom.hidden = false;
    });
  }

  const btnShareRoom = document.getElementById('btn-share-room');
  if (btnShareRoom) {
    btnShareRoom.addEventListener('click', async () => {
      if (!roomCode) return;
      const shareText = `Join my Housie game! Room code: ${roomCode}`;
      const shareUrl = window.location.origin;

      // Try native share API (mobile)
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Housie Game', text: shareText, url: shareUrl });
          return;
        } catch (_) {}
      }

      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        showToast('Room code copied!');
      } catch (_) {
        showToast(`Room code: ${roomCode}`);
      }
    });
  }
}

/* ======= GAME CONTROLS WIRING ======= */

function wireGameControls() {
  // Draw button
  btnDraw.addEventListener('click', () => {
    if (gameMode === 'offline') {
      handleOfflineDraw();
    } else if (isHost) {
      handleOnlineDraw();
    }
  });

  // Auto-mark toggle
  autoMarkToggle.addEventListener('change', () => {
    if (state) {
      state.autoMark = autoMarkToggle.checked;
    }
  });

  // Mute toggle
  muteToggle.addEventListener('change', () => {
    toggleMute();
  });

  // Auto-draw toggle
  if (autoDrawToggle) {
    autoDrawToggle.addEventListener('change', () => {
      if (autoDrawToggle.checked) {
        startAutoDraw();
      } else {
        stopAutoDraw();
      }
    });
  }

  // Auto-draw speed change
  if (autoDrawSpeed) {
    autoDrawSpeed.addEventListener('change', () => {
      if (autoDrawToggle && autoDrawToggle.checked) {
        startAutoDraw(); // restart with new interval
      }
    });
  }

  // End Game button (host only)
  const btnEndGame = document.getElementById('btn-end-game');
  if (btnEndGame) {
    btnEndGame.addEventListener('click', async () => {
      if (!isHost || !state) return;
      stopAutoDraw();
      if (autoDrawToggle) autoDrawToggle.checked = false;
      state.gameOver = true;

      if (gameMode === 'online' && roomCode) {
        try {
          await endGame(roomCode);
        } catch (_) {}
      }

      if (gameMode === 'offline') saveGameState(state);
      showResults();
    });
  }
}

/* ======= RESULTS WIRING ======= */

function wireResults() {
  btnPlayAgain.addEventListener('click', async () => {
    clearSavedGame();
    stopAutoDraw();
    if (autoDrawToggle) autoDrawToggle.checked = false;
    if (gameMode === 'offline') {
      startOfflineGame();
    } else if (isHost) {
      // Host: first click signals readiness, second click resets room
      if (!btnPlayAgain.dataset.hostReady) {
        // First click: signal readiness
        btnPlayAgain.dataset.hostReady = 'true';
        btnPlayAgain.textContent = '▶ Start New Round';
        if (roomCode) {
          try {
            const { ref: dbRef, update: dbUpdate } = await import('firebase/database');
            const readyRef = dbRef(db, `tambola-rooms/${roomCode}/ready`);
            await dbUpdate(readyRef, { [`player_${playerIndex}`]: true });
          } catch (_) {}
        }
      } else {
        // Second click: reset room to lobby
        if (window._readyCleanup) window._readyCleanup();
        btnPlayAgain.dataset.hostReady = '';
        state = null;
        lastKnownDrawIndex = 0;
        if (roomCode) {
          try {
            await resetRoom(roomCode);
          } catch (err) {
            console.error('Failed to reset room:', err);
            showToast('Failed to reset room.');
          }
        }
        setupLobby();
      }
    } else {
      // Non-host player: signal readiness via Firebase
      if (roomCode && playerIndex != null) {
        try {
          const { ref: dbRef, update: dbUpdate } = await import('firebase/database');
          const readyRef = dbRef(db, `tambola-rooms/${roomCode}/ready`);
          await dbUpdate(readyRef, { [`player_${playerIndex}`]: true });
        } catch (_) {}
      }
      btnPlayAgain.disabled = true;
      btnPlayAgain.textContent = '✓ Ready';
      showToast('Waiting for host to start new round...');
    }
  });

  btnHome.addEventListener('click', async () => {
    clearSavedGame();
    clearOnlineSession();
    stopAutoDraw();
    if (autoDrawToggle) autoDrawToggle.checked = false;
    if (window._readyCleanup) window._readyCleanup();

    // Remove player from online room before leaving
    if (gameMode === 'online' && roomCode) {
      // Signal that this player left (red circle for others)
      if (playerIndex != null) {
        try {
          const { ref: dbRef, update: dbUpdate } = await import('firebase/database');
          const readyRef = dbRef(db, `tambola-rooms/${roomCode}/ready`);
          await dbUpdate(readyRef, { [`player_${playerIndex}`]: 'left' });
        } catch (_) {}
      }

      if (isHost) {
        // Host leaving: delete the entire room
        try {
          const { ref: dbRef, remove: dbRemove } = await import('firebase/database');
          const roomRef = dbRef(db, `tambola-rooms/${roomCode}`);
          await dbRemove(roomRef);
        } catch (_) {}
      } else if (playerIndex != null) {
        // Player leaving: remove themselves
        try {
          await removePlayer(roomCode, playerIndex);
        } catch (_) {}
      }
    }

    state = null;
    if (unsubscribeRoom) {
      unsubscribeRoom();
      unsubscribeRoom = null;
    }
    roomCode = null;
    playerIndex = null;
    isHost = false;
    playerNames = [];
    lastKnownDrawIndex = 0;
    gameMode = 'offline';
    switchView('home');

    // Reset home screen panels
    offlineSetup.hidden = true;
    onlineChoice.hidden = true;
    joinRoomForm.hidden = true;
    btnCreateRoom.hidden = false;
    btnJoinRoom.hidden = false;
  });
}

/* ======= SERVICE WORKER ======= */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('✅ Service Worker registered');

      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
            // New version available — show update toast
            const updateToast = document.getElementById('update-toast');
            const updateBtn = document.getElementById('update-refresh-btn');

            if (updateToast) {
              updateToast.hidden = false;

              if (updateBtn) {
                updateBtn.addEventListener('click', () => {
                  updateToast.hidden = true;
                  window.location.reload();
                }, { once: true });
              }
            }
          }
        });
      });
    } catch (err) {
      console.warn('⚠️ Service Worker registration failed:', err.message);
    }
  });
}

/* ======= INITIALIZATION ======= */

/** Attempts to rejoin an online room after page refresh. */
async function checkOnlineSession() {
  const session = loadOnlineSession();
  if (!session) return false;

  try {
    const result = await rejoinRoom(session.roomCode, session.playerIndex);
    if (!result.success) {
      clearOnlineSession();
      return false;
    }

    // Restore session state
    roomCode = session.roomCode;
    playerIndex = session.playerIndex;
    isHost = session.isHost;
    gameMode = 'online';

    // Set up disconnect handler again
    setupDisconnectHandler(roomCode, playerIndex);

    if (result.status === 'lobby') {
      setupLobby();
    } else if (result.status === 'active') {
      // Fetch full room data to rebuild game state
      const roomRef = ref(db, `tambola-rooms/${roomCode}`);
      const snapshot = await firebaseRetry(() => get(roomRef));
      if (snapshot.exists()) {
        const roomData = snapshot.val();

        // Rebuild player names
        if (roomData.players) {
          const keys = Object.keys(roomData.players).sort();
          playerNames = keys.map((k) => roomData.players[k].name || 'Unknown');
        }

        // Rebuild game state from tickets
        if (roomData.tickets) {
          const ticketKeys = Object.keys(roomData.tickets).sort();
          const tickets = ticketKeys.map((k) => deserializeTicket(roomData.tickets[k]));

          // Map this player's Firebase key to local array index
          const myKey = `player_${playerIndex}`;
          const myLocalIndex = ticketKeys.indexOf(myKey);
          if (myLocalIndex !== -1) {
            playerIndex = myLocalIndex;
          }

          // Rebuild player names from ticket keys
          if (roomData.players) {
            playerNames = ticketKeys.map((k) => {
              const p = roomData.players[k];
              return p ? p.name || 'Unknown' : 'Unknown';
            });
          }

          state = createGameState(tickets.length, tickets);
          state.mode = 'online';
          // Force auto-mark on during rejoin to catch up missed numbers
          state.autoMark = true;
          autoMarkToggle.checked = true;
          lastKnownDrawIndex = 0;

          // Apply drawn numbers
          if (roomData.game && roomData.game.drawnNumbers) {
            handleOnlineGameUpdate(roomData.game);
          }
        }

        setupOnlineGameView();

        // Start listening for further updates
        if (unsubscribeRoom) unsubscribeRoom();
        unsubscribeRoom = listenRoom(roomCode, {
          onPlayersChange: (players) => {
            const playerArr = [];
            const keys = Object.keys(players).sort();
            keys.forEach((key) => playerArr.push(players[key]));
            playerNames = playerArr.map((p) => p.name || 'Unknown');
          },
          onStatusChange: async (status) => {
            if (status === 'lobby') {
              state = null;
              lastKnownDrawIndex = 0;
              setupLobby();
            }
          },
          onGameUpdate: (gameData) => {
            handleOnlineGameUpdate(gameData);
          },
          onMarksChange: () => {},
        });
      }
    } else if (result.status === 'ended') {
      clearOnlineSession();
      return false;
    }

    return true;
  } catch (err) {
    console.warn('Failed to rejoin room:', err);
    clearOnlineSession();
    return false;
  }
}

async function init() {
  // Initialize audio on first interaction
  initAudio();

  // Set mute toggle from persisted state
  muteToggle.checked = isMuted();

  // Wire all event handlers
  wireHomeScreen();
  wireLobby();
  wireGameControls();
  wireResults();

  // Register service worker
  registerServiceWorker();

  // Try to rejoin online session first (survives page refresh)
  const rejoined = await checkOnlineSession();

  // If not rejoining online, check for saved offline game
  if (!rejoined) {
    checkResume();
  }
}

// Start the app
init();
