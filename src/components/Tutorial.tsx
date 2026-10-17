import { motion } from "motion/react";
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
