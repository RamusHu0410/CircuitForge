/**
 * Rate a circuit the way an experienced engineer would review it: is it safe, how much of the power
 * does useful work, what does it cost, would other parts or materials do better, and (for boards
 * with code) is the program sound. Everything is measured by running the circuit in the simulator:
 * once as it is, and once with every button held down.
 */

import { ArduinoProgram } from "./arduino";
import { cleanPinName, type Netlist } from "./scene";
import { emptyControls, Simulator, type PartReading, type SimResult } from "./sim";
import { LED_VF, ledColor, parseValue, si } from "./values";

export type Area = "safety" | "efficiency" | "cost" | "design" | "code";

export interface Finding {
  severity: "critical" | "warning" | "tip";
  area: Area;
  title: string;
  text: string;
  refs: string[];
}

export interface Rating {
  score: number;
  grade: string;
  areas: Partial<Record<Area, number>>;
  power: { usefulW: number; wastedW: number; percent: number | null; idleA: number; lines: { ref: string; w: number; useful: boolean }[] };
  cost: { total: number; lines: { ref: string; what: string; price: number }[] };
  findings: Finding[];
}

/** Typical single-unit prices (USD) from hobby suppliers. */
const PRICE: Record<string, number> = {
  resistor: 0.02,
  capacitor: 0.03,
  capacitor_polarized: 0.08,
  led: 0.05,
  diode: 0.04,
  potentiometer: 0.4,
  push_button: 0.1,
  buzzer: 0.5,
  battery: 2.0,
  npn_transistor: 0.05,
  timer_555: 0.3,
  regulator_7805: 0.4,
  regulator_ams1117_3v3: 0.15,
  shift_register_74hc595: 0.25,
  arduino_uno: 23,
  arduino_nano: 22,
  connector_2pin: 0.1,
  connector_3pin: 0.12,
};

const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const E24 = [1, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2, 2.2, 2.4, 2.7, 3, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

function nearestE12(x: number): number {
  const dec = 10 ** Math.floor(Math.log10(x));
  return [...E12.map((m) => m * dec), 10 * dec].reduce((a, b) => (Math.abs(Math.log(b / x)) < Math.abs(Math.log(a / x)) ? b : a));
}
const isStandard = (x: number) => E24.some((m) => Math.abs(x / 10 ** Math.floor(Math.log10(x)) - m) < 0.01);

const ohms = (x: number) => si(x, "Ω");

interface Run {
  max: Record<string, PartReading>;
  avg: Record<string, { p: number }>;
  last: SimResult;
  mcuNotes: string[];
  mcuError: string | null;
}

function simulate(netlist: Netlist, firmware: string | undefined, pressAll: boolean): Run {
  const controls = emptyControls();
  if (pressAll) for (const p of netlist.parts) if (p.kind === "push_button") controls.pressed[p.ref] = true;
  const sim = new Simulator(netlist, controls, firmware);
  const max: Record<string, PartReading> = {};
  const sum: Record<string, number> = {};
  let samples = 0;
  let last = sim.result();
  const steps = sim.dynamic ? 30 : 1;
  for (let k = 0; k < steps; k++) {
    sim.advance(sim.dynamic ? 0.05 : 0);
    last = sim.result();
    samples++;
    for (const [ref, r] of Object.entries(last.parts)) {
      const m = max[ref];
      max[ref] = m ? { ...r, i: Math.max(m.i, r.i), p: Math.max(m.p, r.p), v: Math.abs(r.v) > Math.abs(m.v) ? r.v : m.v, warn: r.warn ?? m.warn } : { ...r };
      sum[ref] = (sum[ref] ?? 0) + r.p;
    }
  }
  const avg = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, { p: v / samples }]));
  const mcu = Object.values(last.mcu)[0];
  return { max, avg, last, mcuNotes: mcu?.notes ?? [], mcuError: mcu?.error ?? null };
}

export function rateCircuit(netlist: Netlist, firmware?: string): Rating {
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], area: Area, title: string, text: string, refs: string[] = []) => findings.push({ severity, area, title, text, refs });
  const parts = netlist.parts;
  const of = (kind: string) => parts.filter((p) => p.kind === kind);
  const hasButtons = of("push_button").length > 0;
  const mcuPart = parts.find((p) => p.kind.startsWith("arduino"));

  if (!parts.length) {
    return { score: 0, grade: "–", areas: {}, power: { usefulW: 0, wastedW: 0, percent: null, idleA: 0, lines: [] }, cost: { total: 0, lines: [] }, findings: [{ severity: "critical", area: "design", title: "Nothing to rate yet", text: "Place some parts and wire them up.", refs: [] }] };
  }

  const runs = [simulate(netlist, firmware, false), ...(hasButtons ? [simulate(netlist, firmware, true)] : [])];
  const worst = (ref: string) => runs.map((r) => r.max[ref]).filter(Boolean).reduce((a, b) => (b.i > a.i ? b : a), runs[0].max[ref]);
  const idle = runs[0];

  /* ---------- wiring sanity ---------- */
  const supplies = parts.filter((p) => ["battery", "arduino_uno", "arduino_nano"].includes(p.kind) || (p.kind.startsWith("connector") && Object.values(p.pins).some((n) => /^\+|^V/i.test(n))));
  const rails = netlist.nets.filter((n) => /^\+\d|^VCC|^VIN|^\+V/i.test(n));
  if (!supplies.length && !rails.length) add("critical", "safety", "Nothing powers this circuit", "Add a battery (or a supply symbol like +5V and GND) so current has somewhere to come from.");
  for (const p of parts) {
    const pins = Object.keys(p.pinNames).filter((k) => !/^(NC|~\{?RESET\}?|AREF|IOREF|VIN|3V3)$/.test(cleanPinName(p.pinNames[k])));
    const connected = pins.filter((k) => p.pins[k]);
    if (p.kind.startsWith("arduino") || p.kind.startsWith("connector")) continue;
    if (!connected.length) add("warning", "design", `${p.ref} isn't connected`, `${p.ref} is placed but none of its legs go anywhere.`, [p.ref]);
    else if (pins.length <= 3 && connected.length < pins.length) {
      const loose = pins.filter((k) => !p.pins[k]).map((k) => cleanPinName(p.pinNames[k]) || `pin ${k}`);
      add("warning", "design", `${p.ref} has a loose leg`, `${p.ref}'s ${loose.join(" and ")} ${loose.length > 1 ? "aren't" : "isn't"} connected, so no current can flow through it.`, [p.ref]);
    } else if (pins.length === 2 && p.pins[pins[0]] === p.pins[pins[1]]) {
      add("warning", "design", `${p.ref} is shorted`, `Both of ${p.ref}'s legs are on the same wire, so it does nothing.`, [p.ref]);
    }
  }

  /* ---------- safety: every part within its limits ---------- */
  for (const p of parts) {
    const r = worst(p.ref);
    if (!r) continue;
    switch (p.kind) {
      case "led": {
        if (r.i > 0.03) add("critical", "safety", `${p.ref} will burn out`, `${p.ref} gets ${si(r.i, "A")}; indicator LEDs are rated about 20 mA. Add (or increase) its series resistor.`, [p.ref]);
        else if (r.i > 0.021) add("warning", "safety", `${p.ref} runs hot`, `${p.ref} gets ${si(r.i, "A")}, above the usual 20 mA rating. It will dim and fail early.`, [p.ref]);
        if (r.v < -5) add("warning", "safety", `${p.ref} is reverse-biased`, `${p.ref} sees ${si(-r.v, "V")} backwards; LEDs only survive about 5 V in reverse.`, [p.ref]);
        break;
      }
      case "resistor": {
        if (r.p > 0.25) add("critical", "safety", `${p.ref} overheats`, `${p.ref} dissipates ${si(r.p, "W")}, more than a ¼ W resistor can take. Use a bigger value, or a ${r.p > 0.5 ? "1 W" : "½ W"} resistor.`, [p.ref]);
        else if (r.p > 0.125) add("warning", "safety", `${p.ref} runs warm`, `${p.ref} dissipates ${si(r.p, "W")}: fine for ¼ W, too much for the small ⅛ W kind.`, [p.ref]);
        break;
      }
      case "npn_transistor": {
        if (r.i > 0.2) add("critical", "safety", `${p.ref} is overloaded`, `${p.ref} (2N3904) carries ${si(r.i, "A")}; it's rated 200 mA. For bigger loads use a logic-level MOSFET such as the AO3400.`, [p.ref]);
        if (r.p > 0.5) add("warning", "safety", `${p.ref} gets hot`, `${p.ref} dissipates ${si(r.p, "W")}: drive its base harder so it switches fully on.`, [p.ref]);
        break;
      }
      case "capacitor_polarized":
        if (r.warn) add("critical", "safety", `${p.ref} is backwards`, `${p.ref}'s + lead is at the lower voltage. Electrolytic capacitors can bulge or burst like that.`, [p.ref]);
        break;
      case "battery":
        if (r.i > 0.5) add("critical", "safety", "Possible short circuit", `${p.ref} is pushing ${si(r.i, "A")}: something connects + to − with almost no resistance. Batteries get hot and wires melt.`, [p.ref]);
        break;
      default:
        break;
    }
  }
  for (const reg of [...of("regulator_7805"), ...of("regulator_ams1117_3v3")]) {
    const [inPin, gndPin, outPin, vreg, drop] = reg.kind === "regulator_7805" ? ["1", "2", "3", 5, 2] : ["3", "1", "2", 3.3, 1.1];
    const v = (pin: string) => idle.last.netV[reg.pins[pin] ?? ""] ?? 0;
    const vin = v(inPin) - v(gndPin);
    const vout = v(outPin) - v(gndPin);
    const iOut = Math.max(0, -(idle.last.pinI[reg.ref]?.[outPin] ?? 0));
    if (vin < vreg + drop - 0.05) add("warning", "safety", `${reg.ref} can't regulate`, `${reg.ref} needs at least ${(vreg + drop).toFixed(1)} V in, but gets ${vin.toFixed(2)} V, so its output sags to ${vout.toFixed(2)} V.`, [reg.ref]);
    const heat = Math.max(0, vin - vout) * iOut;
    if (heat > 1) add(heat > 2 ? "critical" : "warning", "safety", `${reg.ref} needs a heatsink`, `${reg.ref} turns ${si(heat, "W")} into heat. Without a heatsink it will shut down to protect itself.`, [reg.ref]);
  }
  if (mcuPart) {
    for (const [num, net] of Object.entries(mcuPart.pins)) {
      const name = cleanPinName(mcuPart.pinNames[num] ?? "");
      if (!/^D\d|^A\d/.test(name)) continue;
      const i = Math.max(...runs.map((r) => Math.abs(r.last.pinI[mcuPart.ref]?.[num] ?? 0)));
      if (i > 0.04) add("critical", "safety", `${name} is overloaded`, `${mcuPart.ref}'s ${name} supplies ${si(i, "A")}; the ATmega328P's absolute limit is 40 mA per pin. Drive the load through a transistor.`, [mcuPart.ref]);
      else if (i > 0.021) add("warning", "safety", `${name} works hard`, `${mcuPart.ref}'s ${name} supplies ${si(i, "A")}, above the recommended 20 mA.`, [mcuPart.ref]);
      // An input with nothing pulling it to a defined level reads noise.
      const mode = idle.last.pinModes[mcuPart.ref]?.[num];
      const others = parts.filter((q) => q !== mcuPart && Object.values(q.pins).includes(net));
      if (mode === "input" && others.length && others.every((q) => q.kind === "push_button")) {
        add("warning", "design", `${name} floats`, `${name} is an INPUT with only a button on it: when the button is up, the pin isn't connected to anything and reads random HIGHs and LOWs. Use INPUT_PULLUP (and wire the button to GND), or add a 10 kΩ resistor.`, [mcuPart.ref, ...others.map((q) => q.ref)]);
      }
    }
  }

  /* ---------- efficiency ---------- */
  const lines: Rating["power"]["lines"] = [];
  for (const p of parts) {
    const w = Math.max(...runs.map((r) => r.avg[p.ref]?.p ?? 0));
    if (w < 1e-6 || ["battery", "arduino_uno", "arduino_nano", "connector_2pin", "connector_3pin"].includes(p.kind)) continue;
    const useful = p.kind === "led" || p.kind === "buzzer" || /load|motor|lamp|heater/i.test(p.purpose + p.value);
    lines.push({ ref: p.ref, w, useful });
  }
  const usefulW = lines.filter((l) => l.useful).reduce((s, l) => s + l.w, 0);
  const wastedW = lines.filter((l) => !l.useful).reduce((s, l) => s + l.w, 0);
  const percent = usefulW > 0 ? (100 * usefulW) / (usefulW + wastedW) : null;
  const idleA = of("battery").reduce((s, b) => s + (idle.max[b.ref]?.i ?? 0), 0);

  for (const led of of("led")) {
    const r = worst(led.ref);
    if (!r || r.i < 0.0005) continue;
    const series = parts.find((q) => q.kind === "resistor" && Object.values(q.pins).some((n) => Object.values(led.pins).includes(n)));
    const rr = series ? worst(series.ref) : undefined;
    if (series && rr && rr.p > r.p * 1.2) {
      add("tip", "efficiency", `${series.ref} wastes more than ${led.ref} uses`, `${series.ref} turns ${si(rr.p, "W")} into heat to feed ${led.ref} ${si(r.p, "W")}. A lower supply voltage (3.3–5 V for one LED), or several LEDs in series on the same resistor, wastes far less.`, [series.ref, led.ref]);
    }
    if (r.i > 0.012 && series) {
      const vf = LED_VF[ledColor(led.value)];
      const newR = nearestE12(Math.abs(rr?.v ?? 3) / 0.005); // about the same voltage drop at 5 mA
      add("tip", "efficiency", `${led.ref} is brighter than it needs to be`, `Modern LEDs are clearly visible at 3–5 mA. ${series.ref} at about ${ohms(newR)} (instead of ${series.value}) would run ${led.ref} near 5 mA and cut its power by about ${Math.round((1 - 0.005 / r.i) * 100)}% (forward voltage ≈ ${vf} V).`, [series.ref, led.ref]);
    }
  }
  // LEDs that each hang off the same supply rail through their own resistor (not ones a chip drives).
  const supplyNets = new Set([...of("battery").map((b) => b.pins["1"]), ...netlist.nets.filter((n) => /^\+\d|^VCC|^\+V/i.test(n))].filter(Boolean));
  const onRail = of("led").filter((led) => parts.some((q) => q.kind === "resistor" && Object.values(q.pins).some((n) => Object.values(led.pins).includes(n)) && Object.values(q.pins).some((n) => supplyNets.has(n))));
  if (onRail.length >= 2) {
    add("tip", "efficiency", "LEDs in parallel, one resistor each", "With a supply well above the LEDs' forward voltage, putting 2–3 LEDs in series on one resistor gives the same light for a third of the current.", onRail.map((p) => p.ref));
  }
  for (const reg of [...of("regulator_7805"), ...of("regulator_ams1117_3v3")]) {
    const r = worst(reg.ref);
    if (r && r.i > 0.001) add("tip", "efficiency", `${reg.ref} is a linear regulator`, `A linear regulator burns the whole voltage difference as heat. A small buck (switching) converter such as the MP1584 module does the same job at about 90% efficiency.`, [reg.ref]);
  }
  if (!usefulW && idleA > 0.001 && of("resistor").length >= 2) {
    add("tip", "efficiency", "It draws current doing nothing", `Even at rest the circuit draws ${si(idleA, "A")}. If whatever reads the output has a high input impedance (most do), scaling the resistors up 10× cuts this 10×.`, of("resistor").map((p) => p.ref));
  }

  /* ---------- cost ---------- */
  const costLines = parts.map((p) => ({ ref: p.ref, what: p.kind.replace(/_/g, " "), price: PRICE[p.kind] ?? 0.2 }));
  const total = costLines.reduce((s, l) => s + l.price, 0);
  const uno = of("arduino_uno")[0];
  if (uno) {
    const used = Object.keys(uno.pins).filter((k) => /^D\d|^A\d/.test(cleanPinName(uno.pinNames[k] ?? ""))).length;
    if (used <= 8) add("tip", "cost", "An Uno is more board than this needs", `This uses ${used} of the Uno's pins. A Nano (or a clone, about $4) runs the same code and plugs straight into a breadboard.`, [uno.ref]);
  }
  if (of("timer_555").length && mcuPart) add("tip", "cost", "The Arduino could do the 555's job", "A microcontroller can blink an LED in code, which would save the 555 and its timing parts.", of("timer_555").map((p) => p.ref));

  /* ---------- design and materials ---------- */
  for (const r of of("resistor")) {
    const v = parseValue(r.value);
    if (v && v >= 1 && !isStandard(v)) add("tip", "design", `${r.ref} isn't a standard value`, `You won't find a ${r.value} Ω resistor in a parts drawer. The nearest common (E12) value is ${ohms(nearestE12(v))}.`, [r.ref]);
  }
  for (const t of of("timer_555")) {
    const timingNet = t.pins["6"] ?? t.pins["2"];
    const timingCap = parts.find((q) => q.kind.startsWith("capacitor") && Object.values(q.pins).includes(timingNet ?? ""));
    if (timingCap?.kind === "capacitor_polarized") add("tip", "design", `${timingCap.ref} sets the timing: use a film capacitor`, `Electrolytic capacitors are only accurate to ±20% and drift with temperature and age, so the 555's rhythm wanders. A film (or C0G ceramic) capacitor keeps it steady.`, [timingCap.ref, t.ref]);
    if (t.pins["5"] && !parts.some((q) => q.kind === "capacitor" && Object.values(q.pins).includes(t.pins["5"])))
      add("tip", "design", `${t.ref}'s CONT pin needs a capacitor`, "A 10 nF capacitor from CONT (pin 5) to ground keeps noise out of the 555's thresholds.", [t.ref]);
  }
  for (const chip of [...of("timer_555"), ...of("shift_register_74hc595")]) {
    const vccNet = chip.pins[chip.kind === "timer_555" ? "8" : "16"];
    const decoupled = parts.some((q) => q.kind.startsWith("capacitor") && Object.values(q.pins).includes(vccNet ?? "") && Object.values(q.pins).some((n) => /GND/i.test(n)));
    if (vccNet && !decoupled) add("tip", "design", `${chip.ref} has no decoupling capacitor`, `Put a 100 nF capacitor between ${chip.ref}'s supply pin and ground, right next to the chip, to soak up the current spikes when it switches.`, [chip.ref]);
  }
  for (const reg of [...of("regulator_7805"), ...of("regulator_ams1117_3v3")]) {
    const caps = (pin: string) => parts.some((q) => q.kind.startsWith("capacitor") && Object.values(q.pins).includes(reg.pins[pin] ?? ""));
    const [inPin, outPin] = reg.kind === "regulator_7805" ? ["1", "3"] : ["3", "2"];
    if (!caps(inPin) || !caps(outPin)) add("warning", "design", `${reg.ref} needs its capacitors`, `Linear regulators can oscillate without capacitors on their input and output (the ${reg.kind === "regulator_7805" ? "7805 wants 330 nF in and 100 nF out" : "AMS1117 wants 10 µF in and 22 µF out"}).`, [reg.ref]);
  }
  for (const q of of("npn_transistor")) {
    const base = q.pins["2"];
    const driven = parts.some((p) => p.kind === "resistor" && Object.values(p.pins).includes(base ?? ""));
    if (base && !driven) add("critical", "safety", `${q.ref}'s base has no resistor`, `Without a base resistor, whatever drives ${q.ref}'s base pushes current straight through its base-emitter junction until something burns. Add 1 kΩ–10 kΩ in series.`, [q.ref]);
  }
  for (const b of of("buzzer")) {
    if (mcuPart && Object.values(b.pins).some((n) => Object.values(mcuPart.pins).includes(n)) && (worst(b.ref)?.i ?? 0) > 0.02)
      add("tip", "design", `${b.ref} loads an Arduino pin`, "Buzzers draw 20–40 mA: drive them through an NPN transistor instead of straight from a pin.", [b.ref]);
  }

  /* ---------- code ---------- */
  if (mcuPart && firmware?.trim()) {
    const compile = ArduinoProgram.check(firmware);
    if (compile) add("critical", "code", "The code doesn't compile", compile);
    else {
      if (idle.mcuError) add("critical", "code", "The program crashed", idle.mcuError);
      for (const note of new Set(runs.flatMap((r) => r.mcuNotes))) add("warning", "code", "Pin never set as OUTPUT", note);
      if (/\bint\s+\w+\s*=\s*millis\s*\(/.test(firmware) || /\bint\s+\w+\s*;[\s\S]*?\b\w+\s*=\s*millis\s*\(/.test(firmware))
        add("warning", "code", "millis() in an int", "millis() returns an unsigned long. On an Arduino an int is 16 bits, so it overflows after 32.7 seconds and the timing breaks. Store it in an unsigned long.");
      const loopBody = /void\s+loop\s*\(\s*\)\s*\{([\s\S]*)\}\s*$/.exec(firmware)?.[1] ?? "";
      if (/\bdelay\s*\(\s*\d{3,}/.test(loopBody) && /digitalRead\s*\(/.test(firmware))
        add("tip", "code", "delay() blocks the buttons", "While loop() is inside delay(), button presses are missed. Track time with millis() instead, so loop() keeps checking inputs.");
      if (/digitalWrite\s*\(\s*\d+\s*,/.test(firmware)) add("tip", "code", "Name your pins", "digitalWrite(9, HIGH) works, but `const int LED_PIN = 9;` makes the code readable and the wiring easy to change.");
      if (/Serial\.print/.test(loopBody) && !/delay\s*\(|millis\s*\(/.test(loopBody)) add("tip", "code", "Serial floods", "Printing on every loop() fills the serial line thousands of times a second. Print only when something changes, or every 100 ms or so.");
    }
  } else if (mcuPart) add("warning", "code", "No program", `${mcuPart.ref} has no code, so it won't do anything. Write a sketch in the code tab.`, [mcuPart.ref]);

  /* ---------- scores ---------- */
  const penalty = { critical: 35, warning: 15, tip: 4 };
  const areaScore = (area: Area, base = 100) => Math.max(0, findings.filter((f) => f.area === area).reduce((s, f) => s - penalty[f.severity], base));
  const effBase = percent !== null ? Math.min(100, 25 + percent * 1.1) : idleA > 0.005 ? 60 : 100;
  const costBase = Math.max(30, Math.min(100, 100 - 14 * Math.log2(Math.max(1, total))));
  const areas: Partial<Record<Area, number>> = {
    safety: areaScore("safety"),
    efficiency: areaScore("efficiency", effBase),
    cost: areaScore("cost", costBase),
    design: areaScore("design"),
  };
  if (mcuPart) areas.code = areaScore("code");
  const weights: Record<Area, number> = { safety: 0.35, efficiency: 0.25, design: 0.2, cost: 0.1, code: 0.1 };
  const used = Object.keys(areas) as Area[];
  const wsum = used.reduce((s, a) => s + weights[a], 0);
  let score = used.reduce((s, a) => s + (areas[a] ?? 0) * weights[a], 0) / wsum;
  // Unsafe can't pass; two or more serious hazards fail outright.
  const hazards = findings.filter((f) => f.severity === "critical" && f.area === "safety").length;
  if (hazards) score = Math.min(score, 59 - 15 * (hazards - 1));
  score = Math.round(score);
  const grade = score >= 95 ? "A+" : score >= 88 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 45 ? "D" : "F";
  const order = { critical: 0, warning: 1, tip: 2 };
  const merged = mergeRepeats(findings);
  merged.sort((a, b) => order[a.severity] - order[b.severity]);

  return { score, grade, areas, power: { usefulW, wastedW, percent, idleA, lines }, cost: { total, lines: costLines }, findings: merged };
}

/** "R1 runs warm", "R2 runs warm", "R3 runs warm" → one finding about R1 that mentions R2 and R3. */
function mergeRepeats(findings: Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.severity}|${f.area}|${f.title.replace(/\b[A-Z]{1,3}\d+\b/g, "#")}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    const others = g.slice(1).map((f) => f.refs[0]).filter(Boolean);
    const list = others.length === 1 ? others[0] : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}`;
    return { ...g[0], text: `${g[0].text} The same goes for ${list}.`, refs: [...new Set(g.flatMap((f) => f.refs))] };
  });
}

