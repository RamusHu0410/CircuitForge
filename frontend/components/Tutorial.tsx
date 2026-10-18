import { motion } from "motion/react";
import type { Project } from "../types";
import type { ClassroomState } from "./classroom/Classroom";
import { quizScore } from "./classroom/Classroom";
import { ChevronRight } from "lucide-react";

export const CHAPTERS = [
  { id: "how", title: "how it works" },
  { id: "math", title: "the math" },
  { id: "build", title: "build in kicad" },
  { id: "fix", title: "fix errors" },
] as const;

/* ---------- top-left box in the main window ---------- */

export function TutorialCard({ progress, onOpen }: { progress: number[]; onOpen: (chapter: number) => void }) {
  const next = Math.max(0, progress.findIndex((f) => f < 1));
  const overall = progress.reduce((a, b) => a + b, 0) / progress.length;
  return (
    <div className="tutorial-box">
      <div className="box-title">
        tutorial <span className="dim">{Math.round(overall * 100)}%</span>
      </div>
      <ol className="chapters">
        {CHAPTERS.map((c, i) => (
          <motion.li key={c.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, delay: 0.1 + i * 0.06 }}>
            <button onClick={() => onOpen(i)} className={`${progress[i] >= 1 ? "seen" : ""}${i === next ? " next" : ""}`}>
              <span className="num">{progress[i] >= 1 ? "✓" : String(i + 1).padStart(2, "0")}</span>
              <span className="ch-title">{c.title}</span>
              <span className="ch-bar">
                <motion.span animate={{ width: `${progress[i] * 100}%` }} transition={{ duration: 0.5 }} />
              </span>
            </button>
          </motion.li>
        ))}
      </ol>
      <motion.button className="continue" whileTap={{ scale: 0.97 }} onClick={() => onOpen(next)}>
        {overall === 0 ? "start" : overall >= 1 ? "review" : "continue"}: {CHAPTERS[next].title}
        <ChevronRight size={14} />
      </motion.button>
      <button className="expand-tab" title="open tutorial" aria-label="Open tutorial" onClick={() => onOpen(next)}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/* ---------- top-left box: the Classroom for the circuit you just built ---------- */

export function ClassroomCard({ project, state, onOpen, onSample }: { project: Project | null; state: ClassroomState; onOpen: (index: number) => void; onSample: () => void }) {
  const lesson = project?.lesson;
  if (!lesson) {
    return (
      <div className="tutorial-box classroom-box">
        <div className="box-title">classroom</div>
        <p className="cr-card-empty dim">Generate a circuit and a class about exactly that circuit appears here: how it works, its math, its code, and how to build it.</p>
        <button className="continue" onClick={onSample}>
          sample class: push-button LED <ChevronRight size={14} />
        </button>
      </div>
    );
  }
  const sections = lesson.sections;
  const seen = new Set(state.visited);
  const nextIndex = Math.max(0, sections.findIndex((s) => !seen.has(s.id)));
  const score = quizScore(sections, state.answers);
  const progress = state.visited.length / sections.length;
  return (
    <div className="tutorial-box classroom-box">
      <div className="box-title">
        classroom <span className="dim">{Math.round(progress * 100)}%</span>
      </div>
      <div className="cr-card-title">{lesson.title}</div>
      <ol className="chapters">
        {sections.slice(0, 6).map((s, i) => (
          <motion.li key={s.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, delay: 0.1 + i * 0.05 }}>
            <button onClick={() => onOpen(i)} className={`${seen.has(s.id) ? "seen" : ""}${i === nextIndex ? " next" : ""}`}>
              <span className="num">{seen.has(s.id) ? "✓" : String(i + 1).padStart(2, "0")}</span>
              <span className="ch-title">{s.title}</span>
              <span />
            </button>
          </motion.li>
        ))}
      </ol>
      {sections.length > 6 && <div className="dim small cr-more">+ {sections.length - 6} more sections</div>}
      <motion.button className="continue" whileTap={{ scale: 0.97 }} onClick={() => onOpen(nextIndex)}>
        {progress === 0 ? "start the class" : progress >= 1 ? "review the class" : "continue the class"}
        {score.total > 0 && <span className="dim"> · quiz {score.right}/{score.total}</span>}
        <ChevronRight size={14} />
      </motion.button>
      <button className="expand-tab" title="open classroom" aria-label="Open classroom" onClick={() => onOpen(nextIndex)}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
