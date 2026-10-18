"""Action logic: every failure becomes a user-facing Outcome, never an exception."""

from pathlib import Path

import pytest

from actions.generate_schematic import MAX_PROMPT_LENGTH, GenerateSchematicAction, validate_prompt
from backend_client import BackendClient
from conftest import FakeBackend
from kicad_client.connection import KiCadContext

NO_KICAD = KiCadContext(connected=False, error="not running")


def action(url: str, out: Path, kicad: KiCadContext = NO_KICAD) -> GenerateSchematicAction:
    return GenerateSchematicAction(BackendClient(url), kicad, output_dir=out)


def test_success_writes_new_project(fake_backend: FakeBackend, tmp_path: Path) -> None:
    kicad = KiCadContext(connected=True, kicad_version="10.0.7", project_name="blinky")
    outcome = action(fake_backend.url, tmp_path, kicad).submit("  LED circuit ")

    assert outcome.ok, outcome.message
    assert outcome.title == "Generated 'Red LED indicator'"
    assert outcome.schematic_path == tmp_path / "red_led_indicator" / "red_led_indicator.kicad_sch"
    assert outcome.schematic_path.read_text().startswith("(kicad_sch")
    assert (tmp_path / "red_led_indicator" / "red_led_indicator.kicad_pro").is_file()
    assert "R1 330 (LED current limiting)" in outcome.message
    assert "ERC: passed" in outcome.message
    _, _, body = fake_backend.requests[-1]
    assert b'"prompt": "LED circuit"' in body and b'"project_name": "blinky"' in body


def test_second_generation_never_overwrites(fake_backend: FakeBackend, tmp_path: Path) -> None:
    first = action(fake_backend.url, tmp_path).submit("LED")
    original = first.schematic_path.read_text()
    second = action(fake_backend.url, tmp_path).submit("LED")

    assert second.schematic_path == tmp_path / "red_led_indicator_2" / "red_led_indicator_2.kicad_sch"
    assert first.schematic_path.read_text() == original
    # Project name inside the files follows the new folder name.
    assert '(project "red_led_indicator_2"' in second.schematic_path.read_text()
    assert "red_led_indicator_2.kicad_pro" in second.schematic_path.with_suffix(".kicad_pro").read_text()


def test_output_dir_defaults_to_project_folder(tmp_path: Path) -> None:
    kicad = KiCadContext(connected=True, kicad_version="10.0.7", project_dir=str(tmp_path))
    assert GenerateSchematicAction(BackendClient("http://127.0.0.1:1"), kicad).output_dir == tmp_path / "ai_generated"


def test_backend_unavailable(unused_url: str, tmp_path: Path) -> None:
    outcome = action(unused_url, tmp_path).submit("LED")
    assert not outcome.ok
    assert outcome.title == "Backend not available"
    assert "uvicorn" in outcome.message
    assert list(tmp_path.iterdir()) == []


def test_unsupported_prompt_shows_backend_explanation(fake_backend: FakeBackend, tmp_path: Path) -> None:
    fake_backend.set_json("POST", "/api/generate", 422, {"detail": "I couldn't match that. Supported circuits: ..."})
    outcome = action(fake_backend.url, tmp_path).submit("an FPGA")
    assert not outcome.ok
    assert outcome.title == "Can't generate that yet"
    assert outcome.message.startswith("I couldn't match that")


def test_backend_error(fake_backend: FakeBackend, tmp_path: Path) -> None:
    fake_backend.set_raw("POST", "/api/generate", 500, b"boom")
    outcome = action(fake_backend.url, tmp_path).submit("LED")
    assert not outcome.ok and outcome.title == "Backend error"


@pytest.mark.parametrize("bad_name", ["../../evil", "with space", "", "UPPER"])
def test_unsafe_file_name_rejected(fake_backend: FakeBackend, tmp_path: Path, bad_name: str) -> None:
    from conftest import GENERATED_RESPONSE

    fake_backend.set_json("POST", "/api/generate", 200, {**GENERATED_RESPONSE, "files": {
        **GENERATED_RESPONSE["files"], "name": bad_name}})
    outcome = action(fake_backend.url, tmp_path / "out").submit("LED")
    assert not outcome.ok and outcome.title == "Could not save"
    assert not (tmp_path.parent / "evil").exists()


def test_unwritable_output_dir(fake_backend: FakeBackend, tmp_path: Path) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("x")
    outcome = action(fake_backend.url, blocker / "sub").submit("LED")
    assert not outcome.ok and outcome.title == "Could not save"


def test_unexpected_exception_is_contained(tmp_path: Path) -> None:
    class Exploding:
        def health(self):
            raise RuntimeError("bug")

    outcome = GenerateSchematicAction(Exploding(), NO_KICAD, output_dir=tmp_path).submit("LED")  # type: ignore[arg-type]
    assert not outcome.ok and outcome.title == "Unexpected error"


@pytest.mark.parametrize("prompt", ["", "   \n", "x" * (MAX_PROMPT_LENGTH + 1)])
def test_invalid_prompt_not_sent(fake_backend: FakeBackend, tmp_path: Path, prompt: str) -> None:
    outcome = action(fake_backend.url, tmp_path).submit(prompt)
    assert not outcome.ok
    assert fake_backend.requests == []


def test_validate_prompt_limits() -> None:
    assert validate_prompt("x" * MAX_PROMPT_LENGTH) is None
    assert validate_prompt(" " + "x" * MAX_PROMPT_LENGTH + " ") is None  # surrounding whitespace ignored
