import { useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Atom, Baby, Check, CodeXml, Eye, GraduationCap, Hammer, Microscope, Package, ShieldCheck, Sigma, Trophy, X } from "lucide-react";
import type { LessonSection } from "../../api/backend";
import type { Level, Project } from "../../types";
import { Logo } from "../Logo";
import { Segmented } from "../tutorial/ui";
import { SectionView } from "./SectionView";
import { Lab } from "../lab/Lab";
import "../tutorial/tutorial.css";

const KIND_ICON = { overview: Eye, parts: Package, math: Sigma, code: CodeXml, build: Hammer, check: ShieldCheck };
const KIND_LABEL = { overview: "Overview", parts: "Parts", math: "The math", code: "The code", build: "Build it", check: "Checks" };

const LEVELS: { id: Level; label: React.ReactNode }[] = [
  { id: "eli5", label: (<><Baby size={14} /> Like I'm 5</>) },
  { id: "beginner", label: (<><GraduationCap size={14} /> Beginner</>) },
  { id: "expert", label: (<><Microscope size={14} /> Expert</>) },
];

export interface ClassroomState {
  visited: string[];
  answers: Record<string, number>; // "<section>:<question>" -> chosen option
  done: Record<string, boolean>; // build checklist
}

export function quizScore(sections: LessonSection[], answers: Record<string, number>) {
  const all = sections.flatMap((s) => s.quiz.map((q, i) => ({ key: `${s.id}:${i}`, answer: q.answer })));
  return { total: all.length, answered: all.filter((q) => q.key in answers).length, right: all.filter((q) => answers[q.key] === q.answer).length };
}

interface Props {
  project: Project & { lesson: NonNullable<Project["lesson"]> };
  index: number;
  state: ClassroomState;
  level: Level;
  onLevel: (l: Level) => void;
  onIndex: (i: number) => void;
  onState: (patch: Partial<ClassroomState>) => void;
  onClose: () => void;
  /** Show the interactive lab (2D/3D) instead of a text section. */
  lab: boolean;
  onLab: (on: boolean) => void;
}

export function Classroom({ project, index, state, level, onLevel, onIndex, onState, onClose, lab, onLab }: Props) {
  const scene = project.scene;
  const inLab = lab && !!scene;
  const [labFocus, setLabFocus] = useState<string | null>(null);
  const openLab = (ref: string | null) => {
    setLabFocus(ref);
    onLab(true);
  };
  const go = (i: number) => {
    onLab(false);
    onIndex(i);
  };
  const sections = project.lesson.sections;
  const s = sections[index];
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
    if (!inLab && !state.visited.includes(s.id)) onState({ visited: [...state.visited, s.id] });
  }, [index, inLab]); // eslint-disable-line react-hooks/exhaustive-deps

  const progress = state.visited.length / sections.length;
  const score = quizScore(sections, state.answers);
  const prev = sections[index - 1];
  const next = sections[index + 1];
  let lastKind: string | null = null;

  return (
    <MotionConfig reducedMotion="user">
      <motion.div className="tut classroom" role="dialog" aria-modal="true" aria-label="Classroom" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22 }}>
        <aside className="tut-side">
          <div className="side-brand">
            <span className="brand-mark">
              <Logo size={22} color="#fff" animate />
            </span>
            <div>
              <b>Classroom</b>
              <span>{project.lesson.title}</span>
            </div>
          </div>

          <div className="side-progress">
            <div className="sp-top">
              <span>explored</span>
              <b>{Math.round(progress * 100)}%</b>
            </div>
            <div className="sp-track">
              <motion.span animate={{ width: `${progress * 100}%` }} transition={{ type: "spring", stiffness: 160, damping: 28 }} />
            </div>
            {score.total > 0 && (
              <div className="cr-score">
                <Trophy size={13} /> quiz {score.right}/{score.total}
                {score.answered < score.total && <span className="dim"> · {score.total - score.answered} left</span>}
              </div>
            )}
          </div>

          <ol className="timeline cr-timeline">
            {scene && (
              <li className={inLab ? "active" : ""}>
                <span className="cr-group">Explore</span>
                <button onClick={() => openLab(null)}>
                  {inLab && <motion.span layoutId="cr-active" className="tl-active" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                  <span className="tl-node">
                    <Atom size={12} />
                  </span>
                  <span className="tl-text">
                    <span className="tl-label cr-label">See it work: 2D · 3D</span>
                  </span>
                </button>
              </li>
            )}
            {sections.map((sec, i) => {
              const Icon = KIND_ICON[sec.kind];
              const group = sec.kind !== lastKind ? KIND_LABEL[sec.kind] : null;
              lastKind = sec.kind;
              const seen = state.visited.includes(sec.id);
              return (
                <li key={sec.id} className={`${i === index && !inLab ? "active" : ""} ${seen ? "complete" : ""}`}>
                  {group && <span className="cr-group">{group}</span>}
                  <button onClick={() => go(i)}>
                    {i === index && !inLab && <motion.span layoutId="cr-active" className="tl-active" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                    <span className="tl-node">{seen && (i !== index || inLab) ? <Check size={12} strokeWidth={3} /> : <Icon size={12} />}</span>
                    <span className="tl-text">
                      <span className="tl-label cr-label">{sec.title}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="side-foot">
            <span>
              <kbd className="key">esc</kbd> close
            </span>
          </div>
        </aside>

        {inLab ? (
          <main className="tut-main">
            <header className="tut-header">
              <div className="th-left">
                <span className="eyebrow">EXPLORE</span>
                <h1>See {project.lesson.title.toLowerCase().startsWith("the ") ? project.lesson.title : `the ${project.lesson.title}`} work</h1>
              </div>
              <div className="cr-head-right">
                <Segmented id="cr-level" options={LEVELS} value={level} onChange={onLevel} />
                <button className="close-btn" onClick={onClose} aria-label="Close classroom" title="Close (Esc)">
                  <X size={17} />
                </button>
              </div>
            </header>
            <div className="tut-body cr-lab-body">
              <Lab scene={scene!} firmware={project.firmware?.code} level={level} summary={project.lesson.summary[level]} focusRef={labFocus} />
            </div>
            <footer className="tut-nav">
              <span />
              <span className="dim small">Click any part, pin or wire. Then read why it works.</span>
              <button className="nav-btn primary" onClick={() => go(index)}>
                <span className="nav-txt">
                  <small>then</small>
                  {s.title}
                </span>
                <ArrowRight size={15} className="nav-arrow" />
              </button>
            </footer>
          </main>
        ) : (
        <main className="tut-main">
          <header className="tut-header">
            <div className="th-left">
              <span className="eyebrow">
                {KIND_LABEL[s.kind].toUpperCase()} <i>·</i> {String(index + 1).padStart(2, "0")} <i>/</i> {String(sections.length).padStart(2, "0")}
              </span>
              <AnimatePresence mode="wait">
                <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                  <h1>{s.title}</h1>
                  {s.refs.length > 0 && s.refs.length <= 8 && (
                    <p className="cr-refs">
                      {s.refs.map((r) =>
                        scene?.components.some((c) => c.ref === r) ? (
                          <button key={r} className="cr-ref-btn" onClick={() => openLab(r)} title={`See ${r} in the lab`}>
                            <code>{r}</code> <Atom size={11} />
                          </button>
                        ) : (
                          <code key={r}>{r}</code>
                        ),
                      )}
                    </p>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="cr-head-right">
              <Segmented id="cr-level" options={LEVELS} value={level} onChange={onLevel} />
              <button className="close-btn" onClick={onClose} aria-label="Close classroom" title="Close (Esc)">
                <X size={17} />
              </button>
            </div>
          </header>

          <div className="tut-body" ref={body}>
            <AnimatePresence mode="wait">
              <motion.div key={s.id} className="page cr-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
                <SectionView
                  section={s}
                  level={level}
                  project={project}
                  answers={state.answers}
                  onAnswer={(key, choice) => onState({ answers: { ...state.answers, [key]: choice } })}
                  done={state.done}
                  onDone={(key) => onState({ done: { ...state.done, [key]: !state.done[key] } })}
                />
                {!next && (
                  <div className="finish-card">
                    <Trophy size={28} />
                    <div>
                      <h3>You've gone through the whole class.</h3>
                      <p>
                        Quiz: {score.right} of {score.total} right. Try another level of explanation, or generate a new circuit for a new class.
                      </p>
                    </div>
                    <button className="nav-btn primary" onClick={onClose}>
                      Back to my circuit
                    </button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <footer className="tut-nav">
            <button className="nav-btn" disabled={!prev && !scene} onClick={() => (prev ? onIndex(index - 1) : openLab(null))}>
              <ArrowLeft size={15} className="nav-arrow back" />
              <span className="nav-txt">
                <small>back</small>
                {prev ? prev.title : scene ? "See it work" : "start"}
              </span>
            </button>
            <div className="nav-segs">
              {sections.map((sec, i) => (
                <button key={sec.id} className={`nav-seg${i === index ? " cur" : ""}`} onClick={() => onIndex(i)} aria-label={`Go to ${sec.title}`}>
                  <motion.span animate={{ width: state.visited.includes(sec.id) ? "100%" : "0%" }} />
                </button>
              ))}
            </div>
            {next ? (
              <button className="nav-btn primary" onClick={() => onIndex(index + 1)}>
                <span className="nav-txt">
                  <small>next</small>
                  {next.title}
                </span>
                <ArrowRight size={15} className="nav-arrow" />
              </button>
            ) : (
              <button className="nav-btn primary" onClick={onClose}>
                <span className="nav-txt">
                  <small>done</small>
                  Back to my circuit
                </span>
                <Check size={15} className="nav-arrow" />
              </button>
            )}
          </footer>
        </main>
        )}
      </motion.div>
    </MotionConfig>
  );
}
