import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/** Pixel-art Ω (ohm) mark. Each "X" is one pixel. */
export const LOGO_PIXELS = [
  "...XXXX...",
  ".XXX..XXX.",
  "XX......XX",
  "XX......XX",
  "XX......XX",
  ".XX....XX.",
  "..XX..XX..",
  "XXXX..XXXX",
];

const CELLS = LOGO_PIXELS.flatMap((row, y) => [...row].flatMap((c, x) => (c === "X" ? [[x, y] as const] : [])));

/** A jagged bolt from radius r0 to r1 along `angle`, in a -1..1 box. */
function bolt(angle: number, r0: number, r1: number): string {
  const steps = 4;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const r = r0 + ((r1 - r0) * i) / steps;
    const wobble = i === 0 || i === steps ? 0 : (Math.random() - 0.5) * 0.28;
    const a = angle + wobble;
    pts.push(`${(Math.cos(a) * r).toFixed(3)},${(Math.sin(a) * r).toFixed(3)}`);
  }
  return pts.join(" ");
}

/** Little arcs of electricity crackling around the logo while it thinks. */
function Sparks() {
  const [bolts, setBolts] = useState<{ d: string; o: number }[]>([]);
  useEffect(() => {
    const t = setInterval(() => {
      const n = 1 + Math.floor(Math.random() * 3);
      setBolts(
        Array.from({ length: n }, () => {
          const angle = Math.random() * Math.PI * 2;
          return { d: bolt(angle, 0.52, 0.8 + Math.random() * 0.18), o: 0.55 + Math.random() * 0.45 };
        }),
      );
    }, 90);
    return () => clearInterval(t);
  }, []);
  return (
    <svg className="sparks" viewBox="-1 -1 2 2" aria-hidden>
      {bolts.map((b, i) => (
        <g key={i} style={{ opacity: b.o }}>
          <polyline points={b.d} className="spark-glow" />
          <polyline points={b.d} className="spark-core" />
        </g>
      ))}
    </svg>
  );
}

interface LogoProps {
  size?: number;
  color?: string;
  /** Sweep the pixels in on first render. */
  animate?: boolean;
  /** Bob, twinkle, glow brighter and crackle with electricity (while the engine works). */
  thinking?: boolean;
  /** A small, occasional electric buzz while idle. */
  idle?: boolean;
  /** Crackle with electricity while the mouse is over it. */
  sparkOnHover?: boolean;
}

export function Logo({ size = 24, color = "var(--brand)", animate = false, thinking = false, idle = false, sparkOnHover = false }: LogoProps) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState(false);
  const charged = thinking || (sparkOnHover && hover);
  return (
    <span
      className={`logo-wrap${thinking ? " thinking" : ""}${idle && !charged ? " idle" : ""}${sparkOnHover && hover ? " charged" : ""}`}
      style={{ width: size, height: size }}
      onMouseEnter={sparkOnHover ? () => setHover(true) : undefined}
      onMouseLeave={sparkOnHover ? () => setHover(false) : undefined}
    >
      {charged && !reduce && <Sparks />}
      <svg viewBox="-1 -2 12 12" width={size} height={size} shapeRendering="crispEdges" aria-label="CircuitForge" role="img" className="logo">
        {CELLS.map(([x, y]) => (
          <motion.rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width={1.02}
            height={1.02}
            fill={color}
            className="px"
            style={{ animationDelay: `${(x + y) * 70}ms` }}
            initial={animate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18, delay: animate ? (x + y) * 0.03 : 0 }}
          />
        ))}
      </svg>
    </span>
  );
}
