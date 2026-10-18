import { useEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import { Tex } from "../Tex";
import { trim } from "../../math";

/** A number that eases to its new value instead of jumping. */
export function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduce || !Number.isFinite(value)) {
      from.current = value;
      setShown(value);
      return;
    }
    const c = animate(from.current, value, {
      duration: 0.4,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => {
        from.current = v;
        setShown(v);
      },
    });
    return () => c.stop();
  }, [value, reduce]);
  return <span className="num">{format(shown)}</span>;
}

export type Tone = "teal" | "orange" | "blue" | "purple" | "green" | "amber" | "red";

interface SliderProps {
  label: string;
  sym: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  tone: Tone;
  onChange: (v: number) => void;
}

/** Slider with a colored filled track, live value readout and min/max scale. */
export function LabSlider({ label, sym, value, min, max, step, unit, tone, onChange }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className={`lab-slider tone-${tone}`} style={{ ["--pct" as string]: `${pct}%` }}>
      <span className="ls-head">
        <span className="ls-sym">
          <Tex>{sym}</Tex>
        </span>
        <span className="ls-label">{label}</span>
        <span className="ls-val">
          {trim(value)}
          <small>{unit}</small>
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="ls-scale">
        <span>
          {min} {unit}
        </span>
        <span>
          {max} {unit}
        </span>
      </span>
    </label>
  );
}

/** Segmented control with a sliding active pill. */
export function Segmented<T extends string | number>({
  id,
  options,
  value,
  onChange,
  size = "md",
}: {
  id: string;
  options: { id: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className={`segmented ${size}`} role="radiogroup">
      {options.map((o) => (
        <button key={String(o.id)} role="radio" aria-checked={o.id === value} className={o.id === value ? "on" : ""} onClick={() => onChange(o.id)}>
          {o.id === value && <motion.span layoutId={`seg-${id}`} className="seg-pill" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
          <span className="seg-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="key">{children}</kbd>;
}

/** Section card with a small technical label in the corner. */
export function Panel({ tag, title, tone, className = "", children, aside }: { tag?: string; title?: React.ReactNode; tone?: Tone; className?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className={`panel ${tone ? `tone-${tone}` : ""} ${className}`}>
      {(tag || title || aside) && (
        <header className="panel-head">
          {tag && <span className="panel-tag">{tag}</span>}
          {title && <h3>{title}</h3>}
          {aside && <div className="panel-aside">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
