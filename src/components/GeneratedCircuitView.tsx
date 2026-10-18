import { useEffect, useState } from "react";
import { Check, Cpu, Loader2, TriangleAlert } from "lucide-react";
import {
  fetchGeneratedSvg,
  generateCircuit,
  NotConnectedError,
  RequestError,
  saveGenerated,
  SERVICE_DOWN,
  type GeneratedCircuit,
  type SavedCircuit,
} from "../api/client";
import { Modal } from "./Panels";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; circuit: GeneratedCircuit; svgUrl: string | null; svgError: string | null }
  | { kind: "declined"; message: string }
  | { kind: "down" }
  | { kind: "error"; message: string };

type Open = { kind: "idle" } | { kind: "opening" } | { kind: "opened"; saved: SavedCircuit } | { kind: "saved"; saved: SavedCircuit } | { kind: "error"; message: string };

interface Props {
  prompt: string;
  onClose: () => void;
  /** Report what happened, for the activity log. */
  onLog: (kind: "info" | "success" | "warn" | "error", text: string) => void;
}

/**
 * Shows what POST /api/generate built for a prompt (parts, ERC, KiCad's drawing),
 * and opens it in KiCad with POST /api/generate/save.
 */
export function GeneratedCircuitView({ prompt, onClose, onLog }: Props) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [open, setOpen] = useState<Open>({ kind: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    (async () => {
      try {
        // The circuit and its drawing are independent: a failed drawing shouldn't hide the parts list.
        const [circuit, svg] = await Promise.allSettled([generateCircuit(prompt, controller.signal), fetchGeneratedSvg(prompt, controller.signal)]);
        if (controller.signal.aborted) return;
        if (circuit.status === "rejected") throw circuit.reason;
        if (svg.status === "fulfilled") url = URL.createObjectURL(new Blob([svg.value], { type: "image/svg+xml" }));
        setLoad({
          kind: "ready",
          circuit: circuit.value,
          svgUrl: url,
          svgError: svg.status === "rejected" ? (svg.reason as Error).message : null,
        });
        onLog("success", `generated ${circuit.value.title}`);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (e instanceof NotConnectedError) {
          setLoad({ kind: "down" });
          onLog("warn", "engine not running");
        } else if (e instanceof RequestError && e.status === 422) {
          setLoad({ kind: "declined", message: e.message });
          onLog("warn", "engine can't build that");
        } else {
          setLoad({ kind: "error", message: (e as Error).message });
          onLog("error", (e as Error).message);
        }
      }
    })();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
    // onLog is stable (useCallback in App); the prompt is fixed for the lifetime of this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  const openInKicad = async () => {
    setOpen({ kind: "opening" });
    try {
      const saved = await saveGenerated(prompt, true);
      setOpen({ kind: saved.openedInKicad ? "opened" : "saved", saved });
      onLog(saved.openedInKicad ? "success" : "warn", saved.openedInKicad ? `opened in kicad: ${saved.schematicPath}` : (saved.openError ?? `saved ${saved.schematicPath}`));
    } catch (e) {
      const message = e instanceof NotConnectedError ? `The engine is not running. ${SERVICE_DOWN}` : (e as Error).message;
      setOpen({ kind: "error", message });
      onLog("warn", message);
    }
  };

  const ready = load.kind === "ready";
  const footer = (
    <button className="btn" onClick={openInKicad} disabled={!ready || open.kind === "opening"}>
      {open.kind === "opening" ? <Loader2 size={14} className="spin" /> : open.kind === "opened" ? <Check size={14} /> : <Cpu size={14} />}
      {open.kind === "opening" ? "opening…" : open.kind === "opened" ? "opened in kicad" : "open in kicad"}
    </button>
  );

  return (
    <Modal title="generated circuit" wide onClose={onClose} footer={footer}>
      <div className="gen-view">
        <div className="gen-prompt">
          <span className="caret">&gt;</span> {prompt}
        </div>

        {open.kind === "opened" && (
          <div className="gen-msg-ok">
            <Check size={13} /> Opened in KiCad. Saved to <code>{open.saved.schematicPath}</code>
          </div>
        )}
        {open.kind === "saved" && (
          <div className="gen-msg-err">
            <TriangleAlert size={13} /> Saved to <code>{open.saved.schematicPath}</code>, but KiCad did not open: {open.saved.openError ?? "unknown reason"}
          </div>
        )}
        {open.kind === "error" && (
          <div className="gen-msg-err">
            <TriangleAlert size={13} /> {open.message}
          </div>
        )}

        {load.kind === "loading" && (
          <div className="sheet-note">
            <Loader2 size={14} className="spin" /> Building it and checking it with KiCad…
          </div>
        )}
        {load.kind === "down" && <div className="gen-msg-err">The engine is not running. {SERVICE_DOWN}</div>}
        {load.kind === "error" && <div className="gen-msg-err">{load.message}</div>}
        {load.kind === "declined" && <pre className="gen-msg-err gen-declined">{load.message}</pre>}

        {load.kind === "ready" && (
          <>
            <div className="gen-title">
              <b>{load.circuit.title}</b>
              <span className={`gen-erc ${load.circuit.erc.ran ? (load.circuit.erc.passed ? "ok" : "bad") : "warn"}`}>
                {load.circuit.erc.ran ? (load.circuit.erc.passed ? "✓ ERC passes" : "✗ ERC found problems") : "ERC not run"}
              </span>
            </div>
            <p className="dim gen-desc">{load.circuit.description}</p>

            <div className="sheet">
              {load.svgUrl ? <img className="sch-img" src={load.svgUrl} alt={`KiCad schematic: ${load.circuit.title}`} /> : <div className="sheet-note bad">{load.svgError ?? "No drawing available."}</div>}
            </div>

            <div className="kv parts">
              {load.circuit.components.map((c) => (
                <span key={c.ref} className="contents">
                  <span>{c.ref}</span>
                  <span>{c.value}</span>
                  <span className="dim">{c.purpose}</span>
                </span>
              ))}
            </div>
            {load.circuit.notes.length > 0 && (
              <ul className="gen-notes">
                {load.circuit.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {load.circuit.erc.problems.length > 0 && (
              <ul className="gen-notes bad">
                {load.circuit.erc.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </>
        )}

      </div>
    </Modal>
  );
}
