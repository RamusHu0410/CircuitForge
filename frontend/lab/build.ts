/**
 * A circuit the student builds by hand in practice mode: placed parts, power symbols and wires
 * between pins. It turns into the same Netlist the simulator and the checker use, and into a
 * Layout the 3D view can draw, so a correct build can be switched on.
 */

import { footprint } from "../components/practice/physical";
import { cleanPinName, pinInner, place, symbolBox, type Layout, type LibSymbol, type Netlist, type Pt, type Scene, type SceneComponent, type ScenePort } from "./scene";

export type Look = "schematic" | "physical";

/** Jumper colours, in the order wires are added (the 2D builder and the 3D view use the same). */
export const WIRE_COLORS = ["#d93b2b", "#202124", "#2f6fd8", "#2c9e3b", "#e0a020", "#8a4fd6", "#e07b39"];

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

export type Symbols = Record<string, LibSymbol>;

/** A part's pin names ("K", "TRIG", "D3"…), from its symbol. */
export const pinNamesOf = (symbols: Symbols, libId: string): Record<string, string> =>
  Object.fromEntries((symbols[libId]?.pins ?? []).filter((p) => !p.hidden).map((p) => [p.number, p.name]));

export function partPins(part: BuildPart, look: Look, symbols: Symbols): PlacedPin[] {
  const pinNames = pinNamesOf(symbols, part.lib_id);
  if (look === "schematic") {
    const lib = symbols[part.lib_id];
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

export function buildNetlist(build: Build, symbols: Symbols, purposes: Record<string, string> = {}): Netlist {
  const net = nets(build);
  const parts = build.parts.map((p) => {
    const pinNames = pinNamesOf(symbols, p.lib_id);
    const pins: Record<string, string> = {};
    for (const num of Object.keys(pinNames)) {
      const name = net.get(`${p.id}.${num}`);
      if (name) pins[num] = name;
    }
    return { ref: p.ref, kind: p.kind, value: p.value, purpose: purposes[p.ref] ?? "", pins, pinNames };
  });
  return { parts, nets: [...new Set(net.values())] };
}

export function buildLayout(build: Build, look: Look, symbols: Symbols): Layout {
  const net = nets(build);
  const where = new Map<string, Pt>();
  const parts = build.parts.map((p) => {
    const pins = partPins(p, look, symbols).map((pin) => {
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
    .map((w, i) => {
      const a = where.get(`${w.a.id}.${w.a.pin}`);
      const b = where.get(`${w.b.id}.${w.b.pin}`);
      return a && b ? { net: net.get(`${w.a.id}.${w.a.pin}`) ?? "", pts: [a, b], kind: "jumper" as const, color: WIRE_COLORS[i % WIRE_COLORS.length] } : null;
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

/** A schematic drawn in the builder, as the drawing data the lab shows (2D view + simulation). */
export function sceneFromBuild(build: Build, symbols: Symbols, purposes: Record<string, string> = {}): Scene {
  const net = nets(build);
  const where = new Map<string, Pt>();
  const components: SceneComponent[] = build.parts.map((p) => {
    const pl = { x: p.x, y: p.y, rot: p.rot, mirror: false };
    const pins = partPins(p, "schematic", symbols);
    pins.forEach((pin) => where.set(`${p.id}.${pin.number}`, pin.at));
    const box = symbolBox(symbols[p.lib_id], pl);
    const pin_nets: Record<string, string> = {};
    for (const pin of pins) {
      const n = net.get(`${p.id}.${pin.number}`);
      if (n) pin_nets[pin.number] = n;
    }
    return {
      ref: p.ref,
      kind: p.kind,
      value: p.value,
      purpose: purposes[p.ref] ?? "",
      lib_id: p.lib_id,
      x: p.x,
      y: p.y,
      rot: p.rot,
      mirror: false,
      pin_nets,
      ref_text: { text: p.ref, x: box[2] + 1, y: (box[1] + box[3]) / 2 - 1, angle: 0, justify: "left" },
      value_text: { text: p.value, x: box[2] + 1, y: (box[1] + box[3]) / 2 + 1.2, angle: 0, justify: "left" },
    };
  });
  for (const port of build.ports) where.set(`${port.id}.1`, [port.x, port.y]);
  const wires: Scene["wires"] = [];
  for (const w of build.wires) {
    const a = where.get(`${w.a.id}.${w.a.pin}`);
    const b = where.get(`${w.b.id}.${w.b.pin}`);
    const n = net.get(`${w.a.id}.${w.a.pin}`);
    if (!a || !b || !n) continue;
    const corner: Pt = [b[0], a[1]]; // drawn as in the builder: across, then down
    if (Math.abs(a[0] - b[0]) > 1e-6) wires.push({ net: n, a, b: corner });
    if (Math.abs(a[1] - b[1]) > 1e-6) wires.push({ net: n, a: corner, b });
  }
  const ports: ScenePort[] = build.ports.map((p) => ({
    lib_id: p.lib_id,
    net: p.net,
    x: p.x,
    y: p.y,
    rot: 0,
    text: { text: p.net, x: p.x, y: /GND/i.test(p.net) ? p.y + 5 : p.y - 3.6, angle: 0, justify: "" },
  }));
  const pts = [...where.values(), ...components.flatMap((c) => { const b = symbolBox(symbols[c.lib_id], c); return [[b[0], b[1]], [b[2] + 8, b[3]]] as Pt[]; })];
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const used = new Set([...components.map((c) => c.lib_id), ...ports.map((p) => p.lib_id)]);
  return {
    bbox: pts.length ? [Math.min(...xs) - 6, Math.min(...ys) - 8, Math.max(...xs) + 6, Math.max(...ys) + 8] : [0, 0, 100, 70],
    library: Object.fromEntries([...used].map((id) => [id, symbols[id]])),
    components,
    ports,
    wires,
    labels: [],
    junctions: [],
    no_connects: [],
  };
}
