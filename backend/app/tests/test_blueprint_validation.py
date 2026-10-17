"""Blueprint schema validation tests."""

import copy
from typing import Any

import pytest
from pydantic import ValidationError

from app.schemas.blueprint import Blueprint, BlueprintNode


def make_blueprint() -> dict[str, Any]:
    return {
        "id": "bp-1",
        "version": 1,
        "metadata": {"name": "Mini football", "description": "Joystick drives a player."},
        "nodes": [
            {"id": "joy", "type": "joystick", "position": {"x": 0, "y": 0}, "parameters": {"dead_zone": 0.2}},
            {"id": "player", "type": "player_controller", "position": {"x": 250.5, "y": 40}},
        ],
        "edges": [
            {"id": "e1", "source": "joy", "source_port": "direction", "target": "player", "target_port": "direction"},
        ],
    }


# --- Valid data -------------------------------------------------------------


def test_valid_blueprint_parses() -> None:
    blueprint = Blueprint.model_validate(make_blueprint())

    assert blueprint.metadata.name == "Mini football"
    assert [node.id for node in blueprint.nodes] == ["joy", "player"]
    assert blueprint.nodes[0].parameters == {"dead_zone": 0.2}
    assert blueprint.nodes[1].parameters == {}
    assert blueprint.edges[0].source_port == "direction"


def test_blueprint_json_round_trip() -> None:
    blueprint = Blueprint.model_validate(make_blueprint())
    assert Blueprint.model_validate_json(blueprint.model_dump_json()) == blueprint


def test_empty_blueprint_is_valid() -> None:
    blueprint = Blueprint.model_validate({"id": "empty", "metadata": {"name": "Empty"}})
    assert blueprint.version == 1
    assert blueprint.nodes == [] and blueprint.edges == []


def test_node_parameters_keep_their_types() -> None:
    node = BlueprintNode.model_validate(
        {
            "id": "n1",
            "type": "led_controller",
            "position": {"x": 1, "y": 2},
            "parameters": {"led_count": 8, "brightness": 0.5, "flash_color": "red", "enabled": True},
        }
    )
    assert node.parameters == {"led_count": 8, "brightness": 0.5, "flash_color": "red", "enabled": True}
    assert type(node.parameters["led_count"]) is int
    assert type(node.parameters["enabled"]) is bool


# --- Invalid node data ------------------------------------------------------

VALID_NODE = {"id": "n1", "type": "joystick", "position": {"x": 0, "y": 0}}


@pytest.mark.parametrize(
    ("override", "description"),
    [
        ({"id": ""}, "empty id"),
        ({"id": "has space"}, "whitespace in id"),
        ({"id": 5}, "non-string id"),
        ({"type": "Joystick"}, "type not snake_case"),
        ({"type": ""}, "empty type"),
        ({"position": {"x": 0}}, "position missing y"),
        ({"position": {"x": "left", "y": 0}}, "non-numeric position"),
        ({"position": {"x": float("nan"), "y": 0}}, "NaN position"),
        ({"position": [0, 0]}, "position not an object"),
        ({"parameters": {"speed": [1, 2]}}, "list parameter value"),
        ({"parameters": {"speed": {"nested": 1}}}, "object parameter value"),
        ({"parameters": {"Bad-Name": 1}}, "invalid parameter name"),
        ({"data": {}}, "unexpected field"),
    ],
)
def test_invalid_node_rejected(override: dict[str, Any], description: str) -> None:
    with pytest.raises(ValidationError):
        BlueprintNode.model_validate({**VALID_NODE, **override})


@pytest.mark.parametrize("missing", ["id", "type", "position"])
def test_node_missing_required_field_rejected(missing: str) -> None:
    data = {k: v for k, v in VALID_NODE.items() if k != missing}
    with pytest.raises(ValidationError):
        BlueprintNode.model_validate(data)


# --- Invalid blueprint data -------------------------------------------------


@pytest.mark.parametrize("missing", ["id", "metadata"])
def test_blueprint_missing_required_field_rejected(missing: str) -> None:
    data = make_blueprint()
    del data[missing]
    with pytest.raises(ValidationError):
        Blueprint.model_validate(data)


@pytest.mark.parametrize("version", [0, -1, "one"])
def test_invalid_version_rejected(version: Any) -> None:
    data = make_blueprint()
    data["version"] = version
    with pytest.raises(ValidationError):
        Blueprint.model_validate(data)


def test_empty_name_rejected() -> None:
    data = make_blueprint()
    data["metadata"]["name"] = ""
    with pytest.raises(ValidationError):
        Blueprint.model_validate(data)


@pytest.mark.parametrize("missing", ["id", "source", "source_port", "target", "target_port"])
def test_edge_missing_field_rejected(missing: str) -> None:
    data = make_blueprint()
    del data["edges"][0][missing]
    with pytest.raises(ValidationError):
        Blueprint.model_validate(data)


def test_duplicate_node_ids_rejected() -> None:
    data = make_blueprint()
    data["nodes"].append(copy.deepcopy(data["nodes"][0]))
    with pytest.raises(ValidationError, match="duplicate node ids"):
        Blueprint.model_validate(data)


def test_duplicate_edge_ids_rejected() -> None:
    data = make_blueprint()
    data["edges"].append(copy.deepcopy(data["edges"][0]))
    with pytest.raises(ValidationError, match="duplicate edge ids"):
        Blueprint.model_validate(data)


@pytest.mark.parametrize("end", ["source", "target"])
def test_edge_to_unknown_node_rejected(end: str) -> None:
    data = make_blueprint()
    data["edges"][0][end] = "ghost"
    with pytest.raises(ValidationError, match="unknown node"):
        Blueprint.model_validate(data)


def test_nodes_must_be_a_list() -> None:
    data = make_blueprint()
    data["nodes"] = {"joy": data["nodes"][0]}
    with pytest.raises(ValidationError):
        Blueprint.model_validate(data)
