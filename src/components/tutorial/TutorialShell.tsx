import { useEffect, useRef } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Hammer, ShieldCheck, Sigma, X, Zap } from "lucide-react";
import type { Level, Project } from "../../types";
import { BUILD_STEPS, DIAGNOSTICS } from "../../data/tutorial";
import { CHAPTERS } from "../Tutorial";
import { HowItWorks } from "./HowItWorks";
import { MathLab } from "./MathLab";
import { BuildGuide } from "./BuildGuide";
import { FixErrors } from "./FixErrors";
import { Logo } from "../Logo";
import "./tutorial.css";

export interface TutorialProgress {
  howDone: boolean;
  mathTouched: boolean;
  reviewed: string[];
}

const META = [
  { icon: Zap, label: "How it works", blurb: "Watch the circuit work. Press the button, follow the current, inspect every part." },
  { icon: Sigma, label: "The math", blurb: "Experiment with the formulas behind every part value." },
  { icon: Hammer, label: "Build in KiCad", blurb: "Draw the schematic yourself, one step at a time." },
  { icon: ShieldCheck, label: "Fix errors", blurb: "Understand the ERC messages beginners hit most often." },
];

/** Fraction complete for each chapter. */
export function chapterProgress(p: TutorialProgress, checklist: Record<string, boolean>): number[] {
  return [
    p.howDone ? 1 : 0,
    p.mathTouched ? 1 : 0,
    BUILD_STEPS.filter((s) => checklist[s.id]).length / BUILD_STEPS.length,
    DIAGNOSTICS.filter((d) => p.reviewed.includes(d.id)).length / DIAGNOSTICS.length,
  ];
}

interface Props {
  chapter: number;
  project: Project;
  checklist: Record<string, boolean>;
  progress: TutorialProgress;
  level: Level;
  onLevel: (l: Level) => void;
  onProgress: (patch: Partial<TutorialProgress>) => void;
  onChapter: (i: number) => void;
  onToggle: (id: string) => void;
  onGenerate: () => Promise<void>;
  onClose: () => void;
}

export function TutorialOverlay({ chapter, project, checklist, progress, level, onLevel, onProgress, onChapter, onToggle, onGenerate, onClose }: Props) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [chapter]);

  const fractions = chapterProgress(progress, checklist);
  const overall = fractions.reduce((a, b) => a + b, 0) / fractions.length;
  const meta = META[chapter];
  const prev = chapter > 0 ? META[chapter - 1] : null;
  const next = chapter < CHAPTERS.length - 1 ? META[chapter + 1] : null;

  return (
    <MotionConfig reducedMotion="user">
      <motion.div className="tut" role="dialog" aria-modal="true" aria-label="Tutorial" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22 }}>
        <aside className="tut-side">
          <div className="side-brand">
            <span className="brand-mark">
              <Logo size={22} color="#fff" animate />
            </span>
            <div>
              <b>Tutorial</b>
              <span>{project.name}</span>
            </div>
          </div>

          <div className="side-progress">
            <div className="sp-top">
              <span>progress</span>
              <b>{Math.round(overall * 100)}%</b>
            </div>
            <div className="sp-track">
              <motion.span animate={{ width: `${overall * 100}%` }} transition={{ type: "spring", stiffness: 160, damping: 28 }} />
            </div>
          </div>

          <ol className="timeline">
            {META.map((m, i) => {
              const f = fractions[i];
              const isActive = i === chapter;
              const Icon = m.icon;
              return (
                <li key={m.label} className={`${isActive ? "active" : ""} ${f >= 1 ? "complete" : ""}`}>
                  <button onClick={() => onChapter(i)}>
                    {isActive && <motion.span layoutId="tl-active" className="tl-active" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                    <span className="tl-node">{f >= 1 ? <Check size={13} strokeWidth={3} /> : <Icon size={13} />}</span>
                    <span className="tl-text">
                      <span className="tl-num">{String(i + 1).padStart(2, "0")}</span>
                      <span className="tl-label">{m.label}</span>
                      {f > 0 && f < 1 && (
                        <span className="tl-mini">
                          <span style={{ width: `${f * 100}%` }} />
                        </span>
                      )}
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

        <main className="tut-main">
          <header className="tut-header">
            <div className="th-left">
              <span className="eyebrow">
                PART {String(chapter + 1).padStart(2, "0")} <i>/</i> 04
              </span>
              <AnimatePresence mode="wait">
                <motion.div key={chapter} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                  <h1>{meta.label}</h1>
                  <p>{meta.blurb}</p>
                </motion.div>
              </AnimatePresence>
            </div>
            <button className="close-btn" onClick={onClose} aria-label="Close tutorial" title="Close (Esc)">
              <X size={17} />
            </button>
          </header>

          <div className="tut-body" ref={body}>
            <AnimatePresence mode="wait">
              <motion.div key={chapter} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
                {chapter === 0 && <HowItWorks project={project} onComplete={() => !progress.howDone && onProgress({ howDone: true })} />}
                {chapter === 1 && <MathLab project={project} level={level} onLevel={onLevel} onTouched={() => !progress.mathTouched && onProgress({ mathTouched: true })} />}
                {chapter === 2 && <BuildGuide checklist={checklist} onToggle={onToggle} onGenerate={onGenerate} />}
                {chapter === 3 && (
                  <FixErrors reviewed={progress.reviewed} onReviewed={(id) => !progress.reviewed.includes(id) && onProgress({ reviewed: [...progress.reviewed, id] })} onFinish={onClose} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <footer className="tut-nav">
            <button className="nav-btn" disabled={!prev} onClick={() => onChapter(chapter - 1)}>
              <ArrowLeft size={15} className="nav-arrow back" />
              <span className="nav-txt">
                <small>back</small>
                {prev ? prev.label : "start"}
              </span>
            </button>
            <div className="nav-segs" aria-label={`${Math.round(overall * 100)}% complete`}>
              {fractions.map((f, i) => (
                <button key={i} className={`nav-seg${i === chapter ? " cur" : ""}`} onClick={() => onChapter(i)} aria-label={`Go to part ${i + 1}`}>
                  <motion.span animate={{ width: `${f * 100}%` }} />
                </button>
              ))}
            </div>
            {next ? (
              <button className="nav-btn primary" onClick={() => onChapter(chapter + 1)}>
                <span className="nav-txt">
                  <small>next</small>
                  {next.label}
                </span>
                <ArrowRight size={15} className="nav-arrow" />
              </button>
            ) : (
              <button className="nav-btn primary" onClick={onClose}>
                <span className="nav-txt">
                  <small>done</small>
                  Back to the plan
                </span>
                <Check size={15} className="nav-arrow" />
              </button>
            )}
          </footer>
        </main>
      </motion.div>
    </MotionConfig>
  );
}
