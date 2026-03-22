/**
 * Tambola UI Renderer
 *
 * DOM manipulation, spinning ball animation, ticket rendering,
 * number board, view switching, and celebration effects.
 * No game logic — pure rendering module.
 */

/**
 * Pattern display names for UI labels.
 */
const PATTERN_LABELS = {
  earlyFive: 'Early 5',
  firstLine: '1st Line',
  secondLine: '2nd Line',
  thirdLine: '3rd Line',
  fullHouse: 'Full House',
};

/**
 * Renders a 3×9 ticket grid inside the given container.
 * @param {number[][]} ticket - 3×9 array (0 = blank)
 * @param {Set<number>} markedNumbers - Set of marked numbers
 * @param {string} containerId - DOM id of the ticket container
 * @param {string} [playerLabel] - Label shown above the ticket (e.g. "Player 1")
 */
export function renderTicket(ticket, markedNumbers, containerId, playerLabel) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  if (playerLabel) {
    const label = document.createElement('p');
    label.className = 'ticket-label';
    label.textContent = playerLabel;
    container.appendChild(label);
  }

  const grid = document.createElement('div');
  grid.className = 'ticket';

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 9; col++) {
      const val = ticket[row][col];
      const cell = document.createElement('div');
      cell.className = 'ticket-cell';

      if (val > 0) {
        cell.classList.add('has-number');
        cell.textContent = val;
        cell.dataset.number = val;

        if (markedNumbers && markedNumbers.has(val)) {
          cell.classList.add('marked');
        }
      } else {
        cell.classList.add('blank');
      }

      grid.appendChild(cell);
    }
  }

  container.appendChild(grid);
}


/**
 * Renders the 1–90 number board (10 columns × 9 rows).
 * Row 1 = 1–10, row 2 = 11–20, ..., row 9 = 81–90.
 * @param {number[]} calledNumbers - Array of called numbers
 * @param {string} containerId - DOM id of the number board container
 */
export function renderNumberBoard(calledNumbers, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  const calledSet = new Set(calledNumbers);
  const lastCalled = calledNumbers.length > 0
    ? calledNumbers[calledNumbers.length - 1]
    : null;

  for (let num = 1; num <= 90; num++) {
    const cell = document.createElement('div');
    cell.className = 'board-cell';
    cell.textContent = num;
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-label', `Number ${num}${calledSet.has(num) ? ', called' : ''}`);

    if (calledSet.has(num)) {
      cell.classList.add('called');
    }

    if (num === lastCalled) {
      cell.classList.add('just-called');
      // Remove just-called after animation completes
      cell.addEventListener('animationend', () => {
        cell.classList.remove('just-called');
      }, { once: true });
    }

    container.appendChild(cell);
  }
}

/**
 * Triggers the 3D ball spin animation and reveals the drawn number.
 * Uses #ball-sphere and #ball-number elements from index.html.
 * @param {number} number - The drawn number to display
 * @param {Function} [onComplete] - Callback after animation finishes (~800ms)
 */
export function renderSpinningBall(number, onComplete) {
  const sphere = document.getElementById('ball-sphere');
  const ballNumber = document.getElementById('ball-number');
  if (!sphere || !ballNumber) {
    if (onComplete) onComplete();
    return;
  }

  // Reset classes
  sphere.classList.remove('spinning', 'settled');

  // Update number text before spin
  ballNumber.textContent = number;

  // Force reflow so animation restarts
  void sphere.offsetWidth;

  // Start spinning
  sphere.classList.add('spinning');

  // After 600ms spin, settle
  setTimeout(() => {
    sphere.classList.remove('spinning');
    sphere.classList.add('settled');

    // Call onComplete after settle transition (~200ms more)
    setTimeout(() => {
      if (onComplete) onComplete();
    }, 200);
  }, 600);
}

/**
 * Renders the last 5 drawn numbers in the recent-calls strip.
 * Most recent number appears first (largest/brightest via CSS :first-child).
 * @param {number[]} lastFive - Array of last 5 numbers in draw order
 */
export function renderRecentCalls(lastFive) {
  const container = document.getElementById('recent-calls');
  if (!container) return;

  container.innerHTML = '';

  // Display most recent first
  const reversed = [...lastFive].reverse();

  for (const num of reversed) {
    const span = document.createElement('span');
    span.className = 'recent-number';
    span.textContent = num;
    container.appendChild(span);
  }
}


/**
 * Triggers confetti celebration and shows a temporary announcement overlay.
 * Uses canvas-confetti library with a typeof guard.
 * @param {string} pattern - The pattern name (e.g. 'firstLine')
 * @param {string} playerName - The winning player's name
 */
export function showCelebration(pattern, playerName) {
  const label = PATTERN_LABELS[pattern] || pattern;

  // Fire confetti if available
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.6 },
    });
  }

  // Create temporary overlay announcement
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '2000';
  overlay.innerHTML = `
    <div class="modal-box" style="background: linear-gradient(180deg, #2ecc71, #27ae60); color: #fff;">
      <h3>🏆 ${label}</h3>
      <p style="font-size: 1.1rem; font-weight: 700; margin-top: 8px;">${playerName} wins!</p>
    </div>
  `;

  document.body.appendChild(overlay);

  // Auto-remove after 2.5 seconds
  setTimeout(() => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }, 2500);
}

/**
 * Updates claim button states based on claimable and won patterns.
 * @param {string[]} claimablePatterns - Patterns the current player can claim
 * @param {object} wonPatterns - Map of pattern keys to { won: boolean }
 * @param {Function} onClaim - Callback called with pattern key when a claim button is clicked
 */
export function showClaimButtons(claimablePatterns, wonPatterns, onClaim) {
  const container = document.getElementById('claim-buttons');
  if (!container) return;

  const buttons = container.querySelectorAll('.claim-btn');

  buttons.forEach((btn) => {
    const pattern = btn.dataset.pattern;
    if (!pattern) return;

    // Reset classes
    btn.classList.remove('won', 'available');
    btn.disabled = false;

    // Remove old click listeners by cloning
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    if (wonPatterns && wonPatterns[pattern] && wonPatterns[pattern].won) {
      // Won pattern: disabled with green indicator
      newBtn.classList.add('won');
      newBtn.disabled = true;
    } else if (claimablePatterns && claimablePatterns.includes(pattern)) {
      // Claimable: highlighted and clickable
      newBtn.classList.add('available');
      newBtn.addEventListener('click', () => {
        if (onClaim) onClaim(pattern);
      });
    } else {
      // Default state: clickable but not highlighted
      newBtn.addEventListener('click', () => {
        if (onClaim) onClaim(pattern);
      });
    }
  });
}

/**
 * Updates the marked count display.
 * @param {number} count - Number of marked cells
 */
export function updateMarkedCount(count) {
  const el = document.getElementById('marked-count-value');
  if (el) {
    el.textContent = count;
  }
}


/**
 * Shows one view and hides all others.
 * @param {'home'|'lobby'|'game'|'results'} viewName - The view to show
 */
export function switchView(viewName) {
  const views = ['home', 'lobby', 'game', 'results'];

  for (const name of views) {
    const el = document.getElementById(`view-${name}`);
    if (!el) continue;

    if (name === viewName) {
      el.removeAttribute('hidden');
    } else {
      el.setAttribute('hidden', '');
    }
  }
}

/**
 * Adds or removes the `.near-pattern` class on ticket elements
 * to indicate the player is close to winning.
 * @param {string[]} patterns - Array of near-complete pattern names (empty to clear)
 */
export function showNearPatternIndicator(patterns) {
  const tickets = document.querySelectorAll('.ticket');

  tickets.forEach((ticket) => {
    if (patterns && patterns.length > 0) {
      ticket.classList.add('near-pattern');
    } else {
      ticket.classList.remove('near-pattern');
    }
  });
}

/**
 * Shows a temporary warning toast message.
 * @param {string} message - The toast message text
 * @param {number} [duration=1500] - Duration in ms before auto-removal
 */
export function showToast(message, duration = 1500) {
  const toast = document.createElement('div');
  toast.className = 'game-toast';
  toast.textContent = message;
  toast.setAttribute('role', 'alert');

  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, duration);
}

/**
 * Renders the results view with all pattern winners.
 * @param {object} claims - Claims object { earlyFive: { won, winner }, ... }
 * @param {string[]} playerNames - Array of player display names indexed by player index
 */
export function renderWinnerSummary(claims, playerNames) {
  const container = document.getElementById('winner-summary');
  if (!container) return;

  container.innerHTML = '';

  const patternOrder = ['earlyFive', 'firstLine', 'secondLine', 'thirdLine', 'fullHouse'];

  for (const key of patternOrder) {
    const claim = claims[key];
    const label = PATTERN_LABELS[key] || key;

    const row = document.createElement('div');
    row.className = 'winner-row';

    const patternSpan = document.createElement('span');
    patternSpan.className = 'pattern-name';
    patternSpan.textContent = label;

    const winnerSpan = document.createElement('span');
    winnerSpan.className = 'winner-name';

    if (claim && claim.won && claim.winner != null) {
      winnerSpan.textContent = playerNames[claim.winner] || `Player ${claim.winner + 1}`;
    } else {
      row.classList.add('unclaimed');
      winnerSpan.textContent = 'Unclaimed';
    }

    row.appendChild(patternSpan);
    row.appendChild(winnerSpan);
    container.appendChild(row);
  }
}

/**
 * Renders the player list in the lobby view.
 * @param {Array<{name: string, uid?: string}>} players - Array of player objects
 * @param {boolean} isHost - Whether the current user is the host
 * @param {Function} [onRemove] - Callback called with player index when host removes a player
 */
export function renderLobbyPlayers(players, isHost, onRemove) {
  const list = document.getElementById('player-list');
  if (!list) return;

  list.innerHTML = '';

  players.forEach((player, index) => {
    const li = document.createElement('li');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = player.name || `Player ${index + 1}`;
    li.appendChild(nameSpan);

    if (index === 0) {
      // First player is the host
      const badge = document.createElement('span');
      badge.className = 'host-badge';
      badge.textContent = 'HOST';
      li.appendChild(badge);
    } else if (isHost && onRemove) {
      // Host can remove other players
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', `Remove ${player.name || 'player'}`);
      removeBtn.addEventListener('click', () => onRemove(index));
      li.appendChild(removeBtn);
    }

    list.appendChild(li);
  });
}
