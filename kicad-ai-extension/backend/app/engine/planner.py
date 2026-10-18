"""Turn a prompt (or a change request) into design parameters.

Rule-based and deterministic: no model, no network. It understands the one design family the
CircuitForge UI teaches (Arduino Uno + push button + LED) and edits to it:

    "When I press a button, a blue LED should light up. Use an Arduino Uno."
    "make the LED brighter" / "dimmer" / "use a green LED" / "set the LED to 10 mA"
    "remove the debounce" / "add a debounce capacitor"

Every value comes from formulas (`jsmath`), never from the text: the prompt only chooses which
knob to turn. Anything the planner cannot map raises `PlanError` with a message the UI shows.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.ai.circuit_generator import LED_VF
from app.engine import jsmath
from app.engine.design import UNO_SUPPLY, DesignParams, LedColor

# Brightness steps (mA). The Uno's pin limit is 20 mA, so 20 is the top step.
CURRENT_STEPS = [2.0, 5.0, 10.0, 15.0, 20.0]
DEFAULT_DEBOUNCE_NF = 100.0

HELP = (
    "I can build a push button that lights an LED on an Arduino Uno, and change it. Try: "
    "'When I press a button, a green LED should light up', 'make the LED brighter', "
    "'use a blue LED', 'set the LED to 10 mA', 'remove the debounce'."
)


class PlanError(ValueError):
    """The request cannot be mapped to a design. The message is shown to the user."""


@dataclass
class Plan:
    params: DesignParams
    request: str  # the sentence shown at the top of the plan
    changes: list[str] = field(default_factory=list)  # human-readable, for the chat transcript
    is_new: bool = False


def _has(text: str, *words: str) -> bool:
    return any(re.search(rf"\b{re.escape(w)}", text) for w in words)


def find_color(text: str) -> LedColor | None:
    for color in LED_VF:
        if re.search(rf"\b{color}\b", text):
            return color  # type: ignore[return-value]
    return None


def find_milliamps(text: str) -> float | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*(m\s*a|milli\s*amps?)\b", text)
    return float(match.group(1)) if match else None


def _step(current_ma: float, direction: int) -> float:
    """The next brightness step above/below `current_ma`."""
    if direction > 0:
        return next((s for s in CURRENT_STEPS if s > current_ma + 1e-9), CURRENT_STEPS[-1])
    return next((s for s in reversed(CURRENT_STEPS) if s < current_ma - 1e-9), CURRENT_STEPS[0])


def _sized(params: DesignParams, **changes: float | str) -> DesignParams:
    """Apply changes, then re-size R1 (rounded up to a standard value) for the new colour/current."""
    base = params.model_copy(update=changes)
    design = jsmath.led_design(UNO_SUPPLY, base.led_vf, base.led_target_ma)
    if not design.ok:
        raise PlanError(f"A {base.led_color} LED needs more than {jsmath.js_str(UNO_SUPPLY)} V to light.")
    return base.model_copy(update={"led_resistor": design.r})


def plan(prompt: str, current: DesignParams | None = None, current_request: str = "") -> Plan:
    text = " ".join(prompt.lower().split())

    describes_circuit = _has(text, "button", "press") and _has(text, "led", "light")
    wants_fresh = describes_circuit or current is None
    if wants_fresh and not describes_circuit:
        # An edit with no design to edit yet: only a full description can start one.
        raise PlanError("There is no design yet. Describe the circuit first. " + HELP)

    color = find_color(text)
    milliamps = find_milliamps(text)
    changes: list[str] = []

    if describes_circuit:
        # A fresh design: defaults, then whatever the sentence specified.
        params = DesignParams.for_color(color or "red")
        if milliamps is not None:
            params = _sized(params, led_target_ma=_clamp_current(milliamps, changes))
            changes.append(f"LED current {jsmath.trim(params.led_target_ma)} mA")
        if _has(text, "no debounce", "without debounce", "no bounce"):
            params = params.model_copy(update={"debounce_cap_nf": 0})
        return Plan(
            params=params,
            request=prompt.strip(),
            changes=[f"{params.led_color} LED", *changes],
            is_new=True,
        )

    assert current is not None
    params = current
    request = current_request or prompt.strip()

    if color and color != params.led_color:
        params = _sized(params, led_color=color, led_vf=LED_VF[color])
        changes.append(f"{color} LED ({jsmath.trim(LED_VF[color])} V)")

    if milliamps is not None:
        target = _clamp_current(milliamps, changes)
        if target != params.led_target_ma:
            params = _sized(params, led_target_ma=target)
            changes.append(f"LED current {jsmath.trim(target)} mA")
    elif _has(text, "brighter", "brighten", "more light", "increase the led", "more current"):
        target = _step(params.led_target_ma, +1)
        if target == params.led_target_ma:
            changes.append(f"already at the {jsmath.trim(jsmath.PIN_MAX_MA)} mA pin limit, so no change")
        else:
            params = _sized(params, led_target_ma=target)
            changes.append(f"LED current {jsmath.trim(target)} mA (brighter)")
    elif _has(text, "dimmer", "dim ", "dim.", "darker", "less light", "less current") or text.endswith("dim"):
        target = _step(params.led_target_ma, -1)
        if target == params.led_target_ma:
            changes.append(f"already at the lowest step ({jsmath.trim(CURRENT_STEPS[0])} mA), so no change")
        else:
            params = _sized(params, led_target_ma=target)
            changes.append(f"LED current {jsmath.trim(target)} mA (dimmer)")

    if _has(text, "remove", "drop", "delete", "no", "without", "get rid of") and _has(text, "debounce", "capacitor", "bounce"):
        if params.debounce_cap_nf != 0:
            params = params.model_copy(update={"debounce_cap_nf": 0})
            changes.append("removed the debounce capacitor")
    elif _has(text, "add", "include", "use", "with", "need") and _has(text, "debounce", "capacitor", "bounce"):
        if params.debounce_cap_nf == 0:
            params = params.model_copy(update={"debounce_cap_nf": DEFAULT_DEBOUNCE_NF})
            changes.append(f"added a {jsmath.trim(DEFAULT_DEBOUNCE_NF)} nF debounce capacitor")

    if not changes:
        raise PlanError("I couldn't tell what to change. " + HELP)
    return Plan(params=params, request=request, changes=changes)


def _clamp_current(milliamps: float, notes: list[str]) -> float:
    if milliamps < 1:
        raise PlanError("An indicator LED needs at least 1 mA.")
    if milliamps > jsmath.PIN_MAX_MA:
        notes.append(f"limited to the Uno's {jsmath.trim(jsmath.PIN_MAX_MA)} mA pin rating")
        return float(jsmath.PIN_MAX_MA)
    return milliamps
