/** Component values and units, the same way the engine reads them (backend/app/ai/lessons.py). */

const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, R: 1 };

/** "330" → 330, "4.7k"/"4k7" → 4700, "100n" → 1e-7, "10u" → 1e-5, "9V" → 9, "470R" → 470. */
export function parseValue(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([pnuµmkKMR]?)(\d*)\s*(?:[VFAΩ]|ohm)?$/.exec(text.trim().replace("Ω", ""));
  if (!m) return null;
  const [, whole, prefix, frac] = m;
  return parseFloat(whole + (frac ? `.${frac}` : "")) * (PREFIX[prefix] ?? 1);
}

/** Typical forward voltages (V) at 20 mA, as the engine assumes. */
export const LED_VF = { red: 2.0, orange: 2.0, yellow: 2.1, green: 2.2, blue: 3.1, white: 3.1 } as const;
export type LedColor = keyof typeof LED_VF;

export function ledColor(value: string): LedColor {
  const v = value.toLowerCase();
  return (Object.keys(LED_VF) as LedColor[]).find((c) => v.includes(c)) ?? "red";
}

export const LED_RGB: Record<LedColor, string> = {
  red: "#ff2a1f",
  orange: "#ff8a1a",
  yellow: "#ffd51a",
  green: "#2bdc4a",
  blue: "#2f7bff",
  white: "#f4f7ff",
};

/** Volts of a supply net from its name: "+5V" → 5, "+3V3" → 3.3, "VIN_12V" → 12. */
export function railVolts(net: string): number | null {
  const m = /(\d+)V(\d*)/i.exec(net);
  if (!m) return null;
  return parseFloat(m[1] + (m[2] ? `.${m[2]}` : ""));
}

function num(x: number, digits: number): string {
  const t = x.toPrecision(digits);
  return t.includes("e") ? x.toFixed(Math.max(0, digits - 1)) : String(parseFloat(t));
}

/** 0.0091 A → "9.1 mA", 4700 Ω → "4.7 kΩ". */
export function si(x: number, unit: string, digits = 3): string {
  if (!isFinite(x)) return `— ${unit}`;
  const a = Math.abs(x);
  if (a < 1e-12) return `0 ${unit}`;
  for (const [f, p] of [
    [1e6, "M"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "µ"],
    [1e-9, "n"],
  ] as const) {
    if (a >= f * 0.9995) return `${num(x / f, digits)} ${p}${unit}`;
  }
  return `${num(x / 1e-12, digits)} p${unit}`;
}

export const volts = (v: number) => `${Math.abs(v) < 0.005 ? "0.00" : v.toFixed(2)} V`;
export const amps = (i: number) => si(i, "A", 2);

/** Resistor colour bands for a value (4-band: digit, digit, multiplier, gold tolerance). */
export const BAND_COLORS = ["#111", "#7b4a1e", "#e0262a", "#ff8a1a", "#ffd51a", "#2c9e3b", "#2f6fd8", "#8a4fd6", "#8a8a8a", "#f4f4f4"];
export const BAND_NAMES = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "grey", "white"];

export function resistorBands(ohms: number): { colors: string[]; names: string[] } {
  if (!(ohms > 0)) return { colors: [BAND_COLORS[0], BAND_COLORS[0], BAND_COLORS[0], "#c9a227"], names: ["black", "black", "black", "gold"] };
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / 10 ** exp);
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    exp += 1;
  }
  const d1 = Math.floor(digits / 10);
  const d2 = digits % 10;
  const mult = Math.max(0, Math.min(9, exp));
  return {
    colors: [BAND_COLORS[d1], BAND_COLORS[d2], BAND_COLORS[mult], "#c9a227"],
    names: [BAND_NAMES[d1], BAND_NAMES[d2], BAND_NAMES[mult], "gold"],
  };
}
