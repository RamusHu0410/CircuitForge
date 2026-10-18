import { useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import type { Activity, ActivityKind, ChatMessage, Check, KiCadStatus, Level, Project, Settings } from "./types";
import { levelLabel, nextLevel } from "./data/explain";
import { EXAMPLE_PROJECT } from "./data/example";
import { connectKiCad, ENGINE_URL, fetchKiCadColors, KICAD_BRIDGE_URL, NotConnectedError, requestPlan, RequestError, SERVICE_DOWN, sendToKiCad } from "./api/client";
import { TutorialCard } from "./components/Tutorial";
import { TutorialOverlay, chapterProgress, type TutorialProgress } from "./components/tutorial/TutorialShell";
import { Plan } from "./components/Plan";
import { ChecksPanel, Composer, Modal, PartsMini, PreviewMenu, UtilityPanel, type PreviewKind } from "./components/Panels";
import { SchematicPreview } from "./components/SchematicPreview";
import { GeneratedCircuitView } from "./components/GeneratedCircuitView";

const SETTINGS_KEY = "circuitforge.settings";
const DEFAULT_SETTINGS: Settings = { kicadVersion: "9", level: "beginner" };

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export default function App() {
  const [project, setProject] = useState<Project>(EXAMPLE_PROJECT);
  const [isExample, setIsExample] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  const [flashStep, setFlashStep] = useState<string | null>(null);
  const [tutorial, setTutorial] = useState<number | null>(null);
  const [tutProgress, setTutProgress] = useState<TutorialProgress>({ howDone: false, mathTouched: false, reviewed: [] });
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<PreviewKind | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [kicad, setKicad] = useState<KiCadStatus>("disconnected");
  const [generating, setGenerating] = useState<{ prompt: string; run: number } | null>(null);
  const ids = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const log = useCallback((kind: ActivityKind, text: string) => {
    setActivity((a) => [{ id: ++ids.current, time: now(), kind, text }, ...a].slice(0, 100));
  }, []);

  useEffect(() => {
    log("info", "opened example");
    // Follow the user's KiCad colors when the bridge can provide them; otherwise keep KiCad's defaults.
    fetchKiCadColors()
      .then((vars) => Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v)))
      .catch(() => undefined);
    // Check for KiCad quietly. If the engine isn't running yet, the status just stays "not connected".
    connectKiCad()
      .then((s) => {
        if (s.status === "connected") {
          setKicad("connected");
          log("success", `kicad ${s.version ?? ""} found`.replace("  ", " "));
        }
      })
      .catch(() => log("warn", "engine not running"));
  }, [log]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings just won't persist */
    }
  }, [settings]);

  /* ---------- plan ---------- */
  const toggleStep = (id: string) =>
    setOpenSteps((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectCheck = (c: Check) => {
    setOpenSteps((s) => new Set(s).add(c.stepId));
    setFlashStep(c.stepId);
    window.setTimeout(() => setFlashStep((f) => (f === c.stepId ? null : f)), 1400);
  };

  const send = async (text: string) => {
    const id = ++ids.current;
    setMessages((m) => [...m, { id, text, state: "sending" }]);
    log("info", "sent prompt");
    const update = (patch: Partial<ChatMessage>) => setMessages((m) => m.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      const next = await requestPlan(text, project);
      setProject(next);
      setIsExample(false);
      setOpenSteps(new Set());
      update({ state: "done", note: next.summary ?? "plan updated" });
      log("success", next.summary ?? "plan updated");
    } catch (e) {
      if (e instanceof NotConnectedError) {
        update({ state: "not-connected", note: `engine not running. ${SERVICE_DOWN}` });
        log("warn", "engine not connected");
      } else if (e instanceof RequestError && e.status === 422) {
        // The engine understood the request but can't do it; its message says what it can do.
        update({ state: "declined", note: e.message });
        log("warn", "engine can't do that");
      } else {
        update({ state: "error", note: (e as Error).message });
        log("error", (e as Error).message);
      }
    }
  };

  /* ---------- kicad ---------- */
  const connect = async () => {
    setKicad("connecting");
    try {
      const s = await connectKiCad();
      setKicad(s.status);
      log(s.status === "connected" ? "success" : "warn", s.status === "connected" ? `kicad ${s.version ?? ""} connected`.replace("  ", " ") : s.detail);
    } catch (e) {
      setKicad("disconnected");
      log("warn", e instanceof NotConnectedError ? "engine not running" : (e as Error).message);
    }
  };

  const pushToKiCad = async () => {
    try {
      const sent = await sendToKiCad(project);
      log(sent.openedInKicad ? "success" : "warn", sent.openedInKicad ? `opened in kicad: ${sent.schematicPath}` : (sent.openError ?? `saved ${sent.schematicPath}`));
    } catch (e) {
      log("warn", e instanceof NotConnectedError ? "engine not running" : (e as Error).message);
    }
  };

  /* ---------- import / export ---------- */
  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/\W+/g, "-").toLowerCase() || "project"}.circuitforge.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    log("success", "exported");
  };

  const importProject = async (file: File) => {
    try {
      const p = JSON.parse(await file.text()) as Project;
      if (typeof p.request !== "string" || !Array.isArray(p.steps) || !Array.isArray(p.checks) || !p.params) throw new Error();
      setProject(p);
      setIsExample(false);
      setMessages([]);
      setOpenSteps(new Set());
      log("success", `imported ${file.name}`);
    } catch {
      log("error", `can't import ${file.name}`);
    }
  };

  const setLevel = (level: Level) => {
    setSettings((s) => ({ ...s, level }));
    log("info", `explain: ${levelLabel(level)}`);
  };

  const openTutorial = (i: number) => setTutorial(i);

  /** Used by the tutorial's "Generate in KiCad": rethrows so the button can show the failure. */
  const generateInKiCad = async () => {
    try {
      const sent = await sendToKiCad(project);
      log("success", `saved ${sent.schematicPath}`);
      // Saved but KiCad couldn't be launched: report it instead of claiming it was placed.
      if (!sent.openedInKicad) throw new Error(sent.openError ?? "Saved the schematic, but KiCad did not open it");
    } catch (e) {
      log("warn", e instanceof NotConnectedError ? "engine not running" : (e as Error).message);
      throw e;
    }
  };

  const parts = project.steps.flatMap((s) => s.parts);
  const sending = messages.some((m) => m.state === "sending");

  return (
    <MotionConfig reducedMotion="user">
    <div className="app">
      <aside className="left">
        <TutorialCard progress={chapterProgress(tutProgress, checklist)} onOpen={openTutorial} />
        <UtilityPanel activity={activity} onImport={() => fileRef.current?.click()} onExport={exportProject} onSettings={() => setSettingsOpen(true)} />
      </aside>

      <main className="middle">
        <Plan
          project={project}
          isExample={isExample}
          messages={messages}
          openSteps={openSteps}
          flashStep={flashStep}
          level={settings.level}
          kicad={kicad}
          onToggleStep={toggleStep}
        />
      </main>

      <aside className="right">
        <PreviewMenu onOpen={setPreview} />
        <ChecksPanel checks={project.checks} onSelect={selectCheck} />
        <PartsMini parts={parts} onOpen={() => setPreview("parts")} />
      </aside>

      <div className="bottom">
        <Composer onSend={send} onGenerate={(prompt) => { log("info", "generate circuit"); setGenerating({ prompt, run: ++ids.current }); }} busy={sending} level={settings.level} onCycleLevel={() => setLevel(nextLevel(settings.level))} kicad={kicad} />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) importProject(f);
        }}
      />

      {tutorial !== null && (
        <TutorialOverlay
          chapter={tutorial}
          project={project}
          checklist={checklist}
          progress={tutProgress}
          onProgress={(patch) => setTutProgress((p) => ({ ...p, ...patch }))}
          level={settings.level}
          onLevel={setLevel}
          onChapter={openTutorial}
          onToggle={(id) => setChecklist((c) => ({ ...c, [id]: !c[id] }))}
          onGenerate={generateInKiCad}
          onClose={() => setTutorial(null)}
        />
      )}

      {preview === "schematic" && (
        <Modal
          title="schematic"
          wide
          onClose={() => setPreview(null)}
          footer={
            <button className="btn" onClick={pushToKiCad}>
              open in kicad
            </button>
          }
        >
          <div className="sheet">
            <SchematicPreview project={project} isExample={isExample} />
          </div>
        </Modal>
      )}

      {generating && <GeneratedCircuitView key={generating.run} prompt={generating.prompt} onClose={() => setGenerating(null)} onLog={log} />}

      {preview === "parts" && (
        <Modal title="parts" onClose={() => setPreview(null)}>
          <div className="kv parts">
            {parts.map((p) => (
              <span key={p.ref} className="contents">
                <span>{p.ref}</span>
                <span>{p.name}</span>
                <span className="dim">{p.value}</span>
              </span>
            ))}
          </div>
        </Modal>
      )}

      {settingsOpen && (
        <Modal title="settings" onClose={() => setSettingsOpen(false)}>
          <div className="kv settings">
            <span>explain</span>
            <span>
              <select value={settings.level} onChange={(e) => setLevel(e.target.value as Level)}>
                <option value="eli5">like I'm 5</option>
                <option value="beginner">beginner</option>
                <option value="expert">expert</option>
              </select>
            </span>
            <span>kicad</span>
            <span>
              <select value={settings.kicadVersion} onChange={(e) => setSettings((s) => ({ ...s, kicadVersion: e.target.value as Settings["kicadVersion"] }))}>
                <option value="9">9</option>
                <option value="10">10</option>
              </select>
            </span>
            <span>status</span>
            <span>
              {kicad === "connected" ? "connected" : kicad === "connecting" ? "connecting…" : "not connected"}{" "}
              <button className="link" onClick={connect} disabled={kicad === "connecting"}>
                [connect]
              </button>
            </span>
            <span>bridge</span>
            <span className="dim">{KICAD_BRIDGE_URL || "/api (dev proxy)"}</span>
            <span>engine</span>
            <span className="dim">{ENGINE_URL || "/api (dev proxy)"}</span>
            <span>colors</span>
            <span className="dim">{kicad === "connected" ? "from kicad" : "kicad default"}</span>
          </div>
        </Modal>
      )}
    </div>
    </MotionConfig>
  );
}
