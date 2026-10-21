/**
 * What every part, pin, wire and symbol detail *does*, written to be understood rather than
 * memorised: an everyday picture first, then what happens physically, then the numbers from the
 * simulation of this exact circuit.
 */

import type { Level } from "../types";
import type { PartReading } from "./sim";
import { cleanPinName, isGroundNet } from "./scene";
import { amps, ledColor, railVolts, si, volts } from "./values";

export interface Detail {
  title: string;
  text: string;
}

export interface TourCtx {
  ref: string;
  /** Voltage lost by the charge going through (negative = gained, as in a battery). */
  drop: number;
  i: number;
  value: string;
  enter: string; // pin the electron enters by (label)
  leave: string;
}

export interface KindInfo {
  name: string;
  what: Record<Level, string>;
  analogy: string;
  pin: (num: string, name: string) => Detail;
  live: (r: PartReading, value: string) => string;
  story: Detail[];
  tour: (t: TourCtx) => string;
  tryIt?: string;
}

const lost = (v: number) => `${Math.abs(v).toFixed(2)} V`;

const twoLead = (a: Detail, b: Detail) => (num: string) => (num === "1" ? a : b);

export const KINDS: Record<string, KindInfo> = {
  resistor: {
    name: "Resistor",
    what: {
      eli5: "A resistor is a narrow part of the road: it lets only a little bit of electricity through at a time.",
      beginner: "A resistor limits how much current flows. The bigger its value (in ohms, Ω), the less current gets through for the same voltage.",
      expert: "Ohmic element, V = I·R. Dissipates P = I²R as heat; here it sets a current or forms part of a divider.",
    },
    analogy: "Like a thin section of a water pipe: the same push (voltage) gets less water (current) through a thinner pipe.",
    pin: twoLead(
      { title: "Lead 1", text: "Resistors have no polarity: current can enter through either lead." },
      { title: "Lead 2", text: "Resistors have no polarity: current can enter through either lead." },
    ),
    live: (r) => (r.i > 1e-7 ? `${amps(r.i)} squeezes through, losing ${volts(r.v)} on the way and making ${si(r.p, "W")} of heat.` : "No current flows through it right now."),
    story: [
      { title: "A crowded path", text: "Inside is a thin film of carbon or metal. Electrons have to push their way through it, bumping into atoms all the time." },
      { title: "Bumps make heat", text: "Every bump hands a little of the electron's energy to the atoms, which jiggle faster: the resistor warms up. That lost energy is the voltage drop across it." },
      { title: "V = I × R", text: "Twice the push (voltage) means twice the current. A bigger resistance means less current for the same push. That one rule sets almost every value in a circuit." },
      { title: "Read the bands", text: "The coloured bands are the value: two digits and a multiplier. Click the bands in the picture to decode them." },
    ],
    tour: (t) => `It squeezes through ${t.ref} (${t.value}Ω). Bumping into the atoms costs it ${lost(t.drop)} of energy, which becomes a little heat. This is what holds the current down to ${amps(t.i)}.`,
  },
  potentiometer: {
    name: "Potentiometer (knob)",
    what: {
      eli5: "A knob that slides a contact along a resistor, so you can choose how much voltage you get out.",
      beginner: "A resistor with a third contact (the wiper) that slides along it. The wiper's voltage moves between the two ends as you turn the knob.",
      expert: "Variable voltage divider: V_wiper = V_top · position. Read by an ADC as an analog position (a joystick axis is one).",
    },
    analogy: "Like standing on a slide: the higher up you stand, the higher your 'voltage'. Turning the knob moves you up and down the slide.",
    pin: (num) =>
      num === "2"
        ? { title: "Wiper (middle pin)", text: "The sliding contact. Its voltage is somewhere between the two ends, set by the knob." }
        : { title: num === "1" ? "End 1" : "End 3", text: "One end of the resistive track, usually tied to the supply or to ground." },
    live: (r) => `${r.state}: the wiper sits at ${volts(r.v)}.`,
    story: [
      { title: "A resistor track", text: "Between the outer pins is a horseshoe-shaped resistor. The supply voltage is spread evenly along it." },
      { title: "The wiper", text: "A metal finger touches the track. Wherever it touches, it picks up the voltage at that point." },
      { title: "Turn it", text: "Turning the knob moves the finger: closer to the + end gives more voltage, closer to ground gives less. Drag the knob slider to try it." },
    ],
    tour: (t) => `It travels along ${t.ref}'s track and loses ${lost(t.drop)} on the way.`,
    tryIt: "Move the knob slider below and watch the wiper voltage follow.",
  },
  capacitor: {
    name: "Capacitor",
    what: {
      eli5: "A capacitor is a tiny bucket for electricity: it fills up, then it can give the electricity back.",
      beginner: "Two metal plates separated by an insulator. Charge piles up on the plates; the more it holds, the higher its voltage. It smooths and times things.",
      expert: "I = C·dV/dt. Blocks DC once charged, passes changes; sets time constants (τ = RC) and decouples supply noise.",
    },
    analogy: "Like a water balloon on a pipe: water flows in while it stretches, then stops when it's full, and it pushes back out if the pressure drops.",
    pin: twoLead({ title: "Plate 1", text: "One of the two plates. Charge piles up here." }, { title: "Plate 2", text: "The other plate. Electrons leave it as fast as they arrive on the first one." }),
    live: (r) => `${r.state} at ${volts(r.v)}${Math.abs(r.i) > 1e-7 ? `, with ${amps(Math.abs(r.i))} flowing in or out` : ""}.`,
    story: [
      { title: "Two plates, no path", text: "Nothing actually crosses the gap between the plates. Electrons pile up on one plate and are pulled off the other." },
      { title: "Filling up", text: "The fuller it gets, the harder it pushes back, so the current slows down and it fills more and more slowly." },
      { title: "Emptying", text: "When the outside voltage drops, the stored charge flows back out. That's how it smooths bumps or times a blink." },
    ],
    tour: (t) => `It piles up on one plate of ${t.ref}, and another electron leaves the other plate: the capacitor is ${t.drop >= 0 ? "charging" : "giving charge back"}.`,
  },
  led: {
    name: "LED (light-emitting diode)",
    what: {
      eli5: "An LED is a tiny light that only works one way round. It needs a resistor so it doesn't get too much electricity.",
      beginner: "A diode that glows. Current can only go in through the anode (+) and out through the cathode (−). It always drops about 2–3 V, so a resistor sets its current.",
      expert: "p–n junction with a direct band gap: recombination emits photons with energy ≈ e·V_f. I rises exponentially with V, hence the series resistor.",
    },
    analogy: "Like a one-way turnstile that flashes a light every time someone goes through.",
    pin: (num) =>
      num === "2"
        ? { title: "Anode (+)", text: "Conventional current goes in here. On a real LED it's the longer leg." }
        : { title: "Cathode (−)", text: "Current comes out here (electrons go in). On a real LED it's the shorter leg, next to the flat edge of the rim." },
    live: (r) =>
      r.i > 5e-4
        ? `Glowing at ${Math.round(Math.min(1, r.level) * 100)}% brightness: ${amps(r.i)} through it and ${volts(r.v)} across it.`
        : r.v < -0.1
          ? "Blocking: it's connected backwards (or the current is pushing the wrong way), so it stays dark."
          : "Dark: not enough current to light it.",
    story: [
      { title: "In at the cathode", text: "Electrons arrive through the cathode leg (−) into a tiny chip of semiconductor sitting in a metal cup." },
      { title: "The junction", text: "The chip has two layers: one with spare electrons, one with 'holes' (missing electrons). Where they meet, an electron falls into a hole." },
      { title: "Falling gives light", text: "The energy from that fall comes out as a particle of light, a photon. The material sets how big the fall is, and so the colour: red ≈ 2 V, blue ≈ 3 V." },
      { title: "Only one way", text: "Backwards, the layers push the electrons away from the junction: no current, no light. That's why polarity matters." },
    ],
    tour: (t) => `It enters ${t.ref} through the ${t.enter}, crosses the junction and drops into a hole. The ${lost(t.drop)} it gives up comes out as ${ledColor(t.value)} light.`,
  },
  diode: {
    name: "Diode",
    what: {
      eli5: "A diode is a one-way door for electricity.",
      beginner: "Current flows from the anode to the cathode (the end with the stripe), and is blocked the other way. It drops about 0.7 V when on.",
      expert: "Silicon p–n junction: I = I_s(e^{V/nV_T} − 1); used for reverse-polarity protection and rectification.",
    },
    analogy: "Like a check valve in a pipe: a flap that opens for water going one way and slams shut the other way.",
    pin: (num) => (num === "2" ? { title: "Anode", text: "Current goes in here." } : { title: "Cathode (stripe)", text: "Current comes out here. The stripe on the body marks it." }),
    live: (r) => `${r.state}: ${volts(r.v)} across it, ${amps(r.i)} through it.`,
    story: [
      { title: "Two layers", text: "Like an LED, a diode is a junction of two kinds of silicon." },
      { title: "Forward", text: "Pushed the right way, about 0.7 V is enough to open the junction and current flows freely." },
      { title: "Reverse", text: "Pushed backwards, the junction widens and blocks almost all current." },
    ],
    tour: (t) => `It passes through ${t.ref}'s one-way junction, paying ${lost(t.drop)} to get through.`,
  },
  npn_transistor: {
    name: "NPN transistor",
    what: {
      eli5: "A transistor is a switch that electricity can flip: a tiny push on the middle leg lets a big flow through the other two.",
      beginner: "A small current into the base (B) lets a much bigger current flow from the collector (C) to the emitter (E). It's how a weak signal switches a load.",
      expert: "BJT, I_C ≈ β·I_B in the active region; driven hard into saturation here so V_CE ≈ 0.1 V and it acts as a switch.",
    },
    analogy: "Like a big water valve opened by a small lever: a trickle on the lever controls a flood through the main pipe.",
    pin: (num) =>
      num === "2"
        ? { title: "Base (B)", text: "The control input. A small current in here turns the transistor on." }
        : num === "3"
          ? { title: "Collector (C)", text: "The big current comes in here from the load (the LED)." }
          : { title: "Emitter (E)", text: "Everything leaves here, to ground. The arrow on the symbol sits on this leg." },
    live: (r) => `${r.state}: ${amps(r.i)} flows from collector to emitter, with ${volts(r.v)} left across it.`,
    story: [
      { title: "Three layers", text: "N-type, P-type, N-type silicon: emitter, base, collector. Normally the thin P layer in the middle blocks the way." },
      { title: "A small push", text: "A small current into the base floods the thin middle layer with charge carriers." },
      { title: "The big flow", text: "Now electrons from the emitter shoot straight across the thin base into the collector: about 100–300 times the base current can flow." },
      { title: "A switch", text: "Give it enough base current and it's fully on (saturated). Take it away and it's off. Set the control input below to try it." },
    ],
    tour: (t) => `It goes through ${t.ref} from ${t.enter} to ${t.leave}. The transistor is ${Math.abs(t.drop) < 0.3 ? "fully on, so it only costs " + lost(t.drop) : "partly on and takes " + lost(t.drop)}.`,
    tryIt: "Change the control input and watch the transistor switch the LED.",
  },
  push_button: {
    name: "Push button",
    what: {
      eli5: "A button is a bridge you can lower: press it and electricity can cross, let go and the bridge lifts.",
      beginner: "A momentary switch: pressing it connects its two pins; releasing it disconnects them.",
      expert: "SPST momentary contact; bounces for a few ms on press, hence the debounce RC or software debounce.",
    },
    analogy: "Like a drawbridge: down (pressed) cars can cross, up (released) the road is cut.",
    pin: () => ({ title: "Contact", text: "One side of the switch. Pressing the button connects it to the other contact." }),
    live: (r) => (r.level ? `Pressed: the contacts touch, ${amps(r.i)} flows through.` : `Released: the contacts are apart, ${volts(r.v)} across the gap.`),
    story: [
      { title: "A gap", text: "Inside, two metal contacts sit apart. No current can jump the air gap." },
      { title: "Press", text: "Pushing the button bends a metal dome down onto both contacts: now it's a wire." },
      { title: "Bounce", text: "For a few thousandths of a second the contacts bounce, making and breaking. A capacitor or the code smooths that out." },
    ],
    tour: (t) => `It crosses ${t.ref}'s closed contacts: a pressed button is just a piece of wire.`,
    tryIt: "Hold the button (here or in the 2D/3D view) and watch the current change.",
  },
  buzzer: {
    name: "Buzzer",
    what: {
      eli5: "A buzzer makes a sound when electricity goes through it.",
      beginner: "An active buzzer has its own little oscillator: give it voltage and it beeps.",
      expert: "Active piezo transducer with an internal driver; draws tens of mA from a GPIO or through a transistor.",
    },
    analogy: "Like a drum that plays itself as long as you keep feeding it.",
    pin: (num) => (num === "1" ? { title: "+", text: "Connect to the positive side." } : { title: "−", text: "Connect to ground." }),
    live: (r) => (r.level > 0.2 ? `Beeping: ${amps(r.i)} through it.` : "Quiet."),
    story: [
      { title: "A crystal disc", text: "Inside is a thin disc of piezo crystal glued to metal." },
      { title: "It bends", text: "Voltage makes the crystal bend. The buzzer's driver flips the voltage thousands of times a second." },
      { title: "Sound", text: "The disc flexes back and forth, pushing the air: that's the beep." },
    ],
    tour: (t) => `It passes through ${t.ref}, spending ${lost(t.drop)} to make the disc vibrate.`,
  },
  battery: {
    name: "Battery (power source)",
    what: {
      eli5: "The battery is the pump: it pushes electricity around the loop and back to itself.",
      beginner: "The energy source. Its + terminal is at a higher voltage than its −. Current flows out of +, through the circuit, and back into −.",
      expert: "DC voltage source with small internal resistance; here it stands for whatever supply you use (cells, USB, a bench supply).",
    },
    analogy: "Like a water pump lifting water up a hill: the water (charge) then flows down through the circuit and comes back to the pump.",
    pin: (num) => (num === "1" ? { title: "+ terminal", text: "The high side. Conventional current leaves here. The longer plate on the symbol." } : { title: "− terminal", text: "The low side (0 V here). Electrons leave from here. The shorter plate on the symbol." }),
    live: (r) => (r.i > 1e-6 ? `Pushing ${amps(r.i)} around the circuit at ${volts(r.v)} (${si(r.p, "W")}).` : `Holding ${volts(r.v)}, but nothing is drawing current.`),
    story: [
      { title: "Chemical pump", text: "Inside, a chemical reaction pulls electrons off one material and pushes them onto another." },
      { title: "A push, not a supply of electrons", text: "The electrons were already in the wires. The battery just pushes them round, like a pump pushes water that's already in the pipes." },
      { title: "Round and round", text: "Every electron that leaves the − terminal comes back to the + terminal, having spent the energy on the way." },
    ],
    tour: (t) => `Back at ${t.ref}. The battery's chemistry lifts it ${lost(t.drop)} back up, ready to go round again.`,
  },
  regulator_7805: {
    name: "Voltage regulator (7805)",
    what: {
      eli5: "A regulator takes a big wobbly voltage and gives out a steady smaller one.",
      beginner: "It keeps its output at exactly 5 V as long as the input is at least ~2 V higher. The extra voltage is burnt off as heat.",
      expert: "Linear series regulator: P = (V_in − V_out)·I_out is dissipated; needs ~2 V dropout and input/output capacitors for stability.",
    },
    analogy: "Like a tap with a float valve: no matter how high the tank, the water coming out has the same pressure.",
    pin: (num) => (num === "1" ? { title: "IN", text: "The higher, unregulated voltage comes in here." } : num === "3" ? { title: "OUT", text: "The steady 5 V comes out here." } : { title: "GND", text: "The reference: both input and output are measured from here." }),
    live: (r) => `Delivering ${amps(r.i)}.`,
    story: [
      { title: "Measures itself", text: "Inside, it constantly compares its output to a precise reference." },
      { title: "Adjusts", text: "A transistor in series opens or closes to keep the output exactly right." },
      { title: "Heat", text: "The voltage it doesn't pass on is turned into heat, which is why big ones have a metal tab." },
    ],
    tour: (t) => `It goes through ${t.ref}, which takes away exactly enough energy (${lost(t.drop)}) to leave a steady output.`,
  },
  timer_555: {
    name: "555 timer",
    what: {
      eli5: "The 555 is a little clock chip: it switches its output on and off by itself, over and over.",
      beginner: "It watches the timing capacitor's voltage: when it falls below 1/3 of the supply, the output goes HIGH; when it rises above 2/3, the output goes LOW and it empties the capacitor.",
      expert: "Two comparators (1/3 and 2/3 V_cc from an internal 5k–5k–5k divider) set and reset an SR latch; astable f ≈ 1.44 / ((R1 + 2R2)·C).",
    },
    analogy: "Like a toilet cistern: it fills slowly, and when it's full enough it flushes, then starts filling again.",
    pin: (_num, name) => {
      const n = cleanPinName(name);
      const roles: Record<string, string> = {
        GND: "Ground (0 V).",
        TRIG: "Trigger: when this falls below 1/3 of the supply, the output goes HIGH.",
        OUT: "The output: about supply − 1.7 V when HIGH, near 0 V when LOW. It drives the LED.",
        RST: "Reset: pulling this low stops everything. Tied high here.",
        CONT: "Control: the internal 2/3 threshold. A small capacitor keeps it quiet.",
        THRES: "Threshold: when this rises above 2/3 of the supply, the output goes LOW.",
        DISCH: "Discharge: shorted to ground while the output is LOW, which empties the timing capacitor.",
        VCC: "Supply in.",
      };
      return { title: n, text: roles[n] ?? "" };
    },
    live: (r) => `${r.state}.`,
    story: [
      { title: "Filling", text: "The timing capacitor charges through the two resistors. Its voltage climbs." },
      { title: "2/3: flip", text: "When it reaches 2/3 of the supply, a comparator flips the latch: output LOW, and the discharge pin starts emptying the capacitor." },
      { title: "1/3: flip back", text: "When it has fallen to 1/3, the other comparator flips the latch back: output HIGH, discharge off, filling again." },
      { title: "The rhythm", text: "Bigger resistors or a bigger capacitor mean slower filling and a slower blink. Try changing them below." },
    ],
    tour: (t) => `It passes through ${t.ref} from ${t.enter} to ${t.leave}.`,
  },
  arduino_uno: {
    name: "Arduino Uno",
    what: {
      eli5: "The Arduino is a tiny computer. It can switch its pins on and off, and read buttons and knobs, following your code.",
      beginner: "A microcontroller board. Each digital pin can be an output (0 V or 5 V) or an input that reads HIGH or LOW. Analog pins measure voltages.",
      expert: "ATmega328P at 16 MHz, 5 V logic; ~20 mA per pin recommended; 10-bit ADC on A0–A5; powered over USB here.",
    },
    analogy: "Like a person at a switchboard following written instructions: watching some lights, flipping some switches.",
    pin: (_num, name) => microcontrollerPin(name),
    live: () => "Running your program. Switch its output pins on the right to see what they do.",
    story: [
      { title: "A tiny computer", text: "The black chip runs your code millions of steps a second." },
      { title: "Outputs", text: "An output pin is connected inside to either 5 V or ground. That's how it lights an LED through a resistor." },
      { title: "Inputs", text: "An input pin just measures: above about 2.5 V it reads HIGH, below it reads LOW. A button pulls it one way or the other." },
    ],
    tour: (t) => `It passes through ${t.ref}, from ${t.enter} to ${t.leave}: the chip is ${t.drop >= 0 ? "using" : "supplying"} that energy.`,
    tryIt: "Turn the output pins on and off below.",
  },
  shift_register_74hc595: {
    name: "Shift register (74HC595)",
    what: {
      eli5: "This chip lets one Arduino pin control eight lights, by sending them one at a time in a line.",
      beginner: "Bits go in one by one on SER with each SRCLK pulse; a pulse on RCLK copies all eight to the outputs QA–QH at once.",
      expert: "8-bit serial-in parallel-out register with output latch; daisy-chain via QH'.",
    },
    analogy: "Like a bucket brigade: each clock tick passes every bucket one person along, and then everyone pours at once.",
    pin: (_num, name) => ({ title: cleanPinName(name), text: /^Q[A-H]$/.test(cleanPinName(name)) ? "One of the 8 outputs." : /SER/.test(name) ? "Data in, one bit at a time." : /SRCLK/.test(name) ? "Shift clock: each pulse moves the bits along by one." : /RCLK/.test(name) ? "Latch: copies the shifted bits to the outputs." : "" }),
    live: () => "Switch its outputs below to see which lights they drive.",
    story: [
      { title: "Shift in", text: "Each clock pulse pushes a new bit in and moves the others along." },
      { title: "Latch", text: "A second pulse copies all 8 bits to the output pins at the same moment." },
    ],
    tour: (t) => `It leaves ${t.ref} through ${t.leave}.`,
  },
  connector_2pin: connectorInfo(),
  connector_3pin: connectorInfo(),
};

KINDS.capacitor_polarized = {
  ...KINDS.capacitor,
  name: "Electrolytic capacitor",
  pin: (num) => (num === "1" ? { title: "+ lead", text: "Must sit at the higher voltage. The longer leg on a real part." } : { title: "− lead", text: "The side with the stripe on the can. Backwards, these capacitors can burst." }),
};
KINDS.regulator_ams1117_3v3 = {
  ...KINDS.regulator_7805,
  name: "Voltage regulator (AMS1117-3.3)",
  pin: (num) => (num === "3" ? { title: "VIN", text: "The higher voltage (5 V) comes in here." } : num === "2" ? { title: "VOUT", text: "A steady 3.3 V comes out here." } : { title: "GND", text: "The reference." }),
  what: { ...KINDS.regulator_7805.what, beginner: "It keeps its output at exactly 3.3 V as long as the input is at least ~1.1 V higher. The extra voltage is burnt off as heat." },
};
KINDS.arduino_nano = { ...KINDS.arduino_uno, name: "Arduino Nano" };

function microcontrollerPin(name: string): Detail {
  const n = cleanPinName(name);
  if (n === "GND") return { title: "GND", text: "Ground: the board's 0 V." };
  if (n === "+5V") return { title: "5V", text: "5 V out, from USB: it can power small parts in the circuit." };
  if (n === "3V3") return { title: "3.3V", text: "3.3 V out, for small 3.3 V parts." };
  if (n === "VIN") return { title: "VIN", text: "Power in, 7–12 V, when not using USB." };
  if (/^A\d/.test(n) || n.includes("/A")) return { title: n, text: "Analog pin: it can measure a voltage between 0 and 5 V (as a number 0–1023), or be used as a digital pin." };
  if (/^D\d/.test(n)) return { title: n, text: "Digital pin: either an output (0 V or 5 V) or an input that reads HIGH or LOW." };
  return { title: n, text: "" };
}

function connectorInfo(): KindInfo {
  return {
    name: "Connector",
    what: {
      eli5: "A connector is a plug: it's where wires from outside join this circuit.",
      beginner: "A header where other things connect: a power supply, a signal coming in, or something reading the output.",
      expert: "Pin header; here it stands for the outside world (a signal source, a GPIO, or a measuring instrument).",
    },
    analogy: "Like a socket in the wall: the circuit doesn't care what's on the other side, only what comes in and out.",
    pin: (num, name) => ({ title: `Pin ${num}`, text: name && !/^Pin_/.test(name) ? name : "A connection to the outside." }),
    live: () => "Change what goes into it below.",
    story: [{ title: "The outside world", text: "Whatever is plugged in here (a signal, a microcontroller pin, a meter) connects to the circuit through these pins." }],
    tour: (t) => `It passes through ${t.ref}: from here it goes out to whatever is plugged in, and comes back the same way.`,
  };
}

export const kindInfo = (kind: string): KindInfo =>
  KINDS[kind] ?? {
    name: kind.replace(/_/g, " "),
    what: { eli5: "A part of the circuit.", beginner: "A part of the circuit.", expert: "" },
    analogy: "",
    pin: (num, name) => ({ title: name || `Pin ${num}`, text: "" }),
    live: () => "",
    story: [],
    tour: (t) => `It passes through ${t.ref}.`,
  };

/* ---------- nets ---------- */

export function netInfo(net: string, connections: string[], v: number | undefined): Detail {
  const at = v === undefined ? "" : ` It's at ${volts(v)} everywhere along it.`;
  const list = connections.length ? ` It connects ${connections.join(", ")}.` : "";
  if (isGroundNet(net))
    return {
      title: "GND: ground",
      text: `The 0 V reference everything is measured from, and the road back to the − side of the supply. Every GND symbol in the drawing is the same wire.${list}`,
    };
  const rail = railVolts(net);
  if (rail !== null && /^\+|^V/.test(net))
    return { title: `${net}: supply rail`, text: `The ${rail} V supply. Everything that needs power takes it from here; every ${net} symbol is the same wire.${list}${at}` };
  const roles: [RegExp, string][] = [
    [/^OUT/, "The output signal."],
    [/^TIMING/, "The timing node: the capacitor's voltage here goes up and down, and the 555 watches it."],
    [/^DISCH/, "The discharge node: the 555 shorts it to ground to empty the timing capacitor."],
    [/^CTRL/, "The 555's control voltage (its 2/3 threshold), steadied by a small capacitor."],
    [/^BTN|_BTN$/, "The button signal: pulled one way by a resistor, and the other way when the button is pressed."],
    [/^BASE/, "The transistor's base: the small control current goes in here."],
    [/^COLLECTOR/, "Between the load and the transistor's collector."],
    [/^VOUT/, "The divider's output: a fraction of the input voltage."],
    [/^VIN|^IN$/, "The input."],
    [/^LED\d*_A|_A$/, "Between the resistor and the LED's anode: after the resistor has taken its share of the voltage."],
  ];
  const role = roles.find(([re]) => re.test(net))?.[1] ?? "A connection between parts.";
  return { title: `Net ${net}`, text: `${role}${list}${at} A wire has (almost) no resistance, so nothing is lost along it.` };
}

export const TINY: Record<string, Detail> = {
  junction: { title: "Junction dot", text: "Wires that meet at a dot are connected. Where wires cross without a dot, they are not. Here the current splits or joins." },
  label: { title: "Net label", text: "A name tag for a wire. Every place with the same name is connected, even with no line drawn between them. It keeps big drawings tidy." },
  ground: { title: "Ground symbol", text: "Means 'connected to ground (0 V)'. All ground symbols are joined, as if one wire ran between them all, back to the − side of the supply." },
  supply: { title: "Power symbol", text: "Means 'connected to this supply voltage'. Every symbol with the same name is the same wire." },
  ref: { title: "Reference", text: "The part's name in this drawing. The letters say what it is (R = resistor, C = capacitor, D = diode/LED, Q = transistor, U = chip, SW = switch, J = connector, BT = battery) and the number counts them." },
  value: { title: "Value", text: "How big the part is: ohms (Ω) for resistors, farads (F) for capacitors (n = nano, µ = micro), volts for batteries, or the exact chip." },
  noConnect: { title: "No-connect mark", text: "An × on a pin means 'left unconnected on purpose', so the checks don't flag it." },
};

/** Clickable details inside a symbol (library coordinates). */
export const HOTSPOTS: Record<string, { box: [number, number, number, number]; detail: Detail }[]> = {
  "Device:LED": [
    { box: [-4.8, -2.5, -1.7, -0.6], detail: { title: "The two arrows", text: "Light coming out. Without the arrows it would be a plain diode." } },
    { box: [-1.6, -1.4, -1.0, 1.4], detail: { title: "The bar: cathode", text: "The bar marks the cathode (−). On the real LED: the shorter leg and the flat side of the rim." } },
    { box: [-1.0, -1.4, 1.4, 1.4], detail: { title: "The triangle", text: "It points the way conventional current flows: from the anode, into the bar. Current trying to go the other way hits the bar and stops." } },
  ],
  "Device:D": [
    { box: [-1.6, -1.4, -1.0, 1.4], detail: { title: "The bar: cathode", text: "The bar is the cathode, marked with a stripe on the real diode." } },
    { box: [-1.0, -1.4, 1.4, 1.4], detail: { title: "The triangle", text: "Points the direction current is allowed to flow." } },
  ],
  "Device:Battery": [
    { box: [-2.4, 1.4, 2.4, 1.9], detail: { title: "Long thin plate: +", text: "The longer line is the + side of a cell." } },
    { box: [-1.6, 0.4, 1.6, 1.1], detail: { title: "Short thick plate: −", text: "The shorter, thicker line is the − side. One long + one short = one cell; this symbol shows a battery of several cells." } },
    { box: [-2.4, -1.6, 2.4, -1.2], detail: { title: "Long thin plate: +", text: "The + side of the next cell, stacked on the − of the one above: cells in series add their voltages." } },
    { box: [-1.6, -2.6, 1.6, -2.0], detail: { title: "Short thick plate: −", text: "The − end of the whole battery." } },
    { box: [0.6, 2.4, 1.9, 3.7], detail: { title: "The + sign", text: "Marks the positive terminal." } },
  ],
  "Device:C": [{ box: [-2.2, -0.9, 2.2, 0.9], detail: { title: "Two plates", text: "The two lines are two metal plates with an insulator between them. Nothing crosses the gap; charge just piles up on them." } }],
  "Device:C_Polarized": [
    { box: [-1.9, 1.7, -0.6, 2.9], detail: { title: "The + sign", text: "This lead must be at the higher voltage." } },
    { box: [-2.4, -1.1, 2.4, -0.4], detail: { title: "Filled plate: −", text: "The negative plate, marked with a stripe on the real can." } },
  ],
  "Device:R": [{ box: [-1.1, -2.6, 1.1, 2.6], detail: { title: "The body", text: "The rectangle is the resistive part. (American drawings use a zigzag for the same thing.)" } }],
  "Switch:SW_Push": [
    { box: [-2.7, 1.1, 2.7, 3.2], detail: { title: "The plunger", text: "The bar with a stem is the button you press: it comes down and bridges the two contacts." } },
    { box: [-2.6, -0.6, -1.4, 0.6], detail: { title: "Contact", text: "A fixed contact. With the button up, there's a gap to the other one." } },
    { box: [1.4, -0.6, 2.6, 0.6], detail: { title: "Contact", text: "The other fixed contact." } },
  ],
  "Transistor_BJT:2N3904": [
    { box: [1.1, -2.5, 2.6, -1.1], detail: { title: "The emitter arrow", text: "Shows which way current leaves. On an NPN it points out: 'Not Pointing iN'." } },
    { box: [0.4, -2.0, 0.9, 2.0], detail: { title: "The base bar", text: "The thin middle layer. The base lead connects to it." } },
  ],
  "Device:R_Potentiometer": [{ box: [1.0, -0.7, 2.6, 0.7], detail: { title: "The wiper arrow", text: "The sliding contact touching the track. Turning the knob moves it." } }],
};
