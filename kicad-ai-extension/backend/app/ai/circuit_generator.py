"""Turn a natural-language prompt into a CircuitSpec.

This is the rule-based interpreter: it recognizes common circuits by keyword,
extracts numbers from the prompt (voltages, currents, frequencies, colors) and
calculates component values with standard formulas. It is deterministic and
needs no network or API key. An LLM-backed interpreter can later implement the
same `generate(prompt) -> CircuitSpec` contract; the validator, renderer and
ERC stay the same.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass

from app.core.component_registry import POWER_SYMBOLS
from app.schemas.circuit import CircuitSpec, ComponentSpec, Layout, NetSpec, PinRef, Placement

E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]
E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
       3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1]
E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8]

# Typical forward voltages (V) for 20 mA indicator LEDs.
LED_VF = {"red": 2.0, "orange": 2.0, "yellow": 2.1, "green": 2.2, "blue": 3.1, "white": 3.1}

SUPPORTED_CIRCUITS = [
    "LED indicator (e.g. 'red LED on 5V at 10mA', '3 LEDs on 12V')",
    "Voltage divider (e.g. 'voltage divider from 12V to 3.3V')",
    "RC low-pass or high-pass filter (e.g. 'low-pass filter at 1kHz')",
    "555 LED blinker (e.g. '555 timer blinking an LED at 2 Hz on 9V')",
    "Linear regulator (e.g. '5V regulator from 12V', '3.3V LDO from 5V with power LED')",
    "Push button with pull-up/pull-down (e.g. 'push button with pull-up on 3.3V')",
    "NPN transistor switch (e.g. 'transistor to switch an LED from a 3.3V GPIO on 5V')",
]


class GenerationError(ValueError):
    """The prompt could not be turned into a supported circuit. Message is user-facing."""


# --- Value helpers -------------------------------------------------------------------


def nearest_e(value: float, series: list[float]) -> float:
    if value <= 0:
        raise ValueError("value must be positive")
    exponent = math.floor(math.log10(value))
    candidates = [m * 10**e for e in (exponent - 1, exponent, exponent + 1) for m in series]
    return min(candidates, key=lambda c: abs(math.log(c / value)))


def next_e_up(value: float, series: list[float]) -> float:
    """Smallest standard value >= value (e.g. LED resistors: never exceed the target current)."""
    exponent = math.floor(math.log10(value))
    candidates = sorted(m * 10**e for e in (exponent, exponent + 1) for m in series)
    return next(c for c in candidates if c >= value * 0.999)


def _trim(number: float) -> str:
    text = f"{number:.3g}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def format_ohms(value: float) -> str:
    if value >= 1e6:
        return _trim(value / 1e6) + "M"
    if value >= 1e3:
        return _trim(value / 1e3) + "k"
    return _trim(value)


def format_farads(value: float) -> str:
    for scale, suffix in ((1e-6, "u"), (1e-9, "n"), (1e-12, "p")):
        if value >= scale * 0.999:
            return _trim(value / scale) + suffix
    return _trim(value / 1e-12) + "p"


def format_volts(value: float) -> str:
    return _trim(value) + "V"


def supply_net(volts: float) -> str:
    """Use a KiCad power symbol for common rails, a plain label otherwise."""
    for name in POWER_SYMBOLS:
        if name.startswith("+") and abs(_rail_volts(name) - volts) < 0.01:
            return name
    return "VIN"


def _rail_volts(name: str) -> float:
    return float(name.lstrip("+").replace("V", ".").rstrip("."))


# --- Prompt parsing ------------------------------------------------------------------


_VOLT_RE = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)\s*(?:v|volts?)(?![a-z0-9])|(?<![\w.])(\d+)v(\d+)(?![\w])", re.I)
_FROM_VOLT_RE = re.compile(r"\bfrom\s+(?:an?\s+|the\s+)?(\d+(?:\.\d+)?)\s*(?:v|volts?)\b|\bfrom\s+(\d+)v(\d+)\b", re.I)
_MA_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(m|milli)?\s*a(?:mps?)?(?![a-z])", re.I)
_HZ_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(k|m)?\s*hz", re.I)
_COUNT_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8}


def voltages(prompt: str) -> list[float]:
    found: list[float] = []
    for match in _VOLT_RE.finditer(prompt):
        if match.group(1):
            found.append(float(match.group(1)))
        else:  # 3v3 style
            found.append(float(f"{match.group(2)}.{match.group(3)}"))
    return found


def from_voltage(prompt: str) -> float | None:
    """The voltage after 'from', e.g. '3.3V from 12V' -> 12.0 (the source/input)."""
    match = _FROM_VOLT_RE.search(prompt)
    if not match:
        return None
    return float(match.group(1)) if match.group(1) else float(f"{match.group(2)}.{match.group(3)}")


def current_amps(prompt: str) -> float | None:
    for match in _MA_RE.finditer(prompt):
        value = float(match.group(1))
        return value / 1000 if match.group(2) else value
    return None


def frequency_hz(prompt: str) -> float | None:
    match = _HZ_RE.search(prompt)
    if not match:
        return None
    scale = {"k": 1e3, "m": 1e6}.get((match.group(2) or "").lower(), 1.0)
    return float(match.group(1)) * scale


def led_count(prompt: str) -> int:
    match = re.search(r"(\d+|one|two|three|four|five|six|seven|eight)\s+(?:\w+\s+)?leds\b", prompt, re.I)
    if not match:
        return 1
    token = match.group(1).lower()
    return _COUNT_WORDS.get(token) or int(token)


def led_color(prompt: str) -> str:
    for color in LED_VF:
        if re.search(rf"\b{color}\b", prompt, re.I):
            return color
    return "red"


def _words(prompt: str, *words: str) -> bool:
    return any(re.search(rf"\b{w}", prompt, re.I) for w in words)


# --- Spec builder --------------------------------------------------------------------


class _Builder:
    """Collects components, nets and drawing hints (grid placements and rail buses)."""

    def __init__(self, title: str, description: str) -> None:
        self.title = title
        self.description = description
        self.components: list[ComponentSpec] = []
        self.nets: dict[str, list[PinRef]] = {}
        self.notes: list[str] = []
        self.placements: dict[str, Placement] = {}
        self.buses: dict[str, int] = {}
        self._counters: dict[str, int] = {}

    def add(self, prefix: str, kind: str, value: str, purpose: str = "") -> str:
        self._counters[prefix] = self._counters.get(prefix, 0) + 1
        ref = f"{prefix}{self._counters[prefix]}"
        self.components.append(ComponentSpec(ref=ref, kind=kind, value=value, purpose=purpose))
        return ref

    def connect(self, net: str, *pins: tuple[str, str]) -> None:
        self.nets.setdefault(net, []).extend(PinRef(ref=r, pin=p) for r, p in pins)

    def place(
        self, ref: str, pin: str, col: int, row: int, direction: str | None = None, mirror: bool = False
    ) -> None:
        """Put `pin` of `ref` on grid cell (col, row). `direction` = where the other pin of a 2-pin part lies."""
        self.placements[ref] = Placement(pin=pin, col=col, row=row, direction=direction, mirror=mirror)

    def bus(self, net: str, row: int) -> None:
        self.buses[net] = row

    def build(self) -> CircuitSpec:
        complete = all(c.ref in self.placements for c in self.components)
        return CircuitSpec(
            title=self.title,
            description=self.description,
            components=self.components,
            nets=[NetSpec(name=name, connections=pins) for name, pins in self.nets.items()],
            notes=self.notes,
            layout=Layout(placements=self.placements, buses=self.buses) if complete else None,
        )


def _led_resistor(vs: float, vf: float, amps: float) -> float:
    if vs <= vf + 0.3:
        raise GenerationError(
            f"A {format_volts(vs)} supply is too low for an LED with ~{format_volts(vf)} forward voltage. "
            "Use a higher supply voltage."
        )
    return next_e_up((vs - vf) / amps, E12)


def _add_led_with_resistor(
    b: _Builder, supply: str, vs: float, color: str, amps: float, ground: str = "GND"
) -> tuple[str, str]:
    """Add R + LED between `supply` and `ground`. Returns (resistor ref, LED ref); the caller places them."""
    vf = LED_VF[color]
    ohms = _led_resistor(vs, vf, amps)
    r = b.add("R", "resistor", format_ohms(ohms), "LED current limiting")
    d = b.add("D", "led", f"LED_{color.capitalize()}", f"{color} indicator")
    node = f"LED{d[1:]}_A"
    b.connect(supply, (r, "1"))
    b.connect(node, (r, "2"), (d, "A"))
    b.connect(ground, (d, "K"))
    actual = (vs - vf) / ohms * 1000
    b.notes.append(f"{r} = {format_ohms(ohms)}: ({format_volts(vs)} - {vf} V) / {actual:.1f} mA for the {color} LED {d}.")
    return r, d


def _add_battery(b: _Builder, volts: float, supply: str, purpose: str = "supply") -> str:
    bt = b.add("BT", "battery", format_volts(volts), purpose)
    b.connect(supply, (bt, "+"))
    b.connect("GND", (bt, "-"))
    return bt


# Pin numbers used for placement (symbol pin numbers, not names).
LED_A, LED_K = "2", "1"


# --- Circuit templates ---------------------------------------------------------------
# Drawing convention: a top rail (supply) at row 0 and a bottom rail (GND) below; parts hang
# from the top rail or stand on the bottom one, so the loop supply -> parts -> back is visible.


def led_indicator(prompt: str) -> CircuitSpec:
    vs = (voltages(prompt) or [5.0])[0]
    amps = current_amps(prompt) or 0.010
    if not 0.001 <= amps <= 0.05:
        raise GenerationError("LED current should be between 1 mA and 50 mA for standard indicator LEDs.")
    count = led_count(prompt)
    if not 1 <= count <= 8:
        raise GenerationError("Choose between 1 and 8 LEDs.")
    color = led_color(prompt)
    supply = supply_net(vs)
    b = _Builder(
        f"{count} LED indicator" if count > 1 else f"{color.capitalize()} LED indicator",
        f"{count} x {color} LED, each with its own resistor, powered from {format_volts(vs)} at {amps * 1000:g} mA.",
    )
    bt = _add_battery(b, vs, supply, f"{format_volts(vs)} supply")
    b.place(bt, "1", 0, 1, "down")
    for k in range(count):
        r, d = _add_led_with_resistor(b, supply, vs, color, amps)
        col = 5 + 6 * k  # wide enough for "LED_Green" value text
        b.place(r, "1", col, 1, "down")
        b.place(d, LED_A, col, 6, "down")
    b.bus(supply, 0)
    b.bus("GND", 10)
    b.notes.append(f"{bt} stands for your {format_volts(vs)} battery or power source.")
    return b.build()


def voltage_divider(prompt: str) -> CircuitSpec:
    found = voltages(prompt)
    if len(found) < 2:
        raise GenerationError("For a voltage divider, give the input and output voltage, e.g. 'from 12V to 3.3V'.")
    source = from_voltage(prompt)
    if source is not None and source in found[:2]:
        vin = source
        vout = next(v for v in found[:2] if v != source) if len(set(found[:2])) > 1 else source
    else:
        vin, vout = found[0], found[1]  # "12V to 3.3V": input first
    if vout <= 0 or vout >= vin:
        raise GenerationError("The output voltage of a divider must be lower than the input voltage.")
    r2 = 10_000.0
    r1 = nearest_e(r2 * (vin / vout - 1), E24)
    actual = vin * r2 / (r1 + r2)
    b = _Builder(
        "Voltage divider",
        f"Divides {format_volts(vin)} down to about {actual:.2f} V (target {format_volts(vout)}).",
    )
    bt = _add_battery(b, vin, "VIN", f"{format_volts(vin)} input")
    j2 = b.add("J", "connector_2pin", "Output", "divider output")
    ra = b.add("R", "resistor", format_ohms(r1), "top resistor")
    rb = b.add("R", "resistor", format_ohms(r2), "bottom resistor")
    b.connect("VIN", (ra, "1"))
    b.connect("VOUT", (ra, "2"), (rb, "1"), (j2, "1"))
    b.connect("GND", (rb, "2"), (j2, "2"))
    b.place(bt, "1", 0, 1, "down")
    b.place(ra, "1", 6, 1, "down")
    b.place(rb, "1", 6, 6, "down")
    b.place(j2, "1", 11, 5)
    b.bus("VIN", 0)
    b.bus("GND", 10)
    b.notes += [
        f"Vout = Vin x {format_ohms(r2)} / ({format_ohms(r1)} + {format_ohms(r2)}) = {actual:.2f} V with E24 values.",
        "Unloaded divider: the load must be much higher impedance than the resistors (not suitable as a power supply).",
    ]
    return b.build()


def rc_filter(prompt: str) -> CircuitSpec:
    high_pass = _words(prompt, "high-pass", "high pass", "highpass", "hpf")
    fc = frequency_hz(prompt) or 1000.0
    if not 0.1 <= fc <= 1e6:
        raise GenerationError("Choose a cutoff frequency between 0.1 Hz and 1 MHz.")
    r = 10_000.0
    c = nearest_e(1 / (2 * math.pi * r * fc), E6)
    if c < 100e-12:
        r = 1_000.0
        c = nearest_e(1 / (2 * math.pi * r * fc), E6)
    if c > 10e-6:
        r = 100_000.0
        c = nearest_e(1 / (2 * math.pi * r * fc), E6)
    actual = 1 / (2 * math.pi * r * c)
    kind = "High-pass" if high_pass else "Low-pass"
    b = _Builder(f"RC {kind.lower()} filter", f"First-order {kind.lower()} filter, cutoff about {actual:.0f} Hz.")
    j1 = b.add("J", "connector_2pin", "Signal_In", "input")
    j2 = b.add("J", "connector_2pin", "Signal_Out", "output")
    rr = b.add("R", "resistor", format_ohms(r))
    cc = b.add("C", "capacitor", format_farads(c))
    series, shunt = (cc, rr) if high_pass else (rr, cc)
    b.connect("IN", (j1, "1"), (series, "1"))
    b.connect("OUT", (series, "2"), (shunt, "1"), (j2, "1"))
    b.connect("GND", (shunt, "2"), (j1, "2"), (j2, "2"))
    b.place(j1, "1", 3, 4, mirror=True)  # pins face the circuit
    b.place(series, "1", 7, 4, "right")
    b.place(shunt, "1", 11, 6, "down")
    b.place(j2, "1", 16, 4)
    b.bus("GND", 10)
    b.notes.append(f"fc = 1 / (2 pi x {format_ohms(r)} x {format_farads(c)}) = {actual:.0f} Hz (target {fc:g} Hz).")
    return b.build()


def blinker_555(prompt: str) -> CircuitSpec:
    vs = (voltages(prompt) or [9.0])[0]
    if not 4.5 <= vs <= 15:
        raise GenerationError("The NE555 needs a 4.5 V to 15 V supply.")
    f = frequency_hz(prompt) or 1.0
    if not 0.1 <= f <= 1000:
        raise GenerationError("Choose a blink frequency between 0.1 Hz and 1 kHz.")
    c_timing = 10e-6 if f < 20 else 100e-9
    r1 = 1_000.0
    r2 = (1.44 / (f * c_timing) - r1) / 2
    if r2 < 1_000:
        raise GenerationError("That frequency is too high for this LED blinker.")
    r2 = nearest_e(r2, E12)
    actual = 1.44 / ((r1 + 2 * r2) * c_timing)
    duty = (r1 + r2) / (r1 + 2 * r2) * 100
    color = led_color(prompt)
    supply = supply_net(vs)

    b = _Builder("555 LED blinker", f"NE555 astable oscillator blinking a {color} LED at about {actual:.2f} Hz.")
    bt = _add_battery(b, vs, supply, f"{format_volts(vs)} supply")
    u = b.add("U", "timer_555", "NE555P", "astable oscillator")
    ra = b.add("R", "resistor", format_ohms(r1), "timing R1 (VCC to DISCH)")
    rb = b.add("R", "resistor", format_ohms(r2), "timing R2 (DISCH to THRES)")
    ct = b.add("C", "capacitor_polarized" if c_timing >= 1e-6 else "capacitor", format_farads(c_timing), "timing")
    cctl = b.add("C", "capacitor", "10n", "CONT decoupling")
    cdec = b.add("C", "capacitor", "100n", "supply decoupling")
    b.connect(supply, (u, "VCC"), (u, "RST"), (ra, "1"), (cdec, "1"))
    b.connect("GND", (u, "GND"), (ct, "2"), (cctl, "2"), (cdec, "2"))
    b.connect("DISCH", (ra, "2"), (rb, "1"), (u, "DISCH"))
    b.connect("TIMING", (rb, "2"), (u, "THRES"), (u, "TRIG"), (ct, "1"))
    b.connect("CTRL", (u, "CONT"), (cctl, "1"))
    b.connect("OUT", (u, "OUT"))
    r3, led = _add_led_with_resistor(b, "OUT", vs - 1.5, color, 0.010)  # NE555 high output ~ Vcc - 1.5 V

    b.place(bt, "1", 0, 1, "down")
    b.place(cdec, "1", 5, 6, "down")
    b.place(ra, "1", 11, 1, "down")
    b.place(rb, "1", 11, 6, "down")
    b.place(ct, "1", 11, 11, "down")
    b.place(u, "7", 18, 5)  # DISCH pin: the timer is centred on column 22, row 6
    b.place(cctl, "1", 26, 11, "down")
    b.place(r3, "1", 29, 6, "right")
    b.place(led, LED_A, 33, 8, "down")
    b.bus(supply, 0)
    b.bus("GND", 15)
    b.notes += [
        f"f = 1.44 / ((R1 + 2 R2) C) = {actual:.2f} Hz, duty cycle about {duty:.0f}% ({led} on while OUT is high).",
        "RST is tied to VCC so the timer always runs.",
    ]
    return b.build()


def linear_regulator(prompt: str) -> CircuitSpec:
    found = voltages(prompt)
    wants_3v3 = any(abs(v - 3.3) < 0.05 for v in found) or _words(prompt, "3v3", "ams1117")
    vout = 3.3 if wants_3v3 else 5.0
    others = [v for v in found if abs(v - vout) > 0.05]
    vin = max(others) if others else (5.0 if vout == 3.3 else 12.0)
    if vout == 5.0 and not 7.0 <= vin <= 35.0:
        raise GenerationError("A 7805 needs 7 V to 35 V input for a 5 V output.")
    if vout == 3.3 and not 4.5 <= vin <= 15.0:
        raise GenerationError("An AMS1117-3.3 needs 4.5 V to 15 V input.")

    if vout == 5.0:
        kind, part, c_in, c_out, polarized, in_pin = "regulator_7805", "L7805", "330n", "100n", False, "1"
    else:
        kind, part, c_in, c_out, polarized, in_pin = "regulator_ams1117_3v3", "AMS1117-3.3", "10u", "22u", True, "3"
    in_net = supply_net(vin)
    if in_net == "VIN" or abs(_rail_volts(in_net) - vout) < 0.05:
        in_net = "VIN"
    out_net = "+5V" if vout == 5.0 else "+3V3"

    b = _Builder(
        f"{format_volts(vout)} linear regulator",
        f"{part} regulating {format_volts(vin)} down to {format_volts(vout)}.",
    )
    bt = _add_battery(b, vin, in_net, f"{format_volts(vin)} input")
    j2 = b.add("J", "connector_2pin", "Output", f"{format_volts(vout)} output")
    u = b.add("U", kind, part, "linear regulator")
    cap_kind = "capacitor_polarized" if polarized else "capacitor"
    ci = b.add("C", cap_kind, c_in, "input capacitor")
    co = b.add("C", cap_kind, c_out, "output capacitor")
    b.connect(in_net, (u, "IN"), (ci, "1"))
    b.connect(out_net, (u, "OUT"), (co, "1"), (j2, "1"))
    b.connect("GND", (u, "GND"), (ci, "2"), (co, "2"), (j2, "2"))
    b.place(bt, "1", 0, 1, "down")
    b.place(ci, "1", 5, 1, "down")
    b.place(u, in_pin, 13, 5)  # input pin: the regulator is centred on column 16, row 5
    b.place(co, "1", 23, 1, "down")
    b.place(j2, "1", 29, 1)
    if _words(prompt, "led", "indicator"):
        r, d = _add_led_with_resistor(b, out_net, vout, led_color(prompt), 0.005)
        b.place(r, "1", 26, 1, "down")
        b.place(d, LED_A, 26, 6, "down")
    b.bus(in_net, 0)
    b.bus(out_net, 0)
    b.bus("GND", 11)
    dissipation_note = f"Dissipation = ({format_volts(vin)} - {format_volts(vout)}) x load current; add a heatsink above ~1 W."
    b.notes += [f"Capacitors per the {part} datasheet recommendation.", dissipation_note]
    return b.build()


def push_button(prompt: str) -> CircuitSpec:
    vs = (voltages(prompt) or [3.3])[0]
    supply = supply_net(vs)
    pull_down = _words(prompt, "pull-down", "pull down", "pulldown")
    b = _Builder(
        "Push button with pull-down" if pull_down else "Push button with pull-up",
        f"Momentary button producing a {'high' if pull_down else 'low'} level on BTN when pressed, {format_volts(vs)} logic.",
    )
    j = b.add("J", "connector_3pin", "Button", "VCC / BTN / GND")
    sw = b.add("SW", "push_button", "SW_Push")
    r = b.add("R", "resistor", "10k", "pull-down" if pull_down else "pull-up")
    b.connect(supply, (j, "1"))
    b.connect("BTN", (j, "2"), (sw, "2"), (r, "1" if pull_down else "2"))
    b.connect("GND", (j, "3"))
    if pull_down:
        b.connect(supply, (sw, "1"))
        b.connect("GND", (r, "2"))
        b.place(sw, "1", 4, 1, "down")  # switch on top, resistor below; BTN node at row 6
        b.place(r, "1", 4, 7, "down")
        node = 6
    else:
        b.connect(supply, (r, "1"))
        b.connect("GND", (sw, "1"))
        b.place(r, "1", 4, 1, "down")  # resistor on top, switch below; BTN node at row 5
        b.place(sw, "2", 4, 6, "down")  # switch pin 2 (BTN) on top, pin 1 (GND) at the bottom
        node = 5
    if _words(prompt, "debounce"):
        c = b.add("C", "capacitor", "100n", "debounce")
        b.connect("BTN", (c, "1"))
        b.connect("GND", (c, "2"))
        b.place(c, "1", 9, node + 1, "down")
        b.notes.append("RC debounce: 10k x 100n = 1 ms time constant.")
    b.place(j, "2", 15, node)
    b.bus(supply, 0)
    b.bus("GND", 11)
    b.notes.append(f"{j}: pin 1 = {format_volts(vs)}, pin 2 = button signal, pin 3 = GND.")
    return b.build()


def transistor_switch(prompt: str) -> CircuitSpec:
    found = voltages(prompt)
    logic = min(found) if len(found) >= 2 else 3.3
    vs = max(found) if found else 5.0
    color = led_color(prompt)
    supply = supply_net(vs)
    b = _Builder("NPN transistor LED switch", f"{format_volts(logic)} logic signal switching a {color} LED on {format_volts(vs)}.")
    j = b.add("J", "connector_3pin", "Control", "VCC / CTRL / GND")
    q = b.add("Q", "npn_transistor", "2N3904", "low-side switch")
    rb = b.add("R", "resistor", "1k", "base resistor")
    rpd = b.add("R", "resistor", "100k", "base pull-down (off when input floats)")
    b.connect(supply, (j, "1"))
    b.connect("CTRL", (j, "2"), (rb, "1"))
    b.connect("BASE", (rb, "2"), (q, "B"), (rpd, "1"))
    b.connect("GND", (j, "3"), (q, "E"), (rpd, "2"))
    vf = LED_VF[color]
    ohms = _led_resistor(vs - 0.2, vf, 0.015)
    rl = b.add("R", "resistor", format_ohms(ohms), "LED current limiting")
    d = b.add("D", "led", f"LED_{color.capitalize()}")
    b.connect(supply, (rl, "1"))
    b.connect("LED_A", (rl, "2"), (d, "A"))
    b.connect("COLLECTOR", (d, "K"), (q, "C"))
    b.place(j, "2", 3, 13, mirror=True)  # pins face the circuit
    b.place(rb, "1", 7, 13, "right")
    b.place(rpd, "1", 11, 14, "down")
    b.place(q, "3", 15, 11)  # collector pin: the transistor is centred on column 14, row 13
    b.place(rl, "1", 15, 1, "down")
    b.place(d, LED_A, 15, 6, "down")
    b.bus(supply, 0)
    b.bus("GND", 18)
    base_ma = (logic - 0.7) / 1.0  # (V - Vbe) / 1 kOhm, in mA
    b.notes += [
        f"Base current about {base_ma:.1f} mA from a {format_volts(logic)} signal; LED current about 15 mA.",
        f"{j}: pin 1 = {format_volts(vs)}, pin 2 = control input, pin 3 = GND.",
    ]
    return b.build()


@dataclass(frozen=True)
class _Template:
    name: str
    matches: Callable[[str], bool]
    build: Callable[[str], CircuitSpec]


TEMPLATES = [
    _Template("555 blinker", lambda p: _words(p, "555", "astable", "blink", "flash", "oscillat"), blinker_555),
    _Template("regulator", lambda p: _words(p, "regulat", "7805", "ams1117", "ldo", "lm78"), linear_regulator),
    _Template("voltage divider", lambda p: _words(p, "divider"), voltage_divider),
    _Template("rc filter", lambda p: _words(p, "filter", "low-pass", "lowpass", "high-pass", "highpass", "cutoff"), rc_filter),
    _Template("transistor switch", lambda p: _words(p, "transistor", "npn", "2n3904"), transistor_switch),
    _Template("push button", lambda p: _words(p, "button", "pushbutton", "switch", "pull-up", "pullup", "pull-down"), push_button),
    _Template("led indicator", lambda p: _words(p, "led"), led_indicator),
]


class RuleBasedGenerator:
    name = "rules"

    def generate(self, prompt: str) -> CircuitSpec:
        for template in TEMPLATES:
            if template.matches(prompt):
                return template.build(prompt)
        raise GenerationError(
            "I couldn't match that description to a circuit I can generate yet. Supported circuits:\n- "
            + "\n- ".join(SUPPORTED_CIRCUITS)
        )
