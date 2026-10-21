/**
 * A small circuit simulator for the lab: real voltages and currents, so what the student sees
 * (electrons moving, an LED glowing, a capacitor charging) is the physics, not an animation.
 *
 * Modified nodal analysis with Newton–Raphson for diodes/LEDs/transistors and backward-Euler time
 * steps for capacitors. Every source is a Norton equivalent (voltage + small internal resistance),
 * so the matrix only has node voltages. Chips are behavioural: a 555 has its two comparators and
 * latch, a regulator holds its output, a microcontroller pin is a weak 5 V or 0 V source the
 * student can switch (or an input with a pull-up).
 */

import { isGroundNet, type Netlist, type NetPart } from "./scene";
import { LED_VF, ledColor, parseValue, railVolts } from "./values";

const VT = 0.025852; // thermal voltage at 27 °C
const GMIN = 1e-9; // keeps floating nodes defined

export interface InputSource {
  mode: "dc" | "square" | "sine";
  level: number; // V (peak for waves)
  freq: number; // Hz
}

export interface SimControls {
  pressed: Record<string, boolean>; // push buttons held down
  wiper: Record<string, number>; // potentiometer position 0..1
  overrides: Record<string, string>; // ref -> value text ("470", "9V", "LED_Blue", "100n")
  pinHigh: Record<string, Record<string, boolean>>; // chip ref -> pin number -> output HIGH
  inputs: Record<string, InputSource>; // connector ref -> what's fed into it
}

export const emptyControls = (): SimControls => ({ pressed: {}, wiper: {}, overrides: {}, pinHigh: {}, inputs: {} });

export type PinMode = "output" | "input" | "input_pullup";

export interface PartReading {
  v: number; // voltage across the part (its "main" two pins)
  i: number; // current through it (A, positive in the normal direction)
  p: number; // power turned into heat/light (W)
  /** 0..1 how "on" it is (LED brightness, buzzer loudness, transistor conduction). */
  level: number;
  state: string; // one short phrase: "glowing", "off", "saturated", "output HIGH", ...
  warn?: string;
}

export interface SimResult {
  t: number;
  ok: boolean;
  netV: Record<string, number>;
  pinI: Record<string, Record<string, number>>; // ref -> pin -> current INTO the part (A)
  parts: Record<string, PartReading>;
  pinModes: Record<string, Record<string, PinMode>>; // microcontroller pins
}

/* ---------- elements ---------- */

interface Ctx {
  G: Float64Array;
  rhs: Float64Array;
  n: number;
  v: Float64Array; // current Newton guess
  dt: number; // Infinity for a DC solve
  t: number;
  /** Set by a junction whose voltage step was limited: the solution isn't final yet. */
  limited: boolean;
}

interface Element {
  /** Node per terminal (-1 = ground) and which part pin it is (for reporting). */
  nodes: number[];
  owner?: { ref: string; pins: string[] };
  stamp(ctx: Ctx): void;
  /** Current INTO the element at each terminal, at node voltages v. */
  currents(v: Float64Array, ctx: Ctx): number[];
  /** Called once a time step has converged. */
  accept?(v: Float64Array, ctx: Ctx): void;
  reset?(): void;
}

const V = (v: Float64Array, node: number) => (node < 0 ? 0 : v[node]);

function stampG(ctx: Ctx, a: number, b: number, g: number) {
  const { G, n } = ctx;
  if (a >= 0) G[a * n + a] += g;
  if (b >= 0) G[b * n + b] += g;
  if (a >= 0 && b >= 0) {
    G[a * n + b] -= g;
    G[b * n + a] -= g;
  }
}

/** Current `i` flowing through the element from terminal a to terminal b (leaves node a, enters node b). */
function stampI(ctx: Ctx, a: number, b: number, i: number) {
  if (a >= 0) ctx.rhs[a] -= i;
  if (b >= 0) ctx.rhs[b] += i;
}

/** A linearised multi-terminal element: I_x = Σ_y a[x][y]·v_y + c[x] (current INTO terminal x). */
function stampLinear(ctx: Ctx, nodes: number[], a: number[][], c: number[]) {
  const { G, n } = ctx;
  nodes.forEach((x, i) => {
    if (x < 0) return;
    nodes.forEach((y, j) => {
      if (y >= 0) G[x * n + y] += a[i][j];
    });
    ctx.rhs[x] -= c[i];
  });
}

const resistor = (a: number, b: number, ohms: () => number): Element => ({
  nodes: [a, b],
  stamp: (ctx) => stampG(ctx, a, b, 1 / Math.max(1e-3, ohms())),
  currents: (v) => {
    const i = (V(v, a) - V(v, b)) / Math.max(1e-3, ohms());
    return [i, -i];
  },
});

/** Norton source: `volts()` from b (−) to a (+) behind `ohms`. */
const source = (a: number, b: number, volts: (ctx: Ctx) => number, ohms: number): Element => ({
  nodes: [a, b],
  stamp: (ctx) => {
    const g = 1 / ohms;
    stampG(ctx, a, b, g);
    stampI(ctx, b, a, volts(ctx) * g);
  },
  currents: (v, ctx) => {
    const i = (V(v, a) - V(v, b) - volts(ctx)) / ohms;
    return [i, -i];
  },
});

function capacitor(a: number, b: number, farads: () => number): Element {
  let vPrev = 0;
  let iLast = 0;
  const g = (ctx: Ctx) => (isFinite(ctx.dt) ? farads() / ctx.dt : 0);
  return {
    nodes: [a, b],
    stamp: (ctx) => {
      const gc = g(ctx);
      stampG(ctx, a, b, gc + 1e-12);
      stampI(ctx, b, a, gc * vPrev);
    },
    currents: () => [iLast, -iLast],
    accept: (v, ctx) => {
      if (!isFinite(ctx.dt)) return;
      const now = V(v, a) - V(v, b);
      iLast = g(ctx) * (now - vPrev);
      vPrev = now;
    },
    reset: () => {
      vPrev = 0;
      iLast = 0;
    },
  };
}

/** SPICE's junction voltage limiting: keeps Newton from jumping up an exponential. */
function pnjlim(vNew: number, vOld: number, nvt: number, vcrit: number): number {
  if (vNew > vcrit && Math.abs(vNew - vOld) > 2 * nvt) {
    if (vOld > 0) {
      const arg = 1 + (vNew - vOld) / nvt;
      return arg > 0 ? vOld + nvt * Math.log(arg) : vcrit;
    }
    return nvt * Math.log(vNew / nvt);
  }
  return vNew;
}

function diode(anode: number, cathode: number, params: () => { is: number; n: number }): Element {
  let vd = 0;
  const calc = (vdn: number) => {
    const { is, n } = params();
    const nvt = n * VT;
    const e = Math.exp(Math.min(vdn / nvt, 80));
    return { i: is * (e - 1), g: (is / nvt) * e + 1e-12 };
  };
  return {
    nodes: [anode, cathode],
    stamp: (ctx) => {
      const { is, n } = params();
      const nvt = n * VT;
      const vcrit = nvt * Math.log(nvt / (Math.SQRT2 * is));
      const raw = V(ctx.v, anode) - V(ctx.v, cathode);
      vd = pnjlim(raw, vd, nvt, vcrit);
      if (Math.abs(vd - raw) > 1e-9) ctx.limited = true;
      const { i, g } = calc(vd);
      stampG(ctx, anode, cathode, g);
      stampI(ctx, anode, cathode, i - g * vd);
    },
    currents: (v) => {
      const { i } = calc(V(v, anode) - V(v, cathode));
      return [i, -i];
    },
    reset: () => {
      vd = 0;
    },
  };
}

/** NPN transistor, Ebers–Moll transport model. Terminals: collector, base, emitter. */
function npn(c: number, b: number, e: number): Element {
  const IS = 6.7e-15;
  const BF = 180;
  const BR = 2;
  const vcrit = VT * Math.log(VT / (Math.SQRT2 * IS));
  let vbe = 0;
  let vbc = 0;
  const model = (be: number, bc: number) => {
    const ef = Math.exp(Math.min(be / VT, 80));
    const er = Math.exp(Math.min(bc / VT, 80));
    const iF = IS * (ef - 1);
    const iR = IS * (er - 1);
    const gF = (IS / VT) * ef;
    const gR = (IS / VT) * er;
    const ic = iF - iR - iR / BR;
    const ib = iF / BF + iR / BR;
    return { ic, ib, gF, gR };
  };
  return {
    nodes: [c, b, e],
    stamp: (ctx) => {
      const rawBe = V(ctx.v, b) - V(ctx.v, e);
      const rawBc = V(ctx.v, b) - V(ctx.v, c);
      vbe = pnjlim(rawBe, vbe, VT, vcrit);
      vbc = pnjlim(rawBc, vbc, VT, vcrit);
      if (Math.abs(vbe - rawBe) > 1e-9 || Math.abs(vbc - rawBc) > 1e-9) ctx.limited = true;
      const { ic, ib, gF, gR } = model(vbe, vbc);
      // Linearised around the (limited) junction voltages: I ≈ I0 + dI/dVbe·(Vbe − vbe) + dI/dVbc·(Vbc − vbc),
      // with Vbe = vb − ve and Vbc = vb − vc. Columns: d/dvc, d/dvb, d/dve.
      const kc = gR * (1 + 1 / BR);
      const ac = [kc, gF - kc, -gF];
      const ab = [-gR / BR, gF / BF + gR / BR, -gF / BF];
      const ae = ac.map((x, i) => -(x + ab[i]));
      const cc = ic - gF * vbe + kc * vbc;
      const cb = ib - (gF / BF) * vbe - (gR / BR) * vbc;
      stampLinear(ctx, [c, b, e], [ac, ab, ae], [cc, cb, -(cc + cb)]);
      // gmin across the junctions
      stampG(ctx, b, e, 1e-12);
      stampG(ctx, b, c, 1e-12);
    },
    currents: (v) => {
      const { ic, ib } = model(V(v, b) - V(v, e), V(v, b) - V(v, c));
      return [ic, ib, -(ic + ib)];
    },
    reset: () => {
      vbe = 0;
      vbc = 0;
    },
  };
}

/* ---------- the circuit ---------- */

const DIGITAL = /^(D\d+|A\d+|SDA\/A4|SCL\/A5|D0\/RX|D1\/TX)$/;

/** Pin modes from the sketch: pinMode(LED_PIN, OUTPUT) with `const int LED_PIN = 3;`. */
export function firmwarePinModes(code: string | undefined): Record<string, PinMode> {
  const modes: Record<string, PinMode> = {};
  if (!code) return modes;
  const consts: Record<string, string> = {};
  for (const m of code.matchAll(/\b(?:const\s+)?(?:int|byte|uint8_t)\s+(\w+)\s*=\s*(A?\d+)\s*;/g)) consts[m[1]] = m[2];
  for (const m of code.matchAll(/pinMode\s*\(\s*(\w+)\s*,\s*(OUTPUT|INPUT_PULLUP|INPUT)\s*\)/g)) {
    const raw = consts[m[1]] ?? m[1];
    const name = /^A\d+$/.test(raw) ? raw : `D${raw}`;
    modes[name] = m[2] === "OUTPUT" ? "output" : m[2] === "INPUT_PULLUP" ? "input_pullup" : "input";
  }
  return modes;
}

export class Simulator {
  readonly netlist: Netlist;
  private controls: SimControls;
  private nodeOf = new Map<string, number>();
  private n = 0;
  private elements: Element[] = [];
  private v: Float64Array = new Float64Array(0);
  private latches = new Map<string, boolean>();
  readonly pinModes: Record<string, Record<string, PinMode>> = {};
  readonly ground: string | null;
  t = 0;
  ok = true;
  /** True when time matters (capacitors, oscillators, waveforms); otherwise one DC solve is enough. */
  dynamic = false;
  private dirty = true;
  private last: SimResult | null = null;

  constructor(netlist: Netlist, controls: SimControls = emptyControls(), firmware?: string) {
    this.netlist = netlist;
    this.controls = controls;
    const nets = netlist.nets;
    const battery = netlist.parts.find((p) => p.kind === "battery");
    this.ground = nets.find(isGroundNet) ?? (battery ? battery.pins["2"] : null) ?? nets[0] ?? null;
    for (const net of nets) if (net !== this.ground && !this.nodeOf.has(net)) this.nodeOf.set(net, this.nodeOf.size);
    this.n = this.nodeOf.size;
    this.build(firmwarePinModes(firmware));
    this.v = new Float64Array(this.n);
  }

  node(net: string | undefined): number {
    if (!net || net === this.ground) return -1;
    return this.nodeOf.get(net) ?? -1;
  }

  setControls(controls: SimControls) {
    this.controls = controls;
    this.dirty = true;
  }

  reset() {
    this.t = 0;
    this.v = new Float64Array(this.n);
    this.latches.clear();
    for (const e of this.elements) e.reset?.();
    this.dirty = true;
  }

  private value(p: NetPart): number | null {
    return parseValue(this.controls.overrides[p.ref] ?? p.value);
  }

  private build(firmware: Record<string, PinMode>) {
    const { parts } = this.netlist;
    const driven = new Set<string>(); // nets something supplies

    for (const p of parts) {
      const pin = (num: string) => this.node(p.pins[num]);
      const own = (e: Element, pins: string[]) => {
        e.owner = { ref: p.ref, pins };
        this.elements.push(e);
      };
      const valueOr = (fallback: number) => () => this.value(p) ?? fallback;

      switch (p.kind) {
        case "resistor":
          own(resistor(pin("1"), pin("2"), valueOr(1000)), ["1", "2"]);
          break;
        case "potentiometer": {
          const total = valueOr(10_000);
          const pos = () => Math.min(1, Math.max(0, this.controls.wiper[p.ref] ?? 0.5));
          own(resistor(pin("1"), pin("2"), () => Math.max(1, total() * pos())), ["1", "2"]);
          own(resistor(pin("2"), pin("3"), () => Math.max(1, total() * (1 - pos()))), ["2", "3"]);
          break;
        }
        case "capacitor":
        case "capacitor_polarized":
          own(capacitor(pin("1"), pin("2"), valueOr(100e-9)), ["1", "2"]);
          this.dynamic = true;
          break;
        case "led":
          own(
            diode(pin("2"), pin("1"), () => {
              const vf = LED_VF[ledColor(this.controls.overrides[p.ref] ?? p.value)];
              return { is: 0.02 / (Math.exp(vf / (2 * VT)) - 1), n: 2 };
            }),
            ["2", "1"],
          );
          break;
        case "diode":
          own(diode(pin("2"), pin("1"), () => ({ is: 2.5e-9, n: 1.75 })), ["2", "1"]);
          break;
        case "npn_transistor":
          own(npn(pin("3"), pin("2"), pin("1")), ["3", "2", "1"]);
          break;
        case "push_button":
          own(resistor(pin("1"), pin("2"), () => (this.controls.pressed[p.ref] ? 0.05 : 1e9)), ["1", "2"]);
          break;
        case "buzzer":
          own(resistor(pin("1"), pin("2"), () => 170), ["1", "2"]);
          break;
        case "battery":
          own(
            source(pin("1"), pin("2"), () => this.value(p) ?? 9, 0.2),
            ["1", "2"],
          );
          if (p.pins["1"]) driven.add(p.pins["1"]);
          break;
        case "regulator_7805":
        case "regulator_ams1117_3v3":
          this.regulator(p, driven);
          break;
        case "timer_555":
          this.timer555(p);
          this.dynamic = true;
          break;
        case "arduino_uno":
        case "arduino_nano":
          this.microcontroller(p, driven, firmware);
          break;
        case "shift_register_74hc595":
          this.logicChip(p, ["16"], ["8"], ["15", "1", "2", "3", "4", "5", "6", "7", "9"]);
          break;
        default:
          break;
      }
    }

    // Connectors last: a connector only feeds a rail that nothing on the board drives already.
    for (const p of parts) if (p.kind.startsWith("connector")) this.connector(p, driven);

    // Supply rails nothing drives (e.g. "+5V" from a lab bench): an ideal-ish source to ground.
    for (const net of this.netlist.nets) {
      const volts = railVolts(net);
      if (volts !== null && !isGroundNet(net) && !driven.has(net) && this.node(net) >= 0) {
        const e = source(this.node(net), -1, () => volts, 0.05);
        this.elements.push(e);
      }
    }
    for (let i = 0; i < this.n; i++) this.elements.push({ nodes: [i, -1], stamp: (ctx) => stampG(ctx, i, -1, GMIN), currents: () => [0, 0] });
  }

  private regulator(p: NetPart, driven: Set<string>) {
    const [inPin, gndPin, outPin, vreg, dropout] = p.kind === "regulator_7805" ? ["1", "2", "3", 5, 2.0] : ["3", "1", "2", 3.3, 1.1];
    const nodes = [this.node(p.pins[outPin]), this.node(p.pins[inPin]), this.node(p.pins[gndPin])];
    const g = 1 / 0.05; // output resistance
    // Output = vreg, or (input − dropout) when the input is too low. Whatever the output delivers comes
    // in through the input, plus ~5 mA the regulator uses itself.
    const linear = (v: Float64Array) => {
      const [, vi, vg] = nodes.map((nd) => V(v, nd));
      const headroom = vi - vg - dropout;
      const q = 0.005 * Math.min(1, Math.max(0, vi - vg));
      if (headroom >= vreg) return { a: [[g, 0, -g], [-g, 0, g], [0, 0, 0]], c: [-g * vreg, g * vreg + q, -q] };
      if (headroom > 0) return { a: [[g, -g, 0], [-g, g, 0], [0, 0, 0]], c: [g * dropout, -g * dropout + q, -q] };
      return { a: [[g, 0, -g], [-g, 0, g], [0, 0, 0]], c: [0, q, -q] };
    };
    this.elements.push({
      nodes,
      owner: { ref: p.ref, pins: [outPin, inPin, gndPin] },
      stamp: (ctx) => {
        const { a, c } = linear(ctx.v);
        stampLinear(ctx, nodes, a, c);
      },
      currents: (v) => {
        const { a, c } = linear(v);
        const vs = nodes.map((nd) => V(v, nd));
        return a.map((row, i) => row.reduce((acc, k, j) => acc + k * vs[j], c[i]));
      },
    });
    if (p.pins[outPin]) driven.add(p.pins[outPin]);
  }

  private timer555(p: NetPart) {
    const n = (num: string) => this.node(p.pins[num]);
    const [gnd, trig, out, rst, ctrl, thr, dis, vcc] = ["1", "2", "3", "4", "5", "6", "7", "8"].map(n);
    const high = () => this.latches.get(p.ref) ?? false;
    const add = (e: Element, pins: string[]) => {
      e.owner = { ref: p.ref, pins };
      this.elements.push(e);
    };
    add(resistor(vcc, gnd, () => 3000), ["8", "1"]); // the chip's own supply current
    if (p.pins["5"]) {
      add(resistor(vcc, ctrl, () => 5000), ["8", "5"]); // the internal 5k–5k–5k divider
      add(resistor(ctrl, gnd, () => 10000), ["5", "1"]);
    }
    add(
      source(out, gnd, (ctx) => (high() ? Math.max(0, V(ctx.v, vcc) - V(ctx.v, gnd) - 1.7) : 0.05), 10),
      ["3", "1"],
    );
    const discharge = resistor(dis, gnd, () => (high() ? 1e9 : 15));
    add(discharge, ["7", "1"]);
    // The comparators and latch look at the pins once each time step has settled.
    discharge.accept = (v) => {
      const supply = V(v, vcc) - V(v, gnd);
      const upper = p.pins["5"] ? V(v, ctrl) - V(v, gnd) : (2 / 3) * supply;
      const lower = upper / 2;
      let state = high();
      if (supply < 1) state = false;
      else {
        if (p.pins["2"] && V(v, trig) - V(v, gnd) < lower) state = true;
        else if (p.pins["6"] && V(v, thr) - V(v, gnd) > upper) state = false;
        if (p.pins["4"] && V(v, rst) - V(v, gnd) < 0.7) state = false;
      }
      if (state !== high()) {
        this.latches.set(p.ref, state);
        this.dirty = true;
      }
    };
    if (!this.latches.has(p.ref)) this.latches.set(p.ref, false);
  }

  private microcontroller(p: NetPart, driven: Set<string>, firmware: Record<string, PinMode>) {
    const gndPins = Object.keys(p.pinNames).filter((k) => p.pinNames[k] === "GND" && p.pins[k]);
    const gnd = gndPins.length ? this.node(p.pins[gndPins[0]]) : -1;
    const gndPin = gndPins[0] ?? "";
    const modes: Record<string, PinMode> = {};
    this.pinModes[p.ref] = modes;
    const kindsOn = (net: string) => this.netlist.parts.filter((q) => q !== p && Object.values(q.pins).includes(net)).map((q) => q.kind);
    for (const [num, name] of Object.entries(p.pinNames)) {
      const net = p.pins[num];
      if (!net) continue;
      const node = this.node(net);
      const add = (e: Element) => {
        e.owner = { ref: p.ref, pins: [num, gndPin] };
        this.elements.push(e);
      };
      if (name === "+5V" || name === "3V3") {
        add(source(node, gnd, () => (name === "+5V" ? 5 : 3.3), name === "+5V" ? 0.1 : 1));
        driven.add(net);
        continue;
      }
      if (!DIGITAL.test(name)) continue;
      const short = name.split("/")[0];
      const neighbours = kindsOn(net);
      const guess: PinMode = neighbours.some((k) => k === "push_button")
        ? neighbours.includes("resistor")
          ? "input"
          : "input_pullup"
        : neighbours.some((k) => k === "potentiometer")
          ? "input"
          : neighbours.some((k) => ["resistor", "led", "buzzer", "npn_transistor", "shift_register_74hc595"].includes(k))
            ? "output"
            : "input";
      const mode = firmware[short] ?? guess;
      modes[num] = mode;
      if (mode === "output") add(source(node, gnd, () => (this.controls.pinHigh[p.ref]?.[num] ? 5 : 0), 25));
      else if (mode === "input_pullup") add(source(node, gnd, () => 5, 35_000));
      else add(resistor(node, gnd, () => 1e8));
    }
  }

  private logicChip(p: NetPart, vccPins: string[], gndPins: string[], outputs: string[]) {
    const vcc = this.node(p.pins[vccPins[0]]);
    const gnd = this.node(p.pins[gndPins[0]]);
    const add = (e: Element, pins: string[]) => {
      e.owner = { ref: p.ref, pins };
      this.elements.push(e);
    };
    add(resistor(vcc, gnd, () => 100_000), [vccPins[0], gndPins[0]]);
    const modes: Record<string, PinMode> = {};
    this.pinModes[p.ref] = modes;
    for (const num of outputs) {
      if (!p.pins[num]) continue;
      modes[num] = "output";
      add(source(this.node(p.pins[num]), gnd, (ctx) => (this.controls.pinHigh[p.ref]?.[num] ? V(ctx.v, vcc) - V(ctx.v, gnd) : 0), 50), [num, gndPins[0]]);
    }
  }

  private connector(p: NetPart, driven: Set<string>) {
    const nets = Object.entries(p.pins);
    const ground = nets.find(([, net]) => isGroundNet(net));
    const ref = ground ? this.node(ground[1]) : -1;
    const isOutput = /out/i.test(p.value);
    const isInput = /in|control|ctrl|signal_in|gpio/i.test(p.value) && !isOutput;
    for (const [num, net] of nets) {
      if (ground && num === ground[0]) continue;
      const rail = railVolts(net);
      if (rail !== null) {
        if (isOutput || driven.has(net)) continue;
        const e = source(this.node(net), ref, () => rail, 0.05);
        e.owner = { ref: p.ref, pins: [num, ground?.[0] ?? ""] };
        this.elements.push(e);
        driven.add(net);
      } else if (isInput) {
        const e = source(this.node(net), ref, (ctx) => this.inputVolts(p.ref, ctx.t), 50);
        e.owner = { ref: p.ref, pins: [num, ground?.[0] ?? ""] };
        this.elements.push(e);
        this.dynamic = true;
      }
    }
  }

  inputVolts(ref: string, t: number): number {
    const s = this.controls.inputs[ref] ?? defaultInput(this.netlist.parts.find((q) => q.ref === ref));
    if (s.mode === "dc") return s.level;
    const phase = (t * s.freq) % 1;
    return s.mode === "square" ? (phase < 0.5 ? s.level : 0) : s.level * (0.5 + 0.5 * Math.sin(2 * Math.PI * phase));
  }

  /* ---------- solving ---------- */

  private solveAt(dt: number): boolean {
    const n = this.n;
    const ctx: Ctx = { G: new Float64Array(n * n), rhs: new Float64Array(n), n, v: this.v, dt, t: this.t, limited: false };
    for (let iter = 0; iter < 120; iter++) {
      ctx.G.fill(0);
      ctx.rhs.fill(0);
      ctx.limited = false;
      for (const e of this.elements) e.stamp(ctx);
      const x = solveLinear(ctx.G, ctx.rhs, n);
      if (!x) return false;
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.max(-5, Math.min(5, x[i] - ctx.v[i])); // never jump more than 5 V per iteration
        worst = Math.max(worst, Math.abs(d));
        ctx.v[i] += d;
      }
      if (!ctx.limited && worst < 1e-7 + 1e-6 * Math.max(...Array.from(ctx.v, Math.abs), 1) && iter > 0) {
        for (const e of this.elements) e.accept?.(ctx.v, ctx);
        return true;
      }
    }
    for (const e of this.elements) e.accept?.(ctx.v, ctx);
    return false;
  }

  /** Move the simulation forward by `seconds` of circuit time. */
  advance(seconds: number) {
    if (!this.dynamic) {
      if (this.dirty) {
        this.dirty = false;
        this.ok = this.solveAt(Infinity);
        this.last = null;
      }
      return;
    }
    const steps = Math.max(1, Math.min(60, Math.ceil(seconds / this.maxStep())));
    const dt = seconds / steps;
    let ok = true;
    for (let s = 0; s < steps; s++) {
      this.t += dt;
      ok = this.solveAt(dt) && ok;
    }
    this.ok = ok;
    this.dirty = false;
    this.last = null;
  }

  /** Largest time step that still follows the fastest thing happening. */
  private maxStep(): number {
    let step = 2e-3;
    for (const p of this.netlist.parts) {
      const s = this.controls.inputs[p.ref] ?? (p.kind.startsWith("connector") ? defaultInput(p) : null);
      if (s && s.mode !== "dc") step = Math.min(step, 1 / (s.freq * 80));
    }
    return step;
  }

  /** How fast to run so the interesting part is visible: 1 = real time. */
  suggestedSpeed(): number {
    let speed = 1;
    for (const p of this.netlist.parts) {
      const s = this.controls.inputs[p.ref] ?? (p.kind.startsWith("connector") ? defaultInput(p) : null);
      if (s && s.mode !== "dc" && /in|control|signal/i.test(p.value)) speed = Math.min(speed, 0.5 / s.freq);
    }
    return speed;
  }

  result(): SimResult {
    if (this.last) return this.last;
    const ctx: Ctx = { G: new Float64Array(0), rhs: new Float64Array(0), n: this.n, v: this.v, dt: Infinity, t: this.t, limited: false };
    const netV: Record<string, number> = {};
    for (const net of this.netlist.nets) netV[net] = V(this.v, this.node(net));
    const pinI: Record<string, Record<string, number>> = {};
    for (const p of this.netlist.parts) pinI[p.ref] = {};
    for (const e of this.elements) {
      if (!e.owner) continue;
      const cur = e.currents(this.v, ctx);
      const pins = e.owner.pins;
      cur.forEach((i, k) => {
        const pin = pins[k];
        if (!pin) return;
        pinI[e.owner!.ref][pin] = (pinI[e.owner!.ref][pin] ?? 0) + i;
      });
    }
    const res: SimResult = { t: this.t, ok: this.ok, netV, pinI, parts: {}, pinModes: this.pinModes };
    for (const p of this.netlist.parts) res.parts[p.ref] = this.read(p, res);
    this.last = res;
    return res;
  }

  private read(p: NetPart, r: SimResult): PartReading {
    const nv = (num: string) => (p.pins[num] ? r.netV[p.pins[num]] : 0);
    const into = (num: string) => r.pinI[p.ref][num] ?? 0;
    const two = (a: string, b: string) => {
      const v = nv(a) - nv(b);
      const i = into(a);
      return { v, i, p: Math.abs(v * i) };
    };
    switch (p.kind) {
      case "resistor":
      case "buzzer": {
        const x = two("1", "2");
        const level = p.kind === "buzzer" ? Math.min(1, Math.abs(x.i) / 0.025) : 0;
        const warn = p.kind === "resistor" && x.p > 0.25 ? `${(x.p * 1000).toFixed(0)} mW is more than a ¼ W resistor can take` : undefined;
        return { ...x, i: Math.abs(x.i), v: Math.abs(x.v), level, state: p.kind === "buzzer" ? (level > 0.2 ? "beeping" : "quiet") : x.p > 1e-6 ? "warming slightly" : "no current", warn };
      }
      case "potentiometer": {
        const pos = this.controls.wiper[p.ref] ?? 0.5;
        return { v: nv("2"), i: Math.abs(into("2")), p: 0, level: pos, state: `knob at ${Math.round(pos * 100)}%` };
      }
      case "capacitor":
      case "capacitor_polarized": {
        const x = two("1", "2");
        const c = this.value(p) ?? 1e-7;
        const warn = p.kind === "capacitor_polarized" && x.v < -0.3 ? "connected backwards: electrolytic capacitors can burst" : undefined;
        return { v: x.v, i: x.i, p: 0, level: Math.min(1, Math.abs(c * x.v) / (c * 10)), state: Math.abs(x.i) > 1e-6 ? (x.i > 0 ? "charging" : "discharging") : Math.abs(x.v) > 0.05 ? "holding its charge" : "empty", warn };
      }
      case "led":
      case "diode": {
        const x = two("2", "1");
        const level = p.kind === "led" ? Math.min(1.5, Math.max(0, x.i) / 0.02) : 0;
        const warn = p.kind === "led" && x.i > 0.03 ? "too much current: the LED will burn out" : undefined;
        const state = x.i > 0.0005 ? (p.kind === "led" ? "glowing" : "conducting") : x.v < -0.1 ? "blocking (reverse)" : "off";
        return { v: x.v, i: Math.max(0, x.i), p: Math.abs(x.v * x.i), level, state, warn };
      }
      case "npn_transistor": {
        const ib = into("2");
        const ic = into("3");
        const vce = nv("3") - nv("1");
        const state = ib < 1e-7 ? "off" : vce < 0.25 ? "on (saturated)" : "partly on";
        return { v: vce, i: Math.max(0, ic), p: Math.abs(vce * ic), level: Math.min(1, Math.max(0, ic) / 0.02), state };
      }
      case "push_button": {
        const pressed = !!this.controls.pressed[p.ref];
        const x = two("1", "2");
        return { v: Math.abs(x.v), i: Math.abs(x.i), p: 0, level: pressed ? 1 : 0, state: pressed ? "pressed: closed" : "released: open" };
      }
      case "battery": {
        const x = two("1", "2");
        return { v: x.v, i: Math.max(0, -x.i), p: Math.abs(x.v * x.i), level: Math.min(1, Math.max(0, -x.i) / 0.02), state: -x.i > 1e-6 ? "supplying current" : "idle" };
      }
      case "timer_555": {
        const high = this.latches.get(p.ref) ?? false;
        return { v: nv("8") - nv("1"), i: Math.abs(into("8")), p: 0, level: high ? 1 : 0, state: high ? "output HIGH" : "output LOW" };
      }
      default: {
        const total = Object.values(r.pinI[p.ref]).reduce((a, b) => a + Math.max(0, b), 0);
        return { v: 0, i: total, p: 0, level: 0, state: "" };
      }
    }
  }
}

export function defaultInput(p: NetPart | undefined): InputSource {
  if (!p) return { mode: "dc", level: 0, freq: 1 };
  if (/signal_in|signal|in\b/i.test(p.value) && !/control/i.test(p.value)) return { mode: "square", level: 5, freq: 1000 };
  return { mode: "dc", level: 3.3, freq: 1 };
}

/** Dense Gaussian elimination with partial pivoting; returns null for a singular matrix. */
function solveLinear(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = new Float64Array(A);
  const x = new Float64Array(b);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(M[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r * n + col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-18) return null;
    if (piv !== col) {
      for (let k = 0; k < n; k++) {
        const t = M[col * n + k];
        M[col * n + k] = M[piv * n + k];
        M[piv * n + k] = t;
      }
      const t = x[col];
      x[col] = x[piv];
      x[piv] = t;
    }
    const d = M[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r * n + col] / d;
      if (f === 0) continue;
      for (let k = col; k < n; k++) M[r * n + k] -= f * M[col * n + k];
      x[r] -= f * x[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k];
    x[r] = s / M[r * n + r];
  }
  return x;
}
