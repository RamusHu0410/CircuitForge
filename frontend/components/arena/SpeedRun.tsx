import { useEffect, useMemo, useRef, useState } from "react";
import { Bot as BotIcon, Check, CircuitBoard, Code2, Flag, Medal, RotateCcw, Star, Timer, Trophy, X } from "lucide-react";
import { getLeaderboard, type LeaderboardEntry, type PartLibrary } from "../../api/client";
import { BOTS, planBot, type BotRun } from "../../arena/bots";
import { CHALLENGES, type Challenge, type Judgement } from "../../arena/challenges";
import { buildNetlist, emptyBuild, type Build } from "../../lab/build";
import { rateCircuit, type Rating } from "../../lab/rate";
import { Editor, STARTER_SKETCH } from "./Editor";
import { RatingReport } from "./RatingReport";

export const fmtTime = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

const PB_KEY = "circuitforge.pb";
export function loadBests(): Record<string, { ms: number; score: number }> {
  try {
    return JSON.parse(localStorage.getItem(PB_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function saveBest(id: string, ms: number, score: number) {
  const all = loadBests();
  if (!all[id] || ms < all[id].ms) {
    all[id] = { ms, score };
    try {
      localStorage.setItem(PB_KEY, JSON.stringify(all));
    } catch {
      /* best times just won't be kept */
    }
  }
}

export interface Opponent {
  id: string;
  name: string;
  tag?: string;
  progress: number;
  finishedMs: number | null;
  attempts: number;
}

export interface Submission {
  pass: boolean;
  score: number;
  judgement: Judgement;
  rating: Rating;
}

/** How far along a build looks, for the progress lanes (parts placed, then wires). */
export function buildProgress(build: Build, challenge: Challenge): number {
  const kinds = new Set(build.parts.map((p) => p.kind));
  const placed = challenge.needs.filter((k) => kinds.has(k) || (k.startsWith("arduino") && [...kinds].some((x) => x.startsWith("arduino")))).length / challenge.needs.length;
  const wires = Math.min(1, build.wires.length / Math.max(2, challenge.needs.length * 1.5));
  return Math.min(0.95, placed * 0.5 + wires * 0.45);
}

interface RunProps {
  challenge: Challenge;
  library: PartLibrary;
  /** Date.now() at which the clock started. */
  startAt: number;
  opponents: Opponent[];
  finished: { ms: number; score: number } | null;
  onSubmit: (s: Submission) => void;
  onProgress?: (p: number) => void;
  onLeave: () => void;
  limitS?: number;
  results?: React.ReactNode;
}

/** The race itself: brief, clock, progress lanes, the editor, and the judge. */
export function RunScreen({ challenge, library, startAt, opponents, finished, onSubmit, onProgress, onLeave, limitS, results }: RunProps) {
  const [build, setBuild] = useState<Build>(emptyBuild);
  const [code, setCode] = useState(challenge.starter ?? "");
  const [now, setNow] = useState(Date.now());
  const [last, setLast] = useState<Submission | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, []);
  const progress = buildProgress(build, challenge);
  const sent = useRef(-1);
  useEffect(() => {
    if (onProgress && Math.abs(progress - sent.current) > 0.02) {
      sent.current = progress;
      onProgress(progress);
    }
  }, [progress, onProgress]);

  const elapsed = finished ? finished.ms : now - startAt;
  const counting = now < startAt;
  const overTime = limitS !== undefined && elapsed > limitS * 1000;
  const hasBoard = build.parts.some((p) => p.kind.startsWith("arduino"));

  const submit = () => {
    setChecking(true);
    window.setTimeout(() => {
      const netlist = buildNetlist(build, library.symbols);
      const firmware = hasBoard ? code || STARTER_SKETCH : undefined;
      const judgement = challenge.judge(netlist, firmware);
      const rating = rateCircuit(netlist, firmware);
      const s = { pass: judgement.pass, score: rating.score, judgement, rating };
      setAttempts((a) => a + 1);
      setLast(s);
      setChecking(false);
      onSubmit(s);
    }, 20);
  };

  const lanes = [{ id: "you", name: "You", progress: finished ? 1 : progress, finishedMs: finished?.ms ?? null, attempts, tag: undefined as string | undefined }, ...opponents];

  return (
    <div className="run">
      <aside className="run-brief">
        <div className={`clock${finished ? " done" : ""}${overTime ? " over" : ""}`}>
          <Timer size={18} /> {counting ? `starts in ${Math.ceil((startAt - now) / 1000)}` : fmtTime(elapsed)}
        </div>
        <div className="dim small">par {fmtTime(challenge.par * 1000)}{limitS ? ` · limit ${fmtTime(limitS * 1000)}` : ""}</div>
        <h3>{challenge.title}</h3>
        <p>{challenge.brief}</p>
        <ul className="rules">
          {challenge.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="lanes">
          {lanes.map((l) => (
            <div key={l.id} className={`lane${l.id === "you" ? " you" : ""}${l.finishedMs !== null ? " fin" : ""}`}>
              <span className="lane-name">
                {l.name} {l.tag && <i>{l.tag}</i>}
              </span>
              <span className="lane-track">
                <span style={{ width: `${Math.round((l.finishedMs !== null ? 1 : l.progress) * 100)}%` }} />
              </span>
              <span className="lane-time">{l.finishedMs !== null ? fmtTime(l.finishedMs) : l.attempts > 0 ? `${l.attempts} tr${l.attempts > 1 ? "ies" : "y"}` : ""}</span>
            </div>
          ))}
        </div>
        {!finished && (
          <button className="btn primary-btn submit" disabled={counting || checking || !build.parts.length} onClick={submit}>
            <Flag size={14} /> {checking ? "checking…" : "check & submit"}
          </button>
        )}
        {last && !last.pass && !finished && (
          <ul className="checks">
            {last.judgement.checks.map((c) => (
              <li key={c.label} className={c.ok ? "ok" : "bad"}>
                {c.ok ? <Check size={13} /> : <X size={13} />} <b>{c.label}</b> <span>{c.detail}</span>
              </li>
            ))}
          </ul>
        )}
        <button className="link leave" onClick={onLeave}>
          leave
        </button>
      </aside>
      <main className={`run-main${counting ? " locked" : ""}`}>
        {finished && last ? (
          <div className="run-done">
            {results}
            <RatingReport rating={last.rating} />
          </div>
        ) : (
          <Editor library={library} build={build} onBuild={setBuild} code={code} onCode={setCode} needs={challenge.needs} />
        )}
        {counting && <div className="countdown">{Math.ceil((startAt - now) / 1000)}</div>}
      </main>
    </div>
  );
}

/* ---------- solo speed runs, with bots ---------- */

export function SpeedRun({ library, web }: { library: PartLibrary; web: boolean }) {
  const [pick, setPick] = useState<Challenge | null>(null);
  const [bots, setBots] = useState<string[]>(["ohm", "tesla"]);
  const [run, setRun] = useState<{ challenge: Challenge; startAt: number; plans: BotRun[]; key: number } | null>(null);
  const [finished, setFinished] = useState<{ ms: number; score: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [bests, setBests] = useState(loadBests);
  const [board, setBoard] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    if (!run) return;
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, [run]);
  useEffect(() => {
    setBoard(null);
    if (web && pick) getLeaderboard(pick.id).then(setBoard, () => setBoard([]));
  }, [web, pick]);

  const start = (challenge: Challenge) => {
    const seed = Math.floor(Math.random() * 1e9);
    setFinished(null);
    setRun({ challenge, startAt: Date.now() + 3500, plans: BOTS.filter((b) => bots.includes(b.id)).map((b) => planBot(b, challenge, seed)), key: seed });
  };

  const opponents: Opponent[] = useMemo(() => {
    if (!run) return [];
    const t = (now - run.startAt) / 1000;
    return run.plans.map((p) => ({ id: p.bot.id, name: p.bot.name, tag: p.bot.title, progress: p.progress(t), finishedMs: t >= p.finishAt ? p.finishAt * 1000 : null, attempts: t >= p.finishAt ? p.attempts : 0 }));
  }, [run, now]);

  if (run) {
    const place = finished ? 1 + run.plans.filter((p) => p.finishAt * 1000 < finished.ms).length : null;
    return (
      <RunScreen
        key={run.key}
        challenge={run.challenge}
        library={library}
        startAt={run.startAt}
        opponents={opponents}
        finished={finished}
        onSubmit={(s) => {
          if (!s.pass) return;
          const ms = Date.now() - run.startAt;
          setFinished({ ms, score: s.score });
          saveBest(run.challenge.id, ms, s.score);
          setBests(loadBests());
        }}
        onLeave={() => setRun(null)}
        results={
          finished && (
            <div className="results">
              <Trophy size={28} />
              <div>
                <h3>
                  {fmtTime(finished.ms)} · {place === 1 ? "you won!" : `place ${place} of ${run.plans.length + 1}`}
                </h3>
                <p className="dim">
                  {finished.ms <= run.challenge.par * 1000 ? "Under par: that's elite pace." : `Par is ${fmtTime(run.challenge.par * 1000)}.`} Design score {finished.score}/100.
                  {bests[run.challenge.id]?.ms === finished.ms ? " New personal best." : bests[run.challenge.id] ? ` Your best: ${fmtTime(bests[run.challenge.id].ms)}.` : ""}
                </p>
              </div>
              <button className="btn" onClick={() => start(run.challenge)}>
                <RotateCcw size={14} /> again
              </button>
              <button className="btn" onClick={() => setRun(null)}>
                other challenges
              </button>
            </div>
          )
        }
      />
    );
  }

  return (
    <div className="sr-pick">
      <div className="sr-bots">
        <BotIcon size={16} /> Race against:
        {BOTS.map((b) => (
          <button key={b.id} className={`chip-btn${bots.includes(b.id) ? " on" : ""}`} onClick={() => setBots((x) => (x.includes(b.id) ? x.filter((y) => y !== b.id) : [...x, b.id]))}>
            {b.name} <span className="dim">{b.title}</span>
          </button>
        ))}
        <span className="dim small">{bots.length ? "" : "nobody: just you and the clock"}</span>
      </div>
      <div className="sr-grid">
        {CHALLENGES.map((c) => (
          <div key={c.id} className={`sr-card${pick?.id === c.id ? " on" : ""}`} onClick={() => setPick(c)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setPick(c)}>
            <div className="sr-card-top">
              <span className="pr-stars">
                {[1, 2, 3].map((i) => (
                  <Star key={i} size={12} fill={i <= c.level ? "currentColor" : "none"} />
                ))}
              </span>
              {c.category === "code" ? <Code2 size={14} /> : <CircuitBoard size={14} />}
            </div>
            <b>{c.title}</b>
            <span className="dim">{c.brief}</span>
            <span className="sr-times">
              par {fmtTime(c.par * 1000)}
              {bests[c.id] && (
                <>
                  {" "}
                  · <Medal size={12} /> {fmtTime(bests[c.id].ms)}
                </>
              )}
            </span>
            <button
              className="btn primary-btn"
              onClick={(e) => {
                e.stopPropagation();
                start(c);
              }}
            >
              go
            </button>
          </div>
        ))}
      </div>
      {web && pick && (
        <div className="sr-board">
          <h4>
            <Trophy size={14} /> Fastest correct builds · {pick.title}
          </h4>
          {board === null ? (
            <p className="dim small">loading…</p>
          ) : board.length ? (
            <ol>
              {board.slice(0, 10).map((e, i) => (
                <li key={i}>
                  <b>{e.name}</b> {fmtTime(e.time_ms)} <span className="dim">score {e.score}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="dim small">No one has finished this one in a live race yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
