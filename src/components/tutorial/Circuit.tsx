import { Fragment } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PartId, Target } from "../../data/tutorial";

/**
 * Interactive version of the example schematic (same geometry and connections as Schematic.tsx).
 * Parts can be hovered/selected, nets highlighted, current paths animated, and parts revealed
 * stage by stage for the build walkthrough.
 */

type NetId = "5V" | "BUTTON" | "LED_DRIVE" | "LED_ANODE" | "GND_NET";
export type FlowId = "input" | "output" | "discharge";

export interface Visibility {
  parts: boolean;
  values: boolean;
  wires: boolean;
  power: boolean;
}
export const ALL_VISIBLE: Visibility = { parts: true, values: true, wires: true, power: true };

const FRAMED = { x: -34, y: -30, w: 708, h: 390 };

/** Percent position of a schematic coordinate inside the framed SVG (for HTML overlays). */
export function anchorPct(x: number, y: number) {
  return { left: `${((x - FRAMED.x) / FRAMED.w) * 100}%`, top: `${((y - FRAMED.y) / FRAMED.h) * 100}%` };
}

const WIRES: { net: NetId; d: string }[] = [
  { net: "5V", d: "M170 80H252" },
  { net: "LED_DRIVE", d: "M170 140H222" },
  { net: "LED_ANODE", d: "M298 140H350" },
  { net: "BUTTON", d: "M300 80H500V220" },
  { net: "BUTTON", d: "M170 220H500" },
  { net: "BUTTON", d: "M500 220V232" },
  { net: "BUTTON", d: "M500 220H570V250" },
  { net: "GND_NET", d: "M378 140H430V170" },
  { net: "GND_NET", d: "M170 280H200V292" },
  { net: "GND_NET", d: "M500 292V304" },
  { net: "GND_NET", d: "M570 258V304" },
];

/** Conventional-current paths. */
const FLOW_PATHS: Record<FlowId, string> = {
  input: "M170 80H500V304", // 5V → SW1 → BUTTON → R2 → GND
  output: "M170 140H430V170", // D13 → R1 → D1 → GND
  discharge: "M570 250V220H500V304", // C1 → BUTTON → R2 → GND
};

const HIT: Record<Exclude<PartId, "GND">, [number, number, number, number]> = {
  A1: [24, 18, 120, 308],
  pin5V: [112, 68, 64, 24],
  pinD13: [112, 128, 64, 24],
  pinD2: [112, 208, 64, 24],
  SW1: [242, 28, 68, 62],
  R1: [214, 110, 92, 64],
  D1: [338, 98, 56, 88],
  R2: [482, 228, 64, 66],
  C1: [546, 236, 86, 38],
  FLAG: [214, 236, 66, 40],
};
const GND_AT: [number, number][] = [
  [200, 292],
  [430, 170],
  [500, 304],
  [570, 304],
];

interface Props {
  swClosed?: boolean;
  ledLevel?: number;
  flows?: FlowId[];
  highlight?: Target[];
  hovered?: PartId | null;
  selected?: PartId | null;
  onHover?: (p: PartId | null) => void;
  onSelect?: (p: PartId) => void;
  visible?: Visibility;
  showFlag?: boolean;
  voltages?: Partial<Record<NetId, string>>;
  scanning?: boolean;
  annotations?: { x: number; y: number; dx: number; dy: number; text: string }[];
  timing?: "intro" | "quick";
  values?: { r1: string; r2: string; c1: string };
}

export function Circuit({
  swClosed = false,
  ledLevel = 0,
  flows = [],
  highlight = [],
  hovered = null,
  selected = null,
  onHover,
  onSelect,
  visible = ALL_VISIBLE,
  showFlag = false,
  voltages = {},
  scanning = false,
  annotations = [],
  timing = "intro",
  values = { r1: "220", r2: "10k", c1: "100n" },
}: Props) {
  const T = timing === "intro" ? { parts: 0.1, step: 0.07, wires: 0.75, wireStep: 0.06, power: 1.35, labels: 1.5 } : { parts: 0, step: 0.04, wires: 0, wireStep: 0.05, power: 0, labels: 0.15 };
  const focus = highlight.length > 0 || hovered !== null;
  const interactive = !!onSelect;

  const partCls = (id: PartId) => {
    const on = highlight.includes(id) || hovered === id || selected === id;
    return ["part", on && "is-hl", hovered === id && "is-hover", selected === id && "is-selected", focus && !on && "is-dim"].filter(Boolean).join(" ");
  };
  const netCls = (n: NetId) => {
    const on = highlight.includes(n);
    return ["wire", `net-${n}`, on && "is-hl", focus && !on && "is-dim"].filter(Boolean).join(" ");
  };

  const part = (id: Exclude<PartId, "GND">, shown: boolean, i: number, children: React.ReactNode) => (
    <PartG id={id} shown={shown} delay={T.parts + i * T.step} cls={partCls(id)} selected={selected === id} interactive={interactive} onHover={onHover} onSelect={onSelect}>
      {children}
    </PartG>
  );

  const fade = (shown: boolean, delay: number) => ({
    initial: { opacity: 0 },
    animate: { opacity: shown ? 1 : 0 },
    transition: { duration: 0.35, delay: shown ? delay : 0 },
  });

  return (
    <svg viewBox={`${FRAMED.x} ${FRAMED.y} ${FRAMED.w} ${FRAMED.h}`} className="circuit" role="img" aria-label="Schematic: Arduino Uno with a push button on D2 and an LED on D13">
      <defs>
        <linearGradient id="scan-grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#238C83" stopOpacity="0" />
          <stop offset="0.8" stopColor="#238C83" stopOpacity="0.18" />
          <stop offset="1" stopColor="#238C83" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      {/* KiCad-style sheet frame with grid references */}
      <g className="frame">
        <rect x={-28} y={-24} width={696} height={378} />
        <rect x={-16} y={-12} width={672} height={354} />
        {[1, 2, 3, 4, 5, 6].map((n, i) => (
          <g key={n}>
            <text x={-16 + 56 + 112 * i} y={-15}>{n}</text>
            <text x={-16 + 56 + 112 * i} y={351}>{n}</text>
            {i > 0 && <path d={`M${-16 + 112 * i} -24V-12M${-16 + 112 * i} 342V354`} />}
          </g>
        ))}
        {["A", "B", "C"].map((l, i) => (
          <g key={l}>
            <text x={-22} y={-12 + 59 + 118 * i + 3}>{l}</text>
            <text x={662} y={-12 + 59 + 118 * i + 3}>{l}</text>
            {i > 0 && <path d={`M-28 ${-12 + 118 * i}H-16M656 ${-12 + 118 * i}H668`} />}
          </g>
        ))}
      </g>

      {/* wires */}
      {WIRES.map((w, i) => {
        const shown = w.net === "GND_NET" ? visible.power : visible.wires;
        return (
          <motion.path
            key={i}
            className={netCls(w.net)}
            d={w.d}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: shown ? 1 : 0, opacity: shown ? 1 : 0 }}
            transition={{ duration: 0.5, ease: "easeInOut", delay: shown ? (w.net === "GND_NET" ? T.power : T.wires) + i * T.wireStep : 0 }}
          />
        );
      })}
      <motion.circle cx={500} cy={220} r={4} className={`junction ${netCls("BUTTON")}`} {...fade(visible.wires, T.labels)} />

      {/* A1 */}
      {part("A1", visible.parts, 0, <>
        <rect x={30} y={40} width={120} height={260} className="sym body" />
        <text x={90} y={30} className="ref">A1</text>
        <text x={90} y={318} className="val">Arduino_UNO_R3</text>
        <text x={142} y={284} className="pin-name">GND</text>
        <path className="sym" d="M150 280H170" />
      </>)}
      {(
        [
          ["pin5V", "5V", 80],
          ["pinD13", "D13", 140],
          ["pinD2", "D2", 220],
        ] as const
      ).map(([id, label, y], i) => (
        <Fragment key={id}>{part(id, visible.parts, i + 1, <>
          <text x={142} y={y + 4} className={`pin-name ${id === "pinD2" ? "is-input" : id === "pinD13" ? "is-output" : ""}`}>
            {label}
          </text>
          <path className="sym" d={`M150 ${y}H170`} />
        </>)}</Fragment>
      ))}

      {/* SW1 */}
      {part("SW1", visible.parts, 4, <>
        <circle cx={256} cy={80} r={4} className="sym pin-dot" />
        <circle cx={296} cy={80} r={4} className="sym pin-dot" />
        <motion.g animate={{ y: swClosed ? 9 : 0 }} transition={{ type: "spring", stiffness: 700, damping: 30 }}>
          <path className="sym" d="M250 68H302M276 68V54M266 54H286" />
        </motion.g>
        <text x={276} y={40} className="ref">SW1</text>
      </>)}

      {/* R1 */}
      {part("R1", visible.parts, 5, <>
        <rect x={226} y={132} width={68} height={16} className="sym body" />
        <path className="sym" d="M222 140H226M294 140H298" />
        <text x={260} y={124} className="ref">R1</text>
        <text x={260} y={166} className={`val ${visible.values ? "is-set" : ""}`}>{visible.values ? values.r1 : "R"}</text>
      </>)}

      {/* D1 */}
      {part("D1", visible.parts, 6, <>
        <motion.circle cx={364} cy={140} r={30} className="led-glow" animate={{ opacity: ledLevel * 0.55, scale: 0.8 + ledLevel * 0.25 }} transition={{ duration: 0.18 }} style={{ transformBox: "view-box", transformOrigin: "364px 140px" }} />
        <polygon points="350,124 350,156 378,140" className="sym body led-body" style={{ fill: ledLevel > 0 ? `color-mix(in srgb, #ff3b30 ${Math.round(40 + ledLevel * 60)}%, #ffffc2)` : undefined }} />
        <path className="sym" d="M378 124V156M360 116l10-12m-5 0h5v5M370 120l10-12m-5 0h5v5" />
        <text x={364} y={176} className="ref">D1</text>
      </>)}

      {/* R2 */}
      {part("R2", visible.parts, 7, <>
        <rect x={492} y={236} width={16} height={52} className="sym body" />
        <path className="sym" d="M500 232V236M500 288V292" />
        <text x={518} y={258} className="ref start">R2</text>
        <text x={518} y={274} className={`val start ${visible.values ? "is-set" : ""}`}>{visible.values ? values.r2 : "R"}</text>
      </>)}

      {/* C1 */}
      {part("C1", visible.parts, 8, <>
        <path className="sym" d="M556 250H584M556 258H584" />
        <text x={592} y={250} className="ref start">C1</text>
        <text x={592} y={266} className={`val start ${visible.values ? "is-set" : ""}`}>{visible.values ? values.c1 : "C"}</text>
      </>)}

      {/* GND symbols (one part, four instances) */}
      <motion.g {...fade(visible.power, T.power + 0.2)} style={{ pointerEvents: visible.power ? "auto" : "none" }}>
        <g className={partCls("GND")}>
          {GND_AT.map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <path className="sym" d={`M${x - 12} ${y}H${x + 12}M${x - 7} ${y + 5}H${x + 7}M${x - 3} ${y + 10}H${x + 3}`} />
              {selected === "GND" && <rect className="sel-box" x={x - 16} y={y - 6} width={32} height={22} rx={3} />}
              {interactive && <rect className="hit" x={x - 16} y={y - 6} width={32} height={22} onMouseEnter={() => onHover?.("GND")} onMouseLeave={() => onHover?.(null)} onClick={() => onSelect?.("GND")} />}
            </g>
          ))}
        </g>
      </motion.g>

      {/* PWR_FLAG on the GND net */}
      {showFlag && (
        <>
          <motion.path className={netCls("GND_NET")} d="M200 280H236" initial={{ pathLength: 0 }} animate={{ pathLength: visible.power ? 1 : 0 }} transition={{ duration: 0.4, delay: visible.power ? T.power + 0.3 : 0 }} />
          <motion.circle cx={200} cy={280} r={4} className={`junction ${netCls("GND_NET")}`} {...fade(visible.power, T.power + 0.5)} />
          {part("FLAG", visible.power, 0, <>
            <path className="sym" d="M236 280V268" />
            <polygon className="sym body" points="236,268 243,261 236,254 229,261" />
            <text x={236} y={246} className="val flag-label">PWR_FLAG</text>
          </>)}
        </>
      )}

      {/* net labels */}
      <motion.text x={204} y={72} className="net-label" {...fade(visible.power, T.labels)}>
        +5V
      </motion.text>
      <motion.text x={330} y={212} className="net-label is-input" {...fade(visible.wires, T.labels)}>
        BUTTON
      </motion.text>

      {/* current flow */}
      <AnimatePresence>
        {flows.map((f) => (
          <motion.g key={f} className={`flow flow-${f}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <path className="flow-glow" d={FLOW_PATHS[f]} />
            <path className="flow-dots" d={FLOW_PATHS[f]} />
          </motion.g>
        ))}
      </AnimatePresence>

      {/* node voltage tags */}
      <AnimatePresence>
        {(Object.entries(voltages) as [NetId, string][]).map(([net, text]) => {
          const at = { "5V": [211, 98], BUTTON: [430, 238], LED_DRIVE: [196, 158], LED_ANODE: [324, 158], GND_NET: [430, 196] }[net];
          return (
            <motion.g key={net} className={`vtag net-${net}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <rect x={at[0] - 27} y={at[1] - 10} width={54} height={17} rx={4} />
              <text x={at[0]} y={at[1] + 3}>{text}</text>
            </motion.g>
          );
        })}
      </AnimatePresence>

      {/* callouts */}
      <AnimatePresence>
        {annotations.map((a) => (
          <motion.g key={a.text} className="callout" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <circle cx={a.x} cy={a.y} r={3} />
            <path d={`M${a.x} ${a.y}L${a.x + a.dx} ${a.y + a.dy}`} />
            <rect x={a.x + a.dx - 4} y={a.y + a.dy - 11} width={a.text.length * 7 + 10} height={18} rx={4} />
            <text x={a.x + a.dx + 1} y={a.y + a.dy + 2}>{a.text}</text>
          </motion.g>
        ))}
      </AnimatePresence>

      {/* ERC scan */}
      {scanning && (
        <motion.rect y={-12} width={60} height={354} fill="url(#scan-grad)" initial={{ x: -76 }} animate={{ x: [-76, 656] }} transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }} style={{ pointerEvents: "none" }} />
      )}
    </svg>
  );
}

interface PartGProps {
  id: Exclude<PartId, "GND">;
  shown: boolean;
  delay: number;
  cls: string;
  selected: boolean;
  interactive: boolean;
  onHover?: (p: PartId | null) => void;
  onSelect?: (p: PartId) => void;
  children: React.ReactNode;
}

function PartG({ id, shown, delay, cls, selected, interactive, onHover, onSelect, children }: PartGProps) {
  const [x, y, w, h] = HIT[id];
  return (
    <motion.g initial={{ opacity: 0, y: 6 }} animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : 6 }} transition={{ duration: 0.35, delay: shown ? delay : 0 }} style={{ pointerEvents: shown ? "auto" : "none" }}>
      <g className={cls}>
        {children}
        {selected && <rect className="sel-box" x={x} y={y} width={w} height={h} rx={3} />}
        {interactive && <rect className="hit" x={x} y={y} width={w} height={h} onMouseEnter={() => onHover?.(id)} onMouseLeave={() => onHover?.(null)} onClick={() => onSelect?.(id)} />}
      </g>
    </motion.g>
  );
}
