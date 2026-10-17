"""Connection (edge) validation tests, using the real component registry."""

from typing import Any

import pytest

from app.core.component_registry import ComponentRegistry
from app.core.connection_validator import are_port_types_compatible, validate_connections
from app.schemas.blueprint import Blueprint
from app.schemas.common import ValidationCode
from app.schemas.component import PortDataType


def edge_by_id(data: dict[str, Any], edge_id: str) -> dict[str, Any]:
    return next(edge for edge in data["edges"] if edge["id"] == edge_id)


def run(data: dict[str, Any], registry: ComponentRegistry) -> list[Any]:
    return validate_connections(Blueprint.model_validate(data), registry)


def codes(issues: list[Any]) -> list[ValidationCode]:
    return [issue.code for issue in issues]


def test_valid_connections_pass(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    assert run(football_blueprint, registry) == []


@pytest.mark.parametrize("end", ["source", "target"])
def test_missing_node_fails(end: str, football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    edge_by_id(football_blueprint, "e-joy-player")[end] = "missing-player"

    [issue] = run(football_blueprint, registry)

    assert issue.code == ValidationCode.UNKNOWN_NODE
    assert issue.node_id == "missing-player"
    assert issue.edge_id == "e-joy-player"
    assert issue.field == end


def test_unknown_output_port_fails(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    edge_by_id(football_blueprint, "e-joy-player")["source_port"] = "trigger"

    [issue] = run(football_blueprint, registry)

    assert issue.code == ValidationCode.UNKNOWN_PORT
    assert (issue.node_id, issue.edge_id, issue.field) == ("joystick", "e-joy-player", "source_port")
    assert "Available outputs: direction, button" in issue.message


def test_unknown_input_port_fails(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    edge_by_id(football_blueprint, "e-joy-player")["target_port"] = "steering"

    [issue] = run(football_blueprint, registry)

    assert issue.code == ValidationCode.UNKNOWN_PORT
    assert (issue.node_id, issue.field) == ("player", "target_port")
    assert "Available inputs: direction" in issue.message


def test_source_must_be_output(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    # `direction` exists on player_controller, but only as an input.
    football_blueprint["edges"].append(
        {"id": "e-bad", "source": "player", "source_port": "direction", "target": "ball", "target_port": "hit_direction"}
    )
    football_blueprint["edges"] = [e for e in football_blueprint["edges"] if e["id"] != "e-col-dir"]

    [issue] = run(football_blueprint, registry)

    assert issue.code == ValidationCode.INVALID_PORT_DIRECTION
    assert (issue.node_id, issue.edge_id, issue.field) == ("player", "e-bad", "source_port")


def test_target_must_be_input(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    # `position` exists on player_controller, but only as an output.
    edge_by_id(football_blueprint, "e-joy-player")["target_port"] = "position"

    [issue] = run(football_blueprint, registry)

    assert issue.code == ValidationCode.INVALID_PORT_DIRECTION
    assert (issue.node_id, issue.field) == ("player", "target_port")


def test_incompatible_port_types_fail(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    edge_by_id(football_blueprint, "e-joy-player")["source_port"] = "button"  # event -> vector2

    [issue] = run(football_blueprint, registry)

    assert issue.code == ValidationCode.INCOMPATIBLE_PORT_TYPES
    assert issue.edge_id == "e-joy-player"
    assert "(event)" in issue.message and "(vector2)" in issue.message


def test_duplicate_connection_fails(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    duplicate = {**edge_by_id(football_blueprint, "e-joy-player"), "id": "e-joy-player-copy"}
    football_blueprint["edges"].append(duplicate)

    [issue] = run(football_blueprint, registry)

    assert issue.code == ValidationCode.DUPLICATE_CONNECTION
    assert issue.edge_id == "e-joy-player-copy"
    assert "duplicates edge 'e-joy-player'" in issue.message


def test_input_accepts_only_one_connection(
    football_blueprint: dict[str, Any], registry: ComponentRegistry
) -> None:
    # Ball position and player position both into collision.position_b.
    football_blueprint["edges"].append(
        {"id": "e-extra", "source": "player", "source_port": "position", "target": "collision", "target_port": "position_b"}
    )

    [issue] = run(football_blueprint, registry)

    assert issue.code == ValidationCode.MULTIPLE_INPUT_CONNECTIONS
    assert (issue.node_id, issue.edge_id) == ("collision", "e-extra")


def test_edge_to_unknown_component_fails(football_blueprint: dict[str, Any], registry: ComponentRegistry) -> None:
    football_blueprint["nodes"][1]["type"] = "jetpack"  # the player node

    issues = run(football_blueprint, registry)

    # Every edge touching the node is flagged; no ports are invented for it.
    assert codes(issues) == [ValidationCode.UNKNOWN_COMPONENT] * 2
    assert {issue.edge_id for issue in issues} == {"e-joy-player", "e-player-col"}
    assert all(issue.node_id == "player" for issue in issues)


def test_port_type_compatibility_is_exact() -> None:
    for data_type in PortDataType:
        assert are_port_types_compatible(data_type, data_type)
    assert not are_port_types_compatible(PortDataType.NUMBER, PortDataType.BOOLEAN)
    assert not are_port_types_compatible(PortDataType.EVENT, PortDataType.BOOLEAN)
