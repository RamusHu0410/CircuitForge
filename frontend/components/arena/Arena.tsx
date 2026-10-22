import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Blocks, Loader2, Swords, Timer, X } from "lucide-react";
import type { Level } from "../../types";
import { getLibrary, type PartLibrary } from "../../api/client";
import { Playground } from "./Playground";
import { Race } from "./Race";
import { SpeedRun } from "./SpeedRun";
import "../practice/practice.css";
import "./arena.css";

export type ArenaTab = "playground" | "speedrun" | "race";

/** The website's workshop: build anything (and get it rated), race the clock, race people. */
export function Arena({ tab: initial, level, onClose }: { tab: ArenaTab; level: Level; onClose: () => void }) {
  const [tab, setTab] = useState<ArenaTab>(initial);
  const [library, setLibrary] = useState<PartLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLibrary().then(setLibrary, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.target as HTMLElement)?.tagName !== "INPUT" && !document.querySelector(".pr-lab") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tabs: { id: ArenaTab; label: string; icon: React.ReactNode }[] = [
    { id: "playground", label: "Playground", icon: <Blocks size={15} /> },
    { id: "speedrun", label: "Speed runs", icon: <Timer size={15} /> },
    { id: "race", label: "Race online", icon: <Swords size={15} /> },
  ];

  return (
    <motion.div className="practice arena" role="dialog" aria-modal="true" aria-label="Arena" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
      <header className="pr-head">
        <div className="pr-title">
          <span className="eyebrow">CIRCUITFORGE ARENA</span>
          <h1>{tab === "playground" ? "Build anything" : tab === "speedrun" ? "Speed runs" : "Race online"}</h1>
        </div>
        <div className="seg-row arena-tabs">
          {tabs.map((t) => (
            <button key={t.id} className={`seg${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <button className="icon-btn pr-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </header>
      <div className="arena-body">
        {!library ? (
          <div className="pr-loading">{error ? <span className="bad">Couldn't load the parts: {error}</span> : <><Loader2 size={18} className="spin" /> loading parts…</>}</div>
        ) : tab === "playground" ? (
          <Playground library={library} level={level} />
        ) : tab === "speedrun" ? (
          <SpeedRun library={library} web />
        ) : (
          <Race library={library} onBots={() => setTab("speedrun")} />
        )}
      </div>
    </motion.div>
  );
}
