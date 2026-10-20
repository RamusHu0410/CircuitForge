"""The plugin runs the engine itself (plugin/engine.py): nothing to start before clicking the button."""

from pathlib import Path

import pytest

import engine
import entrypoint
from backend_client import BackendResponseError
from kicad_client.connection import KiCadContext
from plugin_settings import PluginSettings

KICAD = KiCadContext(connected=True, kicad_version="10.0.7", project_name="demo", project_dir="/tmp/demo")


@pytest.fixture
def state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    engine.ensure_importable()
    from app import instance

    monkeypatch.setattr(instance, "state_dir", lambda: tmp_path)
    return tmp_path


class FakeProcess:
    def __init__(self, code: int | None) -> None:
        self.code, self.pid = code, 4242

    def poll(self) -> int | None:
        return self.code


def _fake_popen(monkeypatch: pytest.MonkeyPatch, code: int | None) -> list[list[str]]:
    launched: list[list[str]] = []
    monkeypatch.setattr(engine.subprocess, "Popen", lambda cmd, **kw: launched.append(cmd) or FakeProcess(code))
    monkeypatch.setattr(engine, "STARTUP_CHECK_S", 0.2)
    monkeypatch.setattr(engine, "ui_dir", lambda: Path("/ui"))
    return launched


def test_engine_found_in_the_repo_layout() -> None:
    assert engine.engine_root() is not None


def test_local_engine_generates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ERC_ENABLED", "false")
    result = engine.LocalEngine().generate("red LED on 5V at 10mA", {"kicad_version": "10.0.7"})
    assert result.status == "generated"
    assert result.schematic.startswith("(kicad_sch")
    assert any(c.startswith("D1") for c in result.components)


def test_local_engine_explains_what_it_cannot_build() -> None:
    with pytest.raises(BackendResponseError) as error:
        engine.LocalEngine().generate("a quantum flux capacitor for my time machine")
    assert error.value.status == 422


def test_open_window_launches_the_window(state: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    launched = _fake_popen(monkeypatch, code=None)
    assert engine.open_window(KICAD.as_window_context(), kicad_cli="/kicad/kicad-cli") is None
    [command] = launched
    assert command[1:3] == ["-m", "app.desktop"] and "--from-kicad" in command

    from app import instance

    assert instance.read_session(state)["project_name"] == "demo"


def test_second_click_hands_over_to_the_open_window(state: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app import instance

    launched = _fake_popen(monkeypatch, code=None)
    lock = instance.WindowLock(state)
    assert lock.acquire()
    try:
        assert engine.open_window({"project_name": "other"}) is None
    finally:
        lock.release()
    assert launched == []
    assert instance.read_session(state)["project_name"] == "other"


def test_window_that_dies_at_startup_is_reported(state: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_popen(monkeypatch, code=1)
    error = engine.open_window({})
    assert error and "window.log" in error


def test_button_uses_built_in_engine_and_falls_back_to_dialog(monkeypatch: pytest.MonkeyPatch) -> None:
    dialogs: list[str] = []
    monkeypatch.setattr(entrypoint, "_build", lambda: (PluginSettings(), KICAD, engine.LocalEngine(), object()))
    monkeypatch.setattr(entrypoint, "_run_dialog", lambda kicad, action: dialogs.append("dialog") or 0)

    monkeypatch.setattr(engine, "open_window", lambda context, kicad_cli=None: None)
    assert entrypoint.run() == 0 and dialogs == []

    monkeypatch.setattr(engine, "open_window", lambda context, kicad_cli=None: "no GUI toolkit")
    assert entrypoint.run() == 0 and dialogs == ["dialog"]
