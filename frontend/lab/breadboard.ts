/**
 * Build a circuit on a solderless breadboard, the way a person would, for the 3D view.
 *
 * A breadboard joins holes in groups: each column's five holes a–e form one strip, f–j another, and
 * the long rails along the edges carry the supply (+) and ground (−). So:
 * - ground goes on the − rails; the main supply (the battery) on the + rails; a second supply (an
 *   LDO's 3.3 V, say) on the bottom + rail
 * - every other net gets a strip; a part's legs go into the strips (or straight into a rail) of the
 *   nets they belong to
 * - chips straddle the centre channel, pin 1 bottom-left, like a real DIP
 * - three-legged parts take three neighbouring strips; jumper wires join anything that isn't
 *   already on the same strip or rail
 * - the battery and an Arduino sit next to the board, wired in with jumpers
 *
 * The board's hidden metal strips are returned as wires of kind "strip", so the current can be shown
 * flowing through them.
 */

import { DESK, isGroundNet, type BreadboardSpec, type Layout, type LayoutPart, type LayoutWire, type Netlist, type NetPart, type Pt } from "./scene";
import { railVolts } from "./values";

const P = 2.54;
const ROW_Y = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((r) => r * P); // rows a–e, f–j
type RailKey = "t+" | "t-" | "b+" | "b-";
const RAIL_Y: Record<RailKey, number> = { "t-": -3.5 * P, "t+": -2.5 * P, "b+": 13.5 * P, "b-": 14.5 * P };
const OFF_BOARD = new Set(["battery", "arduino_uno", "arduino_nano"]);
const DIP = new Set(["timer_555", "shift_register_74hc595"]);
/** How many holes apart a two-legged part's legs go when it bridges two strips. */
/** Heights above the breadboard's surface where off-board wires plug in (the parts stand on the desk). */
export const BATTERY_TERMINAL_H = DESK + 11.3;
export const HEADER_TOP_H = DESK + 11.7; // an Arduino's female header sockets
/** Distance between an Arduino's two header rows. */
const HEADER_ROWS: Record<string, number> = { arduino_nano: 6 * 2.54, arduino_uno: 48.3 };

const SPAN: Record<string, number> = { resistor: 4, diode: 4, push_button: 3, buzzer: 3, capacitor: 2, capacitor_polarized: 2, led: 1 };
const SIGNAL_COLORS = ["#2f6fd8", "#2c9e3b", "#e0a020", "#8a4fd6", "#e07b39", "#16a3a3", "#c2185b"];

type Half = "t" | "b";
const halfRows = (h: Half) => (h === "t" ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9]);
const holePos = (col: number, row: number): Pt => [col * P, ROW_Y[row]];
const railHolePos = (rail: RailKey, col: number): Pt => [col * P, RAIL_Y[rail]];
const railExists = (col: number) => col % 6 !== 5; // rails come in groups of five

interface Strip {
  key: string;
  half: Half;
  col: number;
  net?: string;
}

class Placer {
  used = new Set<string>();
  strips = new Map<string, Strip>();
  netStrips = new Map<string, Strip[]>();
  cursor: Record<Half, number> = { t: 2, b: 2 };
  rails: Partial<Record<RailKey, string>> = {};
  wires: LayoutWire[] = [];
  parts: LayoutPart[] = [];
  railUse = new Map<RailKey, Pt[]>();
  netColors = new Map<string, string>();
  standing = new Map<string, number>(); // parts already standing between a strip and a rail

  constructor(readonly netlist: Netlist) {}

  /* ---------- nets and rails ---------- */

  setupRails() {
    const nets = this.netlist.nets;
    const battery = this.netlist.parts.find((p) => p.kind === "battery");
    const ground = nets.find(isGroundNet) ?? battery?.pins["2"];
    const supplies = nets
      .filter((n) => n !== ground && railVolts(n) !== null && /^\+|^V/i.test(n))
      .sort((a, b) => (railVolts(b) ?? 0) - (railVolts(a) ?? 0));
    const main = battery?.pins["1"] ?? supplies[0];
    const second = supplies.find((n) => n !== main);
    if (ground) {
      this.rails["t-"] = ground;
      this.rails["b-"] = ground;
    }
    if (main) this.rails["t+"] = main;
    this.rails["b+"] = second ?? main;
  }

  railFor(net: string | undefined, half: Half): RailKey | null {
    if (!net) return null;
    const near: RailKey[] = half === "t" ? ["t+", "t-", "b+", "b-"] : ["b+", "b-", "t+", "t-"];
    return near.find((r) => this.rails[r] === net) ?? null;
  }

  color(net: string): string {
    if (this.rails["t-"] === net) return "#202124";
    if (this.rails["t+"] === net || this.rails["b+"] === net) return "#d93b2b";
    if (!this.netColors.has(net)) this.netColors.set(net, SIGNAL_COLORS[this.netColors.size % SIGNAL_COLORS.length]);
    return this.netColors.get(net)!;
  }

  /* ---------- holes ---------- */

  railHole(rail: RailKey, nearCol: number): Pt {
    for (let d = 0; d < 80; d++) {
      for (const col of [nearCol + d, nearCol - d]) {
        if (col < 0 || !railExists(col) || this.used.has(`${rail}:${col}`)) continue;
        this.used.add(`${rail}:${col}`);
        const at = railHolePos(rail, col);
        (this.railUse.get(rail) ?? this.railUse.set(rail, []).get(rail)!).push(at);
        return at;
      }
    }
    return railHolePos(rail, nearCol);
  }

  newStrip(half: Half, net: string | undefined, col?: number): Strip {
    const c = col ?? this.cursor[half]++;
    if (col !== undefined) this.cursor[half] = Math.max(this.cursor[half], col + 1);
    const strip: Strip = { key: `${half}${c}`, half, col: c, net };
    this.strips.set(strip.key, strip);
    if (net) (this.netStrips.get(net) ?? this.netStrips.set(net, []).get(net)!).push(strip);
    return strip;
  }

  freeRows(strip: Strip): number[] {
    return halfRows(strip.half).filter((r) => !this.used.has(`${strip.col}:${r}`));
  }

  /** A free hole in a strip, nearest the rails (outer) or the channel (inner). */
  take(strip: Strip, prefer: "outer" | "inner" | "middle" = "middle"): Pt {
    const free = this.freeRows(strip);
    const order = prefer === "middle" ? [...free].sort((a, b) => Math.abs(a - 2 - (strip.half === "b" ? 5 : 0)) - Math.abs(b - 2 - (strip.half === "b" ? 5 : 0))) : free;
    const outer = strip.half === "t" ? order[0] : order[order.length - 1];
    const inner = strip.half === "t" ? order[order.length - 1] : order[0];
    const row = prefer === "outer" ? outer : prefer === "inner" ? inner : order[0];
    this.used.add(`${strip.col}:${row}`);
    return holePos(strip.col, row);
  }

  jumper(a: Pt, b: Pt, net: string, elevA = 0) {
    this.wires.push({ net, pts: [a, b], kind: "jumper", color: this.color(net), ...(elevA ? { elev: [elevA, 0] } : {}) });
  }

  /** Where a leg on `net` goes: an existing strip of that net close by, or a new one (jumpered to the
   *  net). With `near`, the new strip is `span` holes from that column, like a real part's legs. */
  stripFor(net: string | undefined, half: Half, near?: number, span = 1): Strip {
    if (net) {
      const close = (this.netStrips.get(net) ?? []).find((s) => s.half === half && this.freeRows(s).length > 1 && (near === undefined || (Math.abs(s.col - near) <= 6 && s.col !== near)));
      if (close) return close;
    }
    const strip = this.newStrip(half, net, near === undefined ? undefined : Math.max(this.cursor[half], near + span));
    this.connect(strip, net);
    return strip;
  }

  /** Join a fresh strip to the rest of its net: its rail, or the nearest other strip of the net. */
  connect(strip: Strip, net: string | undefined) {
    if (!net) return;
    const rail = this.railFor(net, strip.half);
    if (rail) {
      this.jumper(this.take(strip, "outer"), this.railHole(rail, strip.col), net);
      return;
    }
    const others = (this.netStrips.get(net) ?? []).filter((s) => s !== strip && this.freeRows(s).length);
    if (!others.length) return;
    const other = others.reduce((a, b) => (Math.abs(a.col - strip.col) + (a.half === strip.half ? 0 : 3) <= Math.abs(b.col - strip.col) + (b.half === strip.half ? 0 : 3) ? a : b));
    this.jumper(this.take(strip, "outer"), this.take(other, "outer"), net);
  }

  /* ---------- parts ---------- */

  halfFor(p: NetPart): Half {
    const nets = Object.values(p.pins);
    if (nets.some((n) => this.rails["b+"] === n && this.rails["t+"] !== n)) return "b";
    for (const n of nets) {
      const s = this.netStrips.get(n)?.find((x) => this.freeRows(x).length > 1);
      if (s) return s.half;
    }
    return this.cursor.t <= this.cursor.b + 4 ? "t" : "b";
  }

  addPart(p: NetPart, pins: { number: string; at: Pt; inner?: Pt }[], center?: Pt, elev?: number) {
    const xs = pins.map((q) => q.at[0]);
    const ys = pins.map((q) => q.at[1]);
    const c: Pt = center ?? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    this.parts.push({
      ref: p.ref,
      kind: p.kind,
      value: p.value,
      purpose: p.purpose,
      center: c,
      bbox: [Math.min(...xs, c[0]) - 3, Math.min(...ys, c[1]) - 3, Math.max(...xs, c[0]) + 3, Math.max(...ys, c[1]) + 3],
      rot: 0,
      pins: pins.map((q) => ({ number: q.number, name: p.pinNames[q.number] ?? q.number, at: q.at, inner: q.inner ?? q.at, net: p.pins[q.number] })),
      ...(elev !== undefined ? { elev } : {}),
    });
  }

  placeTwo(p: NetPart, a: string, b: string) {
    const half = this.halfFor(p);
    const na = p.pins[a];
    const nb = p.pins[b];
    const ra = this.railFor(na, half);
    const rb = this.railFor(nb, half);
    const sameSide = (r: RailKey | null) => r && r[0] === half;
    let at: Record<string, Pt>;
    if (ra && rb && sameSide(ra) && sameSide(rb)) {
      // Across the two rails (a supply decoupling capacitor, say).
      const col = this.cursor[half]++;
      at = { [a]: this.railHole(ra, col), [b]: this.railHole(rb, col) };
    } else if ((ra && sameSide(ra)) !== (rb && sameSide(rb))) {
      // Standing between a rail and a strip.
      const [railPin, railKey, stripPin, stripNet] = ra && sameSide(ra) ? [a, ra, b, nb] : [b, rb!, a, na];
      const strip = this.stripFor(stripNet, half);
      const hole = this.take(strip, "outer");
      // A second part standing on the same strip leans over a couple of holes, like a person would place it.
      const lean = this.standing.get(strip.key) ?? 0;
      this.standing.set(strip.key, lean + 1);
      at = { [stripPin]: hole, [railPin]: this.railHole(railKey, strip.col + lean * 2) };
    } else {
      // Bridging two strips, a few columns apart.
      const sa = this.stripFor(na, half);
      const la = this.take(sa, "middle");
      const sb = this.stripFor(nb, half, sa.col, SPAN[p.kind] ?? 2);
      const lb = this.take(sb, "middle");
      at = { [a]: la, [b]: lb };
    }
    this.addPart(p, [a, b].map((n) => ({ number: n, at: at[n] })));
  }

  /** Legs in neighbouring strips (transistor, knob, regulator, header). */
  placeRow(p: NetPart, order: string[]) {
    const half = this.halfFor(p);
    const col0 = this.cursor[half];
    const pins = order.map((num, i) => {
      const strip = this.newStrip(half, p.pins[num], col0 + i);
      const at = this.take(strip, "inner");
      this.connect(strip, p.pins[num]);
      return { number: num, at };
    });
    this.cursor[half] = col0 + order.length + 1;
    this.addPart(p, pins);
  }

  /** A DIP chip across the centre channel: pins 1..n/2 along the bottom, the rest back along the top. */
  placeDip(p: NetPart) {
    const nums = Object.keys(p.pinNames).map(Number).sort((x, y) => x - y);
    const half = nums.length / 2;
    const col0 = Math.max(this.cursor.t, this.cursor.b) + 1;
    const pins = nums.map((n) => {
      const bottom = n <= half;
      const col = bottom ? col0 + n - 1 : col0 + (nums.length - n);
      const row = bottom ? 5 : 4;
      this.used.add(`${col}:${row}`);
      const strip = this.newStrip(bottom ? "b" : "t", p.pins[String(n)], col);
      this.connect(strip, p.pins[String(n)]);
      const at = holePos(col, row);
      return { number: String(n), at, inner: [at[0], at[1] + (bottom ? -2 : 2)] as Pt };
    });
    this.cursor.t = this.cursor.b = col0 + half + 1;
    this.addPart(p, pins, [(col0 + (half - 1) / 2) * P, (ROW_Y[4] + ROW_Y[5]) / 2]);
  }

  /** The battery, on the desk beside the board: leads from its terminals to the rails. */
  placeBattery(p: NetPart) {
    const plus: Pt = [-15, RAIL_Y["t+"] + 6];
    const minus: Pt = [-11, RAIL_Y["t+"] + 6];
    this.addPart(p, [
      { number: "1", at: plus },
      { number: "2", at: minus },
    ], [-13, RAIL_Y["t+"] + 6], DESK);
    for (const [num, at] of [["1", plus], ["2", minus]] as const) {
      const net = p.pins[num];
      if (!net) continue;
      const rail = this.railFor(net, "t");
      const to = rail ? this.railHole(rail, 0) : this.take(this.stripFor(net, "t"), "outer");
      this.jumper(at, to, net, BATTERY_TERMINAL_H);
    }
  }

  /** An Arduino on the desk in front of the board: two rows of header sockets, jumpers to what they drive. */
  placeBoard(p: NetPart, y0: number) {
    const nums = Object.keys(p.pinNames).sort((a, b) => Number(a) - Number(b));
    const perRow = Math.ceil(nums.length / 2);
    const gap = HEADER_ROWS[p.kind] ?? 15;
    const x0 = 6;
    const pins = nums.map((num, i) => {
      const row = i < perRow ? 0 : 1;
      const k = row === 0 ? i : i - perRow;
      const at: Pt = [x0 + k * P, y0 + row * gap];
      return { number: num, at };
    });
    this.addPart(p, pins, [x0 + ((perRow - 1) * P) / 2, y0 + gap / 2], DESK);
    pins.forEach(({ number, at }) => {
      const net = p.pins[number];
      if (!net) return;
      const rail = this.railFor(net, "b");
      const to = rail ? this.railHole(rail, Math.round(at[0] / P)) : this.take(this.stripFor(net, "b"), "outer");
      this.jumper(at, to, net, HEADER_TOP_H);
    });
  }

  run(): Layout {
    this.setupRails();
    // Place in signal order: start at the supply and follow the nets outwards (ground last: it's everywhere).
    const order: NetPart[] = [];
    const seen = new Set<string>();
    const visited = new Set<string>();
    const queue = this.rails["t+"] ? [this.rails["t+"]] : [];
    for (;;) {
      const net = queue.shift() ?? this.netlist.nets.find((n) => !visited.has(n));
      if (!net) break;
      if (visited.has(net)) continue;
      visited.add(net);
      for (const p of this.netlist.parts) {
        if (seen.has(p.ref) || !Object.values(p.pins).includes(net)) continue;
        seen.add(p.ref);
        order.push(p);
        for (const n of Object.values(p.pins)) if (!visited.has(n) && this.rails["t-"] !== n) queue.push(n);
      }
    }
    for (const p of this.netlist.parts) if (!seen.has(p.ref)) order.push(p);

    const roomy = order.length <= 15; // leave a free column between parts, if they fit on a normal board
    for (const p of order) {
      if (OFF_BOARD.has(p.kind)) continue;
      if (roomy) {
        this.cursor.t++;
        this.cursor.b++;
      }
      if (DIP.has(p.kind)) this.placeDip(p);
      else if (p.kind === "npn_transistor") this.placeRow(p, ["1", "2", "3"]);
      else if (p.kind === "potentiometer") this.placeRow(p, ["1", "2", "3"]);
      else if (p.kind === "regulator_7805") this.placeRow(p, ["1", "2", "3"]);
      else if (p.kind === "regulator_ams1117_3v3") this.placeRow(p, ["1", "2", "3"]);
      else if (p.kind.startsWith("connector")) this.placeRow(p, Object.keys(p.pinNames).sort());
      else {
        const nums = Object.keys(p.pinNames).sort();
        if (nums.length === 2) this.placeTwo(p, nums[0], nums[1]);
        else this.placeRow(p, nums);
      }
    }
    // Sized like a real breadboard: mini (17 columns), half (30) or full (63); longer only if it must be.
    const needed = Math.max(this.cursor.t, this.cursor.b) + 2;
    const columns = needed <= 17 ? 17 : needed <= 30 ? 30 : Math.max(63, needed);
    for (const p of order) if (p.kind === "battery") this.placeBattery(p);
    let boardY = RAIL_Y["b-"] + 18;
    for (const p of order)
      if (p.kind.startsWith("arduino")) {
        this.placeBoard(p, boardY);
        boardY += (HEADER_ROWS[p.kind] ?? 15) + 24;
      }

    // Both ground rails are one net, and so are the + rails when they carry the same supply.
    if (this.railUse.has("b-") && this.rails["b-"]) this.jumper(this.railHole("t-", 0), this.railHole("b-", 0), this.rails["b-"]);
    if (this.railUse.has("b+") && this.rails["b+"] === this.rails["t+"] && this.rails["t+"]) this.jumper(this.railHole("t+", 1), this.railHole("b+", 1), this.rails["t+"]);

    // The board's own metal: each strip's used holes, and each rail's used holes, are joined.
    for (const s of this.strips.values()) {
      const holes = halfRows(s.half).filter((r) => this.used.has(`${s.col}:${r}`)).map((r) => holePos(s.col, r));
      if (holes.length > 1 && s.net) this.wires.push({ net: s.net, pts: holes, kind: "strip" });
    }
    for (const [rail, holes] of this.railUse) {
      const net = this.rails[rail];
      if (net && holes.length > 1) this.wires.push({ net, pts: [...holes].sort((a, b) => a[0] - b[0]), kind: "strip" });
    }

    const board: BreadboardSpec = {
      columns,
      origin: [0, 0],
      rails: (Object.keys(RAIL_Y) as RailKey[]).map((r) => ({ y: RAIL_Y[r], sign: r[1] as "+" | "-", net: this.rails[r] })),
    };
    const pts = [...this.parts.flatMap((p) => [...p.pins.map((q) => q.at), [p.bbox[0], p.bbox[1]] as Pt, [p.bbox[2], p.bbox[3]] as Pt]), [-P, RAIL_Y["t-"] - P] as Pt, [(columns + 1) * P, RAIL_Y["b-"] + P] as Pt];
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    return {
      parts: this.parts,
      wires: this.wires,
      ports: [],
      labels: [],
      junctions: [],
      bbox: [Math.min(...xs) - 6, Math.min(...ys) - 6, Math.max(...xs) + 6, Math.max(...ys) + 6],
      board,
    };
  }
}

export function breadboardLayout(netlist: Netlist): Layout {
  return new Placer(netlist).run();
}

/** A short description of where a pin went, for the inspector ("row c, column 12" / "+ rail"). */
export function holeName(at: Pt): string {
  const col = Math.round(at[0] / P) + 1;
  const rail = (Object.keys(RAIL_Y) as RailKey[]).find((r) => Math.abs(RAIL_Y[r] - at[1]) < 0.1);
  if (rail) return `${rail[0] === "t" ? "top" : "bottom"} ${rail[1]} rail`;
  const row = ROW_Y.findIndex((y) => Math.abs(y - at[1]) < 0.1);
  return row >= 0 ? `hole ${"abcdefghij"[row]}${col}` : "off the board";
}

