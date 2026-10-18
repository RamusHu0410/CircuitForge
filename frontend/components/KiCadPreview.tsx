import { useEffect, useRef, useState } from "react";
import type { Project } from "../types";
import { previewSvg } from "../api/client";
import { cropSvg } from "../lib/svg";

/** The real KiCad drawing of a generated circuit (rendered by kicad-cli on the backend), cropped to the circuit. */
export function KiCadPreview({ files }: { files: NonNullable<Project["files"]> }) {
  const [state, setState] = useState<{ svg?: string; error?: string }>({});
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    previewSvg(files)
      .then((svg) => alive && setState({ svg }))
      .catch((e) => alive && setState({ error: (e as Error).message }));
    return () => {
      alive = false;
    };
  }, [files]);
  useEffect(() => {
    const svg = box.current?.querySelector("svg");
    if (svg) cropSvg(svg);
  }, [state.svg]);
  if (state.error) return <div className="preview-msg bad">{state.error}</div>;
  if (!state.svg) return <div className="preview-msg dim">drawing with KiCad…</div>;
  // The SVG comes from kicad-cli on our own backend, rendered from files it generated.
  return <div ref={box} className="kicad-svg" role="img" aria-label="Generated schematic, drawn by KiCad" dangerouslySetInnerHTML={{ __html: state.svg }} />;
}

