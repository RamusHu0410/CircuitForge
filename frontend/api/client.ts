import type { Firmware, Project } from "../types";
import type { DesktopInfo, GenerateResponse, SchematicFiles } from "./backend";
import { toProject } from "./mapping";

/**
 * Talks to the CircuitForge engine (kicad-ai-extension/backend), one of two ways:
 *
 * - Opened from KiCad, the window loads "index.html#bridge" and there is no server: pywebview hands
 *   each call straight to Python (backend/app/bridge.py), which replies {ok, data} or {ok, status, detail}.
 * - Otherwise over HTTP. The backend serves the UI itself, so paths are same-origin ("/api/..."); in
 *   `npm run dev`, Vite proxies /api to 127.0.0.1:8765. VITE_ENGINE_URL can point somewhere else.
 */
export const ENGINE_URL: string = import.meta.env.VITE_ENGINE_URL ?? "";
const IN_BRIDGE = typeof location !== "undefined" && location.hash === "#bridge";

export class NotConnectedError extends Error {
  constructor(message = "The CircuitForge backend isn't running. Start it with: uvicorn app.main:app --port 8765") {
    super(message);
    this.name = "NotConnectedError";
  }
}

/** A clear message from the backend, e.g. a prompt the engine can't build yet. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type BridgeReply = { ok: true; data: unknown } | { ok: false; status: number; detail: string };
type BridgeApi = Record<string, (...args: unknown[]) => Promise<BridgeReply>>;

let bridgeReady: Promise<BridgeApi> | null = null;

/** pywebview adds `window.pywebview.api` after the page loads and then fires "pywebviewready". */
function bridgeApi(): Promise<BridgeApi> {
  bridgeReady ??= new Promise<BridgeApi>((resolve, reject) => {
    const api = () => (window as { pywebview?: { api?: BridgeApi } }).pywebview?.api;
    if (api()?.generate) return resolve(api()!);
    const timer = window.setTimeout(() => {
      bridgeReady = null; // let the next call wait again
      reject(new NotConnectedError("The CircuitForge engine didn't start. Close this window and click the button in KiCad again."));
    }, 15000);
    window.addEventListener("pywebviewready", () => {
      window.clearTimeout(timer);
      resolve(api()!);
    }, { once: true });
  });
  return bridgeReady;
}

async function invoke<T>(method: string, ...args: unknown[]): Promise<T> {
  const api = await bridgeApi();
  let reply: BridgeReply;
  try {
    reply = await api[method](...args);
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : String(e), 500);
  }
  if (!reply.ok) throw new ApiError(reply.detail, reply.status);
  return reply.data as T;
}

async function call(path: string, init?: RequestInit & { json?: unknown }): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}${path}`, {
      ...init,
      method: init?.json !== undefined ? "POST" : (init?.method ?? "GET"),
      headers: init?.json !== undefined ? { "Content-Type": "application/json" } : init?.headers,
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    });
  } catch {
    throw new NotConnectedError();
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg?: string }) => d.msg).join("; ");
    } catch {
      /* not JSON */
    }
    throw new ApiError(detail, res.status);
  }
  return res;
}

/** Prompt → circuit → schematic → KiCad ERC, mapped into the transcript's project shape. */
export async function requestPlan(prompt: string): Promise<Project> {
  const body = IN_BRIDGE ? await invoke<GenerateResponse>("generate", { prompt }) : await (await call("/api/generate", { json: { prompt } })).json();
  return toProject(body as GenerateResponse);
}

export async function getDesktopInfo(): Promise<DesktopInfo> {
  return IN_BRIDGE ? invoke("desktop_info") : (await call("/api/desktop/info")).json();
}

/** KiCad's own SVG rendering of the generated schematic. */
export async function previewSvg(files: SchematicFiles): Promise<string> {
  return IN_BRIDGE ? invoke("preview", files) : (await call("/api/desktop/preview", { json: files })).text();
}

export interface SaveResult {
  folder: string;
  schematic_path: string;
  firmware_path: string | null;
  board_path: string | null;
  opened_in_kicad: boolean;
  open_error: string | null;
}

/** Save as a new project next to the open KiCad project (with the sketch, if any) and open it. */
export async function saveAndOpen(files: SchematicFiles, firmware?: Firmware, openAs: "schematic" | "pcb" = "schematic"): Promise<SaveResult> {
  const body = { files, firmware: firmware ?? null, open_in_kicad: true, open_as: openAs };
  return IN_BRIDGE ? invoke("save", body) : (await call("/api/desktop/save", { json: body })).json();
}

export interface ExportResult {
  folder: string;
  files: string[];
  skipped: string[];
  reveal_error: string | null;
}

/** Export the schematic as pictures (SVG, PDF, PNG), the code, and the KiCad project; opens the folder. */
export async function exportDesign(files: SchematicFiles, firmware: Firmware | undefined, pngDataUrl: string | null): Promise<ExportResult> {
  const body = { files, firmware: firmware ?? null, png_base64: pngDataUrl };
  return IN_BRIDGE ? invoke("export", body) : (await call("/api/desktop/export", { json: body })).json();
}

/** Copy the circuit so it can be pasted (Cmd/Ctrl+V) into the schematic that's open in KiCad. */
export async function placeInSchematic(files: SchematicFiles): Promise<{ copied: boolean; symbols: number; message: string }> {
  return IN_BRIDGE ? invoke("place", files) : (await call("/api/desktop/place", { json: files })).json();
}

/* ---------- the website: mode, parts library, races ---------- */

export interface SiteInfo {
  mode: "desktop" | "web";
  site_url: string | null;
  features: { playground: boolean; speedruns: boolean; races: boolean };
}

const DESKTOP: SiteInfo = { mode: "desktop", site_url: null, features: { playground: false, speedruns: false, races: false } };

/** Desktop app or website. Anything unclear (offline, an older service) counts as the desktop app. */
export async function getSite(): Promise<SiteInfo> {
  try {
    return IN_BRIDGE ? await invoke<SiteInfo>("site") : await (await call("/api/site")).json();
  } catch {
    return DESKTOP;
  }
}

export interface PartLibrary {
  symbols: Record<string, import("../lab/scene").LibSymbol>;
  kinds: { kind: string; lib_id: string; prefix: string; description: string; default_value: string }[];
  power: Record<string, string>; // net -> lib_id
}

let libraryCache: Promise<PartLibrary> | null = null;

/** Every part and power symbol with its drawing (fetched once). */
export function getLibrary(): Promise<PartLibrary> {
  libraryCache ??= (IN_BRIDGE ? invoke<PartLibrary>("library") : call("/api/library").then((r) => r.json())).catch((e) => {
    libraryCache = null;
    throw e;
  });
  return libraryCache;
}

export interface LeaderboardEntry {
  name: string;
  time_ms: number;
  score: number;
  at: number;
}

export async function getLeaderboard(challenge: string): Promise<LeaderboardEntry[]> {
  return (await call(`/api/leaderboard?challenge=${encodeURIComponent(challenge)}`)).json();
}

/** The live race connection (website only). */
export function raceSocket(name: string): WebSocket {
  const base = ENGINE_URL || `${location.protocol}//${location.host}`;
  return new WebSocket(`${base.replace(/^http/, "ws")}/api/race/ws?name=${encodeURIComponent(name)}`);
}
