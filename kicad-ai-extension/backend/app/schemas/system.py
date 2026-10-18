"""A system-level plan: which inputs and outputs a microcontroller project needs.

This is the contract between *understanding* a complex request (rules or an LLM) and the
deterministic synthesizer. The plan only chooses modules and counts. Pin assignment, resistor
values, part references, nets and placement are all computed from it, so a plan can never
produce an electrically invalid circuit. It can only be too big, which is reported clearly.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# Used as a prefix of net names (e.g. P1_X, BALL3), so it is short and shouted.
ModuleLabel = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Z][A-Z0-9_]{0,7}$")]
LedColor = Literal["red", "orange", "yellow", "green", "blue", "white"]


class _Module(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: ModuleLabel = Field(description="Unique short name, e.g. P1, BALL, SCORE1")
    purpose: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] = ""


class Joystick(_Module):
    """Two-axis analog joystick with a push switch: outputs <label>_X, <label>_Y, <label>_BTN."""

    type: Literal["joystick"] = "joystick"


class Knob(_Module):
    """Potentiometer read as an analog value."""

    type: Literal["knob"] = "knob"


class Button(_Module):
    """Momentary push button (read with the internal pull-up)."""

    type: Literal["button"] = "button"


class LedGroup(_Module):
    """`count` LEDs, each with its own resistor, driven from the controller."""

    type: Literal["led_group"] = "led_group"
    count: int = Field(ge=1, le=16)
    color: LedColor = "red"


class LedMatrix(_Module):
    """`rows` x `cols` LEDs in a grid, multiplexed: one pin per row (anodes) and one per column (cathodes)."""

    type: Literal["led_matrix"] = "led_matrix"
    rows: int = Field(ge=2, le=8)
    cols: int = Field(ge=2, le=8)
    color: LedColor = "red"


class Buzzer(_Module):
    """Piezo buzzer driven with tone()."""

    type: Literal["buzzer"] = "buzzer"


Module = Annotated[Joystick | Knob | Button | LedGroup | LedMatrix | Buzzer, Field(discriminator="type")]


class SystemPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)] = ""
    modules: list[Module] = Field(min_length=1, max_length=24)
