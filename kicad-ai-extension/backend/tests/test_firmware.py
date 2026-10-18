"""Firmware for microcontroller circuits: prompt -> plan -> Arduino C++ that really behaves as asked.

The sketch is compiled with the host C++ compiler against a tiny Arduino stub
(tests/firmware_sim) and run against scripted button presses, so these tests check
behaviour, not just text.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.ai.circuit_generator import RuleBasedGenerator
from app.ai.firmware import arduino_sketch, needs_microcontroller, plan_from_prompt
from app.core.circuit_validator import validate_circuit
from app.core.erc import find_kicad_cli, run_erc
from app.core.schematic_renderer import render_schematic
from app.main import create_app

SIM = Path(__file__).parent / "firmware_sim"
CXX = shutil.which("c++") or shutil.which("clang++") or shutil.which("g++")
needs_cxx = pytest.mark.skipif(CXX is None, reason="no C++ compiler")
needs_kicad = pytest.mark.skipif(find_kicad_cli() is None, reason="kicad-cli not installed")

USER_PROMPT = "red led blinks when button is pressed once, green led blinks if its pressed twice under 0.5s"
A0, A1 = 14, 15
RED, GREEN = 9, 10

MCU_PROMPTS = [
    USER_PROMPT,
    "arduino with a button and an LED",
    "three LEDs blink when the button is pressed twice",
    "blue LED on while the button is held, red led turns on for 3 seconds when button 2 is pressed",
    "two buttons: red LED toggles when the first button is pressed, blue LED blinks 5 times when the second "
    "button is pressed, green and yellow LEDs blink when you hold the first button for 2 seconds",
]


# --- prompt understanding ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("prompt", "expected"),
    [
        (USER_PROMPT, True),
        ("LED blinks when the button is pressed", True),
        ("arduino with an LED", True),
        ("555 timer blinking a blue LED at 2 Hz on 9V", False),
        ("push button with pull-up on 3.3V and debounce", False),
        ("red LED on 5V at 10mA", False),
    ],
)
def test_needs_microcontroller(prompt: str, expected: bool) -> None:
    assert needs_microcontroller(prompt) is expected


def test_user_prompt_plan() -> None:
    plan = plan_from_prompt(USER_PROMPT)
    assert plan.leds == ["red", "green"]
    assert plan.buttons == 1
    assert plan.multi_press_ms == 500
    got = {(b.trigger, b.action, plan.leds[b.led]) for b in plan.behaviours}
    assert got == {("press", "blink", "red"), ("double", "blink", "green")}
    assert any("waits" in a for a in plan.assumptions)  # explains why a single press reacts late


def test_generator_routes_behaviour_to_the_microcontroller_template() -> None:
    spec = RuleBasedGenerator().generate(USER_PROMPT)
    kinds = sorted(c.kind for c in spec.components)
    assert kinds == ["arduino_nano", "led", "led", "push_button", "resistor", "resistor"]


@pytest.mark.parametrize(
    ("prompt", "board"),
    [
        (USER_PROMPT, "arduino_nano"),
        ("arduino where a button toggles a red LED", "arduino_nano"),  # "arduino" alone doesn't mean the Uno designer
        ("two-player football game with two joysticks and LEDs", "arduino_uno"),
        ("arduino with a buzzer that beeps when a button is pressed twice", "arduino_uno"),
    ],
)
def test_service_sends_button_led_behaviour_to_the_firmware_path(prompt: str, board: str) -> None:
    from app.ai.generator import Generator

    generated = Generator().generate(prompt)
    assert board in {c.kind for c in generated.spec.components}
    assert generated.source == "rules"


# --- schematic ----------------------------------------------------------------------------


@pytest.mark.parametrize("prompt", MCU_PROMPTS)
def test_mcu_circuits_are_valid_with_only_unused_pin_warnings(prompt: str) -> None:
    resolved = validate_circuit(RuleBasedGenerator().generate(prompt))
    assert resolved.report.valid, resolved.report.errors
    assert {w.code for w in resolved.report.warnings} <= {"PIN_UNCONNECTED"}
    assert all(w.ref == "A1" for w in resolved.report.warnings)


@pytest.mark.parametrize("prompt", MCU_PROMPTS)
def test_mcu_circuits_are_drawn_with_wires_only(prompt: str) -> None:
    """The planned layout joins every pin with a wire: no net falls back to name labels."""
    files = render_schematic(validate_circuit(RuleBasedGenerator().generate(prompt)), prompt)
    assert files.schematic.count("(label ") == 0


@needs_kicad
@pytest.mark.parametrize("prompt", MCU_PROMPTS)
def test_mcu_kicad_erc_passes_and_netlist_matches(prompt: str) -> None:
    from app.core.netlist_check import export_nets

    resolved = validate_circuit(RuleBasedGenerator().generate(prompt))
    files = render_schematic(resolved, prompt)
    erc = run_erc(files, find_kicad_cli())
    assert erc.ran, erc.message
    assert erc.violations == [], [f"{v.type}: {v.description} {v.items}" for v in erc.violations]
    expected = {frozenset(pins) for pins in resolved.net_pins.values()}
    # KiCad lists every unused (no-connect) pin as its own one-pin net; compare the real connections.
    actual = {pins for pins in export_nets(files, find_kicad_cli()).values() if len(pins) > 1}
    assert actual == {pins for pins in expected if len(pins) > 1}


# --- behaviour, by running the sketch -------------------------------------------------------


def _build(prompt: str, tmp_path: Path) -> Path:
    plan = plan_from_prompt(prompt)
    sketch = tmp_path / "sketch.ino"
    sketch.write_text(arduino_sketch(plan, "test"), encoding="utf-8")
    exe = tmp_path / "sim"
    subprocess.run(
        [CXX, "-std=c++17", "-Wall", "-Werror", "-Wno-unused-variable", f"-I{SIM}", f'-DSKETCH="{sketch}"', str(SIM / "harness.cpp"), "-o", str(exe)],
        check=True, capture_output=True, text=True,
    )
    return exe


def _run(exe: Path, end_ms: int, presses: list[tuple[int, int, int]]) -> dict[int, tuple[int, int]]:
    """presses: (pin, down_at_ms, up_at_ms). Returns pin -> (blinks/rises, ms on)."""
    changes = sorted([(down, pin, 0) for pin, down, _ in presses] + [(up, pin, 1) for pin, _, up in presses])
    script = f"{end_ms}\n" + "".join(f"{t} {pin} {level}\n" for t, pin, level in changes)
    out = subprocess.run([str(exe)], input=script, capture_output=True, text=True, check=True).stdout
    result = {int(p): (int(r), int(h)) for p, r, h in (line.split() for line in out.splitlines())}
    return {pin: result.get(pin, (0, 0)) for pin in (9, 10, 11, 12)}


@needs_cxx
def test_single_press_blinks_red_only(tmp_path: Path) -> None:
    leds = _run(_build(USER_PROMPT, tmp_path), 3000, [(A0, 100, 200)])
    assert leds[RED][0] == 3 and leds[GREEN][0] == 0


@needs_cxx
def test_double_press_within_window_blinks_green_only(tmp_path: Path) -> None:
    leds = _run(_build(USER_PROMPT, tmp_path), 3000, [(A0, 100, 180), (A0, 330, 410)])
    assert leds[GREEN][0] == 3 and leds[RED][0] == 0


@needs_cxx
def test_two_slow_presses_are_two_singles(tmp_path: Path) -> None:
    leds = _run(_build(USER_PROMPT, tmp_path), 5000, [(A0, 100, 180), (A0, 1200, 1280)])  # 1 s apart > 0.5 s
    assert leds[GREEN][0] == 0 and leds[RED][0] == 6


@needs_cxx
def test_contact_bounce_is_one_press(tmp_path: Path) -> None:
    bouncy = [(A0, 100 + 2 * k, 101 + 2 * k) for k in range(5)] + [(A0, 110, 220)]  # 10 ms of chatter, then held
    leds = _run(_build(USER_PROMPT, tmp_path), 3000, bouncy)
    assert leds[RED][0] == 3 and leds[GREEN][0] == 0


@needs_cxx
def test_held_and_timed_behaviours(tmp_path: Path) -> None:
    exe = _build("blue LED on while the button is held, red led turns on for 3 seconds when button 2 is pressed", tmp_path)
    plan = plan_from_prompt("blue LED on while the button is held, red led turns on for 3 seconds when button 2 is pressed")
    blue, red = 9 + plan.leds.index("blue"), 9 + plan.leds.index("red")
    leds = _run(exe, 6000, [(A0, 100, 600), (A1, 1000, 1100)])
    assert 420 <= leds[blue][1] <= 520  # on while held (minus 30 ms debounce)
    assert 2900 <= leds[red][1] <= 3100  # on for 3 s after the press


@needs_cxx
def test_long_press_and_second_button(tmp_path: Path) -> None:
    prompt = MCU_PROMPTS[-1]
    plan = plan_from_prompt(prompt)
    exe = _build(prompt, tmp_path)
    pin = {c: 9 + plan.leds.index(c) for c in plan.leds}
    held = _run(exe, 6000, [(A0, 100, 2400)])  # hold button 1 for 2.3 s
    assert held[pin["green"]][0] == 3 and held[pin["yellow"]][0] == 3 and held[pin["red"]][0] == 0
    second = _run(exe, 6000, [(A1, 100, 200)])
    assert second[pin["blue"]][0] == 5
    toggle = _run(exe, 6000, [(A0, 100, 200), (A0, 2000, 2100)])  # two short presses on button 1: on, then off
    assert toggle[pin["red"]][0] == 1 and toggle[pin["red"]][1] >= 1800


# --- API -----------------------------------------------------------------------------------


def test_generate_returns_firmware_only_for_microcontrollers() -> None:
    with TestClient(create_app()) as client:
        mcu = client.post("/api/generate", json={"prompt": USER_PROMPT}).json()
        led = client.post("/api/generate", json={"prompt": "red LED on 5V at 10mA"}).json()
    assert mcu["firmware"]["board"].startswith("Arduino Nano")
    assert mcu["firmware"]["file_name"].endswith(".ino")
    assert "MULTI_PRESS_MS = 500" in mcu["firmware"]["code"]
    assert led["firmware"] is None
