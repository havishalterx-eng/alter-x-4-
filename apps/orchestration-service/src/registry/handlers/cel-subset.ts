/**
 * A deliberately small, safe subset of CEL: dotted-path field access,
 * literals (number/string/bool/null), comparisons, and && / || / ! --
 * enough to route a Gate node's conditional edges (see PLAN-10's
 * config.conditions synthesis in ../../compiler/dag-builder.ts).
 *
 * This is NOT a full CEL implementation. No function calls, no lists/maps,
 * no arithmetic. If a real CEL grammar/runtime is needed later, replace
 * this module -- callers only depend on evaluateCelSubset's signature.
 */

export class CelSubsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CelSubsetError";
  }
}

type Token =
  | { readonly kind: "identifier"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "op"; readonly value: string }
  | { readonly kind: "eof" };

const OPERATORS = ["==", "!=", ">=", "<=", "&&", "||", ">", "<", "!", "(", ")", "."];

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let value = "";
      while (j < expression.length && expression[j] !== quote) {
        value += expression[j];
        j += 1;
      }
      if (j >= expression.length) {
        throw new CelSubsetError(`Unterminated string literal in expression: ${expression}`);
      }
      tokens.push({ kind: "string", value });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      let value = "";
      while (j < expression.length && /[0-9.]/.test(expression[j]!)) {
        value += expression[j];
        j += 1;
      }
      tokens.push({ kind: "number", value: Number(value) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      let value = "";
      while (j < expression.length && /[a-zA-Z0-9_.]/.test(expression[j]!)) {
        value += expression[j];
        j += 1;
      }
      tokens.push({ kind: "identifier", value });
      i = j;
      continue;
    }
    const twoChar = expression.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(twoChar)) {
      tokens.push({ kind: "op", value: twoChar });
      i += 2;
      continue;
    }
    if (OPERATORS.includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }
    throw new CelSubsetError(`Unexpected character "${ch}" in expression: ${expression}`);
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

type LiteralValue = string | number | boolean | null;

class Parser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.position]!;
  }

  private advance(): Token {
    const token = this.tokens[this.position]!;
    this.position += 1;
    return token;
  }

  private expectOp(value: string): void {
    const token = this.advance();
    if (token.kind !== "op" || token.value !== value) {
      throw new CelSubsetError(`Expected "${value}"`);
    }
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token.kind === "op" && token.value === value;
  }

  parseExpression(): (root: Record<string, unknown>) => LiteralValue {
    const expr = this.parseOr();
    if (this.peek().kind !== "eof") {
      throw new CelSubsetError("Unexpected trailing tokens in expression");
    }
    return expr;
  }

  private parseOr(): (root: Record<string, unknown>) => LiteralValue {
    let left = this.parseAnd();
    while (this.isOp("||")) {
      this.advance();
      const right = this.parseAnd();
      const previous = left;
      left = (root) => Boolean(previous(root)) || Boolean(right(root));
    }
    return left;
  }

  private parseAnd(): (root: Record<string, unknown>) => LiteralValue {
    let left = this.parseNot();
    while (this.isOp("&&")) {
      this.advance();
      const right = this.parseNot();
      const previous = left;
      left = (root) => Boolean(previous(root)) && Boolean(right(root));
    }
    return left;
  }

  private parseNot(): (root: Record<string, unknown>) => LiteralValue {
    if (this.isOp("!")) {
      this.advance();
      const operand = this.parseNot();
      return (root) => !operand(root);
    }
    return this.parseComparison();
  }

  private parseComparison(): (root: Record<string, unknown>) => LiteralValue {
    const left = this.parsePrimary();
    const token = this.peek();
    if (
      token.kind === "op" &&
      ["==", "!=", ">", "<", ">=", "<="].includes(token.value)
    ) {
      this.advance();
      const right = this.parsePrimary();
      const operator = token.value;
      return (root) => applyComparison(operator, left(root), right(root));
    }
    return left;
  }

  private parsePrimary(): (root: Record<string, unknown>) => LiteralValue {
    const token = this.advance();
    if (token.kind === "op" && token.value === "(") {
      const inner = this.parseOr();
      this.expectOp(")");
      return inner;
    }
    if (token.kind === "number") {
      return () => token.value;
    }
    if (token.kind === "string") {
      return () => token.value;
    }
    if (token.kind === "identifier") {
      if (token.value === "true") return () => true;
      if (token.value === "false") return () => false;
      if (token.value === "null") return () => null;
      const path = token.value.split(".");
      return (root) => resolvePath(root, path);
    }
    throw new CelSubsetError("Expected a value");
  }
}

function resolvePath(root: Record<string, unknown>, path: readonly string[]): LiteralValue {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || current === undefined || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (
    current === null ||
    typeof current === "string" ||
    typeof current === "number" ||
    typeof current === "boolean"
  ) {
    return current;
  }
  return current === undefined ? null : JSON.stringify(current);
}

function applyComparison(operator: string, left: LiteralValue, right: LiteralValue): boolean {
  switch (operator) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return Number(left) > Number(right);
    case "<":
      return Number(left) < Number(right);
    case ">=":
      return Number(left) >= Number(right);
    case "<=":
      return Number(left) <= Number(right);
    default:
      throw new CelSubsetError(`Unsupported comparison operator: ${operator}`);
  }
}

/** Evaluates a CEL-subset boolean expression against a root context object. */
export function evaluateCelSubset(
  expression: string,
  root: Record<string, unknown>,
): boolean {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  const evaluate = parser.parseExpression();
  return Boolean(evaluate(root));
}
