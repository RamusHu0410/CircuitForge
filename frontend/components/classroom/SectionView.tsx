import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, X } from "lucide-react";
import type { LessonSection, LevelText, PlayParam } from "../../api/backend";
import type { Level, Project } from "../../types";
import { Tex } from "../Tex";
import { CodeEditor } from "../CodeEditor";
import { KiCadPreview } from "../KiCadPreview";
import { compile, formatValue } from "./evaluate";

export function LevelExplain({ text, level }: { text: LevelText; level: Level }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.p key={level} className="sv-explain" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.18 }}>
        {text[level]}
      </motion.p>
    </AnimatePresence>
  );
}

/* ---------- playground ---------- */

const isLog = (p: PlayParam) => p.min > 0 && p.max / p.min >= 100;
const toPos = (p: PlayParam, v: number) => (isLog(p) ? (Math.log(v / p.min) / Math.log(p.max / p.min)) * 1000 : ((v - p.min) / (p.max - p.min)) * 1000);
function fromPos(p: PlayParam, pos: number): number {
  if (isLog(p)) return Number((p.min * (p.max / p.min) ** (pos / 1000)).toPrecision(3));
  const v = p.min + ((p.max - p.min) * pos) / 1000;
  return Math.round(v / p.step) * p.step;
}

function Playground({ pg }: { pg: NonNullable<LessonSection["playground"]> }) {
  const initial = useMemo(() => Object.fromEntries(pg.params.map((p) => [p.name, p.value])), [pg]);
  const [values, setValues] = useState<Record<string, number>>(initial);
  const [active, setActive] = useState<string | null>(null);
  const names = pg.params.map((p) => p.name);
  const outputs = useMemo(() => pg.outputs.map((o) => ({ o, fn: compile(o.expr, names) })), [pg]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = pg.params.some((p) => values[p.name] !== p.value);

  return (
    <div className="sv-play">
      <div className="sv-play-head">
        <span className="sv-tag">what if?</span>
        <span className="dim">{pg.caption || "Move the sliders. Your generated circuit isn't changed."}</span>
        {changed && (
          <button className="link" onClick={() => setValues(initial)}>
            [reset]
          </button>
        )}
      </div>
      <div className="sv-play-grid">
        <div className="sv-sliders">
          {pg.params.map((p) => {
            const pct = Math.min(100, Math.max(0, toPos(p, values[p.name]) / 10));
            return (
              <label key={p.name} className={`sv-slider${active === p.name ? " active" : ""}`} style={{ ["--pct" as string]: `${pct}%` }}>
                <span className="sv-slider-top">
                  <span className="sv-sym">
                    <Tex>{p.tex}</Tex>
                  </span>
                  <span className="dim">{p.label}</span>
                  <b>{formatValue(values[p.name], p.unit)}</b>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1000}
                  step={1}
                  value={toPos(p, values[p.name])}
                  onPointerDown={() => setActive(p.name)}
                  onPointerUp={() => setActive(null)}
                  onChange={(e) => setValues((v) => ({ ...v, [p.name]: fromPos(p, Number(e.target.value)) }))}
                />
              </label>
            );
          })}
        </div>
        <div className="sv-outputs">
          {outputs.map(({ o, fn }) => {
            const v = fn ? fn(values) : NaN;
            const over = o.max_ok != null && v > o.max_ok;
            return (
              <div key={o.label} className={`sv-out${over ? " over" : ""}`}>
                <span className="sv-out-label">
                  <Tex>{o.tex}</Tex> {o.label}
                </span>
                <motion.b key={formatValue(v, o.unit, o.digits)} initial={{ opacity: 0.4, y: -2 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
                  {formatValue(v, o.unit, o.digits)}
                </motion.b>
                {over && <span className="sv-out-note">{o.limit_note}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- quiz ---------- */

function Quiz({ section, answers, onAnswer }: { section: LessonSection; answers: Record<string, number>; onAnswer: (key: string, choice: number) => void }) {
  return (
    <div className="sv-quiz">
      {section.quiz.map((q, qi) => {
        const key = `${section.id}:${qi}`;
        const chosen = answers[key];
        const done = chosen !== undefined;
        return (
          <div key={key} className="sv-q">
            <div className="sv-q-head">
              <span className="sv-tag quiz">check yourself</span>
              <span>{q.question}</span>
            </div>
            <div className="sv-q-options">
              {q.options.map((opt, oi) => {
                const state = !done ? "" : oi === q.answer ? "is-right" : oi === chosen ? "is-wrong" : "is-dim";
                return (
                  <motion.button key={opt} className={`sv-opt ${state}`} whileTap={done ? undefined : { scale: 0.97 }} disabled={done} onClick={() => onAnswer(key, oi)}>
                    {state === "is-right" && <Check size={13} />}
                    {state === "is-wrong" && <X size={13} />}
                    {opt}
                  </motion.button>
                );
              })}
            </div>
            <AnimatePresence>
              {done && (
                <motion.p className={`sv-why ${chosen === q.answer ? "is-right" : "is-wrong"}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                  <b>{chosen === q.answer ? "Right." : "Not quite."}</b> {q.why}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- the section ---------- */

interface Props {
  section: LessonSection;
  level: Level;
  project: Project;
  compact?: boolean;
  answers: Record<string, number>;
  onAnswer: (key: string, choice: number) => void;
  done?: Record<string, boolean>;
  onDone?: (key: string) => void;
  onOpen?: (sectionId: string) => void;
}

export function SectionView({ section: s, level, project, compact = false, answers, onAnswer, done = {}, onDone, onOpen }: Props) {
  return (
    <div className={`sv${compact ? " compact" : ""}`}>
      <LevelExplain text={s.text} level={level} />

      {s.kind === "overview" && !compact && project.files && (
        <div className="sv-figure">
          <KiCadPreview files={project.files} />
          <span className="sv-caption">your circuit, drawn by KiCad</span>
        </div>
      )}

      {s.facts.length > 0 && (
        <dl className="sv-facts">
          {s.facts.slice(0, compact ? 4 : undefined).map((f, i) => (
            <motion.div key={f.label + i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i }}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </motion.div>
          ))}
        </dl>
      )}

      {s.formulas.length > 0 && (
        <div className="sv-formulas">
          {s.formulas.map((f, i) => (
            <div key={i} className="sv-formula">
              <Tex block>{f.tex}</Tex>
              {f.caption && <span className="sv-caption">{f.caption}</span>}
            </div>
          ))}
        </div>
      )}

      {s.playground && <Playground pg={s.playground} />}

      {!compact &&
        s.code.map((c) => (
          <div key={c.title} className="sv-code">
            <div className="sv-code-head">
              <b>{c.title}</b>
              <span className="dim">line {c.start_line}</span>
            </div>
            <LevelExplain text={c.explain} level={level} />
            <CodeEditor value={c.code} readOnly firstLine={c.start_line} height="auto" />
          </div>
        ))}

      {!compact && s.steps.length > 0 && (
        <ol className="sv-steps">
          {s.steps.map((st, i) => {
            const key = `${s.id}:${i}`;
            return (
              <li key={key} className={done[key] ? "done" : ""}>
                <button className="sv-step-check" onClick={() => onDone?.(key)} aria-label={done[key] ? "Mark not done" : "Mark done"}>
                  {done[key] ? <Check size={13} strokeWidth={3} /> : String(i + 1).padStart(2, "0")}
                </button>
                <div>
                  <b>
                    {st.title} {st.key && <kbd className="sv-key">{st.key}</kbd>}
                  </b>
                  <p>{st.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!compact && s.quiz.length > 0 && <Quiz section={s} answers={answers} onAnswer={onAnswer} />}

      {compact && onOpen && (
        <button className="link sv-open" onClick={() => onOpen(s.id)}>
          open in the classroom ›
        </button>
      )}
    </div>
  );
}
