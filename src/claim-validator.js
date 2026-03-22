/**
 * Tambola Claim Validator
 *
 * Pure functions for validating player claims against winning patterns.
 * No DOM or Firebase dependencies.
 */

/**
 * Supported winning patterns.
 */
export const PATTERNS = {
  earlyFive: 'earlyFive',
  firstLine: 'firstLine',
  secondLine: 'secondLine',
  thirdLine: 'thirdLine',
  fullHouse: 'fullHouse',
};

/**
 * Returns the non-zero numbers in a given row of a ticket.
 * @param {number[][]} ticket - 3×9 ticket array
 * @param {number} rowIndex - Row index (0, 1, or 2)
 * @returns {number[]} Numbers present in that row
 */
function getRowNumbers(ticket, rowIndex) {
  return ticket[rowIndex].filter((v) => v > 0);
}

/**
 * Returns all 15 non-zero numbers on a ticket.
 * @param {number[][]} ticket - 3×9 ticket array
 * @returns {number[]} All numbers on the ticket
 */
function getAllNumbers(ticket) {
  return ticket.flat().filter((v) => v > 0);
}

/**
 * Validates a claim for a specific pattern.
 * @param {number[][]} ticket - The player's ticket (3×9 array)
 * @param {Set<number>} markedNumbers - Set of marked numbers on this ticket
 * @param {Set<number>} calledNumbers - Set of all called numbers in the game
 * @param {string} pattern - The pattern being claimed
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateClaim(ticket, markedNumbers, calledNumbers, pattern) {
  switch (pattern) {
    case PATTERNS.earlyFive:
      return validateEarlyFive(markedNumbers, calledNumbers);
    case PATTERNS.firstLine:
      return validateLine(ticket, markedNumbers, calledNumbers, 0);
    case PATTERNS.secondLine:
      return validateLine(ticket, markedNumbers, calledNumbers, 1);
    case PATTERNS.thirdLine:
      return validateLine(ticket, markedNumbers, calledNumbers, 2);
    case PATTERNS.fullHouse:
      return validateFullHouse(ticket, markedNumbers, calledNumbers);
    default:
      return { valid: false, reason: `Unknown pattern: ${pattern}` };
  }
}

/**
 * Validates an Early Five claim: at least 5 marked numbers, all called.
 */
function validateEarlyFive(markedNumbers, calledNumbers) {
  const markedArr = [...markedNumbers];
  const validMarks = markedArr.filter((n) => calledNumbers.has(n));

  if (validMarks.length < 5) {
    return {
      valid: false,
      reason: `Only ${validMarks.length} numbers marked, need at least 5`,
    };
  }

  return { valid: true };
}

/**
 * Validates a line claim (first, second, or third row).
 */
function validateLine(ticket, markedNumbers, calledNumbers, rowIndex) {
  const rowNums = getRowNumbers(ticket, rowIndex);
  const missing = rowNums.filter(
    (n) => !markedNumbers.has(n) || !calledNumbers.has(n)
  );

  if (missing.length > 0) {
    return {
      valid: false,
      reason: `Row ${rowIndex + 1} is not complete — missing numbers: ${missing.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Validates a Full House claim: all 15 numbers marked and called.
 */
function validateFullHouse(ticket, markedNumbers, calledNumbers) {
  const allNums = getAllNumbers(ticket);
  const markedCount = allNums.filter(
    (n) => markedNumbers.has(n) && calledNumbers.has(n)
  ).length;

  if (markedCount < 15) {
    return {
      valid: false,
      reason: `Not all 15 numbers are marked — ${markedCount}/15 marked`,
    };
  }

  return { valid: true };
}
