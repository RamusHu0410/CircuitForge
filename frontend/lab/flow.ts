/**
 * Where the current goes along the drawn wires.
 *
 * The simulator knows the current at every part pin. Each net's wires form a small tree, so the
 * current on each wire segment follows from Kirchhoff's current law: whatever enters a branch has
 * to leave through it. Wires connected only by name (labels, power symbols) pass their share on
 * through those points. The views animate electrons along these segments.
 */

import { keyOf, type Layout, type LayoutWire, type Pt } from "./scene";
import type { SimResult } from "./sim";

export interface FlowSegment {
  net: string;
  a: Pt;
  b: Pt;
  /** Conventional current from a to b (A); negative means b to a. */
  i: number;
  kind?: LayoutWire["kind"];
}

export interface Flow {
  segments: FlowSegment[];
  /** Current through each part, drawn as a path inside its body. */
  through: { ref: string; a: Pt; b: Pt; i: number }[];
  /** Current leaving the drawing through a power symbol / label (positive = into the drawing). */
  ports: { at: Pt; net: string; i: number }[];
}

function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  const eps = 0.01;
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > eps * Math.max(1, Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]))) return false;
  const inside = Math.min(a[0], b[0]) - eps <= p[0] && p[0] <= Math.max(a[0], b[0]) + eps && Math.min(a[1], b[1]) - eps <= p[1] && p[1] <= Math.max(a[1], b[1]) + eps;
  return inside && keyOf(p) !== keyOf(a) && keyOf(p) !== keyOf(b);
}

type Seg = [Pt, Pt, LayoutWire["kind"]];

/** Drawn wire segments of one net, split wherever something touches them mid-way. A jumper or a
 *  breadboard strip only connects at its ends: a hole it happens to pass over isn't joined to it. */
function splitSegments(segs: Seg[], points: Pt[]): Seg[] {
  const out: Seg[] = [];
  const all = [...points, ...segs.flatMap(([a, b]) => [a, b])];
  for (const [a, b, kind] of segs) {
    if (kind === "jumper" || kind === "strip") {
      out.push([a, b, kind]);
      continue;
    }
    const cuts = all.filter((p) => onSegment(p, a, b));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = (p: Pt) => ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
    const ordered = [a, ...[...new Map(cuts.map((p) => [keyOf(p), p])).values()].sort((p, q) => t(p) - t(q)), b];
    for (let i = 0; i < ordered.length - 1; i++) out.push([ordered[i], ordered[i + 1], kind]);
  }
  return out;
}

export function computeFlow(layout: Layout, sim: SimResult): Flow {
  const segments: FlowSegment[] = [];
  const ports: Flow["ports"] = [];
  const nets = [...new Set([...layout.wires.map((w) => w.net), ...layout.parts.flatMap((p) => p.pins.map((q) => q.net ?? ""))])].filter(Boolean);

  for (const net of nets) {
    const pins = layout.parts.flatMap((part) => part.pins.filter((pin) => pin.net === net).map((pin) => ({ at: pin.at, inject: -(sim.pinI[part.ref]?.[pin.number] ?? 0) })));
    const exits: Pt[] = [...layout.ports.filter((p) => p.net === net).map((p) => p.at), ...layout.labels.filter((l) => l.net === net).map((l) => l.at)];
    const raw: Seg[] = layout.wires.filter((w) => w.net === net).flatMap((w) => w.pts.slice(1).map((p, i) => [w.pts[i], p, w.kind] as Seg));
    const segs = splitSegments(raw, [...pins.map((p) => p.at), ...exits, ...layout.junctions.filter((j) => j.net === net).map((j) => j.at)]);

    // Graph over points.
    const pos = new Map<string, Pt>();
    const adj = new Map<string, { to: string; seg: number }[]>();
    const touch = (p: Pt) => {
      const k = keyOf(p);
      if (!pos.has(k)) {
        pos.set(k, p);
        adj.set(k, []);
      }
      return k;
    };
    segs.forEach(([a, b], i) => {
      const ka = touch(a);
      const kb = touch(b);
      adj.get(ka)!.push({ to: kb, seg: i });
      adj.get(kb)!.push({ to: ka, seg: i });
    });
    const inject = new Map<string, number>();
    for (const p of pins) inject.set(touch(p.at), (inject.get(keyOf(p.at)) ?? 0) + p.inject);
    const exitKeys = new Set(exits.map(touch));

    const flows = new Array<number>(segs.length).fill(0);
    const seen = new Set<string>();
    for (const start of pos.keys()) {
      if (seen.has(start)) continue;
      // Breadth-first spanning tree of this connected group.
      const order: string[] = [start];
      const parent = new Map<string, { node: string; seg: number } | null>([[start, null]]);
      seen.add(start);
      for (let i = 0; i < order.length; i++) {
        for (const { to, seg } of adj.get(order[i])!) {
          if (seen.has(to)) continue;
          seen.add(to);
          parent.set(to, { node: order[i], seg });
          order.push(to);
        }
      }
      // What the group can't balance on its own goes through its labels / power symbols.
      const groupExits = order.filter((k) => exitKeys.has(k));
      const imbalance = order.reduce((s, k) => s + (inject.get(k) ?? 0), 0);
      const local = new Map(order.map((k) => [k, inject.get(k) ?? 0]));
      for (const k of groupExits) {
        const share = -imbalance / groupExits.length;
        local.set(k, local.get(k)! + share);
        ports.push({ at: pos.get(k)!, net, i: -share });
      }
      // Leaves first: the current on the wire to the parent is everything injected below it.
      for (let i = order.length - 1; i > 0; i--) {
        const k = order[i];
        const up = parent.get(k)!;
        const sub = local.get(k)!;
        const [a] = segs[up.seg];
        flows[up.seg] += keyOf(a) === k ? sub : -sub; // positive: from a toward b
        local.set(up.node, local.get(up.node)! + sub);
      }
    }
    segs.forEach(([a, b, kind], i) => segments.push({ net, a, b, i: flows[i], kind }));
  }

  const through: Flow["through"] = [];
  for (const part of layout.parts) {
    const cur = sim.pinI[part.ref] ?? {};
    const pins = part.pins.filter((p) => p.net);
    if (pins.length === 2) {
      const [p, q] = pins;
      through.push({ ref: part.ref, a: p.at, b: q.at, i: cur[p.number] ?? 0 });
    } else {
      for (const p of pins) through.push({ ref: part.ref, a: p.at, b: part.center, i: cur[p.number] ?? 0 });
    }
  }
  return { segments, through, ports };
}

/** How fast electrons drift on screen (mm/s): logarithmic so 0.1 mA and 100 mA both read. */
export const flowSpeed = (i: number) => (Math.abs(i) < 2e-6 ? 0 : 3 + 9 * Math.log10(1 + Math.abs(i) * 1e4));
