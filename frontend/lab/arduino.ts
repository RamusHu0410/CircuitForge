/**
 * Runs Arduino sketches against the circuit simulation, so code-driven circuits really work.
 *
 * An interpreter for the C++ that Arduino sketches use: AVR-sized integers (int is 16-bit, so the
 * classic overflow bugs happen like on the real board), unsigned long millis() arithmetic that wraps,
 * arrays, structs, enums, references, casts, #define, switch, and the Arduino API (pinMode,
 * digitalRead/Write, analogRead/Write, millis, delay, tone, shiftOut, Serial). Program time is
 * circuit time: delay(500) waits 500 ms of simulation.
 *
 * Not supported (and reported as such): classes with methods, pointers beyond `&`/`*` in declarations,
 * function-like macros, templates, interrupts, libraries other than Serial.
 */

/* ---------- types ---------- */

export type CType =
  | { k: "int"; bits: 8 | 16 | 32 | 64; signed: boolean }
  | { k: "float" }
  | { k: "bool" }
  | { k: "void" }
  | { k: "string" }
  | { k: "struct"; name: string }
  | { k: "array"; of: CType; len: number };

const INT = (bits: 8 | 16 | 32 | 64, signed: boolean): CType => ({ k: "int", bits, signed });
const T_INT = INT(16, true); // AVR int
const T_FLOAT: CType = { k: "float" };
const T_BOOL: CType = { k: "bool" };
const T_VOID: CType = { k: "void" };
const T_STR: CType = { k: "string" };
const T_ULONG = INT(32, false);

const BASIC: Record<string, CType> = {
  bool: T_BOOL,
  boolean: T_BOOL,
  char: INT(8, true),
  byte: INT(8, false),
  uint8_t: INT(8, false),
  int8_t: INT(8, true),
  short: T_INT,
  int: T_INT,
  int16_t: T_INT,
  word: INT(16, false),
  uint16_t: INT(16, false),
  size_t: INT(16, false),
  long: INT(32, true),
  int32_t: INT(32, true),
  uint32_t: T_ULONG,
  int64_t: INT(64, true),
  uint64_t: INT(64, false),
  float: T_FLOAT,
  double: T_FLOAT,
  void: T_VOID,
  String: T_STR,
};

function wrap(v: number, t: CType): number {
  if (t.k === "bool") return v ? 1 : 0;
  if (t.k !== "int") return v;
  if (!Number.isFinite(v)) return 0;
  v = Math.trunc(v);
  switch (t.bits) {
    case 8:
      return t.signed ? (v << 24) >> 24 : v & 0xff;
    case 16:
      return t.signed ? (v << 16) >> 16 : v & 0xffff;
    case 32:
      return t.signed ? v | 0 : v >>> 0;
    default:
      return v;
  }
}

const sizeOf = (t: CType): number => (t.k === "int" ? t.bits / 8 : t.k === "float" ? 4 : t.k === "bool" ? 1 : t.k === "array" ? t.len * sizeOf(t.of) : 2);

/** The type C gives `a op b` for arithmetic (on an 8-bit AVR, int is 16 bits). */
function arith(a: CType, b: CType): CType {
  if (a.k === "float" || b.k === "float") return T_FLOAT;
  const promote = (t: CType): { bits: number; signed: boolean } => (t.k === "int" ? (t.bits < 16 ? { bits: 16, signed: true } : { bits: t.bits, signed: t.signed }) : { bits: 16, signed: true });
  const x = promote(a);
  const y = promote(b);
  if (x.bits !== y.bits) return INT((x.bits > y.bits ? x.bits : y.bits) as 16 | 32 | 64, x.bits > y.bits ? x.signed : y.signed);
  return INT(x.bits as 16 | 32 | 64, x.signed && y.signed);
}

/* ---------- lexer ---------- */

interface Tok {
  t: "num" | "str" | "chr" | "id" | "op" | "eof";
  v: string;
  n?: number;
  float?: boolean;
  line: number;
}

export class SketchError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`line ${line}: ${message}`);
  }
}

const OPS = ["<<=", ">>=", "...", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "::", "{", "}", "(", ")", "[", "]", ";", ",", ".", "?", ":", "+", "-", "*", "/", "%", "&", "|", "^", "~", "!", "=", "<", ">"];

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  const macros = new Map<string, Tok[]>();
  const lines = src.replace(/\r/g, "").split("\n");
  let inComment = false;
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    let s = raw;
    let out = "";
    // strip comments (keeping strings intact)
    for (let i = 0; i < s.length; i++) {
      if (inComment) {
        if (s[i] === "*" && s[i + 1] === "/") {
          inComment = false;
          i++;
        }
        continue;
      }
      if (s[i] === "/" && s[i + 1] === "/") break;
      if (s[i] === "/" && s[i + 1] === "*") {
        inComment = true;
        i++;
        continue;
      }
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i];
        let j = i + 1;
        while (j < s.length && s[j] !== q) j += s[j] === "\\" ? 2 : 1;
        out += s.slice(i, j + 1);
        i = j;
        continue;
      }
      out += s[i];
    }
    s = out.trim();
    if (s.startsWith("#")) {
      const m = /^#\s*define\s+(\w+)(\()?\s*(.*)$/.exec(s);
      if (m) {
        if (m[2]) throw new SketchError(`function-like macros (#define ${m[1]}(...)) aren't supported; use a function`, line);
        macros.set(m[1], tokenize(m[3], line));
      }
      return; // #include, #ifdef ... are ignored
    }
    toks.push(...tokenize(s, line));
  });
  // expand object-like macros
  const expand = (list: Tok[], depth: number): Tok[] =>
    list.flatMap((t) => (t.t === "id" && macros.has(t.v) && depth < 12 ? expand(macros.get(t.v)!.map((m) => ({ ...m, line: t.line })), depth + 1) : [t]));
  const all = expand(toks, 0);
  all.push({ t: "eof", v: "", line: lines.length });
  return all;
}

function tokenize(s: string, line: number): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const rest = s.slice(i);
    const num = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?)([uUlLfF]*)/.exec(rest);
    if (num && /[\d.]/.test(c) && !(c === "." && !/\d/.test(s[i + 1] ?? ""))) {
      const body = num[1];
      const float = /[.eE]/.test(body) && !/^0[xX]/.test(body) || /[fF]/.test(num[2]);
      const n = /^0[bB]/.test(body) ? parseInt(body.slice(2), 2) : /^0[xX]/.test(body) ? parseInt(body, 16) : parseFloat(body);
      toks.push({ t: "num", v: num[0], n, float, line });
      i += num[0].length;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let str = "";
      while (j < s.length && s[j] !== '"') {
        if (s[j] === "\\") {
          const e = s[j + 1];
          str += e === "n" ? "\n" : e === "t" ? "\t" : e === "0" ? "\0" : e;
          j += 2;
        } else str += s[j++];
      }
      toks.push({ t: "str", v: str, line });
      i = j + 1;
      continue;
    }
    if (c === "'") {
      let ch = s[i + 1];
      let len = 3;
      if (ch === "\\") {
        const e = s[i + 2];
        ch = e === "n" ? "\n" : e === "t" ? "\t" : e === "0" ? "\0" : e;
        len = 4;
      }
      toks.push({ t: "chr", v: ch, n: ch.charCodeAt(0), line });
      i += len;
      continue;
    }
    const id = /^[A-Za-z_]\w*/.exec(rest);
    if (id) {
      toks.push({ t: "id", v: id[0], line });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (!op) throw new SketchError(`unexpected character '${c}'`, line);
    toks.push({ t: "op", v: op, line });
    i += op.length;
  }
  return toks;
}

/* ---------- AST ---------- */

type Expr =
  | { e: "num"; v: number; float: boolean; line: number }
  | { e: "str"; v: string; line: number }
  | { e: "id"; name: string; line: number }
  | { e: "bin"; op: string; a: Expr; b: Expr; line: number }
  | { e: "un"; op: string; a: Expr; line: number }
  | { e: "post"; op: string; a: Expr; line: number }
  | { e: "assign"; op: string; a: Expr; b: Expr; line: number }
  | { e: "cond"; c: Expr; a: Expr; b: Expr; line: number }
  | { e: "call"; f: string; obj?: string; args: Expr[]; line: number }
  | { e: "index"; a: Expr; i: Expr; line: number }
  | { e: "member"; a: Expr; f: string; line: number }
  | { e: "cast"; t: CType; a: Expr; line: number }
  | { e: "list"; items: Expr[]; struct?: string; line: number }
  | { e: "sizeof"; t?: CType; a?: Expr; line: number };

interface Declarator {
  name: string;
  t: CType;
  init?: Expr;
  ref: boolean;
}

type Stmt =
  | { s: "block"; body: Stmt[] }
  | { s: "decl"; decls: Declarator[]; line: number }
  | { s: "expr"; x: Expr; line: number }
  | { s: "if"; c: Expr; a: Stmt; b?: Stmt; line: number }
  | { s: "while"; c: Expr; body: Stmt; line: number }
  | { s: "do"; c: Expr; body: Stmt; line: number }
  | { s: "for"; init?: Stmt; c?: Expr; step?: Expr; body: Stmt; line: number }
  | { s: "switch"; x: Expr; cases: { v?: Expr; body: Stmt[] }[]; line: number }
  | { s: "return"; x?: Expr; line: number }
  | { s: "break" }
  | { s: "continue" }
  | { s: "empty" };

interface Func {
  name: string;
  ret: CType;
  params: Declarator[];
  body: Stmt;
  line: number;
}

/* ---------- parser ---------- */

const QUALIFIERS = new Set(["const", "static", "volatile", "inline", "constexpr", "unsigned", "signed", "PROGMEM", "extern"]);
const PREC: Record<string, number> = { "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6, "<": 7, ">": 7, "<=": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10 };
const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);

class Parser {
  i = 0;
  structs = new Map<string, { name: string; t: CType }[]>();
  enums = new Map<string, number>(); // enumerator -> value
  typeNames = new Set(Object.keys(BASIC));
  typedefs = new Map<string, CType>();
  globals: Declarator[] = [];
  funcs = new Map<string, Func>();

  constructor(readonly toks: Tok[]) {}

  peek(o = 0) {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  next() {
    return this.toks[this.i++];
  }
  is(v: string, o = 0) {
    const t = this.peek(o);
    return (t.t === "op" || t.t === "id") && t.v === v;
  }
  eat(v: string) {
    if (this.is(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  expect(v: string) {
    if (!this.eat(v)) throw new SketchError(`expected '${v}' but found '${this.peek().v || "end of file"}'`, this.peek().line);
  }
  ident(): string {
    const t = this.next();
    if (t.t !== "id") throw new SketchError(`expected a name but found '${t.v}'`, t.line);
    return t.v;
  }

  isTypeStart(o = 0): boolean {
    const t = this.peek(o);
    return t.t === "id" && (QUALIFIERS.has(t.v) || this.typeNames.has(t.v) || this.typedefs.has(t.v) || t.v === "struct" || t.v === "enum");
  }

  /** A type: qualifiers + base name, e.g. `const unsigned long`, `uint8_t`, `Button`. */
  type(): CType {
    let unsigned = false;
    let signed = false;
    let long = 0;
    let base: string | null = null;
    for (;;) {
      const t = this.peek();
      if (t.t !== "id") break;
      if (t.v === "unsigned") unsigned = true;
      else if (t.v === "signed") signed = true;
      else if (t.v === "long") long++;
      else if (QUALIFIERS.has(t.v) || t.v === "struct" || t.v === "enum") {
        /* skip */
      } else if (!base && (this.typeNames.has(t.v) || this.typedefs.has(t.v))) base = t.v;
      else break;
      this.i++;
    }
    if (long >= 2) return INT(64, !unsigned);
    if (long === 1 && (!base || base === "int")) return INT(32, !unsigned);
    if (long === 1 && base === "double") return T_FLOAT;
    if (!base) {
      if (unsigned || signed) return INT(16, !unsigned);
      throw new SketchError(`expected a type but found '${this.peek().v}'`, this.peek().line);
    }
    if (this.typedefs.has(base)) return this.typedefs.get(base)!;
    if (this.structs.has(base)) return { k: "struct", name: base };
    const t = BASIC[base];
    if (!t) return T_INT; // an enum type
    if (t.k === "int" && unsigned) return INT(t.bits, false);
    return t;
  }

  program(): void {
    while (this.peek().t !== "eof") {
      if (this.eat(";")) continue;
      if (this.is("typedef")) {
        this.next();
        if (this.is("struct")) {
          this.next();
          if (this.peek().t === "id" && !this.is("{")) this.next();
          const fields = this.structBody();
          const name = this.ident();
          this.structs.set(name, fields);
          this.typeNames.add(name);
        } else {
          const t = this.type();
          this.typedefs.set(this.ident(), t);
        }
        this.expect(";");
        continue;
      }
      if (this.is("enum")) {
        this.enumDecl();
        continue;
      }
      if (this.is("struct") && this.peek(1).t === "id" && (this.is("{", 2) || this.is(";", 2))) {
        this.next();
        const name = this.ident();
        this.typeNames.add(name);
        if (this.is("{")) this.structs.set(name, this.structBody());
        this.expect(";");
        continue;
      }
      if (this.is("class")) throw new SketchError("classes aren't supported in the simulator; use structs and functions", this.peek().line);
      const line = this.peek().line;
      const t = this.type();
      const ref = this.eat("&") || this.eat("*");
      const name = this.ident();
      if (this.is("(")) {
        const params = this.params();
        if (this.eat(";")) continue; // a prototype
        this.funcs.set(name, { name, ret: t, params, body: this.block(), line });
        continue;
      }
      this.globals.push(...this.declarators(t, name, ref));
      this.expect(";");
    }
  }

  structBody() {
    this.expect("{");
    const fields: { name: string; t: CType }[] = [];
    while (!this.eat("}")) {
      const t = this.type();
      do {
        const name = this.ident();
        fields.push({ name, t: this.arraySuffix(t) });
      } while (this.eat(","));
      this.expect(";");
    }
    return fields;
  }

  enumDecl() {
    this.next();
    this.eat("class");
    if (this.peek().t === "id" && !this.is("{") && !this.is(":")) this.typeNames.add(this.next().v);
    if (this.eat(":")) this.type();
    this.expect("{");
    let v = 0;
    while (!this.eat("}")) {
      const name = this.ident();
      if (this.eat("=")) v = this.constEval(this.expr());
      this.enums.set(name, v++);
      this.eat(",");
    }
    this.eat(";");
  }

  constEval(x: Expr): number {
    if (x.e === "num") return x.v;
    if (x.e === "id" && this.enums.has(x.name)) return this.enums.get(x.name)!;
    if (x.e === "un" && x.op === "-") return -this.constEval(x.a);
    if (x.e === "bin") {
      const a = this.constEval(x.a);
      const b = this.constEval(x.b);
      return x.op === "+" ? a + b : x.op === "-" ? a - b : x.op === "*" ? a * b : x.op === "<<" ? a << b : x.op === "|" ? a | b : Math.trunc(a / b);
    }
    throw new SketchError("expected a constant", x.line);
  }

  arraySuffix(t: CType, init?: () => Expr | undefined): CType {
    const dims: (number | null)[] = [];
    while (this.eat("[")) {
      if (this.eat("]")) dims.push(null);
      else {
        const x = this.expr();
        dims.push(this.globalConst(x));
        this.expect("]");
      }
    }
    void init;
    let out = t;
    for (let k = dims.length - 1; k >= 0; k--) out = { k: "array", of: out, len: dims[k] ?? -1 };
    return out;
  }

  /** Array sizes may use const globals: `const int N = 3; int pins[N];`. */
  globalConst(x: Expr): number {
    try {
      return this.constEval(x);
    } catch {
      if (x.e === "id") {
        const g = this.globals.find((d) => d.name === x.name);
        if (g?.init) return this.constEval(g.init);
      }
      throw new SketchError("an array size must be a constant", x.line);
    }
  }

  declarators(t: CType, firstName: string, firstRef: boolean): Declarator[] {
    const out: Declarator[] = [];
    let name = firstName;
    let ref = firstRef;
    for (;;) {
      let dt = this.arraySuffix(t);
      let init: Expr | undefined;
      if (this.eat("=")) init = this.is("{") ? this.initList() : this.expr();
      else if (this.is("{")) init = this.initList();
      else if (this.is("(") && dt.k === "struct") {
        // `Led l(…)`: constructor-style init
        this.next();
        const items: Expr[] = [];
        while (!this.eat(")")) {
          items.push(this.expr());
          this.eat(",");
        }
        init = { e: "list", items, line: this.peek().line };
      }
      if (dt.k === "array" && dt.len < 0 && init?.e === "list") dt = { ...dt, len: init.items.length };
      if (dt.k === "array" && dt.len < 0 && init?.e === "str") dt = { ...dt, len: init.v.length + 1 };
      out.push({ name, t: dt, init, ref });
      if (!this.eat(",")) break;
      ref = this.eat("&") || this.eat("*");
      name = this.ident();
    }
    return out;
  }

  initList(): Expr {
    const line = this.peek().line;
    this.expect("{");
    const items: Expr[] = [];
    while (!this.eat("}")) {
      items.push(this.is("{") ? this.initList() : this.assignment());
      this.eat(",");
    }
    return { e: "list", items, line };
  }

  params(): Declarator[] {
    this.expect("(");
    const out: Declarator[] = [];
    if (this.is("void") && this.is(")", 1)) this.next();
    while (!this.eat(")")) {
      const t = this.type();
      const ref = this.eat("&") || this.eat("*");
      const name = this.peek().t === "id" ? this.ident() : `_${out.length}`;
      out.push({ name, t: this.arraySuffix(t), ref });
      if (this.eat("=")) this.expr(); // default values are ignored
      this.eat(",");
    }
    return out;
  }

  block(): Stmt {
    this.expect("{");
    const body: Stmt[] = [];
    while (!this.eat("}")) {
      if (this.peek().t === "eof") throw new SketchError("missing '}'", this.peek().line);
      body.push(this.statement());
    }
    return { s: "block", body };
  }

  statement(): Stmt {
    const line = this.peek().line;
    if (this.is("{")) return this.block();
    if (this.eat(";")) return { s: "empty" };
    if (this.eat("if")) {
      this.expect("(");
      const c = this.expr();
      this.expect(")");
      const a = this.statement();
      const b = this.eat("else") ? this.statement() : undefined;
      return { s: "if", c, a, b, line };
    }
    if (this.eat("while")) {
      this.expect("(");
      const c = this.expr();
      this.expect(")");
      return { s: "while", c, body: this.statement(), line };
    }
    if (this.eat("do")) {
      const body = this.statement();
      this.expect("while");
      this.expect("(");
      const c = this.expr();
      this.expect(")");
      this.expect(";");
      return { s: "do", c, body, line };
    }
    if (this.eat("for")) {
      this.expect("(");
      const init = this.is(";") ? undefined : this.simpleStatement();
      if (!init) this.expect(";");
      const c = this.is(";") ? undefined : this.expr();
      this.expect(";");
      const step = this.is(")") ? undefined : this.expr();
      this.expect(")");
      return { s: "for", init, c, step, body: this.statement(), line };
    }
    if (this.eat("switch")) {
      this.expect("(");
      const x = this.expr();
      this.expect(")");
      this.expect("{");
      const cases: { v?: Expr; body: Stmt[] }[] = [];
      while (!this.eat("}")) {
        if (this.eat("case")) {
          const v = this.ternary();
          this.expect(":");
          cases.push({ v, body: [] });
        } else if (this.eat("default")) {
          this.expect(":");
          cases.push({ body: [] });
        } else {
          if (!cases.length) throw new SketchError("code before the first 'case'", this.peek().line);
          cases[cases.length - 1].body.push(this.statement());
        }
      }
      return { s: "switch", x, cases, line };
    }
    if (this.eat("return")) {
      const x = this.is(";") ? undefined : this.expr();
      this.expect(";");
      return { s: "return", x, line };
    }
    if (this.eat("break")) {
      this.expect(";");
      return { s: "break" };
    }
    if (this.eat("continue")) {
      this.expect(";");
      return { s: "continue" };
    }
    return this.simpleStatement();
  }

  /** A declaration or an expression, ending in ';'. */
  simpleStatement(): Stmt {
    const line = this.peek().line;
    const looksLikeDecl = this.isTypeStart() && !(this.peek(1).t === "op" && ["(", "{", ".", "::"].includes(this.peek(1).v) && !QUALIFIERS.has(this.peek().v));
    if (looksLikeDecl) {
      const t = this.type();
      const ref = this.eat("&") || this.eat("*");
      const name = this.ident();
      const decls = this.declarators(t, name, ref);
      this.expect(";");
      return { s: "decl", decls, line };
    }
    const x = this.expr();
    this.expect(";");
    return { s: "expr", x, line };
  }

  expr(): Expr {
    let x = this.assignment();
    while (this.is(",") && this.peek(1).v !== "}") {
      this.next();
      const b = this.assignment();
      x = { e: "bin", op: ",", a: x, b, line: b.line };
    }
    return x;
  }

  assignment(): Expr {
    const a = this.ternary();
    const t = this.peek();
    if (t.t === "op" && ASSIGN.has(t.v)) {
      this.next();
      const b = this.is("{") ? this.initList() : this.assignment();
      return { e: "assign", op: t.v, a, b, line: t.line };
    }
    return a;
  }

  ternary(): Expr {
    const c = this.binary(1);
    if (this.eat("?")) {
      const a = this.assignment();
      this.expect(":");
      const b = this.assignment();
      return { e: "cond", c, a, b, line: c.line };
    }
    return c;
  }

  binary(min: number): Expr {
    let a = this.unary();
    for (;;) {
      const t = this.peek();
      const p = t.t === "op" ? PREC[t.v] : undefined;
      if (p === undefined || p < min) return a;
      this.next();
      const b = this.binary(p + 1);
      a = { e: "bin", op: t.v, a, b, line: t.line };
    }
  }

  unary(): Expr {
    const t = this.peek();
    if (t.t === "op" && ["!", "~", "-", "+", "++", "--", "&", "*"].includes(t.v)) {
      this.next();
      const a = this.unary();
      if (t.v === "&" || t.v === "*") return a; // addresses aren't modelled: arrays and structs are shared already
      return { e: "un", op: t.v, a, line: t.line };
    }
    if (this.is("sizeof")) {
      this.next();
      this.expect("(");
      const x: Expr = this.isTypeStart() ? { e: "sizeof", t: this.arraySuffix(this.type()), line: t.line } : { e: "sizeof", a: this.expr(), line: t.line };
      this.expect(")");
      return x;
    }
    // a cast: (type) expr
    if (this.is("(") && this.isTypeStart(1)) {
      const save = this.i;
      this.next();
      const ty = this.type();
      while (this.eat("*")) {
        /* pointer casts: ignore */
      }
      if (this.eat(")")) return { e: "cast", t: ty, a: this.unary(), line: t.line };
      this.i = save;
    }
    return this.postfix(this.primary());
  }

  postfix(x: Expr): Expr {
    for (;;) {
      const t = this.peek();
      if (this.eat("[")) {
        const i = this.expr();
        this.expect("]");
        x = { e: "index", a: x, i, line: t.line };
      } else if (this.is(".") || this.is("->")) {
        this.next();
        const f = this.ident();
        if (this.is("(") && x.e === "id") {
          x = { e: "call", f, obj: x.name, args: this.args(), line: t.line };
        } else x = { e: "member", a: x, f, line: t.line };
      } else if (this.is("++") || this.is("--")) {
        this.next();
        x = { e: "post", op: t.v, a: x, line: t.line };
      } else return x;
    }
  }

  args(): Expr[] {
    this.expect("(");
    const out: Expr[] = [];
    while (!this.eat(")")) {
      out.push(this.assignment());
      this.eat(",");
    }
    return out;
  }

  primary(): Expr {
    const t = this.next();
    if (t.t === "num") return { e: "num", v: t.n!, float: !!t.float, line: t.line };
    if (t.t === "chr") return { e: "num", v: t.n!, float: false, line: t.line };
    if (t.t === "str") {
      let v = t.v;
      while (this.peek().t === "str") v += this.next().v; // "a" "b"
      return { e: "str", v, line: t.line };
    }
    if (t.t === "id") {
      if (this.enums.has(t.v)) return { e: "num", v: this.enums.get(t.v)!, float: false, line: t.line };
      if (this.eat("::")) return this.primary(); // Enum::VALUE / Class::thing
      if (this.structs.has(t.v) && this.is("{")) {
        const list = this.initList() as Extract<Expr, { e: "list" }>;
        return { ...list, struct: t.v };
      }
      if (this.is("(")) return { e: "call", f: t.v, args: this.args(), line: t.line };
      if (t.v === "true" || t.v === "false") return { e: "num", v: t.v === "true" ? 1 : 0, float: false, line: t.line };
      return { e: "id", name: t.v, line: t.line };
    }
    if (t.v === "(") {
      const x = this.expr();
      this.expect(")");
      return x;
    }
    if (t.v === "{") {
      this.i--;
      return this.initList();
    }
    throw new SketchError(`unexpected '${t.v || "end of file"}'`, t.line);
  }
}

/* ---------- runtime ---------- */

export type PinModeName = "input" | "output" | "input_pullup";

export interface ArduinoIO {
  pinMode(pin: number, mode: PinModeName): void;
  digitalWrite(pin: number, high: boolean): void;
  digitalRead(pin: number): boolean;
  analogRead(pin: number): number; // 0..1023
  analogWrite(pin: number, duty: number): void; // 0..1
  tone(pin: number, freq: number): void;
  noTone(pin: number): void;
  print(text: string): void;
}

interface Cell {
  t: CType;
  v: unknown;
}

class Scope {
  vars = new Map<string, Cell>();
  constructor(readonly parent?: Scope) {}
  find(name: string): Cell | undefined {
    for (let s: Scope | undefined = this; s; s = s.parent) {
      const c = s.vars.get(name);
      if (c) return c;
    }
    return undefined;
  }
}

type Signal = undefined | { brk: true } | { cont: true } | { ret: true; v: unknown };
type Run = Generator<number, Signal, void>;

const CONSTANTS: Record<string, number> = {
  HIGH: 1,
  LOW: 0,
  INPUT: 0,
  OUTPUT: 1,
  INPUT_PULLUP: 2,
  LED_BUILTIN: 13,
  LSBFIRST: 0,
  MSBFIRST: 1,
  DEC: 10,
  HEX: 16,
  BIN: 2,
  OCT: 8,
  PI: Math.PI,
  HALF_PI: Math.PI / 2,
  TWO_PI: Math.PI * 2,
  A0: 14,
  A1: 15,
  A2: 16,
  A3: 17,
  A4: 18,
  A5: 19,
  A6: 20,
  A7: 21,
  NULL: 0,
};

class Halt extends Error {}

export class ArduinoProgram {
  private parser: Parser;
  private globals = new Scope();
  private gen: Run | null = null;
  private wakeAt = 0;
  private io: ArduinoIO | null = null;
  private now = 0; // ms
  private steps = 0;
  private pendingDelay = 0;
  private depth = 0;
  private rng = 12345;
  private waits = 0; // delay()s so far
  error: string | null = null;
  /** Statements per simulation step before a busy loop is paused until the next step (keeps the page responsive). */
  budget = 20_000;

  constructor(source: string) {
    this.parser = new Parser(lex(source));
    this.parser.program();
    if (!this.parser.funcs.has("setup") || !this.parser.funcs.has("loop")) throw new SketchError("a sketch needs both setup() and loop()", 1);
  }

  /** Line-numbered errors are thrown from the constructor; this checks a sketch without running it. */
  static check(source: string): string | null {
    try {
      new ArduinoProgram(source);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  start(io: ArduinoIO) {
    this.io = io;
    this.globals = new Scope();
    this.error = null;
    this.wakeAt = 0;
    for (const d of this.parser.globals) this.declare(this.globals, d, this.globals);
    const self = this;
    this.gen = (function* (): Run {
      yield* self.call("setup", []);
      for (;;) {
        const before = self.waits;
        yield* self.call("loop", []);
        if (self.waits === before) yield 0; // loop() never waited: let the circuit run before the next one
      }
    })();
  }

  /** Run the program up to circuit time `nowMs` (until it waits in delay() or yields after loop()). */
  run(nowMs: number) {
    if (!this.gen || this.error) return;
    this.now = nowMs;
    if (nowMs < this.wakeAt) return;
    this.steps = 0;
    try {
      const r = this.gen.next();
      if (r.done) this.gen = null;
      else if (r.value > 0) {
        this.waits++;
        this.wakeAt = Math.max(this.wakeAt, nowMs) + r.value;
      } else this.wakeAt = nowMs;
    } catch (e) {
      this.error = e instanceof Halt ? "stopped" : (e as Error).message;
      this.gen = null;
    }
  }

  /* ---------- declarations ---------- */

  private zero(t: CType): unknown {
    if (t.k === "array") return Array.from({ length: Math.max(0, t.len) }, () => this.zero(t.of));
    if (t.k === "struct") {
      const fields = this.parser.structs.get(t.name) ?? [];
      return Object.fromEntries(fields.map((f) => [f.name, this.zero(f.t)]));
    }
    if (t.k === "string") return "";
    return 0;
  }

  private fill(t: CType, init: Expr, scope: Scope): unknown {
    if (t.k === "array") {
      const arr = this.zero(t) as unknown[];
      if (init.e === "list") init.items.forEach((x, i) => i < arr.length && (arr[i] = this.fill(t.of, x, scope)));
      else if (init.e === "str") [...init.v].forEach((c, i) => i < arr.length && (arr[i] = c.charCodeAt(0)));
      else return this.evalExpr(init, scope);
      return arr;
    }
    if (t.k === "struct") {
      if (init.e === "list") {
        const fields = this.parser.structs.get(t.name) ?? [];
        const obj = this.zero(t) as Record<string, unknown>;
        init.items.forEach((x, i) => fields[i] && (obj[fields[i].name] = this.fill(fields[i].t, x, scope)));
        return obj;
      }
      return this.copy(this.evalExpr(init, scope));
    }
    const v = this.evalExpr(init, scope);
    return t.k === "string" ? String(v) : wrap(Number(v), t);
  }

  private copy(v: unknown): unknown {
    if (Array.isArray(v)) return v.map((x) => this.copy(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.copy(x)]));
    return v;
  }

  private declare(target: Scope, d: Declarator, scope: Scope) {
    if (d.ref && d.init) {
      // A reference: share the referred object (struct / array element / variable).
      const lv = this.lvalue(d.init, scope);
      target.vars.set(d.name, { t: d.t, get v() { return lv.get(); }, set v(x) { lv.set(x); } } as Cell);
      return;
    }
    target.vars.set(d.name, { t: d.t, v: d.init ? this.fill(d.t, d.init, scope) : this.zero(d.t) });
  }

  /* ---------- statements ---------- */

  private tick(_line: number) {
    this.steps++;
  }

  /** In a loop that has used up this step's budget: let circuit time pass, like a real busy-wait. */
  private *breathe(): Generator<number, void, void> {
    if (this.steps > this.budget) {
      this.steps = 0;
      yield 0;
    }
  }

  private *exec(st: Stmt, scope: Scope): Run {
    switch (st.s) {
      case "block": {
        const inner = new Scope(scope);
        for (const x of st.body) {
          const r = yield* this.exec(x, inner);
          if (r) return r;
        }
        return undefined;
      }
      case "decl":
        this.tick(st.line);
        for (const d of st.decls) this.declare(scope, d, scope);
        return undefined;
      case "expr": {
        this.tick(st.line);
        const x = st.x;
        if (x.e === "call" && !x.obj && this.parser.funcs.has(x.f)) {
          const args = this.argsFor(x, scope);
          yield* this.call(x.f, args);
        } else this.evalExpr(x, scope);
        if (this.pendingDelay) {
          const d = this.pendingDelay;
          this.pendingDelay = 0;
          yield d;
        }
        return undefined;
      }
      case "if":
        this.tick(st.line);
        if (this.truthy(this.evalExpr(st.c, scope))) return yield* this.exec(st.a, scope);
        if (st.b) return yield* this.exec(st.b, scope);
        return undefined;
      case "while":
        while (this.truthy(this.evalExpr(st.c, scope))) {
          this.tick(st.line);
          yield* this.breathe();
          const r = yield* this.exec(st.body, scope);
          if (r && "brk" in r) break;
          if (r && "ret" in r) return r;
        }
        return undefined;
      case "do":
        do {
          this.tick(st.line);
          yield* this.breathe();
          const r = yield* this.exec(st.body, scope);
          if (r && "brk" in r) break;
          if (r && "ret" in r) return r;
        } while (this.truthy(this.evalExpr(st.c, scope)));
        return undefined;
      case "for": {
        const inner = new Scope(scope);
        if (st.init) yield* this.exec(st.init, inner);
        while (!st.c || this.truthy(this.evalExpr(st.c, inner))) {
          this.tick(st.line);
          yield* this.breathe();
          const r = yield* this.exec(st.body, inner);
          if (r && "brk" in r) break;
          if (r && "ret" in r) return r;
          if (st.step) this.evalExpr(st.step, inner);
        }
        return undefined;
      }
      case "switch": {
        this.tick(st.line);
        const v = Number(this.evalExpr(st.x, scope));
        let start = st.cases.findIndex((c) => c.v && Number(this.evalExpr(c.v, scope)) === v);
        if (start < 0) start = st.cases.findIndex((c) => !c.v);
        if (start < 0) return undefined;
        const inner = new Scope(scope);
        for (let k = start; k < st.cases.length; k++)
          for (const x of st.cases[k].body) {
            const r = yield* this.exec(x, inner);
            if (r && "brk" in r) return undefined;
            if (r) return r;
          }
        return undefined;
      }
      case "return":
        return { ret: true, v: st.x ? this.evalExpr(st.x, scope) : undefined };
      case "break":
        return { brk: true };
      case "continue":
        return { cont: true };
      default:
        return undefined;
    }
  }

  private argsFor(x: Extract<Expr, { e: "call" }>, scope: Scope): { v: unknown; lv?: { get(): unknown; set(v: unknown): void } }[] {
    const f = this.parser.funcs.get(x.f)!;
    return x.args.map((a, i) => (f.params[i]?.ref ? { v: undefined, lv: this.lvalue(a, scope) } : { v: this.evalExpr(a, scope) }));
  }

  private *call(name: string, args: { v: unknown; lv?: { get(): unknown; set(v: unknown): void } }[]): Run {
    const f = this.parser.funcs.get(name)!;
    if (++this.depth > 64) throw new SketchError(`${name}() calls itself too deeply`, f.line);
    const scope = new Scope(this.globals);
    f.params.forEach((p, i) => {
      const a = args[i];
      if (a?.lv) {
        const lv = a.lv;
        scope.vars.set(p.name, { t: p.t, get v() { return lv.get(); }, set v(x) { lv.set(x); } } as Cell);
      } else scope.vars.set(p.name, { t: p.t, v: p.t.k === "array" || p.t.k === "struct" ? a?.v : p.t.k === "float" ? Number(a?.v ?? 0) : wrap(Number(a?.v ?? 0), p.t) });
    });
    try {
      const r = yield* this.exec(f.body, scope);
      const v = r && "ret" in r ? r.v : undefined;
      return { ret: true, v: f.ret.k === "int" || f.ret.k === "bool" ? wrap(Number(v ?? 0), f.ret) : v };
    } finally {
      this.depth--;
    }
  }

  /** A user function called inside an expression: run it to the end (a delay() inside is applied after). */
  private callSync(name: string, args: { v: unknown; lv?: { get(): unknown; set(v: unknown): void } }[]): unknown {
    const g = this.call(name, args);
    for (;;) {
      const r = g.next();
      if (r.done) return r.value && "ret" in r.value ? r.value.v : undefined;
      this.pendingDelay += r.value;
    }
  }

  /* ---------- expressions ---------- */

  private truthy(v: unknown) {
    return typeof v === "string" ? v.length > 0 : !!v;
  }

  private typeOf(x: Expr, scope: Scope): CType {
    switch (x.e) {
      case "num":
        return x.float ? T_FLOAT : Math.abs(x.v) > 32767 ? (Math.abs(x.v) > 2147483647 ? INT(64, true) : INT(32, true)) : T_INT;
      case "str":
        return T_STR;
      case "id": {
        const c = scope.find(x.name);
        if (c) return c.t;
        return x.name in CONSTANTS && /PI/.test(x.name) ? T_FLOAT : T_INT;
      }
      case "bin":
        if (["==", "!=", "<", ">", "<=", ">=", "&&", "||"].includes(x.op)) return T_BOOL;
        if (x.op === "<<" || x.op === ">>") return arith(this.typeOf(x.a, scope), T_INT);
        if (x.op === ",") return this.typeOf(x.b, scope);
        if (x.op === "+" && (this.typeOf(x.a, scope).k === "string" || this.typeOf(x.b, scope).k === "string")) return T_STR;
        return arith(this.typeOf(x.a, scope), this.typeOf(x.b, scope));
      case "un":
        return x.op === "!" ? T_BOOL : x.op === "++" || x.op === "--" ? this.typeOf(x.a, scope) : arith(this.typeOf(x.a, scope), T_INT);
      case "post":
      case "assign":
        return this.typeOf(x.a, scope);
      case "cond":
        return arith(this.typeOf(x.a, scope), this.typeOf(x.b, scope));
      case "cast":
        return x.t;
      case "index": {
        const t = this.typeOf(x.a, scope);
        return t.k === "array" ? t.of : t.k === "string" ? INT(8, true) : T_INT;
      }
      case "member": {
        const t = this.typeOf(x.a, scope);
        if (t.k === "struct") return this.parser.structs.get(t.name)?.find((f) => f.name === x.f)?.t ?? T_INT;
        return T_INT;
      }
      case "call": {
        const f = !x.obj && this.parser.funcs.get(x.f);
        if (f) return f.ret;
        if (["millis", "micros", "pulseIn"].includes(x.f)) return T_ULONG;
        if (["sqrt", "pow", "sin", "cos", "tan", "atan2", "exp", "log", "fabs", "floor", "ceil", "round", "float", "double"].includes(x.f)) return T_FLOAT;
        if (x.f === "String") return T_STR;
        if (["max", "min", "abs", "constrain"].includes(x.f) && x.args.length) return x.args.map((a) => this.typeOf(a, scope)).reduce((a, b) => arith(a, b));
        if (x.f === "map") return INT(32, true);
        return T_INT;
      }
      case "list":
        return x.struct ? { k: "struct", name: x.struct } : T_INT;
      case "sizeof":
        return INT(16, false);
    }
  }

  private lvalue(x: Expr, scope: Scope): { get(): unknown; set(v: unknown): void; t: CType } {
    if (x.e === "id") {
      const c = scope.find(x.name);
      if (!c) throw new SketchError(`'${x.name}' is not declared`, x.line);
      return { t: c.t, get: () => c.v, set: (v) => (c.v = v) };
    }
    if (x.e === "index") {
      const arr = this.evalExpr(x.a, scope) as unknown[];
      const i = Math.trunc(Number(this.evalExpr(x.i, scope)));
      const t = this.typeOf(x, scope);
      if (!Array.isArray(arr)) throw new SketchError("indexing something that isn't an array", x.line);
      if (i < 0 || i >= arr.length) throw new SketchError(`index ${i} is outside the array (size ${arr.length}): on a real board this corrupts memory`, x.line);
      return { t, get: () => arr[i], set: (v) => (arr[i] = v) };
    }
    if (x.e === "member") {
      const obj = this.evalExpr(x.a, scope) as Record<string, unknown>;
      const t = this.typeOf(x, scope);
      if (!obj || typeof obj !== "object") throw new SketchError(`'.${x.f}' on something that isn't a struct`, x.line);
      return { t, get: () => obj[x.f], set: (v) => (obj[x.f] = v) };
    }
    throw new SketchError("this can't be assigned to", x.line);
  }

  private store(lv: { set(v: unknown): void; t: CType }, v: unknown) {
    const t = lv.t;
    lv.set(t.k === "struct" || t.k === "array" ? this.copy(v) : t.k === "string" ? String(v) : t.k === "float" ? Number(v) : wrap(Number(v), t));
  }

  private binop(op: string, a: unknown, b: unknown, t: CType): unknown {
    if (op === "+" && (typeof a === "string" || typeof b === "string")) return String(a) + String(b);
    const x = Number(a);
    const y = Number(b);
    const isInt = t.k === "int";
    let r: number;
    switch (op) {
      case "+":
        r = x + y;
        break;
      case "-":
        r = x - y;
        break;
      case "*":
        r = isInt ? Number(BigInt.asIntN(64, BigInt(Math.trunc(x)) * BigInt(Math.trunc(y)))) : x * y;
        break;
      case "/":
        if (isInt && y === 0) throw new SketchError("division by zero", 0);
        r = isInt ? Math.trunc(x / y) : x / y;
        break;
      case "%":
        if (y === 0) throw new SketchError("division by zero", 0);
        r = x % y;
        break;
      case "<<":
        r = x * 2 ** y;
        break;
      case ">>":
        r = Math.floor(x / 2 ** y);
        break;
      case "&":
        r = Number(BigInt(Math.trunc(x)) & BigInt(Math.trunc(y)));
        break;
      case "|":
        r = Number(BigInt(Math.trunc(x)) | BigInt(Math.trunc(y)));
        break;
      case "^":
        r = Number(BigInt(Math.trunc(x)) ^ BigInt(Math.trunc(y)));
        break;
      default:
        r = NaN;
    }
    return wrap(r, t);
  }

  private evalExpr(x: Expr, scope: Scope): unknown {
    switch (x.e) {
      case "num":
        return x.v;
      case "str":
        return x.v;
      case "id": {
        const c = scope.find(x.name);
        if (c) return c.v;
        if (x.name in CONSTANTS) return CONSTANTS[x.name];
        if (x.name === "Serial") return 1;
        throw new SketchError(`'${x.name}' is not declared`, x.line);
      }
      case "bin": {
        if (x.op === "&&") return this.truthy(this.evalExpr(x.a, scope)) && this.truthy(this.evalExpr(x.b, scope)) ? 1 : 0;
        if (x.op === "||") return this.truthy(this.evalExpr(x.a, scope)) || this.truthy(this.evalExpr(x.b, scope)) ? 1 : 0;
        if (x.op === ",") {
          this.evalExpr(x.a, scope);
          return this.evalExpr(x.b, scope);
        }
        const a = this.evalExpr(x.a, scope);
        const b = this.evalExpr(x.b, scope);
        if (["==", "!=", "<", ">", "<=", ">="].includes(x.op)) {
          const ct = arith(this.typeOf(x.a, scope), this.typeOf(x.b, scope));
          const [p, q] = typeof a === "string" || typeof b === "string" ? [a as never, b as never] : [wrap(Number(a), ct), wrap(Number(b), ct)];
          const r = x.op === "==" ? p === q : x.op === "!=" ? p !== q : x.op === "<" ? p < q : x.op === ">" ? p > q : x.op === "<=" ? p <= q : p >= q;
          return r ? 1 : 0;
        }
        try {
          return this.binop(x.op, a, b, this.typeOf(x, scope));
        } catch (e) {
          if (e instanceof SketchError && e.line === 0) throw new SketchError(e.message.replace(/^line 0: /, ""), x.line);
          throw e;
        }
      }
      case "un": {
        if (x.op === "++" || x.op === "--") {
          const lv = this.lvalue(x.a, scope);
          this.store(lv, Number(lv.get()) + (x.op === "++" ? 1 : -1));
          return lv.get();
        }
        const v = Number(this.evalExpr(x.a, scope));
        const t = this.typeOf(x, scope);
        if (x.op === "!") return v ? 0 : 1;
        if (x.op === "-") return wrap(-v, t);
        if (x.op === "~") return wrap(~v, t);
        return v;
      }
      case "post": {
        const lv = this.lvalue(x.a, scope);
        const old = lv.get();
        this.store(lv, Number(old) + (x.op === "++" ? 1 : -1));
        return old;
      }
      case "assign": {
        const lv = this.lvalue(x.a, scope);
        let v: unknown;
        if (x.b.e === "list" && (lv.t.k === "struct" || lv.t.k === "array")) v = this.fill(lv.t, x.b, scope);
        else v = this.evalExpr(x.b, scope);
        if (x.op !== "=") v = this.binop(x.op.slice(0, -1), lv.get(), v, arith(lv.t, this.typeOf(x.b, scope)));
        this.store(lv, v);
        return lv.get();
      }
      case "cond":
        return this.truthy(this.evalExpr(x.c, scope)) ? this.evalExpr(x.a, scope) : this.evalExpr(x.b, scope);
      case "cast": {
        const v = this.evalExpr(x.a, scope);
        return x.t.k === "float" ? Number(v) : x.t.k === "string" ? String(v) : wrap(Number(v), x.t);
      }
      case "index":
      case "member":
        return this.lvalue(x, scope).get();
      case "list":
        return x.struct ? this.fill({ k: "struct", name: x.struct }, x, scope) : x.items.map((i) => this.evalExpr(i, scope));
      case "sizeof": {
        const t = x.t ?? this.typeOf(x.a!, scope);
        if (x.a && x.a.e === "id") {
          const c = scope.find(x.a.name);
          if (c && Array.isArray(c.v) && c.t.k === "array") return (c.v as unknown[]).length * sizeOf(c.t.of);
        }
        return sizeOf(t);
      }
      case "call":
        return this.builtin(x, scope);
    }
  }

  private builtin(x: Extract<Expr, { e: "call" }>, scope: Scope): unknown {
    if (!x.obj && this.parser.funcs.has(x.f)) return this.callSync(x.f, this.argsFor(x, scope));
    const io = this.io!;
    const a = x.args.map((arg) => this.evalExpr(arg, scope));
    const n = (i: number) => Number(a[i] ?? 0);
    if (x.obj === "Serial" || x.obj === "Serial1") {
      if (x.f === "print" || x.f === "println") {
        const v = a[0];
        const t = x.args[0] ? this.typeOf(x.args[0], scope) : T_STR;
        let text = v === undefined ? "" : typeof v === "string" ? v : t.k === "float" ? Number(v).toFixed(a[1] !== undefined ? n(1) : 2) : a[1] === 16 ? Number(v).toString(16).toUpperCase() : a[1] === 2 ? Number(v).toString(2) : String(v);
        if (x.f === "println") text += "\n";
        io.print(text);
        return text.length;
      }
      if (x.f === "write") {
        io.print(typeof a[0] === "string" ? a[0] : String.fromCharCode(n(0)));
        return 1;
      }
      return 0; // begin, available, read, flush...
    }
    switch (x.f) {
      case "pinMode":
        io.pinMode(n(0), n(1) === 1 ? "output" : n(1) === 2 ? "input_pullup" : "input");
        return 0;
      case "digitalWrite":
        io.digitalWrite(n(0), !!n(1));
        return 0;
      case "digitalRead":
        return io.digitalRead(n(0)) ? 1 : 0;
      case "analogRead":
        return Math.round(io.analogRead(n(0) < 14 ? n(0) + 14 : n(0)));
      case "analogWrite":
        io.analogWrite(n(0), Math.max(0, Math.min(255, n(1))) / 255);
        return 0;
      case "tone":
        io.tone(n(0), n(1));
        if (x.args.length > 2) this.pendingDelay += 0; // the tone's duration runs in the background
        return 0;
      case "noTone":
        io.noTone(n(0));
        return 0;
      case "delay":
        this.pendingDelay += Math.max(0, n(0));
        return 0;
      case "delayMicroseconds":
        this.pendingDelay += Math.max(0, n(0)) / 1000;
        return 0;
      case "millis":
        return wrap(Math.floor(this.now), T_ULONG);
      case "micros":
        return wrap(Math.floor(this.now * 1000), T_ULONG);
      case "random": {
        this.rng = (this.rng * 1103515245 + 12345) & 0x7fffffff;
        const lo = a.length > 1 ? n(0) : 0;
        const hi = a.length > 1 ? n(1) : n(0);
        return hi > lo ? lo + (this.rng % (hi - lo)) : lo;
      }
      case "randomSeed":
        this.rng = n(0) || 1;
        return 0;
      case "constrain":
        return Math.min(Math.max(n(0), n(1)), n(2));
      case "map":
        return Math.trunc(((n(0) - n(1)) * (n(4) - n(3))) / (n(2) - n(1) || 1) + n(3));
      case "min":
        return Math.min(n(0), n(1));
      case "max":
        return Math.max(n(0), n(1));
      case "abs":
      case "fabs":
        return Math.abs(n(0));
      case "sq":
        return n(0) * n(0);
      case "sqrt":
        return Math.sqrt(n(0));
      case "pow":
        return n(0) ** n(1);
      case "sin":
      case "cos":
      case "tan":
      case "exp":
      case "log":
      case "floor":
      case "ceil":
      case "round":
        return Math[x.f](n(0));
      case "atan2":
        return Math.atan2(n(0), n(1));
      case "bitRead":
        return (n(0) >> n(1)) & 1;
      case "bit":
        return 1 << n(0);
      case "bitSet":
      case "bitClear":
      case "bitWrite": {
        const lv = this.lvalue(x.args[0], scope);
        const on = x.f === "bitSet" || (x.f === "bitWrite" && !!n(2));
        this.store(lv, on ? Number(lv.get()) | (1 << n(1)) : Number(lv.get()) & ~(1 << n(1)));
        return 0;
      }
      case "lowByte":
        return n(0) & 0xff;
      case "highByte":
        return (n(0) >> 8) & 0xff;
      case "shiftOut": {
        const [data, clock, order, val] = [n(0), n(1), n(2), n(3)];
        for (let i = 0; i < 8; i++) {
          const bitIndex = order === 1 ? 7 - i : i;
          io.digitalWrite(data, !!((val >> bitIndex) & 1));
          io.digitalWrite(clock, true);
          io.digitalWrite(clock, false);
        }
        return 0;
      }
      case "String":
        return String(a[0] ?? "");
      case "F":
        return a[0];
      case "int":
      case "long":
      case "byte":
        return Math.trunc(n(0));
      case "float":
      case "double":
        return n(0);
      case "yield":
      case "interrupts":
      case "noInterrupts":
        return 0;
      default:
        throw new SketchError(`'${x.obj ? `${x.obj}.` : ""}${x.f}()' isn't available in the simulator`, x.line);
    }
  }
}

/** Arduino pin number (D0–D13 = 0–13, A0–A7 = 14–21) for a schematic pin name like "D3", "A0", "D0/RX". */
export function arduinoPinNumber(name: string): number | null {
  const n = name.split("/")[0];
  const m = /^(D|A)(\d+)$/.exec(n);
  if (!m) {
    const a = /A(\d)$/.exec(name); // "SDA/A4"
    return a ? 14 + Number(a[1]) : null;
  }
  return m[1] === "D" ? Number(m[2]) : 14 + Number(m[2]);
}
