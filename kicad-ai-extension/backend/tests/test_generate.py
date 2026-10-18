import pytest
from fastapi.testclient import TestClient

from app.schemas.circuit import MAX_PROMPT_LENGTH


def test_valid_prompt_generates_schematic(client: TestClient) -> None:
    response = client.post("/api/generate", json={"prompt": "  A 5V LED with a current-limiting resistor  "})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "generated"
    assert body["prompt"] == "A 5V LED with a current-limiting resistor"
    assert body["generator"] == "rules"
    assert body["validation"]["valid"] is True
    assert {c["kind"] for c in body["circuit"]["components"]} == {"battery", "resistor", "led"}
    assert body["files"]["name"] == "red_led_indicator"
    assert body["files"]["schematic"].startswith("(kicad_sch\n\t(version 20260306)")
    assert '"filename": "red_led_indicator.kicad_pro"' in body["files"]["project"]
    assert len(body["request_id"]) == 32
    assert "erc" in body


def test_prompt_with_context(client: TestClient) -> None:
    response = client.post(
        "/api/generate",
        json={"prompt": "555 timer blinker", "context": {"kicad_version": "10.0.7", "project_name": "blinky"}},
    )
    assert response.status_code == 200


def test_unsupported_prompt_returns_clear_422(client: TestClient) -> None:
    response = client.post("/api/generate", json={"prompt": "a 32-bit RISC-V CPU with DDR5"})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert isinstance(detail, str)
    assert "Supported circuits" in detail


def test_impossible_values_return_clear_422(client: TestClient) -> None:
    response = client.post("/api/generate", json={"prompt": "blue LED on 3V"})
    assert response.status_code == 422
    assert "too low" in response.json()["detail"]


def test_prompt_at_max_length_accepted(client: TestClient) -> None:
    prompt = "LED " + "x" * (MAX_PROMPT_LENGTH - 4)
    assert client.post("/api/generate", json={"prompt": prompt}).status_code == 200


@pytest.mark.parametrize(
    "payload",
    [
        {"prompt": ""},
        {"prompt": "   \n\t "},
        {"prompt": "x" * (MAX_PROMPT_LENGTH + 1)},
        {"prompt": 123},
        {"prompt": None},
        {"prompt": ["LED"]},
        {},
        {"text": "LED circuit"},
        {"prompt": "LED", "unexpected": True},
        {"prompt": "LED", "context": {"kicad_version": "x" * 201}},
    ],
)
def test_invalid_prompt_rejected(client: TestClient, payload: dict) -> None:
    response = client.post("/api/generate", json=payload)

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


def test_malformed_json_rejected(client: TestClient) -> None:
    response = client.post("/api/generate", content=b"{prompt:", headers={"content-type": "application/json"})
    assert response.status_code == 422


def test_get_not_allowed(client: TestClient) -> None:
    assert client.get("/api/generate").status_code == 405


def test_capabilities(client: TestClient) -> None:
    body = client.get("/api/capabilities").json()
    assert len(body["circuits"]) == 8
    assert "timer_555" in body["component_kinds"]
