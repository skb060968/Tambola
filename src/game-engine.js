/**
 * Tambola Game Engine
 *
 * Manages game state: number pool, draws, marking, pattern detection.
 * No DOM or Firebase dependencies — pure logic module.
 */

import { validateClaim, PATTERNS } from './claim-validator.js';

/**
 * Creates the initial game state.
 * @param {number} playerCount - Number of players
 * @param {number[][][]} tickets - One ticket per player (3×9 arrays)
 * @returns {object} Initial game state
 */
export function createGameState(playerCount, tickets) {
  const remainingPool = [];
  for (let i = 1; i <= 90; i++) remainingPool.push(i);

  const markedNumbers = [];
  for (let i = 0; i < playerCount; i++) {
    markedNumbers.push(new Set());
  }

  return {
    mode: 'offline',
    playerCount,
    tickets,
    drawnNumbers: [],
    remainingPool,
    markedNumbers,
    claims: {
      earlyFive: { won: false, winner: null },
      firstLine: { won: false, winner: null },
      secondLine: { won: false, winner: null },
      thirdLine: { won: false, winner: null },
      fullHouse: { won: false, winner: null },
    },
    autoMark: true,
    gameOver: false,
  };
}

/**
 * Draws a random number from the remaining pool.
 * @param {object} state - Current game state
 * @returns {{ number: number, newState: object } | null} Drawn number + updated state, or null if pool empty
 */
export function drawNumber(state) {
  if (state.remainingPool.length === 0) return null;

  const idx = Math.floor(Math.random() * state.remainingPool.length);
  const number = state.remainingPool[idx];

  const newRemainingPool = [
    ...state.remainingPool.slice(0, idx),
    ...state.remainingPool.slice(idx + 1),
  ];
  const newDrawnNumbers = [...state.drawnNumbers, number];

  let newMarkedNumbers = state.markedNumbers;

  if (state.autoMark) {
    newMarkedNumbers = state.markedNumbers.map((marks, playerIndex) => {
      const ticket = state.tickets[playerIndex];
      const ticketNums = ticket.flat().filter((v) => v > 0);
      if (ticketNums.includes(number)) {
        const updated = new Set(marks);
        updated.add(number);
        return updated;
      }
      return marks;
    });
  }

  const newState = {
    ...state,
    drawnNumbers: newDrawnNumbers,
    remainingPool: newRemainingPool,
    markedNumbers: newMarkedNumbers,
  };

  return { number, newState };
}


/**
 * Marks a number on a player's ticket.
 * @param {object} state - Current game state
 * @param {number} playerIndex - Player index
 * @param {number} number - The number to mark
 * @returns {{ state: object, success: boolean, reason?: string }}
 */
export function markNumber(state, playerIndex, number) {
  if (!state.drawnNumbers.includes(number)) {
    return { state, success: false, reason: 'Number has not been called yet' };
  }

  const ticket = state.tickets[playerIndex];
  const ticketNums = ticket.flat().filter((v) => v > 0);
  if (!ticketNums.includes(number)) {
    return { state, success: false, reason: 'Number is not on this ticket' };
  }

  if (state.markedNumbers[playerIndex].has(number)) {
    return { state, success: true };
  }

  const newMarkedNumbers = state.markedNumbers.map((marks, i) => {
    if (i === playerIndex) {
      const updated = new Set(marks);
      updated.add(number);
      return updated;
    }
    return marks;
  });

  return {
    state: { ...state, markedNumbers: newMarkedNumbers },
    success: true,
  };
}

/**
 * Returns patterns that the player could validly claim right now.
 * Only includes patterns not yet won.
 * @param {object} state - Current game state
 * @param {number} playerIndex - Player index
 * @returns {string[]} Array of claimable pattern names
 */
export function getClaimablePatterns(state, playerIndex) {
  const ticket = state.tickets[playerIndex];
  const marked = state.markedNumbers[playerIndex];
  const called = new Set(state.drawnNumbers);
  const claimable = [];

  for (const [key, patternName] of Object.entries(PATTERNS)) {
    if (state.claims[key].won) continue;
    const result = validateClaim(ticket, marked, called, patternName);
    if (result.valid) {
      claimable.push(patternName);
    }
  }

  return claimable;
}

/**
 * Returns patterns where the player is exactly 1 number away from completing.
 * @param {object} state - Current game state
 * @param {number} playerIndex - Player index
 * @returns {string[]} Array of near-complete pattern names
 */
export function getNearPatterns(state, playerIndex) {
  const ticket = state.tickets[playerIndex];
  const marked = state.markedNumbers[playerIndex];
  const near = [];

  // Early Five: need exactly 4 marked numbers on the ticket
  if (!state.claims.earlyFive.won) {
    const ticketNums = ticket.flat().filter((v) => v > 0);
    const markedOnTicket = ticketNums.filter((n) => marked.has(n));
    if (markedOnTicket.length === 4) {
      near.push(PATTERNS.earlyFive);
    }
  }

  // Line patterns: check each row
  const linePatterns = [
    { key: 'firstLine', row: 0 },
    { key: 'secondLine', row: 1 },
    { key: 'thirdLine', row: 2 },
  ];

  for (const { key, row } of linePatterns) {
    if (state.claims[key].won) continue;
    const rowNums = ticket[row].filter((v) => v > 0);
    const unmarked = rowNums.filter((n) => !marked.has(n));
    if (unmarked.length === 1) {
      near.push(PATTERNS[key]);
    }
  }

  // Full House: need exactly 14 of 15 marked
  if (!state.claims.fullHouse.won) {
    const allNums = ticket.flat().filter((v) => v > 0);
    const unmarked = allNums.filter((n) => !marked.has(n));
    if (unmarked.length === 1) {
      near.push(PATTERNS.fullHouse);
    }
  }

  return near;
}

/**
 * Returns the last N drawn numbers (most recent first in the returned array matches draw order).
 * @param {object} state - Current game state
 * @param {number} [count=5] - Number of recent calls to return
 * @returns {number[]} Last N drawn numbers in draw order
 */
export function getRecentCalls(state, count = 5) {
  const len = state.drawnNumbers.length;
  return state.drawnNumbers.slice(Math.max(0, len - count));
}

/**
 * Persists game state to localStorage under 'tambola_saved_game'.
 * Serializes Sets (markedNumbers) to arrays for JSON compatibility.
 * @param {object} state - Current game state
 * @returns {boolean} true if saved successfully, false on error
 */
export function saveGameState(state) {
  try {
    const serializable = {
      mode: state.mode,
      playerCount: state.playerCount,
      tickets: state.tickets,
      drawnNumbers: state.drawnNumbers,
      markedNumbers: state.markedNumbers.map((s) => [...s]),
      claims: state.claims,
      autoMark: state.autoMark,
      gameOver: state.gameOver,
    };
    localStorage.setItem('tambola_saved_game', JSON.stringify(serializable));
    return true;
  } catch (e) {
    console.warn('Failed to save game state:', e.message);
    return false;
  }
}

/**
 * Loads game state from localStorage.
 * Deserializes arrays back to Sets for markedNumbers.
 * Reconstructs remainingPool from drawnNumbers.
 * @returns {object|null} Restored game state, or null if none/corrupted
 */
export function loadGameState() {
  try {
    const raw = localStorage.getItem('tambola_saved_game');
    if (raw === null) return null;

    const parsed = JSON.parse(raw);

    // Reconstruct remainingPool from drawnNumbers
    const drawnSet = new Set(parsed.drawnNumbers);
    const remainingPool = [];
    for (let i = 1; i <= 90; i++) {
      if (!drawnSet.has(i)) remainingPool.push(i);
    }

    return {
      mode: parsed.mode,
      playerCount: parsed.playerCount,
      tickets: parsed.tickets,
      drawnNumbers: parsed.drawnNumbers,
      remainingPool,
      markedNumbers: parsed.markedNumbers.map((arr) => new Set(arr)),
      claims: parsed.claims,
      autoMark: parsed.autoMark,
      gameOver: parsed.gameOver,
    };
  } catch (e) {
    console.warn('Failed to load game state:', e.message);
    return null;
  }
}

/**
 * Removes saved game from localStorage.
 */
export function clearSavedGame() {
  localStorage.removeItem('tambola_saved_game');
}
