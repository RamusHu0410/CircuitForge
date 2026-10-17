import pytest
from fastapi.testclient import TestClient

from app.schemas.circuit import MAX_PROMPT_LENGTH


def test_valid_prompt_returns_placeholder(client: TestClient) -> None:
    response = client.post("/api/generate", json={"prompt": "  A 5V LED with a current-limiting resistor  "})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "not_implemented"
    assert "not implemented" in body["message"]
    assert body["prompt"] == "A 5V LED with a current-limiting resistor"  # whitespace trimmed
    assert body["schematic"] is None
    assert len(body["request_id"]) == 32


def test_prompt_with_context(client: TestClient) -> None:
    response = client.post(
        "/api/generate",
        json={"prompt": "555 timer blinker", "context": {"kicad_version": "11.0.0", "project_name": "blinky"}},
    )
    assert response.status_code == 200


def test_prompt_at_max_length_accepted(client: TestClient) -> None:
    assert client.post("/api/generate", json={"prompt": "x" * MAX_PROMPT_LENGTH}).status_code == 200


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
