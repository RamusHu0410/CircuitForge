/**
 * The generated schematic as drawing data (mirrors backend/app/schemas/scene.py), plus the two
 * shapes the lab works with:
 *
 * - Layout: parts with absolute pin positions, wires, power ports. The 2D view, the 3D view and the
 *   electron flow all draw from it, and the practice builder produces one too.
 * - Netlist: which net every part pin is on. The simulator runs on it.
 */

export type Pt = [number, number];

export interface Graphic {
  type: "polyline" | "rect" | "circle" | "arc";
  pts: Pt[];
  r: number;
  fill: "none" | "outline" | "background";
  width: number;
}

export interface LibPin {
  number: string;
  name: string;
  type: string;
  x: number;
  y: number;
  angle: number;
  length: number;
  hidden: boolean;
}

export interface LibSymbol {
  lib_id: string;
  graphics: Graphic[];
  pins: LibPin[];
  show_pin_numbers: boolean;
  show_pin_names: boolean;
  pin_name_offset: number;
  power: boolean;
}

export interface SceneText {
  text: string;
  x: number;
  y: number;
  angle: number;
  justify: string;
}

export interface SceneComponent {
  ref: string;
  kind: string;
  value: string;
  purpose: string;
  lib_id: string;
  x: number;
  y: number;
  rot: number;
  mirror: boolean;
  pin_nets: Record<string, string>;
  ref_text: SceneText | null;
  value_text: SceneText | null;
}

export interface ScenePort {
  lib_id: string;
  net: string;
  x: number;
  y: number;
  rot: number;
  text: SceneText | null;
}

export interface Scene {
  bbox: [number, number, number, number];
  library: Record<string, LibSymbol>;
  components: SceneComponent[];
  ports: ScenePort[];
  wires: { net: string; a: Pt; b: Pt }[];
  labels: { net: string; x: number; y: number; angle: number }[];
  junctions: { net: string; x: number; y: number }[];
  no_connects: Pt[];
}

/* ---------- KiCad transforms (same as backend/app/core/geometry.py) ---------- */

export function rotate(px: number, py: number, rot: number): Pt {
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return [-py, px];
    case 180:
      return [-px, -py];
    case 270:
      return [py, -px];
    default:
      return [px, py];
  }
}

/** Library offset (+Y up) → screen offset (+Y down): mirror, then rotate counter-clockwise. */
export function toScreen(px: number, py: number, rot: number, mirror: boolean): Pt {
  const [rx, ry] = rotate(mirror ? -px : px, py, rot);
  return [rx, -ry];
}

export interface Placement {
  x: number;
  y: number;
  rot: number;
  mirror: boolean;
}

export function place(p: Placement, lx: number, ly: number): Pt {
  const [dx, dy] = toScreen(lx, ly, p.rot, p.mirror);
  return [p.x + dx, p.y + dy];
}

const ANGLE_VEC: Record<number, Pt> = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };

/** Where a pin's line ends, toward the symbol body (screen coordinates). */
export function pinInner(p: Placement, pin: LibPin): Pt {
  const [vx, vy] = ANGLE_VEC[((pin.angle % 360) + 360) % 360] ?? [1, 0];
  return place(p, pin.x + vx * pin.length, pin.y + vy * pin.length);
}

export const keyOf = (p: Pt) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;

/** Bounding box of a placed library symbol (graphics + pins), screen coordinates. */
export function symbolBox(lib: LibSymbol, p: Placement): [number, number, number, number] {
  const pts: Pt[] = [];
  for (const g of lib.graphics) {
    if (g.type === "circle") {
      const [cx, cy] = g.pts[0];
      pts.push(place(p, cx - g.r, cy - g.r), place(p, cx + g.r, cy + g.r));
    } else for (const [x, y] of g.pts) pts.push(place(p, x, y));
  }
  for (const pin of lib.pins) if (!pin.hidden) pts.push(place(p, pin.x, pin.y), pinInner(p, pin));
  if (!pts.length) return [p.x - 1, p.y - 1, p.x + 1, p.y + 1];
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/* ---------- Layout: what the views draw ---------- */

export interface LayoutPin {
  number: string;
  name: string;
  at: Pt; // connection point
  inner: Pt; // where the pin meets the body
  net?: string;
}

export interface LayoutPart {
  ref: string;
  kind: string;
  value: string;
  purpose: string;
  center: Pt;
  bbox: [number, number, number, number];
  rot: number;
  pins: LayoutPin[];
  /** Height of what it stands on, relative to the board's surface (a battery on the desk: −8.5 mm). */
  elev?: number;
}

export interface LayoutPort {
  net: string;
  at: Pt;
  ground: boolean;
  /** Unit vector from the connection point toward the symbol's body. */
  dir: Pt;
}

export interface LayoutWire {
  net: string;
  pts: Pt[];
  /** trace: drawn flat (the schematic's wires). jumper: a hook-up wire arcing between two points.
   *  strip: a breadboard's hidden metal clip joining holes (current flows under the board). */
  kind?: "trace" | "jumper" | "strip";
  color?: string;
  /** Height of each point (mm, default 0 = the board's surface): a jumper plugged into an Arduino's header. */
  elev?: number[];
}

/** The desk a breadboard stands on, relative to the breadboard's top (a breadboard is ~8.5 mm thick). */
export const DESK = -8.5;

/** A solderless breadboard the parts are plugged into (see lab/breadboard.ts). */
export interface BreadboardSpec {
  columns: number;
  origin: Pt; // centre of hole (column 0, row a)
  /** y of each row of holes: rails and terminal rows. */
  rails: { y: number; sign: "+" | "-"; net?: string }[];
}

export interface Layout {
  parts: LayoutPart[];
  wires: LayoutWire[];
  ports: LayoutPort[];
  labels: { net: string; at: Pt }[];
  junctions: { net: string; at: Pt }[];
  bbox: [number, number, number, number];
  board?: BreadboardSpec;
}

export const isGroundNet = (net: string) => /^(GND|VSS|0V|AGND|DGND)$/i.test(net);

export function layoutFromScene(scene: Scene): Layout {
  const parts: LayoutPart[] = scene.components.map((c) => {
    const lib = scene.library[c.lib_id];
    const pins = lib.pins
      .filter((pin) => !pin.hidden)
      .map((pin) => ({ number: pin.number, name: pin.name, at: place(c, pin.x, pin.y), inner: pinInner(c, pin), net: c.pin_nets[pin.number] }));
    const bbox = symbolBox(lib, c);
    return { ref: c.ref, kind: c.kind, value: c.value, purpose: c.purpose, center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2], bbox, rot: c.rot, pins };
  });
  const ports: LayoutPort[] = scene.ports.map((p) => {
    const lib = scene.library[p.lib_id];
    const box = symbolBox(lib, { ...p, mirror: false });
    const mid: Pt = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const d: Pt = [mid[0] - p.x, mid[1] - p.y];
    const n = Math.hypot(d[0], d[1]) || 1;
    return { net: p.net, at: [p.x, p.y], ground: isGroundNet(p.net), dir: [d[0] / n, d[1] / n] };
  });
  return {
    parts,
    wires: scene.wires.map((w) => ({ net: w.net, pts: [w.a, w.b] })),
    ports,
    labels: scene.labels.map((l) => ({ net: l.net, at: [l.x, l.y] })),
    junctions: scene.junctions.map((j) => ({ net: j.net, at: [j.x, j.y] })),
    bbox: scene.bbox,
  };
}

/* ---------- Netlist: what the simulator runs ---------- */

export interface NetPart {
  ref: string;
  kind: string;
  value: string;
  purpose: string;
  pins: Record<string, string>; // pin number -> net
  pinNames: Record<string, string>; // pin number -> name ("K", "OUT", "D3", ...)
}

export interface Netlist {
  parts: NetPart[];
  nets: string[];
}

export function netlistFromScene(scene: Scene): Netlist {
  const parts = scene.components.map((c) => ({
    ref: c.ref,
    kind: c.kind,
    value: c.value,
    purpose: c.purpose,
    pins: { ...c.pin_nets },
    pinNames: Object.fromEntries(scene.library[c.lib_id].pins.map((p) => [p.number, p.name])),
  }));
  const nets = [...new Set([...parts.flatMap((p) => Object.values(p.pins)), ...scene.ports.map((p) => p.net)])];
  return { parts, nets };
}

/** Pin name without KiCad's overbar markup: "~{RST}" -> "RST". */
export const cleanPinName = (name: string) => name.replace(/~\{([^}]*)\}/g, "$1");
