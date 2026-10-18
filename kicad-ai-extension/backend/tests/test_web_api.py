"""The endpoints the CircuitForge web UI calls."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.core.erc import find_kicad_cli
from app.main import create_app
from app.services import generation_service

START = "When I press a button, a red LED should light up. Use an Arduino Uno."
needs_kicad = pytest.mark.skipif(find_kicad_cli() is None, reason="kicad-cli not installed")


@pytest.fixture
def opened(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    calls: list[Path] = []
    monkeypatch.setattr(generation_service, "open_in_schematic_editor", lambda path, cli=None: calls.append(path))
    return calls


@pytest.fixture
def web(tmp_path: Path, opened: list[Path]) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        output_dir=str(tmp_path / "out"), kicad_settings_dir=str(tmp_path / "kicad-settings")
    )
    with TestClient(app) as client:
        yield client


def plan(client: TestClient, prompt: str = START, project: dict | None = None):
    body = {"prompt": prompt, **({"project": project} if project else {})}
    return client.post("/api/plan", json=body)


# --- /api/plan ------------------------------------------------------------------------------------


@needs_kicad
def test_plan_returns_the_ui_project_shape(web: TestClient) -> None:
    response = plan(web)
    assert response.status_code == 200
    project = response.json()

    assert set(project) == {"name", "request", "params", "steps", "checks", "nets", "summary"}
    assert project["request"] == START
    assert set(project["params"]) == {"supply", "ledVf", "ledTargetMa", "ledResistor", "pullDown", "debounceCapNf", "ledColor"}
    assert [s["id"] for s in project["steps"]] == ["parse", "power", "led", "pulldown", "debounce", "nets", "verify"]
    assert {s["lesson"] for s in project["steps"]} == {"parse", "power", "led", "pulldown", "debounce", "nets", "verify"}
    for step in project["steps"]:
        assert set(step) >= {"id", "title", "call", "lines", "status", "parts"}
        assert step["status"] in ("done", "warning", "failed", "pending")
    for check in project["checks"]:
        assert set(check) == {"id", "label", "status", "stepId"}
        assert check["status"] in ("pass", "warn", "fail")


@needs_kicad
def test_plan_matches_the_example_wording_and_numbers(web: TestClient) -> None:
    """The plan reads exactly like the example the UI ships with (src/data/example.ts)."""
    project = plan(web).json()
    steps = {s["id"]: s for s in project["steps"]}

    assert steps["led"]["lines"] == ["R = (5 − 2) / 15 mA = 200 Ω → 220 Ω", "I = 13.6 mA · P = 40.9 mW"]
    assert steps["power"]["lines"][1] == "worst-case draw 14.1 mA of ~500 mA"
    assert steps["pulldown"]["lines"] == ["SW1 connects 5 V → D2", "R2 10 kΩ pull-down · 500 µA when pressed"]
    assert steps["debounce"]["lines"] == ["C1 100 nF across R2", "τ = 1 ms · reads LOW after 1.2 ms"]
    assert steps["nets"]["call"] == "Wire(5 nets)" and steps["nets"]["lines"][0] == "14 pins, each in exactly one net"
    assert steps["verify"]["lines"][0] == "LED loop: 5 − 3 V − 2 V = 0 V"
    assert [(p["ref"], p["name"], p["value"]) for p in steps["led"]["parts"]] == [
        ("D1", "LED", "Red, 2.0 V"), ("R1", "Resistor", "220 Ω")]
    assert {n["name"]: n["pins"] for n in project["nets"]}["BUTTON"] == ["A1.D2", "SW1.2", "R2.1", "C1.1"]


@needs_kicad
def test_plan_checks_come_from_kicad_not_from_a_script(web: TestClient) -> None:
    project = plan(web).json()
    checks = {c["id"]: c for c in project["checks"]}
    assert checks["c-erc"] == {"id": "c-erc", "label": "ERC clean", "status": "pass", "stepId": "nets"}
    assert project["steps"][5]["lines"][1] == "ERC: passed with no violations"
    assert all(c["status"] == "pass" for c in project["checks"])


@needs_kicad
def test_plan_edit_round_trip_uses_the_projects_params(web: TestClient) -> None:
    first = plan(web).json()
    second = plan(web, "make the LED brighter", {"request": first["request"], "params": first["params"]}).json()

    assert second["request"] == START  # the original request stays at the top
    assert second["params"]["ledTargetMa"] == 20 and second["params"]["ledResistor"] == 150
    assert second["summary"].startswith("Updated:")
    led = next(s for s in second["steps"] if s["id"] == "led")
    assert led["lines"][0] == "R = (5 − 2) / 20 mA = 150 Ω → 150 Ω"


@needs_kicad
def test_plan_accepts_the_whole_project_the_ui_sends(web: TestClient) -> None:
    """The UI posts its entire Project (steps, checks, ...); extra fields must be ignored, not rejected."""
    first = plan(web).json()
    assert plan(web, "use a blue LED", first).status_code == 200


@needs_kicad
def test_plan_without_debounce_has_no_capacitor(web: TestClient) -> None:
    project = plan(web, "without debounce, a red LED lights when I press the button").json()
    assert "debounce" not in [s["id"] for s in project["steps"]]
    assert not any(c["id"] == "c-tau" for c in project["checks"])
    assert not any(p["ref"] == "C1" for s in project["steps"] for p in s["parts"])


def test_plan_errors_are_422_with_a_message(web: TestClient) -> None:
    response = plan(web, "make the LED brighter")
    assert response.status_code == 422 and "no design yet" in response.json()["detail"]
    response = plan(web, "what is the weather", {"request": START, "params": {"supply": 5}})
    assert response.status_code == 422 and "couldn't tell what to change" in response.json()["detail"]


@pytest.mark.parametrize("body", [{}, {"prompt": ""}, {"prompt": "x" * 2001}, {"prompt": "hi", "extra": 1},
                                  {"prompt": "hi", "project": {"params": {"supply": 99}}}])
def test_plan_rejects_malformed_requests(web: TestClient, body: dict) -> None:
    assert web.post("/api/plan", json=body).status_code == 422


# --- /api/design/* --------------------------------------------------------------------------------

PARAMS = {"supply": 5, "ledVf": 2.0, "ledTargetMa": 15, "ledResistor": 220, "pullDown": 10000, "debounceCapNf": 100}


@needs_kicad
def test_design_svg_is_the_real_schematic(web: TestClient) -> None:
    response = web.post("/api/design/svg", json={"params": PARAMS})
    assert response.status_code == 200 and response.headers["content-type"] == "image/svg+xml"
    assert response.headers["cache-control"] == "no-store"
    text = response.text
    assert text.lstrip().startswith("<?xml") and "<svg" in text
    for forbidden in ("<script", "onload=", "onclick=", "<foreignObject", "<image"):
        assert forbidden not in text


@needs_kicad
def test_design_send_saves_and_opens(web: TestClient, tmp_path: Path, opened: list[Path]) -> None:
    response = web.post("/api/design/send", json={"params": PARAMS})
    assert response.status_code == 200
    body = response.json()
    sch = Path(body["schematicPath"])
    assert sch == tmp_path / "out" / "push_button_led" / "push_button_led.kicad_sch"
    assert sch.read_text().startswith("(kicad_sch") and Path(body["projectPath"]).is_file()
    assert body["openedInKicad"] is True and body["openError"] is None and opened == [sch]
    assert body["ercMessage"] == "ERC passed with no issues."


@needs_kicad
def test_design_send_never_overwrites_and_can_skip_opening(web: TestClient, tmp_path: Path, opened: list[Path]) -> None:
    web.post("/api/design/send", json={"params": PARAMS, "openInKicad": False})
    second = web.post("/api/design/send", json={"params": PARAMS, "openInKicad": False}).json()
    assert Path(second["folder"]).name == "push_button_led_2" and opened == []


def test_design_send_unwritable_folder_is_500(tmp_path: Path, opened: list[Path]) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("x")
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(output_dir=str(blocker / "sub"), erc_enabled=False)
    with TestClient(app) as client:
        response = client.post("/api/design/send", json={"params": PARAMS})
    assert response.status_code == 500 and "Could not save" in response.json()["detail"]


@pytest.mark.parametrize("params", [{**PARAMS, "ledTargetMa": 100}, {**PARAMS, "supply": 12}, {**PARAMS, "ledResistor": 1}])
def test_design_rejects_unsafe_values(web: TestClient, params: dict) -> None:
    assert web.post("/api/design/send", json={"params": params}).status_code == 422
    assert web.post("/api/design/svg", json={"params": params}).status_code == 422


# --- /api/kicad/* ---------------------------------------------------------------------------------


@needs_kicad
def test_kicad_status(web: TestClient, tmp_path: Path) -> None:
    body = web.get("/api/kicad/status").json()
    assert body["status"] == "connected" and body["version"]
    assert body["outputDir"] == str(tmp_path / "out")


def test_kicad_status_when_missing(tmp_path: Path) -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(kicad_cli_path=str(tmp_path / "nope"))
    with TestClient(app) as client:
        body = client.get("/api/kicad/status").json()
    assert body["status"] == "disconnected" and "KICAD_CLI_PATH" in body["detail"]


def test_kicad_colors_empty_for_builtin_theme(web: TestClient, tmp_path: Path) -> None:
    settings = tmp_path / "kicad-settings"
    settings.mkdir()
    (settings / "eeschema.json").write_text('{"appearance": {"color_theme": "_builtin_default"}}')
    assert web.get("/api/kicad/colors").json() == {}


def test_kicad_colors_from_user_theme(web: TestClient, tmp_path: Path) -> None:
    settings = tmp_path / "kicad-settings"
    (settings / "colors").mkdir(parents=True)
    (settings / "eeschema.json").write_text('{"appearance": {"color_theme": "night"}}')
    (settings / "colors" / "night.json").write_text(
        '{"schematic": {"background": "rgb(22, 22, 30)", "wire": "rgb(42, 195, 222)", '
        '"component_outline": "rgba(125, 207, 255, 0.5)", "component_body": "url(javascript:alert(1))", '
        '"reference": "red; background: url(x)", "label_local": "rgb(192, 202, 245)", "junction": "rgb(1,2,3)"}}'
    )
    colors = web.get("/api/kicad/colors").json()
    assert colors == {
        "--kc-bg": "rgb(22, 22, 30)",
        "--kc-wire": "rgb(42, 195, 222)",
        "--kc-sym": "rgba(125, 207, 255, 0.5)",
        "--kc-label": "rgb(192, 202, 245)",
    }  # injected CSS and unmapped keys are dropped


def test_kicad_colors_theme_name_cannot_escape_the_folder(web: TestClient, tmp_path: Path) -> None:
    settings = tmp_path / "kicad-settings"
    settings.mkdir()
    (tmp_path / "secret.json").write_text('{"schematic": {"wire": "rgb(1, 2, 3)"}}')
    (settings / "eeschema.json").write_text('{"appearance": {"color_theme": "../../secret"}}')
    assert web.get("/api/kicad/colors").json() == {}


# --- Browser safety ----------------------------------------------------------------------------


def test_the_web_ui_origin_is_allowed_and_others_are_not() -> None:
    with TestClient(create_app()) as client:
        ok = client.options("/api/plan", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
                                                  "Access-Control-Request-Headers": "content-type"})
        assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert client.get("/api/health", headers={"Origin": "http://localhost:5173"}).status_code == 200

        evil = client.post("/api/generate/save", json={"prompt": "red LED on 5V"}, headers={"Origin": "https://evil.example"})
        assert evil.status_code == 403
        assert "access-control-allow-origin" not in evil.headers


def test_the_plugin_without_an_origin_header_is_unaffected() -> None:
    with TestClient(create_app()) as client:
        assert client.get("/api/health").status_code == 200  # no Origin header, like the KiCad plugin


def test_foreign_host_headers_are_refused() -> None:
    """DNS rebinding: a page on evil.example resolving to 127.0.0.1 still sends Host: evil.example."""
    with TestClient(create_app()) as client:
        assert client.get("/api/health", headers={"host": "evil.example"}).status_code == 400
        assert client.get("/api/health", headers={"host": "127.0.0.1:8765"}).status_code == 200
        assert client.get("/api/health", headers={"host": "localhost:8765"}).status_code == 200


def test_the_engine_never_answers_502_or_504() -> None:
    """The web client reads 502/504 as 'a gateway cannot reach the engine' (engine not running).
    The engine must therefore never use them for its own errors."""
    import pathlib
    import re

    routes = pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "routes"
    used = {int(code) for path in routes.glob("*.py") for code in re.findall(r"\b(50[24])\b", path.read_text())}
    assert used == set()


# --- /api/generate/svg (the "build any circuit" preview) ----------------------------------------------


@needs_kicad
def test_generate_svg_draws_the_generated_circuit(web: TestClient) -> None:
    response = web.post("/api/generate/svg", json={"prompt": "555 timer blinking an LED at 2 Hz on 9V"})
    assert response.status_code == 200 and response.headers["content-type"] == "image/svg+xml"
    assert "NE555P" in response.text and "<script" not in response.text


def test_generate_svg_explains_unsupported_prompts(web: TestClient) -> None:
    response = web.post("/api/generate/svg", json={"prompt": "a quantum computer"})
    assert response.status_code == 422 and "Supported circuits" in response.json()["detail"]
