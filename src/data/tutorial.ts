import { dischargeTime, fmtOhms, fmtSI, ledDesign, LOGIC, tau } from "../math";
import { EXAMPLE_PROJECT } from "./example";

/** Tutorial content. All electrical values are computed from the example project's parameters. */

const P = EXAMPLE_PROJECT.params;
const led = ledDesign(P.supply, P.ledVf, P.ledTargetMa, P.ledResistor);
const tc = tau(P.pullDown, P.debounceCapNf);
export const LED_CURRENT = led.current;
export const PULL_CURRENT = P.supply / P.pullDown;
export const TAU = tc;
export const T_LOW = dischargeTime(tc, LOGIC.vilFraction);

export type PartId = "A1" | "SW1" | "R1" | "D1" | "R2" | "C1" | "GND" | "FLAG" | "pin5V" | "pinD13" | "pinD2";
export type Role = "controller" | "input" | "output" | "passive" | "power";

export interface PartInfo {
  name: string;
  ref: string;
  role: Role;
  what: string;
  why: string;
  values: [string, string][];
  /** tooltip anchor, in schematic coordinates */
  at: [number, number];
}

export const PART_INFO: Record<PartId, PartInfo> = {
  A1: {
    name: "Arduino Uno",
    ref: "A1",
    role: "controller",
    what: "A microcontroller board. It runs your program, reads input pins and switches output pins.",
    why: "It's the brain: it reads the button on D2 and turns the LED on D13 on or off.",
    values: [
      ["logic level", "5 V"],
      ["pin current", `${LOGIC.pinMaxMa} mA rec. · ${LOGIC.pinAbsMaxMa} mA max`],
      ["input", "D2"],
      ["output", "D13"],
    ],
    at: [90, 40],
  },
  pin5V: {
    name: "5V pin",
    ref: "A1 · 5V",
    role: "power",
    what: "The Uno's 5 V supply output, fed from USB.",
    why: "It powers the button side of the circuit, so pressing SW1 puts 5 V on D2.",
    values: [
      ["voltage", "5 V"],
      ["net", "+5V"],
    ],
    at: [150, 80],
  },
  pinD13: {
    name: "D13 · digital output",
    ref: "A1 · D13",
    role: "output",
    what: "An output pin. The program sets it HIGH (5 V) or LOW (0 V).",
    why: "When it's HIGH, it pushes current through R1 and D1 to light the LED.",
    values: [
      ["HIGH / LOW", "5 V / 0 V"],
      ["load", fmtSI(led.current, "A")],
    ],
    at: [150, 140],
  },
  pinD2: {
    name: "D2 · digital input",
    ref: "A1 · D2",
    role: "input",
    what: "An input pin. It measures voltage and reports HIGH or LOW to the program.",
    why: "It reads the button. Above 3 V reads HIGH, below 1.5 V reads LOW.",
    values: [
      ["reads HIGH", `≥ ${LOGIC.vihFraction * P.supply} V`],
      ["reads LOW", `≤ ${LOGIC.vilFraction * P.supply} V`],
      ["current", "≈ 0 (≤ 1 µA)"],
    ],
    at: [150, 220],
  },
  SW1: {
    name: "Push button",
    ref: "SW1",
    role: "input",
    what: "A momentary switch. It only connects its two pins while you hold it down.",
    why: "It connects D2 to 5 V when pressed, which is how the program knows you pressed it.",
    values: [
      ["type", "SPST, normally open"],
      ["between", "+5V ↔ BUTTON"],
    ],
    at: [276, 46],
  },
  R1: {
    name: "LED resistor",
    ref: "R1",
    role: "passive",
    what: "A resistor in series with the LED. It sets how much current flows.",
    why: "Without it the LED would draw far too much current and burn out, and could damage the pin.",
    values: [
      ["value", fmtOhms(P.ledResistor)],
      ["current", fmtSI(led.current, "A")],
      ["power", fmtSI(led.power, "W")],
    ],
    at: [260, 124],
  },
  D1: {
    name: "Red LED",
    ref: "D1",
    role: "output",
    what: "A light-emitting diode. It glows when current flows from its anode (+) to its cathode (−).",
    why: "It's the visible output: it lights while the button is pressed.",
    values: [
      ["forward voltage", `≈ ${P.ledVf} V (typical)`],
      ["current", fmtSI(led.current, "A")],
    ],
    at: [364, 108],
  },
  R2: {
    name: "Pull-down resistor",
    ref: "R2",
    role: "passive",
    what: "A resistor from D2 to ground.",
    why: "It holds D2 at 0 V when the button is open, so the input never floats and reads random values.",
    values: [
      ["value", fmtOhms(P.pullDown)],
      ["current, pressed", fmtSI(P.supply / P.pullDown, "A")],
    ],
    at: [500, 236],
  },
  C1: {
    name: "Debounce capacitor",
    ref: "C1",
    role: "passive",
    what: "A capacitor across R2. It stores charge and releases it slowly.",
    why: "It keeps D2 HIGH for a moment after release, so the contact bounce isn't read as extra presses.",
    values: [
      ["value", `${P.debounceCapNf} nF`],
      ["τ = R2·C1", fmtSI(tc, "s")],
      ["reads LOW after", fmtSI(dischargeTime(tc, LOGIC.vilFraction), "s")],
    ],
    at: [570, 244],
  },
  GND: {
    name: "Ground",
    ref: "GND",
    role: "power",
    what: "The 0 V reference. Every current in the circuit returns here.",
    why: "All GND symbols are the same net, so they don't need to be wired to each other.",
    values: [
      ["voltage", "0 V"],
      ["pins", "A1, D1, R2, C1"],
    ],
    at: [430, 170],
  },
  FLAG: {
    name: "Power flag",
    ref: "PWR_FLAG",
    role: "power",
    what: "A marker that says \"this net is powered from outside the schematic\".",
    why: "The USB supply isn't drawn, so KiCad's ERC needs this to know GND is driven.",
    values: [["net", "GND"]],
    at: [236, 254],
  },
};

/* ---------- page 1: guided walkthrough ---------- */

export type SimPhase = "idle" | "pressed" | "releasing";
export type Target = PartId | "5V" | "BUTTON" | "LED_DRIVE" | "LED_ANODE" | "GND_NET";

export interface TourStep {
  id: string;
  title: string;
  phase: SimPhase;
  highlight: Target[];
  text: string;
}

export const TOUR: TourStep[] = [
  {
    id: "power",
    title: "Power",
    phase: "idle",
    highlight: ["A1", "pin5V", "5V"],
    text: "The Arduino (A1) runs your program and puts 5 V on its 5V pin. SW1 is open, so nothing flows on the button side yet. R2 holds D2 at 0 V.",
  },
  {
    id: "press",
    title: "Press",
    phase: "pressed",
    highlight: ["SW1", "R2", "BUTTON", "5V"],
    text: `Pressing SW1 connects D2 to 5 V. A small current, 5 V ÷ ${fmtOhms(P.pullDown)} = ${fmtSI(P.supply / P.pullDown, "A")}, flows through R2 to ground, and C1 charges to 5 V almost instantly.`,
  },
  {
    id: "read",
    title: "Read",
    phase: "pressed",
    highlight: ["pinD2", "BUTTON"],
    text: "D2 now sits at 5 V. That's above the 3 V HIGH threshold, so the program reads HIGH. The input itself draws almost no current; it only measures the voltage.",
  },
  {
    id: "light",
    title: "Light",
    phase: "pressed",
    highlight: ["pinD13", "R1", "D1", "LED_DRIVE", "LED_ANODE"],
    text: `The program sets D13 HIGH. Current flows D13 → R1 → D1 → ground: (5 V − ${P.ledVf} V) ÷ ${fmtOhms(P.ledResistor)} ≈ ${fmtSI(led.current, "A")}, so the LED lights.`,
  },
  {
    id: "release",
    title: "Release",
    phase: "releasing",
    highlight: ["C1", "R2", "BUTTON"],
    text: `Let go and SW1 opens. C1 drains through R2, so D2 falls along v = 5·e^(−t/τ). Below 1.5 V it reads LOW and the program turns the LED off, about ${fmtSI(dischargeTime(tc, LOGIC.vilFraction), "s")} later (shown in slow motion).`,
  },
];

/* ---------- page 3: build steps ---------- */

export interface BuildStep {
  id: string;
  title: string;
  key?: string;
  text: string;
  why: string;
  tip: string;
  highlight: Target[];
}

export const BUILD_STEPS: BuildStep[] = [
  {
    id: "open",
    title: "Open the schematic editor",
    text: "In the KiCad project window, double-click the .kicad_sch file.",
    why: "Everything starts in the schematic: the logical drawing of what connects to what. The board layout comes later.",
    tip: "Create the project first (File → New Project) so the schematic and board stay linked.",
    highlight: [],
  },
  {
    id: "place",
    title: "Place the symbols",
    key: "A",
    text: "Press A, then search for and place Arduino_UNO_R3, LED, R (×2), C and SW_Push.",
    why: "Symbols are the parts. Each one gets a reference (R1, D1…) so the parts list and the board can find it.",
    tip: "Press R to rotate a symbol while placing it. Esc cancels the current tool.",
    highlight: ["A1", "SW1", "R1", "D1", "R2", "C1"],
  },
  {
    id: "values",
    title: "Set the values",
    key: "E",
    text: "Hover over a symbol and press E. Set R1 = 220, R2 = 10k, C1 = 100n.",
    why: "The value is the part you'd buy. These numbers come from the math in part 2.",
    tip: "Values accept SI shorthand: 10k means 10 000 Ω and 100n means 100 nF.",
    highlight: ["R1", "R2", "C1"],
  },
  {
    id: "wire",
    title: "Draw the wires",
    key: "W",
    text: "Press W, click a pin, then click the pin it connects to. Follow the reference.",
    why: "Wires create nets. Every pin on the same wire is the same electrical point.",
    tip: "A wire only connects when it ends exactly on a pin. Watch for the small dangling-end marker to disappear.",
    highlight: ["5V", "BUTTON", "LED_DRIVE", "LED_ANODE"],
  },
  {
    id: "power",
    title: "Add power symbols",
    key: "P",
    text: "Press P to place GND symbols, then add a PWR_FLAG on the GND net.",
    why: "Power symbols connect by name, so every GND symbol joins the same net without wires between them.",
    tip: "PWR_FLAG tells ERC that a net is powered by something that isn't drawn. Here, that's the USB cable.",
    highlight: ["GND", "GND_NET", "FLAG"],
  },
  {
    id: "erc",
    title: "Run the electrical rules check",
    text: "Open Inspect → Electrical Rules Checker and click Run ERC.",
    why: "ERC looks for unconnected pins, undriven power nets, conflicting outputs and other wiring mistakes.",
    tip: "Click any ERC marker to jump to the problem. Part 4 explains the common ones.",
    highlight: ["FLAG", "GND_NET"],
  },
];

/* ---------- page 4: diagnostics ---------- */

export interface Diagnostic {
  id: "power" | "pin" | "wire";
  title: string;
  code: string;
  severity: "error" | "warning";
  short: string;
  what: string;
  why: string;
  fix: string;
  keys: string[];
}

export const DIAGNOSTICS: Diagnostic[] = [
  {
    id: "power",
    title: "Input Power pin not driven by any Output Power pins",
    code: "power_pin_not_driven",
    severity: "error",
    short: "A power net has no source that KiCad can see.",
    what: "The GND net connects to power-input pins (like the Uno's GND), but nothing in the schematic is marked as the source of that power.",
    why: "KiCad can't see the USB cable. Power-input pins must be driven by a power-output pin or a PWR_FLAG, otherwise ERC can't prove the net is powered.",
    fix: "Press P, place a PWR_FLAG and wire it to the GND net. Do the same for +5V if KiCad flags it too.",
    keys: ["P"],
  },
  {
    id: "pin",
    title: "Pin not connected",
    code: "pin_not_connected",
    severity: "error",
    short: "A symbol pin has nothing attached.",
    what: "A pin on a symbol has no wire, label or power symbol attached to it.",
    why: "Unconnected pins are usually mistakes, so ERC flags every pin that isn't on a net, unless you mark it as intentionally unused.",
    fix: "Wire the pin (W). If it's meant to be unused, place a no-connect flag on it (Q).",
    keys: ["W", "Q"],
  },
  {
    id: "wire",
    title: "Unconnected wire endpoint",
    code: "wire_dangling",
    severity: "warning",
    short: "A wire stops just short of a pin.",
    what: "A wire ends in empty space, just short of the pin it was meant to reach. It looks connected, but it isn't.",
    why: "KiCad only connects wires that end exactly on a pin or on another wire. A dangling end usually means a connection you think exists doesn't.",
    fix: "Drag the wire end (G) onto the pin until the dangling marker disappears, or delete it and redraw it (W).",
    keys: ["G", "W"],
  },
];
