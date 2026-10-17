/** Circuit math used by lessons and checks. Everything here is plain, explainable formulas. */

const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];

/** Smallest standard E12 resistor value that is >= r (rounding up keeps current under target). */
export function nextE12(r: number): number {
  if (r <= 0) return 0;
  const decade = 10 ** Math.floor(Math.log10(r));
  for (const m of [...E12, 10]) {
    const v = Math.round(m * decade * 1000) / 1000;
    if (v >= r - 1e-9) return v;
  }
  return 10 * decade;
}

export interface LedDesign {
  ok: boolean;
  rIdeal: number; // Ω, exact Ohm's-law answer
  r: number; // Ω, standard part chosen
  current: number; // A, actual current with the standard part
  power: number; // W, dissipated in the resistor
}

/** R = (Vs − Vf) / I, then round up to a real resistor and recompute I and P = I²R. */
export function ledDesign(supply: number, vf: number, targetMa: number, fixedR?: number): LedDesign {
  const headroom = supply - vf;
  if (headroom <= 0 || targetMa <= 0) return { ok: false, rIdeal: 0, r: 0, current: 0, power: 0 };
  const rIdeal = headroom / (targetMa / 1000);
  const r = fixedR ?? nextE12(rIdeal);
  const current = headroom / r;
  return { ok: true, rIdeal, r, current, power: current * current * r };
}

/** τ = R·C */
export function tau(r: number, capNf: number): number {
  return r * capNf * 1e-9;
}

/** Time for a discharging RC node (v = Vs·e^(−t/τ)) to fall below a fraction of Vs: t = τ·ln(1/fraction). */
export function dischargeTime(tauS: number, fraction: number): number {
  return tauS * Math.log(1 / fraction);
}

export function fmtOhms(r: number): string {
  if (r >= 1e6) return `${trim(r / 1e6)} MΩ`;
  if (r >= 1e3) return `${trim(r / 1e3)} kΩ`;
  return `${trim(r)} Ω`;
}

function siParts(v: number, digits: number): { num: string; prefix: "" | "m" | "µ" | "n" } {
  const a = Math.abs(v);
  if (a === 0 || a >= 1) return { num: trim(v, digits), prefix: "" };
  if (a >= 1e-3) return { num: trim(v * 1e3, digits), prefix: "m" };
  if (a >= 1e-6) return { num: trim(v * 1e6, digits), prefix: "µ" };
  return { num: trim(v * 1e9, digits), prefix: "n" };
}

export function fmtSI(v: number, unit: string, digits = 3): string {
  const { num, prefix } = siParts(v, digits);
  return `${num} ${prefix}${unit}`;
}

/** LaTeX versions of the formatters, e.g. 13.6\,\text{mA}, 10\,\text{k}\Omega */
export function texSI(v: number, unit: string, digits = 3): string {
  const { num, prefix } = siParts(v, digits);
  return prefix === "µ" ? String.raw`${num}\,\mu\text{${unit}}` : String.raw`${num}\,\text{${prefix}${unit}}`;
}

export function texOhms(r: number): string {
  if (r >= 1e6) return String.raw`${trim(r / 1e6)}\,\text{M}\Omega`;
  if (r >= 1e3) return String.raw`${trim(r / 1e3)}\,\text{k}\Omega`;
  return String.raw`${trim(r)}\,\Omega`;
}

export function trim(v: number, digits = 3): string {
  return String(Number(v.toPrecision(digits)));
}

/** ATmega328P (Arduino Uno) input thresholds at 5 V. */
export const LOGIC = { vihFraction: 0.6, vilFraction: 0.3, pinMaxMa: 20, pinAbsMaxMa: 40, resistorRatingW: 0.25 };
