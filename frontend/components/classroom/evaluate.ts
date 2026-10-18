/**
 * Evaluates the backend's playground formulas, e.g. "max(0, (Vs - Vf) / R) * 1000".
 * Only arithmetic, the listed functions and the playground's own variable names are allowed
 * (the backend tests check its formulas against the same rules), so nothing else can run.
 */
const SAFE = /^[0-9A-Za-z_+\-*/().,\s]*$/;
const FUNCS: Record<string, unknown> = { sqrt: Math.sqrt, exp: Math.exp, log: Math.log, PI: Math.PI, min: Math.min, max: Math.max, abs: Math.abs };

export function compile(expr: string, names: string[]): ((values: Record<string, number>) => number) | null {
  if (!SAFE.test(expr)) return null;
  const used = expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  if (!used.every((n) => n in FUNCS || names.includes(n))) return null;
  const args = [...Object.keys(FUNCS), ...names];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(...args, `"use strict"; return (${expr});`) as (...a: unknown[]) => number;
  return (values) => {
    const v = fn(...Object.values(FUNCS), ...names.map((n) => values[n]));
    return typeof v === "number" ? v : NaN;
  };
}

/** 4700 Ω -> "4.7 kΩ", 0.5 V -> "0.5 V". */
export function formatValue(v: number, unit: string, digits = 3): string {
  if (!Number.isFinite(v)) return "—";
  const trim = (x: number) => String(Number(x.toPrecision(digits)));
  if (unit === "Ω" || unit === "Hz") {
    if (Math.abs(v) >= 1e6) return `${trim(v / 1e6)} M${unit}`;
    if (Math.abs(v) >= 1e3) return `${trim(v / 1e3)} k${unit}`;
  }
  return `${trim(v)} ${unit}`.trim();
}
