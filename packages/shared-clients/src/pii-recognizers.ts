// Custom Indian PII recognizer definitions shared by the real Presidio
// adapter (which sends these as Presidio ad_hoc_recognizers) and the
// deterministic mock (which applies them directly) so both sides of the
// PIIRedactionProvider contract agree on what counts as a match.

export interface PIIRecognizerPattern {
  readonly name: string;
  readonly entityType: string;
  // JS RegExp source. Kept to syntax Presidio's Python `re` engine also
  // accepts (character classes, \d, \b, {n}) so the same pattern string is
  // valid on both sides of the HTTP boundary.
  readonly regex: string;
  readonly score: number;
}

export const IN_AADHAAR_PATTERN: PIIRecognizerPattern = Object.freeze({
  name: "in_aadhaar_pattern",
  entityType: "IN_AADHAAR",
  regex: "\\b\\d{4}\\s?\\d{4}\\s?\\d{4}\\b",
  score: 0.6,
});

export const IN_PAN_PATTERN: PIIRecognizerPattern = Object.freeze({
  name: "in_pan_pattern",
  entityType: "IN_PAN",
  regex: "\\b[A-Z]{5}[0-9]{4}[A-Z]\\b",
  score: 0.85,
});

export const IN_GSTIN_PATTERN: PIIRecognizerPattern = Object.freeze({
  name: "in_gstin_pattern",
  entityType: "IN_GSTIN",
  regex: "\\b\\d{2}[A-Z]{5}\\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\\b",
  score: 0.75,
});

export const IN_PHONE_NUMBER_PATTERN: PIIRecognizerPattern = Object.freeze({
  name: "in_phone_number_pattern",
  entityType: "IN_PHONE_NUMBER",
  regex: "\\b(?:\\+91[\\-\\s]?)?[6-9]\\d{9}\\b",
  score: 0.6,
});

export const IN_BANK_IFSC_PATTERN: PIIRecognizerPattern = Object.freeze({
  name: "in_bank_ifsc_pattern",
  entityType: "IN_BANK_IFSC",
  regex: "\\b[A-Z]{4}0[A-Z0-9]{6}\\b",
  score: 0.85,
});

export const INDIAN_PII_RECOGNIZER_PATTERNS: readonly PIIRecognizerPattern[] =
  Object.freeze([
    IN_AADHAAR_PATTERN,
    IN_PAN_PATTERN,
    IN_GSTIN_PATTERN,
    IN_PHONE_NUMBER_PATTERN,
    IN_BANK_IFSC_PATTERN,
  ]);

// Verhoeff checksum -- the algorithm UIDAI actually uses for Aadhaar check
// digits. Regex alone over-matches any 12-digit run, so real candidates are
// post-filtered through this before being reported as IN_AADHAAR.
const VERHOEFF_D_TABLE: readonly (readonly number[])[] = Object.freeze([
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]);

const VERHOEFF_P_TABLE: readonly (readonly number[])[] = Object.freeze([
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]);

export function isValidVerhoeffChecksum(digits: string): boolean {
  if (!/^\d+$/.test(digits)) {
    return false;
  }
  let checksum = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const digit = Number(reversed[i]);
    checksum = VERHOEFF_D_TABLE[checksum]![VERHOEFF_P_TABLE[i % 8]![digit]!]!;
  }
  return checksum === 0;
}

export function isValidAadhaar(candidate: string): boolean {
  const digits = candidate.replace(/\s/g, "");
  return digits.length === 12 && isValidVerhoeffChecksum(digits);
}

// GSTIN and bank-account regexes are format-only in this ticket: no
// checksum validation is applied (GSTIN's mod-36 check digit and bank
// account numbers have no universal checksum standard). Known gap, tracked
// for a follow-up ticket rather than shipping an unverified checksum.
export function validateRecognizedEntity(
  entityType: string,
  matchedText: string,
): boolean {
  if (entityType === IN_AADHAAR_PATTERN.entityType) {
    return isValidAadhaar(matchedText);
  }
  return true;
}
