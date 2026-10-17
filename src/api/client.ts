import type { KiCadStatus, Project } from "../types";

/**
 * Backend connections — PLACEHOLDERS.
 * The planning engine (prompt -> steps -> schematic) and the KiCad bridge (IPC API)
 * don't exist yet, so every endpoint is intentionally blank.
 */
export const ENGINE_URL: string = import.meta.env.VITE_ENGINE_URL ?? "";
export const KICAD_BRIDGE_URL: string = import.meta.env.VITE_KICAD_BRIDGE_URL ?? "";

export const ENDPOINTS = {
  /** POST { prompt, project? } -> Project  (LLM extracts steps, our engine builds them) */
  plan: "",
  /** POST { project } -> Check[] */
  checks: "",
} as const;

export class NotConnectedError extends Error {
  constructor(what: string) {
    super(`${what} is not connected yet`);
    this.name = "NotConnectedError";
  }
}

async function post<T>(what: string, base: string, endpoint: string, body: unknown): Promise<T> {
  if (!base || !endpoint) throw new NotConnectedError(what);
  const res = await fetch(`${base}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Turn a prompt (or a change request on the current project) into a built plan. */
export function requestPlan(prompt: string, project?: Project): Promise<Project> {
  return post("The CircuitForge engine", ENGINE_URL, ENDPOINTS.plan, { prompt, project });
}

/** KiCad bridge: connect to the running KiCad instance. */
export async function connectKiCad(): Promise<KiCadStatus> {
  // TODO: connect to KiCad's IPC API through the bridge at KICAD_BRIDGE_URL.
  throw new NotConnectedError("The KiCad bridge");
}

/**
 * KiCad bridge: the user's KiCad color theme, as CSS variable overrides
 * (e.g. { "--kc-wire": "#008400" }). The UI falls back to KiCad's default theme.
 */
export async function fetchKiCadColors(): Promise<Record<string, string>> {
  // TODO: read the active theme from KiCad's colors/*.json via the bridge.
  throw new NotConnectedError("The KiCad bridge");
}

/** KiCad bridge: write the generated schematic into the open KiCad project. */
export async function sendToKiCad(_project: Project): Promise<void> {
  // TODO: send the schematic to the bridge; it writes .kicad_sch / uses the IPC API.
  throw new NotConnectedError("The KiCad bridge");
}
