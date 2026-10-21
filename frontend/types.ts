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
  /** Expands into the C++ editor instead of a lesson. */
  editor?: "firmware";
  /** The Classroom section that explains this step. */
  sectionId?: string;
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
  /** Only the built-in example has these (its lessons and tutorial use them). */
  params?: DesignParams;
  steps: Step[];
  checks: Check[];
  /** Nets of the built schematic. The bundled example omits it and the UI uses EXAMPLE_NETS. */
  nets?: Net[];
  /** What the engine just did, in a sentence ("Updated: LED current 20 mA (brighter)"). */
  summary?: string;
  /** Present for circuits built by the engine: the KiCad files to preview, save or paste. */
  files?: { name: string; schematic: string; project: string };
  /** Program for the microcontroller, when the circuit has one. */
  firmware?: Firmware;
  /** Classroom lesson about this exact circuit (from the backend). */
  lesson?: import("./api/backend").Lesson;
  generator?: "rules" | "llm";
  /** The schematic as drawing data with nets: the Classroom's interactive 2D/3D lab. */
  scene?: import("./lab/scene").Scene;
  /** Parts and nets as the engine designed them (the lab simulates these). */
  circuit?: { components: import("./api/backend").ComponentSpec[]; nets: import("./api/backend").NetSpec[] };
}

export interface Firmware {
  language: "cpp";
  framework: "arduino";
  board: string;
  file_name: string;
  code: string;
  summary: string[];
}

/** The built-in example (always has design parameters); the tutorial is written around it. */
export type ExampleProject = Project & { params: DesignParams };

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
  brand: string; // accent colour, hex
  background: string; // window background, hex
  welcomeDismissed?: boolean;
}

export type KiCadStatus = "disconnected" | "connecting" | "connected";
