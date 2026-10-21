import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { flowSpeed } from "../../lab/flow";
import { HOTSPOTS } from "../../lab/knowledge";
import { cleanPinName, isGroundNet, pinInner, place, type Graphic, type Placement, type LibSymbol, type Pt, type SceneComponent, type SceneText } from "../../lab/scene";
import { LED_RGB, ledColor } from "../../lab/values";
import { CURRENT, ELECTRON, selectedRef, voltColor, type ViewProps } from "./types";

const STROKE = 0.2;
const DOT = 2.54; // spacing of the moving dots (mm)

/** SVG path for a KiCad arc given start, mid and end points. */
function arcPath([s, m, e]: Pt[]): string {
  const [ax, ay] = s;
  const [bx, by] = m;
  const [cx, cy] = e;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return `M${ax} ${ay}L${cx} ${cy}`;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const ang = (x: number, y: number) => Math.atan2(y - uy, x - ux);
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a0 = ang(ax, ay);
  const ccwToMid = norm(ang(bx, by) - a0);
  const ccwToEnd = norm(ang(cx, cy) - a0);
  const ccw = ccwToMid < ccwToEnd; // going counter-clockwise from start reaches mid before end
  const sweepAngle = ccw ? ccwToEnd : 2 * Math.PI - ccwToEnd;
  return `M${ax} ${ay}A${r} ${r} 0 ${sweepAngle > Math.PI ? 1 : 0} ${ccw ? 1 : 0} ${cx} ${cy}`;
}

export function GraphicEl({ g, body }: { g: Graphic; body: string }) {
  const fill = g.fill === "background" ? body : g.fill === "outline" ? "currentColor" : "none";
  const sw = Math.max(STROKE, g.width);
  if (g.type === "polyline") return <polyline points={g.pts.map((p) => p.join(",")).join(" ")} fill={fill} strokeWidth={sw} />;
  if (g.type === "rect") {
    const [[x0, y0], [x1, y1]] = g.pts;
    return <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} fill={fill} strokeWidth={sw} />;
  }
  if (g.type === "circle") return <circle cx={g.pts[0][0]} cy={g.pts[0][1]} r={g.r} fill={fill} strokeWidth={sw} />;
  return <path d={arcPath(g.pts)} fill={fill} strokeWidth={sw} />;
}

const symbolTransform = (x: number, y: number, rot: number, mirror: boolean) => `translate(${x} ${y}) scale(1 -1) rotate(${rot}) scale(${mirror ? -1 : 1} 1)`;

function Txt({ t, size = 1.27, className, onClick }: { t: SceneText; size?: number; className?: string; onClick?: (e: React.MouseEvent) => void }) {
  const words = t.justify.split(" ");
  const anchor = words.includes("left") ? "start" : words.includes("right") ? "end" : "middle";
  const baseline = words.includes("top") ? "hanging" : words.includes("bottom") ? "auto" : "central";
  return (
    <text x={t.x} y={t.y} fontSize={size} textAnchor={anchor} dominantBaseline={baseline} transform={t.angle ? `rotate(${-t.angle} ${t.x} ${t.y})` : undefined} className={className} onClick={onClick}>
      {t.text}
    </text>
  );
}

/** Pin lines, numbers and names of a placed symbol (screen coordinates). */
export function Pins({ lib, comp }: { lib: LibSymbol; comp: Placement }) {
  return (
    <>
      {lib.pins
        .filter((p) => !p.hidden)
        .map((pin) => {
          const at = place(comp, pin.x, pin.y);
          const inner = pinInner(comp, pin);
          const ox = inner[0] - at[0];
          const oy = inner[1] - at[1];
          const len = Math.hypot(ox, oy) || 1;
          const ux = ox / len;
          const uy = oy / len;
          const vertical = Math.abs(uy) > 0.5;
          const name = cleanPinName(pin.name);
          const showName = lib.show_pin_names && name && name !== "~" && lib.pin_name_offset > 0;
          const nameAt: Pt = [inner[0] + ux * (lib.pin_name_offset + 0.3), inner[1] + uy * (lib.pin_name_offset + 0.3)];
          const mid: Pt = [(at[0] + inner[0]) / 2, (at[1] + inner[1]) / 2];
          const anchor = vertical ? (uy > 0 ? "start" : "end") : ux > 0 ? "start" : "end";
          return (
            <g key={pin.number}>
              {pin.length > 0 && <line x1={at[0]} y1={at[1]} x2={inner[0]} y2={inner[1]} strokeWidth={STROKE} />}
              {showName && (
                <text x={nameAt[0]} y={nameAt[1]} fontSize={1.1} textAnchor={anchor} dominantBaseline="central" className="l2d-pinname" transform={vertical ? `rotate(-90 ${nameAt[0]} ${nameAt[1]})` : undefined}>
                  {name}
                </text>
              )}
              {lib.show_pin_numbers && pin.length > 0 && (
                <text x={mid[0] + (vertical ? -0.35 : 0)} y={mid[1] + (vertical ? 0 : -0.35)} fontSize={0.9} textAnchor={vertical ? "end" : "middle"} className="l2d-pinnum" transform={vertical ? `rotate(-90 ${mid[0] - 0.35} ${mid[1]})` : undefined}>
                  {pin.number}
                </text>
              )}
            </g>
          );
        })}
    </>
  );
}

const Part = memo(function Part({
  comp,
  lib,
  selected,
  dim,
  led,
  pressed,
  onSelect,
  onPress,
}: {
  comp: SceneComponent;
  lib: LibSymbol;
  selected: boolean;
  dim: boolean;
  led: { color: string; level: number } | null;
  pressed: boolean;
  onSelect: ViewProps["onSelect"];
  onPress: ViewProps["onPress"];
}) {
  const isButton = comp.kind === "push_button";
  const hotspots = HOTSPOTS[comp.lib_id] ?? [];
  return (
    <g
      className={`l2d-part${selected ? " sel" : ""}${dim ? " faded" : ""}${pressed ? " pressed" : ""}`}
      tabIndex={0}
      role="button"
      aria-label={`${comp.ref} ${comp.value}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ kind: "part", ref: comp.ref });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect({ kind: "part", ref: comp.ref });
      }}
      onPointerDown={isButton ? () => onPress(comp.ref, true) : undefined}
      onPointerUp={isButton ? () => onPress(comp.ref, false) : undefined}
      onPointerLeave={isButton ? () => pressed && onPress(comp.ref, false) : undefined}
    >
      {led && led.level > 0.01 && (
        <circle cx={0} cy={0} r={6} fill={`url(#glow-${led.color.slice(1)})`} opacity={Math.min(1, led.level)} transform={`translate(${comp.x} ${comp.y})`} className="l2d-glow" />
      )}
      <g transform={symbolTransform(comp.x, comp.y, comp.rot, comp.mirror)} className="l2d-sym">
        {lib.graphics.map((g, i) => (
          <GraphicEl key={i} g={g} body="var(--kc-body)" />
        ))}
        {/* hit area for the whole body */}
        {lib.graphics.length > 0 && <SymbolHit lib={lib} />}
        {hotspots.map((h, i) => (
          <rect
            key={i}
            className="l2d-hot"
            x={h.box[0]}
            y={h.box[1]}
            width={h.box[2] - h.box[0]}
            height={h.box[3] - h.box[1]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect({ kind: "detail", ref: comp.ref, ...h.detail });
            }}
          >
            <title>{h.detail.title}</title>
          </rect>
        ))}
      </g>
      <Pins lib={lib} comp={comp} />
      {comp.ref_text && (
        <Txt
          t={comp.ref_text}
          className="l2d-ref"
          onClick={(e) => {
            e.stopPropagation();
            onSelect({ kind: "tiny", what: "ref", ref: comp.ref });
          }}
        />
      )}
      {comp.value_text && (
        <Txt
          t={comp.value_text}
          className="l2d-val"
          onClick={(e) => {
            e.stopPropagation();
            onSelect({ kind: "tiny", what: "value", ref: comp.ref });
          }}
        />
      )}
    </g>
  );
});

function SymbolHit({ lib }: { lib: LibSymbol }) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const g of lib.graphics) {
    if (g.type === "circle") {
      xs.push(g.pts[0][0] - g.r, g.pts[0][0] + g.r);
      ys.push(g.pts[0][1] - g.r, g.pts[0][1] + g.r);
    } else for (const [x, y] of g.pts) {
      xs.push(x);
      ys.push(y);
    }
  }
  const pad = 0.6;
  return <rect className="l2d-hit" x={Math.min(...xs) - pad} y={Math.min(...ys) - pad} width={Math.max(...xs) - Math.min(...xs) + 2 * pad} height={Math.max(...ys) - Math.min(...ys) + 2 * pad} />;
}

export function Schematic2D(props: ViewProps) {
  const { scene, layout, result, flow, selection, onSelect, electrons, showFlow, showVolts, focus, tourDot, pressed, onPress } = props;
  const [x0, y0, x1, y1] = scene.bbox;
  const [view, setView] = useState({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ px: number; py: number; vx: number; vy: number; moved: boolean } | null>(null);
  const dragged = useRef(false);

  useEffect(() => setView({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }), [x0, y0, x1, y1]);

  const toWorld = (clientX: number, clientY: number): Pt => {
    const r = svg.current!.getBoundingClientRect();
    // preserveAspectRatio="xMidYMid meet": find the drawn scale and offsets.
    const s = Math.min(r.width / view.w, r.height / view.h);
    const ox = (r.width - view.w * s) / 2;
    const oy = (r.height - view.h * s) / 2;
    return [view.x + (clientX - r.left - ox) / s, view.y + (clientY - r.top - oy) / s];
  };

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      const f = Math.exp(e.deltaY * 0.0015);
      setView((v) => {
        const w = Math.max(10, Math.min((x1 - x0) * 4, v.w * f));
        const h = (v.h / v.w) * w;
        return { x: wx - ((wx - v.x) / v.w) * w, y: wy - ((wy - v.y) / v.h) * h, w, h };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const zoom = (f: number) => setView((v) => ({ x: v.x + (v.w * (1 - f)) / 2, y: v.y + (v.h * (1 - f)) / 2, w: v.w * f, h: v.h * f }));

  const vmax = useMemo(() => Math.max(0.1, ...Object.values(result?.netV ?? {})), [result]);
  const leds = useMemo(() => {
    const m: Record<string, { color: string; level: number }> = {};
    for (const c of scene.components) if (c.kind === "led") m[c.ref] = { color: LED_RGB[ledColor(c.value)], level: result?.parts[c.ref]?.level ?? 0 };
    return m;
  }, [scene, result]);
  const glowColors = [...new Set(Object.values(leds).map((l) => l.color))];
  const selRef = selectedRef(selection);
  const selNet = selection?.kind === "net" ? selection.net : selection?.kind === "tiny" ? selection.net : null;
  const wireColor = (net: string) => (showVolts && result ? voltColor(result.netV[net] ?? 0, vmax) : undefined);
  const dimNet = (net: string) => !!focus && !focus.nets.has(net);
  const flowColor = electrons ? ELECTRON : CURRENT;

  const segmentCurrent = (net: string, a: Pt, b: Pt) => {
    const on = (p: Pt) => Math.min(a[0], b[0]) - 0.01 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 0.01 && Math.min(a[1], b[1]) - 0.01 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 0.01;
    return (flow?.segments ?? []).filter((s) => s.net === net && on(s.a) && on(s.b)).reduce((m, s) => (Math.abs(s.i) > Math.abs(m) ? s.i : m), 0);
  };

  return (
    <div className="l2d-wrap">
      <svg
        ref={svg}
        className={`l2d${showVolts ? " volts" : ""}`}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="img"
        aria-label="Interactive schematic"
        onPointerDown={(e) => {
          drag.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y, moved: false };
          dragged.current = false;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !(e.buttons & 1)) return;
          const dx = e.clientX - d.px;
          const dy = e.clientY - d.py;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          d.moved = true;
          dragged.current = true;
          const r = svg.current!.getBoundingClientRect();
          const s = Math.min(r.width / view.w, r.height / view.h);
          setView((v) => ({ ...v, x: d.vx - dx / s, y: d.vy - dy / s }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onClickCapture={(e) => {
          if (dragged.current) {
            e.stopPropagation();
            dragged.current = false;
          }
        }}
        onClick={() => onSelect(null)}
      >
        <defs>
          {glowColors.map((c) => (
            <radialGradient key={c} id={`glow-${c.slice(1)}`}>
              <stop offset="0" stopColor={c} stopOpacity="0.95" />
              <stop offset="0.35" stopColor={c} stopOpacity="0.45" />
              <stop offset="1" stopColor={c} stopOpacity="0" />
            </radialGradient>
          ))}
          <radialGradient id="tour-glow">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.3" stopColor={flowColor} />
            <stop offset="1" stopColor={flowColor} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect className="l2d-bg" x={x0 - 500} y={y0 - 500} width={x1 - x0 + 1000} height={y1 - y0 + 1000} />

        {/* wires */}
        {scene.wires.map((w, i) => (
          <g key={i} className={`l2d-wire${selNet === w.net ? " sel" : ""}${dimNet(w.net) ? " faded" : ""}`}>
            <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} style={wireColor(w.net) ? { stroke: wireColor(w.net) } : undefined} />
            <line
              className="l2d-wire-hit"
              x1={w.a[0]}
              y1={w.a[1]}
              x2={w.b[0]}
              y2={w.b[1]}
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ kind: "net", net: w.net, current: segmentCurrent(w.net, w.a, w.b) });
              }}
            >
              <title>{w.net}</title>
            </line>
          </g>
        ))}

        {/* moving charge along wires and through parts */}
        {showFlow && flow && (
          <g className="l2d-flow" style={{ color: flowColor }}>
            {[...flow.segments, ...flow.through.map((t) => ({ ...t, net: "", inside: true }))].map((s, i) => {
              const speed = flowSpeed(s.i);
              if (!speed) return null;
              const forward = s.i > 0 !== electrons; // conventional goes a→b when i > 0
              const [p, q] = forward ? [s.a, s.b] : [s.b, s.a];
              const inside = "inside" in s;
              if (!inside && dimNet(s.net)) return null;
              return (
                <line
                  key={i}
                  x1={p[0]}
                  y1={p[1]}
                  x2={q[0]}
                  y2={q[1]}
                  className={inside ? "inside" : undefined}
                  style={{ animationDuration: `${(DOT / speed).toFixed(3)}s` }}
                />
              );
            })}
          </g>
        )}

        {scene.junctions.map((j, i) => (
          <g key={i} className={dimNet(j.net) ? "faded" : undefined}>
            <circle className="l2d-junction" cx={j.x} cy={j.y} r={0.5} style={wireColor(j.net) ? { fill: wireColor(j.net) } : undefined} />
            <circle
              className="l2d-small-hit"
              cx={j.x}
              cy={j.y}
              r={1.1}
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ kind: "tiny", what: "junction", net: j.net });
              }}
            >
              <title>junction</title>
            </circle>
          </g>
        ))}

        {scene.no_connects.map(([x, y], i) => (
          <g
            key={i}
            className="l2d-nc"
            onClick={(e) => {
              e.stopPropagation();
              onSelect({ kind: "tiny", what: "noConnect" });
            }}
          >
            <path d={`M${x - 0.6} ${y - 0.6}L${x + 0.6} ${y + 0.6}M${x - 0.6} ${y + 0.6}L${x + 0.6} ${y - 0.6}`} />
            <circle className="l2d-small-hit" cx={x} cy={y} r={1} />
          </g>
        ))}

        {scene.labels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={l.y - 0.35}
            fontSize={1.27}
            className={`l2d-label${dimNet(l.net) ? " faded" : ""}${selNet === l.net ? " sel" : ""}`}
            textAnchor={l.angle === 180 ? "end" : "start"}
            transform={l.angle === 90 || l.angle === 270 ? `rotate(-90 ${l.x} ${l.y})` : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onSelect({ kind: "tiny", what: "label", net: l.net });
            }}
          >
            {l.net}
          </text>
        ))}

        {scene.ports.map((p, i) => {
          const lib = scene.library[p.lib_id];
          return (
            <g
              key={i}
              className={`l2d-port${dimNet(p.net) ? " faded" : ""}${selNet === p.net ? " sel" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ kind: "tiny", what: isGroundNet(p.net) ? "ground" : "supply", net: p.net });
              }}
            >
              <g transform={symbolTransform(p.x, p.y, p.rot, false)}>
                {lib.graphics.map((g, k) => (
                  <GraphicEl key={k} g={g} body="var(--kc-body)" />
                ))}
                <SymbolHit lib={lib} />
              </g>
              {p.text && <Txt t={p.text} className="l2d-port-text" />}
            </g>
          );
        })}

        {scene.components.map((c) => (
          <Part
            key={c.ref}
            comp={c}
            lib={scene.library[c.lib_id]}
            selected={selRef === c.ref}
            dim={!!focus && !focus.refs.has(c.ref)}
            led={leds[c.ref] ?? null}
            pressed={!!pressed[c.ref]}
            onSelect={onSelect}
            onPress={onPress}
          />
        ))}

        {/* pins on top so even a tiny pin can be clicked */}
        {layout.parts.flatMap((part) =>
          part.pins.map((pin) => {
            const sel = selection?.kind === "pin" && selection.ref === part.ref && selection.pin === pin.number;
            return (
              <circle
                key={`${part.ref}.${pin.number}`}
                className={`l2d-pin${sel ? " sel" : ""}`}
                cx={pin.at[0]}
                cy={pin.at[1]}
                r={0.75}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "pin", ref: part.ref, pin: pin.number });
                }}
              >
                <title>{`${part.ref} pin ${pin.number}${pin.name && pin.name !== pin.number ? ` (${cleanPinName(pin.name)})` : ""}`}</title>
              </circle>
            );
          }),
        )}

        {tourDot && (
          <g className="l2d-tour-dot" transform={`translate(${tourDot[0]} ${tourDot[1]})`}>
            <circle r={3.2} fill="url(#tour-glow)" opacity={0.85} />
            <circle r={0.9} fill={flowColor} stroke="#fff" strokeWidth={0.25} />
            <text y={0.32} fontSize={1} textAnchor="middle" fill="#fff">
              {electrons ? "−" : "+"}
            </text>
          </g>
        )}
      </svg>
      <div className="view-tools">
        <button className="icon-btn" onClick={() => zoom(0.8)} aria-label="Zoom in" title="Zoom in">
          <Plus size={14} />
        </button>
        <button className="icon-btn" onClick={() => zoom(1.25)} aria-label="Zoom out" title="Zoom out">
          <Minus size={14} />
        </button>
        <button className="icon-btn" onClick={() => setView({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })} aria-label="Fit" title="Fit to view">
          <Maximize size={14} />
        </button>
      </div>
    </div>
  );
}
