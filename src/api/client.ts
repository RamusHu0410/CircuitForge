import type { KiCadStatus, Project } from "../types";

/**
 * Backend connections.
 *
 * One local service (kicad-ai-extension/backend) is both the planning engine
 * (prompt -> steps -> schematic) and the KiCad bridge (status, theme colors, "open in KiCad").
 * In dev, Vite proxies "/api" to it (see vite.config.ts), so the default base is "" (same origin).
 * Set VITE_ENGINE_URL / VITE_KICAD_BRIDGE_URL to point at a different host.
 */
export const ENGINE_URL: string = import.meta.env.VITE_ENGINE_URL ?? "";
export const KICAD_BRIDGE_URL: string = import.meta.env.VITE_KICAD_BRIDGE_URL ?? "";

export const ENDPOINTS = {
  /** POST { prompt, project? } -> Project  (rules extract the knobs to turn, our engine builds the rest) */
  plan: "/api/plan",
  /** POST { params } -> image/svg+xml  (KiCad's own drawing of the design) */
  schematic: "/api/design/svg",
  /** POST { params } -> SendResult  (writes a new KiCad project and opens it) */
  send: "/api/design/send",
  status: "/api/kicad/status",
  colors: "/api/kicad/colors",
  /** POST { prompt } -> the general generator's result (7 circuit families) */
  generate: "/api/generate",
  generateSvg: "/api/generate/svg",
  generateSave: "/api/generate/save",
} as const;

/** The service isn't running, or is blocked from this page (network failure, not an HTTP error). */
export class NotConnectedError extends Error {
  constructor(what: string) {
    super(`${what} is not connected yet`);
    this.name = "NotConnectedError";
  }
}

/** The service answered with an error. `message` is the service's own explanation, safe to show. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

const ENGINE = "The CircuitForge engine";
const BRIDGE = "The KiCad bridge";
const SERVICE_DOWN = "Start it with: cd kicad-ai-extension/backend && uvicorn app.main:app --port 8765";

/** FastAPI errors are `{ detail: string }` or `{ detail: [{ loc, msg }] }`. Turn either into one sentence. */
export function errorMessage(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = (d.loc ?? []).filter((p) => p !== "body").join(".");
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return fallback;
}

async function request(what: string, base: string, path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, init);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new NotConnectedError(what);
  }
  if (!res.ok) {
    // The dev proxy (or any gateway in front of the engine) answers 502/503/504 when it can't reach it.
    // That means "engine not running", not "engine failed". The engine itself never returns these for its own errors.
    if (res.status === 502 || res.status === 504) throw new NotConnectedError(what);
    const body = await res.json().catch(() => null);
    throw new RequestError(errorMessage(body, `${what} failed: ${res.status} ${res.statusText}`), res.status);
  }
  return res;
}

function post(what: string, base: string, path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return request(what, base, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/** What the engine needs back from the current project (it ignores everything else). */
function engineView(project?: Project) {
  return project && { request: project.request, params: project.params };
}

/** Turn a prompt (or a change request on the current project) into a built plan. */
export async function requestPlan(prompt: string, project?: Project, signal?: AbortSignal): Promise<Project> {
  const res = await post(ENGINE, ENGINE_URL, ENDPOINTS.plan, { prompt, project: engineView(project) }, signal);
  return (await res.json()) as Project;
}

/** KiCad bridge: is KiCad available on this computer? */
export async function connectKiCad(): Promise<{ status: KiCadStatus; version: string | null; detail: string }> {
  const res = await request(BRIDGE, KICAD_BRIDGE_URL, ENDPOINTS.status);
  const body = (await res.json()) as { status: "connected" | "disconnected"; version: string | null; detail: string };
  return body;
}

/**
 * KiCad bridge: the user's KiCad color theme, as CSS variable overrides
 * (e.g. { "--kc-wire": "#008400" }). The UI falls back to KiCad's default theme.
 */
export async function fetchKiCadColors(): Promise<Record<string, string>> {
  const res = await request(BRIDGE, KICAD_BRIDGE_URL, ENDPOINTS.colors);
  return (await res.json()) as Record<string, string>;
}

/** KiCad's own drawing of the design, as SVG text. */
export async function fetchSchematicSvg(project: Project, signal?: AbortSignal): Promise<string> {
  const res = await post(BRIDGE, KICAD_BRIDGE_URL, ENDPOINTS.schematic, { params: project.params }, signal);
  return res.text();
}

export interface SendResult {
  folder: string;
  schematicPath: string;
  openedInKicad: boolean;
  openError: string | null;
  ercMessage: string;
  message: string;
}

/** KiCad bridge: write the generated schematic as a new KiCad project and open it. */
export async function sendToKiCad(project: Project): Promise<SendResult> {
  const res = await post(BRIDGE, KICAD_BRIDGE_URL, ENDPOINTS.send, { params: project.params, openInKicad: true });
  return (await res.json()) as SendResult;
}

/* ---------- "Build any circuit": the general generator behind POST /api/generate ---------- */

export interface GeneratedComponent {
  ref: string;
  value: string;
  purpose: string;
}

export interface GeneratedCircuit {
  title: string;
  description: string;
  components: GeneratedComponent[];
  notes: string[];
  erc: { ran: boolean; passed: boolean | null; message: string; problems: string[] };
}

interface GenerateWire {
  circuit: { title: string; description: string; components: GeneratedComponent[]; notes: string[] };
  erc: { ran: boolean; passed: boolean | null; message: string; violations: { severity: string; description: string }[] };
}

/** POST /api/generate: describe any supported circuit (LED, divider, filter, 555 blinker, regulator, button, transistor). */
export async function generateCircuit(prompt: string, signal?: AbortSignal): Promise<GeneratedCircuit> {
  const res = await post(ENGINE, ENGINE_URL, ENDPOINTS.generate, { prompt }, signal);
  const body = (await res.json()) as GenerateWire;
  return {
    title: body.circuit.title,
    description: body.circuit.description,
    components: body.circuit.components.map(({ ref, value, purpose }) => ({ ref, value, purpose })),
    notes: body.circuit.notes,
    erc: {
      ran: body.erc.ran,
      passed: body.erc.passed,
      message: body.erc.message,
      problems: body.erc.violations.map((v) => `${v.severity}: ${v.description}`),
    },
  };
}

/** KiCad's drawing of what POST /api/generate builds for this prompt, as SVG text. */
export async function fetchGeneratedSvg(prompt: string, signal?: AbortSignal): Promise<string> {
  const res = await post(BRIDGE, KICAD_BRIDGE_URL, ENDPOINTS.generateSvg, { prompt }, signal);
  return res.text();
}

export interface SavedCircuit {
  folder: string;
  schematicPath: string;
  openedInKicad: boolean;
  openError: string | null;
}

/** POST /api/generate/save: build it again, save it as a new KiCad project, and open it in KiCad. */
export async function saveGenerated(prompt: string, openInKicad = true): Promise<SavedCircuit> {
  const res = await post(BRIDGE, KICAD_BRIDGE_URL, ENDPOINTS.generateSave, { prompt, open_in_kicad: openInKicad });
  const body = (await res.json()) as { folder: string; schematic_path: string; opened_in_kicad: boolean; open_error: string | null };
  return { folder: body.folder, schematicPath: body.schematic_path, openedInKicad: body.opened_in_kicad, openError: body.open_error };
}

export { SERVICE_DOWN };
