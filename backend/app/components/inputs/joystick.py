"""Joystick input component."""

from collections.abc import Mapping
from typing import Any

from app.components.base import read_vector2, vector2
from app.schemas.component import (
    ComponentCategory,
    ComponentDefinition,
    ParameterConstraint,
    ParameterType,
    PortDataType,
    PortDefinition,
)

DEFINITION = ComponentDefinition(
    type="joystick",
    name="Joystick",
    description="Two-axis joystick with a push button. Emits a direction vector with each axis in [-1, 1].",
    category=ComponentCategory.INPUT,
    inputs=[],
    outputs=[
        PortDefinition(name="direction", data_type=PortDataType.VECTOR2, description="Stick direction."),
        PortDefinition(name="button", data_type=PortDataType.EVENT, description="Fires while the button is pressed."),
    ],
    default_parameters={"dead_zone": 0.1, "sensitivity": 1.0, "invert_y": False},
    parameter_constraints={
        "dead_zone": ParameterConstraint(
            type=ParameterType.NUMBER, minimum=0.0, maximum=0.9, description="Axis values below this are ignored."
        ),
        "sensitivity": ParameterConstraint(
            type=ParameterType.NUMBER, minimum=0.1, maximum=5.0, description="Multiplier applied to each axis."
        ),
        "invert_y": ParameterConstraint(type=ParameterType.BOOLEAN, description="Flip the vertical axis."),
    },
)


def execute(inputs: Mapping[str, Any], parameters: Mapping[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Placeholder: reads raw stick values that the simulator stores in `state`."""
    raw_x, raw_y = read_vector2(state.get("raw_direction"))

    def shape(axis: float) -> float:
        if abs(axis) < parameters["dead_zone"]:
            return 0.0
        return max(-1.0, min(1.0, axis * parameters["sensitivity"]))

    y = -raw_y if parameters["invert_y"] else raw_y
    return {
        "direction": vector2(shape(raw_x), shape(y)),
        "button": bool(state.get("button_pressed", False)),
    }
