export type SchematicGroup = "mcu" | "led" | "button" | "pulldown" | "debounce";

interface Props {
  pressed?: boolean;
  highlight?: SchematicGroup[];
  className?: string;
}

/** KiCad-style ground power symbol. */
function Gnd({ x, y }: { x: number; y: number }) {
  return <path className="sym" d={`M${x - 12} ${y}H${x + 12}M${x - 7} ${y + 5}H${x + 7}M${x - 3} ${y + 10}H${x + 3}`} />;
}

/**
 * Schematic of the example project, drawn with KiCad's color roles
 * (wires, symbol outline/fill, reference/value text), in KiCad's default palette (--kc-*).
 */
export function Schematic({ pressed = false, highlight = [], className = "" }: Props) {
  const cls = (g: SchematicGroup) => `grp${highlight.length && !highlight.includes(g) ? " dim" : ""}${highlight.includes(g) ? " hl" : ""}`;

  return (
    <svg viewBox="0 0 640 330" className={`sch ${className}`} role="img" aria-label="Schematic: Arduino Uno with a push button on D2 and an LED on D13">
      {/* A1 */}
      <g className={cls("mcu")}>
        <rect x={30} y={40} width={120} height={260} className="sym body" />
        <text x={90} y={30} className="ref">A1</text>
        <text x={90} y={318} className="val">Arduino_UNO_R3</text>
        {[
          ["5V", 80],
          ["D13", 140],
          ["D2", 220],
          ["GND", 280],
        ].map(([label, y]) => (
          <g key={label}>
            <text x={142} y={Number(y) + 4} className="pin-name">{label}</text>
            <path className="sym" d={`M150 ${y}H170`} />
          </g>
        ))}
        <path className="wire" d="M170 280H200V292" />
        <Gnd x={200} y={292} />
      </g>

      {/* R1 + D1 */}
      <g className={cls("led")}>
        <path className="wire" d="M170 140H222M298 140H350M378 140H430V170" />
        <rect x={226} y={132} width={68} height={16} className="sym body" />
        <path className="sym" d="M222 140H226M294 140H298" />
        <text x={260} y={124} className="ref">R1</text>
        <text x={260} y={166} className="val">220</text>
        {pressed && <circle cx={364} cy={140} r={28} className="led-glow" />}
        <polygon points="350,124 350,156 378,140" className={`sym body${pressed ? " lit" : ""}`} />
        <path className="sym" d="M378 124V156M360 116l10-12m-5 0h5v5M370 120l10-12m-5 0h5v5" />
        <text x={364} y={176} className="ref">D1</text>
        <Gnd x={430} y={170} />
      </g>

      {/* SW1 */}
      <g className={cls("button")}>
        <path className="wire" d="M170 80H252M300 80H500V220M170 220H500" />
        <circle cx={256} cy={80} r={4} className="sym pin-dot" />
        <circle cx={296} cy={80} r={4} className="sym pin-dot" />
        <g className="plunger" style={{ transform: `translateY(${pressed ? 9 : 0}px)` }}>
          <path className="sym" d="M250 68H302M276 68V54M266 54H286" />
        </g>
        <text x={276} y={40} className="ref">SW1</text>
        <text x={204} y={72} className="label">+5V</text>
        <text x={330} y={212} className="label">BUTTON</text>
        <circle cx={500} cy={220} r={4} className="junction" />
      </g>

      {/* R2 */}
      <g className={cls("pulldown")}>
        <path className="wire" d="M500 220V232M500 292V304" />
        <rect x={492} y={236} width={16} height={52} className="sym body" />
        <path className="sym" d="M500 232V236M500 288V292" />
        <text x={518} y={258} className="ref start">R2</text>
        <text x={518} y={274} className="val start">10k</text>
        <Gnd x={500} y={304} />
      </g>

      {/* C1 */}
      <g className={cls("debounce")}>
        <path className="wire" d="M500 220H570V250M570 258V304" />
        <path className="sym" d="M556 250H584M556 258H584" />
        <text x={592} y={250} className="ref start">C1</text>
        <text x={592} y={266} className="val start">100n</text>
        <Gnd x={570} y={304} />
      </g>

      {pressed && (
        <g className="flow">
          <path d="M170 140H430V170" />
          <path d="M170 80H500V304" />
        </g>
      )}
    </svg>
  );
}
