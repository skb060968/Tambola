import { describe, it, expect } from 'vitest';
import {
  createGameState,
  drawNumber,
  markNumber,
  getClaimablePatterns,
  getNearPatterns,
  getRecentCalls,
} from '../src/game-engine.js';
import { generateTickets } from '../src/ticket-generator.js';

/**
 * Helper: builds a deterministic test ticket.
 * Row 0: cols 0,1,2,3,4 → [1, 10, 20, 30, 40]
 * Row 1: cols 1,2,3,4,5 → [11, 21, 31, 41, 50]
 * Row 2: cols 4,5,6,7,8 → [42, 51, 60, 70, 80]
 */
function makeTestTicket() {
  return [
    [1, 10, 20, 30, 40, 0, 0, 0, 0],
    [0, 11, 21, 31, 41, 50, 0, 0, 0],
    [0, 0, 0, 0, 42, 51, 60, 70, 80],
  ];
}

function allTicketNumbers(ticket) {
  return ticket.flat().filter((v) => v > 0);
}

describe('game-engine', () => {
  describe('createGameState', () => {
    it('creates state with correct structure', () => {
      const tickets = [makeTestTicket(), makeTestTicket()];
      const state = createGameState(2, tickets);

      expect(state.mode).toBe('offline');
      expect(state.playerCount).toBe(2);
      expect(state.tickets).toBe(tickets);
      expect(state.drawnNumbers).toEqual([]);
      expect(state.remainingPool).toHaveLength(90);
      expect(state.markedNumbers).toHaveLength(2);
      expect(state.markedNumbers[0]).toBeInstanceOf(Set);
      expect(state.markedNumbers[0].size).toBe(0);
      expect(state.autoMark).toBe(true);
      expect(state.gameOver).toBe(false);
    });

    it('remaining pool contains 1–90', () => {
      const state = createGameState(1, [makeTestTicket()]);
      expect(state.remainingPool).toEqual(
        Array.from({ length: 90 }, (_, i) => i + 1)
      );
    });

    it('claims are all initially unwon', () => {
      const state = createGameState(1, [makeTestTicket()]);
      for (const key of Object.keys(state.claims)) {
        expect(state.claims[key].won).toBe(false);
        expect(state.claims[key].winner).toBeNull();
      }
    });
  });

  describe('drawNumber', () => {
    it('draws a number from the pool', () => {
      const state = createGameState(1, [makeTestTicket()]);
      const result = drawNumber(state);

      expect(result).not.toBeNull();
      expect(result.number).toBeGreaterThanOrEqual(1);
      expect(result.number).toBeLessThanOrEqual(90);
      expect(result.newState.drawnNumbers).toContain(result.number);
      expect(result.newState.remainingPool).not.toContain(result.number);
    });

    it('reduces remaining pool by 1', () => {
      const state = createGameState(1, [makeTestTicket()]);
      const result = drawNumber(state);
      expect(result.newState.remainingPool).toHaveLength(89);
      expect(result.newState.drawnNumbers).toHaveLength(1);
    });

    it('returns null when pool is empty', () => {
      const state = createGameState(1, [makeTestTicket()]);
      const emptyState = { ...state, remainingPool: [] };
      expect(drawNumber(emptyState)).toBeNull();
    });

    it('auto-marks drawn number on tickets when autoMark is true', () => {
      const ticket = makeTestTicket();
      const state = createGameState(1, [ticket]);
      // Force a specific number to be drawn by setting pool to just that number
      const forcedState = { ...state, remainingPool: [1] };
      const result = drawNumber(forcedState);

      expect(result.number).toBe(1);
      expect(result.newState.markedNumbers[0].has(1)).toBe(true);
    });

    it('does not auto-mark when number is not on ticket', () => {
      const ticket = makeTestTicket();
      const ticketNums = allTicketNumbers(ticket);
      const state = createGameState(1, [ticket]);
      // Pick a number NOT on the ticket
      const notOnTicket = Array.from({ length: 90 }, (_, i) => i + 1).find(
        (n) => !ticketNums.includes(n)
      );
      const forcedState = { ...state, remainingPool: [notOnTicket] };
      const result = drawNumber(forcedState);

      expect(result.newState.markedNumbers[0].size).toBe(0);
    });

    it('does not auto-mark when autoMark is false', () => {
      const ticket = makeTestTicket();
      const state = createGameState(1, [ticket]);
      const forcedState = { ...state, remainingPool: [1], autoMark: false };
      const result = drawNumber(forcedState);

      expect(result.number).toBe(1);
      expect(result.newState.markedNumbers[0].has(1)).toBe(false);
    });

    it('draws all 90 numbers without duplicates', () => {
      let state = createGameState(1, [makeTestTicket()]);
      const drawn = [];
      for (let i = 0; i < 90; i++) {
        const result = drawNumber(state);
        expect(result).not.toBeNull();
        drawn.push(result.number);
        state = result.newState;
      }
      expect(new Set(drawn).size).toBe(90);
      expect(drawNumber(state)).toBeNull();
    });
  });

  describe('markNumber', () => {
    it('marks a called number that is on the ticket', () => {
      const ticket = makeTestTicket();
      let state = createGameState(1, [ticket]);
      state = { ...state, drawnNumbers: [1, 10, 20] };

      const result = markNumber(state, 0, 1);
      expect(result.success).toBe(true);
      expect(result.state.markedNumbers[0].has(1)).toBe(true);
    });

    it('rejects marking an uncalled number', () => {
      const ticket = makeTestTicket();
      const state = createGameState(1, [ticket]);

      const result = markNumber(state, 0, 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('Number has not been called yet');
      expect(result.state.markedNumbers[0].has(1)).toBe(false);
    });

    it('rejects marking a number not on the ticket', () => {
      const ticket = makeTestTicket();
      const ticketNums = allTicketNumbers(ticket);
      const notOnTicket = Array.from({ length: 90 }, (_, i) => i + 1).find(
        (n) => !ticketNums.includes(n)
      );
      let state = createGameState(1, [ticket]);
      state = { ...state, drawnNumbers: [notOnTicket] };

      const result = markNumber(state, 0, notOnTicket);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('Number is not on this ticket');
    });

    it('succeeds silently when number is already marked', () => {
      const ticket = makeTestTicket();
      let state = createGameState(1, [ticket]);
      state = { ...state, drawnNumbers: [1] };

      const first = markNumber(state, 0, 1);
      const second = markNumber(first.state, 0, 1);
      expect(second.success).toBe(true);
    });
  });

  describe('getClaimablePatterns', () => {
    it('returns empty when no numbers are marked', () => {
      const state = createGameState(1, [makeTestTicket()]);
      expect(getClaimablePatterns(state, 0)).toEqual([]);
    });

    it('returns earlyFive when 5 numbers are marked and called', () => {
      const ticket = makeTestTicket();
      let state = createGameState(1, [ticket]);
      const nums = [1, 10, 20, 30, 40];
      state = {
        ...state,
        drawnNumbers: nums,
        markedNumbers: [new Set(nums)],
      };

      const patterns = getClaimablePatterns(state, 0);
      expect(patterns).toContain('earlyFive');
    });

    it('returns firstLine when row 0 is complete', () => {
      const ticket = makeTestTicket();
      const row0 = [1, 10, 20, 30, 40];
      let state = createGameState(1, [ticket]);
      state = {
        ...state,
        drawnNumbers: row0,
        markedNumbers: [new Set(row0)],
      };

      const patterns = getClaimablePatterns(state, 0);
      expect(patterns).toContain('firstLine');
    });

    it('excludes already-won patterns', () => {
      const ticket = makeTestTicket();
      const row0 = [1, 10, 20, 30, 40];
      let state = createGameState(1, [ticket]);
      state = {
        ...state,
        drawnNumbers: row0,
        markedNumbers: [new Set(row0)],
        claims: {
          ...state.claims,
          earlyFive: { won: true, winner: 0 },
          firstLine: { won: true, winner: 0 },
        },
      };

      const patterns = getClaimablePatterns(state, 0);
      expect(patterns).not.toContain('earlyFive');
      expect(patterns).not.toContain('firstLine');
    });

    it('returns fullHouse when all 15 numbers are marked', () => {
      const ticket = makeTestTicket();
      const all = allTicketNumbers(ticket);
      let state = createGameState(1, [ticket]);
      state = {
        ...state,
        drawnNumbers: all,
        markedNumbers: [new Set(all)],
      };

      const patterns = getClaimablePatterns(state, 0);
      expect(patterns).toContain('fullHouse');
    });
  });

  describe('getNearPatterns', () => {
    it('returns empty when no numbers are marked', () => {
      const state = createGameState(1, [makeTestTicket()]);
      expect(getNearPatterns(state, 0)).toEqual([]);
    });

    it('detects near earlyFive (4 marked)', () => {
      const ticket = makeTestTicket();
      let state = createGameState(1, [ticket]);
      state = {
        ...state,
        markedNumbers: [new Set([1, 10, 20, 30])],
      };

      expect(getNearPatterns(state, 0)).toContain('earlyFive');
    });

    it('detects near firstLine (4 of 5 row 0 marked)', () => {
      const ticket = makeTestTicket();
      let state = createGameState(1, [ticket]);
      state = {
        ...state,
        markedNumbers: [new Set([1, 10, 20, 30])], // missing 40
      };

      expect(getNearPatterns(state, 0)).toContain('firstLine');
    });

    it('detects near fullHouse (14 of 15 marked)', () => {
      const ticket = makeTestTicket();
      const all = allTicketNumbers(ticket);
      let state = createGameState(1, [ticket]);
      state = {
        ...state,
        markedNumbers: [new Set(all.slice(0, 14))],
      };

      expect(getNearPatterns(state, 0)).toContain('fullHouse');
    });

    it('does not detect near for already-won patterns', () => {
      const ticket = makeTestTicket();
      let state = createGameState(1, [ticket]);
      state = {
        ...state,
        markedNumbers: [new Set([1, 10, 20, 30])],
        claims: {
          ...state.claims,
          firstLine: { won: true, winner: 0 },
        },
      };

      expect(getNearPatterns(state, 0)).not.toContain('firstLine');
    });
  });

  describe('getRecentCalls', () => {
    it('returns empty array when no numbers drawn', () => {
      const state = createGameState(1, [makeTestTicket()]);
      expect(getRecentCalls(state)).toEqual([]);
    });

    it('returns all drawn when fewer than 5', () => {
      const state = createGameState(1, [makeTestTicket()]);
      const s = { ...state, drawnNumbers: [10, 20, 30] };
      expect(getRecentCalls(s)).toEqual([10, 20, 30]);
    });

    it('returns last 5 when more than 5 drawn', () => {
      const state = createGameState(1, [makeTestTicket()]);
      const s = { ...state, drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8] };
      expect(getRecentCalls(s)).toEqual([4, 5, 6, 7, 8]);
    });

    it('respects custom count parameter', () => {
      const state = createGameState(1, [makeTestTicket()]);
      const s = { ...state, drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8] };
      expect(getRecentCalls(s, 3)).toEqual([6, 7, 8]);
    });

    it('returns exactly 5 when exactly 5 drawn', () => {
      const state = createGameState(1, [makeTestTicket()]);
      const s = { ...state, drawnNumbers: [10, 20, 30, 40, 50] };
      expect(getRecentCalls(s)).toEqual([10, 20, 30, 40, 50]);
    });
  });
});

import {
  saveGameState,
  loadGameState,
  clearSavedGame,
} from '../src/game-engine.js';
import { beforeEach, afterEach } from 'vitest';

// --- localStorage mock for Node environment ---
function createLocalStorageMock() {
  const store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
    get _store() { return store; },
  };
}

describe('saveGameState / loadGameState / clearSavedGame', () => {
  let originalLocalStorage;

  beforeEach(() => {
    originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createLocalStorageMock();
  });

  afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
  });

  function makeSampleState() {
    return createGameState(2, [makeTestTicket(), makeTestTicket()]);
  }

  it('saves and loads a fresh game state (round-trip)', () => {
    const state = makeSampleState();
    const ok = saveGameState(state);
    expect(ok).toBe(true);

    const loaded = loadGameState();
    expect(loaded).not.toBeNull();
    expect(loaded.mode).toBe(state.mode);
    expect(loaded.playerCount).toBe(state.playerCount);
    expect(loaded.tickets).toEqual(state.tickets);
    expect(loaded.drawnNumbers).toEqual(state.drawnNumbers);
    expect(loaded.autoMark).toBe(state.autoMark);
    expect(loaded.gameOver).toBe(state.gameOver);
    expect(loaded.markedNumbers).toHaveLength(2);
    expect(loaded.markedNumbers[0]).toBeInstanceOf(Set);
    expect(loaded.markedNumbers[0].size).toBe(0);
  });

  it('serializes Sets to arrays and deserializes back', () => {
    const state = makeSampleState();
    state.markedNumbers[0] = new Set([1, 10, 20]);
    state.markedNumbers[1] = new Set([42, 51]);
    state.drawnNumbers = [1, 10, 20, 42, 51];

    saveGameState(state);
    const loaded = loadGameState();

    expect(loaded.markedNumbers[0]).toBeInstanceOf(Set);
    expect([...loaded.markedNumbers[0]].sort()).toEqual([1, 10, 20]);
    expect(loaded.markedNumbers[1]).toBeInstanceOf(Set);
    expect([...loaded.markedNumbers[1]].sort()).toEqual([42, 51]);
  });

  it('reconstructs remainingPool from drawnNumbers', () => {
    const state = makeSampleState();
    state.drawnNumbers = [1, 2, 3];
    state.remainingPool = []; // will be ignored during save

    saveGameState(state);
    const loaded = loadGameState();

    expect(loaded.remainingPool).toHaveLength(87);
    expect(loaded.remainingPool).not.toContain(1);
    expect(loaded.remainingPool).not.toContain(2);
    expect(loaded.remainingPool).not.toContain(3);
    expect(loaded.remainingPool).toContain(4);
    expect(loaded.remainingPool).toContain(90);
  });

  it('returns null when no saved game exists', () => {
    expect(loadGameState()).toBeNull();
  });

  it('returns null for corrupted JSON', () => {
    localStorage.setItem('tambola_saved_game', '{not valid json!!!');
    expect(loadGameState()).toBeNull();
  });

  it('clearSavedGame removes the saved state', () => {
    const state = makeSampleState();
    saveGameState(state);
    expect(loadGameState()).not.toBeNull();

    clearSavedGame();
    expect(loadGameState()).toBeNull();
  });

  it('preserves claims state through save/load', () => {
    const state = makeSampleState();
    state.claims.earlyFive = { won: true, winner: 0 };
    state.claims.firstLine = { won: true, winner: 1 };

    saveGameState(state);
    const loaded = loadGameState();

    expect(loaded.claims.earlyFive).toEqual({ won: true, winner: 0 });
    expect(loaded.claims.firstLine).toEqual({ won: true, winner: 1 });
    expect(loaded.claims.secondLine).toEqual({ won: false, winner: null });
  });

  it('returns false when localStorage throws (quota exceeded)', () => {
    const state = makeSampleState();
    globalThis.localStorage = {
      ...createLocalStorageMock(),
      setItem: () => { throw new DOMException('QuotaExceededError'); },
    };

    const ok = saveGameState(state);
    expect(ok).toBe(false);
  });

  it('handles save/load with all 90 numbers drawn', () => {
    const state = makeSampleState();
    state.drawnNumbers = Array.from({ length: 90 }, (_, i) => i + 1);
    state.remainingPool = [];
    state.gameOver = true;

    saveGameState(state);
    const loaded = loadGameState();

    expect(loaded.drawnNumbers).toHaveLength(90);
    expect(loaded.remainingPool).toHaveLength(0);
    expect(loaded.gameOver).toBe(true);
  });

  it('handles save/load with empty drawn list', () => {
    const state = makeSampleState();
    saveGameState(state);
    const loaded = loadGameState();

    expect(loaded.drawnNumbers).toEqual([]);
    expect(loaded.remainingPool).toHaveLength(90);
  });
});
