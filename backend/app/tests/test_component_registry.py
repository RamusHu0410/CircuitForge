"""Component schema and registry tests."""

from typing import Any

import pytest
from pydantic import ValidationError

from app.core.component_registry import ComponentRegistry, create_default_registry
from app.core.errors import DuplicateComponentError, UnknownComponentError
from app.schemas.component import (
    ComponentCategory,
    ComponentDefinition,
    ParameterConstraint,
    ParameterType,
    PortDataType,
)

EXPECTED_COMPONENTS = {
    "joystick": ComponentCategory.INPUT,
    "player_controller": ComponentCategory.CONTROLLER,
    "ball_controller": ComponentCategory.CONTROLLER,
    "collision_detector": ComponentCategory.LOGIC,
    "score_manager": ComponentCategory.LOGIC,
    "game_state_manager": ComponentCategory.LOGIC,
    "led_controller": ComponentCategory.OUTPUT,
}


def make_definition(**overrides: Any) -> ComponentDefinition:
    data: dict[str, Any] = {
        "type": "test_component",
        "name": "Test Component",
        "description": "Used in tests.",
        "category": "logic",
        "inputs": [{"name": "value", "data_type": "number"}],
        "outputs": [{"name": "result", "data_type": "number"}],
        "default_parameters": {"gain": 1.0},
        "parameter_constraints": {"gain": {"type": "number", "minimum": 0, "maximum": 10}},
    }
    data.update(overrides)
    return ComponentDefinition.model_validate(data)


def noop(inputs: Any, parameters: Any, state: Any) -> dict[str, Any]:
    return {}


# --- Registration and lookup ------------------------------------------------


def test_register_and_get() -> None:
    registry = ComponentRegistry()
    definition = make_definition()
    registry.register(definition, noop)

    assert "test_component" in registry
    assert len(registry) == 1
    assert registry.get_definition("test_component") is definition
    assert registry.get_executor("test_component") is noop
    assert registry.list_definitions() == [definition]


def test_duplicate_registration_rejected() -> None:
    registry = ComponentRegistry()
    registry.register(make_definition(), noop)

    with pytest.raises(DuplicateComponentError, match="'test_component' is already registered"):
        registry.register(make_definition(name="Another"), noop)
    assert len(registry) == 1


def test_unknown_component_reports_clearly() -> None:
    registry = ComponentRegistry()
    registry.register(make_definition(), noop)

    with pytest.raises(UnknownComponentError) as exc_info:
        registry.get("laser_cannon")

    assert exc_info.value.component_type == "laser_cannon"
    assert str(exc_info.value) == "Unknown component type 'laser_cannon'. Available types: test_component."


def test_register_rejects_non_callable_execute() -> None:
    with pytest.raises(TypeError):
        ComponentRegistry().register(make_definition(), "not callable")  # type: ignore[arg-type]


# --- Built-in components ----------------------------------------------------


def test_default_registry_has_all_seven_components() -> None:
    registry = create_default_registry()
    assert {d.type: d.category for d in registry.list_definitions()} == EXPECTED_COMPONENTS


@pytest.mark.parametrize("component_type", EXPECTED_COMPONENTS)
def test_builtin_component_has_typed_ports_and_parameters(component_type: str) -> None:
    definition = create_default_registry().get_definition(component_type)

    ports = definition.inputs + definition.outputs
    assert ports, "component must have at least one port"
    assert all(isinstance(port.data_type, PortDataType) for port in ports)
    assert definition.default_parameters, "component must have configurable parameters"
    assert definition.default_parameters.keys() == definition.parameter_constraints.keys()


@pytest.mark.parametrize("component_type", EXPECTED_COMPONENTS)
def test_builtin_placeholder_returns_declared_outputs(component_type: str) -> None:
    registry = create_default_registry()
    definition = registry.get_definition(component_type)

    outputs = registry.get_executor(component_type)({}, dict(definition.default_parameters), {})

    assert set(outputs) == {port.name for port in definition.outputs}


# --- Component definition validation ---------------------------------------


def test_unknown_port_data_type_rejected() -> None:
    with pytest.raises(ValidationError):
        make_definition(inputs=[{"name": "value", "data_type": "string"}])


def test_duplicate_port_names_rejected() -> None:
    port = {"name": "value", "data_type": "number"}
    with pytest.raises(ValidationError, match="duplicate input port names"):
        make_definition(inputs=[port, port])


def test_default_without_constraint_rejected() -> None:
    with pytest.raises(ValidationError, match="same keys"):
        make_definition(default_parameters={"gain": 1.0, "offset": 0.0})


@pytest.mark.parametrize(
    ("constraint", "default"),
    [
        ({"type": "number", "minimum": 0, "maximum": 10}, 11.0),
        ({"type": "number", "minimum": 0, "maximum": 10}, True),
        ({"type": "integer", "minimum": 1}, 2.5),
        ({"type": "boolean"}, 1),
        ({"type": "enum", "options": ["red", "green"]}, "blue"),
    ],
)
def test_default_violating_constraint_rejected(constraint: dict[str, Any], default: Any) -> None:
    with pytest.raises(ValidationError, match="default for parameter 'gain'"):
        make_definition(default_parameters={"gain": default}, parameter_constraints={"gain": constraint})


@pytest.mark.parametrize(
    "constraint",
    [
        {"type": "number", "minimum": 5, "maximum": 1},
        {"type": "enum"},
        {"type": "enum", "options": []},
        {"type": "boolean", "minimum": 0},
        {"type": "number", "options": ["a"]},
    ],
)
def test_inconsistent_constraint_rejected(constraint: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        ParameterConstraint.model_validate(constraint)


def test_constraint_validate_value() -> None:
    constraint = ParameterConstraint(type=ParameterType.INTEGER, minimum=1, maximum=3)
    assert constraint.validate_value(2) is None
    assert constraint.validate_value(4) == "must be <= 3.0"
    assert constraint.validate_value(False) == "must be an integer"
