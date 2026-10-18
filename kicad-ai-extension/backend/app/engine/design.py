"""The CircuitForge design family: an Arduino Uno reading a push button and driving an LED.

This is the circuit the frontend's lessons, steps and checks are written for. `DesignParams`
mirrors the frontend's `DesignParams` (camelCase on the wire); `build_circuit` turns it into the
same CircuitSpec the KiCad renderer uses, so the plan the UI shows and the schematic KiCad opens
come from one set of numbers.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.ai.circuit_generator import LED_VF, format_farads, format_ohms
from app.engine import jsmath
from app.schemas.circuit import CircuitSpec, ComponentSpec, Layout, NetSpec, PinRef, Placement

LedColor = Literal["red", "orange", "yellow", "green", "blue", "white"]

# Fixed by the Arduino Uno: 5 V logic, 20 mA per pin (40 mA absolute max).
UNO_SUPPLY = 5.0


class DesignParams(BaseModel):
    """Electrical values the engine chose. Same fields and units as the frontend's `DesignParams`."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    supply: Annotated[float, Field(ge=3.0, le=5.5)] = UNO_SUPPLY  # V
    led_vf: Annotated[float, Field(ge=1.4, le=4.0)] = 2.0  # V
    led_target_ma: Annotated[float, Field(ge=1, le=jsmath.PIN_ABS_MAX_MA)] = 15  # mA
    led_resistor: Annotated[float, Field(ge=47, le=100_000)] = 220  # Ω
    pull_down: Annotated[float, Field(ge=1_000, le=1_000_000)] = 10_000  # Ω
    debounce_cap_nf: Annotated[float, Field(ge=0, le=1_000)] = 100  # nF; 0 = no capacitor
    led_color: LedColor = "red"

    @classmethod
    def for_color(cls, color: LedColor, **overrides: float) -> "DesignParams":
        """Defaults for a given LED colour, with the resistor sized (rounded up to E12) for the current."""
        vf = LED_VF[color]
        ma = overrides.get("led_target_ma", 15)
        design = jsmath.led_design(UNO_SUPPLY, vf, ma)
        values = {"led_vf": vf, "led_resistor": design.r, **overrides}
        return cls(led_color=color, **values)


# --- Circuit ------------------------------------------------------------------------------------

# Grid layout (cells of 2.54 mm; rows grow downward). The Uno sits at (UNO_X, UNO_Y):
#   +5V pin on top, GND pins on the bottom, D2 (button) and D13 (LED) on the left.
UNO_X, UNO_Y = 18, 12
TOP_BUS, BOTTOM_BUS = UNO_Y - 11, UNO_Y + 15


def build_circuit(params: DesignParams) -> CircuitSpec:
    led = jsmath.led_design(params.supply, params.led_vf, params.led_target_ma, params.led_resistor)
    pull = params.supply / params.pull_down
    color = params.led_color.capitalize()
    with_cap = params.debounce_cap_nf > 0

    components = [
        ComponentSpec(ref="A1", kind="arduino_uno", value="Arduino_UNO_R3", purpose="controller, USB powered"),
        ComponentSpec(ref="D1", kind="led", value=f"LED_{color}", purpose=f"{params.led_color} indicator"),
        ComponentSpec(ref="R1", kind="resistor", value=format_ohms(params.led_resistor), purpose="LED current limiting"),
        ComponentSpec(ref="SW1", kind="push_button", value="SW_Push", purpose="push button"),
        ComponentSpec(ref="R2", kind="resistor", value=format_ohms(params.pull_down), purpose="pull-down"),
    ]
    button_pins = [PinRef(ref="A1", pin="D2"), PinRef(ref="SW1", pin="2"), PinRef(ref="R2", pin="1")]
    gnd_pins = [PinRef(ref="A1", pin=pin) for pin in ("6", "7", "29")] + [  # all three GND pins of the Uno
        PinRef(ref="D1", pin="K"),
        PinRef(ref="R2", pin="2"),
    ]
    if with_cap:
        components.append(
            ComponentSpec(ref="C1", kind="capacitor", value=format_farads(params.debounce_cap_nf * 1e-9), purpose="debounce")
        )
        button_pins.append(PinRef(ref="C1", pin="1"))
        gnd_pins.append(PinRef(ref="C1", pin="2"))

    nets = [
        NetSpec(name="+5V", connections=[PinRef(ref="A1", pin="5"), PinRef(ref="SW1", pin="1")]),
        NetSpec(name="GND", connections=gnd_pins),
        NetSpec(name="LED_DRIVE", connections=[PinRef(ref="A1", pin="D13"), PinRef(ref="R1", pin="1")]),
        NetSpec(name="LED_ANODE", connections=[PinRef(ref="R1", pin="2"), PinRef(ref="D1", pin="A")]),
        NetSpec(name="BUTTON", connections=button_pins),
    ]

    placements = {
        "A1": Placement(pin="6", col=UNO_X, row=UNO_Y + 11),  # centre GND pin, bottom of the board
        "SW1": Placement(pin="1", col=UNO_X - 11, row=UNO_Y - 9, direction="down"),  # hangs from +5V
        "R1": Placement(pin="1", col=UNO_X - 7, row=UNO_Y + 7, direction="left"),  # D13 -> R1 -> LED
        "D1": Placement(pin="2", col=UNO_X - 11, row=UNO_Y + 10, direction="down"),  # anode up, cathode on GND
        "R2": Placement(pin="1", col=UNO_X - 15, row=UNO_Y - 3, direction="down"),
    }
    if with_cap:
        placements["C1"] = Placement(pin="1", col=UNO_X - 19, row=UNO_Y - 3, direction="down")

    notes = [
        f"R1 = ({jsmath.trim(params.supply)} - {jsmath.trim(params.led_vf)} V) / {jsmath.trim(params.led_target_ma)} mA, "
        f"rounded up to {jsmath.fmt_ohms(params.led_resistor)}: {jsmath.fmt_si(led.current, 'A')} through the LED.",
        f"R2 pulls D2 to ground; it draws {jsmath.fmt_si(pull, 'A')} while the button is held.",
    ]
    if with_cap:
        notes.append(f"C1 across R2 debounces the button (tau = {jsmath.fmt_si(jsmath.tau(params.pull_down, params.debounce_cap_nf), 's')}).")
    notes.append("The Uno is USB powered; the PWR_FLAG tells KiCad's ERC that GND is supplied from outside.")

    return CircuitSpec(
        title="Push-button LED",
        description=f"Arduino Uno: the {params.led_color} LED on D13 lights while the button on D2 is pressed.",
        components=components,
        nets=nets,
        notes=notes,
        layout=Layout(placements=placements, buses={"+5V": TOP_BUS, "GND": BOTTOM_BUS}),
    )
