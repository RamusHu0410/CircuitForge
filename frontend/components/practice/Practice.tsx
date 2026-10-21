import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Box, Check, CircuitBoard, Loader2, PenTool, Power, Star, Trophy, X } from "lucide-react";
import type { Level, Project } from "../../types";
import { buildLayout, buildNetlist, emptyBuild, type Build, type Look } from "../../lab/build";
import { checkBuild, type CheckResult } from "../../lab/check";
import { EXERCISES, type Exercise, type PracticeMode } from "../../lab/exercises";
import { kindInfo } from "../../lab/knowledge";
import { layoutFromScene, netlistFromScene, type Scene } from "../../lab/scene";
import { Circuit3D } from "../lab/Lazy3D";
import { Lab } from "../lab/Lab";
import { Schematic2D } from "../lab/Schematic2D";
import type { Selection } from "../lab/types";
import { Builder } from "./Builder";
import "./practice.css";

const DONE_KEY = "circuitforge.practice";

function loadDone(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

interface Props {
  generate: (prompt: string) => Promise<Project>;
  level: Level;
  onClose: () => void;
}

const MODES: { id: PracticeMode; title: string; text: string; icon: React.ReactNode }[] = [
  { id: "build", title: "Schematic → circuit", text: "You get the drawing. Pick up the real parts and wire them so they match. Mind which leg is which.", icon: <CircuitBoard size={20} /> },
  { id: "draw", title: "Circuit → schematic", text: "You get the real circuit in 3D. Turn it around, work out what's connected to what, and draw its schematic.", icon: <PenTool size={20} /> },
];

/** The target shown on the left, with a one-line "what is this?" when you click something. */
function Target({ scene, mode }: { scene: Scene; mode: PracticeMode }) {
  const layout = useMemo(() => layoutFromScene(scene), [scene]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const live = useMemo(() => ({ current: { result: null, flow: null } }), []);
  const props = {
    layout,
    result: null,
    flow: null,
    selection,
    onSelect: setSelection,
    electrons: true,
    showFlow: false,
    showVolts: false,
    focus: null,
    tourDot: null,
    pressed: {},
    onPress: () => {},
  };
  const comp = selection && "ref" in selection && selection.ref ? scene.components.find((c) => c.ref === selection.ref) : null;
  const pin = selection?.kind === "pin" && comp ? kindInfo(comp.kind).pin(selection.pin, scene.library[comp.lib_id].pins.find((p) => p.number === selection.pin)?.name ?? "") : null;
  return (
    <div className="target">
      <div className="target-view">{mode === "build" ? <Schematic2D scene={scene} {...props} /> : <Circuit3D {...props} live={live} values={{}} wipers={{}} />}</div>
      <div className="target-info">
        {comp ? (
          <>
            <b>
              {comp.ref} · {kindInfo(comp.kind).name}
            </b>{" "}
            {comp.value.replace(/_/g, " ")}
            {pin && <> — {pin.title}: {pin.text}</>}
          </>
        ) : (
          <span className="dim">{mode === "build" ? "Click a symbol to see what part it is." : "Drag to turn it around. Click a part to see what it is."}</span>
        )}
      </div>
    </div>
  );
}

export function Practice({ generate, level, onClose }: Props) {
  const [mode, setMode] = useState<PracticeMode>("build");
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [build, setBuild] = useState<Build>(emptyBuild);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [powered, setPowered] = useState(false);
  const [done, setDone] = useState(loadDone);

  const look: Look = mode === "build" ? "physical" : "schematic";
  const scene = project?.scene;
  const target = useMemo(() => (scene ? netlistFromScene(scene) : null), [scene]);

  const start = async (ex: Exercise, m: PracticeMode) => {
    setMode(m);
    setExercise(ex);
    setProject(null);
    setBuild(emptyBuild());
    setResult(null);
    setPowered(false);
    setError(null);
    setLoading(true);
    try {
      const p = await generate(ex.prompt);
      if (!p.scene) throw new Error("This circuit has no drawing data.");
      setProject(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const check = () => {
    if (!target) return;
    const r = checkBuild(target, buildNetlist(build, target));
    setResult(r);
    if (r.ok && exercise) {
      const next = { ...done, [`${exercise.id}:${mode}`]: true };
      setDone(next);
      try {
        localStorage.setItem(DONE_KEY, JSON.stringify(next));
      } catch {
        /* progress just won't persist */
      }
    }
  };

  const total = EXERCISES.length * 2;
  const count = Object.values(done).filter(Boolean).length;

  return (
    <motion.div className="practice" role="dialog" aria-modal="true" aria-label="Practice" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
      <header className="pr-head">
        {exercise ? (
          <button className="btn" onClick={() => setExercise(null)}>
            <ArrowLeft size={14} /> exercises
          </button>
        ) : (
          <span className="pr-badge">
            <Trophy size={14} /> {count}/{total}
          </span>
        )}
        <div className="pr-title">
          <span className="eyebrow">PRACTICE{exercise ? ` · ${MODES.find((m) => m.id === mode)!.title.toUpperCase()}` : ""}</span>
          <h1>{exercise ? exercise.title : "Learn by doing"}</h1>
        </div>
        <button className="icon-btn pr-close" onClick={onClose} aria-label="Close practice">
          <X size={18} />
        </button>
      </header>

      {!exercise && (
        <div className="pr-pick">
          <div className="pr-modes">
            {MODES.map((m) => (
              <button key={m.id} className={`pr-mode${mode === m.id ? " on" : ""}`} onClick={() => setMode(m.id)}>
                <span className="pr-mode-icon">{m.icon}</span>
                <b>{m.title}</b>
                <span>{m.text}</span>
              </button>
            ))}
          </div>
          <div className="pr-list">
            {EXERCISES.map((ex) => {
              const finished = done[`${ex.id}:${mode}`];
              return (
                <button key={ex.id} className={`pr-ex${finished ? " done" : ""}`} onClick={() => start(ex, mode)}>
                  <span className="pr-stars" aria-label={`difficulty ${ex.level} of 3`}>
                    {[1, 2, 3].map((i) => (
                      <Star key={i} size={12} fill={i <= ex.level ? "currentColor" : "none"} />
                    ))}
                  </span>
                  <b>
                    {ex.title} {finished && <Check size={14} />}
                  </b>
                  <span className="dim">{ex.idea}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {exercise && (
        <div className="pr-work">
          {loading && (
            <div className="pr-loading">
              <Loader2 size={18} className="spin" /> building the circuit…
            </div>
          )}
          {error && (
            <div className="pr-loading bad">
              Couldn't build this exercise: {error}
              <button className="btn" onClick={() => start(exercise, mode)}>
                try again
              </button>
            </div>
          )}
          {scene && target && (
            <>
              <section className="pr-pane">
                <h3>{mode === "build" ? "The schematic" : "The circuit"}</h3>
                <Target scene={scene} mode={mode} />
              </section>
              <section className="pr-pane">
                <h3>{mode === "build" ? "Your circuit" : "Your schematic"}</h3>
                <Builder look={look} scene={scene} target={target} build={build} onChange={(b) => (setBuild(b), setResult(null))} />
                <div className="pr-check">
                  <button className="btn primary-btn" onClick={check} disabled={!build.parts.length}>
                    <Check size={14} /> check my {mode === "build" ? "circuit" : "schematic"}
                  </button>
                  {result && (
                    <div className={`pr-result${result.ok ? " ok" : ""}`}>
                      <div className="pr-meter">
                        <span style={{ width: `${(result.right / Math.max(1, result.total)) * 100}%` }} />
                      </div>
                      {result.ok ? (
                        <div className="pr-win">
                          <b>It's right: every connection matches.</b>
                          <button className="btn primary-btn" onClick={() => setPowered(true)}>
                            <Power size={14} /> {mode === "build" ? "switch on your circuit" : "see the real one run"}
                          </button>
                        </div>
                      ) : (
                        <>
                          <b>
                            {result.right} of {result.total} connections right
                          </b>
                          <ul>
                            {result.hints.map((h) => (
                              <li key={h}>{h}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {powered && scene && target && (
        <div className="pr-lab">
          <header>
            <b>
              <Box size={14} /> {mode === "build" ? "Your circuit, switched on" : `${exercise?.title}, running`}
            </b>
            <button className="icon-btn" onClick={() => setPowered(false)} aria-label="Close">
              <X size={16} />
            </button>
          </header>
          {mode === "build" ? (
            <Lab layout={buildLayout(build, "physical", scene, target)} netlist={buildNetlist(build, target)} level={level} jumpers initialView="3d" />
          ) : (
            <Lab scene={scene} firmware={project?.firmware?.code} level={level} />
          )}
        </div>
      )}
    </motion.div>
  );
}
