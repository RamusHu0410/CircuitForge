import { useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import type { Activity, ActivityKind, ChatMessage, Check, Level, Project, Settings } from "./types";
import type { DesktopInfo } from "./api/backend";
import { levelLabel, nextLevel } from "./data/explain";
import { EXAMPLE_PROJECT } from "./data/example";  // the tutorial is written around it
import { ApiError, exportDesign, getDesktopInfo, getSite, NotConnectedError, placeInSchematic, previewSvg, requestPlan, saveAndOpen, type SiteInfo } from "./api/client";
import { applyTheme, BACKGROUND_PRESETS, BRAND_PRESETS, DEFAULT_BACKGROUND, DEFAULT_BRAND, isHex } from "./theme";
import { svgToPng } from "./lib/svg";
import { KiCadPreview } from "./components/KiCadPreview";
import { CodeEditor } from "./components/CodeEditor";
import { Logo } from "./components/Logo";
import { ClassroomCard } from "./components/Tutorial";
import { Classroom, type ClassroomState } from "./components/classroom/Classroom";
import { Practice } from "./components/practice/Practice";
import { Arena, type ArenaTab } from "./components/arena/Arena";
import { TutorialOverlay, chapterProgress, type TutorialProgress } from "./components/tutorial/TutorialShell";
import { Plan, type ActionEntry, type KiCadInfo } from "./components/Plan";
import { ChecksPanel, Composer, Modal, PartsMini, PreviewMenu, UtilityPanel, type PreviewKind } from "./components/Panels";

const SETTINGS_KEY = "circuitforge.settings";
const DEFAULT_SETTINGS: Settings = { kicadVersion: "10", level: "beginner", brand: DEFAULT_BRAND, background: DEFAULT_BACKGROUND };

function loadSettings(): Settings {
  try {
    const saved = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") } as Settings;
    return { ...saved, brand: isHex(saved.brand) ? saved.brand : DEFAULT_BRAND, background: isHex(saved.background) ? saved.background : DEFAULT_BACKGROUND };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function describeKiCad(backendUp: boolean | null, desk: DesktopInfo | null, site: SiteInfo | null): KiCadInfo {
  if (backendUp === false) return { status: "disconnected", label: "backend offline" };
  if (site?.mode === "web") return { status: "connected", label: "CircuitForge web" };
  if (!desk) return { status: "connecting", label: "checking…" };
  if (desk.opened_from_kicad) return { status: "connected", label: `KiCad ${desk.kicad_version ?? ""} · ${desk.project_name ?? "no project"}` };
  if (desk.kicad_found) return { status: "connected", label: `KiCad ${desk.kicad_version ?? "found"}` };
  return { status: "disconnected", label: "KiCad not found" };
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null); // nothing until the user asks for something
  const [projectKey, setProjectKey] = useState(0);
  const [prefill, setPrefill] = useState<{ text: string; seq: number }>({ text: "", seq: 0 });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  const [flashStep, setFlashStep] = useState<string | null>(null);
  const [tutorial, setTutorial] = useState<number | null>(null); // the sample class (built-in example)
  const [classroom, setClassroom] = useState<number | null>(null); // section index in the current circuit's class
  const [classState, setClassState] = useState<ClassroomState>({ visited: [], answers: {}, done: {} });
  const [classLab, setClassLab] = useState(true); // the classroom opens on the interactive lab
  const [practice, setPractice] = useState(false);
  const [arena, setArena] = useState<ArenaTab | null>(null);
  const [site, setSite] = useState<SiteInfo | null>(null);
  const web = site?.mode === "web";
  const siteRef = useRef<SiteInfo | null>(null);
  const [tutProgress, setTutProgress] = useState<TutorialProgress>({ howDone: false, mathTouched: false, reviewed: [] });
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<PreviewKind | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [desk, setDesk] = useState<DesktopInfo | null>(null);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [code, setCode] = useState<string | null>(null); // the user's (possibly edited) firmware
  const ids = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const log = useCallback((kind: ActivityKind, text: string) => {
    setActivity((a) => [{ id: ++ids.current, time: now(), kind, text }, ...a].slice(0, 100));
  }, []);

  /* ---------- backend + KiCad status ---------- */
  const refreshInfo = useCallback(async () => {
    try {
      if (!siteRef.current) {
        siteRef.current = await getSite();
        setSite(siteRef.current);
      }
      if (siteRef.current.mode === "web") {
        // The website has no KiCad or desktop session: being able to reach the service is enough.
        await getSite();
        setBackendUp((was) => {
          if (was !== true) log("success", "connected");
          return true;
        });
        return;
      }
      const info = await getDesktopInfo();
      setDesk(info);
      setBackendUp((was) => {
        if (was !== true) log("success", info.opened_from_kicad ? `connected · ${info.project_name ?? "KiCad"}` : "backend connected");
        return true;
      });
    } catch {
      setBackendUp((was) => {
        if (was !== false) log("warn", "backend offline");
        return false;
      });
    }
  }, [log]);

  useEffect(() => {
    log("info", "ready");
    refreshInfo();
    const t = window.setInterval(refreshInfo, 8000);
    window.addEventListener("focus", refreshInfo);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", refreshInfo);
    };
  }, [log, refreshInfo]);

  useEffect(() => applyTheme(settings.brand, settings.background), [settings.brand, settings.background]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings just won't persist */
    }
  }, [settings]);

  const kicad = describeKiCad(backendUp, desk, site);

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

  const showProject = (next: Project) => {
    setProject(next);
    setClassState({ visited: [], answers: {}, done: {} });
    setClassroom(null);
    setCode(next.firmware?.code ?? null);
    setActions([]);
    setOpenSteps(new Set());
    setProjectKey((k) => k + 1);
  };

  const send = async (text: string) => {
    const id = ++ids.current;
    setMessages((m) => [...m, { id, text, state: "sending" }]);
    log("info", "sent prompt");
    try {
      const next = await requestPlan(text);
      setMessages((m) => m.filter((x) => x.id !== id));
      showProject(next);
      log("success", `generated ${next.name}`);
      refreshInfo();
    } catch (e) {
      const offline = e instanceof NotConnectedError;
      // The engine lists what it supports as " - item - item"; show that as a list.
      const note = offline ? "backend offline: start it, then try again" : (e as Error).message.replace(/\s-\s(?=[A-Z0-9])/g, "\n• ");
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, state: offline ? "not-connected" : "error", note } : x)));
      log(offline ? "warn" : "error", offline ? "backend offline" : e instanceof ApiError && e.status === 422 ? "can't build that yet" : "generation failed");
    }
  };

  /* ---------- actions on a generated circuit ---------- */
  const runAction = async (call: string, work: () => Promise<string[]>) => {
    const id = ++ids.current;
    setActions((a) => [...a, { id, call, state: "running", lines: [] }]);
    try {
      const lines = await work();
      setActions((a) => a.map((x) => (x.id === id ? { ...x, state: "done", lines } : x)));
    } catch (e) {
      setActions((a) => a.map((x) => (x.id === id ? { ...x, state: "error", lines: [(e as Error).message] } : x)));
      log("error", `${call.split("(")[0].toLowerCase()} failed`);
    }
  };

  const place = () =>
    project?.files &&
    runAction("Place(into your schematic)", async () => {
      const r = await placeInSchematic(project!.files!);
      log("success", `copied ${r.symbols} symbols`);
      return [r.message, "If references clash with yours, run Tools → Annotate Schematic."];
    });

  /** The firmware as the user has edited it (what gets saved and exported). */
  const firmware = project?.firmware && code !== null ? { ...project.firmware, code } : project?.firmware;

  /** On the website: hand the KiCad project (and the sketch) to the browser as downloads. */
  const download = () =>
    project?.files &&
    runAction("Download(KiCad project)", async () => {
      const files = project!.files!;
      const items: [string, string][] = [
        [`${files.name}.kicad_sch`, files.schematic],
        [`${files.name}.kicad_pro`, files.project],
        ...(firmware ? ([[firmware.file_name, firmware.code]] as [string, string][]) : []),
      ];
      for (const [name, text] of items) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
        await new Promise((r) => setTimeout(r, 250)); // browsers drop downloads fired in the same instant
      }
      log("success", "downloaded");
      return [`downloaded ${items.map(([n]) => n).join(", ")}`, "Put them in one folder and open the .kicad_pro in KiCad."];
    });

  const save = () =>
    web ? download() :
    project?.files &&
    runAction("Save(new KiCad project)", async () => {
      const r = await saveAndOpen(project!.files!, firmware);
      log("success", "saved project");
      return [
        `saved to ${r.schematic_path}`,
        ...(r.firmware_path ? [`code saved to ${r.firmware_path}`] : []),
        r.opened_in_kicad ? "opened in KiCad's Schematic Editor" : (r.open_error ?? "saved (not opened)"),
      ];
    });

  /** Save with an empty board and open the project, so F8 in the PCB Editor pulls in the footprints. */
  const openPcb = () =>
    project?.files &&
    runAction("Open(PCB in KiCad)", async () => {
      const r = await saveAndOpen(project!.files!, firmware, "pcb");
      log("success", "opened board project");
      const board = r.board_path?.split("/").pop() ?? "the .kicad_pcb";
      return [
        `saved to ${r.folder}`,
        r.opened_in_kicad ? "opened the project in KiCad" : (r.open_error ?? "saved (not opened)"),
        `In KiCad, double-click ${board}, then press F8 (Tools → Update PCB from Schematic): the footprints are already assigned.`,
      ];
    });

  const exportAll = () =>
    project?.files &&
    runAction("Export(pictures + code)", async () => {
      let png: string | null = null;
      try {
        png = await svgToPng(await previewSvg(project!.files!));
      } catch {
        png = null; // SVG and PDF still come from KiCad
      }
      const r = await exportDesign(project!.files!, firmware, png);
      log("success", "exported");
      const names = r.files.map((f) => f.split("/").pop());
      return [`exported to ${r.folder}`, names.join("  "), ...r.skipped.map((x) => `skipped ${x}`), ...(r.reveal_error ? [r.reveal_error] : [])];
    });

  const openSection = (id: string) => {
    const i = project?.lesson?.sections.findIndex((s) => s.id === id) ?? -1;
    if (i >= 0) {
      setClassLab(false);
      setClassroom(i);
    }
  };

  const openCode = () => {
    setOpenSteps((s) => new Set(s).add("code"));
    setFlashStep("code");
    window.setTimeout(() => setFlashStep((f) => (f === "code" ? null : f)), 1400);
  };

  /* ---------- import / export ---------- */
  const exportProject = () => {
    if (!project) return log("info", "nothing to export yet");
    if (project.files) return exportAll(); // pictures + code + KiCad project, via the backend
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
      if (typeof p.request !== "string" || !Array.isArray(p.steps) || !Array.isArray(p.checks)) throw new Error();
      setMessages([]);
      showProject(p);
      log("success", `imported ${file.name}`);
    } catch {
      log("error", `can't import ${file.name}`);
    }
  };

  const setLevel = (level: Level) => {
    setSettings((s) => ({ ...s, level }));
    log("info", `explain: ${levelLabel(level)}`);
  };

  /** Tutorial's "Generate in KiCad": rethrows so the button can show the failure honestly. */
  const generateInKiCad = async () => {
    if (!project?.files) {
      throw new Error("The engine can't build the tutorial's Arduino example yet. Describe a circuit in the main window, then use 'place in my schematic'");
    }
    const r = await saveAndOpen(project.files, firmware);
    log("success", "saved project");
    if (!r.opened_in_kicad) throw new Error(r.open_error ?? "Saved, but KiCad didn't open");
  };

  const parts = project?.steps.flatMap((s) => s.parts) ?? [];
  const sending = messages.some((m) => m.state === "sending");

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <aside className="left">
          <div className="brand-bar">
            <Logo size={26} idle sparkOnHover />
            <span className="brand-name">CircuitForge</span>
          </div>
          <ClassroomCard
            project={project}
            state={classState}
            onOpen={(i) => {
              setClassLab(false);
              setClassroom(i);
            }}
            onExplore={() => {
              setClassLab(true);
              setClassroom(0);
            }}
            onSample={() => setTutorial(Math.max(0, chapterProgress(tutProgress, checklist).findIndex((f) => f < 1)))}
            onPractice={() => setPractice(true)}
          />
          <UtilityPanel activity={activity} onImport={() => fileRef.current?.click()} onExport={exportProject} onSettings={() => setSettingsOpen(true)} />
        </aside>

        <main className="middle">
          <Plan
            key={projectKey}
            project={project}
            showWelcome={!settings.welcomeDismissed}
            onCloseWelcome={() => setSettings((s) => ({ ...s, welcomeDismissed: true }))}
            onPickExample={(text) => setPrefill((p) => ({ text, seq: p.seq + 1 }))}
            onPractice={() => setPractice(true)}
            web={web}
            site={site}
            onExplore={() => {
              setClassLab(true);
              setClassroom(0);
            }}
            onArena={setArena}
            onOpenPcb={openPcb}
            messages={messages}
            actions={actions}
            openSteps={openSteps}
            flashStep={flashStep}
            level={settings.level}
            kicad={kicad}
            onToggleStep={toggleStep}
            onPlace={place}
            onSave={save}
            onExport={exportAll}
            onEditCode={openCode}
            code={code}
            onCode={setCode}
            onResetCode={() => setCode(project?.firmware?.code ?? null)}
            onPreview={() => setPreview("schematic")}
            answers={classState.answers}
            onAnswer={(key, choice) => setClassState((c) => ({ ...c, answers: { ...c.answers, [key]: choice } }))}
            onOpenSection={openSection}
          />
        </main>

        <aside className="right">
          <PreviewMenu onOpen={(k) => (k === "pcb" ? (project?.files ? openPcb() : setPreview("pcb")) : setPreview(k))} />
          <ChecksPanel key={projectKey} checks={project?.checks ?? []} onSelect={selectCheck} />
          <PartsMini key={`p${projectKey}`} parts={parts} onOpen={() => setPreview("parts")} />
        </aside>

        <div className="bottom">
          <Composer prefill={prefill} onSend={send} busy={sending} level={settings.level} onCycleLevel={() => setLevel(nextLevel(settings.level))} kicad={kicad} />
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

        {classroom !== null && project?.lesson && (
          <Classroom
            project={{ ...project, lesson: project.lesson, firmware }} /* the code as edited: it runs in the lab */
            index={Math.min(classroom, project.lesson.sections.length - 1)}
            state={classState}
            level={settings.level}
            onLevel={setLevel}
            onIndex={setClassroom}
            onState={(patch) => setClassState((c) => ({ ...c, ...patch }))}
            onClose={() => setClassroom(null)}
            lab={classLab}
            onLab={setClassLab}
          />
        )}

        {practice && <Practice generate={requestPlan} level={settings.level} onClose={() => setPractice(false)} />}

        {arena && web && <Arena tab={arena} level={settings.level} onClose={() => setArena(null)} />}

        {tutorial !== null && (
          <TutorialOverlay
            chapter={tutorial}
            project={EXAMPLE_PROJECT}
            checklist={checklist}
            progress={tutProgress}
            onProgress={(patch) => setTutProgress((p) => ({ ...p, ...patch }))}
            level={settings.level}
            onLevel={setLevel}
            onChapter={setTutorial}
            onToggle={(id) => setChecklist((c) => ({ ...c, [id]: !c[id] }))}
            onGenerate={generateInKiCad}
            onClose={() => setTutorial(null)}
          />
        )}

        {preview === "schematic" && (
          <Modal
            title={project?.files ? `schematic · ${project.name}` : "schematic"}
            wide
            onClose={() => setPreview(null)}
            footer={
              project?.files ? (
                <>
                  <button className="btn" onClick={() => (setPreview(null), place())}>
                    place in my schematic
                  </button>
                  <button className="btn" onClick={() => (setPreview(null), save())}>
                    save as new project
                  </button>
                </>
              ) : undefined
            }
          >
            {project?.files ? (
              <div className="sheet">
                <KiCadPreview files={project.files} />
              </div>
            ) : (
              <div className="preview-msg dim">Nothing to preview yet. Describe a circuit and KiCad's own drawing of it shows up here.</div>
            )}
          </Modal>
        )}

        {preview === "code" && (
          <Modal
            title={project?.firmware ? `code · ${project.firmware.file_name}` : "code"}
            wide
            onClose={() => setPreview(null)}
            footer={
              project?.firmware ? (
                <>
                  <span className="dim small">{project.firmware.board} · Arduino C++</span>
                  <button className="btn" onClick={() => (setPreview(null), exportAll())}>
                    export with pictures
                  </button>
                </>
              ) : undefined
            }
          >
            {project?.firmware && code !== null ? (
              <CodeEditor value={code} onChange={setCode} height={520} />
            ) : (
              <div className="preview-msg dim">This circuit has no microcontroller, so there's no code. Try “red LED blinks when the button is pressed twice”.</div>
            )}
          </Modal>
        )}

        {preview === "pcb" && (
          <Modal title="pcb" onClose={() => setPreview(null)}>
            <p className="preview-msg dim">
              Generate a circuit first. Then this saves it as a KiCad project with an empty board and opens it: open the board and press F8 (Update PCB from
              Schematic) to drop in the footprints. Placing and routing the board is still done in KiCad.
            </p>
          </Modal>
        )}

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
              <span>backend</span>
              <span>
                {backendUp ? "running" : backendUp === false ? "offline" : "checking…"}{" "}
                <button className="link" onClick={refreshInfo}>
                  [check]
                </button>
              </span>
              <span>kicad</span>
              <span className="dim">{desk?.kicad_found ? `found · ${desk.kicad_version ?? ""}` : "not found"}</span>
              <span>project</span>
              <span className="dim">{desk?.project_name ?? "— (open this window from KiCad's toolbar)"}</span>
              <span>saves to</span>
              <span className="dim">{desk?.save_dir ?? "—"}</span>
              <span>accent</span>
              <span className="swatches">
                {BRAND_PRESETS.map((c) => (
                  <button key={c.value} className={`swatch${settings.brand === c.value ? " on" : ""}`} style={{ background: c.value }} title={c.name} aria-label={`${c.name} accent`} onClick={() => setSettings((s) => ({ ...s, brand: c.value }))} />
                ))}
                <label className="swatch custom" title="Custom accent">
                  <input type="color" value={settings.brand} onChange={(e) => setSettings((s) => ({ ...s, brand: e.target.value }))} aria-label="Custom accent colour" />
                </label>
              </span>
              <span>background</span>
              <span className="swatches">
                {BACKGROUND_PRESETS.map((c) => (
                  <button key={c.value} className={`swatch bg${settings.background === c.value ? " on" : ""}`} style={{ background: c.value }} title={c.name} aria-label={`${c.name} background`} onClick={() => setSettings((s) => ({ ...s, background: c.value }))} />
                ))}
                <label className="swatch custom" title="Custom background">
                  <input type="color" value={settings.background} onChange={(e) => setSettings((s) => ({ ...s, background: e.target.value }))} aria-label="Custom background colour" />
                </label>
              </span>
              <span />
              <span>
                <button className="link" onClick={() => setSettings((s) => ({ ...s, brand: DEFAULT_BRAND, background: DEFAULT_BACKGROUND }))}>
                  [reset colours]
                </button>
              </span>
            </div>
          </Modal>
        )}
      </div>
    </MotionConfig>
  );
}
