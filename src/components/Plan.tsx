import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChatMessage, KiCadStatus, Level, Project, Step } from "../types";
import { levelLabel } from "../data/explain";
import { Lesson } from "./Lessons";
import { Logo } from "./Logo";

const SPIN = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

/** Staggered entrance used for every transcript block (same feel as the tutorial). */
const enter = (i: number) => ({
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28, delay: 0.05 + i * 0.06, ease: [0.2, 0.8, 0.2, 1] as const },
});

function Spinner({ text }: { text: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % SPIN.length), 110);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="spinner-line">
      <span className="spin-glyph">{SPIN[i]}</span> {text} <span className="dim">(esc to interrupt)</span>
    </div>
  );
}

function Welcome({ project, isExample, kicad, level }: { project: Project; isExample: boolean; kicad: KiCadStatus; level: Level }) {
  return (
    <motion.div className="welcome" {...enter(0)}>
      <div className="welcome-main">
        <Logo size={34} animate />
        <div>
          <div className="welcome-title">
            Welcome to <b>CircuitForge</b>
          </div>
          <div className="welcome-meta">
            <span>
              project <b>{project.name}</b>
              {isExample && <i> example</i>}
            </span>
            <span>
              kicad <b className={kicad === "connected" ? "ok" : ""}>{kicad === "connected" ? "connected" : "not connected"}</b>
            </span>
            <span>
              explain <b>{levelLabel(level)}</b>
            </span>
          </div>
        </div>
      </div>
      <div className="welcome-tips">
        <div className="tips-title">Tips for getting started</div>
        <ol>
          <li>Describe a circuit in the box below, then click <b>generate circuit</b></li>
          <li>Click any step to see the math</li>
          <li>Open the tutorial for a guided walkthrough</li>
          <li>
            <kbd>shift</kbd>+<kbd>tab</kbd> changes how deep explanations go
          </li>
        </ol>
      </div>
    </motion.div>
  );
}

/** Todo list that ticks itself off on first render, like a live Claude Code run. */
function Todos({ steps, i }: { steps: Step[]; i: number }) {
  const [ticked, setTicked] = useState(0);
  useEffect(() => {
    if (ticked >= steps.length) return;
    const t = setTimeout(() => setTicked((n) => n + 1), ticked === 0 ? 650 : 140);
    return () => clearTimeout(t);
  }, [ticked, steps.length]);

  return (
    <motion.div className="tool" {...enter(i)}>
      <div className="tool-head static">
        <span className="bullet done">⏺</span>
        <span className="tool-name">Update Todos</span>
      </div>
      <div className="tool-out">
        <span className="elbow">⎿</span>
        <div className="todos">
          {steps.map((s, n) => {
            const done = n < ticked && s.status === "done";
            return (
              <div key={s.id} className={`todo-line ${done ? "done" : n < ticked ? s.status : ""}`}>
                <motion.span className="box" key={done ? "x" : "o"} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 22 }}>
                  {done ? "☒" : "☐"}
                </motion.span>
                <span className="todo-text">{s.title}</span>
                {n < ticked && s.status === "warning" && (
                  <motion.span className="warn" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    {" "}
                    · 1 issue
                  </motion.span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

interface StepRowProps {
  step: Step;
  i: number;
  open: boolean;
  flash: boolean;
  project: Project;
  level: Level;
  onToggle: () => void;
}

function StepRow({ step, i, open, flash, project, level, onToggle }: StepRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flash) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [flash]);

  const m = /^(\w+)\((.*)\)$/.exec(step.call);
  return (
    <motion.div ref={ref} className={`tool step${open ? " open" : ""}${flash ? " flash" : ""}`} {...enter(i)}>
      <button className="tool-head" onClick={onToggle} aria-expanded={open}>
        <span className={`bullet ${step.status}`}>⏺</span>
        <span className="tool-name">{m ? m[1] : step.call}</span>
        {m && <span className="tool-args">({m[2]})</span>}
        <span className="expand-hint">{open ? "hide" : "explain"}</span>
      </button>
      <div className="tool-out">
        <span className="elbow">⎿</span>
        <div className="out-lines">
          {step.lines.map((l, n) => (
            <div key={n} className={step.status === "warning" && n === step.lines.length - 1 ? "warn" : ""}>
              {l}
            </div>
          ))}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && step.lesson && (
          <motion.div className="tool-detail-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}>
            <div className="tool-detail">
              <Lesson id={step.lesson} params={project.params} level={level} nets={project.nets} ercFailing={project.checks.some((c) => c.id.startsWith("c-erc") && c.status === "fail")} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface PlanProps {
  project: Project;
  isExample: boolean;
  messages: ChatMessage[];
  openSteps: Set<string>;
  flashStep: string | null;
  level: Level;
  kicad: KiCadStatus;
  onToggleStep: (id: string) => void;
}

export function Plan({ project, isExample, messages, openSteps, flashStep, level, kicad, onToggleStep }: PlanProps) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const issues = project.checks.filter((c) => c.status === "fail").length;
  const base = 4; // blocks before the step list
  return (
    <div className="plan">
      <Welcome project={project} isExample={isExample} kicad={kicad} level={level} />

      <motion.div className="prompt-echo" {...enter(1)}>
        <span className="caret">&gt;</span>
        <span>{project.request}</span>
      </motion.div>

      <motion.div className="say" {...enter(2)}>
        <span className="bullet text">⏺</span>
        <span>
          I'll build this in {project.steps.length} steps. Only the first one uses AI. Everything after that is calculated, and you can click any
          step to see the math.
        </span>
      </motion.div>

      <Todos steps={project.steps} i={3} />

      {project.steps.map((s, n) => (
        <StepRow key={s.id} step={s} i={base + n} project={project} level={level} open={openSteps.has(s.id)} flash={flashStep === s.id} onToggle={() => onToggleStep(s.id)} />
      ))}

      <motion.div className="say" {...enter(base + project.steps.length)}>
        <span className="bullet text">⏺</span>
        <span>
          Done. {project.checks.length - issues}/{project.checks.length} checks pass.
          {issues > 0 &&
            (isExample
              ? " One thing to fix before KiCad's ERC passes: add a PWR_FLAG to the GND net."
              : ` ${issues === 1 ? "One check needs" : `${issues} checks need`} attention. Click ${issues === 1 ? "it" : "them"} on the right to see why.`)}
        </span>
      </motion.div>

      <AnimatePresence initial={false}>
        {messages.map((m) => (
          <motion.div key={m.id} className="exchange" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <div className="prompt-echo">
              <span className="caret">&gt;</span>
              <span>{m.text}</span>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              {m.state === "sending" ? (
                <motion.div key="s" exit={{ opacity: 0 }}>
                  <Spinner text="Planning…" />
                </motion.div>
              ) : (
                <motion.div key="r" className="tool" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="tool-head static">
                    <span className={`bullet ${m.state === "done" ? "done" : m.state === "error" ? "failed" : "warning"}`}>⏺</span>
                    <span className="tool-name">Plan</span>
                    <span className="tool-args">(request)</span>
                  </div>
                  <div className="tool-out">
                    <span className="elbow">⎿</span>
                    <div className={`out-lines ${m.state === "done" ? "" : m.state === "error" ? "bad" : "warn"}`}>{m.note}</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </AnimatePresence>
      <div ref={end} />
    </div>
  );
}
