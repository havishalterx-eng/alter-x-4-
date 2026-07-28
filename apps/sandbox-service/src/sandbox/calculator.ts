type Token = number | "+" | "-" | "*" | "/" | "%" | "^" | "(" | ")";

function tokenize(expression: string): Token[] {
  if (expression.length === 0 || expression.length > 1_024) {
    throw new Error("Calculator expression length is invalid");
  }
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < expression.length) {
    const rest = expression.slice(offset);
    const whitespace = rest.match(/^\s+/)?.[0];
    if (whitespace !== undefined) {
      offset += whitespace.length;
      continue;
    }
    const numberText = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)?.[0];
    if (numberText !== undefined) {
      const value = Number(numberText);
      if (!Number.isFinite(value)) {
        throw new Error("Calculator number is not finite");
      }
      tokens.push(value);
      offset += numberText.length;
      continue;
    }
    const operator = rest[0];
    if (operator !== undefined && "+-*/%^()".includes(operator)) {
      tokens.push(operator as Exclude<Token, number>);
      offset += 1;
      continue;
    }
    throw new Error(`Calculator expression contains invalid token at ${offset}`);
  }
  return tokens;
}

class Parser {
  readonly #tokens: readonly Token[];
  #index = 0;

  constructor(tokens: readonly Token[]) {
    this.#tokens = tokens;
  }

  parse(): number {
    const value = this.#additive();
    if (this.#index !== this.#tokens.length) {
      throw new Error("Calculator expression has trailing input");
    }
    return finite(value);
  }

  #additive(): number {
    let value = this.#multiplicative();
    while (this.#peek() === "+" || this.#peek() === "-") {
      const operator = this.#take();
      const right = this.#multiplicative();
      value = operator === "+" ? value + right : value - right;
    }
    return finite(value);
  }

  #multiplicative(): number {
    let value = this.#unary();
    while (["*", "/", "%"].includes(String(this.#peek()))) {
      const operator = this.#take();
      const right = this.#unary();
      if ((operator === "/" || operator === "%") && right === 0) {
        throw new Error("Calculator division by zero");
      }
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
    return finite(value);
  }

  #power(): number {
    const left = this.#primary();
    if (this.#peek() !== "^") {
      return left;
    }
    this.#take();
    return finite(left ** this.#unary());
  }

  #unary(): number {
    if (this.#peek() === "+") {
      this.#take();
      return this.#unary();
    }
    if (this.#peek() === "-") {
      this.#take();
      return -this.#unary();
    }
    return this.#power();
  }

  #primary(): number {
    const token = this.#take();
    if (typeof token === "number") {
      return token;
    }
    if (token === "(") {
      const value = this.#additive();
      if (this.#take() !== ")") {
        throw new Error("Calculator expression has unbalanced parentheses");
      }
      return value;
    }
    throw new Error("Calculator expression expected a number");
  }

  #peek(): Token | undefined {
    return this.#tokens[this.#index];
  }

  #take(): Token {
    const token = this.#tokens[this.#index];
    if (token === undefined) {
      throw new Error("Calculator expression ended unexpectedly");
    }
    this.#index += 1;
    return token;
  }
}

function finite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Calculator result is not finite");
  }
  return value;
}

export function calculate(expression: string): number {
  return new Parser(tokenize(expression.trim())).parse();
}
