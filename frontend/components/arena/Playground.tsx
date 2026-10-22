import { useEffect, useMemo, useState } from "react";
import { Play, Star, Trash2, X } from "lucide-react";
import type { Level } from "../../types";
import type { PartLibrary } from "../../api/client";
import { buildNetlist, emptyBuild, sceneFromBuild, type Build } from "../../lab/build";
import { rateCircuit, type Rating } from "../../lab/rate";
import { Lab } from "../lab/Lab";
import { Editor, STARTER_SKETCH } from "./Editor";
import { RatingReport } from "./RatingReport";

const SAVE_KEY = "circuitforge.playground";

function load(): { build: Build; code: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null");
    if (saved && Array.isArray(saved.build?.parts)) return saved;
  } catch {
    /* nothing saved, or storage unavailable */
  }
  return { build: emptyBuild(), code: "" };
}

export function Playground({ library, level }: { library: PartLibrary; level: Level }) {
  const [initial] = useState(load);
  const [build, setBuild] = useState<Build>(initial.build);
  const [code, setCode] = useState(initial.code);
  const [rating, setRating] = useState<{ rating: Rating; stale: boolean } | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ build, code }));
    } catch {
      /* the work just won't be kept */
    }
    setRating((r) => (r ? { ...r, stale: true } : r));
  }, [build, code]);

  const hasBoard = build.parts.some((p) => p.kind.startsWith("arduino"));
  const firmware = hasBoard ? code || STARTER_SKETCH : undefined;
  const netlist = useMemo(() => buildNetlist(build, library.symbols), [build, library]);
  const scene = useMemo(() => (running ? sceneFromBuild(build, library.symbols) : null), [running, build, library]);

  return (
    <div className="playground">
      <div className="pg-bar">
        <button className="btn primary-btn" disabled={!build.parts.length} onClick={() => setRunning(true)}>
          <Play size={14} /> run it
        </button>
        <button className="btn" disabled={!build.parts.length} onClick={() => setRating({ rating: rateCircuit(netlist, firmware), stale: false })}>
          <Star size={14} /> rate my circuit
        </button>
        <span className="lab-spacer" />
        <span className="dim small">
          {build.parts.length} parts · {build.wires.length} wires · saved in this browser
        </span>
        <button
          className="btn"
          disabled={!build.parts.length}
          onClick={() => {
            if (window.confirm("Clear the playground? This removes every part and wire.")) {
              setBuild(emptyBuild());
              setCode("");
              setRating(null);
            }
          }}
        >
          <Trash2 size={14} /> clear
        </button>
      </div>
      <div className="pg-body">
        <Editor library={library} build={build} onBuild={setBuild} code={code} onCode={setCode} />
        <aside className="pg-side">
          {rating ? (
            <>
              {rating.stale && (
                <button className="stale" onClick={() => setRating({ rating: rateCircuit(netlist, firmware), stale: false })}>
                  You changed the circuit: rate it again
                </button>
              )}
              <RatingReport rating={rating.rating} />
            </>
          ) : (
            <div className="pg-help">
              <h3>Build anything</h3>
              <ol>
                <li>Pick parts on the left; drag them into place, <kbd>R</kbd> to rotate.</li>
                <li>Click a pin, then another pin, to wire them.</li>
                <li>Give every circuit a supply: a battery, or power symbols like +5V and GND.</li>
                <li>
                  <b>Run it</b> to watch it work in 2D and on a breadboard in 3D. With an Arduino, your code runs too.
                </li>
                <li>
                  <b>Rate it</b> for safety, efficiency, cost and better parts, like a design review.
                </li>
              </ol>
            </div>
          )}
        </aside>
      </div>
      {running && scene && (
        <div className="pr-lab">
          <header>
            <b>Your circuit, running</b>
            <button className="icon-btn" onClick={() => setRunning(false)} aria-label="Close">
              <X size={16} />
            </button>
          </header>
          <Lab scene={scene} netlist={netlist} firmware={firmware} level={level} />
        </div>
      )}
    </div>
  );
}
