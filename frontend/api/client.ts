import type { Firmware, Project } from "../types";
import type { DesktopInfo, GenerateResponse, SchematicFiles } from "./backend";
import { toProject } from "./mapping";

/**
 * Talks to the local CircuitForge backend (kicad-ai-extension/backend).
 *
 * In the desktop window the UI is served by the backend itself, so all paths are
 * same-origin ("/api/..."). In `npm run dev`, Vite proxies /api to 127.0.0.1:8765.
 * VITE_ENGINE_URL can point somewhere else if needed.
 */
export const ENGINE_URL: string = import.meta.env.VITE_ENGINE_URL ?? "";

export class NotConnectedError extends Error {
  constructor(what = "The CircuitForge backend") {
    super(`${what} isn't running. Start it with: uvicorn app.main:app --port 8765`);
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
  const res = await call("/api/generate", { json: { prompt } });
  return toProject((await res.json()) as GenerateResponse);
}

export async function getDesktopInfo(): Promise<DesktopInfo> {
  return (await call("/api/desktop/info")).json();
}

/** KiCad's own SVG rendering of the generated schematic. */
export async function previewSvg(files: SchematicFiles): Promise<string> {
  return (await call("/api/desktop/preview", { json: files })).text();
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
  return (await call("/api/desktop/save", { json: { files, firmware: firmware ?? null, open_in_kicad: true, open_as: openAs } })).json();
}

export interface ExportResult {
  folder: string;
  files: string[];
  skipped: string[];
  reveal_error: string | null;
}

/** Export the schematic as pictures (SVG, PDF, PNG), the code, and the KiCad project; opens the folder. */
export async function exportDesign(files: SchematicFiles, firmware: Firmware | undefined, pngDataUrl: string | null): Promise<ExportResult> {
  return (await call("/api/desktop/export", { json: { files, firmware: firmware ?? null, png_base64: pngDataUrl } })).json();
}

/** Copy the circuit so it can be pasted (Cmd/Ctrl+V) into the schematic that's open in KiCad. */
export async function placeInSchematic(files: SchematicFiles): Promise<{ copied: boolean; symbols: number; message: string }> {
  return (await call("/api/desktop/place", { json: files })).json();
}
