import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChatMessage, KiCadStatus, Level, Project, Step } from "../types";
import { levelLabel } from "../data/explain";
import { Lesson } from "./Lessons";
import { Logo } from "./Logo";
import { ThinkingLine } from "./Thinking";
import { CodeEditor } from "./CodeEditor";
import { SectionView } from "./classroom/SectionView";
import { EXAMPLE_PROJECT } from "../data/example";


export interface KiCadInfo {
  status: KiCadStatus;
  label: string;
}

/** Result of an action on a generated circuit (place / save), shown as a tool call. */
export interface ActionEntry {
  id: number;
  call: string;
  state: "running" | "done" | "error";
  lines: string[];
}

/** Staggered entrance used for every transcript block (same feel as the tutorial). */
const enter = (i: number) => ({
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28, delay: 0.05 + i * 0.06, ease: [0.2, 0.8, 0.2, 1] as const },
});

function Welcome({ project, kicad, level, thinking, onClose }: { project: Project | null; kicad: KiCadInfo; level: Level; thinking: boolean; onClose: () => void }) {
  return (
    <motion.div className="welcome" {...enter(0)} exit={{ opacity: 0, height: 0, marginBottom: -10 }}>
      <button className="welcome-close" onClick={onClose} aria-label="Close the welcome box" title="close">
        ×
      </button>
      <div className="welcome-main">
        <Logo size={34} animate thinking={thinking} />
        <div>
          <div className="welcome-title">
            Welcome to <b>CircuitForge</b>
          </div>
          <div className="welcome-meta">
            <span>
              project <b>{project ? project.name : "none yet"}</b>
            </span>
            <span>
              kicad <b className={kicad.status === "connected" ? "ok" : ""}>{kicad.label}</b>
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
          <li>Describe a circuit below, or pick an example</li>
          <li>Place it straight into the schematic you have open</li>
          <li>Click any step to see why, or open the classroom</li>
          <li>
            <kbd>shift</kbd>+<kbd>tab</kbd> changes how deep explanations go
          </li>
        </ol>
      </div>
    </motion.div>
  );
}

export const EXAMPLE_PROMPTS = [
  { label: "Microcontroller + code", text: "red LED blinks when the button is pressed once, green LED blinks if it's pressed twice within 0.5 s" },
  { label: "555 blinker", text: "555 timer blinking a blue LED at 2 Hz on 9V" },
  { label: "LED indicators", text: "3 green LEDs on 12V at 15mA" },
  { label: "Voltage divider", text: "voltage divider from 12V to 3.3V" },
  { label: "Regulator", text: "3.3V LDO from 5V with power LED" },
  { label: "Filter", text: "low-pass filter at 1kHz" },
  { label: "Transistor switch", text: "transistor to switch a red LED from a 3.3V GPIO on 5V" },
  { label: "Button", text: "push button with pull-up on 3.3V and debounce" },
];

/** What the middle shows before the first prompt: nothing generated, just what you can ask for. */
function EmptyState({ onPick, onPractice }: { onPick: (text: string) => void; onPractice: () => void }) {
  return (
    <motion.div className="empty-state" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.15 }}>
      <Logo size={44} idle />
      <h2>What do you want to build?</h2>
      <p className="dim">Describe a circuit in plain words. CircuitForge picks the parts, works out the values, draws the KiCad schematic, and writes the code when it needs a microcontroller.</p>
      <div className="examples">
        {EXAMPLE_PROMPTS.map((e, i) => (
          <motion.button key={e.text} onClick={() => onPick(e.text)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.04 }}>
            <span className="ex-label">{e.label}</span>
            <span className="ex-text">“{e.text}”</span>
          </motion.button>
        ))}
      </div>
      <p className="dim small">Click one to put it in the box below, then press Enter.</p>
      <div className="practice-cta">
        <div>
          <h3>Practice: learn by doing</h3>
          <p className="dim">Build a real circuit from a schematic, or draw the schematic of a circuit you can turn around in 3D. It checks your work and switches it on when it's right.</p>
        </div>
        <div className="practice-cta-btns">
          <button className="btn" onClick={onPractice}>
            schematic → circuit
          </button>
          <button className="btn" onClick={onPractice}>
            circuit → schematic
          </button>
        </div>
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

interface CodeProps {
  code: string | null;
  onCode: (v: string) => void;
  onResetCode: () => void;
  /** Classroom quiz answers, shared with the full classroom. */
  answers: Record<string, number>;
  onAnswer: (key: string, choice: number) => void;
  onOpenSection: (sectionId: string) => void;
}

interface StepRowProps extends CodeProps {
  step: Step;
  i: number;
  open: boolean;
  flash: boolean;
  project: Project;
  level: Level;
  onToggle: () => void;
}

function StepRow({ step, i, open, flash, project, level, onToggle, code, onCode, onResetCode, answers, onAnswer, onOpenSection }: StepRowProps) {
  const edited = step.editor === "firmware" && code !== null && code !== project.firmware?.code;
  const section = step.sectionId ? project.lesson?.sections.find((s) => s.id === step.sectionId) : undefined;
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
        {edited && <span className="edited-badge">edited</span>}
        {(section || step.lesson || step.editor) && <span className="expand-hint">{open ? "hide" : step.editor ? "edit code" : "explain"}</span>}
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
        {open && step.editor === "firmware" && code !== null && (
          <motion.div key="code" className="tool-detail-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}>
            <div className="tool-detail code-detail">
              <div className="code-bar">
                <span className="dim">Arduino C++ · {project.firmware?.board} · pins match the schematic</span>
                {edited && (
                  <button className="link" onClick={onResetCode}>
                    [reset to generated]
                  </button>
                )}
              </div>
              <CodeEditor value={code} onChange={onCode} />
            </div>
          </motion.div>
        )}
        {open && !step.editor && section && (
          <motion.div key="section" className="tool-detail-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}>
            <div className="tool-detail">
              <SectionView section={section} level={level} project={project} compact answers={answers} onAnswer={onAnswer} onOpen={onOpenSection} />
            </div>
          </motion.div>
        )}
        {open && !step.editor && !section && step.lesson && (
          <motion.div key="lesson" className="tool-detail-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}>
            <div className="tool-detail">
              <Lesson id={step.lesson} params={project.params ?? EXAMPLE_PROJECT.params} level={level} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface TranscriptProps extends CodeProps {
  project: Project;
  openSteps: Set<string>;
  flashStep: string | null;
  level: Level;
  actions: ActionEntry[];
  onToggleStep: (id: string) => void;
  onPlace: () => void;
  onSave: () => void;
  onExport: () => void;
  onEditCode: () => void;
  onOpenPcb: () => void;
  onPreview: () => void;
}

function ProjectTranscript(props: TranscriptProps) {
  const { project, actions, openSteps, flashStep, level, onToggleStep, onPlace, onSave, onExport, onEditCode, onOpenPcb, onPreview, code, onCode, onResetCode, answers, onAnswer, onOpenSection } = props;
  const issues = project.checks.filter((c) => c.status === "fail").length;
  const engine = !!project.files;
  const ercPassed = project.checks.some((c) => c.id === "c-erc" && c.status === "pass");
  const base = 4; // blocks before the step list (welcome, prompt, intro, todos)
  return (
    <>
      <motion.div className="prompt-echo" {...enter(1)}>
        <span className="caret">&gt;</span>
        <span>{project.request}</span>
      </motion.div>

      <motion.div className="say" {...enter(2)}>
        <span className="bullet text">⏺</span>
        <span>
          {project.generator === "rules"
            ? `I'll build this in ${project.steps.length} steps. The rule-based interpreter read your prompt (no AI involved), every value is calculated, and KiCad itself checks the result.${project.firmware ? " Your circuit has behaviour, so it also gets C++ firmware you can edit." : ""}`
            : `I'll build this in ${project.steps.length} steps. Only the first one uses AI. Everything after that is calculated, and you can click any step to see the math.`}
        </span>
      </motion.div>

      <Todos steps={project.steps} i={3} />

      {project.steps.map((s, n) => (
        <StepRow
          key={s.id}
          step={s}
          i={base + n}
          project={project}
          level={level}
          open={openSteps.has(s.id)}
          flash={flashStep === s.id}
          onToggle={() => onToggleStep(s.id)}
          code={code}
          onCode={onCode}
          onResetCode={onResetCode}
          answers={answers}
          onAnswer={onAnswer}
          onOpenSection={onOpenSection}
        />
      ))}

      <motion.div className="say" {...enter(base + project.steps.length)}>
        <span className="bullet text">⏺</span>
        <span>
          Done. {project.checks.length - issues}/{project.checks.length} checks pass.
          {engine
            ? ercPassed
              ? " KiCad's ERC found no problems. Where should it go?"
              : " Review the failed checks before using it."
            : issues > 0 && " One thing to fix before KiCad's ERC passes: add a PWR_FLAG to the GND net."}
        </span>
      </motion.div>

      {engine && (
        <motion.div className="choices" {...enter(base + project.steps.length + 1)}>
          {project.lesson && (
            <button className="choice-learn" onClick={() => onOpenSection(project.lesson!.sections[0].id)}>
              <span className="choice-n">0.</span> Learn how it works <span className="dim">a class about this exact circuit: parts, math{project.firmware ? ", code" : ""}, quizzes</span>
            </button>
          )}
          <button onClick={onPlace}>
            <span className="choice-n">1.</span> Place in my schematic <span className="dim">copies it; then press ⌘V in KiCad's Schematic Editor and click</span>
          </button>
          <button onClick={onSave}>
            <span className="choice-n">2.</span> Save as a new project <span className="dim">and open it in KiCad</span>
          </button>
          <button onClick={onPreview}>
            <span className="choice-n">3.</span> Preview <span className="dim">KiCad's own drawing</span>
          </button>
          <button onClick={onOpenPcb}>
            <span className="choice-n">4.</span> Lay out the PCB <span className="dim">opens it in KiCad; press F8 there to pull in the footprints</span>
          </button>
          {project.firmware && (
            <button onClick={onEditCode}>
              <span className="choice-n">5.</span> Edit the code <span className="dim">Arduino C++, pins already match the schematic</span>
            </button>
          )}
          <button onClick={onExport}>
            <span className="choice-n">{project.firmware ? "6." : "5."}</span> Export <span className="dim">schematic pictures (PNG, SVG, PDF){project.firmware ? " + the code" : ""} + KiCad files</span>
          </button>
        </motion.div>
      )}

      <AnimatePresence initial={false}>
        {actions.map((a) => {
          const m = /^(\w+)\((.*)\)$/.exec(a.call);
          return (
            <motion.div key={a.id} className="tool" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <div className="tool-head static">
                <span className={`bullet ${a.state === "done" ? "done" : a.state === "error" ? "failed" : "pending"}`}>⏺</span>
                <span className="tool-name">{m ? m[1] : a.call}</span>
                {m && <span className="tool-args">({m[2]})</span>}
              </div>
              <div className="tool-out">
                <span className="elbow">⎿</span>
                <div className={`out-lines ${a.state === "error" ? "bad" : ""}`}>
                  {a.state === "running" ? <div>working…</div> : a.lines.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

    </>
  );
}

interface PlanProps extends Omit<TranscriptProps, "project"> {
  project: Project | null;
  messages: ChatMessage[];
  kicad: KiCadInfo;
  showWelcome: boolean;
  onCloseWelcome: () => void;
  onPickExample: (text: string) => void;
  onPractice: () => void;
}

export function Plan(props: PlanProps) {
  const { project, messages, kicad, level, showWelcome, onCloseWelcome, onPickExample } = props;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  return (
    <div className={`plan${!project && !messages.length ? " is-empty" : ""}`}>
      <AnimatePresence initial={false}>
        {showWelcome && <Welcome key="welcome" project={project} kicad={kicad} level={level} thinking={messages.some((m) => m.state === "sending")} onClose={onCloseWelcome} />}
      </AnimatePresence>

      {project ? <ProjectTranscript {...props} project={project} /> : !messages.length && <EmptyState onPick={onPickExample} onPractice={props.onPractice} />}

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
                  <ThinkingLine prompt={m.text} />
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
