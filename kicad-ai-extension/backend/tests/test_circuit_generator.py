"""Rule-based interpretation: template selection, parsing, and calculated values."""

import pytest

from app.ai.circuit_generator import (
    GenerationError,
    RuleBasedGenerator,
    current_amps,
    format_farads,
    format_ohms,
    frequency_hz,
    led_count,
    nearest_e,
    E12,
    E24,
    next_e_up,
    voltages,
)
from app.core.circuit_validator import validate_circuit

GEN = RuleBasedGenerator()

ALL_PROMPTS = [
    "A 5V LED with a current-limiting resistor",
    "3 green LEDs on 12V at 15mA",
    "voltage divider from 12V to 3.3V",
    "low-pass filter at 1kHz",
    "high pass filter cutoff 50 Hz",
    "555 timer blinking a blue LED at 2 Hz on 9V",
    "5V regulator from 12V",
    "3.3V LDO from 5V with power LED",
    "push button with pull-up on 3.3V and debounce",
    "push button with pull-down on 5V",
    "transistor to switch a red LED from a 3.3V GPIO on 5V",
]


def component(spec, ref):
    return next(c for c in spec.components if c.ref == ref)


def net(spec, name):
    return {(p.ref, p.pin) for p in next(n for n in spec.nets if n.name == name).connections}


@pytest.mark.parametrize("prompt", ALL_PROMPTS)
def test_every_template_produces_a_valid_circuit(prompt: str) -> None:
    resolved = validate_circuit(GEN.generate(prompt))
    assert resolved.report.valid, resolved.report.errors
    assert resolved.report.warnings == []


def test_led_resistor_value() -> None:
    spec = GEN.generate("red LED on 5V at 10mA")
    # (5 - 2.0) / 0.010 = 300 ohm -> next E12 up = 330
    assert component(spec, "R1").value == "330"
    assert component(spec, "BT1").kind == "battery" and component(spec, "BT1").value == "5V"
    assert net(spec, "+5V") == {("BT1", "+"), ("R1", "1")}
    assert net(spec, "GND") == {("BT1", "-"), ("D1", "K")}


def test_led_count_and_color() -> None:
    spec = GEN.generate("3 green LEDs on 12V at 15mA")
    leds = [c for c in spec.components if c.kind == "led"]
    assert len(leds) == 3 and all(c.value == "LED_Green" for c in leds)
    assert component(spec, "R1").value == "680"  # (12 - 2.2) / 0.015 = 653 -> 680


def test_voltage_divider_values() -> None:
    spec = GEN.generate("voltage divider from 12V to 3.3V")
    assert component(spec, "R1").value == "27k"  # 10k * (12/3.3 - 1) = 26.4k -> 27k (E24)
    assert component(spec, "R2").value == "10k"
    assert net(spec, "VOUT") == {("R1", "2"), ("R2", "1"), ("J1", "1")}
    # "Y from X" phrasing: X is the input.
    reversed_phrase = GEN.generate("divider for 3.3V from 12V")
    assert component(reversed_phrase, "R1").value == "27k"


def test_low_pass_vs_high_pass_topology() -> None:
    low = GEN.generate("low-pass filter at 1kHz")
    high = GEN.generate("high-pass filter at 1kHz")
    assert component(low, "C1").value == "15n"  # 1 / (2 pi 10k 1k) = 15.9n -> 15n (E6)
    assert ("R1", "1") in net(low, "IN") and ("C1", "1") in net(high, "IN")


def test_555_uses_all_power_pins() -> None:
    spec = GEN.generate("555 timer blinking a blue LED at 2 Hz on 9V")
    assert {("U1", "VCC"), ("U1", "RST")} <= net(spec, "+9V")
    assert ("U1", "GND") in net(spec, "GND")
    assert {("U1", "THRES"), ("U1", "TRIG")} <= net(spec, "TIMING")


def test_regulator_selection() -> None:
    assert component(GEN.generate("5V regulator from 12V"), "U1").value == "L7805"
    spec = GEN.generate("3.3V LDO from 5V with power LED")
    assert component(spec, "U1").value == "AMS1117-3.3"
    assert ("U1", "IN") in net(spec, "+5V") and ("U1", "OUT") in net(spec, "+3V3")


@pytest.mark.parametrize(
    ("prompt", "message"),
    [
        ("blue LED on 3V", "too low"),
        ("LED on 5V at 200mA", "between 1 mA and 50 mA"),
        ("voltage divider", "input and output voltage"),
        ("voltage divider from 3V to 5V", "lower than the input"),
        ("voltage divider 3V to 5V", "lower than the input"),
        ("555 blinker on 24V", "4.5 V to 15 V"),
        ("5V regulator from 6V", "7 V to 35 V"),
        ("an FPGA dev board", "Supported circuits"),
    ],
)
def test_unsupported_or_impossible_requests(prompt: str, message: str) -> None:
    with pytest.raises(GenerationError, match=message):
        GEN.generate(prompt)


def test_parsers() -> None:
    assert voltages("from 12V to 3.3 volts or 3v3") == [12.0, 3.3, 3.3]
    assert current_amps("at 15mA") == 0.015
    assert frequency_hz("cutoff 2.5 kHz") == 2500.0
    assert led_count("three red LEDs") == 3
    assert led_count("an LED") == 1


def test_standard_values() -> None:
    assert nearest_e(26_400, E24) == pytest.approx(27_000)
    assert next_e_up(300, E12) == pytest.approx(330)
    assert format_ohms(4700) == "4.7k"
    assert format_ohms(1_000_000) == "1M"
    assert format_farads(1.5e-8) == "15n"
    assert format_farads(1e-5) == "10u"
