import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Cpu, Layers, Lightbulb, Loader2, ScanLine, TriangleAlert } from "lucide-react";
import { BUILD_STEPS } from "../../data/tutorial";
import { ALL_VISIBLE, Circuit, type Visibility } from "./Circuit";
import { Key, Panel, Segmented } from "./ui";

/** What the reference shows after completing step n (1-based) in build-up mode. */
function stageVisibility(stage: number): Visibility {
  return { parts: stage >= 2, values: stage >= 3, wires: stage >= 4, power: stage >= 5 };
}

const CALLOUTS: Record<string, { x: number; y: number; dx: number; dy: number; text: string }[]> = {
  values: [
    { x: 260, y: 166, dx: -10, dy: 34, text: "R1 = 220" },
    { x: 530, y: 274, dx: -40, dy: 36, text: "R2 = 10k" },
    { x: 604, y: 266, dx: -14, dy: -60, text: "C1 = 100n" },
  ],
  power: [{ x: 236, y: 254, dx: 46, dy: -40, text: "PWR_FLAG on GND" }],
  erc: [{ x: 236, y: 254, dx: 46, dy: -40, text: "PWR_FLAG marks GND as driven" }],
};

type GenState = { kind: "idle" } | { kind: "loading" } | { kind: "ok" } | { kind: "error"; message: string };

interface Props {
  checklist: Record<string, boolean>;
  onToggle: (id: string) => void;
  onGenerate: () => Promise<void>;
}

export function BuildGuide({ checklist, onToggle, onGenerate }: Props) {
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"build" | "full">("build");
  const [open, setOpen] = useState<string | null>(BUILD_STEPS[0].id);
  const [gen, setGen] = useState<GenState>({ kind: "idle" });

  const step = BUILD_STEPS[active];
  const stage = active + 1;
  const done = BUILD_STEPS.filter((s) => checklist[s.id]).length;

  const select = (i: number) => {
    setActive(i);
    setOpen(BUILD_STEPS[i].id);
  };

  const generate = async () => {
    setGen({ kind: "loading" });
    try {
      await onGenerate();
      setGen({ kind: "ok" });
    } catch (e) {
      setGen({ kind: "error", message: (e as Error).message });
    }
  };

  return (
    <div className="page build">
      <div className="build-grid">
        <div className="build-steps">
          <div className="build-progress">
            <div>
              <b>{done}</b>/{BUILD_STEPS.length} steps done
            </div>
            <div className="bp-track">
              <motion.span animate={{ width: `${(done / BUILD_STEPS.length) * 100}%` }} transition={{ type: "spring", stiffness: 200, damping: 30 }} />
            </div>
          </div>
          <ol className="seq">
            {BUILD_STEPS.map((s, i) => {
              const isDone = !!checklist[s.id];
              const isActive = i === active;
              const isOpen = open === s.id;
              return (
                <motion.li
                  key={s.id}
                  className={`seq-item${isActive ? " active" : ""}${isDone ? " done" : ""}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <span className="seq-rail" />
                  <button
                    className="seq-check"
                    aria-label={isDone ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}
                    onClick={() => {
                      onToggle(s.id);
                      if (!isDone && i === active && i < BUILD_STEPS.length - 1) select(i + 1);
                    }}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {isDone ? (
                        <motion.span key="d" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}>
                          <Check size={14} strokeWidth={3} />
                        </motion.span>
                      ) : (
                        <motion.span key="n" className="seq-num" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                          {String(i + 1).padStart(2, "0")}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </button>
                  <div className="seq-body">
                    <button className="seq-head" onClick={() => (select(i), setOpen(isOpen && isActive ? null : s.id))}>
                      <span className="seq-title">{s.title}</span>
                      {s.key ? <Key>{s.key}</Key> : <span className="seq-menu">menu</span>}
                      <ChevronDown size={15} className={`seq-chev${isOpen ? " open" : ""}`} />
                    </button>
                    <p className="seq-text">{s.text}</p>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div className="seq-more" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
                          <p className="seq-why">{s.why}</p>
                          <div className="tip">
                            <Lightbulb size={13} />
                            <span>{s.tip}</span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </div>

        <div className="build-side">
          <Panel
            tag={`STEP ${String(stage).padStart(2, "0")}`}
            title="Reference schematic"
            className="ref-panel"
            aside={
              <Segmented
                id="build-mode"
                size="sm"
                value={mode}
                onChange={setMode}
                options={[
                  {
                    id: "build",
                    label: (
                      <>
                        <Layers size={13} /> build-up
                      </>
                    ),
                  },
                  { id: "full", label: "full" },
                ]}
              />
            }
          >
            <div className="diagram-wrap dot-grid">
              <Circuit
                timing="quick"
                visible={mode === "build" ? stageVisibility(stage) : ALL_VISIBLE}
                showFlag={mode === "full" || stage >= 5}
                highlight={step.highlight}
                annotations={CALLOUTS[step.id] ?? []}
                scanning={step.id === "erc"}
              />
              {mode === "build" && stage === 1 && (
                <motion.div className="empty-sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  empty sheet: ready for symbols
                </motion.div>
              )}
            </div>
            {step.id === "erc" && (
              <motion.div className="erc-note" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <ScanLine size={13} /> ERC walks every pin and net. Run it in KiCad to see your actual result.
              </motion.div>
            )}
            <div className="scrub">
              <span className="scrub-l">scrub</span>
              <div className="scrub-track">
                {BUILD_STEPS.map((s, i) => (
                  <button key={s.id} className={`scrub-node${i <= active ? " on" : ""}${i === active ? " cur" : ""}`} onClick={() => select(i)} aria-label={`Show step ${i + 1}`}>
                    <span />
                  </button>
                ))}
                <motion.span className="scrub-fill" animate={{ width: `${(active / (BUILD_STEPS.length - 1)) * 100}%` }} />
              </div>
              <span className="scrub-val">{step.title}</span>
            </div>
          </Panel>

          <div className={`gen-card g-${gen.kind}`}>
            <div className="gen-text">
              <b>Skip the manual steps?</b>
              <span>CircuitForge can place this schematic in your open KiCad project.</span>
            </div>
            <motion.button className="gen-btn" whileTap={{ scale: 0.97 }} onClick={generate} disabled={gen.kind === "loading"}>
              {gen.kind === "loading" ? <Loader2 size={15} className="spin" /> : gen.kind === "ok" ? <Check size={15} /> : <Cpu size={15} />}
              {gen.kind === "loading" ? "Generating…" : gen.kind === "ok" ? "Placed in KiCad" : "Generate in KiCad"}
            </motion.button>
            <AnimatePresence>
              {gen.kind === "error" && (
                <motion.div className="gen-msg err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <TriangleAlert size={13} /> {gen.message}. Nothing was changed in KiCad. You can still follow the steps by hand.
                </motion.div>
              )}
              {gen.kind === "ok" && (
                <motion.div className="gen-msg ok" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                  <Check size={13} /> Sent to KiCad. Run ERC there to confirm.
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
