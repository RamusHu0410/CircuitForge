"""Complex microcontroller projects: prompt -> plan -> Uno circuit -> KiCad."""

import json

import pytest

from app.ai.circuit_generator import GenerationError
from app.ai.generator import Generator
from app.ai.llm_planner import LlmError, LlmPlanner
from app.ai.system_designer import build_system
from app.ai.system_rules import plan_system, wants_system
from app.config import Settings
from app.core.circuit_validator import validate_circuit
from app.core.erc import find_kicad_cli
from app.core.netlist_check import export_nets
from app.core.schematic_renderer import render_schematic
from app.schemas.system import Button, Joystick, LedGroup, SystemPlan

FOOTBALL = "Build a two-player football game controlled by two joysticks, with LEDs indicating the game state and scoring."
CLI = find_kicad_cli(None)


def test_football_plan_counts_modules() -> None:
    plan = plan_system(FOOTBALL)
    kinds = [type(m).__name__ for m in plan.modules]
    assert kinds.count("Joystick") == 2
    groups = {m.label: m.count for m in plan.modules if isinstance(m, LedGroup)}
    assert groups == {"BALL": 7, "SC1": 3, "SC2": 3}


def test_simple_prompts_still_use_templates() -> None:
    assert not wants_system("555 timer blinking an LED at 2 Hz on 9V")
    assert not wants_system("5V regulator from 12V")


def test_football_is_valid_and_pins_do_not_collide() -> None:
    spec = build_system(plan_system(FOOTBALL))
    resolved = validate_circuit(spec)
    assert resolved.report.valid, resolved.report.errors
    uno_pins = [pin for pins in resolved.net_pins.values() for ref, pin in pins if ref == "A1"]
    signal = [p for p in uno_pins if p not in ("5", "6", "7", "29")]
    assert len(signal) == len(set(signal))
    assert any(c.kind == "shift_register_74hc595" for c in spec.components)  # 13 LEDs + inputs do not fit directly


@pytest.mark.skipif(CLI is None, reason="kicad-cli not installed")
def test_football_schematic_matches_spec_in_kicad() -> None:
    spec = build_system(plan_system(FOOTBALL))
    resolved = validate_circuit(spec)
    files = render_schematic(resolved)
    kicad = export_nets(files, CLI)
    drawn = {pins for pins in kicad.values()}
    for net, pins in resolved.net_pins.items():
        wanted = frozenset(p for p in pins if not p[0].startswith("#"))
        # Uno has three GND pins and KiCad lists every pin of the net, so compare as a subset.
        assert any(wanted <= d and d <= wanted for d in drawn) or any(wanted == d for d in drawn), net


def test_too_many_analog_inputs_is_rejected() -> None:
    plan = SystemPlan(title="x", modules=[Joystick(label=f"J{i}") for i in range(4)])
    with pytest.raises(GenerationError, match="analog"):
        build_system(plan)


def test_too_many_leds_is_rejected() -> None:
    plan = SystemPlan(title="x", modules=[LedGroup(label=f"G{i}", count=16) for i in range(3)] + [Button(label="B")])
    with pytest.raises(GenerationError):
        build_system(plan)


def test_small_project_drives_leds_directly() -> None:
    spec = build_system(plan_system("Arduino with a joystick controlling 4 LEDs and a buzzer"))
    kinds = {c.kind for c in spec.components}
    assert "shift_register_74hc595" not in kinds and "buzzer" in kinds
    assert validate_circuit(spec).report.valid


def _fake(reply: str):
    def transport(url, headers, body, timeout):
        assert headers["x-api-key"] == "k" and url.endswith("/v1/messages")
        return json.dumps({"content": [{"type": "text", "text": reply}]}).encode()

    return transport


PLAN_JSON = json.dumps(
    {"title": "Traffic light", "modules": [
        {"type": "led_group", "label": "RED", "count": 1, "color": "red"},
        {"type": "led_group", "label": "GRN", "count": 1, "color": "green"},
        {"type": "button", "label": "WALK"}]}
)


def test_llm_plan_is_used_and_validated() -> None:
    gen = Generator(LlmPlanner("k", "m", transport=_fake("Here:\n```json\n" + PLAN_JSON + "\n```")))
    result = gen.generate("traffic light with a walk button")
    assert result.source == "llm" and validate_circuit(result.spec).report.valid


def test_bad_llm_reply_falls_back_to_rules() -> None:
    gen = Generator(LlmPlanner("k", "m", transport=_fake('{"title": "x", "modules": [{"type": "flamethrower"}]}')))
    assert gen.generate(FOOTBALL).source == "rules"
    with pytest.raises(LlmError):
        LlmPlanner("k", "m", transport=_fake("no json")).plan("x")


def test_llm_off_without_key() -> None:
    assert Generator.from_settings(Settings(llm_api_key=None, llm_model=None)).llm is None


def test_gemini_request_and_reply_shapes() -> None:
    seen = {}

    def transport(url, headers, body, timeout):
        seen.update(url=url, key=headers["x-goog-api-key"], body=json.loads(body))
        return json.dumps({"candidates": [{"content": {"parts": [{"text": PLAN_JSON}]}}]}).encode()

    plan = LlmPlanner("secret", "gemini-2.5-flash", "https://generativelanguage.googleapis.com", transport=transport, provider="gemini").plan("x")
    assert plan.title == "Traffic light"
    assert seen["url"].endswith("/v1beta/models/gemini-2.5-flash:generateContent") and seen["key"] == "secret"
    assert seen["body"]["contents"][0]["parts"][0]["text"] == "x"


def test_gemini_key_enables_gemini_planner() -> None:
    gen = Generator.from_settings(Settings(gemini_api_key="k"))
    assert gen.llm is not None and gen.llm.provider == "gemini"


def test_translate_endpoint_and_build_from_plan(client) -> None:
    r = client.post("/api/translate", json={"prompt": FOOTBALL})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "rules" and 'led_group(label="BALL", count=7, color="yellow"' in " ".join(body["calls"])
    g = client.post("/api/generate", json={"prompt": FOOTBALL, "plan": body["plan"]})
    assert g.status_code == 200 and g.json()["generator"] == "plan"
    assert client.post("/api/translate", json={"prompt": "5V regulator from 12V"}).status_code == 422
