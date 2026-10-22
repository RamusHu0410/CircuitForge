import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import { partPins, pinNamesOf, WIRE_COLORS, type Build, type BuildPart, type End, type Look, type Symbols } from "../../lab/build";
import type { Pt } from "../../lab/scene";
import { GraphicEl, Pins } from "../lab/Schematic2D";
import { footprint } from "./physical";

const GRID = 1.27;

/** Something in the tray: an exercise's part (placed once, keeps its ref) or a library part (any number). */
export interface TrayItem {
  key: string;
  kind: string;
  value: string;
  lib_id: string;
  ref?: string;
  prefix?: string; // for library parts: R, C, D, U…
  label: string;
  hint?: string;
  /** Heading shown above the first item of each group. */
  group?: string;
  /** Highlight it (a challenge's key parts). */
  key_part?: boolean;
}

interface Props {
  look: Look;
  symbols: Symbols;
  tray: TrayItem[];
  ports: { net: string; lib_id: string }[];
  build: Build;
  onChange: (b: Build) => void;
  /** Canvas size in mm. */
  size?: [number, number];
  trayTitle?: string;
  onSelectPart?: (id: string | null) => void;
}

let ids = 0;
const newId = (p: string) => `${p}${++ids}`;
const snap = (v: number) => Math.round(v / GRID) * GRID;

function symbolBody(symbols: Symbols, libId: string) {
  return symbols[libId].graphics.map((g, i) => <GraphicEl key={i} g={g} body="var(--kc-body)" />);
}

export function Builder({ look, symbols, tray, ports, build, onChange, size = [112, 72], trayTitle, onSelectPart }: Props) {
  const [W, H] = size;
  const svg = useRef<SVGSVGElement>(null);
  const [selected, setSelectedRaw] = useState<{ kind: "part" | "port" | "wire"; id: string } | null>(null);
  const setSelected = (s: { kind: "part" | "port" | "wire"; id: string } | null) => {
    setSelectedRaw(s);
    onSelectPart?.(s?.kind === "part" ? s.id : null);
  };
  const [pending, setPending] = useState<End | null>(null);
  const [mouse, setMouse] = useState<Pt | null>(null);
  const drag = useRef<{ id: string; kind: "part" | "port"; dx: number; dy: number; moved: boolean } | null>(null);
  const [hoverPin, setHoverPin] = useState<{ label: string; at: Pt } | null>(null);

  const portLibs = useMemo(() => new Map(ports.map((p) => [p.net, p.lib_id])), [ports]);

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [p.x, p.y];
  };

  const pinsOf = (part: BuildPart) => partPins(part, look, symbols);
  const endPoint = (end: End): Pt | null => {
    const part = build.parts.find((p) => p.id === end.id);
    if (part) return pinsOf(part).find((p) => p.number === end.pin)?.at ?? null;
    const port = build.ports.find((p) => p.id === end.id);
    return port ? [port.x, port.y] : null;
  };

  const freeSpot = (): Pt => {
    const taken = [...build.parts, ...build.ports].map((p) => [p.x, p.y]);
    for (let row = 0; row < Math.floor((H - 6) / 17); row++)
      for (let col = 0; col < Math.floor((W - 4) / 18); col++) {
        const x = snap(12 + col * 18);
        const y = snap(13 + row * 17);
        if (!taken.some(([tx, ty]) => Math.abs(tx - x) < 9 && Math.abs(ty - y) < 9)) return [x, y];
      }
    return [snap(W / 2), snap(H / 2)];
  };

  const nextRef = (prefix: string) => {
    const used = build.parts.map((p) => new RegExp(`^${prefix}(\\d+)$`).exec(p.ref)).filter(Boolean).map((m) => Number(m![1]));
    return `${prefix}${Math.max(0, ...used) + 1}`;
  };
  const placePart = (item: TrayItem) => {
    const [x, y] = freeSpot();
    const id = newId("p");
    const ref = item.ref ?? nextRef(item.prefix ?? "X");
    onChange({ ...build, parts: [...build.parts, { id, ref, kind: item.kind, value: item.value, lib_id: item.lib_id, x, y, rot: 0 }] });
    setSelected({ kind: "part", id });
  };
  const placePort = (net: string) => {
    const [x, y] = freeSpot();
    const id = newId("g");
    onChange({ ...build, ports: [...build.ports, { id, net, lib_id: portLibs.get(net)!, x, y }] });
    setSelected({ kind: "port", id });
  };

  const remove = () => {
    if (!selected) return;
    const gone = (e: End) => e.id === selected.id;
    if (selected.kind === "wire") onChange({ ...build, wires: build.wires.filter((w) => w.id !== selected.id) });
    else onChange({ parts: build.parts.filter((p) => p.id !== selected.id), ports: build.ports.filter((p) => p.id !== selected.id), wires: build.wires.filter((w) => !gone(w.a) && !gone(w.b)) });
    setSelected(null);
  };
  const rotate = () => {
    if (selected?.kind !== "part") return;
    onChange({ ...build, parts: build.parts.map((p) => (p.id === selected.id ? { ...p, rot: (p.rot + 90) % 360 } : p)) });
  };

  const clickPin = (end: End) => {
    if (!pending) {
      setPending(end);
      return;
    }
    if (pending.id === end.id && pending.pin === end.pin) {
      setPending(null);
      return;
    }
    const same = (a: End, b: End) => a.id === b.id && a.pin === b.pin;
    const exists = build.wires.some((w) => (same(w.a, pending) && same(w.b, end)) || (same(w.a, end) && same(w.b, pending)));
    if (!exists) onChange({ ...build, wires: [...build.wires, { id: newId("w"), a: pending, b: end }] });
    setPending(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape") setPending(null);
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        remove();
      }
      if ((e.key === "r" || e.key === "R") && selected?.kind === "part") rotate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const wirePath = (a: Pt, b: Pt, i: number) => {
    if (look === "schematic") return `M${a[0]} ${a[1]}H${b[0]}V${b[1]}`;
    const lift = Math.min(14, 4 + Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.18) * (i % 2 ? 1 : -1);
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2 + lift;
    return `M${a[0]} ${a[1]}Q${mx} ${my} ${b[0]} ${b[1]}`;
  };

  const usedRefs = new Set(build.parts.map((p) => p.ref));
  const portNets = [...portLibs.keys()];

  return (
    <div className={`builder ${look}`}>
      <div className="tray" aria-label="Parts to place">
        <span className="tray-title">{trayTitle ?? (look === "physical" ? "Parts box" : "Symbols")}</span>
        {tray.map((item, i) => {
          const used = !!item.ref && usedRefs.has(item.ref);
          return (
            <span key={item.key} className="contents">
              {item.group && item.group !== tray[i - 1]?.group && <span className="tray-group">{item.group}</span>}
              <button className={`tray-item${used ? " used" : ""}${item.key_part ? " key" : ""}`} disabled={used} onClick={() => placePart(item)} title={item.hint ?? item.label}>
                {item.ref && <b>{item.ref}</b>} {item.label} <span className="dim">{item.value.replace(/_/g, " ")}</span>
              </button>
            </span>
          );
        })}
        {look === "schematic" &&
          portNets.map((net) => (
            <button key={net} className="tray-item port" onClick={() => placePort(net)} title="Power symbol: every one with the same name is connected">
              <b>{net}</b> power symbol
            </button>
          ))}
      </div>

      <div className="canvas-wrap">
        <svg
          ref={svg}
          className="build-canvas"
          viewBox={`0 0 ${W} ${H}`}
          style={{ aspectRatio: `${W} / ${H}` }}
          onPointerMove={(e) => {
            const p = toWorld(e);
            setMouse(p);
            const d = drag.current;
            if (!d) return;
            d.moved = true;
            const x = snap(p[0] - d.dx);
            const y = snap(p[1] - d.dy);
            if (d.kind === "part") onChange({ ...build, parts: build.parts.map((q) => (q.id === d.id ? { ...q, x, y } : q)) });
            else onChange({ ...build, ports: build.ports.map((q) => (q.id === d.id ? { ...q, x, y } : q)) });
          }}
          onPointerUp={() => {
            const d = drag.current;
            if (d && !d.moved) setSelected({ kind: d.kind, id: d.id });
            drag.current = null;
          }}
          onPointerDown={(e) => {
            if (e.target === svg.current || (e.target as Element).classList.contains("board")) {
              setSelected(null);
              setPending(null);
            }
          }}
        >
          <defs>
            <pattern id="holes" width={2.54} height={2.54} patternUnits="userSpaceOnUse">
              <circle cx={1.27} cy={1.27} r={0.32} className="hole" />
            </pattern>
          </defs>
          <rect className="board" x={0} y={0} width={W} height={H} />
          <rect className="board holes" x={0} y={0} width={W} height={H} fill="url(#holes)" />

          {build.wires.map((w, i) => {
            const a = endPoint(w.a);
            const b = endPoint(w.b);
            if (!a || !b) return null;
            const sel = selected?.kind === "wire" && selected.id === w.id;
            return (
              <g key={w.id} className={`bwire${sel ? " sel" : ""}`} onPointerDown={(e) => (e.stopPropagation(), setSelected({ kind: "wire", id: w.id }))}>
                <path d={wirePath(a, b, i)} className="bwire-hit" />
                <path d={wirePath(a, b, i)} className="bwire-line" style={look === "physical" ? { stroke: WIRE_COLORS[i % WIRE_COLORS.length] } : undefined} />
              </g>
            );
          })}

          {build.ports.map((port) => {
            const sel = selected?.kind === "port" && selected.id === port.id;
            return (
              <g key={port.id} className={`bpart${sel ? " sel" : ""}`}>
                <g
                  transform={`translate(${port.x} ${port.y}) scale(1 -1)`}
                  className="bsym"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const p = toWorld(e);
                    drag.current = { id: port.id, kind: "port", dx: p[0] - port.x, dy: p[1] - port.y, moved: false };
                  }}
                >
                  {symbolBody(symbols, port.lib_id)}
                  <rect x={-2} y={-4} width={4} height={8} fill="transparent" stroke="none" />
                </g>
                <text x={port.x} y={/GND/.test(port.net) ? port.y + 5.5 : port.y - 4} textAnchor="middle" className="bref">
                  {port.net}
                </text>
                <circle className={`bpin${pending?.id === port.id ? " pending" : ""}`} cx={port.x} cy={port.y} r={1} onPointerDown={(e) => (e.stopPropagation(), clickPin({ id: port.id, pin: "1" }))} />
              </g>
            );
          })}

          {build.parts.map((part) => {
            const sel = selected?.kind === "part" && selected.id === part.id;
            const pins = pinsOf(part);
            const start = (e: React.PointerEvent) => {
              e.stopPropagation();
              const p = toWorld(e);
              drag.current = { id: part.id, kind: "part", dx: p[0] - part.x, dy: p[1] - part.y, moved: false };
            };
            const fp = look === "physical" ? footprint(part.kind, part.value, pinNamesOf(symbols, part.lib_id)) : null;
            const xs = pins.map((p) => p.at[0]);
            const ys = pins.map((p) => p.at[1]);
            return (
              <g key={part.id} className={`bpart${sel ? " sel" : ""}`}>
                {fp ? (
                  <g transform={`translate(${part.x} ${part.y}) rotate(${part.rot})`} onPointerDown={start} className="bphys">
                    <rect x={fp.box[0]} y={fp.box[1]} width={fp.box[2] - fp.box[0]} height={fp.box[3] - fp.box[1]} className="bhit" />
                    {fp.draw}
                  </g>
                ) : (
                  <g transform={`translate(${part.x} ${part.y}) scale(1 -1) rotate(${part.rot})`} onPointerDown={start} className="bsym">
                    {symbolBody(symbols, part.lib_id)}
                  </g>
                )}
                {!fp && (
                  <g className="bpins">
                    <Pins lib={symbols[part.lib_id]} comp={{ x: part.x, y: part.y, rot: part.rot, mirror: false }} />
                  </g>
                )}
                <text x={Math.min(...xs, part.x) - 1} y={Math.min(...ys, part.y) - 3} className="bref">
                  {part.ref} <tspan className="bval">{part.value.replace(/_/g, " ")}</tspan>
                </text>
                {pins.map((p) => (
                  <circle
                    key={p.number}
                    className={`bpin${pending?.id === part.id && pending.pin === p.number ? " pending" : ""}`}
                    data-pin={`${part.ref}.${p.number}`}
                    cx={p.at[0]}
                    cy={p.at[1]}
                    r={1}
                    onPointerEnter={() => setHoverPin({ label: `${part.ref} · ${p.label}`, at: p.at })}
                    onPointerLeave={() => setHoverPin(null)}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      clickPin({ id: part.id, pin: p.number });
                    }}
                  />
                ))}
              </g>
            );
          })}

          {pending && mouse && (() => {
            const a = endPoint(pending);
            return a ? <line className="rubber" x1={a[0]} y1={a[1]} x2={mouse[0]} y2={mouse[1]} /> : null;
          })()}
          {hoverPin && (
            <g className="pin-tip" transform={`translate(${hoverPin.at[0]} ${hoverPin.at[1] - 2.5})`}>
              <rect x={-hoverPin.label.length * 0.48 - 1} y={-2.6} width={hoverPin.label.length * 0.96 + 2} height={3.2} rx={0.8} />
              <text y={-0.4} textAnchor="middle">
                {hoverPin.label}
              </text>
            </g>
          )}
        </svg>
        <div className="build-tools">
          {selected && selected.kind === "part" && (
            <button className="btn small-btn" onClick={rotate}>
              <RotateCw size={13} /> rotate <kbd>R</kbd>
            </button>
          )}
          {selected && (
            <button className="btn small-btn" onClick={remove}>
              <Trash2 size={13} /> remove <kbd>Del</kbd>
            </button>
          )}
          <span className="dim small">{pending ? "Now click the pin to connect it to (Esc cancels)." : "Click a pin, then another pin, to run a wire. Drag parts to move them."}</span>
        </div>
      </div>
    </div>
  );
}
