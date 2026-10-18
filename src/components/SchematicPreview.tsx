import { useEffect, useState } from "react";
import { fetchSchematicSvg, NotConnectedError, SERVICE_DOWN } from "../api/client";
import type { Project } from "../types";
import { Schematic } from "./Schematic";

type State = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error"; message: string };

/**
 * The schematic preview.
 * The bundled example keeps its hand-drawn, interactive drawing. A generated project shows KiCad's own
 * drawing of exactly what will be written, so the preview and the file in KiCad always match.
 * The SVG is shown through <img>, which never runs scripts, whatever the file contains.
 */
export function SchematicPreview({ project, isExample }: { project: Project; isExample: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const paramsKey = JSON.stringify(project.params);

  useEffect(() => {
    if (isExample) return;
    const controller = new AbortController();
    let url: string | null = null;
    setState({ kind: "loading" });
    fetchSchematicSvg(project, controller.signal)
      .then((svg) => {
        url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        setState({ kind: "ready", url });
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setState({ kind: "error", message: e instanceof NotConnectedError ? `The engine is not running. ${SERVICE_DOWN}` : e.message });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
    // The drawing depends only on the design values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExample, paramsKey]);

  if (isExample) return <Schematic />;
  if (state.kind === "loading") return <div className="sheet-note">Drawing the schematic with KiCad…</div>;
  if (state.kind === "error") return <div className="sheet-note bad">{state.message}</div>;
  return <img className="sch-img" src={state.url} alt={`KiCad schematic: ${project.name}`} />;
}
