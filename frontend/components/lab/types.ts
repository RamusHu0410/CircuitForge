import type { Flow } from "../../lab/flow";
import type { Layout, Pt, Scene } from "../../lab/scene";
import type { SimResult } from "../../lab/sim";

/** Whatever the student clicked: a part, one of its pins, a wire, or a small detail of the drawing. */
export type Selection =
  | { kind: "part"; ref: string }
  | { kind: "pin"; ref: string; pin: string }
  | { kind: "net"; net: string; current?: number }
  | { kind: "tiny"; what: "junction" | "label" | "ground" | "supply" | "ref" | "value" | "noConnect"; net?: string; ref?: string }
  | { kind: "detail"; ref: string; title: string; text: string };

export interface Focus {
  refs: Set<string>;
  nets: Set<string>;
}

export interface ViewProps {
  scene: Scene;
  layout: Layout;
  result: SimResult | null;
  flow: Flow | null;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  /** Show electrons (true) or conventional current (false). */
  electrons: boolean;
  showFlow: boolean;
  showVolts: boolean;
  focus: Focus | null;
  tourDot: Pt | null;
  pressed: Record<string, boolean>;
  onPress: (ref: string, down: boolean) => void;
}

export const ELECTRON = "#22a3ff";
export const CURRENT = "#f0a000";

/** 0 V blue → highest voltage red. */
export function voltColor(v: number, vmax: number): string {
  const f = vmax > 0 ? Math.max(0, Math.min(1, v / vmax)) : 0;
  return `hsl(${Math.round(225 - 225 * f)}, 85%, ${f > 0.02 ? 48 : 40}%)`; // commas: three.js parses this form too
}

export const selectedRef = (s: Selection | null) => (s && (s.kind === "part" || s.kind === "pin" || s.kind === "detail") ? s.ref : null);
