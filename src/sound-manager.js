/**
 * Sound Manager for Tambola Game
 *
 * Handles audio playback with AudioContext (preferred) and HTML Audio fallback.
 * Supports mute toggle persisted to localStorage, and respects device silent mode.
 * Unlocks AudioContext on first user interaction (Safari/iOS requirement).
 */

const SOUND_FILES = {
  draw: '/sounds/draw.mp3',
  mark: '/sounds/mark.mp3',
  win: '/sounds/win.mp3',
  error: '/sounds/error.mp3',
  claim: '/sounds/claim.mp3',
};

const MUTE_KEY = 'tambola_muted';

let audioCtx = null;
let soundBuffers = {};
let initialized = false;

/**
 * Creates or returns the AudioContext instance.
 * Handles vendor-prefixed WebkitAudioContext for Safari.
 */
function getAudioContext() {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      audioCtx = new AudioCtx();
    }
  }
  return audioCtx;
}

/**
 * Resumes a suspended AudioContext (required after Safari/iOS policy).
 */
async function resumeContext() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (_) {
      // Silently ignore resume failures
    }
  }
}

/**
 * Fetches and decodes an audio file into an AudioBuffer.
 */
async function loadSoundBuffer(name, url) {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const response = await fetch(url);
    if (!response.ok) return;
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    soundBuffers[name] = audioBuffer;
  } catch (_) {
    // Sound file not available yet — fail silently
  }
}

/**
 * Pre-loads all sound buffers.
 */
function preloadSounds() {
  const entries = Object.entries(SOUND_FILES);
  for (const [name, url] of entries) {
    loadSoundBuffer(name, url);
  }
}

/**
 * Unlock handler attached to first user interaction.
 * Resumes AudioContext and pre-loads sound buffers.
 */
async function unlockHandler() {
  await resumeContext();
  preloadSounds();
  initialized = true;
}

/**
 * Initializes audio by attaching unlock listeners to the first user interaction.
 * Must be called early (e.g., on DOMContentLoaded).
 * Attaches to click, touchstart, and keydown with { once: true } so the
 * handler fires only on the very first interaction.
 */
export function initAudio() {
  if (initialized) return;

  // Pre-load sound buffers immediately (will work once AudioContext is unlocked)
  getAudioContext();
  preloadSounds();

  const events = ['click', 'touchstart', 'keydown'];
  for (const event of events) {
    document.addEventListener(event, unlockHandler, { once: true });
  }
}

/**
 * Plays a sound by name using AudioContext buffer source.
 * Falls back to HTML Audio element if AudioContext is unavailable or buffer not loaded.
 *
 * @param {string} name - One of 'draw', 'mark', 'win', 'error', 'claim'
 */
export function playSound(name) {
  if (isMuted()) return;

  const url = SOUND_FILES[name];
  if (!url) return;

  const ctx = getAudioContext();

  // Check if AudioContext is in a state that won't produce sound (device silent mode)
  if (ctx && ctx.state === 'suspended') {
    // Attempt resume but don't block playback
    resumeContext();
  }

  // Preferred path: AudioContext buffer source
  if (ctx && ctx.state === 'running' && soundBuffers[name]) {
    try {
      const source = ctx.createBufferSource();
      source.buffer = soundBuffers[name];
      source.connect(ctx.destination);
      source.start(0);
      return;
    } catch (_) {
      // Fall through to HTML Audio fallback
    }
  }

  // Fallback: HTML Audio element
  try {
    const audio = new Audio(url);
    audio.play().catch(() => {
      // Autoplay blocked or file missing — fail silently
    });
  } catch (_) {
    // Audio constructor not available — fail silently
  }
}

/**
 * Toggles the mute state and persists it to localStorage.
 * @returns {boolean} The new mute state (true = muted)
 */
export function toggleMute() {
  const newMuted = !isMuted();
  try {
    localStorage.setItem(MUTE_KEY, JSON.stringify(newMuted));
  } catch (_) {
    // localStorage full or unavailable — continue without persistence
  }
  return newMuted;
}

/**
 * Reads the current mute state from localStorage.
 * @returns {boolean} true if muted, false otherwise
 */
export function isMuted() {
  try {
    const stored = localStorage.getItem(MUTE_KEY);
    if (stored !== null) {
      return JSON.parse(stored) === true;
    }
  } catch (_) {
    // Corrupted or unavailable localStorage — default to unmuted
  }
  return false;
}

/**
 * Speaks a drawn number aloud using the browser's Speech Synthesis API.
 * Respects mute state. Falls back silently if speech synthesis is unavailable.
 * @param {number} number - The number to announce (1–90)
 */
export function speakNumber(number) {
  if (isMuted()) return;
  if (!('speechSynthesis' in window)) return;

  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`Number ${number}`);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    speechSynthesis.speak(utterance);
  } catch (_) {}
}

/**
 * Speaks a win announcement aloud.
 * Returns a promise that resolves when speech finishes.
 * @param {string} playerName - The winning player's name
 * @param {string} patternLabel - The pattern display name (e.g. "Early Five")
 * @returns {Promise<void>}
 */
export function speakAnnouncement(playerName, patternLabel) {
  if (isMuted()) return Promise.resolve();
  if (!('speechSynthesis' in window)) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(`${playerName} got ${patternLabel}`);
      utterance.rate = 0.9;
      utterance.pitch = 1.1;
      utterance.volume = 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
      // Safety timeout in case onend never fires
      setTimeout(resolve, 4000);
    } catch (_) {
      resolve();
    }
  });
}
