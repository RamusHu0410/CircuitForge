import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Baby, GraduationCap, Lightbulb, Microscope, Zap } from "lucide-react";
import type { Level, Project } from "../../types";
import { LOGIC, dischargeTime, fmtOhms, fmtSI, ledDesign, tau, texOhms, texSI, trim } from "../../math";
import { EXPLAIN } from "../../data/explain";
import { Tex } from "../Tex";
import { AnimatedNumber, LabSlider, Panel, Segmented, type Tone } from "./ui";

const tex = String.raw;
type Var = "vs" | "vf" | "i" | "r2" | "c1" | "vr" | null;

const LED_COLORS = [
  { name: "Red", vf: 2.0, color: "#e5484d" },
  { name: "Green", vf: 2.2, color: "#30a46c" },
  { name: "Blue", vf: 3.0, color: "#3e63dd" },
  { name: "White", vf: 3.2, color: "#c9c4bb" },
];
const ledColor = (vf: number) => LED_COLORS.reduce((a, b) => (Math.abs(b.vf - vf) < Math.abs(a.vf - vf) ? b : a)).color;

const LEVEL_OPTIONS: { id: Level; label: React.ReactNode }[] = [
  {
    id: "eli5",
    label: (
      <>
        <Baby size={14} /> Like I'm 5
      </>
    ),
  },
  {
    id: "beginner",
    label: (
      <>
        <GraduationCap size={14} /> Beginner
      </>
    ),
  },
  {
    id: "expert",
    label: (
      <>
        <Microscope size={14} /> Expert
      </>
    ),
  },
];

/* ---------- shared pieces ---------- */

function Explain({ id, level }: { id: keyof typeof EXPLAIN; level: Level }) {
  return (
    <div className="explain-box">
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={level} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
          {EXPLAIN[id][level]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function KeyIdea({ children }: { children: React.ReactNode }) {
  return (
    <div className="key-idea">
      <Lightbulb size={14} />
      <span>
        <b>Key idea</b> {children}
      </span>
    </div>
  );
}

function Formula({ items, active }: { items: string[]; active: Var }) {
  return (
    <div className="formula" data-active={active ?? ""}>
      <span className="formula-tag">ƒ</span>
      {items.map((f, i) => (
        <Tex key={i} block>
          {f}
        </Tex>
      ))}
    </div>
  );
}

interface Zone {
  to: number;
  tone: Tone;
}

function ZoneGauge({ label, value, max, zones, format, marks }: { label: string; value: number; max: number; zones: Zone[]; format: (v: number) => string; marks: { at: number; label: string }[] }) {
  const pct = Math.min(100, (value / max) * 100);
  let from = 0;
  return (
    <div className="gauge">
      <div className="gauge-head">
        <span>{label}</span>
        <b>
          <AnimatedNumber value={value} format={format} />
        </b>
      </div>
      <div className="gauge-track">
        {zones.map((z) => {
          const el = <span key={z.to} className={`gz tone-${z.tone}`} style={{ left: `${(from / max) * 100}%`, width: `${((Math.min(z.to, max) - from) / max) * 100}%` }} />;
          from = z.to;
          return el;
        })}
        <motion.span className="gauge-marker" animate={{ left: `${pct}%` }} transition={{ type: "spring", stiffness: 300, damping: 30 }} />
      </div>
      <div className="gauge-marks">
        {marks.map((m) => (
          <span key={m.label} style={{ left: `${(m.at / max) * 100}%` }}>
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}

type Status = "pass" | "warn" | "fail";
function SafetyPanel({ rows }: { rows: { label: string; value: string; limit: string; source: "datasheet" | "assumed" | "physics"; status: Status }[] }) {
  const overall: Status = rows.some((r) => r.status === "fail") ? "fail" : rows.some((r) => r.status === "warn") ? "warn" : "pass";
  return (
    <div className={`safety s-${overall}`}>
      <div className="safety-head">
        <span className="safety-badge">{overall === "pass" ? "PASS" : overall === "warn" ? "WARNING" : "FAIL"}</span>
        <span>Design validation</span>
      </div>
      <div className="safety-rows">
        {rows.map((r) => (
          <div key={r.label} className={`sr s-${r.status}`}>
            <span className="sr-dot" />
            <span className="sr-label">{r.label}</span>
            <span className="sr-value">{r.value}</span>
            <span className="sr-limit">{r.limit}</span>
            <span className={`sr-src src-${r.source}`}>{r.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- 2.1 LED resistor ---------- */

function LedVisual({ vs, vf, d }: { vs: number; vf: number; d: ReturnType<typeof ledDesign> }) {
  const color = ledColor(vf);
  const brightness = d.ok ? Math.min(1, d.current / 0.02) : 0;
  const dur = d.ok && d.current > 0 ? Math.min(8, 0.9 / (d.current / 0.0136)) : 0;
  const vr = d.ok ? vs - vf : 0;
  return (
    <div className="led-visual">
      <svg viewBox="0 0 360 170" className="loop">
        <path className="lw" d="M40 67V30H130M200 30H250M276 30H320V140H40V103" />
        {dur > 0 && <path className="loop-flow" d="M40 67V30H320V140H40V103" style={{ animationDuration: `${dur}s` }} />}
        <circle cx={40} cy={85} r={18} className="src" />
        <text x={40} y={81} className="pm">+</text>
        <text x={40} y={96} className="pm">−</text>
        <text x={8} y={89} className="lbl teal">Vs</text>
        <rect x={130} y={22} width={70} height={16} rx={2} className="res" />
        <text x={165} y={58} className="lbl orange">{fmtOhms(d.r || 0)}</text>
        <text x={165} y={14} className="lbl small">V_R = {trim(vr, 2)} V</text>
        <motion.circle cx={262} cy={30} r={24} fill={color} animate={{ opacity: brightness * 0.45 }} />
        <polygon points="250,18 250,42 274,30" style={{ fill: brightness > 0 ? color : "#fff", stroke: "#292724" }} strokeWidth={1.8} />
        <path d="M274 18V42" stroke="#292724" strokeWidth={1.8} />
        <text x={262} y={60} className="lbl small">V_f = {trim(vf, 2)} V</text>
        <text x={180} y={160} className="lbl small muted">{dur > 0 ? "dot speed ∝ current" : "no current"}</text>
      </svg>
      <div className="vsplit">
        <div className="vsplit-top">
          <span>
            <Tex>{tex`V_s = ${trim(vs)}\,\text{V}`}</Tex>
          </span>
        </div>
        <div className="vsplit-bar">
          <motion.span className="seg seg-r" animate={{ flexGrow: Math.max(vr, 0.0001) }} transition={{ type: "spring", stiffness: 220, damping: 30 }}>
            {vr > 0.6 && `R1 · ${trim(vr, 2)} V`}
          </motion.span>
          <motion.span className="seg seg-led" style={{ background: color }} animate={{ flexGrow: Math.min(vf, vs) }} transition={{ type: "spring", stiffness: 220, damping: 30 }}>
            {`LED · ${trim(Math.min(vf, vs), 2)} V`}
          </motion.span>
        </div>
        <div className="vsplit-cap">The supply voltage is shared: the LED takes its fixed drop, and the resistor takes the rest.</div>
      </div>
    </div>
  );
}

/* ---------- 2.2 pull-down ---------- */

function PullDownVisual({ pressed, hasR, onToggleSw, onToggleR, v, floating }: { pressed: boolean; hasR: boolean; onToggleSw: () => void; onToggleR: () => void; v: number; floating: boolean }) {
  return (
    <svg viewBox="0 0 230 236" className="pd-svg">
      <text x={70} y={14} className="lbl teal">+5 V</text>
      <path className="lw" d="M70 20V44" />
      {/* switch */}
      <g className="clickable" onClick={onToggleSw}>
        <rect x={40} y={38} width={70} height={52} className="hit-zone" rx={6} />
        <circle cx={70} cy={48} r={3.5} className="term" />
        <circle cx={70} cy={84} r={3.5} className="term" />
        <motion.g animate={{ rotate: pressed ? 0 : -28 }} style={{ transformBox: "view-box", transformOrigin: "70px 48px" }} transition={{ type: "spring", stiffness: 600, damping: 30 }}>
          <path d="M70 48L70 84" className="lever" />
        </motion.g>
        <text x={100} y={70} className="lbl small">SW1</text>
      </g>
      <path className="lw" d="M70 88V116" />
      <circle cx={70} cy={116} r={4} className="node" />
      <path className="lw" d="M70 116H160" />
      <rect x={160} y={104} width={50} height={24} rx={4} className="pin-box" />
      <text x={185} y={120} className="lbl">D2</text>
      {/* R2 */}
      <g className="clickable" onClick={onToggleR}>
        <rect x={44} y={118} width={60} height={86} className="hit-zone" rx={6} />
        <path className="lw" d={hasR ? "M70 116V138M70 182V200" : "M70 116V128M70 190V200"} />
        <rect x={62} y={138} width={16} height={44} rx={2} className={`res ${hasR ? "" : "missing"}`} />
        <text x={92} y={164} className="lbl small">R2</text>
      </g>
      <path className="gnd" d="M58 200H82M63 205H77M67 210H73" />
      {pressed && hasR && <path className="pd-flow" d="M70 20V200" />}
      {floating && <path className="noise" d="M120 100q5 -8 10 0t10 0t10 0t10 0" />}
      <text x={185} y={150} className={`lbl small ${floating ? "amber" : "muted"}`}>{floating ? "floating" : `${trim(v, 2)} V`}</text>
      <text x={115} y={228} className="lbl small muted">click the switch or R2</text>
    </svg>
  );
}

function VoltMeter({ v, vmax, floating }: { v: number; vmax: number; floating: boolean }) {
  return (
    <div className={`vmeter${floating ? " floating" : ""}`}>
      <div className="vm-scale">
        <span className="vm-zone hi" style={{ height: `${(1 - LOGIC.vihFraction) * 100}%` }}>HIGH</span>
        <span className="vm-zone mid" style={{ height: `${(LOGIC.vihFraction - LOGIC.vilFraction) * 100}%` }}>?</span>
        <span className="vm-zone lo" style={{ height: `${LOGIC.vilFraction * 100}%` }}>LOW</span>
        <motion.span className="vm-needle" animate={{ bottom: `${(v / vmax) * 100}%` }} transition={floating ? { duration: 0.1 } : { type: "spring", stiffness: 260, damping: 26 }} />
      </div>
      <div className="vm-ticks">
        <span>5 V</span>
        <span style={{ bottom: `${LOGIC.vihFraction * 100}%` }}>3 V</span>
        <span style={{ bottom: `${LOGIC.vilFraction * 100}%` }}>1.5 V</span>
        <span className="zero">0 V</span>
      </div>
    </div>
  );
}

/* ---------- 2.3 debounce: release with contact bounce ---------- */

const BOUNCE_CLOSED: [number, number][] = [
  [0, 1.0],
  [1.3, 1.42],
  [1.9, 1.96],
  [2.55, 2.6],
];

function simulateRelease(r: number, cNf: number, bounce: boolean, vs: number) {
  const closed = bounce ? BOUNCE_CLOSED : [[0, 1.0] as [number, number]];
  const lastOpenMs = closed[closed.length - 1][1];
  const tcMs = tau(r, cNf) * 1000;
  const tLowMs = dischargeTime(tcMs, LOGIC.vilFraction);
  const tMax = Math.min(40, Math.max(6, lastOpenMs + Math.max(tLowMs * 1.7, 1.5)));
  const N = 900;
  const dt = tMax / N;
  let v = vs;
  let read = true;
  const pts: { t: number; sw: boolean; v: number; read: boolean }[] = [];
  let falls = 0;
  for (let i = 0; i <= N; i++) {
    const t = i * dt;
    const sw = closed.some(([a, b]) => t >= a && t < b);
    if (sw) v = vs;
    else v = tcMs > 0 ? v * Math.exp(-dt / tcMs) : 0;
    // Schmitt-style reading using the guaranteed thresholds
    if (read && v <= vs * LOGIC.vilFraction) {
      read = false;
      falls++;
    } else if (!read && v >= vs * LOGIC.vihFraction) read = true;
    pts.push({ t, sw, v, read });
  }
  const finalLow = pts.find((p, i) => i > 0 && !p.read && p.t >= lastOpenMs)?.t;
  return { pts, tMax, falls, tcMs, tLowMs, lastOpenMs, finalLow };
}

function BounceGraph({ sim, vs }: { sim: ReturnType<typeof simulateRelease>; vs: number }) {
  const W = 900;
  const x = (t: number) => (t / sim.tMax) * W;
  const lane = (top: number, h: number, on: (p: (typeof sim.pts)[0]) => boolean) =>
    sim.pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${(on(p) ? top : top + h).toFixed(1)}`).join("");
  const vy = (v: number) => 194 - (v / vs) * 128;
  const vPath = sim.pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${vy(p.v).toFixed(1)}`).join("");
  const ticks = Array.from({ length: 7 }, (_, i) => (sim.tMax / 6) * i);
  const edges = sim.pts.filter((p, i) => i > 0 && sim.pts[i - 1].read && !p.read);
  const key = `${sim.tcMs}-${sim.lastOpenMs}`;

  return (
    <svg viewBox="-104 -6 1014 290" className="bounce-graph">
      <text x={-8} y={30} className="lane-l">SW1 contacts</text>
      <text x={-8} y={130} className="lane-l">V(D2)</text>
      <text x={-8} y={240} className="lane-l">D2 reads</text>
      {/* lane frames */}
      <rect x={0} y={10} width={W} height={34} className="lane-bg" />
      <rect x={0} y={60} width={W} height={140} className="lane-bg" />
      <rect x={0} y={216} width={W} height={34} className="lane-bg" />
      {ticks.map((t) => (
        <g key={t}>
          <path d={`M${x(t)} 10V250`} className="grid" />
          <text x={x(t)} y={268} className="tick">{trim(t, 2)} ms</text>
        </g>
      ))}
      {/* thresholds */}
      <rect x={0} y={vy(vs * LOGIC.vihFraction)} width={W} height={vy(vs * LOGIC.vilFraction) - vy(vs * LOGIC.vihFraction)} className="band" />
      <path d={`M0 ${vy(vs * LOGIC.vihFraction)}H${W}`} className="th hi" />
      <path d={`M0 ${vy(vs * LOGIC.vilFraction)}H${W}`} className="th lo" />
      <text x={W - 4} y={vy(vs * LOGIC.vihFraction) - 4} className="th-l hi">3 V HIGH</text>
      <text x={W - 4} y={vy(vs * LOGIC.vilFraction) + 12} className="th-l lo">1.5 V LOW</text>
      <motion.path key={`sw-${key}`} d={lane(14, 26, (p) => p.sw)} className="trace sw" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6 }} />
      <motion.path key={`v-${key}`} d={vPath} className="trace v" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: 0.1 }} />
      <motion.path key={`r-${key}`} d={lane(220, 26, (p) => p.read)} className="trace rd" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 0.25 }} />
      {edges.slice(1).map((p) => (
        <g key={p.t} className="glitch">
          <circle cx={x(p.t)} cy={233} r={7} />
          <text x={x(p.t)} y={209}>false press</text>
        </g>
      ))}
      {sim.finalLow !== undefined && (
        <g className="tlow">
          <path d={`M${x(sim.lastOpenMs)} 204H${x(sim.finalLow)}`} />
          <text x={(x(sim.lastOpenMs) + x(sim.finalLow)) / 2} y={212}>{trim(sim.finalLow - sim.lastOpenMs, 2)} ms</text>
        </g>
      )}
    </svg>
  );
}

/* ---------- 2.4 Kirchhoff ---------- */

function Ladder({ vs, vf, ok, color, onHover }: { vs: number; vf: number; ok: boolean; color: string; onHover: (v: Var) => void }) {
  const top = 24;
  const bot = 204;
  const y = (v: number) => bot - (v / vs) * (bot - top);
  const vfC = Math.min(vf, vs);
  return (
    <svg viewBox="0 0 460 228" className="ladder">
      <path d={`M48 ${top}V${bot}`} className="axis" />
      {[vs, vfC, 0].map((v) => (
        <g key={v}>
          <path d={`M44 ${y(v)}H52`} className="axis" />
          <text x={40} y={y(v) + 4} className="tick end">{trim(v, 2)} V</text>
        </g>
      ))}
      <g className="seg-hover" onMouseEnter={() => onHover("vr")} onMouseLeave={() => onHover(null)}>
        <motion.rect x={64} width={70} rx={3} className="lad-r" animate={{ y: y(vs), height: Math.max(0, y(vfC) - y(vs)) }} />
        <text x={146} y={(y(vs) + y(vfC)) / 2 + 4} className="lad-l orange">drop across R1 = I·R1 = {trim(ok ? vs - vf : 0, 2)} V</text>
      </g>
      <g className="seg-hover" onMouseEnter={() => onHover("vf")} onMouseLeave={() => onHover(null)}>
        <motion.rect x={64} width={70} rx={3} style={{ fill: color }} className="lad-f" animate={{ y: y(vfC), height: Math.max(0, bot - y(vfC)) }} />
        <text x={146} y={(y(vfC) + bot) / 2 + 4} className="lad-l">drop across D1 = Vf = {trim(vfC, 2)} V</text>
      </g>
      <text x={146} y={top - 8} className="lad-l teal">supply Vs = {trim(vs, 2)} V</text>
      <text x={146} y={bot + 18} className="lad-l muted">back at ground: 0 V</text>
    </svg>
  );
}

function KclNode({ i }: { i: number }) {
  return (
    <svg viewBox="0 0 340 150" className="kcl">
      <defs>
        <marker id="kcl-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#D97757" />
        </marker>
      </defs>
      <path d="M20 60H156" className="kcl-wire" markerEnd="url(#kcl-arrow)" />
      <path d="M170 66V130" className="kcl-wire" markerEnd="url(#kcl-arrow)" />
      <circle cx={170} cy={60} r={7} className="kcl-node" />
      <text x={184} y={64} className="lad-l">LED_ANODE</text>
      <text x={20} y={46} className="lad-l">in: I(R1) = {fmtSI(i, "A")}</text>
      <text x={182} y={118} className="lad-l">out: I(D1) = {fmtSI(i, "A")}</text>
    </svg>
  );
}

/* ---------- page ---------- */

const PULL_OPTIONS = [1_000, 4_700, 10_000, 47_000, 100_000];
const CAP_OPTIONS = [0, 10, 47, 100, 220, 470];

export function MathLab({ project, level, onLevel, onTouched }: { project: Project; level: Level; onLevel: (l: Level) => void; onTouched: () => void }) {
  const P = project.params;
  const [vs, setVs] = useState(P.supply);
  const [vf, setVf] = useState(P.ledVf);
  const [ma, setMa] = useState(P.ledTargetMa);
  const [r2, setR2] = useState(P.pullDown);
  const [c1, setC1] = useState(P.debounceCapNf);
  const [bounce, setBounce] = useState(true);
  const [pressed, setPressed] = useState(false);
  const [hasR, setHasR] = useState(true);
  const [changed, setChanged] = useState<Var>(null);
  const [hoverVar, setHoverVar] = useState<Var>(null);
  const [noise, setNoise] = useState(0.4);
  const clear = useRef(0);
  const touchedRef = useRef(onTouched);
  touchedRef.current = onTouched;

  const touch = (v: Var) => {
    setChanged(v);
    window.clearTimeout(clear.current);
    clear.current = window.setTimeout(() => setChanged(null), 1400);
    touchedRef.current();
  };
  useEffect(() => () => window.clearTimeout(clear.current), []);

  const floating = !pressed && !hasR;
  useEffect(() => {
    if (!floating) return;
    const t = setInterval(() => setNoise(Math.random()), 140);
    return () => clearInterval(t);
  }, [floating]);

  const d = ledDesign(vs, vf, ma);
  const i = ma / 1000;
  const color = ledColor(vf);
  const active = hoverVar ?? changed;
  const vD2 = pressed ? P.supply : hasR ? 0 : noise * P.supply;
  const reading = pressed ? "HIGH" : hasR ? "LOW" : "???";
  const sim = useMemo(() => simulateRelease(r2, c1, bounce, P.supply), [r2, c1, bounce, P.supply]);
  const tc = tau(r2, c1);

  const iStatus: Status = !d.ok ? "fail" : d.current * 1000 > LOGIC.pinAbsMaxMa ? "fail" : d.current * 1000 > LOGIC.pinMaxMa ? "warn" : "pass";
  const pStatus: Status = !d.ok ? "pass" : d.power > LOGIC.resistorRatingW ? "fail" : d.power > LOGIC.resistorRatingW / 2 ? "warn" : "pass";

  return (
    <div className="page math">
      <div className="math-intro">
        <p>
          Every value in the circuit comes from a formula. Move the controls and watch the numbers, the formulas and the pictures react. Nothing you
          change here alters your design.
        </p>
        <div className="level-ctl">
          <span className="eyebrow-s">explanation depth</span>
          <Segmented id="level" options={LEVEL_OPTIONS} value={level} onChange={onLevel} />
        </div>
      </div>

      {/* 2.1 */}
      <Panel tag="2.1" title="R1 · the LED resistor" tone="orange" className="lab">
        <div className="lab-split">
          <div className="lab-col">
            <Explain id="led" level={level} />
            <KeyIdea>The LED sets the voltage, and the resistor sets the current.</KeyIdea>
            <div className="sliders">
              <LabSlider label="Supply" sym="V_s" value={vs} min={3.3} max={12} step={0.1} unit="V" tone="teal" onChange={(v) => (setVs(v), touch("vs"))} />
              <div className="led-picks">
                <span className="lp-label">LED color</span>
                {LED_COLORS.map((c) => (
                  <button key={c.name} className={Math.abs(vf - c.vf) < 0.001 ? "on" : ""} onClick={() => (setVf(c.vf), touch("vf"))}>
                    <span className="lp-dot" style={{ background: c.color }} />
                    {c.name}
                    <small>{c.vf} V</small>
                  </button>
                ))}
              </div>
              <LabSlider label="Forward voltage" sym="V_f" value={vf} min={1.6} max={3.4} step={0.1} unit="V" tone="purple" onChange={(v) => (setVf(v), touch("vf"))} />
              <LabSlider label="Target current" sym="I" value={ma} min={1} max={30} step={1} unit="mA" tone="orange" onChange={(v) => (setMa(v), touch("i"))} />
            </div>
          </div>
          <div className="lab-col">
            <LedVisual vs={vs} vf={vf} d={d} />
            {d.ok && (
              <>
                <Formula
                  active={active}
                  items={[
                    tex`R = \frac{\htmlClass{var-vs}{V_s} - \htmlClass{var-vf}{V_f}}{\htmlClass{var-i}{I}} = \frac{\htmlClass{var-vs}{${trim(vs)}\,\text{V}} - \htmlClass{var-vf}{${trim(vf)}\,\text{V}}}{\htmlClass{var-i}{${texSI(i, "A")}}} = ${texOhms(d.rIdeal)}`,
                    tex`R_{E12} = ${texOhms(d.r)} \;\Rightarrow\; I = \frac{${trim(vs - vf)}\,\text{V}}{${texOhms(d.r)}} = ${texSI(d.current, "A")}`,
                    tex`P = I^2 R = (${texSI(d.current, "A")})^2 \cdot ${texOhms(d.r)} = ${texSI(d.power, "W")}`,
                  ]}
                />
                <div className="results">
                  <div>
                    <span>ideal R</span>
                    <b>
                      <AnimatedNumber value={d.rIdeal} format={(x) => fmtOhms(Number(trim(x)))} />
                    </b>
                  </div>
                  <div className="hl">
                    <span>standard part</span>
                    <b>{fmtOhms(d.r)}</b>
                  </div>
                  <div>
                    <span>actual I</span>
                    <b>
                      <AnimatedNumber value={d.current * 1000} format={(x) => `${x.toFixed(1)} mA`} />
                    </b>
                  </div>
                  <div>
                    <span>heat in R1</span>
                    <b>
                      <AnimatedNumber value={d.power * 1000} format={(x) => `${x.toFixed(1)} mW`} />
                    </b>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="lab-bottom">
          <div className="gauges">
            <ZoneGauge
              label="LED current"
              value={d.ok ? d.current * 1000 : 0}
              max={45}
              format={(x) => `${x.toFixed(1)} mA`}
              zones={[
                { to: 20, tone: "green" },
                { to: 40, tone: "amber" },
                { to: 45, tone: "red" },
              ]}
              marks={[
                { at: 20, label: "20 rec." },
                { at: 40, label: "40 max" },
              ]}
            />
            <ZoneGauge
              label="R1 power"
              value={d.ok ? d.power * 1000 : 0}
              max={300}
              format={(x) => `${x.toFixed(1)} mW`}
              zones={[
                { to: 125, tone: "green" },
                { to: 250, tone: "amber" },
                { to: 300, tone: "red" },
              ]}
              marks={[
                { at: 125, label: "½ rating" },
                { at: 250, label: "¼ W" },
              ]}
            />
          </div>
          <SafetyPanel
            rows={[
              { label: "Supply above LED drop", value: `${trim(vs)} V > ${trim(vf)} V`, limit: "Vs > Vf", source: "physics", status: d.ok ? "pass" : "fail" },
              { label: "Pin current", value: d.ok ? fmtSI(d.current, "A") : "—", limit: "≤ 20 mA rec. · 40 mA max", source: "datasheet", status: iStatus },
              { label: "Resistor power", value: d.ok ? fmtSI(d.power, "W") : "—", limit: "≤ 250 mW (¼ W part)", source: "assumed", status: pStatus },
              { label: "LED forward voltage", value: `${trim(vf)} V`, limit: "typical for this color", source: "assumed", status: "pass" },
            ]}
          />
        </div>
      </Panel>

      {/* 2.2 */}
      <Panel tag="2.2" title="R2 · the pull-down" tone="teal" className="lab">
        <div className="lab-split reverse">
          <div className="lab-col visual-col">
            <div className="pd-row">
              <PullDownVisual pressed={pressed} hasR={hasR} v={vD2} floating={floating} onToggleSw={() => (setPressed((p) => !p), touch(null))} onToggleR={() => (setHasR((h) => !h), touch(null))} />
              <VoltMeter v={vD2} vmax={P.supply} floating={floating} />
              <div className={`logic-big ${reading === "HIGH" ? "high" : reading === "LOW" ? "low" : "float"}`}>
                <span>D2 reads</span>
                <b>{reading}</b>
              </div>
            </div>
          </div>
          <div className="lab-col">
            <Explain id="pulldown" level={level} />
            <KeyIdea>An input only measures voltage, so something has to define it when nothing is pressed.</KeyIdea>
            <div className="opt-row">
              <span className="lp-label">R2 value</span>
              <Segmented id="r2-a" size="sm" options={PULL_OPTIONS.map((r) => ({ id: r, label: fmtOhms(r) }))} value={r2} onChange={(r) => (setR2(r), touch("r2"))} />
            </div>
            <Formula
              active={active}
              items={[
                tex`V_{D2} = \begin{cases} V_{cc} & \text{button pressed} \\ 0 & \text{released (pulled down by } \htmlClass{var-r2}{R_2}\text{)} \end{cases}`,
                tex`I_{\htmlClass{var-r2}{R_2}} = \frac{V_{cc}}{\htmlClass{var-r2}{R_2}} = \frac{5\,\text{V}}{\htmlClass{var-r2}{${texOhms(r2)}}} = ${texSI(P.supply / r2, "A")}`,
              ]}
            />
            <div className={`verdict-chip ${floating ? "amber" : r2 < 4_700 || r2 > 47_000 ? "amber" : "green"}`}>
              {floating ? "Floating: the reading is random" : r2 < 4_700 ? "Works, but wastes current while pressed" : r2 > 47_000 ? "Weak pull: long wires may pick up noise" : "Good balance of wasted current and noise immunity"}
            </div>
          </div>
        </div>
      </Panel>

      {/* 2.3 */}
      <Panel tag="2.3" title="C1 · debouncing the release" tone="blue" className="lab">
        <div className="lab-split">
          <div className="lab-col">
            <Explain id="debounce" level={level} />
            <KeyIdea>After one τ the voltage has fallen to 37%. After 5τ it's essentially zero.</KeyIdea>
          </div>
          <div className="lab-col">
            <div className="opt-row">
              <span className="lp-label">R2</span>
              <Segmented id="r2-b" size="sm" options={PULL_OPTIONS.map((r) => ({ id: r, label: fmtOhms(r) }))} value={r2} onChange={(r) => (setR2(r), touch("r2"))} />
            </div>
            <div className="opt-row">
              <span className="lp-label">C1</span>
              <Segmented id="c1" size="sm" options={CAP_OPTIONS.map((c) => ({ id: c, label: c === 0 ? "none" : `${c} nF` }))} value={c1} onChange={(c) => (setC1(c), touch("c1"))} />
            </div>
            <div className="opt-row">
              <span className="lp-label">switch</span>
              <Segmented
                id="bounce"
                size="sm"
                options={[
                  { id: "b", label: "bouncy (realistic)" },
                  { id: "i", label: "ideal" },
                ]}
                value={bounce ? "b" : "i"}
                onChange={(v) => (setBounce(v === "b"), touch(null))}
              />
            </div>
            <Formula
              active={active}
              items={
                c1 > 0
                  ? [
                      tex`\tau = \htmlClass{var-r2}{R_2}\,\htmlClass{var-c1}{C_1} = \htmlClass{var-r2}{${texOhms(r2)}} \times \htmlClass{var-c1}{${c1}\,\text{nF}} = ${texSI(tc, "s")}`,
                      tex`v(t) = V_{cc}\, e^{-t/\tau} \quad\Rightarrow\quad t_{LOW} = \tau \ln\frac{1}{0.3} \approx ${texSI(dischargeTime(tc, LOGIC.vilFraction), "s")}`,
                    ]
                  : [tex`\htmlClass{var-c1}{C_1} = 0 \;\Rightarrow\; \tau = 0: \text{ D2 follows every bounce}`]
              }
            />
          </div>
        </div>
        <div className="graph-wrap">
          <BounceGraph sim={sim} vs={P.supply} />
          <div className="graph-stats">
            <div>
              <span>τ</span>
              <b>{c1 > 0 ? fmtSI(tc, "s") : "0"}</b>
            </div>
            <div>
              <span>falls below LOW after</span>
              <b>{c1 > 0 ? fmtSI(dischargeTime(tc, LOGIC.vilFraction), "s") : "instantly"}</b>
            </div>
            <div className={sim.falls > 1 ? "bad" : "good"}>
              <span>program sees</span>
              <b>{sim.falls > 1 ? `${sim.falls - 1} false press${sim.falls > 2 ? "es" : ""}` : "1 clean release"}</b>
            </div>
          </div>
          <p className="graph-note">Example bounce pattern. Readings use the guaranteed thresholds: HIGH ≥ 3 V, LOW ≤ 1.5 V.</p>
        </div>
      </Panel>

      {/* 2.4 */}
      <Panel tag="2.4" title="Check · Kirchhoff's laws" tone="purple" className="lab">
        <div className="lab-split">
          <div className="lab-col">
            <Explain id="verify" level={level} />
            <KeyIdea>Every volt the supply pushes out is used up by the time the current gets back to ground.</KeyIdea>
            <Formula
              active={active}
              items={[
                tex`\text{KVL:}\quad \htmlClass{var-vs}{V_s} - \htmlClass{var-vr}{I R_1} - \htmlClass{var-vf}{V_f} = \htmlClass{var-vs}{${trim(vs)}} - \htmlClass{var-vr}{${trim(d.ok ? vs - vf : 0)}} - \htmlClass{var-vf}{${trim(vf)}} = ${d.ok ? "0" : "?"}\,\text{V}`,
                tex`\text{KCL:}\quad I_{R_1} = I_{D_1} = ${texSI(d.ok ? d.current : 0, "A")}`,
              ]}
            />
            <KclNode i={d.ok ? d.current : 0} />
            <AnimatePresence>
              {level === "expert" && d.ok && (
                <motion.div className="mna" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <div className="mna-head">
                    <Zap size={13} /> Modified nodal analysis, LED branch
                  </div>
                  <Formula
                    active={null}
                    items={[
                      tex`\begin{bmatrix} G & -G & 1 & 0 \\ -G & G & 0 & 1 \\ 1 & 0 & 0 & 0 \\ 0 & 1 & 0 & 0 \end{bmatrix} \begin{bmatrix} v_1 \\ v_2 \\ i_s \\ i_f \end{bmatrix} = \begin{bmatrix} 0 \\ 0 \\ V_s \\ V_f \end{bmatrix}, \quad G = \tfrac{1}{R_1} = ${texSI(1 / d.r, "S")}`,
                      tex`v_1 = ${trim(vs)}\,\text{V},\ v_2 = ${trim(vf)}\,\text{V},\ i_f = G(v_1 - v_2) = ${texSI(d.current, "A")},\ i_s = -i_f`,
                    ]}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="lab-col kirch-visual">
            <Ladder vs={vs} vf={vf} ok={d.ok} color={color} onHover={setHoverVar} />
            <p className="graph-note">Uses the values from 2.1. Hover the bars to find each term in the equation.</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
