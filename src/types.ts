export type StepStatus = "done" | "warning" | "failed" | "pending";
export type CheckStatus = "pass" | "warn" | "fail";
export type LessonId = "parse" | "power" | "led" | "pulldown" | "debounce" | "nets" | "verify";

export interface Part {
  ref: string;
  name: string;
  value: string;
}

/** One step of the plan: the LLM extracts it from the prompt, our engine builds it. */
export interface Step {
  id: string;
  title: string; // todo-list label
  call: string; // tool-call style label, e.g. "Calculate(R1)"
  lines: string[]; // result lines under the call
  status: StepStatus;
  parts: Part[];
  tags?: string[];
  lesson?: LessonId;
}

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  stepId: string;
}

/** Electrical values the engine chose; lessons and checks are computed from these. */
export interface DesignParams {
  supply: number; // V
  ledVf: number; // V
  ledTargetMa: number; // mA
  ledResistor: number; // Ω
  pullDown: number; // Ω
  debounceCapNf: number; // nF; 0 = no capacitor
  ledColor?: "red" | "orange" | "yellow" | "green" | "blue" | "white"; // set by the engine; the example omits it
}

export interface Net {
  name: string;
  pins: string[];
}

export interface Project {
  name: string;
  request: string;
  params: DesignParams;
  steps: Step[];
  checks: Check[];
  /** Nets of the built schematic. The bundled example omits it and the UI uses EXAMPLE_NETS. */
  nets?: Net[];
  /** What the engine just did, in a sentence ("Updated: LED current 20 mA (brighter)"). */
  summary?: string;
}

export interface ChatMessage {
  id: number;
  text: string;
  state: "sending" | "done" | "declined" | "not-connected" | "error"; // declined: the engine understood but can't do that
  note?: string;
}

export type ActivityKind = "info" | "success" | "warn" | "error";
export interface Activity {
  id: number;
  time: string;
  kind: ActivityKind;
  text: string;
}

export type Level = "eli5" | "beginner" | "expert";

export interface Settings {
  kicadVersion: "9" | "10";
  level: Level;
}

export type KiCadStatus = "disconnected" | "connecting" | "connected";
