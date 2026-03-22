// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toggleMute, isMuted, initAudio, playSound } from '../src/sound-manager.js';

describe('sound-manager', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('isMuted', () => {
    it('returns false by default when nothing in localStorage', () => {
      expect(isMuted()).toBe(false);
    });

    it('returns true when localStorage has tambola_muted = true', () => {
      localStorage.setItem('tambola_muted', 'true');
      expect(isMuted()).toBe(true);
    });

    it('returns false when localStorage has tambola_muted = false', () => {
      localStorage.setItem('tambola_muted', 'false');
      expect(isMuted()).toBe(false);
    });

    it('returns false when localStorage has corrupted value', () => {
      localStorage.setItem('tambola_muted', 'not-json');
      expect(isMuted()).toBe(false);
    });
  });

  describe('toggleMute', () => {
    it('toggles from unmuted to muted', () => {
      const result = toggleMute();
      expect(result).toBe(true);
      expect(isMuted()).toBe(true);
    });

    it('toggles from muted to unmuted', () => {
      localStorage.setItem('tambola_muted', 'true');
      const result = toggleMute();
      expect(result).toBe(false);
      expect(isMuted()).toBe(false);
    });

    it('persists mute state to localStorage', () => {
      toggleMute();
      expect(localStorage.getItem('tambola_muted')).toBe('true');
      toggleMute();
      expect(localStorage.getItem('tambola_muted')).toBe('false');
    });

    it('round-trips correctly through multiple toggles', () => {
      expect(isMuted()).toBe(false);
      toggleMute(); // → true
      expect(isMuted()).toBe(true);
      toggleMute(); // → false
      expect(isMuted()).toBe(false);
      toggleMute(); // → true
      expect(isMuted()).toBe(true);
    });
  });

  describe('playSound', () => {
    it('does not throw for valid sound names when muted', () => {
      localStorage.setItem('tambola_muted', 'true');
      expect(() => playSound('draw')).not.toThrow();
      expect(() => playSound('mark')).not.toThrow();
      expect(() => playSound('win')).not.toThrow();
      expect(() => playSound('error')).not.toThrow();
      expect(() => playSound('claim')).not.toThrow();
    });

    it('does not throw for unknown sound names', () => {
      expect(() => playSound('nonexistent')).not.toThrow();
    });
  });

  describe('initAudio', () => {
    it('does not throw when called', () => {
      expect(() => initAudio()).not.toThrow();
    });

    it('can be called multiple times without error', () => {
      expect(() => {
        initAudio();
        initAudio();
      }).not.toThrow();
    });
  });
});
