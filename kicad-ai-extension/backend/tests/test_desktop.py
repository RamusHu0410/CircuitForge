"""Endpoints used by the CircuitForge desktop window (/api/desktop/*)."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import actions
from app.ai.circuit_generator import RuleBasedGenerator
from app.api.routes import desktop
from app.config import Settings, get_settings
from app.core.circuit_validator import validate_circuit
from app.core.clipboard import schematic_items, wrap_as_schematic
from app.core.erc import find_kicad_cli, run_erc
from app.core.schematic_renderer import render_schematic
from app.core.sexpr import head, loads
from app.main import create_app
from app.schemas.circuit import SchematicFiles

PROMPT = "red LED on 5V at 10mA"


def _files(prompt: str = PROMPT) -> SchematicFiles:
    return render_schematic(validate_circuit(RuleBasedGenerator().generate(prompt)), prompt)


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(desktop, "STATE", desktop._State())


@pytest.fixture
def opened(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    calls: list[Path] = []
    monkeypatch.setattr(actions, "open_in_schematic_editor", lambda path, cli=None: calls.append(path))
    return calls


@pytest.fixture
def copied(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []
    monkeypatch.setattr(actions, "copy_text", calls.append)
    return calls


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(output_dir=str(tmp_path / "out"), erc_enabled=False)
    with TestClient(app) as test_client:
        yield test_client


# --- clipboard snippet ----------------------------------------------------------------


def test_snippet_has_only_circuit_items() -> None:
    items = loads("(x\n" + schematic_items(_files().schematic) + ")")[1:]
    heads = {head(i) for i in items}
    assert "lib_symbols" in heads and "symbol" in heads and "wire" in heads
    assert not heads & {"version", "generator", "uuid", "paper", "title_block", "sheet_instances", "embedded_fonts"}


def test_snippet_rejects_non_schematics() -> None:
    from app.core.clipboard import ClipboardError

    with pytest.raises(ClipboardError):
        schematic_items("(kicad_pcb (version 1))")


@pytest.mark.skipif(find_kicad_cli() is None, reason="kicad-cli not installed")
@pytest.mark.parametrize("prompt", [PROMPT, "555 timer blinking a blue LED at 2 Hz on 9V", "push button with pull-up on 3.3V and debounce"])
def test_snippet_is_still_a_valid_circuit_for_kicad(prompt: str) -> None:
    """Wrap the clipboard items back into a file: KiCad must load it and report 0 ERC violations."""
    files = _files(prompt)
    rewrapped = SchematicFiles(name=files.name, schematic=wrap_as_schematic(schematic_items(files.schematic)), project=files.project)
    report = run_erc(rewrapped, find_kicad_cli())
    assert report.ran, report.message
    assert report.passed, [v.description for v in report.violations]


# --- endpoints ------------------------------------------------------------------------


def test_info_before_kicad_opens_the_window(client: TestClient, tmp_path: Path) -> None:
    body = client.get("/api/desktop/info").json()
    assert body["opened_from_kicad"] is False
    assert body["project_name"] is None
    assert body["save_dir"] == str(tmp_path / "out")


def test_open_records_session_and_launches_once(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    launched: list[list[str]] = []

    class FakeProcess:
        pid = 1

        def poll(self) -> None:
            return None  # still running

    monkeypatch.setattr(desktop.subprocess, "Popen", lambda cmd, cwd=None: launched.append(cmd) or FakeProcess())
    ctx = {"kicad_version": "10.0.7", "project_name": "Sigma", "project_dir": str(tmp_path)}

    first = client.post("/api/desktop/open", json={"context": ctx}).json()
    second = client.post("/api/desktop/open", json={"context": ctx}).json()

    assert first == {"launched": True, "already_open": False}
    assert second == {"launched": False, "already_open": True}
    assert len(launched) == 1 and launched[0][1:3] == ["-m", "app.desktop"]
    info = client.get("/api/desktop/info").json()
    assert info["project_name"] == "Sigma" and info["opened_from_kicad"] is True
    assert info["save_dir"] == str(tmp_path / "ai_generated")
    assert info["focus_seq"] == 1


def test_save_goes_next_to_the_open_project(client: TestClient, tmp_path: Path, opened: list[Path], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(desktop.subprocess, "Popen", lambda cmd, cwd=None: type("P", (), {"pid": 1, "poll": lambda self: None})())
    client.post("/api/desktop/open", json={"context": {"kicad_version": "10.0.7", "project_name": "Sigma", "project_dir": str(tmp_path)}})

    files = _files()
    body = client.post("/api/desktop/save", json={"files": files.model_dump()}).json()

    sch = Path(body["schematic_path"])
    assert sch.parent.parent == tmp_path / "ai_generated" and sch.is_file()
    assert opened == [sch] and body["opened_in_kicad"] is True


def test_place_copies_items_not_a_file(client: TestClient, copied: list[str]) -> None:
    body = client.post("/api/desktop/place", json=_files().model_dump()).json()
    assert body["copied"] is True and body["symbols"] == 3  # BT1, R1, D1
    assert copied[0].startswith("(lib_symbols") and "(kicad_sch" not in copied[0]


@pytest.mark.skipif(find_kicad_cli() is None, reason="kicad-cli not installed")
def test_preview_is_kicad_svg(client: TestClient) -> None:
    response = client.post("/api/desktop/preview", json=_files().model_dump())
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert "<svg" in response.text


def test_ui_page_or_build_hint_at_root(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "CircuitForge" in response.text


# --- export + code --------------------------------------------------------------------


def _mcu_response(client: TestClient) -> dict:
    return client.post("/api/generate", json={"prompt": "red led blinks when button is pressed once, green led blinks if its pressed twice under 0.5s"}).json()


def test_save_writes_the_sketch_next_to_the_project(client: TestClient, tmp_path: Path, opened: list[Path]) -> None:
    res = _mcu_response(client)
    body = client.post("/api/desktop/save", json={"files": res["files"], "firmware": res["firmware"]}).json()
    sketch = Path(body["firmware_path"])
    assert sketch.suffix == ".ino" and sketch.parent.name == sketch.stem  # Arduino IDE layout
    assert "void loop()" in sketch.read_text()


def test_export_writes_pictures_code_and_project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import base64

    revealed: list[Path] = []
    monkeypatch.setattr(actions, "reveal_folder", lambda p: revealed.append(p))
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(export_dir=str(tmp_path / "exports"), erc_enabled=False)
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * 16).decode()
    with TestClient(app) as c:
        res = _mcu_response(c)
        edited = {**res["firmware"], "code": res["firmware"]["code"] + "// my edit\n"}
        body = c.post("/api/desktop/export", json={"files": res["files"], "firmware": edited, "png_base64": png}).json()

    names = {Path(f).suffix for f in body["files"]}
    assert {".kicad_sch", ".kicad_pro", ".png", ".ino"} <= names
    if find_kicad_cli():
        assert {".svg", ".pdf"} <= names and body["skipped"] == []
    ino = next(Path(f) for f in body["files"] if f.endswith(".ino"))
    assert ino.read_text().endswith("// my edit\n")  # the user's edited code is what gets exported
    assert revealed == [Path(body["folder"])]


def test_export_rejects_non_png_image(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import base64

    monkeypatch.setattr(actions, "reveal_folder", lambda p: None)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(export_dir=str(tmp_path / "exports"), erc_enabled=False, kicad_cli_path="/nonexistent")
    with TestClient(app) as c:
        files = _files().model_dump()
        body = c.post("/api/desktop/export", json={"files": files, "png_base64": base64.b64encode(b"<svg/>").decode()}).json()
    assert any(s.startswith("PNG") for s in body["skipped"])
    assert not any(f.endswith(".png") for f in body["files"])


def test_save_for_pcb_adds_an_empty_board_and_opens_the_project(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    projects: list[Path] = []
    monkeypatch.setattr(actions, "open_project", lambda path, cli=None: projects.append(path))
    body = client.post("/api/desktop/save", json={"files": _files().model_dump(), "open_as": "pcb"}).json()
    board = Path(body["board_path"])
    assert board.suffix == ".kicad_pcb" and board.stem == Path(body["schematic_path"]).stem
    assert projects == [board.with_suffix(".kicad_pro")] and body["opened_in_kicad"] is True


@pytest.mark.skipif(find_kicad_cli() is None, reason="kicad-cli not installed")
def test_empty_board_loads_in_kicad(tmp_path: Path) -> None:
    import subprocess

    from app.core.output_writer import EMPTY_BOARD

    board = tmp_path / "b.kicad_pcb"
    board.write_text(EMPTY_BOARD)
    result = subprocess.run([find_kicad_cli(), "pcb", "drc", "-o", str(tmp_path / "drc.json"), str(board)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
