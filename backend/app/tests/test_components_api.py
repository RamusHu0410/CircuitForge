"""Tests for the component catalog API."""

from fastapi.testclient import TestClient

EXPECTED_TYPES = {
    "joystick",
    "player_controller",
    "ball_controller",
    "collision_detector",
    "score_manager",
    "game_state_manager",
    "led_controller",
}
DEFINITION_KEYS = {
    "type",
    "name",
    "description",
    "category",
    "inputs",
    "outputs",
    "default_parameters",
    "parameter_constraints",
    "accepts_feedback",
}


def test_list_components_returns_all_seven(client: TestClient) -> None:
    response = client.get("/api/components")

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert {component["type"] for component in body} == EXPECTED_TYPES
    for component in body:
        assert set(component) == DEFINITION_KEYS


def test_get_component(client: TestClient) -> None:
    response = client.get("/api/components/joystick")

    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "joystick"
    assert body["category"] == "input"
    assert body["inputs"] == []
    assert {
        "name": "direction",
        "data_type": "vector2",
        "description": "Stick direction.",
        "required": False,
    } in body["outputs"]
    assert body["default_parameters"]["dead_zone"] == 0.1
    assert body["parameter_constraints"]["dead_zone"]["type"] == "number"
    assert body["parameter_constraints"]["dead_zone"]["maximum"] == 0.9


def test_unknown_component_returns_404(client: TestClient) -> None:
    response = client.get("/api/components/laser_cannon")

    assert response.status_code == 404
    detail = response.json()["detail"]
    assert "Unknown component type 'laser_cannon'" in detail
    assert "joystick" in detail
