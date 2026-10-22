import { useMemo, useState } from "react";
import { CircuitBoard, Code2, Search } from "lucide-react";
import type { PartLibrary } from "../../api/client";
import type { Build } from "../../lab/build";
import { kindInfo } from "../../lab/knowledge";
import { CodeEditor } from "../CodeEditor";
import { Builder, type TrayItem } from "../practice/Builder";

/** Groups of the parts box, in order, with a sensible starting value for each part. */
const GROUPS: { name: string; kinds: [string, string][] }[] = [
  { name: "Power", kinds: [["battery", "9V"]] },
  { name: "Passives", kinds: [["resistor", "1k"], ["potentiometer", "10k"], ["capacitor", "100n"], ["capacitor_polarized", "10u"]] },
  { name: "Light & sound", kinds: [["led", "LED_Red"], ["buzzer", "Buzzer"]] },
  { name: "Semiconductors", kinds: [["diode", "1N4007"], ["npn_transistor", "2N3904"]] },
  { name: "Switches & connectors", kinds: [["push_button", "SW_Push"], ["connector_2pin", "Conn_01x02"], ["connector_3pin", "Conn_01x03"]] },
  { name: "Chips", kinds: [["timer_555", "NE555P"], ["regulator_7805", "L7805"], ["regulator_ams1117_3v3", "AMS1117-3.3"], ["shift_register_74hc595", "74HC595"]] },
  { name: "Boards", kinds: [["arduino_nano", "Arduino_Nano_v3.x"], ["arduino_uno", "Arduino_UNO_R3"]] },
];

/** Quick picks for a part's value. */
const PRESETS: Record<string, string[]> = {
  resistor: ["100", "220", "330", "470", "680", "1k", "2.2k", "4.7k", "10k", "22k", "47k", "100k"],
  potentiometer: ["1k", "10k", "100k"],
  capacitor: ["1n", "10n", "15n", "33n", "100n", "470n", "1u"],
  capacitor_polarized: ["1u", "10u", "22u", "47u", "100u", "470u"],
  battery: ["3V", "5V", "9V", "12V"],
  led: ["LED_Red", "LED_Orange", "LED_Yellow", "LED_Green", "LED_Blue", "LED_White"],
  connector_2pin: ["Conn_01x02", "Signal_In", "Signal_Out", "Control", "Output"],
  connector_3pin: ["Conn_01x03", "Control", "Button"],
};

export const STARTER_SKETCH = `// Your program. setup() runs once, then loop() runs over and over.
const int LED_PIN = 3;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}
`;

interface Props {
  library: PartLibrary;
  build: Build;
  onBuild: (b: Build) => void;
  code: string;
  onCode: (c: string) => void;
  /** Kinds to highlight (a challenge's key parts). */
  needs?: string[];
  size?: [number, number];
}

export function Editor({ library, build, onBuild, code, onCode, needs = [], size = [160, 99] }: Props) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"circuit" | "code">("circuit");
  const [selected, setSelected] = useState<string | null>(null);
  const hasBoard = build.parts.some((p) => p.kind.startsWith("arduino"));

  const tray: TrayItem[] = useMemo(() => {
    const byKind = new Map(library.kinds.map((k) => [k.kind, k]));
    const q = query.trim().toLowerCase();
    return GROUPS.flatMap((g) =>
      g.kinds
        .filter(([kind]) => byKind.has(kind))
        .map(([kind, value]) => {
          const k = byKind.get(kind)!;
          const name = kindInfo(kind).name.split(" (")[0];
          return { key: kind, kind, value, lib_id: k.lib_id, prefix: k.prefix, label: name, hint: k.description, group: g.name, key_part: needs.includes(kind) };
        })
        .filter((t) => !q || `${t.label} ${t.kind} ${t.hint}`.toLowerCase().includes(q)),
    );
  }, [library, query, needs]);
  const ports = useMemo(() => Object.entries(library.power).map(([net, lib_id]) => ({ net, lib_id })), [library]);

  const part = build.parts.find((p) => p.id === selected);
  const setValue = (value: string) => part && onBuild({ ...build, parts: build.parts.map((p) => (p.id === part.id ? { ...p, value } : p)) });

  return (
    <div className="editor">
      {hasBoard && (
        <div className="seg-row editor-tabs">
          <button className={`seg${tab === "circuit" ? " on" : ""}`} onClick={() => setTab("circuit")}>
            <CircuitBoard size={13} /> circuit
          </button>
          <button className={`seg${tab === "code" ? " on" : ""}`} onClick={() => setTab("code")}>
            <Code2 size={13} /> code
          </button>
        </div>
      )}
      <div className={tab === "code" && hasBoard ? "hidden" : "editor-circuit"}>
        <label className="tray-search">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="find a part" aria-label="Find a part" />
        </label>
        <Builder look="schematic" symbols={library.symbols} tray={tray} ports={ports} build={build} onChange={onBuild} size={size} trayTitle="Parts" onSelectPart={setSelected} />
        {part && (
          <div className="value-edit">
            <b>{part.ref}</b> {kindInfo(part.kind).name.split(" (")[0]}
            <input value={part.value} onChange={(e) => setValue(e.target.value)} aria-label={`${part.ref} value`} spellCheck={false} />
            <span className="presets">
              {(PRESETS[part.kind] ?? []).map((v) => (
                <button key={v} className={`chip-btn${part.value === v ? " on" : ""}`} onClick={() => setValue(v)}>
                  {v.replace(/^LED_/, "").replace(/_/g, " ")}
                </button>
              ))}
            </span>
          </div>
        )}
      </div>
      {tab === "code" && hasBoard && (
        <div className="editor-code">
          <CodeEditor value={code || STARTER_SKETCH} onChange={onCode} height={440} />
          <p className="dim small">Runs in the simulator: pinMode, digitalRead/Write, analogRead/Write, millis, delay, tone, shiftOut and Serial all work. Pins are named like on the board: 3 is D3, A0 is the first analog pin.</p>
        </div>
      )}
    </div>
  );
}
