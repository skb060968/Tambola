import { describe, it, expect } from "vitest";
import {
  generateTicket,
  generateTickets,
  serializeTicket,
  deserializeTicket,
} from "../src/ticket-generator.js";

describe("ticket-generator", () => {
  describe("generateTicket", () => {
    it("produces a 3×9 grid", () => {
      const ticket = generateTicket();
      expect(ticket.length).toBe(3);
      for (const row of ticket) {
        expect(row.length).toBe(9);
      }
    });

    it("has exactly 5 numbers per row", () => {
      const ticket = generateTicket();
      for (const row of ticket) {
        const numbers = row.filter((v) => v > 0);
        expect(numbers.length).toBe(5);
      }
    });

    it("has exactly 15 numbers total", () => {
      const ticket = generateTicket();
      const total = ticket.flat().filter((v) => v > 0).length;
      expect(total).toBe(15);
    });

    it("respects column ranges", () => {
      const ticket = generateTicket();
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 9; c++) {
          const v = ticket[r][c];
          if (v === 0) continue;
          if (c === 0) {
            expect(v).toBeGreaterThanOrEqual(1);
            expect(v).toBeLessThanOrEqual(9);
          } else if (c === 8) {
            expect(v).toBeGreaterThanOrEqual(80);
            expect(v).toBeLessThanOrEqual(90);
          } else {
            expect(v).toBeGreaterThanOrEqual(c * 10);
            expect(v).toBeLessThanOrEqual(c * 10 + 9);
          }
        }
      }
    });

    it("has 1–3 numbers per column", () => {
      const ticket = generateTicket();
      for (let c = 0; c < 9; c++) {
        const colNums = [0, 1, 2].map((r) => ticket[r][c]).filter((v) => v > 0);
        expect(colNums.length).toBeGreaterThanOrEqual(1);
        expect(colNums.length).toBeLessThanOrEqual(3);
      }
    });

    it("sorts numbers ascending within each column", () => {
      const ticket = generateTicket();
      for (let c = 0; c < 9; c++) {
        const colNums = [0, 1, 2]
          .map((r) => ticket[r][c])
          .filter((v) => v > 0);
        for (let i = 1; i < colNums.length; i++) {
          expect(colNums[i]).toBeGreaterThan(colNums[i - 1]);
        }
      }
    });
  });

  describe("generateTickets", () => {
    it("produces the requested number of tickets", () => {
      const tickets = generateTickets(4);
      expect(tickets.length).toBe(4);
    });

    it("produces unique tickets", () => {
      const tickets = generateTickets(6);
      const serialized = tickets.map(serializeTicket);
      const unique = new Set(serialized);
      expect(unique.size).toBe(6);
    });
  });

  describe("serializeTicket / deserializeTicket", () => {
    it("round-trips a ticket correctly", () => {
      const ticket = generateTicket();
      const str = serializeTicket(ticket);
      const restored = deserializeTicket(str);
      expect(restored).toEqual(ticket);
    });

    it("produces a string with semicolons separating rows", () => {
      const ticket = generateTicket();
      const str = serializeTicket(ticket);
      expect(str.split(";").length).toBe(3);
    });
  });
});
