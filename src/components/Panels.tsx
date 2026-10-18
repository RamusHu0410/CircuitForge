import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, ChevronDown, Cpu, Settings as SettingsIcon, X } from "lucide-react";
import type { Activity, Check, KiCadStatus, Level, Part } from "../types";
import { levelLabel } from "../data/explain";

/* ---------- checks (right, like the sketch: ✓ / ✗ + a line) ---------- */

const MARK = { pass: "✓", fail: "✗", warn: "!" };

export function ChecksPanel({ checks, onSelect }: { checks: Check[]; onSelect: (c: Check) => void }) {
  const passed = checks.filter((c) => c.status === "pass").length;
  return (
    <>
      <div className="checks-sum">
        <span>
          <b>{passed}</b>/{checks.length} checks pass
        </span>
        <span className="dim">{checks.length - passed} to fix</span>
        <div className="checks-bar">
          <motion.span initial={{ width: 0 }} animate={{ width: `${(passed / checks.length) * 100}%` }} transition={{ duration: 0.7, delay: 0.5, ease: [0.2, 0.8, 0.2, 1] }} />
        </div>
      </div>
      <ul className="checks">
        {checks.map((c, i) => (
          <motion.li key={c.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, delay: 0.35 + i * 0.05 }}>
            <button className={`check ${c.status}`} onClick={() => onSelect(c)}>
              <motion.span className="mark" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 520, damping: 18, delay: 0.45 + i * 0.05 }}>
                {MARK[c.status]}
              </motion.span>
              <span>{c.label}</span>
            </button>
          </motion.li>
        ))}
      </ul>
    </>
  );
}

/* ---------- right, under the checks: parts in the design ---------- */

export function PartsMini({ parts, onOpen }: { parts: Part[]; onOpen: () => void }) {
  const sorted = [...parts].sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  return (
    <div className="parts-mini">
      <div className="side-title">
        parts <span className="dim">{parts.length}</span>
      </div>
      <ul>
        {sorted.map((p, i) => (
          <motion.li key={p.ref} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, delay: 0.8 + i * 0.05 }}>
            <code>{p.ref}</code>
            <span className="pm-name">{p.name}</span>
            <span className="dim">{p.value}</span>
          </motion.li>
        ))}
      </ul>
      <button className="continue" onClick={onOpen}>
        full parts list ›
      </button>
    </div>
  );
}

/* ---------- bottom-left: activity, import, export, settings ---------- */

export function UtilityPanel({ activity, onImport, onExport, onSettings }: { activity: Activity[]; onImport: () => void; onExport: () => void; onSettings: () => void }) {
  return (
    <div className="utility">
      <div className="box-title">activity</div>
      <ul className="activity">
        <AnimatePresence initial={false}>
          {activity.map((a) => (
            <motion.li key={a.id} className={a.kind} layout initial={{ opacity: 0, x: -10, backgroundColor: "rgba(215,119,87,0.14)" }} animate={{ opacity: 1, x: 0, backgroundColor: "rgba(215,119,87,0)" }} transition={{ duration: 0.4 }}>
              <time>{a.time}</time> {a.text}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <div className="utility-actions">
        <motion.button className="btn" whileTap={{ scale: 0.96 }} onClick={onImport}>
          import
        </motion.button>
        <motion.button className="btn" whileTap={{ scale: 0.96 }} onClick={onExport}>
          export
        </motion.button>
        <motion.button className="round-btn" whileHover={{ rotate: 60 }} whileTap={{ scale: 0.9 }} onClick={onSettings} title="settings" aria-label="Settings">
          <SettingsIcon size={16} />
        </motion.button>
      </div>
    </div>
  );
}

/* ---------- top-right: preview ---------- */

export type PreviewKind = "schematic" | "parts";

export function PreviewMenu({ onOpen }: { onOpen: (k: PreviewKind) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const pick = (k: PreviewKind) => {
    setOpen(false);
    onOpen(k);
  };
  return (
    <div className="preview-menu" ref={ref}>
      <motion.button className="btn" whileTap={{ scale: 0.96 }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        preview
        <motion.span className="chev-wrap" animate={{ rotate: open ? 180 : 0 }}>
          <ChevronDown size={14} />
        </motion.span>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div className="menu" initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={{ duration: 0.14 }}>
            <button onClick={() => pick("schematic")}>schematic</button>
            <button onClick={() => pick("parts")}>parts</button>
            <button disabled>pcb (soon)</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- bottom: chat ---------- */

interface ComposerProps {
  onSend: (text: string) => void;
  /** Build the described circuit with POST /api/generate and offer to open it in KiCad. */
  onGenerate: (text: string) => void;
  busy: boolean;
  level: Level;
  onCycleLevel: () => void;
  kicad: KiCadStatus;
}

export function Composer({ onSend, onGenerate, busy, level, onCycleLevel, kicad }: ComposerProps) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const generate = () => {
    const t = text.trim();
    if (t) {
      setHint(false);
      onGenerate(t);
    } else {
      // Nothing to build yet: take the user to the box and say what to type.
      setHint(true);
      ta.current?.focus();
    }
  };

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="composer">
      {hint && (
        <div className="composer-hint" role="status">
          Type the circuit you want first, for example "555 timer blinking an LED at 2 Hz on 9V", then click <b>generate circuit</b>.
        </div>
      )}
      <div className="composer-row">
        <div className="composer-box">
          <span className="caret">&gt;</span>
          <textarea
            ref={ta}
            rows={1}
            value={text}
            placeholder='Describe a circuit, e.g. "555 timer blinking an LED at 2 Hz on 9V", then click generate circuit'
            onChange={(e) => {
              setText(e.target.value);
              setHint(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              } else if (e.key === "Tab" && e.shiftKey) {
                e.preventDefault();
                onCycleLevel();
              }
            }}
          />
        </div>
        <motion.button
          className="btn gen-open"
          whileTap={{ scale: 0.96 }}
          onClick={generate}
          title="Build the circuit you described (LED, divider, filter, 555 blinker, regulator, button, transistor) and open it in KiCad"
        >
          <Cpu size={15} /> generate circuit
        </motion.button>
        <motion.button className={`send-btn${text.trim() ? " ready" : ""}`} whileTap={{ scale: 0.9 }} onClick={send} disabled={!text.trim() || busy} aria-label="Send" title="send">
          <ArrowUp size={18} />
        </motion.button>
      </div>
      <div className="status-line">
        <button className="mode" onClick={onCycleLevel} title="Change how much detail explanations use">
          <span className="mode-glyph">⏵⏵</span> explain:{" "}
          <AnimatePresence mode="wait" initial={false}>
            <motion.b key={level} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}>
              {levelLabel(level)}
            </motion.b>
          </AnimatePresence>{" "}
          <span className="dim">(shift+tab to cycle)</span>
        </button>
        <span className={`kicad-status ${kicad}`}>
          {kicad === "connected" ? "●" : "◯"} kicad {kicad === "connected" ? "connected" : kicad === "connecting" ? "connecting…" : "not connected"}
        </span>
      </div>
    </div>
  );
}

/* ---------- modal ---------- */

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div className="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
        <header className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </motion.div>
    </motion.div>
  );
}
