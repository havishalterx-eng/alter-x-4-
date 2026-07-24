import { describe, expect, it } from "vitest";

import {
  IN_AADHAAR_PATTERN,
  IN_BANK_IFSC_PATTERN,
  IN_GSTIN_PATTERN,
  IN_PAN_PATTERN,
  IN_PHONE_NUMBER_PATTERN,
  INDIAN_PII_RECOGNIZER_PATTERNS,
  isValidAadhaar,
  isValidVerhoeffChecksum,
  validateRecognizedEntity,
} from "./pii-recognizers";

const VALID_AADHAAR = "234567890124";
const INVALID_CHECKSUM_AADHAAR = "234567890125";

describe("Verhoeff checksum", () => {
  it("accepts a real Verhoeff-valid 12-digit number", () => {
    expect(isValidVerhoeffChecksum(VALID_AADHAAR)).toBe(true);
  });

  it("rejects a number whose final digit breaks the checksum", () => {
    expect(isValidVerhoeffChecksum(INVALID_CHECKSUM_AADHAAR)).toBe(false);
  });

  it("rejects non-digit input", () => {
    expect(isValidVerhoeffChecksum("23456789012x")).toBe(false);
  });
});

describe("isValidAadhaar", () => {
  it("accepts a checksum-valid Aadhaar, spaced or not", () => {
    expect(isValidAadhaar(VALID_AADHAAR)).toBe(true);
    expect(isValidAadhaar("2345 6789 0124")).toBe(true);
  });

  it("rejects a checksum-invalid Aadhaar-shaped number", () => {
    expect(isValidAadhaar(INVALID_CHECKSUM_AADHAAR)).toBe(false);
  });

  it("rejects the wrong digit count", () => {
    expect(isValidAadhaar("1234567890")).toBe(false);
  });
});

describe("validateRecognizedEntity", () => {
  it("applies the Verhoeff checksum filter only to IN_AADHAAR matches", () => {
    expect(validateRecognizedEntity("IN_AADHAAR", VALID_AADHAAR)).toBe(true);
    expect(validateRecognizedEntity("IN_AADHAAR", INVALID_CHECKSUM_AADHAAR)).toBe(
      false,
    );
  });

  it("does not apply checksum validation to other entity types", () => {
    expect(validateRecognizedEntity("IN_PAN", "ABCDE1234F")).toBe(true);
    expect(validateRecognizedEntity("IN_GSTIN", "not-a-real-gstin")).toBe(true);
  });
});

describe("recognizer patterns", () => {
  it("matches the expected fixture for each custom Indian entity type", () => {
    expect(new RegExp(IN_PAN_PATTERN.regex).test("ABCDE1234F")).toBe(true);
    expect(new RegExp(IN_GSTIN_PATTERN.regex).test("29ABCDE1234F1Z5")).toBe(
      true,
    );
    expect(new RegExp(IN_PHONE_NUMBER_PATTERN.regex).test("+91 9876543210")).toBe(
      true,
    );
    expect(new RegExp(IN_PHONE_NUMBER_PATTERN.regex).test("9876543210")).toBe(
      true,
    );
    expect(new RegExp(IN_BANK_IFSC_PATTERN.regex).test("HDFC0001234")).toBe(
      true,
    );
    expect(new RegExp(IN_AADHAAR_PATTERN.regex).test(VALID_AADHAAR)).toBe(true);
  });

  it("exposes exactly the five custom Indian recognizers", () => {
    expect(INDIAN_PII_RECOGNIZER_PATTERNS.map((p) => p.entityType)).toEqual([
      "IN_AADHAAR",
      "IN_PAN",
      "IN_GSTIN",
      "IN_PHONE_NUMBER",
      "IN_BANK_IFSC",
    ]);
  });
});
