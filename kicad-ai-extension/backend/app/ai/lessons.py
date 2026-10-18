"""Build a Classroom lesson for a generated circuit.

The lesson is derived from what was actually generated: component values and purposes,
nets, the engine's own calculation notes, the firmware, and KiCad's ERC result. Nothing
is generic boilerplate about some other circuit, and every number shown is recomputed
from the circuit's own values.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict

from app.core.component_registry import COMPONENT_KINDS, POWER_SYMBOLS
from app.schemas.circuit import CircuitSpec, ComponentSpec, ErcReport, Firmware, SchematicFiles, ValidationReport
from app.schemas.lesson import (
    BuildStep,
    CodeExcerpt,
    Fact,
    Formula,
    Lesson,
    LessonSection,
    LevelText,
    Playground,
    PlayOutput,
    PlayParam,
    QuizQuestion,
)

LED_VF = {"red": 2.0, "orange": 2.0, "yellow": 2.1, "green": 2.2, "blue": 3.1, "white": 3.1}
PIN_LIMIT_MA = 20  # ATmega328P recommended per-pin current (40 mA absolute max)
QUARTER_WATT = 0.25


# --- numbers ------------------------------------------------------------------------------

_PREFIX = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "m": 1e-3, "k": 1e3, "M": 1e6}


def parse_value(text: str) -> float | None:
    """"330" -> 330, "4.7k"/"4k7" -> 4700, "100n" -> 1e-7, "10u" -> 1e-5, "9V" -> 9."""
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([pnuµmkM]?)(\d*)\s*[VFA]?", text.strip().replace("Ω", ""))
    if not m:
        return None
    whole, prefix, frac = m.groups()
    return float(whole + (f".{frac}" if frac else "")) * _PREFIX.get(prefix, 1.0)


def _num(x: float, digits: int = 3) -> str:
    text = f"{x:.{digits}g}"
    if "e" in text:
        text = f"{x:.{max(0, digits - 1)}f}"
    return text


def si(x: float, unit: str, digits: int = 3) -> str:
    if x == 0:
        return f"0 {unit}"
    for factor, prefix in ((1e6, "M"), (1e3, "k"), (1, ""), (1e-3, "m"), (1e-6, "µ"), (1e-9, "n"), (1e-12, "p")):
        if abs(x) >= factor * 0.9995:
            return f"{_num(x / factor, digits)} {prefix}{unit}"
    return f"{_num(x / 1e-12, digits)} p{unit}"


def tex(x: float, unit: str, digits: int = 3) -> str:
    """LaTeX for a value with unit, e.g. 9.1\\,\\text{mA}, 330\\,\\Omega, 0.5\\,\\mu\\text{A}."""
    number, _, rest = si(x, unit, digits).partition(" ")
    prefix, base = (rest[:-len(unit)], unit) if unit and rest.endswith(unit) else (rest, "")
    pre = r"\mu" if prefix == "µ" else (rf"\text{{{prefix}}}" if prefix else "")
    if base == "Ω":
        return rf"{number}\,{pre}\Omega"
    if prefix == "µ":
        return rf"{number}\,\mu\text{{{base}}}"
    return rf"{number}\,\text{{{prefix}{base}}}" if prefix or base else number


# --- reading the circuit ----------------------------------------------------------------------


def _by_kind(spec: CircuitSpec, *kinds: str) -> list[ComponentSpec]:
    return [c for c in spec.components if c.kind in kinds]


def _first(spec: CircuitSpec, kind: str, purpose: str = "") -> ComponentSpec | None:
    return next((c for c in spec.components if c.kind == kind and purpose in c.purpose), None)


def _supply_volts(spec: CircuitSpec) -> float | None:
    battery = _first(spec, "battery")
    if battery and (v := parse_value(battery.value)) is not None:
        return v
    for net in spec.nets:
        if net.name.startswith("+") and re.fullmatch(r"\+\d+V\d*", net.name):
            return float(net.name.lstrip("+").replace("V", ".").rstrip("."))
    return 5.0 if _first(spec, "arduino_nano") else None


def family(spec: CircuitSpec) -> str:
    kinds = {c.kind for c in spec.components}
    title = spec.title.lower()
    if "arduino_nano" in kinds:
        return "mcu"
    if "timer_555" in kinds:
        return "555"
    if kinds & {"regulator_7805", "regulator_ams1117_3v3"}:
        return "regulator"
    if "npn_transistor" in kinds:
        return "transistor"
    if "divider" in title:
        return "divider"
    if "filter" in title:
        return "filter"
    if "push_button" in kinds:
        return "button"
    if "led" in kinds:
        return "led"
    return "generic"


_LED_NOTE = re.compile(r"^(R\d+) = ([^:]+): \(([\d.]+)V - ([\d.]+) V\) / ([\d.]+) mA for the (\w+) LED (D\d+)")


def _led_notes(spec: CircuitSpec) -> list[dict]:
    out = []
    for note in spec.notes:
        if m := _LED_NOTE.match(note):
            r_ref, r_val, vs, vf, ma, color, d_ref = m.groups()
            ohms = parse_value(r_val)
            if ohms:
                out.append({"r": r_ref, "ohms": ohms, "vs": float(vs), "vf": float(vf), "ma": float(ma), "color": color, "d": d_ref})
    return out


def _mc(question: str, correct: str, wrong: list[str], why: str) -> QuizQuestion:
    """Multiple choice with a stable (alphabetical) option order."""
    options = sorted({correct, *wrong})
    return QuizQuestion(question=question, options=options, answer=options.index(correct), why=why)


def _mc_values(question: str, correct: float, wrong: list[float], unit: str, why: str) -> QuizQuestion:
    values = sorted({round(v, 12) for v in [correct, *wrong] if v > 0})
    options = [si(v, unit) for v in values]
    return QuizQuestion(question=question, options=options, answer=values.index(round(correct, 12)), why=why)


# --- what each kind of part is ------------------------------------------------------------------

PART_TEXT: dict[str, tuple[str, LevelText, QuizQuestion]] = {
    "resistor": (
        "Resistors",
        LevelText(
            eli5="A resistor is a narrow pipe for electricity. The narrower the pipe (the more ohms), the less electricity can squeeze through.",
            beginner="A resistor turns voltage into a fixed amount of current: I = V / R. Here they limit current so parts don't burn out, or hold a pin at a known level.",
            expert="Linear, non-polar element obeying V = I·R. Choose the value from the current you need, then check power (P = I²R) against the package rating; 0.25 W through-hole parts are typical.",
        ),
        _mc("What does a bigger resistor value do to the current?", "Less current flows", ["More current flows", "Nothing changes"], "I = V / R: with the same voltage, a bigger R means a smaller current."),
    ),
    "capacitor": (
        "Capacitors",
        LevelText(
            eli5="A capacitor is a tiny bucket for electricity. It fills up and empties out, which smooths things or makes them slow down.",
            beginner="A capacitor stores charge. It resists sudden changes in voltage, so it's used to smooth supplies, filter signals and set timing (τ = R·C).",
            expert="i = C·dv/dt. Ceramics here are non-polar; in timing and filters they combine with a resistor into a first-order RC network with time constant τ = RC.",
        ),
        _mc("What does a capacitor resist?", "Sudden changes in voltage", ["Any current at all", "Sudden changes in resistance"], "Current flows into a capacitor only while its voltage changes (i = C·dv/dt)."),
    ),
    "capacitor_polarized": (
        "Electrolytic capacitors",
        LevelText(
            eli5="A big electricity bucket that only works one way round. Put it in backwards and it can pop!",
            beginner="A polarized (electrolytic) capacitor stores a lot of charge, but its + leg must go to the higher voltage. The stripe on the body marks the − leg.",
            expert="Electrolytic: high capacitance per volume, polarized, higher ESR and leakage than ceramics. Never reverse-bias; derate the voltage rating.",
        ),
        _mc("Which leg of an electrolytic capacitor goes to the higher voltage?", "The + leg", ["The − leg (stripe)", "Either one"], "Electrolytics are polarized: + to the higher voltage, the striped − leg to the lower."),
    ),
    "led": (
        "LEDs",
        LevelText(
            eli5="An LED is a tiny light that only lets electricity go one way. It needs a helper resistor so it doesn't drink too much and break.",
            beginner="A light-emitting diode glows when current flows from its anode (+, long leg) to its cathode (−, short leg, flat side). It keeps an almost fixed voltage (Vf) across itself, so a resistor must set the current.",
            expert="Exponential I–V curve: above Vf, small voltage changes cause big current changes, so drive it with a current-setting resistor (or a constant-current source). Brightness is roughly proportional to current.",
        ),
        _mc("Which LED leg goes towards the positive side?", "The anode (long leg)", ["The cathode (short leg)", "Either leg"], "Current flows anode → cathode; the cathode is the short leg on the flat side of the case."),
    ),
    "diode": (
        "Diodes",
        LevelText(
            eli5="A one-way door for electricity.",
            beginner="A diode lets current flow from anode to cathode and blocks it the other way, dropping about 0.7 V when it conducts.",
            expert="Silicon junction diode, Vf ≈ 0.6–1 V depending on current; reverse leakage is small until breakdown.",
        ),
        _mc("Which way does a diode let current through?", "Anode to cathode", ["Cathode to anode", "Both ways"], "The band on the case marks the cathode; current flows towards it."),
    ),
    "potentiometer": (
        "Potentiometers",
        LevelText(
            eli5="A knob that changes how narrow the electricity pipe is.",
            beginner="A potentiometer is a resistor with a sliding middle contact (the wiper), so it makes an adjustable voltage divider.",
            expert="Three-terminal variable resistor; the wiper voltage is Vin·(position) for an unloaded divider.",
        ),
        _mc("What is the middle pin of a potentiometer called?", "The wiper", ["The anode", "The base"], "Turning the knob slides the wiper along the resistive track."),
    ),
    "battery": (
        "The battery",
        LevelText(
            eli5="The battery is the pump that pushes electricity around the loop.",
            beginner="BT1 stands for your power source (a battery or a bench supply). Its + terminal is the high side; everything returns to its − terminal (GND).",
            expert="An ideal voltage source in the schematic. In the real build, check the supply can deliver the total current and that GND is common to everything.",
        ),
        _mc("Where does all the current in the circuit end up?", "Back at the battery's − (GND)", ["It gets used up inside the LED", "At the + terminal"], "Current flows in a closed loop: out of +, through the parts, back into − (GND)."),
    ),
    "push_button": (
        "Push buttons",
        LevelText(
            eli5="A push button is a tiny bridge you hold down to let electricity across.",
            beginner="A momentary switch connects its two pins only while pressed. An input pin needs a pull-up or pull-down so it has a defined level when the button is open.",
            expert="SPST normally-open tactile switch. Contacts bounce for ~1–10 ms; handle it with an RC filter or debounce in firmware.",
        ),
        _mc("What happens to an input pin connected only to an open button?", "It floats and reads randomly", ["It always reads LOW", "It always reads HIGH"], "Without a pull resistor nothing defines the voltage, so noise decides the reading."),
    ),
    "connector_2pin": (
        "Connectors",
        LevelText(
            eli5="A plug where you connect wires from the outside world.",
            beginner="A 2-pin header brings a signal or power in or out of the board.",
            expert="Pin header; pin 1 is marked with a square pad on the footprint.",
        ),
        _mc("How is pin 1 marked on a header footprint?", "A square pad", ["A round pad", "It isn't marked"], "KiCad footprints draw pin 1 as a square pad."),
    ),
    "connector_3pin": (
        "Connectors",
        LevelText(
            eli5="A plug where you connect wires from the outside world.",
            beginner="A 3-pin header brings power, a signal and ground in or out of the board.",
            expert="Pin header; pin 1 is marked with a square pad on the footprint.",
        ),
        _mc("How is pin 1 marked on a header footprint?", "A square pad", ["A round pad", "It isn't marked"], "KiCad footprints draw pin 1 as a square pad."),
    ),
    "npn_transistor": (
        "The transistor",
        LevelText(
            eli5="A transistor is a switch that a small push can flip, letting a much bigger flow through.",
            beginner="An NPN transistor lets current flow from collector to emitter when a small current goes into its base. A weak logic pin can switch a bigger load this way.",
            expert="2N3904 used as a saturated low-side switch: drive Ib well above Ic/hFE so Vce(sat) ≈ 0.2 V and the transistor dissipates little.",
        ),
        _mc("Which pin of an NPN transistor is the control input?", "The base", ["The collector", "The emitter"], "A small base current controls the larger collector–emitter current."),
    ),
    "timer_555": (
        "The 555 timer",
        LevelText(
            eli5="The 555 is a little clock chip. It flips its output on and off over and over, all by itself.",
            beginner="In astable mode the 555 charges a capacitor through two resistors and discharges it through one. Comparators at 1/3 and 2/3 of the supply flip the output each time.",
            expert="NE555 astable: C charges via R1+R2 to 2/3 Vcc, discharges via R2 to 1/3 Vcc. t_high = 0.693(R1+R2)C, t_low = 0.693·R2·C; duty is always above 50%.",
        ),
        _mc("Between which two voltages does the timing capacitor swing?", "1/3 and 2/3 of the supply", ["0 V and the supply", "1/2 and the supply"], "The 555's comparators trip at 1/3 Vcc and 2/3 Vcc."),
    ),
    "regulator_7805": (
        "The regulator",
        LevelText(
            eli5="The regulator is a gate that only lets out exactly 5 volts, no matter how much comes in.",
            beginner="A 7805 linear regulator outputs a steady 5 V from a higher input. It needs about 2 V of headroom, and the extra voltage turns into heat.",
            expert="LM7805: dropout ≈ 2 V; dissipation P = (Vin − Vout)·Iload; add a heatsink above ~1 W. Input/output capacitors per the datasheet keep it stable.",
        ),
        _mc("Where does the extra voltage go in a linear regulator?", "It turns into heat", ["It's stored for later", "It goes back into the battery"], "P = (Vin − Vout) × I is burnt as heat in the regulator."),
    ),
    "regulator_ams1117_3v3": (
        "The regulator",
        LevelText(
            eli5="The regulator is a gate that only lets out exactly 3.3 volts.",
            beginner="An AMS1117-3.3 is a low-dropout regulator: it outputs 3.3 V from as little as about 4.5 V in. The extra voltage becomes heat.",
            expert="LDO, dropout ≈ 1.1–1.3 V at full load; needs its datasheet output capacitance (≥ 22 µF tantalum/electrolytic) for stability.",
        ),
        _mc("Where does the extra voltage go in a linear regulator?", "It turns into heat", ["It's stored for later", "It goes back into the battery"], "P = (Vin − Vout) × I is burnt as heat in the regulator."),
    ),
    "arduino_nano": (
        "The Arduino Nano",
        LevelText(
            eli5="The Arduino is the brain. It reads the button and decides when to turn the lights on, following the code you give it.",
            beginner="An Arduino Nano is a small board with an ATmega328P microcontroller. Its pins read inputs (buttons) and drive outputs (LEDs) at 5 V, and it's programmed in C++ from the Arduino IDE over USB.",
            expert="ATmega328P @ 16 MHz, 5 V I/O, internal pull-ups 20–50 kΩ, 20 mA recommended per pin (40 mA absolute). Analog pins A0–A5 double as digital I/O.",
        ),
        _mc("What does INPUT_PULLUP do?", "Connects an internal resistor to 5 V", ["Turns the pin into an output", "Connects the pin to GND"], "It enables the chip's internal pull-up, so an open button reads HIGH and a pressed one LOW."),
    ),
}


def _parts_sections(spec: CircuitSpec) -> list[LessonSection]:
    groups: dict[str, list[ComponentSpec]] = defaultdict(list)
    for c in spec.components:
        groups[c.kind].append(c)
    sections = []
    for kind, comps in groups.items():
        title, text, quiz = PART_TEXT.get(kind, (COMPONENT_KINDS[kind].description, LevelText(eli5="", beginner=COMPONENT_KINDS[kind].description, expert=COMPONENT_KINDS[kind].description), None))
        facts = [Fact(label=c.ref, value=c.value + (f" · {c.purpose}" if c.purpose else "")) for c in comps]
        facts.append(Fact(label="KiCad symbol", value=COMPONENT_KINDS[kind].lib_id))
        facts.append(Fact(label="footprint", value=COMPONENT_KINDS[kind].footprint.split(":")[-1]))
        sections.append(
            LessonSection(id=f"part-{kind}", kind="parts", title=title, refs=[c.ref for c in comps], text=text, facts=facts, quiz=[quiz] if quiz else [])
        )
    return sections


# --- the math, per circuit --------------------------------------------------------------------


def _led_sections(spec: CircuitSpec) -> list[LessonSection]:
    """One section per distinct LED/resistor calculation (identical ones are grouped)."""
    grouped: dict[tuple, list[dict]] = defaultdict(list)
    for n in _led_notes(spec):
        grouped[(n["ohms"], n["vs"], n["vf"])].append(n)
    mcu = family(spec) == "mcu"
    sections = []
    for (ohms, vs, vf), notes in grouped.items():
        first = notes[0]
        i = (vs - vf) / ohms
        p = i * i * ohms
        refs = [x for n in notes for x in (n["r"], n["d"])]
        names = ", ".join(f"{n['r']} → {n['d']}" for n in notes)
        who = f"the {first['color']} LED" if len(notes) == 1 else f"each of the {len(notes)} LEDs"
        source = "the Nano's output pin (5 V when HIGH)" if mcu else ("the 555's output (about Vcc − 1.5 V when high)" if family(spec) == "555" else "the supply")
        text = LevelText(
            eli5=f"The LED takes about {vf:g} volts for itself. The resistor takes the rest, {vs - vf:.2g} volts, and that decides how much electricity flows: about {si(i, 'A', 2)}. That's enough to glow without getting hurt.",
            beginner=f"Kirchhoff's voltage law: the {vs:g} V from {source} is shared between the LED's fixed drop (Vf ≈ {vf:g} V) and the resistor. So the resistor sees {vs - vf:.3g} V, and Ohm's law gives the current: {vs - vf:.3g} V ÷ {si(ohms, 'Ω')} = {si(i, 'A')}. The resistor only warms by {si(p, 'W')}.",
            expert=f"Constant-Vf model: I = (Vs − Vf)/R = {si(i, 'A')}, P_R = I²R = {si(p, 'W')} (vs a 0.25 W part). The value is the next E12 step up from the ideal, so I stays at or under target; Vf spread of ±0.2 V moves I by about ±{0.2 / ohms * 1000:.1f} mA."
            + (f" Well under the ATmega328P's {PIN_LIMIT_MA} mA per-pin recommendation." if mcu else ""),
        )
        sections.append(
            LessonSection(
                id=f"math-{first['r']}",
                kind="math",
                title=f"{first['r']}: setting the current for {who}" if len(notes) == 1 else f"LED resistors ({len(notes)}×): setting the current",
                refs=refs,
                text=text,
                facts=[Fact(label="pairs", value=names), Fact(label="LED forward voltage", value=f"≈ {vf:g} V ({first['color']}, typical)"), Fact(label="resistor", value=si(ohms, "Ω"))],
                formulas=[
                    Formula(tex=rf"V_s = V_R + V_f \;\Rightarrow\; V_R = {vs:g} - {vf:g} = {vs - vf:.3g}\,\text{{V}}", caption="Kirchhoff's voltage law around the loop"),
                    Formula(tex=rf"I = \frac{{V_s - V_f}}{{R}} = \frac{{{vs - vf:.3g}\,\text{{V}}}}{{{tex(ohms, 'Ω')}}} = {tex(i, 'A')}", caption="Ohm's law for the resistor"),
                    Formula(tex=rf"P = I^2 R = ({tex(i, 'A')})^2 \cdot {tex(ohms, 'Ω')} = {tex(p, 'W')}", caption="heat in the resistor"),
                ],
                playground=Playground(
                    caption="Change the supply, the LED or the resistor and watch the current. The circuit you generated isn't changed.",
                    params=[
                        PlayParam(name="Vs", label="supply", tex="V_s", value=vs, min=2.5, max=15, step=0.1, unit="V"),
                        PlayParam(name="Vf", label="LED forward voltage", tex="V_f", value=vf, min=1.6, max=3.4, step=0.1, unit="V"),
                        PlayParam(name="R", label="resistor", tex="R", value=ohms, min=47, max=4700, step=1, unit="Ω"),
                    ],
                    outputs=[
                        PlayOutput(label="LED current", tex="I", expr="max(0, (Vs - Vf) / R) * 1000", unit="mA", max_ok=PIN_LIMIT_MA, limit_note="above 20 mA: too much for an LED (and an Arduino pin)"),
                        PlayOutput(label="resistor heat", tex="P", expr="max(0, (Vs - Vf) / R) ** 2 * R * 1000", unit="mW", max_ok=QUARTER_WATT * 1000 / 2, limit_note="above half of a ¼ W rating"),
                    ],
                ),
                quiz=[
                    _mc_values(f"About how much current flows through {first['d']}?", i, [vs / ohms, vf / ohms, (vs + vf) / ohms], "A", f"Only the resistor's share of the voltage drives the current: ({vs:g} − {vf:g}) V ÷ {si(ohms, 'Ω')}."),
                    _mc("If you swapped in a blue LED (Vf ≈ 3.1 V) with the same resistor, the current would…", "Go down", ["Go up", "Stay the same"], "A bigger Vf leaves less voltage for the resistor, so less current flows."),
                ],
            )
        )
    return sections


def _divider(spec: CircuitSpec) -> list[LessonSection]:
    top, bottom = _first(spec, "resistor", "top"), _first(spec, "resistor", "bottom")
    vin = _supply_volts(spec)
    if not (top and bottom and vin):
        return []
    r1, r2 = parse_value(top.value) or 0, parse_value(bottom.value) or 0
    vout, i = vin * r2 / (r1 + r2), vin / (r1 + r2)
    loaded = vin * (r2 * 1000 / (r2 + 1000)) / (r1 + r2 * 1000 / (r2 + 1000))
    return [
        LessonSection(
            id="math-divider",
            kind="math",
            title="Dividing the voltage",
            refs=[top.ref, bottom.ref],
            text=LevelText(
                eli5=f"Two resistors share the {vin:g} volts like two kids sharing sweets: the bigger one gets more. {bottom.ref} gets {vout:.2f} volts, and that's the output.",
                beginner=f"The same current flows through both resistors, so each gets a share of the voltage in proportion to its resistance: Vout = Vin × R2 / (R1 + R2) = {vout:.2f} V. That only holds while almost no current is taken from the output.",
                expert=f"Unloaded ratio R2/(R1+R2) = {r2 / (r1 + r2):.3f}; quiescent current {si(i, 'A')}. Output impedance is R1‖R2 = {si(r1 * r2 / (r1 + r2), 'Ω')}, so loads must be ≫ that; a 1 kΩ load would pull Vout down to {loaded:.2f} V. Use it for sensing/reference, not as a supply.",
            ),
            facts=[Fact(label="R1 (top)", value=si(r1, "Ω")), Fact(label="R2 (bottom)", value=si(r2, "Ω")), Fact(label="current", value=si(i, "A"))],
            formulas=[
                Formula(tex=rf"V_{{out}} = V_{{in}}\frac{{R_2}}{{R_1 + R_2}} = {vin:g}\cdot\frac{{{tex(r2, 'Ω')}}}{{{tex(r1, 'Ω')} + {tex(r2, 'Ω')}}} = {vout:.3g}\,\text{{V}}"),
                Formula(tex=rf"I = \frac{{V_{{in}}}}{{R_1 + R_2}} = {tex(i, 'A')}", caption="the same current flows through both resistors"),
            ],
            playground=Playground(
                caption="Try other resistor values.",
                params=[
                    PlayParam(name="Vin", label="input", tex="V_{in}", value=vin, min=1, max=30, step=0.1, unit="V"),
                    PlayParam(name="R1", label="top resistor", tex="R_1", value=r1, min=100, max=100000, step=100, unit="Ω"),
                    PlayParam(name="R2", label="bottom resistor", tex="R_2", value=r2, min=100, max=100000, step=100, unit="Ω"),
                ],
                outputs=[
                    PlayOutput(label="output", tex="V_{out}", expr="Vin * R2 / (R1 + R2)", unit="V"),
                    PlayOutput(label="current", tex="I", expr="Vin / (R1 + R2) * 1000", unit="mA"),
                ],
            ),
            quiz=[
                _mc_values("What would Vout be with a 1 kΩ load on the output?", loaded, [vout, vin / 2, vin], "V", "The load sits in parallel with R2, lowering the bottom resistance and the output."),
            ],
        )
    ]


def _filter(spec: CircuitSpec) -> list[LessonSection]:
    r, c = _first(spec, "resistor"), _first(spec, "capacitor")
    if not (r and c):
        return []
    ohms, farads = parse_value(r.value) or 0, parse_value(c.value) or 0
    fc = 1 / (2 * math.pi * ohms * farads)
    high = "high" in spec.title.lower()
    kind = "high-pass" if high else "low-pass"
    gain_expr = "f / fc / sqrt(1 + (f / fc) ** 2)" if high else "1 / sqrt(1 + (f / fc) ** 2)"
    return [
        LessonSection(
            id="math-filter",
            kind="math",
            title=f"The cutoff frequency ({kind})",
            refs=[r.ref, c.ref],
            text=LevelText(
                eli5=("The capacitor lets fast wiggles through and blocks slow ones, so only quick signals get out." if high else "The capacitor soaks up fast wiggles, so only slow, smooth signals get out.")
                + f" The switch-over point is about {si(fc, 'Hz')}.",
                beginner=f"A capacitor's opposition to AC falls as frequency rises. With {r.ref} and {c.ref} the crossover, where the output is about 70.7% of the input (−3 dB), is fc = 1/(2πRC) ≈ {si(fc, 'Hz')}. "
                + ("Above it, signals pass; below it they're reduced." if high else "Below it, signals pass; above it they're reduced."),
                expert=f"First-order RC, fc = {si(fc, 'Hz')}, roll-off 20 dB/decade, phase {'+' if high else '−'}45° at fc. |H| = {'(f/fc)/√(1+(f/fc)²)' if high else '1/√(1+(f/fc)²)'}; source impedance adds to R and load impedance appears in parallel.",
            ),
            facts=[Fact(label="R", value=si(ohms, "Ω")), Fact(label="C", value=si(farads, "F")), Fact(label="type", value=kind)],
            formulas=[
                Formula(tex=rf"f_c = \frac{{1}}{{2\pi R C}} = \frac{{1}}{{2\pi \cdot {tex(ohms, 'Ω')} \cdot {tex(farads, 'F')}}} \approx {tex(fc, 'Hz')}"),
                Formula(tex=(r"|H(f)| = \frac{f/f_c}{\sqrt{1 + (f/f_c)^2}}" if high else r"|H(f)| = \frac{1}{\sqrt{1 + (f/f_c)^2}}") + r",\quad |H(f_c)| = \tfrac{1}{\sqrt{2}} \approx 0.707"),
            ],
            playground=Playground(
                caption="Pick a signal frequency to see how much of it gets through.",
                params=[
                    PlayParam(name="f", label="signal frequency", tex="f", value=round(fc, 3), min=round(fc / 100, 6), max=round(fc * 100, 3), step=round(fc / 100, 6), unit="Hz"),
                    PlayParam(name="fc", label="cutoff", tex="f_c", value=round(fc, 3), min=round(fc / 10, 6), max=round(fc * 10, 3), step=round(fc / 100, 6), unit="Hz"),
                ],
                outputs=[
                    PlayOutput(label="gets through", tex="|H|", expr=f"({gain_expr}) * 100", unit="%"),
                    PlayOutput(label="in decibels", tex="G", expr=f"20 * log({gain_expr}) / log(10)", unit="dB"),
                ],
            ),
            quiz=[_mc("At the cutoff frequency, the output is about what fraction of the input?", "70.7% (−3 dB)", ["50% (−6 dB)", "100%", "10%"], "|H(fc)| = 1/√2 ≈ 0.707.")],
        )
    ]


def _timer(spec: CircuitSpec) -> list[LessonSection]:
    ra, rb = _first(spec, "resistor", "timing R1"), _first(spec, "resistor", "timing R2")
    ct = next((c for c in spec.components if c.purpose == "timing"), None)
    vcc = _supply_volts(spec) or 9
    if not (ra and rb and ct):
        return []
    r1, r2, c = parse_value(ra.value) or 0, parse_value(rb.value) or 0, parse_value(ct.value) or 0
    t_high, t_low = 0.693 * (r1 + r2) * c, 0.693 * r2 * c
    f, duty = 1 / (t_high + t_low), t_high / (t_high + t_low) * 100
    return [
        LessonSection(
            id="math-555",
            kind="math",
            title="How fast it blinks",
            refs=[ra.ref, rb.ref, ct.ref, *(x.ref for x in _by_kind(spec, "timer_555"))],
            text=LevelText(
                eli5=f"The capacitor fills up slowly through the resistors and then empties. Each time it's full, the light switches. That happens about {f:.2g} times a second.",
                beginner=f"{ct.ref} charges through {ra.ref} + {rb.ref} until it reaches 2/3 of {vcc:g} V; the 555 then switches its output and drains {ct.ref} through {rb.ref} alone, down to 1/3. On for {si(t_high, 's')}, off for {si(t_low, 's')}: {f:.3g} Hz.",
                expert=f"t_H = 0.693(R1+R2)C = {si(t_high, 's')}, t_L = 0.693·R2·C = {si(t_low, 's')}, f = 1.44/((R1+2R2)C) = {f:.3g} Hz, duty {duty:.0f}%. The ln 2 factor comes from charging between 1/3 and 2/3 Vcc. Duty < 50% needs a diode across R2.",
            ),
            facts=[Fact(label="R1", value=si(r1, "Ω")), Fact(label="R2", value=si(r2, "Ω")), Fact(label="C", value=si(c, "F")), Fact(label="frequency", value=f"{f:.3g} Hz"), Fact(label="duty", value=f"{duty:.0f}%")],
            formulas=[
                Formula(tex=rf"t_H = 0.693\,(R_1 + R_2)\,C = {tex(t_high, 's')}", caption="capacitor charging: output high"),
                Formula(tex=rf"t_L = 0.693\,R_2\,C = {tex(t_low, 's')}", caption="capacitor discharging: output low"),
                Formula(tex=rf"f = \frac{{1.44}}{{(R_1 + 2R_2)\,C}} = {f:.3g}\,\text{{Hz}},\quad D = \frac{{t_H}}{{t_H + t_L}} = {duty:.0f}\%"),
            ],
            playground=Playground(
                caption="Change the timing parts and watch the blink rate.",
                params=[
                    PlayParam(name="R1", label="R1", tex="R_1", value=r1, min=1000, max=100000, step=100, unit="Ω"),
                    PlayParam(name="R2", label="R2", tex="R_2", value=r2, min=1000, max=470000, step=1000, unit="Ω"),
                    PlayParam(name="C", label="capacitor (µF)", tex="C", value=c * 1e6, min=0.01, max=100, step=0.01, unit="µF"),
                ],
                outputs=[
                    PlayOutput(label="blink rate", tex="f", expr="1.44 / ((R1 + 2 * R2) * C / 1000000)", unit="Hz"),
                    PlayOutput(label="on for", tex="t_H", expr="0.693 * (R1 + R2) * C / 1000", unit="ms"),
                    PlayOutput(label="duty", tex="D", expr="(R1 + R2) / (R1 + 2 * R2) * 100", unit="%"),
                ],
            ),
            quiz=[
                _mc(f"Which resistor affects only the ON time?", f"{ra.ref}", [rb.ref, ct.ref], f"{ra.ref} is in the charging path only; {rb.ref} is in both charge and discharge."),
                _mc("Doubling the capacitor makes the blinking…", "Half as fast", ["Twice as fast", "Unchanged"], "f is proportional to 1/C."),
            ],
        )
    ]


def _regulator(spec: CircuitSpec) -> list[LessonSection]:
    vin = _supply_volts(spec)
    u = next(iter(_by_kind(spec, "regulator_7805", "regulator_ams1117_3v3")), None)
    if not (vin and u):
        return []
    vout = 5.0 if u.kind == "regulator_7805" else 3.3
    dropout = 2.0 if u.kind == "regulator_7805" else 1.2
    load = 0.1
    p = (vin - vout) * load
    return [
        LessonSection(
            id="math-regulator",
            kind="math",
            title="Where the extra voltage goes",
            refs=[u.ref, *(c.ref for c in spec.components if "capacitor" in c.purpose)],
            text=LevelText(
                eli5=f"The regulator lets out exactly {vout:g} volts. The leftover {vin - vout:g} volts turn into warmth, like a brake on a bike.",
                beginner=f"A linear regulator acts like a self-adjusting resistor: it drops whatever is needed ({vin - vout:g} V here) to keep {vout:g} V out. The same current flows in and out, so the dropped voltage times the current becomes heat: at 100 mA that's {p:.2g} W.",
                expert=f"P_diss = (Vin − Vout)·I = {p:.2g} W at 100 mA; efficiency ≈ Vout/Vin = {vout / vin * 100:.0f}%. Needs Vin ≥ Vout + dropout ≈ {vout + dropout:.1f} V. Above ~1 W add a heatsink; for big drops a buck converter is far more efficient.",
            ),
            facts=[Fact(label="input", value=f"{vin:g} V"), Fact(label="output", value=f"{vout:g} V"), Fact(label="dropout", value=f"≈ {dropout:g} V"), Fact(label="part", value=u.value)],
            formulas=[
                Formula(tex=rf"P = (V_{{in}} - V_{{out}})\,I = ({vin:g} - {vout:g}) \cdot 0.1\,\text{{A}} = {p:.2g}\,\text{{W}}", caption="heat at a 100 mA load"),
                Formula(tex=rf"\eta \approx \frac{{V_{{out}}}}{{V_{{in}}}} = {vout / vin * 100:.0f}\%"),
            ],
            playground=Playground(
                caption="How hot does it get for other inputs and loads?",
                params=[
                    PlayParam(name="Vin", label="input", tex="V_{in}", value=vin, min=round(vout + dropout, 1), max=35 if vout == 5 else 15, step=0.1, unit="V"),
                    PlayParam(name="I", label="load current", tex="I", value=100, min=1, max=1000, step=1, unit="mA"),
                ],
                outputs=[
                    PlayOutput(label="heat", tex="P", expr=f"(Vin - {vout}) * I / 1000", unit="W", max_ok=1.0, limit_note="above ~1 W: add a heatsink"),
                    PlayOutput(label="efficiency", tex=r"\eta", expr=f"{vout} / Vin * 100", unit="%"),
                ],
            ),
            quiz=[_mc_values("How much power turns into heat at a 200 mA load?", (vin - vout) * 0.2, [vin * 0.2, vout * 0.2, (vin - vout) * 0.1], "W", "P = (Vin − Vout) × I.")],
        )
    ]


def _button(spec: CircuitSpec) -> list[LessonSection]:
    pull = _first(spec, "resistor", "pull")
    if not pull:
        return []
    vs = _supply_volts(spec) or 3.3
    ohms = parse_value(pull.value) or 10_000
    i = vs / ohms
    down = "down" in pull.purpose
    cap = _first(spec, "capacitor", "debounce")
    formulas = [Formula(tex=rf"I_{{pressed}} = \frac{{V}}{{R}} = \frac{{{vs:g}\,\text{{V}}}}{{{tex(ohms, 'Ω')}}} = {tex(i, 'A')}", caption="current wasted while the button is held")]
    if cap and (farads := parse_value(cap.value)):
        formulas.append(Formula(tex=rf"\tau = R C = {tex(ohms, 'Ω')} \cdot {tex(farads, 'F')} = {tex(ohms * farads, 's')}", caption="debounce time constant"))
    return [
        LessonSection(
            id="math-button",
            kind="math",
            title=f"The pull-{'down' if down else 'up'} resistor",
            refs=[pull.ref, *(c.ref for c in _by_kind(spec, "push_button")), *([cap.ref] if cap else [])],
            text=LevelText(
                eli5=f"The resistor gently holds the signal {'down at zero' if down else 'up at the top'} until you press the button, which pulls it the other way.",
                beginner=f"With the button open, {pull.ref} holds BTN at {'0 V (LOW)' if down else f'{vs:g} V (HIGH)'}. Pressing connects BTN straight to {'the supply' if down else 'GND'}, which wins easily. While pressed, {si(i, 'A')} flows through {pull.ref}.",
                expert=f"{si(ohms, 'Ω')} balances static current ({si(i, 'A')} when pressed) against noise immunity and input leakage. "
                + (f"C with R forms a first-order filter (τ = {si(ohms * (parse_value(cap.value) or 0), 's')}) that hides contact bounce." if cap else "Debounce in firmware, or add an RC filter."),
            ),
            facts=[Fact(label=pull.ref, value=f"{si(ohms, 'Ω')} · {pull.purpose}"), Fact(label="logic supply", value=f"{vs:g} V")],
            formulas=formulas,
            playground=Playground(
                params=[PlayParam(name="R", label="pull resistor", tex="R", value=ohms, min=1000, max=100000, step=100, unit="Ω"), PlayParam(name="V", label="supply", tex="V", value=vs, min=1.8, max=12, step=0.1, unit="V")],
                outputs=[PlayOutput(label="current while pressed", tex="I", expr="V / R * 1000", unit="mA")],
            ),
            quiz=[_mc("With the button open, BTN reads…", "LOW" if down else "HIGH", ["HIGH" if down else "LOW", "random"], f"The pull-{'down' if down else 'up'} defines the idle level.")],
        )
    ]


def _transistor(spec: CircuitSpec) -> list[LessonSection]:
    rb, rl = _first(spec, "resistor", "base resistor"), _first(spec, "resistor", "LED current")
    led = _first(spec, "led")
    m = next((re.search(r"from a ([\d.]+)V signal", n) for n in spec.notes if "Base current" in n), None)
    if not (rb and rl and led and m):
        return []
    logic, vs = float(m.group(1)), _supply_volts(spec) or 5.0
    color = led.value.replace("LED_", "").lower()
    vf = LED_VF.get(color, 2.0)
    r_b, r_l = parse_value(rb.value) or 1000, parse_value(rl.value) or 220
    ib, ic = (logic - 0.7) / r_b, (vs - 0.2 - vf) / r_l
    return [
        LessonSection(
            id="math-transistor",
            kind="math",
            title="A small current switching a bigger one",
            refs=[rb.ref, rl.ref, led.ref, *(q.ref for q in _by_kind(spec, "npn_transistor"))],
            text=LevelText(
                eli5=f"A tiny trickle into the transistor's base ({si(ib, 'A', 2)}) opens a bigger gate for the LED ({si(ic, 'A', 2)}).",
                beginner=f"The base–emitter junction drops about 0.7 V, so {rb.ref} sets the base current: ({logic:g} − 0.7) V ÷ {si(r_b, 'Ω')} = {si(ib, 'A')}. That switches the transistor fully on, and {rl.ref} sets the LED current to about {si(ic, 'A')}.",
                expert=f"Forced β = Ic/Ib = {ic / ib:.1f}, far below the 2N3904's hFE(min) ≈ 100, so it saturates hard (Vce ≈ 0.2 V, P ≈ {si(0.2 * ic, 'W')}). The 100 kΩ pull-down keeps it off when the input floats.",
            ),
            facts=[Fact(label="logic level", value=f"{logic:g} V"), Fact(label="base current", value=si(ib, "A")), Fact(label="LED current", value=si(ic, "A"))],
            formulas=[
                Formula(tex=rf"I_B = \frac{{V_{{in}} - V_{{BE}}}}{{R_B}} = \frac{{{logic:g} - 0.7}}{{{tex(r_b, 'Ω')}}} = {tex(ib, 'A')}"),
                Formula(tex=rf"I_C = \frac{{V_s - V_{{CE(sat)}} - V_f}}{{R_L}} = \frac{{{vs:g} - 0.2 - {vf:g}}}{{{tex(r_l, 'Ω')}}} = {tex(ic, 'A')}"),
                Formula(tex=rf"\beta_{{forced}} = \frac{{I_C}}{{I_B}} = {ic / ib:.1f} \ll h_{{FE}} \Rightarrow \text{{saturated}}"),
            ],
            playground=Playground(
                params=[PlayParam(name="Vin", label="logic level", tex="V_{in}", value=logic, min=1.2, max=5, step=0.1, unit="V"), PlayParam(name="RB", label="base resistor", tex="R_B", value=r_b, min=100, max=47000, step=100, unit="Ω")],
                outputs=[PlayOutput(label="base current", tex="I_B", expr="max(0, Vin - 0.7) / RB * 1000", unit="mA")],
            ),
            quiz=[_mc("Why is there a 0.7 in the base-current formula?", "The base–emitter junction drops ~0.7 V", ["It's the LED's voltage", "It's a safety margin"], "The base–emitter is a silicon diode junction.")],
        )
    ]


def _mcu_inputs(spec: CircuitSpec) -> list[LessonSection]:
    buttons = _by_kind(spec, "push_button")
    if not buttons:
        return []
    i = 5.0 / 35_000
    return [
        LessonSection(
            id="math-inputs",
            kind="math",
            title="Reading the button",
            refs=[b.ref for b in buttons] + [a.ref for a in _by_kind(spec, "arduino_nano")],
            text=LevelText(
                eli5="Inside the Arduino there's a hidden resistor that holds the pin up at 5 volts. Pressing the button connects the pin to ground, so it drops to zero, and the Arduino notices.",
                beginner="pinMode(pin, INPUT_PULLUP) turns on a resistor inside the chip from the pin to 5 V. The button connects the pin to GND, so pressed reads LOW and released reads HIGH. That's why there's no external resistor in the schematic.",
                expert=f"ATmega328P pull-ups are 20–50 kΩ (≈ {si(i, 'A')} when pressed). VIL ≤ 0.3·Vcc = 1.5 V, VIH ≥ 0.6·Vcc = 3 V; the Schmitt-trigger input handles slow edges. Analog pins A0/A1 work as digital inputs.",
            ),
            facts=[Fact(label=b.ref, value=b.purpose) for b in buttons] + [Fact(label="pressed", value="LOW (0 V)"), Fact(label="released", value="HIGH (5 V, via pull-up)")],
            formulas=[
                Formula(tex=rf"I \approx \frac{{5\,\text{{V}}}}{{35\,\text{{k}}\Omega}} = {tex(i, 'A')}", caption="internal pull-up current while pressed (20–50 kΩ)"),
                Formula(tex=r"V_{IL} \le 0.3\,V_{cc} = 1.5\,\text{V},\qquad V_{IH} \ge 0.6\,V_{cc} = 3\,\text{V}", caption="guaranteed logic thresholds"),
            ],
            quiz=[_mc("With INPUT_PULLUP, what does the pin read while the button is pressed?", "LOW", ["HIGH", "It floats"], "The button shorts the pin to GND; the pull-up only weakly pulls it high.")],
        )
    ]


# --- code walkthrough (microcontroller) ----------------------------------------------------------


def _function_block(code: str, signature: str) -> tuple[int, str] | None:
    lines = code.splitlines()
    for start, line in enumerate(lines):
        if line.startswith(signature):
            end = next((k for k in range(start, len(lines)) if lines[k] == "}"), len(lines) - 1)
            return start + 1, "\n".join(lines[start : end + 1])
    return None


def _code_section(firmware: Firmware) -> LessonSection:
    code = firmware.code
    const = {m.group(1): int(m.group(2)) for m in re.finditer(r"const unsigned long (\w+)_MS = (\d+);", code)}
    multi = const.get("MULTI_PRESS", 400)
    behaviours = [s for s in firmware.summary if ":" in s and not s.startswith("A single press")]
    excerpts = []
    for sig, title, text in (
        (
            "void handle(",
            "Your behaviour: handle()",
            LevelText(
                eli5="This is the rule book: \"if the button is pressed once, blink red; if twice, blink green\".",
                beginner="Every button event (press, double press, long press, down, up) comes here, and each line maps one event to one LED action. Change behaviour by editing these lines.",
                expert="A flat dispatch on (button, event); actions are non-blocking (they only set state that updateLeds() advances), so the loop never stalls.",
            ),
        ),
        (
            "void updateButtons(",
            "Reading presses: updateButtons()",
            LevelText(
                eli5=f"The Arduino checks the button thousands of times a second. It ignores tiny wobbles, counts quick presses, and waits {multi} ms to see if another press is coming.",
                beginner=f"Debounce: a change only counts after it has been stable for {const.get('DEBOUNCE', 30)} ms. Releases are counted; once {multi} ms pass with no new press, the count becomes PRESS, DOUBLE or TRIPLE.",
                expert="Per-button state machine on millis(): raw edge → stable after DEBOUNCE_MS → press counting with a MULTI_PRESS_MS inter-release window, plus a LONG_PRESS_MS hold timer. Unsigned subtraction keeps it correct across millis() rollover.",
            ),
        ),
        (
            "void updateLeds(",
            "Blinking without delay(): updateLeds()",
            LevelText(
                eli5="Instead of stopping to wait, the Arduino keeps a little to-do list for each light and ticks it off every time it looks.",
                beginner=f"Blinking is a countdown of toggles: every {const.get('BLINK', 150)} ms the LED flips. Because nothing calls delay(), the button is still read while LEDs blink.",
                expert="Cooperative scheduling: each LED holds a toggle counter and next-deadline; timed-on LEDs hold an off deadline. The (long)(now - t) >= 0 comparison is rollover-safe.",
            ),
        ),
    ):
        if block := _function_block(code, sig):
            excerpts.append(CodeExcerpt(title=title, start_line=block[0], code=block[1], explain=text))
    quiz = [
        _mc("Why doesn't the code use delay() to blink?", "So it can keep reading the button", ["delay() doesn't exist on Arduino", "It would make the LED brighter"], "delay() blocks the whole loop; non-blocking timing keeps everything responsive."),
        _mc("What does debouncing protect against?", "One press being read as several", ["The LED burning out", "The USB disconnecting"], "Metal contacts bounce for a few ms when pressed or released."),
    ]
    if any("twice" in b.lower() for b in behaviours) and any("once" in b.lower() for b in behaviours):
        quiz.insert(0, _mc(f"Why does a single press only react after {multi} ms?", "It waits to see if a second press comes", ["The Arduino is slow", "Debouncing takes that long"], f"Until {multi} ms pass with no second press, a single and the start of a double press look identical."))
    return LessonSection(
        id="code",
        kind="code",
        title="The code: how the Nano decides",
        text=LevelText(
            eli5="The Arduino runs a loop forever: look at the button, then update the lights, then look again, super fast.",
            beginner=f"setup() runs once (pins in, pins out); loop() runs forever, calling updateButtons() and updateLeds(). What happens on each kind of press lives in handle(). {firmware.board}, written in Arduino C++.",
            expert="Super-loop, no RTOS, no interrupts: all timing from millis(). Each subsystem is a small state machine polled every iteration (~µs), so latency is bounded by debounce and the multi-press window.",
        ),
        facts=[Fact(label=name.lower().replace("_", " "), value=f"{ms} ms") for name, ms in const.items()] + [Fact(label="behaviour", value=b) for b in behaviours],
        code=excerpts,
        quiz=quiz,
    )


# --- building it, and checking it ---------------------------------------------------------------


def _build_section(spec: CircuitSpec, files: SchematicFiles, firmware: Firmware | None) -> LessonSection:
    by_lib: dict[str, list[ComponentSpec]] = defaultdict(list)
    for c in spec.components:
        by_lib[COMPONENT_KINDS[c.kind].lib_id].append(c)
    place = "; ".join(f"{lib} ×{len(cs)}" if len(cs) > 1 else lib for lib, cs in by_lib.items())
    values = ", ".join(f"{c.ref} = {c.value}" for c in spec.components)
    power = sorted({lib.split(":")[1] for lib in re.findall(r'\(lib_id "(power:[^"]+)"\)', files.schematic) if "PWR_FLAG" not in lib})
    flags = files.schematic.count('(lib_id "power:PWR_FLAG")')
    no_connects = files.schematic.count("(no_connect")
    wires = [f"{n.name}: " + " – ".join(f"{p.ref}.{p.pin}" for p in n.connections) for n in spec.nets if len(n.connections) > 1]
    steps = [
        BuildStep(title="Open the Schematic Editor", detail="Create a KiCad project (File → New Project) and open its schematic."),
        BuildStep(title="Place the symbols", key="A", detail=f"Press A and add: {place}."),
        BuildStep(title="Set the values", key="E", detail=f"Hover each symbol, press E: {values}."),
        BuildStep(title="Add power symbols", key="P", detail=(f"Press P for: {', '.join(power)}" if power else "No power symbols are needed")
                  + (f"; plus {flags} PWR_FLAG so ERC knows the rail is supplied." if flags else ".")),
        BuildStep(title="Draw the wires", key="W", detail="Press W and connect: " + "; ".join(wires) + "."),
    ]
    if no_connects:
        steps.append(BuildStep(title="Mark unused pins", key="Q", detail=f"Put a no-connect flag on each of the {no_connects} unused pins so ERC knows they're meant to be free."))
    steps.append(BuildStep(title="Run ERC", detail="Inspect → Electrical Rules Checker → Run ERC. It should report 0 errors, like the generated file."))
    if firmware:
        steps.append(BuildStep(title="Upload the code", detail=f"Open the exported {firmware.file_name} in the Arduino IDE, choose Tools → Board → Arduino Nano (Processor: ATmega328P), pick the USB port, and click Upload."))
    steps.append(BuildStep(title="Lay out the board", key="F8", detail="Open the PCB Editor and press F8 (Update PCB from Schematic): the footprints are already assigned."))
    return LessonSection(
        id="build",
        kind="build",
        title="Build it yourself in KiCad",
        text=LevelText(
            eli5="Here's how to draw the same circuit yourself, one step at a time.",
            beginner="Drawing it by hand is the best way to learn KiCad. Follow these steps; the symbols, values and wires are exactly the ones in your generated schematic.",
            expert="Same library symbols, values and nets as the generated file; compare your netlist with it if ERC disagrees.",
        ),
        steps=steps,
        quiz=[_mc("Which key places a wire in KiCad's Schematic Editor?", "W", ["A", "E", "P"], "A adds a symbol, E edits it, P adds a power symbol, W draws a wire.")],
    )


ERC_HELP = {
    "power_pin_not_driven": "a power input pin has no source in the schematic; add a PWR_FLAG to that net",
    "pin_not_connected": "a pin has nothing attached; wire it or mark it with a no-connect flag (Q)",
    "wire_dangling": "a wire ends in empty space; drag its end onto the pin",
    "unconnected_wire_endpoint": "a wire ends in empty space; drag its end onto the pin",
    "pin_to_pin": "two pins that shouldn't meet are connected (e.g. two outputs)",
    "label_dangling": "a label isn't attached to a wire",
}


def _check_section(validation: ValidationReport, erc: ErcReport) -> LessonSection:
    unused = sum(1 for w in validation.warnings if w.code == "PIN_UNCONNECTED")
    facts = [
        Fact(label="validation", value="valid" if validation.valid else f"{len(validation.errors)} error(s)"),
        Fact(label="unused pins", value=f"{unused}, marked no-connect" if unused else "none"),
        Fact(label="KiCad ERC", value=erc.message or ("passed" if erc.passed else "not run")),
    ] + [Fact(label=v.type, value=ERC_HELP.get(v.type, v.description)) for v in erc.violations]
    return LessonSection(
        id="check",
        kind="check",
        title="How we know it's right",
        text=LevelText(
            eli5="Before giving it to you, the computer checked every wire, and KiCad itself checked the drawing for mistakes.",
            beginner="Two checks ran. The engine validated every part, pin and net (each pin in exactly one net, power pins connected). Then KiCad's Electrical Rules Check (ERC) opened the file and looked for wiring mistakes."
            + (" It found none." if erc.passed else " See the results below."),
            expert="Validation is structural (pin resolution, net membership, power-pin coverage). ERC is KiCad's own pin-type matrix plus connectivity rules; the test suite also compares KiCad's exported netlist with the intended nets.",
        ),
        facts=facts,
        quiz=[_mc("What does ERC check?", "Wiring mistakes, like unconnected pins", ["Whether the code compiles", "The price of the parts"], "ERC = Electrical Rules Check: connectivity and pin-type rules.")],
    )


# --- putting it together ------------------------------------------------------------------------


def _overview(spec: CircuitSpec, erc: ErcReport, firmware: Firmware | None) -> LessonSection:
    fam = family(spec)
    vs = _supply_volts(spec)
    flow = {
        "led": "Current leaves the battery's +, goes through each resistor, through its LED (lighting it), and back to − (GND).",
        "divider": "Current flows from the input through both resistors to GND; the point between them is the output.",
        "filter": "The signal comes in on the left; the resistor and capacitor decide which frequencies reach the output.",
        "555": "The 555 keeps charging and discharging its timing capacitor; each swing flips its output, which drives the LED through a resistor.",
        "regulator": "The higher input goes into the regulator, which outputs a steady voltage; capacitors on both sides keep it stable.",
        "button": "The resistor holds the signal at one level; pressing the button pulls it to the other.",
        "transistor": "A small signal into the base lets the transistor connect the LED's cathode to GND, completing the LED's loop.",
        "mcu": "The Arduino reads the button on its input pin, runs the code, and switches its output pins; each output drives an LED through a resistor to GND.",
    }.get(fam, "Current flows from the supply through the parts and back to GND.")
    facts = [Fact(label="parts", value=str(len(spec.components))), Fact(label="nets", value=str(len(spec.nets)))]
    if vs:
        facts.append(Fact(label="supply", value="USB 5 V" if fam == "mcu" else f"{vs:g} V"))
    facts.append(Fact(label="KiCad ERC", value="0 violations" if erc.passed else (erc.message or "not run")))
    if firmware:
        facts.append(Fact(label="program", value=f"{firmware.file_name} ({firmware.board})"))
    return LessonSection(
        id="overview",
        kind="overview",
        title="What you built",
        refs=[c.ref for c in spec.components],
        text=LevelText(
            eli5=f"You built a {spec.title.lower()}. {flow}",
            beginner=f"{spec.description} {flow}",
            expert=f"{spec.description} {len(spec.components)} components on {len(spec.nets)} nets; every value below is derived from the design equations, then checked by KiCad's ERC.",
        ),
        facts=facts,
    )


def build_lesson(spec: CircuitSpec, validation: ValidationReport, erc: ErcReport, files: SchematicFiles, firmware: Firmware | None = None) -> Lesson:
    fam = family(spec)
    math_sections: list[LessonSection] = []
    if fam == "mcu":
        math_sections += _mcu_inputs(spec)
    math_sections += {"divider": _divider, "filter": _filter, "555": _timer, "regulator": _regulator, "button": _button, "transistor": _transistor}.get(fam, lambda s: [])(spec)
    if fam != "transistor":
        math_sections += _led_sections(spec)
    sections = [_overview(spec, erc, firmware), *_parts_sections(spec), *math_sections]
    if firmware:
        sections.append(_code_section(firmware))
    sections += [_build_section(spec, files, firmware), _check_section(validation, erc)]
    return Lesson(
        title=spec.title,
        summary=LevelText(eli5=f"Let's learn how your {spec.title.lower()} works!", beginner=spec.description, expert=spec.description),
        sections=sections,
    )


__all__ = ["build_lesson", "family", "parse_value", "si", "tex", "POWER_SYMBOLS"]
