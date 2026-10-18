import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Logo } from "./Logo";

/**
 * What the engine works through for a prompt, phrased as thoughts. These describe the real
 * pipeline stages (read prompt, pick a template, parts, values, wiring, KiCad ERC); the
 * backend doesn't stream them, so they play while it works.
 */
export function thoughtsFor(prompt: string): string[] {
  const p = prompt.toLowerCase();
  const short = prompt.length > 48 ? `${prompt.slice(0, 46)}…` : prompt;
  const out = [`Reading “${short}”`];
  const behaviour = /twice|double|once|three times|toggle|hold|held|within|under \d|long press|blinks? when|when .*press/.test(p);
  if (/button|switch|press/.test(p)) out.push("There's a button, so something has to read an input");
  if (/led|light/.test(p)) out.push("Every LED needs a resistor to limit its current");
  if (behaviour) out.push("That's behaviour over time: a microcontroller has to count and keep time", "Writing the C++ firmware with the same pins as the schematic");
  if (/555|hz/.test(p)) out.push("A 555 timer can make the blinking on its own");
  if (/divider|regulat|ldo|filter/.test(p)) out.push("Working out the voltages first");
  out.push("Picking symbols from KiCad's own libraries", "Calculating the values with Ohm's law", "Routing wires on the 2.54 mm grid", "Asking KiCad to run its electrical rules check");
  return out;
}

const TYPE_MS = 26;
const DELETE_MS = 11;
const HOLD_MS = 700;

/** Types a thought, holds it, deletes it, moves on to the next one. */
function useTypewriter(lines: string[]): string {
  const reduce = useReducedMotion();
  const [state, setState] = useState({ line: 0, chars: 0, deleting: false });
  useEffect(() => {
    if (reduce) return;
    const text = lines[state.line % lines.length];
    let delay = TYPE_MS;
    let next = state;
    if (!state.deleting && state.chars < text.length) next = { ...state, chars: state.chars + 1 };
    else if (!state.deleting) {
      delay = HOLD_MS;
      next = { ...state, deleting: true };
    } else if (state.chars > 0) {
      delay = DELETE_MS;
      next = { ...state, chars: state.chars - 1 };
    } else next = { line: (state.line + 1) % lines.length, chars: 0, deleting: false };
    const t = setTimeout(() => setState(next), delay);
    return () => clearTimeout(t);
  }, [state, lines, reduce]);
  if (reduce) return lines[0];
  return lines[state.line % lines.length].slice(0, state.chars);
}

export function ThinkingLine({ prompt }: { prompt: string }) {
  const lines = useMemo(() => thoughtsFor(prompt), [prompt]);
  const text = useTypewriter(lines);
  return (
    <div className="thinking-line" role="status" aria-live="polite" aria-label="Thinking">
      <Logo size={22} thinking />
      <span className="thinking-word">Thinking…</span>
      <span className="thought">
        {text}
        <span className="caret-block" />
      </span>
    </div>
  );
}
