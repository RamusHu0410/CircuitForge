/**
 * "How it works": a small animated cut-away of the part, driven by the live simulation (an LED's
 * light, a resistor's heat, a capacitor's charge...). `step` is the story step the student is on,
 * and each picture emphasises what that step talks about.
 */

import { useEffect, useState } from "react";
import type { PartReading } from "../../lab/sim";
import { BAND_NAMES, LED_RGB, ledColor, parseValue, resistorBands, si } from "../../lab/values";
import { ELECTRON } from "./types";

function useClock(): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return t;
}

/** Points along a polyline at fraction f (0..1). */
function along(pts: [number, number][], f: number): [number, number] {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = lens.reduce((a, b) => a + b, 0);
  let d = (((f % 1) + 1) % 1) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]) {
      const k = lens[i] ? d / lens[i] : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    d -= lens[i];
  }
  return pts[pts.length - 1];
}

function Dots({ path, n, t, speed, r = 3, color = ELECTRON, reverse = false }: { path: [number, number][]; n: number; t: number; speed: number; r?: number; color?: string; reverse?: boolean }) {
  if (n <= 0 || speed <= 0) return null;
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const f = (t * speed + i / n) % 1;
        const [x, y] = along(path, reverse ? 1 - f : f);
        return <circle key={i} cx={x} cy={y} r={r} fill={color} />;
      })}
    </>
  );
}

const Minus = ({ x, y, color = "#fff" }: { x: number; y: number; color?: string }) => <path d={`M${x - 2} ${y}h4`} stroke={color} strokeWidth={1.2} />;

interface InsideProps {
  kind: string;
  value: string;
  reading: PartReading | undefined;
  pinV: Record<string, number>;
  step: number;
}

export function Inside(props: InsideProps) {
  const t = useClock();
  const Drawing = DRAWINGS[props.kind] ?? Generic;
  return (
    <svg className="inside" viewBox="0 0 300 170" role="img" aria-label={`How a ${props.kind.replace(/_/g, " ")} works`}>
      <Drawing key={props.kind} {...props} t={t} />
    </svg>
  );
}

type Draw = (p: InsideProps & { t: number }) => React.ReactNode;

const Led: Draw = ({ value, reading, step, t }) => {
  const color = LED_RGB[ledColor(value)];
  const level = Math.min(1, reading?.level ?? 0);
  const on = level > 0.03;
  const flowing = on ? 0.35 + level * 0.6 : 0;
  const photons = Math.round(level * 9);
  const cathodePath: [number, number][] = [
    [110, 168],
    [110, 96],
    [128, 96],
    [140, 82],
  ];
  if (step === 1) {
    // Zoom into the junction: electrons (n side) drop into holes (p side).
    return (
      <>
        <rect x={40} y={40} width={110} height={90} rx={6} fill="#dbe9ff" />
        <rect x={150} y={40} width={110} height={90} rx={6} fill="#ffe1dc" />
        <text x={95} y={32} textAnchor="middle" className="ins-t">n-side: spare electrons</text>
        <text x={205} y={32} textAnchor="middle" className="ins-t">p-side: holes</text>
        <line x1={150} y1={36} x2={150} y2={134} stroke="#888" strokeDasharray="3 3" />
        {Array.from({ length: 6 }, (_, i) => {
          const f = (t * (0.25 + flowing * 0.5) + i / 6) % 1;
          const x = 50 + f * 100;
          const y = 55 + (i % 3) * 28;
          return <g key={i}><circle cx={x} cy={y} r={5} fill={ELECTRON} /><Minus x={x} y={y} /></g>;
        })}
        {Array.from({ length: 6 }, (_, i) => {
          const f = (t * (0.25 + flowing * 0.5) + i / 6 + 0.5) % 1;
          const x = 250 - f * 100;
          const y = 69 + (i % 3) * 28;
          return <circle key={i} cx={x} cy={y} r={5} fill="none" stroke="#c0392b" strokeWidth={1.6} />;
        })}
        {on && Array.from({ length: 3 }, (_, i) => {
          const f = (t * 1.2 + i / 3) % 1;
          return <path key={i} d={`M150 ${60 + i * 25} q 6 -6 12 0 t 12 0 t 12 0`} transform={`translate(${f * 60 - 20} ${-f * 30})`} stroke={color} strokeWidth={2.5} fill="none" opacity={1 - f} />;
        })}
        <text x={150} y={156} textAnchor="middle" className="ins-t">{on ? "each meeting releases a photon of light" : "no current: they stay apart"}</text>
      </>
    );
  }
  return (
    <>
      {/* legs: cathode (short, left, with the cup), anode (long, right) */}
      <path d="M110 168V96h18" stroke="#9aa3ad" strokeWidth={5} fill="none" className={step === 0 ? "ins-hl" : undefined} />
      <path d="M190 168V96h-30" stroke="#9aa3ad" strokeWidth={5} fill="none" />
      <path d="M124 90l10 10h14l10-10z" fill="#8a929b" />
      <rect x={136} y={78} width={12} height={10} fill={on ? "#fff" : "#555"} />
      <path d="M142 78q12-14 30 18" stroke="#c7a54a" strokeWidth={1.2} fill="none" />
      {/* epoxy dome */}
      <path d="M95 110V60a55 55 0 0 1 110 0v50z" fill={color} opacity={0.22 + level * 0.45} stroke={color} />
      <rect x={90} y={108} width={120} height={8} rx={2} fill={color} opacity={0.4} />
      {on && <circle cx={142} cy={80} r={20 + level * 30} fill={color} opacity={0.25 + level * 0.3} />}
      {on &&
        Array.from({ length: photons }, (_, i) => {
          const a = -Math.PI / 2 + (i - (photons - 1) / 2) * 0.32;
          const f = (t * 0.9 + i / photons) % 1;
          const r0 = 16 + f * 70;
          return <circle key={i} cx={142 + Math.cos(a) * r0} cy={80 + Math.sin(a) * r0} r={3} fill={color} opacity={1 - f} />;
        })}
      <Dots path={cathodePath} n={on ? 5 : 0} t={t} speed={flowing} />
      <Dots path={[[160, 96], [190, 96], [190, 168]]} n={on ? 4 : 0} t={t} speed={flowing} />
      {step === 3 && (
        <text x={150} y={20} textAnchor="middle" className="ins-t">backwards: the junction blocks, nothing flows</text>
      )}
      <text x={104} y={160} textAnchor="end" className="ins-t">cathode −</text>
      <text x={196} y={160} className="ins-t">anode +</text>
    </>
  );
};

const Resistor: Draw = ({ value, reading, step, t }) => {
  const i = reading?.i ?? 0;
  const heat = Math.min(1, Math.sqrt((reading?.p ?? 0) / 0.25));
  const speed = i > 1e-6 ? 0.08 + Math.min(0.5, Math.log10(1 + i * 1e4) * 0.12) : 0;
  const bands = resistorBands(parseValue(value) ?? 0);
  const [hover, setHover] = useState<number | null>(null);
  const jiggle = 0.6 + heat * 3;
  return (
    <>
      <line x1={0} y1={85} x2={300} y2={85} stroke="#9aa3ad" strokeWidth={4} />
      <rect x={60} y={55} width={180} height={60} rx={26} fill="#d8c191" stroke="#a88d55" />
      {step <= 1 &&
        Array.from({ length: 24 }, (_, k) => {
          const x = 80 + (k % 8) * 20;
          const y = 68 + Math.floor(k / 8) * 17;
          return <circle key={k} cx={x + Math.sin(t * 20 + k) * jiggle} cy={y + Math.cos(t * 17 + k * 2) * jiggle} r={4} fill={heat > 0.05 ? `hsl(${30 - heat * 30} 90% ${60 - heat * 10}%)` : "#c6ad73"} />;
        })}
      {step <= 1 && <Dots path={[[0, 85], [70, 85], [110, 78], [150, 92], [190, 76], [230, 90], [300, 85]]} n={9} t={t} speed={speed} r={3.2} />}
      {step === 1 &&
        heat > 0.02 &&
        Array.from({ length: 4 }, (_, k) => {
          const f = (t * 0.6 + k / 4) % 1;
          return <path key={k} d={`M${95 + k * 35} 50 q -6 -8 0 -16 t 0 -16`} stroke="#e65b2a" strokeWidth={2} fill="none" opacity={(1 - f) * heat} transform={`translate(0 ${-f * 20})`} />;
        })}
      {step === 2 && (
        <>
          <text x={150} y={92} textAnchor="middle" className="ins-big">V = I × R</text>
          <text x={150} y={140} textAnchor="middle" className="ins-t">
            {reading ? `${si(reading.v, "V")} = ${si(i, "A")} × ${si(parseValue(value) ?? 0, "Ω")}` : ""}
          </text>
        </>
      )}
      {step === 3 &&
        bands.colors.map((c, k) => (
          <rect key={k} x={92 + k * 30 + (k === 3 ? 22 : 0)} y={55} width={14} height={60} fill={c} className="ins-band" onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} onClick={() => setHover(k)} />
        ))}
      {step === 3 && (
        <text x={150} y={150} textAnchor="middle" className="ins-t">
          {hover === null
            ? `${bands.names.slice(0, 3).join(" · ")} → ${value}Ω  (click a band)`
            : hover < 2
              ? `${bands.names[hover]} = digit ${BAND_NAMES.indexOf(bands.names[hover])}`
              : hover === 2
                ? `${bands.names[2]} = × 10^${BAND_NAMES.indexOf(bands.names[2])}`
                : "gold = ±5% tolerance"}
        </text>
      )}
      {step <= 1 && <text x={150} y={150} textAnchor="middle" className="ins-t">{i > 1e-6 ? `${si(i, "A")} → ${si(reading?.p ?? 0, "W")} of heat` : "no current: the atoms sit still"}</text>}
    </>
  );
};

const Capacitor: Draw = ({ reading, t }) => {
  const v = reading?.v ?? 0;
  const charge = Math.min(1, Math.abs(v) / 9);
  const n = Math.round(charge * 10);
  const flowing = Math.abs(reading?.i ?? 0) > 1e-7;
  const charging = (reading?.i ?? 0) * v >= 0;
  return (
    <>
      <line x1={0} y1={85} x2={125} y2={85} stroke="#9aa3ad" strokeWidth={4} />
      <line x1={175} y1={85} x2={300} y2={85} stroke="#9aa3ad" strokeWidth={4} />
      <rect x={120} y={25} width={10} height={120} fill="#7d8792" />
      <rect x={170} y={25} width={10} height={120} fill="#7d8792" />
      <rect x={131} y={25} width={38} height={120} fill="#f3e6c4" opacity={0.6} />
      {Array.from({ length: n }, (_, k) => (
        <g key={k}>
          <circle cx={113} cy={32 + k * 11.5} r={4.5} fill={ELECTRON} />
          <Minus x={113} y={32 + k * 11.5} />
          <text x={188} y={36 + k * 11.5} className="ins-plus">+</text>
        </g>
      ))}
      {Array.from({ length: 5 }, (_, k) => (
        <line key={k} x1={133} x2={167} y1={40 + k * 22} y2={40 + k * 22} stroke="#e0a34a" strokeWidth={1.5} opacity={charge} markerEnd="" />
      ))}
      {flowing && <Dots path={charging ? [[0, 85], [118, 85]] : [[118, 85], [0, 85]]} n={4} t={t} speed={0.5} />}
      {flowing && <Dots path={charging ? [[182, 85], [300, 85]] : [[300, 85], [182, 85]]} n={4} t={t} speed={0.5} />}
      <text x={150} y={165} textAnchor="middle" className="ins-t">{`${reading?.state ?? ""} · ${si(Math.abs(v), "V")}`}</text>
    </>
  );
};

const Battery: Draw = ({ reading, t }) => {
  const i = reading?.i ?? 0;
  const speed = i > 1e-6 ? 0.15 + Math.min(0.4, Math.log10(1 + i * 1e4) * 0.1) : 0;
  return (
    <>
      <rect x={110} y={30} width={80} height={110} rx={8} fill="#26282c" />
      <rect x={110} y={60} width={80} height={45} fill="#e2a72e" />
      <text x={150} y={22} textAnchor="middle" className="ins-t">+ terminal</text>
      <text x={150} y={160} textAnchor="middle" className="ins-t">− terminal</text>
      {[0, 1, 2].map((k) => {
        const f = (t * 0.5 + k / 3) % 1;
        return <path key={k} d="M135 0l15-12 15 12" transform={`translate(0 ${130 - f * 90})`} stroke="#fff" strokeWidth={3} fill="none" opacity={speed ? 1 - f : 0.2} />;
      })}
      <path d="M150 140v20h120V10H150v20" stroke="#9aa3ad" strokeWidth={4} fill="none" />
      <Dots path={[[150, 160], [270, 160], [270, 10], [150, 10]]} n={12} t={t} speed={speed} />
      <text x={262} y={90} textAnchor="end" className="ins-t">the circuit</text>
      <text x={60} y={90} textAnchor="middle" className="ins-t">chemistry</text>
      <text x={60} y={104} textAnchor="middle" className="ins-t">pushes them</text>
    </>
  );
};

const Button: Draw = ({ reading, step, t }) => {
  const pressed = (reading?.level ?? 0) > 0 || (step === 2 && Math.sin(t * 40) > 0 && (t % 2) < 0.4);
  return (
    <>
      <line x1={0} y1={120} x2={95} y2={120} stroke="#9aa3ad" strokeWidth={4} />
      <line x1={205} y1={120} x2={300} y2={120} stroke="#9aa3ad" strokeWidth={4} />
      <rect x={90} y={112} width={40} height={14} fill="#c9a14a" />
      <rect x={170} y={112} width={40} height={14} fill="#c9a14a" />
      <path d={pressed ? "M88 110q62 6 124 0" : "M88 108q62-40 124 0"} stroke="#aab2bc" strokeWidth={5} fill="none" />
      <rect x={135} y={pressed ? 64 : 40} width={30} height={40} rx={4} fill="#d9493c" />
      <rect x={60} y={126} width={180} height={20} rx={3} fill="#1e1f22" />
      {pressed && <Dots path={[[0, 120], [95, 120], [130, 112], [170, 112], [205, 120], [300, 120]]} n={8} t={t} speed={0.5} />}
      <text x={150} y={22} textAnchor="middle" className="ins-t">{pressed ? "pressed: the dome bridges the contacts" : "released: there's a gap"}</text>
    </>
  );
};

const Diode: Draw = ({ reading, t }) => {
  const open = (reading?.i ?? 0) > 5e-4;
  return (
    <>
      <line x1={0} y1={85} x2={300} y2={85} stroke="#9aa3ad" strokeWidth={4} />
      <rect x={110} y={55} width={80} height={60} rx={6} fill="#1d1d20" />
      <rect x={112} y={55} width={14} height={60} fill="#d8dde4" />
      <path d={open ? "M150 62l30 18" : "M150 62v46"} stroke="#e0a34a" strokeWidth={5} />
      <Dots path={[[0, 85], [300, 85]]} n={open ? 8 : 0} t={t} speed={0.4} reverse />
      <text x={150} y={150} textAnchor="middle" className="ins-t">{open ? "forward: the flap swings open" : "the flap is shut"}</text>
    </>
  );
};

const Npn: Draw = ({ reading, t }) => {
  const level = Math.min(1, reading?.level ?? 0);
  const on = level > 0.02;
  return (
    <>
      <rect x={120} y={20} width={60} height={50} fill="#dbe9ff" />
      <rect x={120} y={70} width={60} height={14} fill="#ffe1dc" />
      <rect x={120} y={84} width={60} height={50} fill="#dbe9ff" />
      <text x={190} y={48} className="ins-t">collector (N)</text>
      <text x={190} y={81} className="ins-t">base (P), thin</text>
      <text x={190} y={115} className="ins-t">emitter (N)</text>
      <line x1={40} y1={77} x2={120} y2={77} stroke="#9aa3ad" strokeWidth={3} />
      <line x1={150} y1={0} x2={150} y2={20} stroke="#9aa3ad" strokeWidth={5} />
      <line x1={150} y1={134} x2={150} y2={170} stroke="#9aa3ad" strokeWidth={5} />
      <Dots path={[[150, 168], [150, 2]]} n={on ? Math.round(4 + level * 10) : 0} t={t} speed={0.3 + level * 0.4} r={3.5} />
      <Dots path={[[150, 100], [120, 77], [40, 77]]} n={on ? 2 : 0} t={t} speed={0.25} r={2.4} />
      <text x={30} y={66} className="ins-t">small</text>
      <text x={60} y={30} textAnchor="middle" className="ins-t">{on ? "big flow switched on" : "off: the base blocks"}</text>
    </>
  );
};

const Pot: Draw = ({ reading, pinV }) => {
  const pos = reading?.level ?? 0.5;
  const a = (-135 + 270 * pos) * (Math.PI / 180);
  const top = Math.max(pinV["1"] ?? 0, pinV["3"] ?? 0);
  return (
    <>
      <defs>
        <linearGradient id="track" x1="0" x2="1">
          <stop offset="0" stopColor="hsl(225 85% 48%)" />
          <stop offset="1" stopColor="hsl(0 85% 48%)" />
        </linearGradient>
      </defs>
      <path d="M93 128A70 70 0 1 1 207 128" stroke="url(#track)" strokeWidth={14} fill="none" />
      <line x1={150} y1={88} x2={150 + Math.sin(a) * 66} y2={88 - Math.cos(a) * 66} stroke="#222" strokeWidth={5} strokeLinecap="round" />
      <circle cx={150} cy={88} r={10} fill="#f2f2ee" stroke="#222" />
      <text x={150} y={160} textAnchor="middle" className="ins-t">{`wiper ${si(reading?.v ?? 0, "V")} of ${si(top, "V")}`}</text>
    </>
  );
};

const Buzzer: Draw = ({ reading, t }) => {
  const on = (reading?.level ?? 0) > 0.2;
  const bend = on ? Math.sin(t * 30) * 8 : 0;
  return (
    <>
      <path d={`M80 100Q150 ${100 + bend} 220 100`} stroke="#c9a14a" strokeWidth={6} fill="none" />
      <path d={`M95 96Q150 ${96 + bend} 205 96`} stroke="#e8e2d0" strokeWidth={4} fill="none" />
      {on && [0, 1, 2].map((k) => {
        const f = (t * 1.2 + k / 3) % 1;
        return <path key={k} d={`M${110 - f * 40} ${70 - f * 40}A${60 + f * 60} ${60 + f * 60} 0 0 1 ${190 + f * 40} ${70 - f * 40}`} stroke="#888" fill="none" opacity={1 - f} />;
      })}
      <text x={150} y={150} textAnchor="middle" className="ins-t">{on ? "the disc flexes thousands of times a second" : "no current: silent"}</text>
    </>
  );
};

const Timer555: Draw = ({ reading, pinV }) => {
  const vcc = (pinV["8"] ?? 0) - (pinV["1"] ?? 0);
  const vcap = (pinV["6"] ?? pinV["2"] ?? 0) - (pinV["1"] ?? 0);
  const high = (reading?.level ?? 0) > 0;
  const frac = vcc > 0 ? Math.max(0, Math.min(1, vcap / vcc)) : 0;
  const y = (f: number) => 150 - f * 130;
  return (
    <>
      <rect x={60} y={20} width={40} height={130} rx={4} fill="#eef1f5" stroke="#9aa3ad" />
      <rect x={62} y={y(frac)} width={36} height={150 - y(frac)} fill={ELECTRON} opacity={0.75} />
      <line x1={50} x2={110} y1={y(2 / 3)} y2={y(2 / 3)} stroke="#c0392b" strokeDasharray="4 3" />
      <line x1={50} x2={110} y1={y(1 / 3)} y2={y(1 / 3)} stroke="#2c7a39" strokeDasharray="4 3" />
      <text x={114} y={y(2 / 3) + 4} className="ins-t">2/3: flip LOW, empty</text>
      <text x={114} y={y(1 / 3) + 4} className="ins-t">1/3: flip HIGH, fill</text>
      <text x={80} y={166} textAnchor="middle" className="ins-t">{`capacitor ${si(vcap, "V")}`}</text>
      <circle cx={262} cy={30} r={14} fill={high ? "#ffcf3a" : "#444"} />
      <text x={262} y={58} textAnchor="middle" className="ins-t">{high ? "OUT HIGH" : "OUT LOW"}</text>
      <text x={262} y={140} textAnchor="middle" className="ins-t">{high ? "discharge off" : "discharging"}</text>
    </>
  );
};

const Regulator: Draw = ({ pinV, kind }) => {
  const [inPin, gndPin, outPin] = kind === "regulator_7805" ? ["1", "2", "3"] : ["3", "1", "2"];
  const vin = (pinV[inPin] ?? 0) - (pinV[gndPin] ?? 0);
  const vout = (pinV[outPin] ?? 0) - (pinV[gndPin] ?? 0);
  const scale = (v: number) => (Math.max(0, v) / Math.max(1, vin)) * 120;
  return (
    <>
      <rect x={70} y={150 - scale(vin)} width={40} height={scale(vin)} fill="hsl(10 85% 55%)" />
      <rect x={190} y={150 - scale(vout)} width={40} height={scale(vout)} fill="hsl(200 85% 50%)" />
      <rect x={110} y={150 - scale(vin)} width={80} height={scale(vin) - scale(vout)} fill="#ffb37a" opacity={0.5} />
      <text x={150} y={150 - (scale(vin) + scale(vout)) / 2} textAnchor="middle" className="ins-t">{`${si(Math.max(0, vin - vout), "V")} → heat`}</text>
      <text x={90} y={165} textAnchor="middle" className="ins-t">{`in ${si(vin, "V")}`}</text>
      <text x={210} y={165} textAnchor="middle" className="ins-t">{`out ${si(vout, "V")}`}</text>
    </>
  );
};

const Generic: Draw = ({ kind, pinV }) => {
  const pins = Object.entries(pinV).slice(0, 10);
  return (
    <>
      <rect x={110} y={20} width={80} height={130} rx={6} fill="#1d1d20" />
      <text x={150} y={90} textAnchor="middle" fill="#e9ecef" fontSize={11}>
        {kind.replace(/_/g, " ").slice(0, 14)}
      </text>
      {pins.map(([num, v], k) => {
        const left = k % 2 === 0;
        const y = 34 + Math.floor(k / 2) * 24;
        const high = v > 2.5;
        return (
          <g key={num}>
            <line x1={left ? 70 : 190} x2={left ? 110 : 230} y1={y} y2={y} stroke={high ? "#e65b2a" : "#9aa3ad"} strokeWidth={4} />
            <text x={left ? 64 : 236} y={y + 4} textAnchor={left ? "end" : "start"} className="ins-t">{`${num}: ${si(v, "V")}`}</text>
          </g>
        );
      })}
    </>
  );
};

const DRAWINGS: Record<string, Draw> = {
  led: Led,
  resistor: Resistor,
  capacitor: Capacitor,
  capacitor_polarized: Capacitor,
  battery: Battery,
  push_button: Button,
  diode: Diode,
  npn_transistor: Npn,
  potentiometer: Pot,
  buzzer: Buzzer,
  timer_555: Timer555,
  regulator_7805: Regulator,
  regulator_ams1117_3v3: Regulator,
};
