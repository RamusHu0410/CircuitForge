"""The window's in-process bridge (app/bridge.py) and the single-window hand-off (app/instance.py)."""

from pathlib import Path

import pytest

from app import actions, instance
from app.bridge import Api
from app.config import Settings

PROMPT = "red LED on 5V at 10mA"


@pytest.fixture
def api(tmp_path: Path) -> Api:
    settings = Settings(output_dir=str(tmp_path / "out"), erc_enabled=False, kicad_cli_path=str(tmp_path / "no-kicad-cli"))
    return Api(settings, state_dir=tmp_path / "state")


def test_only_the_calls_are_visible_to_the_page(api: Api) -> None:
    # pywebview exposes every public attribute; settings and the service must stay private.
    assert [name for name in vars(api) if not name.startswith("_")] == []
    assert {name for name in dir(Api) if not name.startswith("_")} == {"generate", "desktop_info", "preview", "save", "place", "export"}


def test_generate_replies_like_the_http_api(api: Api) -> None:
    reply = api.generate({"prompt": PROMPT})
    assert reply["ok"] is True
    data = reply["data"]
    assert data["status"] == "generated"
    assert data["files"]["schematic"].startswith("(kicad_sch")


@pytest.mark.parametrize("body", [{"prompt": ""}, {}, {"prompt": PROMPT, "unknown": 1}, "not an object"])
def test_bad_requests_are_422(api: Api, body: object) -> None:
    reply = api.generate(body)
    assert reply == {"ok": False, "status": 422, "detail": reply["detail"]}
    assert reply["detail"].startswith("The request was rejected")


def test_prompt_it_cannot_build_is_422_with_the_reason(api: Api) -> None:
    reply = api.generate({"prompt": "a quantum flux capacitor for my time machine"})
    assert reply["ok"] is False and reply["status"] == 422
    assert reply["detail"]


def test_preview_without_kicad_is_503(api: Api) -> None:
    files = api.generate({"prompt": PROMPT})["data"]["files"]
    reply = api.preview(files)
    assert reply["ok"] is False and reply["status"] == 503


def test_unexpected_errors_never_escape(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(actions, "place", lambda files: 1 / 0)
    files = api.generate({"prompt": PROMPT})["data"]["files"]
    assert api.place(files) == {"ok": False, "status": 500, "detail": api.place(files)["detail"]}


def test_info_and_save_follow_the_latest_kicad_click(api: Api, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    opened: list[Path] = []
    monkeypatch.setattr(actions, "open_in_schematic_editor", lambda path, cli=None: opened.append(path))
    info = api.desktop_info()["data"]
    assert info["opened_from_kicad"] is False and info["project_dir"] is None

    project = tmp_path / "my_project"
    project.mkdir()
    instance.write_session(tmp_path / "state", {"kicad_version": "10.0.7", "project_name": "my_project", "project_dir": str(project)})
    info = api.desktop_info()["data"]
    assert info["opened_from_kicad"] is True
    assert info["save_dir"] == str(project / "ai_generated")

    files = api.generate({"prompt": PROMPT})["data"]["files"]
    saved = api.save({"files": files})["data"]
    assert Path(saved["schematic_path"]).parent.parent == project / "ai_generated"
    assert opened == [Path(saved["schematic_path"])]


def test_bad_session_file_is_ignored(api: Api, tmp_path: Path) -> None:
    instance.write_session(tmp_path / "state", {"project_dir": 5, "surprise": True})
    assert api.desktop_info()["ok"] is True


# --- one window per user -------------------------------------------------------------------


def test_lock_allows_one_window(tmp_path: Path) -> None:
    first, second = instance.WindowLock(tmp_path), instance.WindowLock(tmp_path)
    assert first.acquire()
    assert instance.window_running(tmp_path)
    assert not second.acquire()
    first.release()
    assert not instance.window_running(tmp_path)
    assert second.acquire()
    second.release()


def test_session_round_trip_and_click_stamp(tmp_path: Path) -> None:
    assert instance.read_session(tmp_path) == {}
    assert instance.session_stamp(tmp_path) is None
    instance.write_session(tmp_path, {"project_name": "demo"})
    assert instance.read_session(tmp_path) == {"project_name": "demo"}
    assert instance.session_stamp(tmp_path) is not None
    instance.clear_session(tmp_path)
    assert instance.read_session(tmp_path) == {}
