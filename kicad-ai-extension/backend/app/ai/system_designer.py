"""Turn a SystemPlan (joysticks, buttons, LED groups, ...) into a CircuitSpec around an Arduino Uno.

Everything electrical is computed here, never taken from the plan or from a language model:

- Pin allocation: analog inputs get A0.., digital I/O gets D2..D13 (D0/D1 stay free for USB serial),
  then any spare analog pins. If the LEDs do not fit, the largest LED groups move onto 74HC595 shift
  registers (3 controller pins drive any number of them) until the design fits, or it is rejected.
- LED resistors come from the usual (Vs - Vf) / I formula, rounded up to the E12 series.
- The drawing is built from small blocks (one per module) flowed to the right of the Uno. Blocks
  connect to the Uno and to each other by net name, with a power symbol at every rail pin, which is
  how real multi-block schematics are drawn and keeps long wires out of the picture.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.ai.circuit_generator import (
    LED_VF,
    GenerationError,
    _Builder,
    _led_resistor,
    format_ohms,
)
from app.schemas.circuit import Caption, CircuitSpec, Layout
from app.schemas.system import Button, Buzzer, Joystick, Knob, LedGroup, LedMatrix, SystemPlan

SUPPLY = 5.0
DIRECT_LED_A = 0.010  # driven straight from an Uno pin (limit 20 mA per pin)
SHIFTED_LED_A = 0.005  # driven from a 74HC595 (limit 6 mA for full-level outputs; 70 mA per package)
PIN_LIMIT_A = 0.020  # Uno recommended per-pin current; a matrix row pin feeds a whole row at once
BUZZER_SERIES_OHMS = "330"

# Uno R3 pins by number (see the MCU_Module:Arduino_UNO_R3 symbol).
UNO = "A1"
UNO_GND_PINS = ("6", "7", "29")
UNO_5V_PIN = "5"
ANALOG_PINS = [("A0", "9"), ("A1", "10"), ("A2", "11"), ("A3", "12"), ("A4", "13"), ("A5", "14")]
DIGITAL_PINS = [(f"D{n}", str(15 + n)) for n in range(2, 14)]  # D2..D13
RIGHT_EDGE = {pin for _, pin in ANALOG_PINS}  # A0..A5 are drawn on the symbol's right edge, D0..D13 on its left
RAIL_PINS = {"5", *UNO_GND_PINS}
UNO_HALF_WIDTH = 7  # grid cells from the Uno's centre to the ends of its side pins
SHIFT_OUTPUT_PINS = ["15", "1", "2", "3", "4", "5", "6", "7"]  # QA..QH
MAX_SHIFT_REGISTERS = 4
RESERVED_NETS = {"GND", "+5V", "SR_DATA", "SR_CLK", "SR_LATCH"}

# Drawing grid (cells of 2.54 mm).
UNO_COL, UNO_ROW = 12, 12  # centre of the Uno
FLOW_COL, FLOW_ROW, FLOW_WIDTH = 30, 2, 62
LEDS_PER_BLOCK = 8


@dataclass
class _Block:
    """A group of parts drawn together, positioned relative to its top-left corner."""

    title: str
    width: int
    height: int
    items: list[tuple[str, str, int, int, str | None]] = field(default_factory=list)  # ref, pin, dc, dr, direction
    buses: dict[str, int] = field(default_factory=dict)  # net -> row (relative), drawn as one straight wire

    def put(self, ref: str, pin: str, dc: int, dr: int, direction: str | None = None) -> None:
        self.items.append((ref, pin, dc, dr, direction))


class _System:
    def __init__(self, plan: SystemPlan) -> None:
        self.plan = plan
        self.b = _Builder(plan.title, plan.description)
        self.remote: list[str] = []  # nets drawn by name
        self.used_nets: set[str] = set(RESERVED_NETS)
        self.blocks: list[_Block] = []
        self.pin_map: list[str] = []
        self.wired_groups: dict[str, list[str]] = {}  # remote net -> refs wired together on it
        self.crossing: list[str] = []  # nets allowed to cross each other

    # -- nets ------------------------------------------------------------------------------

    def net_name(self, name: str) -> str:
        if name in self.used_nets:
            raise GenerationError(f"The name '{name}' is used twice; give each module a different label.")
        self.used_nets.add(name)
        return name

    def link(self, net: str, *pins: tuple[str, str]) -> None:
        """Connect pins by name (label or power symbol), for connections between blocks and rails."""
        self.b.connect(net, *pins)
        if net not in self.remote:
            self.remote.append(net)

    def local(self, net: str, *pins: tuple[str, str]) -> None:
        """Connect pins with a wire (both ends sit inside one block)."""
        self.b.connect(net, *pins)


def _pins_needed(plan: SystemPlan) -> tuple[int, int]:
    """(analog inputs, digital pins excluding LEDs)."""
    analog = sum(2 for m in plan.modules if isinstance(m, Joystick)) + sum(1 for m in plan.modules if isinstance(m, Knob))
    digital = sum(1 for m in plan.modules if isinstance(m, (Joystick, Button, Buzzer)))
    digital += sum(m.rows + m.cols for m in plan.modules if isinstance(m, LedMatrix))
    return analog, digital


def _choose_shifted(plan: SystemPlan, pool_size: int, fixed_digital: int) -> list[LedGroup]:
    """Largest LED groups first move to shift registers until everything fits the controller's pins."""
    groups = [m for m in plan.modules if isinstance(m, LedGroup)]
    direct = sum(g.count for g in groups)
    shifted: list[LedGroup] = []
    while fixed_digital + direct + (3 if shifted else 0) > pool_size:
        remaining = [g for g in groups if g not in shifted]
        if not remaining:
            raise GenerationError(
                f"This needs {fixed_digital + (3 if shifted else 0)} controller pins even with every LED on shift "
                f"registers, but the Arduino Uno has {pool_size} free pins."
            )
        biggest = max(remaining, key=lambda g: g.count)
        shifted.append(biggest)
        direct -= biggest.count
    return shifted


def build_system(plan: SystemPlan) -> CircuitSpec:
    labels = [m.label for m in plan.modules]
    if len(set(labels)) != len(labels):
        raise GenerationError("Every module needs its own label.")

    analog_needed, fixed_digital = _pins_needed(plan)
    if analog_needed > len(ANALOG_PINS):
        raise GenerationError(
            f"This needs {analog_needed} analog inputs (2 per joystick, 1 per knob) but the Arduino Uno has {len(ANALOG_PINS)}."
        )
    analog_free = ANALOG_PINS[analog_needed:]
    analog_iter = iter(ANALOG_PINS[:analog_needed])
    pool = DIGITAL_PINS + analog_free[::-1]  # spare analog pins serve as digital I/O, A5 first
    shifted_groups = _choose_shifted(plan, len(pool), fixed_digital)
    shifted_leds = sum(g.count for g in shifted_groups)
    registers = -(-shifted_leds // 8)
    if registers > MAX_SHIFT_REGISTERS:
        raise GenerationError(f"That needs {registers} shift registers; the limit is {MAX_SHIFT_REGISTERS}.")
    free = list(pool)  # left-edge pins (D2..D13) first, then the spare right-edge analog pins (A5 first)

    def analog() -> tuple[str, str]:
        return next(analog_iter)

    def digital(right: bool = False) -> tuple[str, str]:
        """Next free pin. Inputs drawn on the Uno's right (beside the analog pins) take a spare A pin if there is one."""
        if right and free[-1][0].startswith("A"):
            return free.pop()
        return free.pop(0)

    s = _System(plan)
    b = s.b
    uno = b.add("A", "arduino_uno", "Arduino_UNO_R3", "controller, powered over USB")
    s.link("GND", *[(uno, pin) for pin in UNO_GND_PINS])
    s.link("+5V", (uno, UNO_5V_PIN))

    input_blocks: list[_Block] = []
    output_blocks: list[_Block] = []

    # -- inputs ---------------------------------------------------------------------------------
    for m in plan.modules:
        if isinstance(m, Joystick):
            blk = _Block(f"{m.label} joystick", 27, 15)
            names = {}
            for axis, dc in (("X", 3), ("Y", 12)):
                pot = b.add("RV", "potentiometer", "10k", f"{m.label} joystick {axis} axis")
                net = s.net_name(f"{m.label}_{axis}")
                pin_name, pin = analog()
                s.link("+5V", (pot, "1"))
                s.link("GND", (pot, "3"))
                s.link(net, (pot, "2"), (uno, pin))
                blk.put(pot, "2", dc + 2, 7)  # anchored by the wiper: the only pin on the grid that needs a wire
                names[axis] = pin_name
            sw = b.add("SW", "push_button", "SW_Push", f"{m.label} joystick button")
            net = s.net_name(f"{m.label}_BTN")
            btn_name, pin = digital(right=True)
            s.link(net, (sw, "2"), (uno, pin))
            s.link("GND", (sw, "1"))
            blk.put(sw, "2", 22, 5, "down")
            s.pin_map.append(f"{m.label} joystick: X={names['X']}, Y={names['Y']}, button={btn_name} (INPUT_PULLUP, reads LOW when pressed).")
            input_blocks.append(blk)
        elif isinstance(m, Knob):
            blk = _Block(f"{m.label} knob", 10, 15)
            pot = b.add("RV", "potentiometer", "10k", m.purpose or f"{m.label} knob")
            net = s.net_name(m.label)
            pin_name, pin = analog()
            s.link("+5V", (pot, "1"))
            s.link("GND", (pot, "3"))
            s.link(net, (pot, "2"), (uno, pin))
            blk.put(pot, "2", 5, 7)  # anchored by the wiper (its ends are power symbols)
            s.pin_map.append(f"{m.label} knob: wiper={pin_name} (analogRead).")
            input_blocks.append(blk)
        elif isinstance(m, Button):
            blk = _Block(f"{m.label} button", 10, 15)
            sw = b.add("SW", "push_button", "SW_Push", m.purpose or f"{m.label} button")
            net = s.net_name(m.label)
            pin_name, pin = digital(right=True)
            s.link(net, (sw, "2"), (uno, pin))
            s.link("GND", (sw, "1"))
            blk.put(sw, "2", 5, 5, "down")
            s.pin_map.append(f"{m.label} button: {pin_name} (INPUT_PULLUP, reads LOW when pressed).")
            input_blocks.append(blk)

    # -- outputs --------------------------------------------------------------------------------
    def led_chain(blk: _Block, dc: int, net: str, color: str, amps: float) -> float:
        ohms = _led_resistor(SUPPLY, LED_VF[color], amps)
        r = b.add("R", "resistor", format_ohms(ohms), "LED current limiting")
        d = b.add("D", "led", color.capitalize(), f"{color} indicator on {net}")
        s.link(net, (r, "1"))
        s.local(f"LED{d[1:]}_A", (r, "2"), (d, "A"))
        s.link("GND", (d, "K"))
        blk.put(r, "1", dc, 5, "down")
        blk.put(d, "2", dc, 10, "down")
        return (SUPPLY - LED_VF[color]) / ohms

    led_nets: dict[str, list[str]] = {}
    for m in plan.modules:
        if isinstance(m, LedGroup):
            led_nets[m.label] = [s.net_name(m.label if m.count == 1 else f"{m.label}{i + 1}") for i in range(m.count)]

    # Controller pins for the shift registers come before direct LED pins.
    sr_pins: dict[str, tuple[str, str]] = {}
    if shifted_groups:
        for net, name in (("SR_DATA", "data"), ("SR_CLK", "clock"), ("SR_LATCH", "latch")):
            sr_pins[net] = digital()

    direct_ma = 0.0
    shifted_ma = 0.0
    shifted_nets: list[tuple[str, str]] = []  # (net, color), flattened over shifted groups
    for m in plan.modules:
        if isinstance(m, Buzzer):
            blk = _Block(f"{m.label} buzzer", 11, 17)
            r = b.add("R", "resistor", BUZZER_SERIES_OHMS, "buzzer series resistor")
            bz = b.add("BZ", "buzzer", "Buzzer", m.purpose or "piezo buzzer")
            net = s.net_name(m.label)
            pin_name, pin = digital()
            s.link(net, (uno, pin), (r, "1"))
            s.local(f"{bz}_DRV", (r, "2"), (bz, "1"))
            s.link("GND", (bz, "2"))
            blk.put(r, "1", 4, 5, "down")
            blk.put(bz, "1", 4, 10, "down")
            s.pin_map.append(f"{m.label} buzzer: {pin_name} (tone()).")
            output_blocks.append(blk)
        elif isinstance(m, LedGroup):
            nets = led_nets[m.label]
            if m in shifted_groups:
                shifted_nets += [(n, m.color) for n in nets]
                continue
            for start in range(0, m.count, LEDS_PER_BLOCK):
                chunk = nets[start : start + LEDS_PER_BLOCK]
                part = f" ({start // LEDS_PER_BLOCK + 1})" if m.count > LEDS_PER_BLOCK else ""
                blk = _Block(f"{m.label} LEDs{part}", 5 * len(chunk) + 2, 19)
                pins = []
                for k, net in enumerate(chunk):
                    pin_name, pin = digital()
                    s.link(net, (uno, pin))
                    direct_ma += led_chain(blk, 3 + 5 * k, net, m.color, DIRECT_LED_A) * 1000
                    pins.append(pin_name)
                s.pin_map.append(f"{m.label} LEDs{part}: {', '.join(pins)} (HIGH = on).")
                output_blocks.append(blk)

    for m in plan.modules:
        if isinstance(m, LedMatrix):
            blk, ma = _led_matrix(s, uno, m, digital)
            direct_ma += ma
            output_blocks.append(blk)

    if shifted_groups:
        output_blocks += _shift_registers(s, uno, sr_pins, registers, shifted_nets)
        # LED chains for the shifted outputs
        for start in range(0, len(shifted_nets), LEDS_PER_BLOCK):
            chunk = shifted_nets[start : start + LEDS_PER_BLOCK]
            blk = _Block(f"Shift-register LEDs ({start // LEDS_PER_BLOCK + 1})", 5 * len(chunk) + 2, 19)
            for k, (net, color) in enumerate(chunk):
                shifted_ma += led_chain(blk, 3 + 5 * k, net, color, SHIFTED_LED_A) * 1000
            output_blocks.append(blk)
        spans, first = [], 1
        for g in shifted_groups:
            spans.append(f"{g.label}={first}-{first + g.count - 1}")
            first += g.count
        s.pin_map.append(
            f"74HC595 x{registers}: data={sr_pins['SR_DATA'][0]}, clock={sr_pins['SR_CLK'][0]}, latch={sr_pins['SR_LATCH'][0]}. "
            f"LEDs on outputs QA, QB, ... in order: {', '.join(spans)}. Chained registers: send the last register's byte first."
        )

    # -- layout ---------------------------------------------------------------------------------
    # Every signal is a real wire from the Uno. The Uno's digital pins (D2..D13) are on its left edge
    # and the analog ones (A0..A5) on its right, so each block goes on the side of the pins it uses:
    # outputs like an LED matrix to the left, joysticks and knobs to the right. Signal wires may
    # cross each other (never join); GND and +5V are power symbols.
    def side(blk: _Block) -> str:
        refs = {item[0] for item in blk.items}
        votes = [p.pin in RIGHT_EDGE for pins in b.nets.values() if any(q.ref in refs for q in pins)
                 for p in pins if p.ref == uno and p.pin not in RAIL_PINS]
        return "right" if votes.count(True) >= votes.count(False) else "left"

    blocks = input_blocks + output_blocks
    left_blocks = [blk for blk in blocks if side(blk) == "left"]
    right_blocks = [blk for blk in blocks if side(blk) == "right"]
    left_wires = sum(1 for pins in b.nets.values() for p in pins if p.ref == uno and p.pin not in RIGHT_EDGE | RAIL_PINS)
    lane = left_wires + 4 if left_blocks else 0  # room beside the Uno for each wire to turn on its own column
    left_width = max((blk.width for blk in left_blocks), default=0)
    uno_col = UNO_COL + (left_width + lane if left_blocks else 0)
    flow_col = uno_col + FLOW_COL - UNO_COL
    captions = [Caption(col=uno_col - 9, row=UNO_ROW - 14, text="Arduino Uno R3 (controller)")]

    def put(blk: _Block, x: int, y: int) -> None:
        for ref, pin, dc, dr, direction in blk.items:
            b.place(ref, pin, x + dc, y + dr, direction)
        for net, dr in blk.buses.items():
            b.bus(net, y + dr)
        captions.append(Caption(col=x, row=y, text=blk.title))

    b.place(uno, "6", uno_col, UNO_ROW + 11)
    y = FLOW_ROW
    for blk in left_blocks:  # stacked, right-aligned toward the Uno
        put(blk, uno_col - UNO_HALF_WIDTH - lane - blk.width, y)
        y += blk.height + 2
    x, y, row_height = flow_col, FLOW_ROW, 0
    for blk in right_blocks:
        if x > flow_col and x + blk.width > flow_col + FLOW_WIDTH:
            x, y, row_height = flow_col, y + row_height + 1, 0
        put(blk, x, y)
        x += blk.width + 2
        row_height = max(row_height, blk.height)

    # -- notes ----------------------------------------------------------------------------------
    b.notes.append("Controller: Arduino Uno R3, 5 V logic, powered over USB. Pins D0/D1 are left free for serial.")
    b.notes += s.pin_map
    if any(isinstance(m, Joystick) for m in plan.modules):
        b.notes.append(
            "Each joystick is drawn as its equivalent circuit: two 10k potentiometers (X, Y) and a push switch. "
            "A KY-023 style module wires up the same way (GND, +5V, VRx, VRy, SW)."
        )
    if direct_ma or shifted_ma:
        b.notes.append(
            f"LED resistors: (5 V - Vf) / {DIRECT_LED_A * 1000:g} mA direct or {SHIFTED_LED_A * 1000:g} mA via 74HC595, "
            f"rounded up to E12. All LEDs on at once draw about {direct_ma + shifted_ma:.0f} mA (Uno 5 V pin budget over USB: ~500 mA)."
        )
    if any(isinstance(m, Buzzer) for m in plan.modules):
        b.notes.append(f"Buzzer: {BUZZER_SERIES_OHMS} ohm series resistor keeps pin current under 20 mA. Use a transistor for a louder buzzer.")

    spec = b.build()
    rails = [net for net in s.remote if net in ("GND", "+5V")]
    layout = Layout(
        placements=b.placements,
        buses=b.buses,
        remote_nets=rails,  # power symbols at every pin
        hub=uno,
        crossing_nets=[net for net in b.nets if net not in rails],
        captions=captions,
    )
    return spec.model_copy(update={"layout": layout})


def _led_matrix(s: _System, uno: str, m: LedMatrix, digital) -> tuple[_Block, float]:  # type: ignore[no-untyped-def]
    """A multiplexed grid: LED (r, c) has its anode on row r and its cathode on column c.

    The firmware drives one row HIGH at a time and pulls LOW the columns whose LEDs should light, so
    one row pin feeds up to `cols` LEDs at once. Each column gets the resistor (only one LED per column
    is lit at a time), sized so a full row stays under the pin limit. Returns the block and the worst-case
    current in mA (one full row).
    """
    b = s.b
    amps = min(DIRECT_LED_A, PIN_LIMIT_A / m.cols)
    ohms = _led_resistor(SUPPLY, LED_VF[m.color], amps)
    per_led = (SUPPLY - LED_VF[m.color]) / ohms
    rows = [s.net_name(f"{m.label}_R{r + 1}") for r in range(m.rows)]
    cols = [s.net_name(f"{m.label}_C{c + 1}") for c in range(m.cols)]  # controller pin -> resistor
    sinks = [s.net_name(f"{m.label}_K{c + 1}") for c in range(m.cols)]  # resistor -> the column's cathodes
    row_pins = []
    for net in rows:
        name, pin = digital()
        s.link(net, (uno, pin))
        row_pins.append(name)
    col_pins = []
    for net in cols:
        name, pin = digital()
        s.link(net, (uno, pin))
        col_pins.append(name)

    # Drawn like a real matrix: each row is one straight wire along its anodes (a label at its left end
    # connects it to the Uno), each column a wire from its cathodes down to its resistor, crossing the
    # rows without joining them. Grid cells: LEDs 6 apart across and 7 down (anode on top, cathode 3
    # below), each row's wire one cell above its anodes, the resistors under the last row.
    left = 2
    blk = _Block(f"{m.label} {m.rows}x{m.cols} LED matrix", left + 6 * m.cols, 7 * m.rows + 9)
    for r in range(m.rows):
        for c in range(m.cols):
            d = b.add("D", "led", m.color.capitalize(), f"{m.label} row {r + 1}, column {c + 1}")
            s.link(rows[r], (d, "A"))
            s.local(sinks[c], (d, "K"))
            blk.put(d, "2", left + 6 * c, 3 + 7 * r, "down")
        blk.buses[rows[r]] = 2 + 7 * r  # one cell above the anodes
    resistors = []
    for c in range(m.cols):
        res = b.add("R", "resistor", format_ohms(ohms), f"{m.label} column {c + 1} current limiting")
        s.local(sinks[c], (res, "2"))
        s.link(cols[c], (res, "1"))
        blk.put(res, "2", left + 6 * c, 7 * m.rows + 2, "down")  # column wire comes in on top, Uno label below
        resistors.append(res)
    s.crossing += rows + sinks

    s.pin_map.append(
        f"{m.label} {m.rows}x{m.cols} LED matrix: rows (anodes) {', '.join(row_pins)}; columns (cathodes, through "
        f"{resistors[0]}-{resistors[-1]}) {', '.join(col_pins)}. Light LED (r, c): row r HIGH, column c LOW. "
        f"Scan one row at a time, fast (about 2 ms per row), so the whole picture looks steady."
    )
    b.notes.append(
        f"Matrix resistors: (5 V - {LED_VF[m.color]:g} V) / {amps * 1000:.2g} mA, rounded up to {format_ohms(ohms)} "
        f"= {per_led * 1000:.1f} mA per LED. A row pin feeds up to {m.cols} LEDs at once "
        f"({per_led * m.cols * 1000:.0f} mA, within the {PIN_LIMIT_A * 1000:g} mA pin limit). Each row is lit 1/{m.rows} "
        "of the time, so the LEDs look dimmer than when driven directly."
    )
    return blk, per_led * m.cols * 1000


def _shift_registers(
    s: _System, uno: str, sr_pins: dict[str, tuple[str, str]], count: int, outputs: list[tuple[str, str]]
) -> list[_Block]:
    """Add `count` daisy-chained 74HC595s whose outputs are the nets in `outputs` (in order)."""
    b = s.b
    s.link("SR_DATA", (uno, sr_pins["SR_DATA"][1]))
    s.link("SR_CLK", (uno, sr_pins["SR_CLK"][1]))
    s.link("SR_LATCH", (uno, sr_pins["SR_LATCH"][1]))
    blocks: list[_Block] = []
    previous: str | None = None
    for k in range(count):
        blk = _Block(f"74HC595 shift register {k + 1}", 29, 23)
        u = b.add("U", "shift_register_74hc595", "74HC595", f"LED driver {k + 1} of {count}")
        cap = b.add("C", "capacitor", "100n", "74HC595 supply decoupling")
        if previous is None:
            s.link("SR_DATA", (u, "SER"))
        else:
            chain = s.net_name(f"SR_CHAIN{k}")
            s.link(chain, (previous, "9"), (u, "SER"))
        s.link("SR_CLK", (u, "SRCLK"))
        s.link("SR_LATCH", (u, "RCLK"))
        s.link("+5V", (u, "VCC"), (u, "SRCLR"), (cap, "1"))
        s.link("GND", (u, "GND"), (u, "OE"), (cap, "2"))
        for index, pin in enumerate(SHIFT_OUTPUT_PINS):
            position = k * 8 + index
            if position < len(outputs):
                s.link(outputs[position][0], (u, pin))
        blk.put(u, "14", 7, 6)
        blk.put(cap, "1", 23, 6, "down")
        blocks.append(blk)
        previous = u
    return blocks


__all__ = ["build_system"]
