/**
 * Tambola Ticket Generator
 *
 * Generates valid Tambola (Housie) tickets following standard rules:
 * - 3 rows × 9 columns
 * - Each row has exactly 5 numbers and 4 blanks
 * - Each column has 1–3 numbers
 * - Column ranges: col 0 → 1–9, cols 1–7 → c×10 to c×10+9, col 8 → 80–90
 * - Numbers within each column sorted ascending top to bottom
 * - 15 numbers total per ticket
 */

/**
 * Returns the valid number range for a given column index.
 * @param {number} col - Column index (0–8)
 * @returns {number[]} Array of valid numbers for this column
 */
function getColumnRange(col) {
  if (col === 0) return range(1, 9);
  if (col === 8) return range(80, 90);
  return range(col * 10, col * 10 + 9);
}

/**
 * Returns an array of integers from min to max (inclusive).
 */
function range(min, max) {
  const arr = [];
  for (let i = min; i <= max; i++) arr.push(i);
  return arr;
}

/**
 * Shuffles an array in place using Fisher-Yates.
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generates a valid Tambola ticket.
 * @returns {number[][]} 3×9 array where 0 = blank cell, positive number = value
 */
export function generateTicket() {
  // Step 1: Determine how many numbers each column will hold (1, 2, or 3)
  // Total must be 15, and each row must have exactly 5
  const colCounts = distributeColumnCounts();

  // Step 2: For each column, pick random numbers from its range
  const colNumbers = [];
  for (let c = 0; c < 9; c++) {
    const pool = getColumnRange(c);
    shuffle(pool);
    const picked = pool.slice(0, colCounts[c]).sort((a, b) => a - b);
    colNumbers.push(picked);
  }

  // Step 3: Assign numbers to rows so each row gets exactly 5
  const ticket = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];

  distributeToRows(ticket, colNumbers, colCounts);

  return ticket;
}

/**
 * Distributes column counts (1–3 per column) such that total = 15
 * and it's possible to assign exactly 5 numbers per row.
 * @returns {number[]} Array of 9 column counts
 */
function distributeColumnCounts() {
  // We need 15 numbers across 9 columns, each column 1–3.
  // Each row must have exactly 5 filled cells.
  // Strategy: start with 1 per column (9 total), distribute 6 more.
  let attempts = 0;
  while (attempts < 1000) {
    attempts++;
    const counts = new Array(9).fill(1); // 9 total so far
    let remaining = 6; // need 6 more to reach 15

    // Randomly add to columns (max 3 per column)
    const indices = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const idx of indices) {
      if (remaining <= 0) break;
      const canAdd = Math.min(2, remaining); // each col already has 1, max is 3
      const add = canAdd === 1 ? 1 : (Math.random() < 0.5 ? 1 : 2);
      counts[idx] += add;
      remaining -= add;
    }

    // If we still have remaining, distribute to columns that can take more
    if (remaining > 0) {
      for (let c = 0; c < 9 && remaining > 0; c++) {
        const canAdd = 3 - counts[c];
        if (canAdd > 0) {
          const add = Math.min(canAdd, remaining);
          counts[c] += add;
          remaining -= add;
        }
      }
    }

    if (remaining !== 0) continue;

    // Verify we can distribute to rows with 5 each
    if (canDistributeToRows(counts)) {
      return counts;
    }
  }

  // Fallback: known valid distribution
  return [1, 2, 2, 2, 2, 2, 2, 1, 1];
}

/**
 * Checks if column counts can be distributed into 3 rows of 5.
 * Uses a greedy approach to verify feasibility.
 */
function canDistributeToRows(colCounts) {
  // Try to find a valid row assignment
  return findRowAssignment(colCounts) !== null;
}

/**
 * Finds a valid assignment of column slots to rows.
 * Returns an array of arrays: rowAssignment[col] = array of row indices.
 * Each row must have exactly 5 columns assigned.
 */
function findRowAssignment(colCounts) {
  // For each column, we need to choose which rows get numbers.
  // rowFill[r] tracks how many columns are assigned to row r.
  const rowFill = [0, 0, 0];
  const assignment = new Array(9).fill(null).map(() => []);

  // Process columns with count 3 first (must fill all rows)
  // Then count 1 (most constrained), then count 2
  const order = [];
  for (let c = 0; c < 9; c++) {
    if (colCounts[c] === 3) order.push(c);
  }
  for (let c = 0; c < 9; c++) {
    if (colCounts[c] === 1) order.push(c);
  }
  for (let c = 0; c < 9; c++) {
    if (colCounts[c] === 2) order.push(c);
  }

  for (const c of order) {
    const count = colCounts[c];
    if (count === 3) {
      assignment[c] = [0, 1, 2];
      rowFill[0]++;
      rowFill[1]++;
      rowFill[2]++;
    } else if (count === 1) {
      // Pick the row with the least fill (that hasn't reached 5)
      const available = [0, 1, 2]
        .filter((r) => rowFill[r] < 5)
        .sort((a, b) => rowFill[a] - rowFill[b]);
      if (available.length === 0) return null;
      const row = available[0];
      assignment[c] = [row];
      rowFill[row]++;
    } else {
      // count === 2: pick 2 rows with least fill
      const available = [0, 1, 2]
        .filter((r) => rowFill[r] < 5)
        .sort((a, b) => rowFill[a] - rowFill[b]);
      if (available.length < 2) return null;
      assignment[c] = [available[0], available[1]];
      rowFill[available[0]]++;
      rowFill[available[1]]++;
    }
  }

  // Verify each row has exactly 5
  if (rowFill[0] !== 5 || rowFill[1] !== 5 || rowFill[2] !== 5) return null;

  return assignment;
}

/**
 * Distributes numbers into the ticket grid rows.
 * Each row gets exactly 5 numbers, numbers within each column sorted ascending.
 */
function distributeToRows(ticket, colNumbers, colCounts) {
  const assignment = findRowAssignment(colCounts);

  for (let c = 0; c < 9; c++) {
    const rows = assignment[c].sort((a, b) => a - b);
    const nums = colNumbers[c]; // already sorted ascending
    for (let i = 0; i < rows.length; i++) {
      ticket[rows[i]][c] = nums[i];
    }
  }
}

/**
 * Generates N unique tickets for a game.
 * @param {number} count - Number of tickets to generate
 * @returns {number[][][]} Array of unique tickets
 */
export function generateTickets(count) {
  const tickets = [];
  const seen = new Set();
  let attempts = 0;
  const maxAttempts = count * 100;

  while (tickets.length < count && attempts < maxAttempts) {
    attempts++;
    const ticket = generateTicket();
    const key = serializeTicket(ticket);
    if (!seen.has(key)) {
      seen.add(key);
      tickets.push(ticket);
    }
  }

  return tickets;
}

/**
 * Serializes a ticket to a compact string representation.
 * Format: comma-separated values, rows separated by semicolons.
 * @param {number[][]} ticket - 3×9 ticket array
 * @returns {string} Serialized ticket string
 */
export function serializeTicket(ticket) {
  return ticket.map((row) => row.join(",")).join(";");
}

/**
 * Deserializes a string back to a ticket.
 * @param {string} str - Serialized ticket string
 * @returns {number[][]} 3×9 ticket array
 */
export function deserializeTicket(str) {
  return str.split(";").map((row) => row.split(",").map(Number));
}
