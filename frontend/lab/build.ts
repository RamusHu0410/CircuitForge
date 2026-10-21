/**
 * A circuit the student builds by hand in practice mode: placed parts, power symbols and wires
 * between pins. It turns into the same Netlist the simulator and the checker use, and into a
 * Layout the 3D view can draw, so a correct build can be switched on.
 */

import { footprint } from "../components/practice/physical";
import { cleanPinName, pinInner, place, type Layout, type Netlist, type Pt, type Scene } from "./scene";

export type Look = "schematic" | "physical";

export interface BuildPart {
  id: string;
  ref: string;
  kind: string;
  value: string;
  lib_id: string;
  x: number;
  y: number;
  rot: number;
}

export interface BuildPort {
  id: string;
  net: string;
  lib_id: string;
  x: number;
  y: number;
}

export interface End {
  id: string; // part or port id
  pin: string;
}

export interface BuildWire {
  id: string;
  a: End;
  b: End;
}

export interface Build {
  parts: BuildPart[];
  ports: BuildPort[];
  wires: BuildWire[];
}

export const emptyBuild = (): Build => ({ parts: [], ports: [], wires: [] });

export interface PlacedPin {
  number: string;
  name: string;
  label: string;
  at: Pt;
  inner: Pt;
}

/** Rotate a screen-space offset clockwise by rot degrees (what SVG rotate() does). */
export function turn([x, y]: Pt, rot: number): Pt {
  const r = ((rot % 360) + 360) % 360;
  return r === 90 ? [-y, x] : r === 180 ? [-x, -y] : r === 270 ? [y, -x] : [x, y];
}

export function partPins(part: BuildPart, look: Look, scene: Scene, pinNames: Record<string, string>): PlacedPin[] {
  if (look === "schematic") {
    const lib = scene.library[part.lib_id];
    const pl = { x: part.x, y: part.y, rot: part.rot, mirror: false };
    return lib.pins
      .filter((p) => !p.hidden)
      .map((p) => ({ number: p.number, name: p.name, label: cleanPinName(p.name) || `pin ${p.number}`, at: place(pl, p.x, p.y), inner: pinInner(pl, p) }));
  }
  const fp = footprint(part.kind, part.value, pinNames);
  return Object.entries(fp.pins).map(([number, local]) => {
    const [dx, dy] = turn(local, part.rot);
    return { number, name: pinNames[number] ?? number, label: fp.pinLabels[number] ?? `pin ${number}`, at: [part.x + dx, part.y + dy] as Pt, inner: [part.x, part.y] as Pt };
  });
}

/** Which pins are joined: wires, plus power symbols with the same name. */
function nets(build: Build): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const join = (a: string, b: string) => parent.set(find(a), find(b));
  for (const w of build.wires) join(`${w.a.id}.${w.a.pin}`, `${w.b.id}.${w.b.pin}`);
  const byName = new Map<string, string>();
  for (const p of build.ports) {
    const k = `${p.id}.1`;
    find(k);
    if (byName.has(p.net)) join(k, byName.get(p.net)!);
    else byName.set(p.net, k);
  }
  // Name each group: a power symbol's name if it has one, else N1, N2, ...
  const names = new Map<string, string>();
  for (const p of build.ports) names.set(find(`${p.id}.1`), p.net);
  let n = 0;
  const out = new Map<string, string>();
  for (const k of parent.keys()) {
    const root = find(k);
    if (!names.has(root)) names.set(root, `N${++n}`);
    out.set(k, names.get(root)!);
  }
  return out;
}

export function buildNetlist(build: Build, target: Netlist): Netlist {
  const net = nets(build);
  const parts = build.parts.map((p) => {
    const t = target.parts.find((q) => q.ref === p.ref);
    const pins: Record<string, string> = {};
    for (const num of Object.keys(t?.pinNames ?? {})) {
      const name = net.get(`${p.id}.${num}`);
      if (name) pins[num] = name;
    }
    return { ref: p.ref, kind: p.kind, value: p.value, purpose: t?.purpose ?? "", pins, pinNames: t?.pinNames ?? {} };
  });
  return { parts, nets: [...new Set(net.values())] };
}

export function buildLayout(build: Build, look: Look, scene: Scene, target: Netlist): Layout {
  const net = nets(build);
  const where = new Map<string, Pt>();
  const parts = build.parts.map((p) => {
    const pinNames = target.parts.find((q) => q.ref === p.ref)?.pinNames ?? {};
    const pins = partPins(p, look, scene, pinNames).map((pin) => {
      where.set(`${p.id}.${pin.number}`, pin.at);
      return { number: pin.number, name: pin.name, at: pin.at, inner: pin.inner, net: net.get(`${p.id}.${pin.number}`) };
    });
    const xs = pins.map((q) => q.at[0]);
    const ys = pins.map((q) => q.at[1]);
    const bbox: [number, number, number, number] = [Math.min(...xs, p.x) - 3, Math.min(...ys, p.y) - 3, Math.max(...xs, p.x) + 3, Math.max(...ys, p.y) + 3];
    return { ref: p.ref, kind: p.kind, value: p.value, purpose: "", center: [p.x, p.y] as Pt, bbox, rot: p.rot, pins };
  });
  for (const port of build.ports) where.set(`${port.id}.1`, [port.x, port.y]);
  const wires = build.wires
    .map((w) => {
      const a = where.get(`${w.a.id}.${w.a.pin}`);
      const b = where.get(`${w.b.id}.${w.b.pin}`);
      return a && b ? { net: net.get(`${w.a.id}.${w.a.pin}`) ?? "", pts: [a, b], jumper: true } : null;
    })
    .filter((w): w is NonNullable<typeof w> => !!w);
  const all = [...where.values()];
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  return {
    parts,
    wires,
    ports: build.ports.map((p) => ({ net: p.net, at: [p.x, p.y] as Pt, ground: /GND/i.test(p.net), dir: [0, /GND/i.test(p.net) ? 1 : -1] as Pt })),
    labels: [],
    junctions: [],
    bbox: all.length ? [Math.min(...xs) - 12, Math.min(...ys) - 12, Math.max(...xs) + 12, Math.max(...ys) + 12] : [0, 0, 100, 100],
  };
}
