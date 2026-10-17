import { motion } from "motion/react";

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

/** `animate` sweeps the pixels in diagonally, like the tutorial's entrance animations. */
export function Logo({ size = 24, color = "var(--claude)", animate = false }: { size?: number; color?: string; animate?: boolean }) {
  return (
    <svg viewBox="-1 -2 12 12" width={size} height={size} shapeRendering="crispEdges" aria-label="CircuitForge" role="img" className="logo">
      {CELLS.map(([x, y]) => (
        <motion.rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={1.02}
          height={1.02}
          fill={color}
          initial={animate ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, delay: animate ? (x + y) * 0.03 : 0 }}
        />
      ))}
    </svg>
  );
}
