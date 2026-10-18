import type { Check, DesignParams, ExampleProject, Net, Step } from "../types";
import { dischargeTime, fmtOhms, fmtSI, ledDesign, LOGIC, tau } from "../math";

/**
 * Example project shown until the engine is connected.
 * Result lines and checks are computed from the parameters, so they stay honest if values change.
 */
const params: DesignParams = {
  supply: 5,
  ledVf: 2.0,
  ledTargetMa: 15,
  ledResistor: 220,
  pullDown: 10_000,
  debounceCapNf: 100,
};

const led = ledDesign(params.supply, params.ledVf, params.ledTargetMa, params.ledResistor);
const ideal = ledDesign(params.supply, params.ledVf, params.ledTargetMa);
const pull = params.supply / params.pullDown;
const t = tau(params.pullDown, params.debounceCapNf);
const tLow = dischargeTime(t, LOGIC.vilFraction);

const steps: Step[] = [
  {
    id: "parse",
    title: "Read request",
    call: "Parse(request)",
    lines: ["input: push button · output: red LED", "board: Arduino Uno · behaviour: LED on while pressed"],
    status: "done",
    parts: [],
    lesson: "parse",
  },
  {
    id: "power",
    title: "Pick controller",
    call: "Place(A1)",
    lines: ["Arduino Uno, 5 V logic, powered over USB", `worst-case draw ${fmtSI(led.current + pull, "A")} of ~500 mA`],
    status: "done",
    parts: [{ ref: "A1", name: "Arduino Uno", value: "ATmega328P" }],
    lesson: "power",
  },
  {
    id: "led",
    title: "Size LED resistor",
    call: "Calculate(R1)",
    lines: [
      `R = (${params.supply} − ${params.ledVf}) / ${params.ledTargetMa} mA = ${fmtOhms(ideal.rIdeal)} → ${fmtOhms(led.r)}`,
      `I = ${fmtSI(led.current, "A")} · P = ${fmtSI(led.power, "W")}`,
    ],
    status: "done",
    parts: [
      { ref: "D1", name: "LED", value: "Red, 2.0 V" },
      { ref: "R1", name: "Resistor", value: fmtOhms(params.ledResistor) },
    ],
    lesson: "led",
  },
  {
    id: "pulldown",
    title: "Read the button",
    call: "Calculate(R2)",
    lines: ["SW1 connects 5 V → D2", `R2 ${fmtOhms(params.pullDown)} pull-down · ${fmtSI(pull, "A")} when pressed`],
    status: "done",
    parts: [
      { ref: "SW1", name: "Push button", value: "SPST" },
      { ref: "R2", name: "Resistor", value: fmtOhms(params.pullDown) },
    ],
    lesson: "pulldown",
  },
  {
    id: "debounce",
    title: "Add debounce",
    call: "Calculate(C1)",
    lines: [`C1 ${params.debounceCapNf} nF across R2`, `τ = ${fmtSI(t, "s")} · reads LOW after ${fmtSI(tLow, "s")}`],
    status: "done",
    parts: [{ ref: "C1", name: "Capacitor", value: `${params.debounceCapNf} nF` }],
    lesson: "debounce",
  },
  {
    id: "nets",
    title: "Wire nets",
    call: "Wire(5 nets)",
    lines: ["14 pins, each in exactly one net", "ERC: GND net has no power flag"],
    status: "warning",
    parts: [],
    lesson: "nets",
  },
  {
    id: "verify",
    title: "Verify",
    call: "Solve(KVL, KCL)",
    lines: [`LED loop: ${params.supply} − ${fmtSI(led.current * led.r, "V")} − ${params.ledVf} V = 0 V`, "current in = current out at every node"],
    status: "done",
    parts: [],
    lesson: "verify",
  },
];

const checks: Check[] = [
  { id: "c-parse", label: "request parsed", status: "pass", stepId: "parse" },
  {
    id: "c-led-i",
    label: `LED ${fmtSI(led.current, "A")} ≤ ${LOGIC.pinMaxMa} mA`,
    status: led.current * 1000 <= LOGIC.pinMaxMa ? "pass" : "fail",
    stepId: "led",
  },
  {
    id: "c-led-p",
    label: `R1 ${fmtSI(led.power, "W")} ≤ ${LOGIC.resistorRatingW * 1000} mW`,
    status: led.power <= LOGIC.resistorRatingW ? "pass" : "fail",
    stepId: "led",
  },
  { id: "c-pull", label: "D2 pulled down", status: "pass", stepId: "pulldown" },
  { id: "c-tau", label: `debounce ${fmtSI(tLow, "s")}`, status: tLow >= 0.0005 ? "pass" : "warn", stepId: "debounce" },
  { id: "c-pins", label: "14/14 pins connected", status: "pass", stepId: "nets" },
  { id: "c-erc", label: "GND needs PWR_FLAG", status: "fail", stepId: "nets" },
  { id: "c-kvl", label: "KVL = 0 V", status: "pass", stepId: "verify" },
];

export const EXAMPLE_PROJECT: ExampleProject = {
  name: "Push-button LED",
  request: "When I press a button, a red LED should light up. Use an Arduino Uno.",
  params,
  steps,
  checks,
};

export const EXAMPLE_NETS: Net[] = [
  { name: "+5V", pins: ["A1.5V", "SW1.1"] },
  { name: "GND", pins: ["A1.GND", "D1.K", "R2.2", "C1.2"] },
  { name: "LED_DRIVE", pins: ["A1.D13", "R1.1"] },
  { name: "LED_ANODE", pins: ["R1.2", "D1.A"] },
  { name: "BUTTON", pins: ["A1.D2", "SW1.2", "R2.1", "C1.1"] },
];
