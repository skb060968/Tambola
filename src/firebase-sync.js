/**
 * Tambola Firebase Sync Module
 *
 * Handles all Firebase Realtime Database operations for online multiplayer:
 * room lifecycle, real-time sync, disconnect handling, and retry logic.
 *
 * All data is stored under `tambola-rooms/` (separate from Snakes & Ladders `rooms/`).
 */

import { db, auth } from './firebase-config.js';
import {
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  off,
  onDisconnect,
} from 'firebase/database';
import { serializeTicket } from './ticket-generator.js';

/** Characters used for room codes — excludes ambiguous 0, O, I, l, 1 */
const ROOM_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Retry wrapper for Firebase write operations with exponential backoff.
 * @param {Function} fn - Async function to retry
 * @param {number} [maxRetries=2] - Maximum number of retries
 * @param {number} [delayMs=500] - Base delay in milliseconds
 * @returns {Promise<*>} Result of the function call
 */
export async function firebaseRetry(fn, maxRetries = 2, delayMs = 500) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.warn(
        `⚠️ Firebase retry ${attempt + 1}/${maxRetries}:`,
        err.message
      );
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
}

/**
 * Generates a 6-character room code from the allowed charset.
 * Excludes ambiguous characters: 0, O, I, l, 1.
 * @returns {string} 6-character room code
 */
export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(Math.random() * ROOM_CODE_CHARSET.length);
    code += ROOM_CODE_CHARSET[idx];
  }
  return code;
}

/**
 * Creates a new online room in Firebase.
 * The host is automatically added as player_0.
 * @param {string} hostName - Display name of the host
 * @returns {Promise<{ roomCode: string, playerIndex: number }>}
 */
export async function createRoom(hostName) {
  const uid = auth.currentUser?.uid || 'anonymous';
  const roomCode = generateRoomCode();
  const roomRef = ref(db, `tambola-rooms/${roomCode}`);

  const roomData = {
    meta: {
      hostUid: uid,
      hostName: hostName,
      status: 'lobby',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    players: {
      player_0: {
        name: hostName,
        uid: uid,
        connected: true,
      },
    },
    tickets: {},
    game: {
      drawnNumbers: [],
      currentNumber: null,
      drawIndex: 0,
      claims: {
        earlyFive: { won: false },
        firstLine: { won: false },
        secondLine: { won: false },
        thirdLine: { won: false },
        fullHouse: { won: false },
      },
    },
    marks: {},
  };

  await firebaseRetry(() => set(roomRef, roomData));

  return { roomCode, playerIndex: 0 };
}

/**
 * Joins an existing room as a new player.
 * Rejects if the game is already active.
 * @param {string} roomCode - The 6-character room code
 * @param {string} playerName - Display name of the joining player
 * @returns {Promise<{ success: boolean, playerIndex?: number, role?: string, reason?: string }>}
 */
export async function joinRoom(roomCode, playerName) {
  const roomRef = ref(db, `tambola-rooms/${roomCode}`);

  const snapshot = await firebaseRetry(() => get(roomRef));

  if (!snapshot.exists()) {
    return { success: false, reason: 'Room not found' };
  }

  const data = snapshot.val();

  if (data.meta.status === 'active') {
    return { success: false, reason: 'Game already in progress' };
  }

  if (data.meta.status === 'ended') {
    return { success: false, reason: 'Game has ended' };
  }

  // Find the next available player index
  const players = data.players || {};
  const existingIndices = Object.keys(players)
    .map((key) => parseInt(key.replace('player_', ''), 10))
    .filter((n) => !isNaN(n));
  const nextIndex =
    existingIndices.length > 0 ? Math.max(...existingIndices) + 1 : 0;

  const uid = auth.currentUser?.uid || 'anonymous';
  const playerKey = `player_${nextIndex}`;

  await firebaseRetry(() =>
    update(ref(db, `tambola-rooms/${roomCode}`), {
      [`players/${playerKey}`]: {
        name: playerName,
        uid: uid,
        connected: true,
      },
      'meta/updatedAt': Date.now(),
    })
  );

  return { success: true, playerIndex: nextIndex, role: 'player' };
}

/**
 * Rejoins an existing room after a page refresh.
 * Marks the player as connected again without checking game status.
 * @param {string} roomCode - The room code
 * @param {number} playerIndex - The player's index in the room
 * @returns {Promise<{ success: boolean, status?: string, reason?: string }>}
 */
export async function rejoinRoom(roomCode, playerIndex) {
  const roomRef = ref(db, `tambola-rooms/${roomCode}`);

  const snapshot = await firebaseRetry(() => get(roomRef));

  if (!snapshot.exists()) {
    return { success: false, reason: 'Room no longer exists' };
  }

  const data = snapshot.val();
  const playerKey = `player_${playerIndex}`;

  if (!data.players || !data.players[playerKey]) {
    return { success: false, reason: 'Player not found in room' };
  }

  // Mark as connected again
  await firebaseRetry(() =>
    update(ref(db, `tambola-rooms/${roomCode}/players/${playerKey}`), {
      connected: true,
    })
  );

  return { success: true, status: data.meta.status };
}

/**
 * Subscribes to real-time room changes via Firebase onValue.
 * @param {string} roomCode - The room code to listen to
 * @param {object} callbacks - Callback functions for different data changes
 * @param {Function} [callbacks.onPlayersChange] - Called when players data changes
 * @param {Function} [callbacks.onGameUpdate] - Called when game data changes
 * @param {Function} [callbacks.onStatusChange] - Called when room status changes
 * @param {Function} [callbacks.onMarksChange] - Called when marks data changes
 * @param {Function} [callbacks.onRoomDeleted] - Called when the room is deleted
 * @returns {Function} Unsubscribe function to stop listening
 */
export function listenRoom(roomCode, callbacks) {
  const roomRef = ref(db, `tambola-rooms/${roomCode}`);

  const handler = (snapshot) => {
    if (!snapshot.exists()) {
      if (callbacks.onRoomDeleted) callbacks.onRoomDeleted();
      return;
    }
    const data = snapshot.val();

    if (callbacks.onPlayersChange && data.players) {
      callbacks.onPlayersChange(data.players);
    }
    if (callbacks.onGameUpdate && data.game) {
      callbacks.onGameUpdate(data.game);
    }
    if (callbacks.onStatusChange && data.meta) {
      callbacks.onStatusChange(data.meta.status);
    }
    if (callbacks.onMarksChange && data.marks) {
      callbacks.onMarksChange(data.marks);
    }
  };

  onValue(roomRef, handler);

  // Return unsubscribe function
  return () => {
    off(roomRef, 'value', handler);
  };
}

/**
 * Host broadcasts a drawn number to all players.
 * Appends to drawnNumbers array and sets currentNumber.
 * @param {string} roomCode - The room code
 * @param {number} number - The drawn number
 */
export async function broadcastDraw(roomCode, number) {
  const gameRef = ref(db, `tambola-rooms/${roomCode}/game`);

  const snapshot = await firebaseRetry(() => get(gameRef));
  const game = snapshot.val() || {};
  const drawnNumbers = game.drawnNumbers || [];
  const newDrawnNumbers = [...drawnNumbers, number];

  await firebaseRetry(() =>
    update(gameRef, {
      drawnNumbers: newDrawnNumbers,
      currentNumber: number,
      drawIndex: newDrawnNumbers.length,
    })
  );
}

/**
 * Submits a claim for a winning pattern.
 * Writes the claim to game/claims/{pattern}.
 * @param {string} roomCode - The room code
 * @param {number} playerIndex - The claiming player's index
 * @param {string} pattern - The pattern being claimed (e.g., 'earlyFive')
 */
export async function submitClaim(roomCode, playerIndex, pattern) {
  await firebaseRetry(() =>
    update(ref(db, `tambola-rooms/${roomCode}/game/claims/${pattern}`), {
      won: true,
      winner: playerIndex,
      wonAt: Date.now(),
    })
  );
}

/**
 * Host starts the game: sets status to "active" and writes serialized tickets.
 * @param {string} roomCode - The room code
 * @param {number[][][]} tickets - Array of tickets, one per player
 */
export async function startGame(roomCode, tickets) {
  const serializedTickets = {};
  tickets.forEach((ticket, index) => {
    serializedTickets[`player_${index}`] = serializeTicket(ticket);
  });

  await firebaseRetry(() =>
    update(ref(db, `tambola-rooms/${roomCode}`), {
      'meta/status': 'active',
      'meta/updatedAt': Date.now(),
      tickets: serializedTickets,
    })
  );
}

/**
 * Host ends the game: sets status to "ended".
 * @param {string} roomCode - The room code
 */
export async function endGame(roomCode) {
  await firebaseRetry(() =>
    update(ref(db, `tambola-rooms/${roomCode}/meta`), {
      status: 'ended',
      updatedAt: Date.now(),
    })
  );
}

/**
 * Resets the room for a new round: clears game data, tickets, marks,
 * and sets status back to "lobby". Players stay connected.
 * @param {string} roomCode - The room code
 */
export async function resetRoom(roomCode) {
  await firebaseRetry(() =>
    update(ref(db, `tambola-rooms/${roomCode}`), {
      'meta/status': 'lobby',
      'meta/updatedAt': Date.now(),
      tickets: {},
      game: {
        drawnNumbers: [],
        currentNumber: null,
        drawIndex: 0,
        claims: {
          earlyFive: { won: false },
          firstLine: { won: false },
          secondLine: { won: false },
          thirdLine: { won: false },
          fullHouse: { won: false },
        },
      },
      marks: {},
      ready: {},
    })
  );
}

/**
 * Host removes a player from the lobby.
 * @param {string} roomCode - The room code
 * @param {number} playerIndex - The player index to remove
 */
export async function removePlayer(roomCode, playerIndex) {
  const playerRef = ref(
    db,
    `tambola-rooms/${roomCode}/players/player_${playerIndex}`
  );
  await firebaseRetry(() => remove(playerRef));
}

/**
 * Sets up an onDisconnect handler to mark a player as disconnected
 * when their connection drops.
 * @param {string} roomCode - The room code
 * @param {number} playerIndex - The player index
 */
export function setupDisconnectHandler(roomCode, playerIndex) {
  const connectedRef = ref(
    db,
    `tambola-rooms/${roomCode}/players/player_${playerIndex}/connected`
  );
  onDisconnect(connectedRef)
    .set(false)
    .catch((err) => {
      console.warn('⚠️ onDisconnect setup failed:', err.message);
    });
}
