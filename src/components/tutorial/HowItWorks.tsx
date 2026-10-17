import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MousePointerClick, Pause, Play, RotateCcw } from "lucide-react";
import type { Project } from "../../types";
import { LOGIC, fmtSI, ledDesign, tau } from "../../math";
import { PART_INFO, TOUR, type PartId, type SimPhase } from "../../data/tutorial";
import { Circuit, anchorPct, type FlowId } from "./Circuit";
import { AnimatedNumber, Panel } from "./ui";

/** Release decay is ~1 ms in real life; we show it this many times slower. */
const SLOW = 600;

const ROLE_LABEL = { controller: "controller", input: "input", output: "output", passive: "passive", power: "power" };

/* ---------- oscilloscope: plots V(D2) over time ---------- */

function Scope({ getV, vMax }: { getV: () => number; vMax: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const samples = useRef<number[]>([]);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return; // ~30 fps is plenty for a scope
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = samples.current;
      s.push(getV());
      if (s.length > 180) s.shift(); // 6 s of history at 30 fps
      ctx.clearRect(0, 0, w, h);
      const y = (v: number) => h - 6 - (v / vMax) * (h - 14);
      // grid
      ctx.strokeStyle = "rgba(41,39,36,0.07)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo((w / 6) * i, 0);
        ctx.lineTo((w / 6) * i, h);
        ctx.stroke();
      }
      // thresholds
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(57,133,104,0.7)";
      ctx.beginPath();
      ctx.moveTo(0, y(vMax * LOGIC.vihFraction));
      ctx.lineTo(w, y(vMax * LOGIC.vihFraction));
      ctx.stroke();
      ctx.strokeStyle = "rgba(201,79,79,0.7)";
      ctx.beginPath();
      ctx.moveTo(0, y(vMax * LOGIC.vilFraction));
      ctx.lineTo(w, y(vMax * LOGIC.vilFraction));
      ctx.stroke();
      ctx.setLineDash([]);
      // trace
      ctx.strokeStyle = "#238C83";
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const step = w / 179;
      const off = 180 - s.length;
      s.forEach((v, i) => (i === 0 ? ctx.moveTo((i + off) * step, y(v)) : ctx.lineTo((i + off) * step, y(v))));
      ctx.stroke();
      // head
      const lastV = s[s.length - 1];
      ctx.fillStyle = "#238C83";
      ctx.beginPath();
      ctx.arc(w - 1, y(lastV), 3, 0, Math.PI * 2);
      ctx.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getV, vMax]);

  return (
    <div className="scope">
      <canvas ref={canvas} />
      <span className="scope-l hi">3 V · HIGH</span>
      <span className="scope-l lo">1.5 V · LOW</span>
    </div>
  );
}

/* ---------- page ---------- */

export function HowItWorks({ project, onComplete }: { project: Project; onComplete: () => void }) {
  const P = project.params;
  const iLed = ledDesign(P.supply, P.ledVf, P.ledTargetMa, P.ledResistor).current;
  const tc = tau(P.pullDown, P.debounceCapNf);

  const [phase, setPhase] = useState<SimPhase>("idle");
  const [v, setV] = useState(0);
  const [reading, setReading] = useState<"LOW" | "HIGH">("LOW");
  const [step, setStep] = useState<number | null>(0);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState<PartId | null>(null);
  const [selected, setSelected] = useState<PartId | null>(null);
  const vRef = useRef(0);
  const releaseAt = useRef(0);
  const timers = useRef<number[]>([]);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const press = useCallback(() => {
    vRef.current = P.supply;
    setV(P.supply);
    setReading("HIGH");
    setPhase("pressed");
  }, [P.supply]);

  const release = useCallback(() => {
    releaseAt.current = performance.now();
    setPhase((p) => (p === "pressed" ? "releasing" : p));
  }, []);

  const reset = useCallback(() => {
    vRef.current = 0;
    setV(0);
    setReading("LOW");
    setPhase("idle");
  }, []);

  // Release: C1 discharges through R2, v(t) = Vs·e^(−t/τ), shown SLOW× slower.
  useEffect(() => {
    if (phase !== "releasing") return;
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - releaseAt.current) / 1000 / SLOW;
      const nv = P.supply * Math.exp(-t / tc);
      vRef.current = nv;
      setV(nv);
      if (nv <= P.supply * LOGIC.vilFraction) setReading("LOW");
      if (nv < 0.02) {
        vRef.current = 0;
        setV(0);
        setPhase("idle");
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, P.supply, tc]);

  const goStep = useCallback(
    (i: number) => {
      clearTimers();
      setStep(i);
      const s = TOUR[i];
      if (s.phase === "idle") reset();
      else if (s.phase === "pressed") press();
      else {
        press();
        timers.current.push(window.setTimeout(release, 500));
      }
      if (i === TOUR.length - 1) completeRef.current();
    },
    [press, release, reset],
  );

  // auto-play through the steps
  useEffect(() => {
    if (!playing || step === null) return;
    if (step >= TOUR.length - 1) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => goStep(step + 1), 4200);
    return () => clearTimeout(t);
  }, [playing, step, goStep]);

  useEffect(() => () => clearTimers(), []);
  useEffect(() => {
    goStep(0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const holdStart = () => {
    clearTimers();
    setPlaying(false);
    setStep(null);
    press();
    completeRef.current();
  };

  const ledOn = reading === "HIGH";
  const flows: FlowId[] = phase === "pressed" ? ["input", "output"] : phase === "releasing" ? (ledOn ? ["discharge", "output"] : ["discharge"]) : [];
  const between = v < P.supply * LOGIC.vihFraction && v > P.supply * LOGIC.vilFraction;
  const highlight = step !== null ? TOUR[step].highlight : [];
  const getV = useCallback(() => vRef.current, []);

  const context =
    phase === "pressed"
      ? `SW1 is closed, so D2 = 5 V and reads HIGH. The program drives D13 HIGH and ${fmtSI(iLed, "A")} lights D1, while ${fmtSI(P.supply / P.pullDown, "A")} flows through R2.`
      : phase === "releasing"
        ? `Released. C1 is draining through R2: D2 = ${v.toFixed(2)} V. ${ledOn ? "Still above the LOW threshold, so the LED stays on." : "Below 1.5 V, so D2 reads LOW and the LED is off."}`
        : "SW1 is open. R2 holds D2 at 0 V, so it reads LOW and the LED is off. Press and hold SW1, or step through below.";

  const info = selected ? PART_INFO[selected] : null;
  const tip = hovered ? PART_INFO[hovered] : null;

  return (
    <div className="page how">
      <div className="how-grid">
        <div className="how-main">
        <Panel
          tag="FIG. 1"
          title="Push-button LED"
          className="diagram-panel"
          aside={
            <div className="legend">
              <span className="lg teal">input path</span>
              <span className="lg orange">output path</span>
              <span className="lg blue">C1 discharge</span>
            </div>
          }
        >
          <div className="diagram-wrap dot-grid">
            <div className="circuit-box">
            <Circuit
              swClosed={phase === "pressed"}
              ledLevel={ledOn ? 1 : 0}
              flows={flows}
              highlight={highlight}
              hovered={hovered}
              selected={selected}
              onHover={setHovered}
              onSelect={(p) => setSelected((s) => (s === p ? null : p))}
              voltages={{
                BUTTON: `${v.toFixed(2)} V`,
                LED_DRIVE: ledOn ? `${P.supply.toFixed(2)} V` : "0.00 V",
              }}
            />
            <AnimatePresence>
              {tip && hovered !== selected && (
                <motion.div className="tooltip" style={anchorPct(tip.at[0], tip.at[1])} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  <b>{tip.ref}</b> {tip.name}
                  <span className={`role role-${tip.role}`}>{ROLE_LABEL[tip.role]}</span>
                </motion.div>
              )}
            </AnimatePresence>
            </div>
          </div>
          <div className="diagram-foot">
            <motion.button
              className={`hold-btn${phase === "pressed" ? " on" : ""}`}
              whileTap={{ scale: 0.96 }}
              onPointerDown={holdStart}
              onPointerUp={release}
              onPointerLeave={() => phase === "pressed" && release()}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                  e.preventDefault();
                  holdStart();
                }
              }}
              onKeyUp={(e) => (e.key === " " || e.key === "Enter") && release()}
            >
              <span className="hold-cap" />
              {phase === "pressed" ? "SW1 closed: current flowing" : "Hold to press SW1"}
            </motion.button>
            <span className="hint">
              <MousePointerClick size={13} /> click any part to inspect it
            </span>
            {phase === "releasing" && <span className="slowmo">slow motion ×{SLOW}</span>}
          </div>
        </Panel>

        <Panel tag="WALKTHROUGH" className="tour-panel">
          <div className="tour-top">
            <ol className="stepper">
              {TOUR.map((s, i) => (
                <li key={s.id} className={step === i ? "on" : step !== null && i < step ? "past" : ""}>
                  <button onClick={() => (setPlaying(false), goStep(i))}>
                    <span className="st-node">{i + 1}</span>
                    <span className="st-label">{s.title}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="tour-ctl">
              <button className="ctl" onClick={() => (step === null || step >= TOUR.length - 1 ? (goStep(0), setPlaying(true)) : setPlaying((p) => !p))}>
                {playing ? <Pause size={14} /> : <Play size={14} />}
                {playing ? "Pause" : "Play"}
              </button>
              <button className="ctl ghost" onClick={() => (setPlaying(false), goStep(0))} aria-label="Restart walkthrough">
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={step === null ? `live-${phase}` : `step-${step}`} className="tour-text" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
              <span className="tour-tag">{step === null ? "LIVE" : `STEP ${step + 1}`}</span>
              <p>{step === null ? context : TOUR[step].text}</p>
            </motion.div>
          </AnimatePresence>
          {playing && step !== null && <motion.div key={`bar-${step}`} className="tour-progress" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 4.2, ease: "linear" }} />}
        </Panel>
        </div>

        <div className="how-side">
          <Panel tag="LIVE" title="Readings" className="readings">
            <div className="reading-rows">
              <div className="rr">
                <span className="rr-k">V(D2)</span>
                <span className="rr-v teal">
                  <AnimatedNumber value={v} format={(x) => x.toFixed(2)} /> V
                </span>
                <div className="rr-bar">
                  <span style={{ width: `${(v / P.supply) * 100}%` }} />
                  <i style={{ left: `${LOGIC.vilFraction * 100}%` }} />
                  <i style={{ left: `${LOGIC.vihFraction * 100}%` }} />
                </div>
              </div>
              <div className="rr">
                <span className="rr-k">D2 reads</span>
                <span className={`logic ${reading === "HIGH" ? "high" : "low"}`}>{reading}</span>
                {between && <span className="rr-note">between thresholds, keeps last value</span>}
              </div>
              <div className="rr">
                <span className="rr-k">D13 output</span>
                <span className={`logic out ${ledOn ? "high" : "low"}`}>{ledOn ? "HIGH" : "LOW"}</span>
              </div>
              <div className="rr">
                <span className="rr-k">I(D1)</span>
                <span className="rr-v orange">
                  <AnimatedNumber value={ledOn ? iLed * 1000 : 0} format={(x) => x.toFixed(1)} /> mA
                </span>
              </div>
              <div className="rr">
                <span className="rr-k">I(R2)</span>
                <span className="rr-v blue">
                  <AnimatedNumber value={(v / P.pullDown) * 1000} format={(x) => x.toFixed(2)} /> mA
                </span>
              </div>
            </div>
            <div className="scope-head">
              <span>V(D2) · last 6 s</span>
            </div>
            <Scope getV={getV} vMax={P.supply} />
          </Panel>

          <Panel tag="INSPECT" title={info ? `${info.ref} · ${info.name}` : "Inspector"} className="inspector">
            <AnimatePresence mode="wait">
              {info ? (
                <motion.div key={selected} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                  <span className={`role role-${info.role}`}>{ROLE_LABEL[info.role]}</span>
                  <p className="insp-what">{info.what}</p>
                  <p className="insp-why">
                    <b>Why it's here:</b> {info.why}
                  </p>
                  <dl className="insp-values">
                    {info.values.map(([k, val]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{val}</dd>
                      </div>
                    ))}
                  </dl>
                </motion.div>
              ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <p className="muted">Click a part on the schematic to see what it does and why it's there.</p>
                  <div className="part-chips">
                    {(["A1", "SW1", "R1", "D1", "R2", "C1", "pinD2", "pinD13", "GND"] as PartId[]).map((p) => (
                      <button key={p} onMouseEnter={() => setHovered(p)} onMouseLeave={() => setHovered(null)} onClick={() => setSelected(p)}>
                        {PART_INFO[p].ref.replace("A1 · ", "")}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Panel>
        </div>
      </div>

    </div>
  );
}
