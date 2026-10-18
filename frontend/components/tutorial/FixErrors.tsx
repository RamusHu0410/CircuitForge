import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, CircleAlert, TriangleAlert } from "lucide-react";
import { DIAGNOSTICS, type Diagnostic } from "../../data/tutorial";
import { Key, Segmented } from "./ui";

/* ---------- small KiCad-style illustrations (before / after) ---------- */

function Marker({ x, y, tone }: { x: number; y: number; tone: "error" | "warning" }) {
  // KiCad draws ERC markers as small arrows pointing at the problem
  return (
    <motion.g className={`erc-marker ${tone}`} initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ transformBox: "view-box", transformOrigin: `${x}px ${y}px` }}>
      <path d={`M${x} ${y}l10 -14h8l-12 14z`} />
      <circle cx={x} cy={y} r={2.5} />
    </motion.g>
  );
}

function OkMark({ x, y }: { x: number; y: number }) {
  return (
    <motion.g className="ok-mark" initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ transformBox: "view-box", transformOrigin: `${x}px ${y}px` }}>
      <circle cx={x} cy={y} r={9} />
      <path d={`M${x - 4} ${y}l3 3l5 -6`} />
    </motion.g>
  );
}

function Gnd({ x, y }: { x: number; y: number }) {
  return <path className="sym" d={`M${x - 10} ${y}H${x + 10}M${x - 6} ${y + 4}H${x + 6}M${x - 2} ${y + 8}H${x + 2}`} />;
}

function Illustration({ id, after }: { id: Diagnostic["id"]; after: boolean }) {
  return (
    <svg viewBox="0 0 280 130" className="illo">
      {id === "power" && (
        <>
          <rect x={20} y={20} width={70} height={90} className="sym body" />
          <text x={55} y={60} className="ilabel">A1</text>
          <text x={82} y={94} className="ipin">GND</text>
          <path className="sym" d="M90 90H104" />
          <path className="wire" d="M104 90H170V104" />
          <Gnd x={170} y={104} />
          {after ? (
            <>
              <motion.path className="wire changed" d="M140 90V66" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} />
              <circle cx={140} cy={90} r={3.5} className="junction" />
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
                <polygon className="sym body changed-sym" points="140,66 147,59 140,52 133,59" />
                <text x={140} y={44} className="ilabel small changed-text">PWR_FLAG</text>
              </motion.g>
              <OkMark x={230} y={60} />
            </>
          ) : (
            <>
              <Marker x={97} y={90} tone="error" />
              <text x={200} y={62} className="ilabel small bad">no power source</text>
            </>
          )}
        </>
      )}
      {id === "pin" && (
        <>
          <path className="wire" d="M20 65H70" />
          <path className="sym" d="M70 65H80M140 65H150" />
          <rect x={80} y={57} width={60} height={16} className="sym body" />
          <text x={110} y={48} className="ilabel">R3</text>
          {after ? (
            <>
              <motion.path className="wire changed" d="M150 65H240" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} />
              <rect x={240} y={55} width={24} height={20} className="sym body" />
              <OkMark x={196} y={100} />
            </>
          ) : (
            <>
              <circle cx={150} cy={65} r={3} className="open-pin" />
              <Marker x={152} y={65} tone="error" />
              <text x={196} y={100} className="ilabel small bad">pin 2 open</text>
            </>
          )}
        </>
      )}
      {id === "wire" && (
        <>
          <rect x={170} y={45} width={70} height={40} className="sym body" />
          <path className="sym" d="M160 65H170" />
          <text x={205} y={70} className="ilabel">U1</text>
          {after ? (
            <>
              <motion.path className="wire changed" d="M30 65H160" initial={{ pathLength: 0.85 }} animate={{ pathLength: 1 }} />
              <OkMark x={120} y={100} />
            </>
          ) : (
            <>
              <path className="wire" d="M30 65H146" />
              <rect x={143} y={62} width={6} height={6} className="dangling" />
              <text x={153} y={92} className="ilabel small warn">gap</text>
              <path className="gap" d="M149 65H160" />
              <Marker x={146} y={65} tone="warning" />
            </>
          )}
        </>
      )}
    </svg>
  );
}

/* ---------- page ---------- */

export function FixErrors({ reviewed, onReviewed, onFinish }: { reviewed: string[]; onReviewed: (id: string) => void; onFinish: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<Record<string, "before" | "after">>({});
  const allDone = DIAGNOSTICS.every((d) => reviewed.includes(d.id));

  const toggle = (id: string) => {
    setOpen((o) => (o === id ? null : id));
    onReviewed(id);
  };

  return (
    <div className="page fix">
      <div className="diag-summary">
        <div className="ds-item">
          <span className="ds-n err">{DIAGNOSTICS.filter((d) => d.severity === "error").length}</span> errors
        </div>
        <div className="ds-item">
          <span className="ds-n warn">{DIAGNOSTICS.filter((d) => d.severity === "warning").length}</span> warning
        </div>
        <div className="ds-item muted">
          {reviewed.length}/{DIAGNOSTICS.length} reviewed
        </div>
        <p className="ds-note">The three messages beginners hit most often in KiCad's Electrical Rules Checker. Open each one to learn what it means.</p>
      </div>

      <div className="diag-list">
        {DIAGNOSTICS.map((d, i) => {
          const isOpen = open === d.id;
          const v = view[d.id] ?? "before";
          return (
            <motion.div key={d.id} className={`diag sev-${d.severity}${isOpen ? " open" : ""}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <button className="diag-head" onClick={() => toggle(d.id)} aria-expanded={isOpen}>
                <span className="diag-icon">{d.severity === "error" ? <CircleAlert size={17} /> : <TriangleAlert size={16} />}</span>
                <span className="diag-main">
                  <span className="diag-title">{d.title}</span>
                  <span className="diag-short">{d.short}</span>
                </span>
                <span className={`sev-badge ${d.severity}`}>{d.severity}</span>
                <code className="diag-code">{d.code}</code>
                {reviewed.includes(d.id) && <Check size={15} className="diag-seen" />}
                <ChevronDown size={16} className={`seq-chev${isOpen ? " open" : ""}`} />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div className="diag-body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
                    <div className="diag-grid">
                      <div className="diag-text">
                        <div className="dt-block">
                          <span className="dt-k">What went wrong</span>
                          <p>{d.what}</p>
                        </div>
                        <div className="dt-block">
                          <span className="dt-k">Why KiCad reports it</span>
                          <p>{d.why}</p>
                        </div>
                        <div className="dt-block fix-block">
                          <span className="dt-k">How to fix it</span>
                          <p>{d.fix}</p>
                          <div className="dt-keys">
                            {d.keys.map((k) => (
                              <Key key={k}>{k}</Key>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className={`diag-visual v-${v}`}>
                        <div className="dv-head">
                          <span>{v === "before" ? "Before: what ERC flags" : "After: fixed"}</span>
                          <Segmented
                            id={`ba-${d.id}`}
                            size="sm"
                            value={v}
                            onChange={(x) => setView((s) => ({ ...s, [d.id]: x }))}
                            options={[
                              { id: "before", label: "before" },
                              { id: "after", label: "after" },
                            ]}
                          />
                        </div>
                        <AnimatePresence mode="wait">
                          <motion.div key={v} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="dot-grid illo-wrap">
                            <Illustration id={d.id} after={v === "after"} />
                          </motion.div>
                        </AnimatePresence>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {allDone && (
          <motion.div className="finish-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 24 }}>
            <svg viewBox="0 0 64 64" className="finish-mark">
              <motion.circle cx={32} cy={32} r={26} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6 }} />
              <motion.path d="M21 33l8 8l15 -17" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.5 }} />
            </svg>
            <div>
              <h3>You're ready to build.</h3>
              <p>You know how the circuit works, why each value is what it is, how to draw it, and what the common errors mean. Run ERC in KiCad to check your own schematic.</p>
            </div>
            <button className="nav-btn primary" onClick={onFinish}>
              Finish tutorial
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
