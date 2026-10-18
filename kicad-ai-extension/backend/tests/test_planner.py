import pytest

from app.engine import jsmath
from app.engine.design import DesignParams
from app.engine.planner import CURRENT_STEPS, PlanError, find_color, find_milliamps, plan

START = "When I press a button, a red LED should light up. Use an Arduino Uno."


def fresh(prompt: str = START):
    return plan(prompt)


def test_fresh_design_defaults() -> None:
    result = fresh()
    p = result.params
    assert result.is_new and result.request == START
    assert (p.supply, p.led_vf, p.led_target_ma, p.led_resistor, p.pull_down, p.debounce_cap_nf) == (5, 2.0, 15, 220, 10_000, 100)
    assert p.led_color == "red"


@pytest.mark.parametrize(("color", "vf", "resistor"), [("red", 2.0, 220), ("green", 2.2, 220), ("yellow", 2.1, 220),
                                                       ("blue", 3.1, 150), ("white", 3.1, 150)])
def test_colour_sets_forward_voltage_and_resistor(color: str, vf: float, resistor: float) -> None:
    p = fresh(f"When I press a button a {color} LED should light").params
    assert (p.led_color, p.led_vf, p.led_resistor) == (color, vf, resistor)
    # The chosen resistor never lets more than the target through.
    assert jsmath.led_design(p.supply, p.led_vf, p.led_target_ma, p.led_resistor).current * 1000 <= p.led_target_ma


def test_milliamps_in_the_request() -> None:
    p = fresh("press a button to light a red LED at 10 mA").params
    assert p.led_target_ma == 10 and p.led_resistor == 330  # (5 - 2) / 10 mA = 300 -> next E12 = 330
    assert fresh("press a button to light a red LED at 50 mA").params.led_target_ma == 20  # clamped to the pin rating


def test_brighter_and_dimmer_walk_the_steps() -> None:
    p = fresh().params
    seen = [p.led_target_ma]
    for _ in range(4):
        p = plan("make the LED brighter", p).params
        seen.append(p.led_target_ma)
    assert seen == [15, 20, 20, 20, 20]
    p = fresh().params
    seen = [p.led_target_ma]
    for _ in range(5):
        p = plan("make it dimmer", p).params
        seen.append(p.led_target_ma)
    assert seen == [15, 10, 5, 2, 2, 2]


def test_brighter_resizes_the_resistor_and_keeps_the_rest() -> None:
    before = fresh().params
    result = plan("make the LED brighter", before)
    after = result.params
    assert (after.led_target_ma, after.led_resistor) == (20, 150)  # (5 - 2) / 20 mA = 150
    assert (after.pull_down, after.debounce_cap_nf, after.led_color) == (before.pull_down, before.debounce_cap_nf, "red")
    assert not result.is_new and "brighter" in result.changes[0]


def test_at_the_limit_nothing_changes_but_it_says_so() -> None:
    p = plan("make the LED brighter", fresh().params).params
    result = plan("brighter please", p)
    assert result.params == p and "pin limit" in result.changes[0]


def test_change_colour_keeps_current_and_resizes() -> None:
    result = plan("use a blue LED", fresh().params)
    assert (result.params.led_color, result.params.led_vf, result.params.led_resistor) == ("blue", 3.1, 150)
    assert result.params.led_target_ma == 15


def test_set_current_directly() -> None:
    assert plan("set the LED to 5 mA", fresh().params).params.led_target_ma == 5


def test_debounce_toggle() -> None:
    p = fresh().params
    off = plan("remove the debounce capacitor", p).params
    assert off.debounce_cap_nf == 0
    on = plan("add a debounce capacitor", off).params
    assert on.debounce_cap_nf == 100
    assert plan("without debounce, a red LED lights when I press the button").params.debounce_cap_nf == 0


def test_request_text_survives_edits() -> None:
    result = plan("make the LED brighter", fresh().params, START)
    assert result.request == START


@pytest.mark.parametrize("prompt", ["make the LED brighter", "use a blue LED", "remove the debounce"])
def test_edits_need_a_design_first(prompt: str) -> None:
    with pytest.raises(PlanError, match="no design yet"):
        plan(prompt)


@pytest.mark.parametrize("prompt", ["what's the weather", "make it purple", "reticulate the splines"])
def test_unknown_edits_explain_themselves(prompt: str) -> None:
    with pytest.raises(PlanError, match="couldn't tell what to change"):
        plan(prompt, fresh().params)


def test_zero_milliamps_rejected() -> None:
    with pytest.raises(PlanError, match="at least 1 mA"):
        plan("set the LED to 0 mA", fresh().params)


def test_parsers() -> None:
    assert find_color("a green led") == "green" and find_color("an led") is None
    assert find_milliamps("at 12.5 ma please") == 12.5 and find_milliamps("5 volts") is None


def test_every_brightness_step_is_allowed_by_the_parameter_limits() -> None:
    for ma in CURRENT_STEPS:
        DesignParams.for_color("white", led_target_ma=ma)  # validates ranges (resistor >= 47 ohm, etc.)
