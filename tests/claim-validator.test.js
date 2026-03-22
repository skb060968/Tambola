import { describe, it, expect } from 'vitest';
import { validateClaim, PATTERNS } from '../src/claim-validator.js';

/**
 * Helper: builds a simple ticket where row 0 has numbers in cols 0–4,
 * row 1 in cols 1–5, row 2 in cols 4–8. Each row has exactly 5 numbers.
 * This is a structurally valid ticket for testing purposes.
 */
function makeTestTicket() {
  // Row 0: cols 0,1,2,3,4
  // Row 1: cols 1,2,3,4,5
  // Row 2: cols 4,5,6,7,8
  return [
    [1, 10, 20, 30, 40, 0, 0, 0, 0],
    [0, 11, 21, 31, 41, 50, 0, 0, 0],
    [0, 0, 0, 0, 42, 51, 60, 70, 80],
  ];
}

function allTicketNumbers(ticket) {
  return ticket.flat().filter((v) => v > 0);
}

describe('claim-validator', () => {
  describe('PATTERNS', () => {
    it('exports all five pattern keys', () => {
      expect(PATTERNS).toEqual({
        earlyFive: 'earlyFive',
        firstLine: 'firstLine',
        secondLine: 'secondLine',
        thirdLine: 'thirdLine',
        fullHouse: 'fullHouse',
      });
    });
  });

  describe('validateClaim — unknown pattern', () => {
    it('rejects an unknown pattern', () => {
      const ticket = makeTestTicket();
      const result = validateClaim(ticket, new Set(), new Set(), 'diagonal');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unknown pattern');
    });
  });

  describe('validateClaim — earlyFive', () => {
    it('valid when 5 marked numbers are all called', () => {
      const ticket = makeTestTicket();
      const marked = new Set([1, 10, 20, 30, 40]);
      const called = new Set([1, 10, 20, 30, 40, 50, 60]);
      const result = validateClaim(ticket, marked, called, PATTERNS.earlyFive);
      expect(result.valid).toBe(true);
    });

    it('valid when more than 5 marked numbers are all called', () => {
      const ticket = makeTestTicket();
      const marked = new Set([1, 10, 20, 30, 40, 50]);
      const called = new Set([1, 10, 20, 30, 40, 50]);
      const result = validateClaim(ticket, marked, called, PATTERNS.earlyFive);
      expect(result.valid).toBe(true);
    });

    it('invalid when fewer than 5 numbers marked', () => {
      const ticket = makeTestTicket();
      const marked = new Set([1, 10, 20]);
      const called = new Set([1, 10, 20, 30, 40]);
      const result = validateClaim(ticket, marked, called, PATTERNS.earlyFive);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Only 3 numbers marked, need at least 5');
    });

    it('invalid when 5 marked but some not called', () => {
      const ticket = makeTestTicket();
      const marked = new Set([1, 10, 20, 30, 40]);
      const called = new Set([1, 10, 20]); // 30 and 40 not called
      const result = validateClaim(ticket, marked, called, PATTERNS.earlyFive);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Only 3 numbers marked, need at least 5');
    });

    it('invalid with 0 marks', () => {
      const ticket = makeTestTicket();
      const result = validateClaim(ticket, new Set(), new Set([1, 2, 3]), PATTERNS.earlyFive);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Only 0 numbers marked');
    });
  });

  describe('validateClaim — firstLine', () => {
    it('valid when all row 0 numbers are marked and called', () => {
      const ticket = makeTestTicket();
      const row0 = [1, 10, 20, 30, 40];
      const marked = new Set(row0);
      const called = new Set([...row0, 50, 60]);
      const result = validateClaim(ticket, marked, called, PATTERNS.firstLine);
      expect(result.valid).toBe(true);
    });

    it('invalid when one row 0 number is not marked', () => {
      const ticket = makeTestTicket();
      const marked = new Set([1, 10, 20, 30]); // missing 40
      const called = new Set([1, 10, 20, 30, 40]);
      const result = validateClaim(ticket, marked, called, PATTERNS.firstLine);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('missing numbers: 40');
    });

    it('invalid when row 0 number is marked but not called', () => {
      const ticket = makeTestTicket();
      const marked = new Set([1, 10, 20, 30, 40]);
      const called = new Set([1, 10, 20, 30]); // 40 not called
      const result = validateClaim(ticket, marked, called, PATTERNS.firstLine);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('40');
    });
  });

  describe('validateClaim — secondLine', () => {
    it('valid when all row 1 numbers are marked and called', () => {
      const ticket = makeTestTicket();
      const row1 = [11, 21, 31, 41, 50];
      const marked = new Set(row1);
      const called = new Set([...row1, 1, 10]);
      const result = validateClaim(ticket, marked, called, PATTERNS.secondLine);
      expect(result.valid).toBe(true);
    });

    it('invalid when row 1 is incomplete', () => {
      const ticket = makeTestTicket();
      const marked = new Set([11, 21, 31]); // missing 41, 50
      const called = new Set([11, 21, 31, 41, 50]);
      const result = validateClaim(ticket, marked, called, PATTERNS.secondLine);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Row 2 is not complete');
      expect(result.reason).toContain('41');
      expect(result.reason).toContain('50');
    });
  });

  describe('validateClaim — thirdLine', () => {
    it('valid when all row 2 numbers are marked and called', () => {
      const ticket = makeTestTicket();
      const row2 = [42, 51, 60, 70, 80];
      const marked = new Set(row2);
      const called = new Set([...row2, 1, 10]);
      const result = validateClaim(ticket, marked, called, PATTERNS.thirdLine);
      expect(result.valid).toBe(true);
    });

    it('invalid when row 2 has missing numbers', () => {
      const ticket = makeTestTicket();
      const marked = new Set([42, 51, 60, 70]); // missing 80
      const called = new Set([42, 51, 60, 70, 80]);
      const result = validateClaim(ticket, marked, called, PATTERNS.thirdLine);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Row 3 is not complete');
      expect(result.reason).toContain('80');
    });
  });

  describe('validateClaim — fullHouse', () => {
    it('valid when all 15 numbers are marked and called', () => {
      const ticket = makeTestTicket();
      const all = allTicketNumbers(ticket);
      const marked = new Set(all);
      const called = new Set(all);
      const result = validateClaim(ticket, marked, called, PATTERNS.fullHouse);
      expect(result.valid).toBe(true);
    });

    it('invalid when only 14 of 15 are marked', () => {
      const ticket = makeTestTicket();
      const all = allTicketNumbers(ticket);
      const marked = new Set(all.slice(0, 14)); // missing one
      const called = new Set(all);
      const result = validateClaim(ticket, marked, called, PATTERNS.fullHouse);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('14/15 marked');
    });

    it('invalid with 0 marks', () => {
      const ticket = makeTestTicket();
      const all = allTicketNumbers(ticket);
      const result = validateClaim(ticket, new Set(), new Set(all), PATTERNS.fullHouse);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('0/15 marked');
    });

    it('invalid when all marked but some not called', () => {
      const ticket = makeTestTicket();
      const all = allTicketNumbers(ticket);
      const marked = new Set(all);
      const called = new Set(all.slice(0, 12)); // only 12 called
      const result = validateClaim(ticket, marked, called, PATTERNS.fullHouse);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('/15 marked');
    });
  });
});
