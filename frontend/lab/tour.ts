/**
 * "Follow an electron": the loop current actually takes in the simulation, from the source,
 * through each part on the main path, and back. Every step comes with the wire path to animate
 * along and a sentence about what happens to the electron there.
 */

import { kindInfo, netInfo } from "./knowledge";
import { cleanPinName, keyOf, type Layout, type Pt } from "./scene";
import type { SimResult } from "./sim";
import { amps, volts } from "./values";

export interface TourStep {
  /** A part the electron goes through, or a wire (net) it travels along. */
  ref?: string;
  net?: string;
  title: string;
  text: string;
  /** Points to move the electron along (schematic mm). */
  path: Pt[];
  /** The path crosses a label / power symbol: the electron "jumps" between same-named places. */
  jump?: boolean;
}

const SOURCES = new Set(["battery", "regulator_7805", "regulator_ams1117_3v3", "arduino_uno", "arduino_nano", "timer_555", "shift_register_74hc595", "connector_2pin", "connector_3pin"]);

/** Shortest wire path between two points of a net (BFS over wire segments). */
function wirePath(layout: Layout, net: string, from: Pt, to: Pt): { path: Pt[]; jump: boolean } {
  const adj = new Map<string, Pt[]>();
  const pos = new Map<string, Pt>();
  const add = (a: Pt, b: Pt) => {
    for (const [p, q] of [
      [a, b],
      [b, a],
    ] as [Pt, Pt][]) {
      pos.set(keyOf(p), p);
      (adj.get(keyOf(p)) ?? adj.set(keyOf(p), []).get(keyOf(p))!).push(q);
    }
  };
  for (const w of layout.wires) if (w.net === net) for (let i = 0; i < w.pts.length - 1; i++) add(w.pts[i], w.pts[i + 1]);
  // Points on a segment's interior (pins on a long wire) join that segment.
  const pts = [...pos.values(), from, to];
  for (const w of layout.wires) {
    if (w.net !== net) continue;
    for (let i = 0; i < w.pts.length - 1; i++) {
      const [a, b] = [w.pts[i], w.pts[i + 1]];
      for (const p of pts) {
        const inX = Math.min(a[0], b[0]) - 0.01 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 0.01;
        const inY = Math.min(a[1], b[1]) - 0.01 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 0.01;
        const onLine = Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 0.05;
        if (inX && inY && onLine && keyOf(p) !== keyOf(a) && keyOf(p) !== keyOf(b)) {
          add(p, a);
          add(p, b);
        }
      }
    }
  }
  const start = keyOf(from);
  const goal = keyOf(to);
  const prev = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const k = queue.shift()!;
    if (k === goal) break;
    for (const q of adj.get(k) ?? []) {
      const kq = keyOf(q);
      if (!prev.has(kq)) {
        prev.set(kq, k);
        queue.push(kq);
      }
    }
  }
  if (!prev.has(goal)) return { path: [from, to], jump: true };
  const out: Pt[] = [];
  for (let k: string | null = goal; k; k = prev.get(k) ?? null) out.unshift(pos.get(k) ?? (k === start ? from : to));
  return { path: out, jump: false };
}

export function buildTour(layout: Layout, sim: SimResult): TourStep[] {
  const parts = new Map(layout.parts.map((p) => [p.ref, p]));
  const I = (ref: string, pin: string) => sim.pinI[ref]?.[pin] ?? 0;

  // The source: the part pin pushing the most current out into the circuit.
  let best: { ref: string; pin: string; i: number } | null = null;
  for (const p of layout.parts) {
    if (!SOURCES.has(p.kind)) continue;
    for (const pin of p.pins) {
      const out = -I(p.ref, pin.number);
      if (pin.net && out > (best?.i ?? 1e-6)) best = { ref: p.ref, pin: pin.number, i: out };
    }
  }
  if (!best) return [];

  // Walk the conventional-current loop: always take the branch carrying the most current.
  const hops: { ref: string; enter: string; leave: string; netIn: string; netOut: string }[] = [];
  let net = parts.get(best.ref)!.pins.find((p) => p.number === best!.pin)!.net!;
  let fromRef = best.ref;
  let fromPin = best.pin;
  const firstNet = net;
  for (let guard = 0; guard < 24; guard++) {
    let next: { ref: string; pin: string; i: number } | null = null;
    for (const p of layout.parts) {
      for (const pin of p.pins) {
        if (pin.net !== net || (p.ref === fromRef && pin.number === fromPin)) continue;
        const into = I(p.ref, pin.number);
        if (into > (next?.i ?? 1e-6)) next = { ref: p.ref, pin: pin.number, i: into };
      }
    }
    if (!next) break;
    const part = parts.get(next.ref)!;
    if (next.ref === best.ref) {
      hops.push({ ref: next.ref, enter: next.pin, leave: best.pin, netIn: net, netOut: firstNet });
      break;
    }
    // Leave by the pin where the most current comes out (not the one we came in by).
    const exit = part.pins.filter((p) => p.number !== next!.pin && p.net).sort((a, b) => I(part.ref, a.number) - I(part.ref, b.number))[0];
    if (!exit || -I(part.ref, exit.number) < 1e-7) break;
    hops.push({ ref: next.ref, enter: next.pin, leave: exit.number, netIn: net, netOut: exit.net! });
    if (hops.length > 1 && hops.slice(0, -1).some((h) => h.ref === next!.ref)) break; // went in a circle
    net = exit.net!;
    fromRef = next.ref;
    fromPin = exit.number;
  }
  if (!hops.length) return [];

  // Electrons go the other way round: reverse the loop.
  const pinAt = (ref: string, num: string) => parts.get(ref)!.pins.find((p) => p.number === num)!;
  const label = (ref: string, num: string) => {
    const part = parts.get(ref)!;
    const pin = pinAt(ref, num);
    const detail = kindInfo(part.kind).pin(num, pin.name);
    return detail.title || cleanPinName(pin.name) || `pin ${num}`;
  };
  // Electrons go the other way round: they leave the source where conventional current returns
  // to it, pass the loads in reverse order, and re-enter where conventional current left.
  const closing = hops[hops.length - 1].ref === best.ref ? hops[hops.length - 1] : null;
  const loads = closing ? hops.slice(0, -1) : hops;
  if (!loads.length) return [];
  const sourcePart = parts.get(best.ref)!;
  const steps: TourStep[] = [];
  const startPin = closing ? pinAt(best.ref, closing.enter) : pinAt(loads[loads.length - 1].ref, loads[loads.length - 1].leave);
  steps.push({
    ref: best.ref,
    title: `Start at ${best.ref}`,
    text: `Electrons are negative, so they flow the opposite way to the arrows of 'conventional' current: out of ${sourcePart.kind === "battery" ? "the battery's − terminal" : `${best.ref}'s ${label(best.ref, startPin.number)}`}, around the loop, and back. Follow one.`,
    path: [startPin.at, startPin.at],
  });
  let at = startPin.at;
  const along = (net: string, to: Pt) => {
    const wire = wirePath(layout, net, at, to);
    const v = sim.netV[net];
    const info = netInfo(net, [], v);
    steps.push({
      net,
      title: `Along ${net}`,
      text: wire.jump
        ? `This wire is drawn in more than one place with the same name, so the electron is still on the same wire where it reappears. ${info.text}`
        : `${info.title}: ${v !== undefined ? `everywhere on this wire the voltage is ${volts(v)}. ` : ""}Wires barely resist, so the electron loses (almost) nothing here.`,
      path: wire.path,
      jump: wire.jump,
    });
    at = to;
  };
  for (const hop of [...loads].reverse()) {
    const part = parts.get(hop.ref)!;
    const inPin = pinAt(hop.ref, hop.leave); // electrons enter where conventional current leaves
    const outPin = pinAt(hop.ref, hop.enter);
    along(hop.netOut, inPin.at);
    const drop = (sim.netV[hop.netIn] ?? 0) - (sim.netV[hop.netOut] ?? 0);
    const current = Math.abs(sim.pinI[hop.ref]?.[hop.enter] ?? 0);
    steps.push({
      ref: hop.ref,
      title: `Through ${hop.ref}`,
      text: kindInfo(part.kind).tour({ ref: hop.ref, drop, i: current, value: part.value, enter: label(hop.ref, hop.leave), leave: label(hop.ref, hop.enter) }),
      path: [inPin.at, part.center, outPin.at],
    });
    at = outPin.at;
  }
  const back = pinAt(best.ref, best.pin);
  along(loads[0].netIn, back.at);
  const lift = (sim.netV[loads[0].netIn] ?? 0) - (closing ? (sim.netV[closing.netIn] ?? 0) : 0);
  steps.push({
    ref: best.ref,
    title: `Back to ${best.ref}`,
    text: kindInfo(sourcePart.kind).tour({ ref: best.ref, drop: -lift, i: best.i, value: sourcePart.value, enter: label(best.ref, best.pin), leave: closing ? label(best.ref, closing.enter) : "" }),
    path: [back.at, sourcePart.center, startPin.at],
  });
  at = startPin.at;
  const reversed = loads;
  const total = reversed.reduce((s, h) => s + Math.max(0, (sim.netV[h.netIn] ?? 0) - (sim.netV[h.netOut] ?? 0)), 0);
  steps.push({
    title: "Round again",
    text: `That's the whole loop. The energy the source gave it (${volts(total)}) was all spent in the parts along the way; that's always true, for every loop (Kirchhoff's voltage law). ${amps(best.i)} of current means about ${(best.i / 1.602e-19).toExponential(1)} electrons pass any point every second.`,
    path: [at, at],
  });
  return steps;
}
