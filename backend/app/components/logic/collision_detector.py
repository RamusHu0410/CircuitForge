"""Collision detector component."""

import math
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
    type="collision_detector",
    name="Collision Detector",
    description="Fires when two positions are within a set distance of each other.",
    category=ComponentCategory.LOGIC,
    inputs=[
        PortDefinition(
            name="position_a", data_type=PortDataType.VECTOR2, required=True, description="First object, e.g. a player."
        ),
        PortDefinition(
            name="position_b", data_type=PortDataType.VECTOR2, required=True, description="Second object, e.g. the ball."
        ),
    ],
    outputs=[
        PortDefinition(name="collision", data_type=PortDataType.EVENT, description="Fires on contact."),
        PortDefinition(
            name="direction", data_type=PortDataType.VECTOR2, description="Unit vector from A to B on contact."
        ),
    ],
    default_parameters={"collision_distance": 2.0},
    parameter_constraints={
        "collision_distance": ParameterConstraint(
            type=ParameterType.NUMBER, minimum=0.1, maximum=50.0, description="Contact distance in field units."
        ),
    },
)


def execute(inputs: Mapping[str, Any], parameters: Mapping[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Placeholder: distance check between two points."""
    ax, ay = read_vector2(inputs.get("position_a"))
    bx, by = read_vector2(inputs.get("position_b"))
    dx, dy = bx - ax, by - ay
    distance = math.hypot(dx, dy)

    collided = distance <= parameters["collision_distance"]
    direction = vector2(dx / distance, dy / distance) if collided and distance > 0 else vector2()
    return {"collision": collided, "direction": direction}
