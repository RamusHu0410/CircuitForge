"""Action logic: every backend failure becomes a user-facing Outcome, never an exception."""

import pytest

from actions.generate_schematic import MAX_PROMPT_LENGTH, GenerateSchematicAction, validate_prompt
from backend_client import BackendClient
from conftest import FakeBackend
from kicad_client.connection import KiCadContext

NO_KICAD = KiCadContext(connected=False, error="not running")


def test_success(fake_backend: FakeBackend) -> None:
    kicad = KiCadContext(connected=True, kicad_version="11.0.0", project_name="blinky")
    outcome = GenerateSchematicAction(BackendClient(fake_backend.url), kicad).submit("  LED circuit ")

    assert outcome.ok
    assert outcome.title == "Prompt received"
    assert "Request ID: abc123" in outcome.message
    _, _, body = fake_backend.requests[-1]
    assert b'"prompt": "LED circuit"' in body
    assert b'"project_name": "blinky"' in body


def test_backend_unavailable(unused_url: str) -> None:
    outcome = GenerateSchematicAction(BackendClient(unused_url), NO_KICAD).submit("LED")
    assert not outcome.ok
    assert outcome.title == "Backend not available"
    assert "uvicorn" in outcome.message


def test_backend_error(fake_backend: FakeBackend) -> None:
    fake_backend.set_raw("POST", "/api/generate", 500, b"boom")
    outcome = GenerateSchematicAction(BackendClient(fake_backend.url), NO_KICAD).submit("LED")
    assert not outcome.ok and outcome.title == "Backend error"


def test_unexpected_exception_is_contained() -> None:
    class Exploding:
        def health(self):
            raise RuntimeError("bug")

    outcome = GenerateSchematicAction(Exploding(), NO_KICAD).submit("LED")  # type: ignore[arg-type]
    assert not outcome.ok and outcome.title == "Unexpected error"


@pytest.mark.parametrize("prompt", ["", "   \n", "x" * (MAX_PROMPT_LENGTH + 1)])
def test_invalid_prompt_not_sent(fake_backend: FakeBackend, prompt: str) -> None:
    outcome = GenerateSchematicAction(BackendClient(fake_backend.url), NO_KICAD).submit(prompt)
    assert not outcome.ok
    assert fake_backend.requests == []


def test_validate_prompt_limits() -> None:
    assert validate_prompt("x" * MAX_PROMPT_LENGTH) is None
    assert validate_prompt(" " + "x" * MAX_PROMPT_LENGTH + " ") is None  # surrounding whitespace ignored
