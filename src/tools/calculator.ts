import { formatNumber, normalizeInput, type LocalTool, type ToolReply } from "./types";

/**
 * A safe arithmetic evaluator (no eval): + - * / ^ %, mod, !, parentheses, implicit
 * multiplication ("2(3+4)", "2pi"), common functions and constants, "15% of 80".
 */

type Token =
  | { kind: "num"; value: number }
  | { kind: "id"; name: string }
  | { kind: "op"; op: string };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  max: Math.max,
  min: Math.min,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

class ParseError extends Error {}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /\s*(?:(\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+)|([a-zπ][a-z0-9]*)|(\*\*|[-+*/^%(),!°]))/giy;
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m) {
      if (!src.slice(pos).trim()) break;
      throw new ParseError("unexpected character");
    }
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ kind: "num", value: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ kind: "id", name: m[2].toLowerCase() });
    else tokens.push({ kind: "op", op: m[3] === "**" ? "^" : m[3] });
  }
  return tokens;
}

class Parser {
  private i = 0;
  /** Whether anything beyond a bare number was used (an operator or function). */
  operations = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const value = this.expr();
    if (this.i < this.tokens.length) throw new ParseError("trailing input");
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  private isOp(op: string, t = this.peek()): boolean {
    return t?.kind === "op" && t.op === op;
  }

  private isId(name: string, t = this.peek()): boolean {
    return t?.kind === "id" && t.name === name;
  }

  private expect(op: string): void {
    if (!this.isOp(op)) throw new ParseError(`expected ${op}`);
    this.i++;
  }

  private expr(): number {
    let value = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.tokens[this.i++] as { op: string }).op;
      const rhs = this.term();
      value = op === "+" ? value + rhs : value - rhs;
      this.operations++;
    }
    return value;
  }

  /** A token that can start a factor, for implicit multiplication. */
  private startsFactor(t = this.peek()): boolean {
    if (!t) return false;
    if (t.kind === "num") return true;
    if (t.kind === "id") return t.name !== "mod";
    return t.op === "(";
  }

  private term(): number {
    let value = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/")) {
        const op = (this.tokens[this.i++] as { op: string }).op;
        const rhs = this.unary();
        value = op === "*" ? value * rhs : value / rhs;
      } else if (this.isId("mod") || (this.isOp("%") && this.startsFactor(this.tokens[this.i + 1]))) {
        this.i++;
        const rhs = this.unary();
        value = ((value % rhs) + rhs) % rhs;
      } else if (this.startsFactor()) {
        value *= this.unary(); // implicit: 2(3+4), 2pi
      } else {
        return value;
      }
      this.operations++;
    }
  }

  private unary(): number {
    if (this.isOp("-")) {
      this.i++;
      this.operations++;
      return -this.unary();
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private power(): number {
    const base = this.postfix();
    if (this.isOp("^")) {
      this.i++;
      this.operations++;
      return Math.pow(base, this.unary());
    }
    return base;
  }

  private postfix(): number {
    let value = this.primary();
    for (;;) {
      if (this.isOp("%") && !this.startsFactor(this.tokens[this.i + 1])) {
        this.i++;
        value /= 100;
      } else if (this.isOp("!")) {
        this.i++;
        value = factorial(value);
      } else if (this.isOp("°") || this.isId("deg")) {
        this.i++;
        value = (value * Math.PI) / 180;
      } else {
        return value;
      }
      this.operations++;
    }
  }

  private primary(): number {
    const t = this.tokens[this.i++];
    if (!t) throw new ParseError("unexpected end");
    if (t.kind === "num") return t.value;
    if (t.kind === "op" && t.op === "(") {
      const value = this.expr();
      this.expect(")");
      return value;
    }
    if (t.kind === "id") {
      if (t.name in CONSTANTS) return CONSTANTS[t.name];
      const fn = FUNCTIONS[t.name];
      if (!fn) throw new ParseError(`unknown name ${t.name}`);
      this.operations++;
      if (this.isOp("(")) {
        this.i++;
        const args = [this.expr()];
        while (this.isOp(",")) {
          this.i++;
          args.push(this.expr());
        }
        this.expect(")");
        return fn(...args);
      }
      return fn(this.power()); // "sqrt 16"
    }
    throw new ParseError("unexpected token");
  }
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  if (n > 170) return Infinity;
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

/** Words and symbols people type, rewritten into the parser's syntax. */
export function rewriteExpression(input: string): string {
  return input
    .toLowerCase()
    .replace(/[×✕]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/√/g, "sqrt ")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .replace(/\bsquare root of\b/g, "sqrt ")
    .replace(/\bcube root of\b/g, "cbrt ")
    .replace(/\bmultiplied by\b|\btimes\b/g, "*")
    .replace(/\bdivided by\b|\bover\b/g, "/")
    .replace(/\bto the power of\b|\bpower\b/g, "^")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b/g, "-")
    .replace(/\bmodulo\b/g, "mod")
    .replace(/\bsquared\b/g, "^2")
    .replace(/\bcubed\b/g, "^3")
    .replace(/\bdegrees?\b/g, "deg")
    .replace(/%\s*of\b/g, "%*")
    .replace(/([\d)])\s*x\s*(?=[\d(.])/g, "$1*")
    .trim();
}

const PREFIX = /^(?:what(?:'s|s| is)|how much is|calculate|calc|compute|solve|eval(?:uate)?|=)\s*/i;

/** The value of an arithmetic expression, or null when `input` isn't one. */
export function calculate(input: string): { expression: string; value: number } | null {
  const text = normalizeInput(input).replace(PREFIX, "").replace(/\s*=\s*$/, "");
  if (!text || text.length > 200 || !/\d|pi|π|tau/i.test(text)) return null;
  if (/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(text)) return null; // a date, not a sum
  const expression = rewriteExpression(text);
  let tokens: Token[];
  try {
    tokens = tokenize(expression);
  } catch {
    return null;
  }
  if (!tokens.length) return null;
  try {
    const parser = new Parser(tokens);
    const value = parser.parse();
    if (parser.operations === 0) return null; // a bare number isn't a question
    return { expression, value };
  } catch {
    return null;
  }
}

export function prettyExpression(expression: string): string {
  return expression
    .replace(/\s+/g, "")
    .replace(/\*/g, " × ")
    .replace(/\//g, " ÷ ")
    .replace(/(?<=[\d)a-zπ%!])([+-])/g, " $1 ")
    .replace(/\bmod\b/g, " mod ")
    .replace(/\s+/g, " ")
    .trim();
}

export const CalculatorTool = {
  id: "calculator",
  name: "Calculator",
  icon: "🧮",
  description: "Maths without the AI: 25*4, 15% of 80, sqrt(2), (3+4)^2.",
  handle(input: string): ToolReply | null {
    const result = calculate(input);
    if (!result) return null;
    const pretty = prettyExpression(result.expression);
    if (!Number.isFinite(result.value)) {
      return { title: "Calculator", text: `${pretty}\n\nThat has no answer (dividing by zero?).` };
    }
    const value = formatNumber(result.value);
    return { title: "Calculator", text: `${pretty} = **${value}**`, speech: `That's ${value}.` };
  },
} satisfies LocalTool;
