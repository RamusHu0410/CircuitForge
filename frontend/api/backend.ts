/** Response shapes of the backend (mirrors backend/app/schemas/circuit.py and routes/desktop.py). */

export interface SchematicFiles {
  name: string;
  schematic: string;
  project: string;
}

export interface ComponentSpec {
  ref: string;
  kind: string;
  value: string;
  purpose: string;
}

export interface NetSpec {
  name: string;
  connections: { ref: string; pin: string }[];
}

export interface Issue {
  code: string;
  message: string;
  ref?: string | null;
  net?: string | null;
}

export interface ErcReport {
  ran: boolean;
  passed: boolean | null;
  error_count: number;
  warning_count: number;
  violations: { severity: string; type: string; description: string; items: string[] }[];
  message: string;
}

export interface GenerateResponse {
  request_id: string;
  status: "generated";
  message: string;
  prompt: string;
  generator: "rules" | "llm";
  circuit: {
    title: string;
    description: string;
    components: ComponentSpec[];
    nets: NetSpec[];
    notes: string[];
  };
  validation: { valid: boolean; errors: Issue[]; warnings: Issue[] };
  erc: ErcReport;
  files: SchematicFiles;
  firmware: import("../types").Firmware | null;
  lesson: Lesson | null;
  scene: import("../lab/scene").Scene | null;
}

export interface DesktopInfo {
  kicad_found: boolean;
  kicad_version: string | null;
  project_name: string | null;
  project_dir: string | null;
  opened_from_kicad: boolean;
  save_dir: string;
  focus_seq: number;
}

/** Classroom lesson (mirrors backend/app/schemas/lesson.py). */
export interface LevelText {
  eli5: string;
  beginner: string;
  expert: string;
}
export interface PlayParam {
  name: string;
  label: string;
  tex: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
}
export interface PlayOutput {
  label: string;
  tex: string;
  expr: string;
  unit: string;
  digits: number;
  max_ok: number | null;
  limit_note: string;
}
export interface LessonSection {
  id: string;
  kind: "overview" | "parts" | "math" | "code" | "build" | "check";
  title: string;
  refs: string[];
  text: LevelText;
  facts: { label: string; value: string }[];
  formulas: { tex: string; caption: string }[];
  playground: { caption: string; params: PlayParam[]; outputs: PlayOutput[] } | null;
  code: { title: string; start_line: number; code: string; explain: LevelText }[];
  steps: { title: string; key: string | null; detail: string }[];
  quiz: { question: string; options: string[]; answer: number; why: string }[];
}
export interface Lesson {
  title: string;
  summary: LevelText;
  sections: LessonSection[];
}
