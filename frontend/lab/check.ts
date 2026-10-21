/**
 * Does the student's build connect the same pins as the target circuit?
 *
 * Only connectivity matters, not where things are drawn. Identical parts may be swapped (R1 and R2
 * of the same value), and parts that don't care about direction (resistors, ceramic capacitors,
 * buttons) may be turned round. Feedback names pins by what they do ("D1's cathode (−)"), and
 * spots the classic mistakes: an LED, battery or electrolytic capacitor in backwards.
 */

import { kindInfo } from "./knowledge";
import { cleanPinName, type Netlist, type NetPart } from "./scene";

export interface CheckResult {
  ok: boolean;
  right: number; // connections made correctly
  total: number; // connections in the target
  unplaced: string[]; // parts not used yet
  hints: string[]; // the most useful few, mistakes first
}

/** Pin permutations a part may be turned to without changing the circuit. */
const SYMMETRY: Record<string, Record<string, string>[]> = {
  resistor: [{ "1": "2", "2": "1" }],
  capacitor: [{ "1": "2", "2": "1" }],
  push_button: [{ "1": "2", "2": "1" }],
  potentiometer: [{ "1": "3", "3": "1", "2": "2" }],
};

/** Parts whose direction matters, with what goes wrong when reversed. */
const POLAR: Record<string, { swap: Record<string, string>; message: (ref: string) => string }> = {
  led: { swap: { "1": "2", "2": "1" }, message: (r) => `${r} is backwards. An LED only lets current in at its anode (+, the longer leg) and out at its cathode (−, the flat side).` },
  diode: { swap: { "1": "2", "2": "1" }, message: (r) => `${r} is backwards: the stripe (cathode) goes toward the lower voltage.` },
  battery: { swap: { "1": "2", "2": "1" }, message: (r) => `${r} is the wrong way round: swap its + and − connections.` },
  capacitor_polarized: { swap: { "1": "2", "2": "1" }, message: (r) => `${r} is backwards: an electrolytic capacitor's + lead must go to the higher voltage, or it can burst.` },
};

const pinKey = (ref: string, pin: string) => `${ref}.${pin}`;
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function pairs(netlist: Netlist): Set<string> {
  const byNet = new Map<string, string[]>();
  for (const p of netlist.parts) for (const [pin, net] of Object.entries(p.pins)) (byNet.get(net) ?? byNet.set(net, []).get(net)!).push(pinKey(p.ref, pin));
  const out = new Set<string>();
  for (const pins of byNet.values()) for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) out.add(pairKey(pins[i], pins[j]));
  return out;
}

const normValue = (v: string) => v.trim().toLowerCase().replace(/[Ωohm\s]/g, "");

function pinLabel(part: NetPart | undefined, pin: string): string {
  if (!part) return pin;
  const d = kindInfo(part.kind).pin(pin, part.pinNames[pin] ?? "");
  const name = d.title || cleanPinName(part.pinNames[pin] ?? "") || `pin ${pin}`;
  // "Cathode (−)" reads better mid-sentence as "cathode (−)"; "TRIG" stays as it is.
  return `${part.ref}'s ${/^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name}`;
}

export function checkBuild(target: Netlist, user: Netlist): CheckResult {
  const want = pairs(target);
  const targetParts = new Map(target.parts.map((p) => [p.ref, p]));
  const placed = user.parts;
  const unplaced = target.parts.filter((t) => !placed.some((u) => u.ref === t.ref)).map((t) => t.ref);

  // Candidate target parts for each user part: same kind and value.
  const options = placed.map((u) => target.parts.filter((t) => t.kind === u.kind && normValue(t.value) === normValue(u.value)).map((t) => t.ref));

  const mapPins = (u: NetPart, ref: string, perm: Record<string, string> | null) => {
    const out: Record<string, string> = {};
    for (const [pin, net] of Object.entries(u.pins)) out[perm?.[pin] ?? pin] = net;
    return { ...u, ref, pins: out };
  };
  const score = (have: Set<string>) => {
    let good = 0;
    let bad = 0;
    for (const p of have) (want.has(p) ? good++ : bad++);
    return { good, bad, value: good - bad };
  };

  // Backtracking over which target part each placed part plays and how it's turned.
  let best: { parts: NetPart[]; value: number } | null = null;
  let budget = 40_000;
  const chosen: NetPart[] = [];
  const used = new Set<string>();
  const search = (i: number) => {
    if (budget-- <= 0) return;
    if (i === placed.length) {
      const s = score(pairs({ parts: chosen, nets: [] }));
      if (!best || s.value > best.value) best = { parts: [...chosen], value: s.value };
      return;
    }
    const u = placed[i];
    const refs = options[i].filter((r) => !used.has(r));
    const candidates = refs.length ? refs : [u.ref];
    for (const ref of candidates) {
      for (const perm of [null, ...(SYMMETRY[u.kind] ?? [])]) {
        used.add(ref);
        chosen.push(mapPins(u, ref, perm));
        search(i + 1);
        chosen.pop();
        used.delete(ref);
      }
    }
  };
  search(0);
  const mapped = best ? (best as { parts: NetPart[] }).parts : placed;
  const have = pairs({ parts: mapped, nets: [] });
  const right = [...have].filter((p) => want.has(p)).length;
  const hints: string[] = [];

  // Classic mistakes first: a polarised part in backwards (its other hints would just be noise).
  const backwards = new Set<string>();
  for (const part of mapped) {
    const polar = POLAR[part.kind];
    if (!polar) continue;
    const flipped = mapped.map((q) => (q === part ? mapPins(q, q.ref, polar.swap) : q));
    const s1 = score(pairs({ parts: flipped, nets: [] }));
    const s0 = score(have);
    if (s1.value > s0.value + 0.5) {
      hints.push(polar.message(part.ref));
      backwards.add(part.ref);
    }
  }

  // Then what's missing and what shouldn't be there, one per net, in words.
  const missing = [...want].filter((p) => !have.has(p));
  const extra = [...have].filter((p) => !want.has(p));
  const label = (k: string) => {
    const [ref, pin] = k.split(".");
    return pinLabel(targetParts.get(ref), pin);
  };
  const mentioned = new Set<string>();
  const aboutBackwards = (p: string) => p.split("|").some((k) => backwards.has(k.split(".")[0]));
  for (const p of missing) {
    if (aboutBackwards(p)) continue;
    const [a, b] = p.split("|");
    if (mentioned.has(a) || mentioned.has(b)) continue;
    mentioned.add(a);
    mentioned.add(b);
    hints.push(`${label(a)} should connect to ${label(b)}.`);
  }
  for (const p of extra) {
    if (aboutBackwards(p)) continue;
    const [a, b] = p.split("|");
    hints.push(`${label(a)} and ${label(b)} shouldn't be connected.`);
  }
  if (unplaced.length) hints.unshift(`Still to place: ${unplaced.join(", ")}.`);

  return { ok: !unplaced.length && missing.length === 0 && extra.length === 0, right, total: want.size, unplaced, hints: hints.slice(0, 6) };
}
