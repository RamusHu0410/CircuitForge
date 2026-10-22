/**
 * Speed-run challenges. Each one is judged by measuring the player's circuit in the simulator
 * (currents, voltages, blink rates, responses to button presses and input signals), never by
 * matching a drawing, so any circuit that really does the job passes.
 *
 * The ids must match backend/app/race.py CHALLENGES (live races use them).
 */

import { isGroundNet, type Netlist, type NetPart } from "../lab/scene";
import { emptyControls, Simulator, type SimControls, type SimResult } from "../lab/sim";
import { parseValue, si } from "../lab/values";

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export interface Judgement {
  pass: boolean;
  checks: Check[];
}

export interface Challenge {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  category: "circuit" | "code";
  brief: string;
  rules: string[];
  /** Parts the challenge is about (highlighted in the parts box). */
  needs: string[];
  /** Starter sketch for code challenges. */
  starter?: string;
  /** A good time in seconds: what a strong player manages. The bots are paced from it. */
  par: number;
  judge(nl: Netlist, code?: string): Judgement;
}

/* ---------- measuring ---------- */

const of = (nl: Netlist, kind: string) => nl.parts.filter((p) => p.kind === kind);
const check = (label: string, ok: boolean, detail: string): Check => ({ label, ok, detail });

/** A copy of the netlist with some parts' values changed (e.g. marking a connector as an input). */
function withValues(nl: Netlist, values: Record<string, string>): Netlist {
  return { ...nl, parts: nl.parts.map((p) => (values[p.ref] ? { ...p, value: values[p.ref] } : p)) };
}

/** Run the circuit for `seconds`, calling `drive` before each step; returns a sample per step. */
function run(nl: Netlist, code: string | undefined, seconds: number, step: number, drive?: (t: number, c: SimControls) => SimControls): { t: number; r: SimResult }[] {
  let controls = emptyControls();
  const sim = new Simulator(nl, controls, code);
  const out: { t: number; r: SimResult }[] = [];
  for (let t = 0; t < seconds - 1e-9; t += step) {
    if (drive) {
      controls = drive(t, controls);
      sim.setControls(controls);
    }
    sim.advance(step);
    out.push({ t: t + step, r: sim.result() });
  }
  return out;
}

const ledOn = (r: SimResult, ref: string) => (r.parts[ref]?.i ?? 0) > 0.002;

/** Blink rate of an LED from samples: rising edges after `settle` seconds. */
function blink(samples: { t: number; r: SimResult }[], ref: string, settle: number) {
  const rises: number[] = [];
  let onTime = 0;
  let total = 0;
  let last: boolean | null = null;
  for (let k = 1; k < samples.length; k++) {
    const { t, r } = samples[k];
    if (t < settle) continue;
    const on = ledOn(r, ref);
    const dt = t - samples[k - 1].t;
    total += dt;
    if (on) onTime += dt;
    if (last === false && on) rises.push(t);
    last = on;
  }
  const periods = rises.slice(1).map((t, i) => t - rises[i]);
  const period = periods.length ? periods.reduce((a, b) => a + b, 0) / periods.length : null;
  return { hz: period ? 1 / period : 0, duty: total ? onTime / total : 0, rises: rises.length };
}

function needsParts(nl: Netlist, wanted: Record<string, string>): Check[] {
  return Object.entries(wanted).map(([kind, label]) => check(`Has ${label}`, of(nl, kind).length > 0, of(nl, kind).length ? `${of(nl, kind).map((p) => p.ref).join(", ")}` : `Add ${label}.`));
}

function hasArduino(nl: Netlist): Check {
  const a = nl.parts.find((p) => p.kind.startsWith("arduino"));
  return check("Has an Arduino", !!a, a ? a.ref : "Add an Arduino Nano or Uno.");
}

function battery(nl: Netlist, lo: number, hi: number, label: string): Check {
  const b = of(nl, "battery")[0];
  const v = b ? (parseValue(b.value) ?? 9) : 0;
  return check(label, !!b && v >= lo && v <= hi, b ? `${b.ref} is ${v} V` : "Add a battery.");
}

/** A connector the judge feeds with a signal (its pin on GND is the reference). */
function signalConnector(nl: Netlist, index = 0): NetPart | undefined {
  return nl.parts.filter((p) => p.kind.startsWith("connector")).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))[index];
}

const BLINK_STARTER = `// Blink an LED twice a second.
const int LED_PIN = 3;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  // your code here
}
`;

const TOGGLE_STARTER = `// Each press of the button flips the LED: on, off, on, ...
const int BUTTON_PIN = 2;
const int LED_PIN = 3;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // pressed = LOW
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  // your code here
}
`;

export const CHALLENGES: Challenge[] = [
  {
    id: "first-light",
    title: "First light",
    level: 1,
    category: "circuit",
    brief: "Light a red LED from a 9 V battery at 10 mA.",
    rules: ["One red LED", "A 9 V battery", "LED current 8–12 mA"],
    needs: ["battery", "led", "resistor"],
    par: 45,
    judge(nl) {
      const checks = [...needsParts(nl, { led: "an LED" }), battery(nl, 8.5, 9.5, "9 V battery")];
      const led = of(nl, "led")[0];
      if (led) {
        const r = run(nl, undefined, 0.05, 0.05).at(-1)!.r;
        const i = r.parts[led.ref]?.i ?? 0;
        checks.push(check("LED current 8–12 mA", i >= 0.008 && i <= 0.012, `${led.ref} gets ${si(i, "A")}`));
      }
      return { pass: checks.every((c) => c.ok), checks };
    },
  },
  {
    id: "button-lamp",
    title: "Button lamp",
    level: 1,
    category: "circuit",
    brief: "An LED that lights only while a button is held down.",
    rules: ["A battery, a push button, an LED", "Released: LED off", "Held: LED at 5–20 mA"],
    needs: ["battery", "push_button", "led", "resistor"],
    par: 60,
    judge(nl) {
      const checks = needsParts(nl, { battery: "a battery", push_button: "a push button", led: "an LED" });
      const led = of(nl, "led")[0];
      const sw = of(nl, "push_button")[0];
      if (led && sw) {
        const samples = run(nl, undefined, 0.2, 0.05, (t, c) => ({ ...c, pressed: { [sw.ref]: t >= 0.1 } }));
        const off = samples[0].r.parts[led.ref]?.i ?? 0;
        const on = samples.at(-1)!.r.parts[led.ref]?.i ?? 0;
        checks.push(check("Released: LED off", off < 0.0005, `${si(off, "A")} with ${sw.ref} up`));
        checks.push(check("Held: LED 5–20 mA", on >= 0.005 && on <= 0.02, `${si(on, "A")} with ${sw.ref} down`));
      }
      return { pass: checks.every((c) => c.ok), checks };
    },
  },
  {
    id: "divider",
    title: "Divide and conquer",
    level: 1,
    category: "circuit",
    brief: "Make 3.3 V from a 9 V battery with two resistors, and bring it out on a 2-pin connector.",
    rules: ["A 9 V battery", "Output on a 2-pin connector: pin 1 = 3.3 V ±0.15 V, pin 2 = GND", "Idle current under 1 mA"],
    needs: ["battery", "resistor", "connector_2pin"],
    par: 75,
    judge(nl) {
      const checks = [battery(nl, 8.5, 9.5, "9 V battery"), ...needsParts(nl, { connector_2pin: "a 2-pin connector" })];
      const j = of(nl, "connector_2pin")[0];
      if (j) {
        const r = run(withValues(nl, { [j.ref]: "Output" }), undefined, 0.05, 0.05).at(-1)!.r;
        const v = (r.netV[j.pins["1"] ?? ""] ?? 0) - (r.netV[j.pins["2"] ?? ""] ?? 0);
        const idle = of(nl, "battery").reduce((s, b) => s + (r.parts[b.ref]?.i ?? 0), 0);
        checks.push(check("Output 3.15–3.45 V", v >= 3.15 && v <= 3.45, `${j.ref} pin 1 is at ${v.toFixed(2)} V`));
        checks.push(check("Idle current < 1 mA", idle < 0.001, `the battery supplies ${si(idle, "A")}`));
      }
      return { pass: checks.every((c) => c.ok), checks };
    },
  },
  {
    id: "transistor",
    title: "Small signal, big load",
    level: 2,
    category: "circuit",
    brief: "A 3.3 V control signal (from a microcontroller, say) switches an LED on at 15 mA or more, using a transistor.",
    rules: ["The control signal comes in on a connector J1 (one pin GND)", "Control at 3.3 V: LED ≥ 15 mA", "Control at 0 V: LED off", "The control draws ≤ 1 mA", "Power the LED from a battery (5–12 V)"],
    needs: ["connector_2pin", "npn_transistor", "resistor", "led", "battery"],
    par: 120,
    judge(nl) {
      const checks = [...needsParts(nl, { npn_transistor: "a transistor", led: "an LED" }), battery(nl, 5, 12, "battery 5–12 V")];
      const j = signalConnector(nl);
      const led = of(nl, "led")[0];
      checks.push(check("Control connector", !!j && Object.values(j.pins).some(isGroundNet), j ? `${j.ref}` : "Add a connector for the control signal, with one pin on GND."));
      if (j && led) {
        const marked = withValues(nl, { [j.ref]: "Control" });
        const level = (v: number) => run(marked, undefined, 0.05, 0.05, (_t, c) => ({ ...c, inputs: { [j.ref]: { mode: "dc", level: v, freq: 1 } } })).at(-1)!.r;
        const on = level(3.3);
        const off = level(0);
        const iOn = on.parts[led.ref]?.i ?? 0;
        const iCtrl = Math.max(...Object.values(on.pinI[j.ref] ?? {}).map(Math.abs), 0);
        checks.push(check("On: LED ≥ 15 mA", iOn >= 0.015, `${si(iOn, "A")} with 3.3 V in`));
        checks.push(check("Off: LED off", (off.parts[led.ref]?.i ?? 0) < 0.0005, `${si(off.parts[led.ref]?.i ?? 0, "A")} with 0 V in`));
        checks.push(check("Control draws ≤ 1 mA", iCtrl <= 0.001, `the control input supplies ${si(iCtrl, "A")}`));
      }
      return { pass: checks.every((c) => c.ok), checks };
    },
  },
  {
    id: "blink-code",
    title: "Blink, in code",
    level: 2,
    category: "code",
    brief: "Wire an LED to an Arduino and write the code to blink it at 2 Hz.",
    rules: ["An Arduino (Nano or Uno), an LED with its resistor", "2 Hz ±10%", "On about half the time (40–60%)", "LED current under 20 mA"],
    needs: ["arduino_nano", "resistor", "led"],
    starter: BLINK_STARTER,
    par: 120,
    judge(nl, code) {
      const checks = [hasArduino(nl), ...needsParts(nl, { led: "an LED" })];
      const led = of(nl, "led")[0];
      if (led) {
        const samples = run(nl, code, 3.2, 0.01);
        const b = blink(samples, led.ref, 0.2);
        const peak = Math.max(...samples.map((s) => s.r.parts[led.ref]?.i ?? 0));
        checks.push(check("Blinks at 2 Hz ±10%", b.hz >= 1.8 && b.hz <= 2.2, b.rises > 1 ? `${b.hz.toFixed(2)} Hz` : "the LED doesn't blink"));
        checks.push(check("On 40–60% of the time", b.duty >= 0.4 && b.duty <= 0.6, `${Math.round(b.duty * 100)}%`));
        checks.push(check("LED current under 20 mA", peak > 0.001 && peak < 0.02, peak > 0.001 ? si(peak, "A") : "the LED never lights"));
      }
      const err = new Simulator(nl, emptyControls(), code).result().mcu;
      const firstError = Object.values(err).find((m) => m.error)?.error;
      if (firstError) checks.unshift(check("Code runs", false, firstError));
      return { pass: checks.every((c) => c.ok), checks };
    },
  },
  {
    id: "toggle-code",
    title: "Toggle switch, in code",
    level: 2,
    category: "code",
    brief: "Each press of a button flips an LED: first press on, next press off, and so on.",
    rules: ["An Arduino, a push button, an LED with its resistor", "Press 1: on · press 2: off · press 3: on", "Holding the button doesn't make it flicker"],
    needs: ["arduino_nano", "push_button", "resistor", "led"],
    starter: TOGGLE_STARTER,
    par: 180,
    judge(nl, code) {
      const checks = [hasArduino(nl), ...needsParts(nl, { push_button: "a push button", led: "an LED" })];
      const led = of(nl, "led")[0];
      const sw = of(nl, "push_button")[0];
      if (led && sw) {
        // Three presses; the second is held for a while.
        const presses = [
          [0.5, 0.65],
          [1.5, 2.2],
          [2.8, 2.95],
        ];
        const samples = run(nl, code, 3.4, 0.01, (t, c) => ({ ...c, pressed: { [sw.ref]: presses.some(([a, b]) => t >= a && t < b) } }));
        const at = (t: number) => ledOn(samples.find((s) => s.t >= t)!.r, led.ref);
        const states = [at(0.4), at(1.2), at(2.5), at(3.3)];
        const heldSteady = samples.filter((s) => s.t > 1.6 && s.t < 2.2).every((s) => ledOn(s.r, led.ref) === states[2]);
        checks.push(check("Starts off", !states[0], states[0] ? "the LED is on before any press" : "off"));
        checks.push(check("Press 1: on", states[1], states[1] ? "on" : "still off"));
        checks.push(check("Press 2: off", !states[2], states[2] ? "still on" : "off"));
        checks.push(check("Press 3: on", states[3], states[3] ? "on" : "off"));
        checks.push(check("No flicker while held", heldSteady, heldSteady ? "steady" : "it changes while the button is held"));
      }
      return { pass: checks.every((c) => c.ok), checks };
    },
  },
  {
    id: "heartbeat-555",
    title: "555 heartbeat",
    level: 3,
    category: "circuit",
    brief: "Blink an LED once a second with a 555 timer. No microcontroller.",
    rules: ["A 555, a battery (5–12 V), an LED", "1 Hz ±15%", "No Arduino"],
    needs: ["timer_555", "resistor", "capacitor_polarized", "capacitor", "led", "battery"],
    par: 240,
    judge(nl) {
      const checks = [...needsParts(nl, { timer_555: "a 555", led: "an LED" }), battery(nl, 5, 12, "battery 5–12 V"), check("No microcontroller", !nl.parts.some((p) => p.kind.startsWith("arduino")), "this one is analog only")];
      const led = of(nl, "led")[0];
      if (led) {
        const b = blink(run(nl, undefined, 5.5, 0.005), led.ref, 1.2);
        checks.push(check("Blinks at 1 Hz ±15%", b.hz >= 0.85 && b.hz <= 1.15, b.rises > 1 ? `${b.hz.toFixed(2)} Hz` : "the LED doesn't blink"));
      }
      return { pass: checks.every((c) => c.ok), checks };
    },
  },
  {
    id: "steady-5v",
    title: "Steady 5 V",
    level: 3,
    category: "circuit",
    brief: "Power a 100 mA load (a 47–56 Ω resistor) at 5 V from a 12 V battery.",
    rules: ["A 12 V battery", "A load resistor of 47–56 Ω", "5 V ±0.1 V across the load"],
    needs: ["battery", "regulator_7805", "capacitor", "resistor"],
    par: 150,
    judge(nl) {
      const checks = [battery(nl, 11.5, 12.5, "12 V battery")];
      const load = of(nl, "resistor").find((r) => {
        const v = parseValue(r.value);
        return v !== null && v >= 47 && v <= 56;
      });
      checks.push(check("A 47–56 Ω load", !!load, load ? `${load.ref} (${load.value} Ω)` : "Add the load: a resistor between 47 and 56 Ω."));
      if (load) {
        const r = run(nl, undefined, 0.3, 0.05).at(-1)!.r;
        const v = Math.abs(r.parts[load.ref]?.v ?? 0);
        checks.push(check("5 V ±0.1 across the load", v >= 4.9 && v <= 5.1, `${v.toFixed(2)} V across ${load.ref}`));
      }
      return { pass: checks.every((c) => c.ok), checks };
    },
  },
  {
    id: "low-pass",
    title: "Low-pass at 500 Hz",
    level: 2,
    category: "circuit",
    brief: "Build a filter that lets slow signals through and halves the power of signals at 500 Hz.",
    rules: ["Input on connector J1 (pin 1 signal, pin 2 GND), output on J2 (same)", "At 500 Hz the output swing is 64–78% of the input's (−3 dB)", "At 50 Hz it's more than 95%"],
    needs: ["connector_2pin", "resistor", "capacitor"],
    par: 120,
    judge(nl) {
      const ins = signalConnector(nl, 0);
      const out = signalConnector(nl, 1);
      const checks = [check("Input and output connectors", !!ins && !!out, ins && out ? `${ins.ref} in, ${out.ref} out` : "Add two connectors: J1 for the input, J2 for the output.")];
      if (ins && out) {
        const marked = withValues(nl, { [ins.ref]: "Signal_In", [out.ref]: "Signal_Out" });
        const swing = (hz: number) => {
          const periods = 12;
          const samples = run(marked, undefined, periods / hz, 1 / (hz * 40), (_t, c) => ({ ...c, inputs: { [ins.ref]: { mode: "sine", level: 2, freq: hz } } }));
          const late = samples.slice(Math.floor(samples.length / 2));
          const v = late.map((s) => (s.r.netV[out.pins["1"] ?? ""] ?? 0) - (s.r.netV[out.pins["2"] ?? ""] ?? 0));
          return (Math.max(...v) - Math.min(...v)) / 2;
        };
        const g500 = swing(500);
        const g50 = swing(50);
        checks.push(check("At 500 Hz: 64–78%", g500 >= 0.64 && g500 <= 0.78, `${Math.round(g500 * 100)}%`));
        checks.push(check("At 50 Hz: over 95%", g50 > 0.95, `${Math.round(g50 * 100)}%`));
      }
      return { pass: checks.every((c) => c.ok), checks };
    },
  },
];

export const challengeById = (id: string) => CHALLENGES.find((c) => c.id === id);
