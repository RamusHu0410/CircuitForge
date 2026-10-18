import type { LessonId, Level } from "../types";

export const LEVELS: { id: Level; label: string }[] = [
  { id: "eli5", label: "like I'm 5" },
  { id: "beginner", label: "beginner" },
  { id: "expert", label: "expert" },
];

export const levelLabel = (l: Level) => LEVELS.find((x) => x.id === l)!.label;
export const nextLevel = (l: Level): Level => LEVELS[(LEVELS.findIndex((x) => x.id === l) + 1) % LEVELS.length].id;

/** Explanation text per lesson, per difficulty. Formulas are rendered separately (LaTeX). */
export const EXPLAIN: Record<LessonId, Record<Level, string>> = {
  parse: {
    eli5: "The AI just listens to what you said and writes a to-do list. A calculator does all the real work after that.",
    beginner: "The AI turns your sentence into steps from a fixed list of step types. Every value after this comes from formulas you can check yourself.",
    expert: "LLM output is constrained to a typed step schema and validated before the deterministic engine runs. No component values come from the model.",
  },
  power: {
    eli5: "We add up how much electricity every part drinks. It's a tiny sip compared to what the USB cable can give.",
    beginner: "Total current is the sum of every branch. With the button held and the LED on, the circuit uses under 3% of what a USB port supplies.",
    expert: "Worst-case static draw (button held, D13 high). Per-pin limit is 20 mA (40 mA absolute max); the ATmega328P's total Vcc/GND limit is 200 mA. The supply budget isn't a constraint.",
  },
  led: {
    eli5: "An LED is like a tiny thirsty light. If it drinks too much electricity at once, it pops. The resistor is a thin straw that only lets a little through.",
    beginner: "The LED always uses about 2 V, so the resistor gets the other 3 V. Ohm's law (V = I·R) tells us how big the resistor must be to let 15 mA through. Real resistors come in standard sizes, so we round up to 220 Ω, which lowers the current slightly.",
    expert: "Series current limiting with a constant-Vf LED model, rounded up to the next E12 value so I ≤ target. Dissipation is far below a 0.25 W rating. Vf varies about ±0.2 V with color and temperature, which moves I by roughly ±7%.",
  },
  pulldown: {
    eli5: "A pin with nothing attached can't make up its mind. It keeps flipping between yes and no. The resistor gently holds it at \"no\" until you press the button and say \"yes\".",
    beginner: "An unconnected input picks up electrical noise and reads randomly. R2 connects D2 to ground so it reads LOW. Pressing the button connects D2 straight to 5 V, which wins because the button has almost no resistance.",
    expert: "The CMOS input is high-impedance, so R2 defines the idle state. 10 kΩ trades 0.5 mA of static draw when pressed against noise immunity, and leakage (I_IL ≤ 1 µA) adds at most 10 mV. Alternative: INPUT_PULLUP (20–50 kΩ internal) with an active-low button removes R2 entirely.",
  },
  debounce: {
    eli5: "When you let go of a button, it wiggles on-off-on really fast. The capacitor is like a little bucket of water that empties slowly, so the wiggles don't count.",
    beginner: "When the button opens, C1 slowly drains through R2. The voltage falls along an exponential curve, and the pin only reads LOW once it drops under 1.5 V. That takes about 1.2 ms, which hides most bounce.",
    expert: "First-order RC discharge on release, τ = R₂C₁. V_IL(max) = 0.3·Vcc gives t = τ·ln(1/0.3). Press edges aren't filtered because the switch shorts C1 to Vcc, so keep a firmware debounce. A small series resistor would also limit the contact inrush current.",
  },
  nets: {
    eli5: "A net is a team of pins holding hands. Every pin has to be on exactly one team.",
    beginner: "A net is a group of pins wired together into one electrical point. The engine checks that every pin is in exactly one net and every net has at least two pins.",
    expert: "Nets are the connected components of the pin–wire graph. KiCad's ERC also requires a driver on every power net. USB power isn't modeled, so GND needs a PWR_FLAG.",
  },
  verify: {
    eli5: "Electricity is like water going around a loop. All the push the battery gives is used up by the time it comes back. Nothing is left over and nothing gets lost.",
    beginner: "Kirchhoff's voltage law: around any loop, the voltage drops add up to the supply. Kirchhoff's current law: the current into a point equals the current out. Both hold, so the design is consistent.",
    expert: "Modified nodal analysis stamps every element into G·v = i and solves the system. Here the LED is an ideal Vf source, so the branch is linear. The full solver iterates a diode model with Newton–Raphson.",
  },
};
