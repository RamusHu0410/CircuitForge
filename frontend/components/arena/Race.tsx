import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Crown, LogIn, Plus, Shuffle, Trophy, Users, Zap } from "lucide-react";
import { raceSocket, type PartLibrary } from "../../api/client";
import { CHALLENGES, challengeById } from "../../arena/challenges";
import { fmtTime, RunScreen, type Opponent } from "./SpeedRun";

interface RoomPlayer {
  id: string;
  name: string;
  ready: boolean;
  progress: number;
  attempts: number;
  finished_ms: number | null;
  score: number | null;
}

interface Room {
  code: string;
  challenge: string;
  host: string;
  public: boolean;
  state: "lobby" | "countdown" | "racing" | "done";
  start_at: number | null;
  limit_s: number;
  players: RoomPlayer[];
}

const NAME_KEY = "circuitforge.name";

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Live races against other people on the website. */
export function Race({ library, onBots }: { library: PartLibrary; onBots: () => void }) {
  const [name, setName] = useState(savedName);
  const [status, setStatus] = useState<"idle" | "connecting" | "online" | "offline">("idle");
  const [me, setMe] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState(CHALLENGES[0].id);
  const [lonely, setLonely] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const offset = useRef(0); // server clock − local clock

  const send = useCallback((msg: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  }, []);

  const connect = (then: object) => {
    const n = name.trim() || "player";
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* the name just won't be remembered */
    }
    if (ws.current && ws.current.readyState <= WebSocket.OPEN) {
      send(then);
      return;
    }
    setStatus("connecting");
    setError(null);
    const socket = raceSocket(n);
    ws.current = socket;
    socket.onopen = () => {
      setStatus("online");
      socket.send(JSON.stringify(then));
    };
    socket.onclose = () => {
      setStatus("offline");
      setRoom(null);
    };
    socket.onerror = () => setError("Couldn't reach the race server.");
    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (typeof msg.now === "number") offset.current = msg.now - Date.now();
      if (msg.type === "hello") setMe(msg.id);
      else if (msg.type === "room") setRoom(msg.room);
      else if (msg.type === "error") setError(msg.message);
    };
  };

  useEffect(() => () => ws.current?.close(), []);

  // Alone in a quick-match room for a while: suggest the bots.
  useEffect(() => {
    setLonely(false);
    if (room?.public && room.state === "lobby" && room.players.length < 2) {
      const t = window.setTimeout(() => setLonely(true), 20000);
      return () => window.clearTimeout(t);
    }
  }, [room?.public, room?.state, room?.players.length]);

  const leave = () => {
    send({ type: "leave" });
    setRoom(null);
  };

  /* ---------- in a room ---------- */
  if (room && me) {
    const ch = challengeById(room.challenge) ?? CHALLENGES[0];
    const mine = room.players.find((p) => p.id === me);
    const isHost = room.host === me;
    if (room.state === "countdown" || room.state === "racing" || room.state === "done") {
      const startAt = (room.start_at ?? Date.now()) - offset.current;
      const opponents: Opponent[] = room.players.filter((p) => p.id !== me).map((p) => ({ id: p.id, name: p.name, progress: p.progress, finishedMs: p.finished_ms, attempts: p.attempts }));
      const ranking = [...room.players].sort((a, b) => (a.finished_ms ?? Infinity) - (b.finished_ms ?? Infinity) || b.progress - a.progress);
      return (
        <RunScreen
          key={`${room.code}-${room.start_at}`}
          challenge={ch}
          library={library}
          startAt={startAt}
          opponents={opponents}
          finished={mine?.finished_ms != null ? { ms: mine.finished_ms, score: mine.score ?? 0 } : null}
          limitS={room.limit_s}
          onProgress={(p) => send({ type: "progress", progress: p })}
          onSubmit={(s) => send({ type: "submit", ok: s.pass, score: s.score })}
          onLeave={leave}
          results={
            <div className="results">
              <Trophy size={28} />
              <div>
                <h3>{room.state === "done" ? "Final results" : "You're through! Waiting for the others…"}</h3>
                <ol className="ranking">
                  {ranking.map((p, i) => (
                    <li key={p.id} className={p.id === me ? "me" : ""}>
                      {i === 0 && p.finished_ms !== null && <Crown size={13} />} <b>{p.name}</b> {p.finished_ms !== null ? fmtTime(p.finished_ms) : room.state === "done" ? "didn't finish" : "building…"}{" "}
                      {p.score !== null && <span className="dim">score {p.score}</span>}
                    </li>
                  ))}
                </ol>
              </div>
              {room.state === "done" && isHost && (
                <button className="btn" onClick={() => send({ type: "again" })}>
                  race again
                </button>
              )}
            </div>
          }
        />
      );
    }
    return (
      <div className="race-room">
        <div className="room-head">
          <h3>
            {room.public ? "Quick match" : "Private room"} <code className="room-code">{room.code}</code>
            {!room.public && (
              <button className="icon-btn" title="Copy the code" onClick={() => navigator.clipboard?.writeText(room.code)}>
                <Copy size={14} />
              </button>
            )}
          </h3>
          <button className="link" onClick={leave}>
            leave
          </button>
        </div>
        <p className="dim">{room.public ? "The race starts a few seconds after a second player joins." : "Share the code. The race starts when everyone's ready, or when the host starts it."}</p>
        <div className="room-challenge">
          <b>Challenge:</b>{" "}
          {isHost && !room.public ? (
            <select value={room.challenge} onChange={(e) => send({ type: "challenge", challenge: e.target.value })}>
              {CHALLENGES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          ) : (
            ch.title
          )}{" "}
          <span className="dim">· {ch.brief}</span>
        </div>
        <ul className="room-players">
          {room.players.map((p) => (
            <li key={p.id}>
              <Users size={13} /> <b>{p.name}</b> {p.id === room.host && <Crown size={12} />} {p.id === me && <span className="dim">(you)</span>}
              <span className={`ready${p.ready ? " on" : ""}`}>{p.ready ? "ready" : "not ready"}</span>
            </li>
          ))}
        </ul>
        <div className="room-actions">
          <button className={`btn${mine?.ready ? "" : " primary-btn"}`} onClick={() => send({ type: "ready", ready: !mine?.ready })}>
            {mine?.ready ? "not ready" : "I'm ready"}
          </button>
          {isHost && !room.public && (
            <button className="btn" disabled={room.players.length < 2} onClick={() => send({ type: "start" })}>
              <Zap size={14} /> start now
            </button>
          )}
        </div>
        {lonely && (
          <p className="lonely">
            Nobody else is around right now.{" "}
            <button className="link" onClick={() => (leave(), onBots())}>
              Race the bots instead
            </button>
          </p>
        )}
        {error && <p className="bad small">{error}</p>}
      </div>
    );
  }

  /* ---------- lobby ---------- */
  return (
    <div className="race-lobby">
      <label className="race-name">
        Your name
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="what others see" />
      </label>
      <div className="race-options">
        <button className="race-opt" onClick={() => connect({ type: "quick" })}>
          <Shuffle size={20} />
          <b>Quick match</b>
          <span className="dim">Join anyone who's waiting, on a random challenge.</span>
        </button>
        <div className="race-opt">
          <Plus size={20} />
          <b>Private room</b>
          <span className="dim">Race your friends or class on one challenge.</span>
          <select value={challenge} onChange={(e) => setChallenge(e.target.value)} aria-label="Challenge">
            {CHALLENGES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button className="btn primary-btn" onClick={() => connect({ type: "create", challenge })}>
            create
          </button>
        </div>
        <div className="race-opt">
          <LogIn size={20} />
          <b>Join a room</b>
          <span className="dim">Got a code from a friend?</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={5} placeholder="ABCDE" aria-label="Room code" />
          <button className="btn" disabled={code.length !== 5} onClick={() => connect({ type: "join", code })}>
            join
          </button>
        </div>
      </div>
      {status === "connecting" && <p className="dim">connecting…</p>}
      {error && <p className="bad">{error}</p>}
      <p className="dim small">Times are kept by the server; whether a build passes is checked by the simulator in your browser.</p>
    </div>
  );
}
