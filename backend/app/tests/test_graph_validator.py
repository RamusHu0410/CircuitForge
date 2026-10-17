"""Whole-blueprint validation tests (core function and HTTP endpoint)."""

import copy
from typing import Any

from fastapi.testclient import TestClient

from app.core.component_registry import ComponentRegistry
from app.core.graph_validator import validate_blueprint
from app.schemas.blueprint import Blueprint
from app.schemas.common import ValidationCode, ValidationResult

C = ValidationCode


def validate(data: dict[str, Any], registry: ComponentRegistry) -> ValidationResult:
    return validate_blueprint(Blueprint.model_validate(data), registry)


def error_codes(result: ValidationResult) -> list[ValidationCode]:
    return [issue.code for issue in result.errors]


def node(data: dict[str, Any], node_id: str) -> dict[str, Any]:
    return next(n for n in data["nodes"] if n["id"] == node_id)


def drop_edges(data: dict[str, Any], *edge_ids: str) -> None:
    data["edges"] = [e for e in data["edges"] if e["id"] not in edge_ids]


# --- Valid designs ----------------------------------------------------------


def test_valid_connected_blueprint_passes(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    result = validate(football_blueprint, registry)

    assert result.valid is True
    assert result.errors == []
    # ball_controller accepts feedback, so the hit and reset loops are allowed but reported.
    assert {w.code for w in result.warnings} == {C.FEEDBACK_LOOP}
    assert {w.edge_id for w in result.warnings} == {"e-col-hit", "e-col-dir", "e-reset"}


def test_optional_unconnected_inputs_and_outputs_allowed(
    football_blueprint: dict[str, Any], registry: ComponentRegistry
) -> None:
    # Optional inputs: ball.hit, ball.hit_direction, ball.reset, game.goal, leds.flash.
    # Unused outputs: joystick.button, ball.velocity, player.velocity.
    drop_edges(football_blueprint, "e-col-hit", "e-col-dir", "e-reset", "e-goal", "e-goal-led")

    result = validate(football_blueprint, registry)

    assert result.valid is True
    assert result.warnings == []  # no loops remain


def test_single_node_blueprint_is_valid(registry: ComponentRegistry) -> None:
    data = {
        "id": "solo",
        "metadata": {"name": "Solo"},
        "nodes": [{"id": "joy", "type": "joystick", "position": {"x": 0, "y": 0}}],
    }
    assert validate(data, registry).valid is True


# --- Node errors ------------------------------------------------------------


def test_unknown_component_type_fails(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    football_blueprint["nodes"].append({"id": "laser", "type": "laser_cannon", "position": {"x": 0, "y": 0}})

    result = validate(football_blueprint, registry)

    assert result.valid is False
    assert error_codes(result) == [C.UNKNOWN_COMPONENT]
    assert result.errors[0].node_id == "laser"
    assert "Available types:" in result.errors[0].message
    assert C.UNCONNECTED_NODE in {w.code for w in result.warnings}


def test_invalid_parameters_fail(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    node(football_blueprint, "player")["parameters"] = {"speed": 99.0}  # max 20
    node(football_blueprint, "game")["parameters"] = {"winning_score": 2.5}  # integer
    node(football_blueprint, "leds")["parameters"] = {"flash_color": "purple"}  # enum
    node(football_blueprint, "joystick")["parameters"] = {"invert_y": "yes"}  # boolean
    node(football_blueprint, "ball")["parameters"] = {"gravity": 9.8}  # not a parameter

    result = validate(football_blueprint, registry)

    by_node = {issue.node_id: issue for issue in result.errors}
    assert error_codes(result).count(C.INVALID_PARAMETER) == 4
    assert by_node["player"].field == "speed" and "must be <= 20.0" in by_node["player"].message
    assert by_node["game"].field == "winning_score"
    assert by_node["leds"].field == "flash_color"
    assert by_node["joystick"].field == "invert_y"
    assert by_node["ball"].code == C.UNKNOWN_PARAMETER and by_node["ball"].field == "gravity"


def test_missing_required_input_fails(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    drop_edges(football_blueprint, "e-ball-score")  # score.ball_position is required

    result = validate(football_blueprint, registry)

    assert error_codes(result) == [C.MISSING_REQUIRED_INPUT]
    assert (result.errors[0].node_id, result.errors[0].field) == ("score", "ball_position")


def test_duplicate_node_ids_fail(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    football_blueprint["nodes"].append(copy.deepcopy(node(football_blueprint, "player")))

    result = validate(football_blueprint, registry)

    assert error_codes(result) == [C.DUPLICATE_NODE_ID]
    assert result.errors[0].node_id == "player"


def test_duplicate_edge_ids_fail(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    football_blueprint["edges"].append(
        {"id": "e-joy-player", "source": "ball", "source_port": "velocity", "target": "player", "target_port": "direction"}
    )

    result = validate(football_blueprint, registry)

    assert C.DUPLICATE_EDGE_ID in error_codes(result)
    assert next(e for e in result.errors if e.code == C.DUPLICATE_EDGE_ID).edge_id == "e-joy-player"


def test_empty_blueprint_fails(registry: ComponentRegistry) -> None:
    result = validate({"id": "empty", "metadata": {"name": "Empty"}}, registry)

    assert result.valid is False
    assert error_codes(result) == [C.EMPTY_BLUEPRINT]


# --- Connection errors surface through the graph validator ------------------


def test_missing_source_and_target_nodes_fail(
    football_blueprint: dict[str, Any], registry: ComponentRegistry
) -> None:
    football_blueprint["edges"].append(
        {"id": "edge-3", "source": "ghost-a", "source_port": "x", "target": "ghost-b", "target_port": "y"}
    )

    result = validate(football_blueprint, registry)

    assert [(e.code, e.node_id, e.field) for e in result.errors] == [
        (C.UNKNOWN_NODE, "ghost-a", "source"),
        (C.UNKNOWN_NODE, "ghost-b", "target"),
    ]


# --- Cycles -----------------------------------------------------------------


def test_unsupported_cycle_fails(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    # player.position -> collision.position_a -> collision.direction -> player.direction
    drop_edges(football_blueprint, "e-joy-player")
    football_blueprint["edges"].append(
        {"id": "e-loop", "source": "collision", "source_port": "direction", "target": "player", "target_port": "direction"}
    )

    result = validate(football_blueprint, registry)

    assert result.valid is False
    assert error_codes(result) == [C.CYCLE_DETECTED, C.CYCLE_DETECTED]
    assert {e.edge_id for e in result.errors} == {"e-player-col", "e-loop"}
    assert "player -> collision" in result.errors[0].message
    assert not any(w.code == C.FEEDBACK_LOOP for w in result.warnings)


def test_self_loop_fails(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    drop_edges(football_blueprint, "e-joy-player")
    football_blueprint["edges"].append(
        {"id": "e-self", "source": "player", "source_port": "position", "target": "player", "target_port": "direction"}
    )

    result = validate(football_blueprint, registry)

    assert error_codes(result) == [C.CYCLE_DETECTED]
    assert (result.errors[0].node_id, result.errors[0].edge_id) == ("player", "e-self")


# --- Multiple errors --------------------------------------------------------


def test_multiple_errors_reported_together(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    football_blueprint["nodes"].append({"id": "laser", "type": "laser_cannon", "position": {"x": 0, "y": 0}})
    node(football_blueprint, "player")["parameters"] = {"speed": -1.0}
    football_blueprint["edges"][0]["source_port"] = "button"  # incompatible types
    football_blueprint["edges"].append(
        {"id": "edge-3", "source": "ball", "source_port": "position", "target": "missing", "target_port": "x"}
    )
    drop_edges(football_blueprint, "e-ball-score")

    result = validate(football_blueprint, registry)

    assert result.valid is False
    assert set(error_codes(result)) == {
        C.UNKNOWN_COMPONENT,
        C.INVALID_PARAMETER,
        C.INCOMPATIBLE_PORT_TYPES,
        C.UNKNOWN_NODE,
        C.MISSING_REQUIRED_INPUT,
    }


# --- HTTP endpoint ----------------------------------------------------------


def test_validate_endpoint_valid(client: TestClient, football_blueprint: dict[str, Any]) -> None:
    response = client.post("/api/blueprints/validate", json=football_blueprint)

    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is True
    assert body["errors"] == []
    assert set(body) == {"valid", "errors", "warnings"}


def test_validate_endpoint_invalid_returns_200(client: TestClient, football_blueprint: dict[str, Any]) -> None:
    football_blueprint["edges"].append(
        {"id": "edge-3", "source": "ball", "source_port": "position", "target": "missing-player", "target_port": "x"}
    )

    response = client.post("/api/blueprints/validate", json=football_blueprint)

    assert response.status_code == 200
    assert response.json() == {
        "valid": False,
        "errors": [
            {
                "code": "UNKNOWN_NODE",
                "message": "Edge 'edge-3' target references node 'missing-player', which does not exist.",
                "node_id": "missing-player",
                "edge_id": "edge-3",
                "field": "target",
            }
        ],
        "warnings": response.json()["warnings"],
    }


def test_validate_endpoint_malformed_returns_422(client: TestClient) -> None:
    assert client.post("/api/blueprints/validate", json={"nodes": "not-a-list"}).status_code == 422
    assert client.post("/api/blueprints/validate", content=b"{not json", headers={"content-type": "application/json"}).status_code == 422


def test_existing_endpoints_still_work(client: TestClient) -> None:
    assert client.get("/api/health").json()["status"] == "ok"
    assert len(client.get("/api/components").json()) == 7
    assert client.get("/api/components/joystick").status_code == 200
    assert client.get("/api/components/nope").status_code == 404
