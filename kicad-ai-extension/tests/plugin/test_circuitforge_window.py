"""The toolbar button opens the CircuitForge window, falling back to the dialog."""

import json
from pathlib import Path

import pytest

import entrypoint
from backend_client import BackendClient
from conftest import FakeBackend
from kicad_client.connection import KiCadContext
from plugin_settings import load_settings

KICAD = KiCadContext(connected=True, kicad_version="10.0.7", project_name="Sigma", project_dir="/Users/me/Sigma")


def test_interface_defaults_to_circuitforge(tmp_path: Path) -> None:
    assert load_settings(tmp_path / "missing.json", environ={}).interface == "circuitforge"


@pytest.mark.parametrize("value, expected", [("dialog", "dialog"), ("circuitforge", "circuitforge"), ("bogus", "circuitforge")])
def test_interface_from_config(tmp_path: Path, value: str, expected: str) -> None:
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"interface": value}))
    assert load_settings(config, environ={}).interface == expected


def test_open_window_sends_project_folder(fake_backend: FakeBackend) -> None:
    fake_backend.set_json("POST", "/api/desktop/open", 200, {"launched": True, "already_open": False})
    result = BackendClient(fake_backend.url).open_window(KICAD.as_window_context())
    assert result["launched"] is True
    method, path, body = fake_backend.requests[-1]
    assert (method, path) == ("POST", "/api/desktop/open")
    assert json.loads(body)["context"] == {"kicad_version": "10.0.7", "project_name": "Sigma", "project_dir": "/Users/me/Sigma"}


def _patch_build(monkeypatch: pytest.MonkeyPatch, url: str, interface: str = "circuitforge") -> list[str]:
    from plugin_settings import PluginSettings

    dialogs: list[str] = []
    monkeypatch.setattr(entrypoint, "_build", lambda: (PluginSettings(backend_url=url, interface=interface), KICAD, BackendClient(url), object()))
    monkeypatch.setattr(entrypoint, "_run_dialog", lambda kicad, action: dialogs.append("dialog") or 0)
    return dialogs


def test_button_opens_window_without_dialog(fake_backend: FakeBackend, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_backend.set_json("POST", "/api/desktop/open", 200, {"launched": True, "already_open": False})
    dialogs = _patch_build(monkeypatch, fake_backend.url)
    assert entrypoint.run() == 0
    assert dialogs == []


def test_backend_down_falls_back_to_dialog(unused_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    dialogs = _patch_build(monkeypatch, unused_url)
    assert entrypoint.run() == 0
    assert dialogs == ["dialog"]


def test_dialog_interface_skips_window(fake_backend: FakeBackend, monkeypatch: pytest.MonkeyPatch) -> None:
    dialogs = _patch_build(monkeypatch, fake_backend.url, interface="dialog")
    entrypoint.run()
    assert dialogs == ["dialog"]
    assert not any(path == "/api/desktop/open" for _, path, _ in fake_backend.requests)
