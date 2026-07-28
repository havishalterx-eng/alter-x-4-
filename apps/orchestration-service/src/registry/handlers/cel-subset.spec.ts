import { describe, expect, it } from "vitest";

import { CelSubsetError, evaluateCelSubset } from "./cel-subset";

describe("evaluateCelSubset", () => {
  it("evaluates a simple equality on a dotted path", () => {
    expect(
      evaluateCelSubset("inputs.node_a.status == 'done'", {
        inputs: { node_a: { status: "done" } },
      }),
    ).toBe(true);
  });

  it("evaluates inequality", () => {
    expect(
      evaluateCelSubset("inputs.node_a.status != 'done'", {
        inputs: { node_a: { status: "pending" } },
      }),
    ).toBe(true);
  });

  it("evaluates numeric comparisons", () => {
    const root = { inputs: { node_a: { score: 7 } } };
    expect(evaluateCelSubset("inputs.node_a.score > 5", root)).toBe(true);
    expect(evaluateCelSubset("inputs.node_a.score < 5", root)).toBe(false);
    expect(evaluateCelSubset("inputs.node_a.score >= 7", root)).toBe(true);
    expect(evaluateCelSubset("inputs.node_a.score <= 6", root)).toBe(false);
  });

  it("evaluates boolean literals", () => {
    expect(evaluateCelSubset("true", {})).toBe(true);
    expect(evaluateCelSubset("false", {})).toBe(false);
  });

  it("evaluates && and ||", () => {
    const root = { inputs: { a: { x: true }, b: { y: false } } };
    expect(evaluateCelSubset("inputs.a.x && inputs.b.y", root)).toBe(false);
    expect(evaluateCelSubset("inputs.a.x || inputs.b.y", root)).toBe(true);
  });

  it("evaluates negation", () => {
    expect(evaluateCelSubset("!false", {})).toBe(true);
    expect(evaluateCelSubset("!true", {})).toBe(false);
  });

  it("evaluates parenthesized grouping", () => {
    const root = { inputs: { a: { x: false }, b: { y: false }, c: { z: true } } };
    expect(
      evaluateCelSubset("(inputs.a.x || inputs.b.y) && inputs.c.z", root),
    ).toBe(false);
    expect(
      evaluateCelSubset("(inputs.a.x || inputs.c.z) && inputs.c.z", root),
    ).toBe(true);
  });

  it("resolves a missing path to null, not a throw", () => {
    expect(evaluateCelSubset("inputs.missing.field == null", { inputs: {} })).toBe(
      true,
    );
  });

  it("throws CelSubsetError on unterminated string", () => {
    expect(() => evaluateCelSubset("inputs.a == 'oops", {})).toThrow(CelSubsetError);
  });

  it("throws CelSubsetError on unexpected trailing tokens", () => {
    expect(() => evaluateCelSubset("true true", {})).toThrow(CelSubsetError);
  });

  it("throws CelSubsetError on an unexpected character", () => {
    expect(() => evaluateCelSubset("inputs.a == @weird", {})).toThrow(CelSubsetError);
  });
});
