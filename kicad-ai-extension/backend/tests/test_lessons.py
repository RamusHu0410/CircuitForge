"""Classroom lessons: one per generated circuit, built from that circuit's own values."""

from __future__ import annotations

import math
import re

import pytest

from app.ai.circuit_generator import RuleBasedGenerator
from app.ai.lessons import build_lesson, parse_value, tex
from app.config import Settings
from app.schemas.circuit import GenerateRequest
from app.services.generation_service import GenerationService
from tests.test_circuit_generator import ALL_PROMPTS
from tests.test_firmware import MCU_PROMPTS, USER_PROMPT

SERVICE = GenerationService(Settings(erc_enabled=False))
ALLOWED_NAMES = {"sqrt", "exp", "log", "PI", "min", "max", "abs"}
SAFE_EXPR = re.compile(r"^[0-9A-Za-z_+\-*/().,\s]*$")


def lesson_for(prompt: str):
    return SERVICE.generate(GenerateRequest(prompt=prompt)).lesson


def evaluate(expr: str, params: dict[str, float]) -> float:
    """Evaluate a playground expression the way the window does (same restricted syntax)."""
    assert SAFE_EXPR.match(expr), expr
    names = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", expr))
    assert names <= ALLOWED_NAMES | set(params), f"unknown names {names - ALLOWED_NAMES - set(params)} in {expr}"
    scope = {"sqrt": math.sqrt, "exp": math.exp, "log": math.log, "PI": math.pi, "min": min, "max": max, "abs": abs, **params}
    return float(eval(expr, {"__builtins__": {}}, scope))  # noqa: S307 - restricted names, checked above


@pytest.mark.parametrize("prompt", ALL_PROMPTS + MCU_PROMPTS)
def test_every_circuit_gets_a_full_lesson(prompt: str) -> None:
    lesson = lesson_for(prompt)
    kinds = [s.kind for s in lesson.sections]
    assert kinds[0] == "overview" and kinds[-2:] == ["build", "check"]
    assert "parts" in kinds and "math" in kinds
    assert len({s.id for s in lesson.sections}) == len(lesson.sections)  # ids are unique (the UI links steps to them)
    for s in lesson.sections:
        assert s.text.eli5 and s.text.beginner and s.text.expert, s.id


@pytest.mark.parametrize("prompt", ALL_PROMPTS + MCU_PROMPTS)
def test_quizzes_and_playgrounds_are_well_formed(prompt: str) -> None:
    for s in lesson_for(prompt).sections:
        for q in s.quiz:
            assert 0 <= q.answer < len(q.options) and len(set(q.options)) == len(q.options), (s.id, q)
        if s.playground:
            params = {p.name: p.value for p in s.playground.params}
            for p in s.playground.params:
                assert p.min <= p.value <= p.max, (s.id, p)
            for out in s.playground.outputs:
                assert math.isfinite(evaluate(out.expr, params)), (s.id, out.expr)


def test_led_math_matches_the_generated_values() -> None:
    lesson = lesson_for("red LED on 5V at 10mA")
    led = next(s for s in lesson.sections if s.id.startswith("math-R"))
    params = {p.name: p.value for p in led.playground.params}
    assert params == {"Vs": 5.0, "Vf": 2.0, "R": 330.0}
    current = evaluate(led.playground.outputs[0].expr, params)
    assert current == pytest.approx(3 / 330 * 1000)
    q = led.quiz[0]
    assert q.options[q.answer] == "9.09 mA"  # (5 - 2) V / 330 ohm


def test_microcontroller_lesson_walks_through_the_real_code() -> None:
    result = SERVICE.generate(GenerateRequest(prompt=USER_PROMPT))
    code = next(s for s in result.lesson.sections if s.kind == "code")
    assert [c.title.split(":")[-1].strip() for c in code.code] == ["handle()", "updateButtons()", "updateLeds()"]
    lines = result.firmware.code.splitlines()
    for excerpt in code.code:
        assert lines[excerpt.start_line - 1] == excerpt.code.splitlines()[0]  # line numbers point into the real sketch
    assert any("500 ms" in q.question for q in code.quiz)  # the single-vs-double wait is explained


def test_build_steps_use_this_circuits_parts_and_nets() -> None:
    result = SERVICE.generate(GenerateRequest(prompt="555 timer blinking a blue LED at 2 Hz on 9V"))
    build = next(s for s in result.lesson.sections if s.kind == "build")
    text = " ".join(f"{b.title} {b.detail}" for b in build.steps)
    assert "Timer:NE555P" in text and "Device:R ×3" in text and "R2 = 33k" in text and "PWR_FLAG" in text


def test_lesson_needs_no_kicad() -> None:
    spec = RuleBasedGenerator().generate("voltage divider from 12V to 3.3V")
    from app.core.circuit_validator import validate_circuit
    from app.core.schematic_renderer import render_schematic
    from app.schemas.circuit import ErcReport

    resolved = validate_circuit(spec)
    lesson = build_lesson(spec, resolved.report, ErcReport(ran=False, message="ERC skipped"), render_schematic(resolved))
    assert next(s for s in lesson.sections if s.kind == "check").facts[2].value == "ERC skipped"


@pytest.mark.parametrize(("text", "value"), [("330", 330), ("4.7k", 4700), ("4k7", 4700), ("100n", 1e-7), ("10u", 1e-5), ("9V", 9), ("1M", 1e6)])
def test_parse_value(text: str, value: float) -> None:
    assert parse_value(text) == pytest.approx(value)


def test_tex_units() -> None:
    assert tex(0.00909, "A") == r"9.09\,\text{mA}"
    assert tex(330, "Ω") == r"330\,\Omega"
    assert tex(10_000, "Ω") == r"10\,\text{k}\Omega"
    assert tex(0.000143, "A") == r"143\,\mu\text{A}"
