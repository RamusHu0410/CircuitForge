import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Box, Columns2, Pause, Play, RotateCcw, Square, Waves, X, Zap } from "lucide-react";
import type { Level } from "../../types";
import { layoutFromScene, netlistFromScene, type Layout, type Netlist, type Pt, type Scene } from "../../lab/scene";
import { buildTour, type TourStep } from "../../lab/tour";
import { useLabSim } from "../../lab/useLab";
import { Circuit3D } from "./Lazy3D";
import { Inspector } from "./Inspector";
import { Schematic2D } from "./Schematic2D";
import { CURRENT, ELECTRON, type Focus, type Selection } from "./types";
import "./lab.css";

type View = "2d" | "3d" | "split";

interface Props {
  /** A generated circuit (2D + 3D), or a layout + netlist from the practice builder (3D only). */
  scene?: Scene;
  layout?: Layout;
  netlist?: Netlist;
  firmware?: string;
  level: Level;
  summary?: string;
  initialView?: View;
  /** Practice builds use jumper wires instead of traces. */
  jumpers?: boolean;
  /** Select this part when the lab opens (e.g. from a classroom section). */
  focusRef?: string | null;
}

const SPEEDS: { label: string; value: number | null }[] = [
  { label: "auto", value: null },
  { label: "1×", value: 1 },
  { label: "1/10×", value: 0.1 },
  { label: "1/100×", value: 0.01 },
  { label: "1/1000×", value: 0.001 },
];

function pointAlong(path: Pt[], f: number): Pt {
  const lens = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
  const total = lens.reduce((a, b) => a + b, 0);
  let d = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? Math.min(1, d / lens[i]) : 1;
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k];
    }
    d -= lens[i];
  }
  return path[path.length - 1];
}

const pathLength = (path: Pt[]) => path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);

export function Lab({ scene, layout: layoutIn, netlist: netlistIn, firmware, level, summary, initialView, jumpers, focusRef }: Props) {
  const layout = useMemo(() => layoutIn ?? layoutFromScene(scene!), [layoutIn, scene]);
  const netlist = useMemo(() => netlistIn ?? netlistFromScene(scene!), [netlistIn, scene]);
  const sim = useLabSim(netlist, layout, firmware);
  const [view, setView] = useState<View>(initialView ?? (scene ? "split" : "3d"));
  const [selection, setSelection] = useState<Selection | null>(focusRef ? { kind: "part", ref: focusRef } : null);
  const [electrons, setElectrons] = useState(true);
  const [showFlow, setShowFlow] = useState(true);
  const [showVolts, setShowVolts] = useState(false);
  const [tour, setTour] = useState<{ steps: TourStep[]; i: number } | null>(null);
  const [tourDot, setTourDot] = useState<Pt | null>(null);
  const [autoplay, setAutoplay] = useState(true);
  const [tourEmpty, setTourEmpty] = useState(false);

  useEffect(() => {
    if (focusRef) setSelection({ kind: "part", ref: focusRef });
  }, [focusRef]);

  const press = useCallback((ref: string, down: boolean) => sim.update((c) => ({ ...c, pressed: { ...c.pressed, [ref]: down } })), [sim]);
  const select = useCallback((s: Selection | null) => setSelection(s), []);

  const startTour = () => {
    const steps = sim.result ? buildTour(layout, sim.result) : [];
    if (!steps.length) {
      setTourEmpty(true);
      window.setTimeout(() => setTourEmpty(false), 4000);
      return;
    }
    setElectrons(true);
    setTour({ steps, i: 0 });
  };

  // Move the tour's electron along the current step's path, then on to the next step.
  const tourRef = useRef(tour);
  tourRef.current = tour;
  useEffect(() => {
    if (!tour) {
      setTourDot(null);
      return;
    }
    const step = tour.steps[tour.i];
    const len = pathLength(step.path);
    const duration = Math.max(0.9, Math.min(3.5, len / 18)) * 1000;
    const start = performance.now();
    const cleanups: (() => void)[] = [];
    let raf = 0;
    let advanced = false;
    const tick = (now: number) => {
      const f = Math.min(1, (now - start) / duration);
      setTourDot(step.jump && f > 0.5 ? step.path[step.path.length - 1] : step.jump ? step.path[0] : pointAlong(step.path, f));
      if (f < 1) raf = requestAnimationFrame(tick);
      else if (autoplay && !advanced) {
        advanced = true;
        const read = Math.min(9000, 2200 + step.text.length * 28);
        const t = window.setTimeout(() => {
          const cur = tourRef.current;
          if (cur && cur.steps === tour.steps && cur.i === tour.i && cur.i < cur.steps.length - 1) setTour({ ...cur, i: cur.i + 1 });
        }, read);
        cleanups.push(() => window.clearTimeout(t));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      cleanups.forEach((c) => c());
    };
  }, [tour, autoplay]);

  const focus: Focus | null = useMemo(() => {
    if (!tour) return null;
    const step = tour.steps[tour.i];
    const refs = new Set<string>();
    const nets = new Set<string>();
    if (step.ref) {
      refs.add(step.ref);
      const part = layout.parts.find((p) => p.ref === step.ref);
      part?.pins.forEach((p) => p.net && nets.add(p.net));
    }
    if (step.net) {
      nets.add(step.net);
      layout.parts.forEach((p) => p.pins.some((q) => q.net === step.net) && refs.add(p.ref));
    }
    if (!step.ref && !step.net) return null;
    return { refs, nets };
  }, [tour, layout]);

  const viewProps = {
    layout,
    result: sim.result,
    flow: sim.flow,
    selection,
    onSelect: select,
    electrons,
    showFlow,
    showVolts,
    focus,
    tourDot,
    pressed: sim.controls.pressed,
    onPress: press,
  };

  const step = tour ? tour.steps[tour.i] : null;
  const speedLabel = sim.speed === null ? `auto${sim.dynamic && sim.effectiveSpeed < 1 ? ` (${sim.effectiveSpeed >= 0.01 ? `1/${Math.round(1 / sim.effectiveSpeed)}` : "slow"}×)` : ""}` : SPEEDS.find((s) => s.value === sim.speed)?.label;

  return (
    <div className="lab">
      <div className="lab-bar" role="toolbar" aria-label="Lab view">
        {scene && (
          <div className="seg-row">
            <button className={`seg${view === "2d" ? " on" : ""}`} onClick={() => setView("2d")}>
              <Square size={13} /> 2D
            </button>
            <button className={`seg${view === "3d" ? " on" : ""}`} onClick={() => setView("3d")}>
              <Box size={13} /> 3D
            </button>
            <button className={`seg${view === "split" ? " on" : ""}`} onClick={() => setView("split")}>
              <Columns2 size={13} /> both
            </button>
          </div>
        )}
        <div className="seg-row">
          <button className={`seg${electrons ? " on" : ""}`} onClick={() => setElectrons(true)} title="Electrons: negative, they flow from − to +">
            <span className="swatch-dot" style={{ background: ELECTRON }} /> electrons
          </button>
          <button className={`seg${!electrons ? " on" : ""}`} onClick={() => setElectrons(false)} title="Conventional current: drawn from + to −">
            <span className="swatch-dot" style={{ background: CURRENT }} /> current
          </button>
        </div>
        <button className={`seg solo${showFlow ? " on" : ""}`} onClick={() => setShowFlow(!showFlow)} aria-pressed={showFlow}>
          <Waves size={13} /> flow
        </button>
        <button className={`seg solo${showVolts ? " on" : ""}`} onClick={() => setShowVolts(!showVolts)} aria-pressed={showVolts} title="Colour wires by voltage">
          <span className="volt-grad" /> voltage
        </button>
        {sim.dynamic && (
          <div className="seg-row time">
            <button className="seg" onClick={() => sim.setPaused(!sim.paused)} aria-label={sim.paused ? "Play" : "Pause"}>
              {sim.paused ? <Play size={13} /> : <Pause size={13} />}
            </button>
            <select value={String(sim.speed)} onChange={(e) => sim.setSpeed(e.target.value === "null" ? null : Number(e.target.value))} aria-label="Simulation speed" title="How fast circuit time runs">
              {SPEEDS.map((s) => (
                <option key={s.label} value={String(s.value)}>
                  {s.value === null ? speedLabel : s.label}
                </option>
              ))}
            </select>
            <button className="seg" onClick={sim.restart} title="Switch the power off and on again">
              <RotateCcw size={13} />
            </button>
          </div>
        )}
        <span className="lab-spacer" />
        {sim.result && !sim.result.ok && <span className="lab-warn">the simulation is struggling with this circuit</span>}
        <button className="btn tour-start" onClick={tour ? () => setTour(null) : startTour}>
          <Zap size={14} /> {tour ? "stop the tour" : "follow an electron"}
        </button>
      </div>

      <div className={`lab-views ${view}`}>
        {scene && view !== "3d" && <Schematic2D scene={scene} {...viewProps} />}
        {view !== "2d" && <Circuit3D {...viewProps} live={sim.live} values={sim.controls.overrides} wipers={sim.controls.wiper} jumpers={jumpers} />}
        {tourEmpty && <div className="lab-toast">No current is flowing right now, so there's no loop to follow. Press a button, switch on an output, or raise an input first.</div>}
      </div>

      <aside className="lab-side">
        <Inspector selection={selection} onSelect={select} netlist={netlist} layout={layout} result={sim.result} controls={sim.controls} update={sim.update} level={level} summary={summary} onTour={startTour} />
      </aside>

      {tour && step && (
        <div className="lab-tour" role="region" aria-label="Follow an electron">
          <div className="tour-count">
            {tour.i + 1}/{tour.steps.length}
          </div>
          <div className="tour-text">
            <b>{step.title}</b>
            <p>{step.text}</p>
          </div>
          <div className="tour-ctl">
            <button className="icon-btn" disabled={tour.i === 0} onClick={() => setTour({ ...tour, i: tour.i - 1 })} aria-label="Previous step">
              <ArrowLeft size={15} />
            </button>
            <button className="icon-btn" onClick={() => setAutoplay(!autoplay)} aria-label={autoplay ? "Pause the tour" : "Play the tour"} title={autoplay ? "pause" : "play"}>
              {autoplay ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button className="icon-btn" disabled={tour.i === tour.steps.length - 1} onClick={() => setTour({ ...tour, i: tour.i + 1 })} aria-label="Next step">
              <ArrowRight size={15} />
            </button>
            <button className="icon-btn" onClick={() => setTour(null)} aria-label="Close the tour">
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
