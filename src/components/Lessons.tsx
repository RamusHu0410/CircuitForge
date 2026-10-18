import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DesignParams, LessonId, Level, Net } from "../types";
import { dischargeTime, fmtOhms, fmtSI, ledDesign, LOGIC, tau, texOhms, texSI, trim } from "../math";
import { EXAMPLE_NETS } from "../data/example";
import { EXPLAIN } from "../data/explain";
import { Tex } from "./Tex";

const tex = String.raw;

/* ---------- small building blocks ---------- */

function Range({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="range">
      <span className="range-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="range-val">
        {trim(value)} {unit}
      </span>
    </label>
  );
}

function Pick<T extends string | number>({ label, options, value, onChange, format }: { label?: string; options: T[]; value: T; onChange: (v: T) => void; format: (v: T) => string }) {
  return (
    <div className="pick">
      {label && <span className="range-label">{label}</span>}
      {options.map((o) => (
        <button key={String(o)} className={o === value ? "on" : ""} onClick={() => onChange(o)}>
          {format(o)}
        </button>
      ))}
    </div>
  );
}

function Formulas({ items }: { items: string[] }) {
  return (
    <div className="formulas">
      {items.map((f, i) => (
        <Tex key={i} block>
          {f}
        </Tex>
      ))}
    </div>
  );
}

const Ok = ({ children }: { children: React.ReactNode }) => <div className="verdict ok">✓ {children}</div>;
const Bad = ({ children }: { children: React.ReactNode }) => <div className="verdict bad">✗ {children}</div>;
const Warn = ({ children }: { children: React.ReactNode }) => <div className="verdict warn">! {children}</div>;

function Explain({ id, level }: { id: LessonId; level: Level }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.p key={level} className="explain" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
        {EXPLAIN[id][level]}
      </motion.p>
    </AnimatePresence>
  );
}

interface LessonProps {
  params: DesignParams;
  level: Level;
  /** Nets of the built schematic. Defaults to the bundled example's. */
  nets?: Net[];
  /** Whether KiCad's ERC found a problem with the power nets. The bundled example has the PWR_FLAG problem on purpose. */
  ercFailing?: boolean;
}

/* ---------- lessons ---------- */

function ParseLesson({ level }: LessonProps) {
  return (
    <div className="lesson">
      <Explain id="parse" level={level} />
      <div className="pipeline">
        <span>words</span>→<span className="ai">AI</span>→<span>steps</span>→<span>engine</span>→<span>schematic</span>
      </div>
    </div>
  );
}

function PowerLesson({ params, level }: LessonProps) {
  const led = ledDesign(params.supply, params.ledVf, params.ledTargetMa, params.ledResistor);
  const pull = params.supply / params.pullDown;
  const total = led.current + pull;
  return (
    <div className="lesson">
      <Explain id="power" level={level} />
      <Formulas
        items={[
          tex`I_{total} = I_{LED} + I_{R_2} = ${texSI(led.current, "A")} + ${texSI(pull, "A")} = ${texSI(total, "A")}`,
          tex`\frac{I_{total}}{I_{USB}} = \frac{${texSI(total, "A")}}{500\,\text{mA}} \approx ${trim((total / 0.5) * 100, 2)}\%`,
        ]}
      />
      <Ok>well inside the USB budget</Ok>
    </div>
  );
}

const LED_COLORS = [
  { name: "red", vf: 2.0 },
  { name: "green", vf: 2.2 },
  { name: "blue", vf: 3.0 },
  { name: "white", vf: 3.2 },
];

function LedLesson({ params, level }: LessonProps) {
  const [vs, setVs] = useState(params.supply);
  const [vf, setVf] = useState(params.ledVf);
  const [ma, setMa] = useState(params.ledTargetMa);
  const d = ledDesign(vs, vf, ma);
  const i = ma / 1000;

  return (
    <div className="lesson">
      <Explain id="led" level={level} />
      <div className="controls">
        <Range label="Vs" value={vs} min={3.3} max={12} step={0.1} unit="V" onChange={setVs} />
        <Pick label="LED" options={LED_COLORS.map((c) => c.vf)} value={vf} onChange={setVf} format={(v) => LED_COLORS.find((c) => c.vf === v)!.name} />
        <Range label="I" value={ma} min={1} max={30} step={1} unit="mA" onChange={setMa} />
      </div>
      {d.ok ? (
        <>
          <Formulas
            items={[
              tex`R = \frac{V_s - V_f}{I} = \frac{${trim(vs)}\,\text{V} - ${trim(vf)}\,\text{V}}{${texSI(i, "A")}} = ${texOhms(d.rIdeal)}`,
              tex`R_{E12} = ${texOhms(d.r)} \;\Rightarrow\; I = \frac{${trim(vs - vf)}\,\text{V}}{${texOhms(d.r)}} = ${texSI(d.current, "A")}`,
              tex`P = I^2 R = (${texSI(d.current, "A")})^2 \cdot ${texOhms(d.r)} = ${texSI(d.power, "W")}`,
            ]}
          />
          {d.current * 1000 > LOGIC.pinMaxMa ? (
            <Bad>{fmtSI(d.current, "A")} is over the {LOGIC.pinMaxMa} mA pin limit</Bad>
          ) : d.power > LOGIC.resistorRatingW ? (
            <Bad>too hot for a ¼ W resistor</Bad>
          ) : (
            <Ok>safe for the pin and the resistor</Ok>
          )}
        </>
      ) : (
        <Bad>Vs must be higher than Vf, or the LED never turns on</Bad>
      )}
    </div>
  );
}

const PULL_OPTIONS = [1_000, 4_700, 10_000, 47_000, 100_000];

function PullDownLesson({ params, level }: LessonProps) {
  const [pressed, setPressed] = useState(false);
  const [hasR, setHasR] = useState(true);
  const [r, setR] = useState(params.pullDown);
  const [noise, setNoise] = useState(0);
  const floating = !pressed && !hasR;

  useEffect(() => {
    if (!floating) return;
    const t = setInterval(() => setNoise(Math.random()), 180);
    return () => clearInterval(t);
  }, [floating]);

  const reading = pressed ? `HIGH · ${params.supply} V` : hasR ? "LOW · 0 V" : `${noise > 0.5 ? "HIGH" : "LOW"}? · ${trim(noise * params.supply, 2)} V`;

  return (
    <div className="lesson">
      <Explain id="pulldown" level={level} />
      <div className="controls">
        <div className="toggles">
          <label className="check-toggle">
            <input type="checkbox" checked={pressed} onChange={(e) => setPressed(e.target.checked)} /> button pressed
          </label>
          <label className="check-toggle">
            <input type="checkbox" checked={hasR} onChange={(e) => setHasR(e.target.checked)} /> R2 connected
          </label>
        </div>
        <Pick label="R2" options={PULL_OPTIONS} value={r} onChange={setR} format={fmtOhms} />
      </div>
      <div className={`readout${floating ? " floating" : ""}`}>
        D2 reads <b>{reading}</b>
      </div>
      <Formulas
        items={[
          tex`V_{D2} = \begin{cases} V_{cc} & \text{button pressed} \\ 0 & \text{released (pulled down by } R_2\text{)} \end{cases}`,
          tex`I_{R_2} = \frac{V_{cc}}{R_2} = \frac{5\,\text{V}}{${texOhms(r)}} = ${texSI(params.supply / r, "A")}`,
        ]}
      />
      {floating ? <Warn>floating: the reading is random</Warn> : r < 4_700 ? <Warn>works, but wastes current</Warn> : r > 47_000 ? <Warn>weak pull, may pick up noise</Warn> : <Ok>good balance of current and noise immunity</Ok>}
    </div>
  );
}

const CAP_OPTIONS = [10, 47, 100, 220, 470];

function DebounceLesson({ params, level }: LessonProps) {
  const [r, setR] = useState(params.pullDown);
  const [c, setC] = useState(params.debounceCapNf);
  const tc = tau(r, c);
  const tLow = dischargeTime(tc, LOGIC.vilFraction);

  // v(t) = Vcc·e^(−t/τ) over 0..5τ, normalised to the plot box
  const W = 320;
  const H = 96;
  const pts = Array.from({ length: 61 }, (_, i) => `${(i / 60) * W},${H - Math.exp(-(i / 60) * 5) * H}`).join(" ");
  const yLow = H - LOGIC.vilFraction * H;
  const xLow = (tLow / (5 * tc)) * W;

  return (
    <div className="lesson">
      <Explain id="debounce" level={level} />
      <div className="controls">
        <Pick label="R2" options={PULL_OPTIONS} value={r} onChange={setR} format={fmtOhms} />
        <Pick label="C1" options={CAP_OPTIONS} value={c} onChange={setC} format={(v) => `${v} nF`} />
      </div>
      <Formulas
        items={[
          tex`\tau = R_2 C_1 = ${texOhms(r)} \times ${c}\,\text{nF} = ${texSI(tc, "s")}`,
          tex`v(t) = V_{cc}\, e^{-t/\tau}`,
          tex`v(t) = 0.3\,V_{cc} \;\Rightarrow\; t = \tau \ln\frac{1}{0.3} \approx ${texSI(tLow, "s")}`,
        ]}
      />
      <svg viewBox={`-4 -6 ${W + 8} ${H + 24}`} className="plot">
        <line x1={0} y1={H} x2={W} y2={H} className="axis-line" />
        <line x1={0} y1={0} x2={0} y2={H} className="axis-line" />
        <line x1={0} x2={W} y1={yLow} y2={yLow} className="thresh" />
        <polyline points={pts} className="curve" key={`${r}-${c}`} />
        <line x1={xLow} x2={xLow} y1={yLow} y2={H} className="marker" />
        <circle cx={xLow} cy={yLow} r={3} className="marker-dot" />
        <text x={W} y={yLow - 5} className="axis end">LOW below 1.5 V</text>
        <text x={xLow} y={H + 14} className="axis mid">{fmtSI(tLow, "s", 2)}</text>
        <text x={W} y={H + 14} className="axis end">{fmtSI(5 * tc, "s", 2)}</text>
        <text x={4} y={8} className="axis">5 V</text>
      </svg>
    </div>
  );
}

function NetsLesson({ level, nets = EXAMPLE_NETS, ercFailing = true }: LessonProps) {
  const pins = nets.flatMap((n) => n.pins);
  const unique = new Set(pins).size === pins.length;
  const gnd = nets.find((n) => n.name === "GND");
  return (
    <div className="lesson">
      <Explain id="nets" level={level} />
      <Formulas
        items={[
          ...(gnd ? [tex`N_{GND} = \{${gnd.pins.map((p) => tex`\text{${p}}`).join(tex`,\ `)}\}`] : []),
          tex`\forall\, p:\ \bigl|\{\, n : p \in n \,\}\bigr| = 1 \qquad \forall\, n:\ |n| \ge 2`,
        ]}
      />
      <div className="net-table">
        {nets.map((n) => (
          <div key={n.name}>
            <code>{n.name}</code>
            <span>{n.pins.join("  ")}</span>
          </div>
        ))}
      </div>
      {unique ? <Ok>each of {pins.length} pins is in exactly one net</Ok> : <Bad>a pin is in two nets</Bad>}
      {ercFailing ? <Bad>GND has no power source → add a PWR_FLAG</Bad> : <Ok>KiCad's ERC passes: GND has a PWR_FLAG</Ok>}
    </div>
  );
}

function VerifyLesson({ params, level }: LessonProps) {
  const led = ledDesign(params.supply, params.ledVf, params.ledTargetMa, params.ledResistor);
  const vR1 = led.current * led.r;
  const kvl = params.supply - vR1 - params.ledVf;
  const items = [
    tex`\text{KVL:}\quad V_s - I R_1 - V_f = ${trim(params.supply)} - ${trim(vR1)} - ${trim(params.ledVf)} = ${trim(Math.abs(kvl) < 1e-9 ? 0 : kvl)}\,\text{V}`,
    tex`\text{KCL:}\quad I_{R_1} = I_{D_1} = ${texSI(led.current, "A")}`,
  ];
  if (level === "expert") items.push(tex`\mathbf{G}\,\mathbf{v} = \mathbf{i}`);
  return (
    <div className="lesson">
      <Explain id="verify" level={level} />
      <Formulas items={items} />
      <Ok>both laws hold, so the design is consistent</Ok>
    </div>
  );
}

export function Lesson({ id, params, level, nets, ercFailing }: { id: LessonId } & LessonProps) {
  const p = { params, level, nets, ercFailing };
  switch (id) {
    case "parse":
      return <ParseLesson {...p} />;
    case "power":
      return <PowerLesson {...p} />;
    case "led":
      return <LedLesson {...p} />;
    case "pulldown":
      return <PullDownLesson {...p} />;
    case "debounce":
      return <DebounceLesson {...p} />;
    case "nets":
      return <NetsLesson {...p} />;
    case "verify":
      return <VerifyLesson {...p} />;
  }
}
