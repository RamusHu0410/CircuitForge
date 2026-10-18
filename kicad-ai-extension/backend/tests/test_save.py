"""POST /api/generate/save: writes a new project and optionally opens it in KiCad."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.services import generation_service


@pytest.fixture
def opened(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    """Replace the real KiCad launcher so tests never open an application."""
    calls: list[Path] = []
    monkeypatch.setattr(generation_service, "open_in_schematic_editor", lambda path, cli=None: calls.append(path))
    return calls


@pytest.fixture
def save_client(tmp_path: Path, opened: list[Path]) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(output_dir=str(tmp_path / "out"), erc_enabled=False)
    with TestClient(app) as client:
        yield client


def test_saves_new_project_and_opens_it(save_client: TestClient, tmp_path: Path, opened: list[Path]) -> None:
    response = save_client.post("/api/generate/save", json={"prompt": "3.3V LDO from 5V with power LED"})

    assert response.status_code == 200
    body = response.json()
    sch = Path(body["schematic_path"])
    assert sch == tmp_path / "out" / "3_3v_linear_regulator" / "3_3v_linear_regulator.kicad_sch"
    assert sch.read_text().startswith("(kicad_sch")
    assert Path(body["project_path"]).read_text().lstrip().startswith("{")
    assert body["folder"] == str(sch.parent)
    assert body["opened_in_kicad"] is True and body["open_error"] is None
    assert opened == [sch]
    assert body["title"] == "3.3V linear regulator"
    assert any(c.startswith("U1 AMS1117-3.3") for c in body["components"])
    assert str(sch) in body["message"]
    assert "files" not in body  # the schematic text is on disk, not in the response


def test_open_can_be_disabled(save_client: TestClient, opened: list[Path]) -> None:
    body = save_client.post("/api/generate/save", json={"prompt": "red LED on 5V", "open_in_kicad": False}).json()
    assert body["opened_in_kicad"] is False and body["open_error"] is None
    assert opened == []


def test_open_failure_is_reported_not_fatal(
    save_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(generation_service, "open_in_schematic_editor", lambda path, cli=None: "Saved, but could not open KiCad: nope")
    response = save_client.post("/api/generate/save", json={"prompt": "red LED on 5V"})

    assert response.status_code == 200
    body = response.json()
    assert body["opened_in_kicad"] is False and "could not open KiCad" in body["open_error"]
    assert Path(body["schematic_path"]).is_file()


def test_never_overwrites_existing_projects(save_client: TestClient) -> None:
    first = save_client.post("/api/generate/save", json={"prompt": "red LED on 5V", "open_in_kicad": False}).json()
    original = Path(first["schematic_path"]).read_text()
    second = save_client.post("/api/generate/save", json={"prompt": "red LED on 5V", "open_in_kicad": False}).json()

    assert Path(second["folder"]).name == "red_led_indicator_2"
    assert Path(second["schematic_path"]).name == "red_led_indicator_2.kicad_sch"
    assert Path(first["schematic_path"]).read_text() == original
    # Names inside the saved files follow the folder name.
    assert '(project "red_led_indicator_2"' in Path(second["schematic_path"]).read_text()
    assert "red_led_indicator_2.kicad_pro" in Path(second["project_path"]).read_text()


def test_unsupported_prompt_saves_nothing(save_client: TestClient, tmp_path: Path) -> None:
    response = save_client.post("/api/generate/save", json={"prompt": "a quantum computer"})

    assert response.status_code == 422
    assert "Supported circuits" in response.json()["detail"]
    assert not (tmp_path / "out").exists()


def test_unwritable_output_dir_returns_500(tmp_path: Path, opened: list[Path]) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("x")
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(output_dir=str(blocker / "sub"), erc_enabled=False)
    with TestClient(app) as client:
        response = client.post("/api/generate/save", json={"prompt": "red LED on 5V"})

    assert response.status_code == 500
    assert "Could not save" in response.json()["detail"]
    assert opened == []


@pytest.mark.parametrize("payload", [{}, {"prompt": ""}, {"prompt": "LED", "open_in_kicad": "maybe"}, {"prompt": "LED", "x": 1}])
def test_invalid_requests_rejected(save_client: TestClient, payload: dict) -> None:
    assert save_client.post("/api/generate/save", json=payload).status_code == 422


def test_plain_generate_still_writes_nothing(save_client: TestClient, tmp_path: Path) -> None:
    assert save_client.post("/api/generate", json={"prompt": "red LED on 5V"}).status_code == 200
    assert not (tmp_path / "out").exists()


def test_default_output_dir_is_documents_kicad() -> None:
    from app.core.output_writer import resolve_output_dir

    assert resolve_output_dir(None) == Path.home() / "Documents" / "KiCad" / "ai_generated"
    assert resolve_output_dir("~/somewhere") == Path.home() / "somewhere"
