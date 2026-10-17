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
  debounceCapNf: number; // nF
}

export interface Project {
  name: string;
  request: string;
  params: DesignParams;
  steps: Step[];
  checks: Check[];
}

export interface Net {
  name: string;
  pins: string[];
}

export interface ChatMessage {
  id: number;
  text: string;
  state: "sending" | "done" | "not-connected" | "error";
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
