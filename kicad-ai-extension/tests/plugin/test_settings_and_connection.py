from pathlib import Path

import pytest

from kicad_client.connection import KiCadContext, get_kicad_context
from plugin_settings import DEFAULT_BACKEND_URL, load_settings


def test_default_url(tmp_path: Path) -> None:
    assert load_settings(tmp_path / "missing.json", environ={}).backend_url == DEFAULT_BACKEND_URL


def test_config_file(tmp_path: Path) -> None:
    config = tmp_path / "config.json"
    config.write_text('{"backend_url": "http://127.0.0.1:9000/"}')
    assert load_settings(config, environ={}).backend_url == "http://127.0.0.1:9000"


def test_env_overrides_config(tmp_path: Path) -> None:
    config = tmp_path / "config.json"
    config.write_text('{"backend_url": "http://127.0.0.1:9000"}')
    settings = load_settings(config, environ={"KICAD_AI_BACKEND_URL": "http://localhost:7000"})
    assert settings.backend_url == "http://localhost:7000"


@pytest.mark.parametrize("contents", ["{not json", '["list"]', '{"backend_url": "ftp://x"}', '{"backend_url": 5}'])
def test_bad_config_falls_back_to_default(tmp_path: Path, contents: str) -> None:
    config = tmp_path / "config.json"
    config.write_text(contents)
    assert load_settings(config, environ={}).backend_url == DEFAULT_BACKEND_URL


def test_kicad_not_running_is_not_fatal(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # Point kicad-python at a socket that does not exist (as when run outside KiCad).
    monkeypatch.setenv("KICAD_API_SOCKET", f"ipc://{tmp_path}/api.sock")
    context = get_kicad_context(timeout_ms=200)

    assert context.connected is False
    assert context.error
    assert context.project_dir is None
    assert context.as_request_context() == {}
    assert "You can still generate" in context.describe()


def test_context_fields_are_truncated() -> None:
    context = KiCadContext(connected=True, kicad_version="v" * 300, project_name="p" * 300)
    fields = context.as_request_context()
    assert len(fields["kicad_version"]) == 200 and len(fields["project_name"]) == 200
