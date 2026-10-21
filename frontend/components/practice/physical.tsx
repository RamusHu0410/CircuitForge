/**
 * Real parts seen from above, for building a circuit by hand in the practice builder. Pins sit
 * where the real legs are: an LED's longer leg is the anode, a 555's pins go round the chip
 * counter-clockwise from the dot, a transistor's flat face reads E-B-C.
 */

import type { Pt } from "../../lab/scene";
import { cleanPinName } from "../../lab/scene";
import { LED_RGB, ledColor, parseValue, resistorBands } from "../../lab/values";

export interface Footprint {
  pins: Record<string, Pt>;
  /** Short label per pin shown on hover / next to the leg. */
  pinLabels: Record<string, string>;
  box: [number, number, number, number];
  draw: React.ReactNode;
}

const lead = (a: Pt, b: Pt, key: string) => <line key={key} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#9aa3ad" strokeWidth={0.5} strokeLinecap="round" />;

function dip(pinNames: Record<string, string>, label: string): Footprint {
  const nums = Object.keys(pinNames).map(Number).sort((a, b) => a - b);
  const n = nums.length;
  const half = n / 2;
  const w = Math.max(10, half * 2.54 + 2);
  const pins: Record<string, Pt> = {};
  const labels: Record<string, string> = {};
  for (const num of nums) {
    const bottom = num <= half;
    const i = bottom ? num - 1 : n - num;
    pins[String(num)] = [-w / 2 + 2.27 + i * 2.54, bottom ? 6.35 : -6.35];
    labels[String(num)] = `${num} ${cleanPinName(pinNames[String(num)] ?? "")}`;
  }
  return {
    pins,
    pinLabels: labels,
    box: [-w / 2, -7.5, w / 2, 7.5],
    draw: (
      <>
        {Object.entries(pins).map(([k, p]) => lead(p, [p[0], p[1] > 0 ? 3.8 : -3.8], k))}
        <rect x={-w / 2} y={-3.8} width={w} height={7.6} rx={0.6} fill="#1d1d20" />
        <path d={`M${-w / 2} -1.2a1.2 1.2 0 0 1 0 2.4`} fill="#3a3a3e" />
        <circle cx={-w / 2 + 1.6} cy={2.2} r={0.55} fill="#555" />
        <text x={0} y={0.5} textAnchor="middle" fontSize={1.6} fill="#e9ecef">
          {label}
        </text>
        {Object.entries(pins).map(([k, p]) => (
          <text key={k} x={p[0]} y={p[1] > 0 ? 3.2 : -2.5} textAnchor="middle" fontSize={0.9} fill="#bbb">
            {k}
          </text>
        ))}
      </>
    ),
  };
}

export function footprint(kind: string, value: string, pinNames: Record<string, string>): Footprint {
  switch (kind) {
    case "resistor":
    case "diode": {
      const ohms = parseValue(value) ?? 1000;
      const bands = kind === "resistor" ? resistorBands(ohms).colors : [];
      const pins: Record<string, Pt> = { "1": [-7.62, 0], "2": [7.62, 0] };
      return {
        pins,
        pinLabels: kind === "resistor" ? { "1": "lead", "2": "lead" } : { "1": "cathode (stripe)", "2": "anode" },
        box: [-8, -2, 8, 2],
        draw: (
          <>
            {lead([-7.62, 0], [7.62, 0], "l")}
            <rect x={-4} y={-1.5} width={8} height={3} rx={1.4} fill={kind === "resistor" ? "#d8c191" : "#1d1d20"} />
            {bands.map((c, i) => (
              <rect key={i} x={-2.9 + i * 1.3 + (i === 3 ? 0.9 : 0)} y={-1.5} width={0.7} height={3} fill={c} />
            ))}
            {kind === "diode" && <rect x={-3.2} y={-1.5} width={0.9} height={3} fill="#d8dde4" />}
          </>
        ),
      };
    }
    case "led": {
      const c = LED_RGB[ledColor(value)];
      return {
        pins: { "1": [-1.27, 5.08], "2": [1.27, 7.62] },
        pinLabels: { "1": "cathode − (short leg)", "2": "anode + (long leg)" },
        box: [-3, -3, 3, 8],
        draw: (
          <>
            {lead([-1.27, 1.5], [-1.27, 5.08], "k")}
            {lead([1.27, 1.5], [1.27, 7.62], "a")}
            <path d="M-2.4 -1.4A2.75 2.75 0 1 1 -2.4 1.4Z" fill={c} opacity={0.85} stroke={c} strokeWidth={0.2} />
            <circle cx={0} cy={0} r={2.1} fill="#fff" opacity={0.25} />
            <text x={-2.6} y={6} fontSize={1.4} textAnchor="end" fill="#666">
              −
            </text>
            <text x={2.6} y={8.4} fontSize={1.4} fill="#666">
              +
            </text>
          </>
        ),
      };
    }
    case "capacitor":
      return {
        pins: { "1": [-2.54, 3.81], "2": [2.54, 3.81] },
        pinLabels: { "1": "lead", "2": "lead" },
        box: [-3.2, -2, 3.2, 4],
        draw: (
          <>
            {lead([-1.27, 0], [-2.54, 3.81], "a")}
            {lead([1.27, 0], [2.54, 3.81], "b")}
            <ellipse cx={0} cy={0} rx={3} ry={1.7} fill="#d9892e" />
          </>
        ),
      };
    case "capacitor_polarized":
      return {
        pins: { "1": [-1.27, 5.08], "2": [1.27, 5.08] },
        pinLabels: { "1": "+ (long leg)", "2": "− (stripe side)" },
        box: [-3, -3, 3, 5.5],
        draw: (
          <>
            {lead([-1.27, 2], [-1.27, 5.08], "a")}
            {lead([1.27, 2], [1.27, 5.08], "b")}
            <circle cx={0} cy={0} r={2.8} fill="#1f3c8f" />
            <path d="M1.3 -2.45A2.8 2.8 0 0 1 1.3 2.45Z" fill="#c8d2e8" />
            <text x={1.9} y={0.6} fontSize={1.5} fill="#1f3c8f" textAnchor="middle">
              −
            </text>
          </>
        ),
      };
    case "battery": {
      const v = parseValue(value) ?? 9;
      return {
        pins: { "1": [-3.81, -10.16], "2": [3.81, -10.16] },
        pinLabels: { "1": "+ terminal", "2": "− terminal" },
        box: [-6, -11, 6, 9],
        draw: (
          <>
            {lead([-2, -7], [-3.81, -10.16], "p")}
            {lead([2, -7], [3.81, -10.16], "m")}
            <rect x={-5.5} y={-7} width={11} height={16} rx={1} fill="#26282c" />
            <rect x={-5.5} y={-3} width={11} height={7} fill="#e2a72e" />
            <text x={0} y={1.6} textAnchor="middle" fontSize={2.6} fontWeight={700} fill="#26282c">
              {v} V
            </text>
            <text x={-3.81} y={-11} textAnchor="middle" fontSize={2} fill="#c0392b" fontWeight={700}>
              +
            </text>
            <text x={3.81} y={-11} textAnchor="middle" fontSize={2} fill="#333" fontWeight={700}>
              −
            </text>
          </>
        ),
      };
    }
    case "push_button":
      return {
        pins: { "1": [-5.08, 0], "2": [5.08, 0] },
        pinLabels: { "1": "contact", "2": "contact" },
        box: [-5.5, -3.5, 5.5, 3.5],
        draw: (
          <>
            {lead([-5.08, 0], [-3, 0], "a")}
            {lead([3, 0], [5.08, 0], "b")}
            <rect x={-3.2} y={-3.2} width={6.4} height={6.4} rx={0.5} fill="#1e1f22" />
            <circle cx={0} cy={0} r={1.9} fill="#d9493c" />
          </>
        ),
      };
    case "potentiometer":
      return {
        pins: { "1": [-2.54, 6.35], "2": [0, 6.35], "3": [2.54, 6.35] },
        pinLabels: { "1": "end 1", "2": "wiper (middle)", "3": "end 3" },
        box: [-5, -5, 5, 7],
        draw: (
          <>
            {["1", "2", "3"].map((k, i) => lead([(i - 1) * 2.54, 4.6], [(i - 1) * 2.54, 6.35], k))}
            <rect x={-4.75} y={-4.75} width={9.5} height={9.5} rx={0.5} fill="#2a5bd7" />
            <circle cx={0} cy={0} r={3} fill="#f2f2ee" />
            <line x1={0} y1={0} x2={0} y2={-2.6} stroke="#222" strokeWidth={0.5} />
          </>
        ),
      };
    case "npn_transistor":
      return {
        pins: { "1": [-2.54, 5.08], "2": [0, 5.08], "3": [2.54, 5.08] },
        pinLabels: { "1": "E emitter", "2": "B base", "3": "C collector" },
        box: [-3, -2.5, 3, 5.5],
        draw: (
          <>
            {["1", "2", "3"].map((k, i) => lead([(i - 1) * 1.27, 1], [(i - 1) * 2.54, 5.08], k))}
            <path d="M-2.4 1A2.4 2.4 0 0 1 2.4 1Z" transform="scale(1 1.2)" fill="#1b1b1d" />
            <line x1={-2.4} y1={1.2} x2={2.4} y2={1.2} stroke="#555" strokeWidth={0.3} />
            {["E", "B", "C"].map((t, i) => (
              <text key={t} x={(i - 1) * 2.54} y={7.2} textAnchor="middle" fontSize={1.3} fill="#666">
                {t}
              </text>
            ))}
          </>
        ),
      };
    case "timer_555":
      return dip(pinNames, "NE555");
    case "shift_register_74hc595":
      return dip(pinNames, "74HC595");
    case "regulator_7805":
    case "regulator_ams1117_3v3": {
      const names = kind === "regulator_7805" ? { "1": "IN", "2": "GND", "3": "OUT" } : { "1": "GND", "2": "OUT", "3": "IN" };
      return {
        pins: { "1": [-2.54, 7.62], "2": [0, 7.62], "3": [2.54, 7.62] },
        pinLabels: names,
        box: [-5.2, -6, 5.2, 8],
        draw: (
          <>
            {["1", "2", "3"].map((k, i) => lead([(i - 1) * 2.54, 3], [(i - 1) * 2.54, 7.62], k))}
            <rect x={-5} y={-5.5} width={10} height={3} fill="#c4c9d1" />
            <rect x={-5} y={-2.5} width={10} height={5.5} fill="#1d1d20" />
            <text x={0} y={1} textAnchor="middle" fontSize={1.3} fill="#e9ecef">
              {kind === "regulator_7805" ? "7805" : "AMS1117"}
            </text>
            {Object.entries(names).map(([k, t], i) => (
              <text key={k} x={(i - 1) * 2.54} y={9.6} textAnchor="middle" fontSize={0.95} fill="#666">
                {t}
              </text>
            ))}
          </>
        ),
      };
    }
    case "connector_2pin":
    case "connector_3pin": {
      const n = kind === "connector_2pin" ? 2 : 3;
      const pins: Record<string, Pt> = {};
      const labels: Record<string, string> = {};
      for (let i = 1; i <= n; i++) {
        pins[String(i)] = [0, (i - 1) * 2.54];
        labels[String(i)] = `pin ${i}`;
      }
      return {
        pins,
        pinLabels: labels,
        box: [-1.6, -1.6, 1.6, (n - 1) * 2.54 + 1.6],
        draw: (
          <>
            <rect x={-1.4} y={-1.4} width={2.8} height={(n - 1) * 2.54 + 2.8} fill="#202124" />
            {Object.values(pins).map((p, i) => (
              <rect key={i} x={p[0] - 0.4} y={p[1] - 0.4} width={0.8} height={0.8} fill="#d8b24a" />
            ))}
            <text x={2} y={((n - 1) * 2.54) / 2 + 0.5} fontSize={1.4} fill="#555">
              {value.replace(/_/g, " ")}
            </text>
          </>
        ),
      };
    }
    default:
      return dip(pinNames, value.slice(0, 8));
  }
}
