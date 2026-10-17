"""Ball controller component."""

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
    type="ball_controller",
    name="Ball Controller",
    description="Moves the ball, applies friction, and reacts to hits and resets.",
    category=ComponentCategory.CONTROLLER,
    inputs=[
        PortDefinition(name="hit", data_type=PortDataType.EVENT, description="Kick the ball this tick."),
        PortDefinition(name="hit_direction", data_type=PortDataType.VECTOR2, description="Unit direction of the kick."),
        PortDefinition(name="reset", data_type=PortDataType.EVENT, description="Return the ball to its start position."),
    ],
    outputs=[
        PortDefinition(name="position", data_type=PortDataType.VECTOR2, description="Current ball position."),
        PortDefinition(name="velocity", data_type=PortDataType.VECTOR2, description="Current ball velocity."),
    ],
    default_parameters={"kick_speed": 4.0, "friction": 0.05, "start_x": 50.0, "start_y": 30.0},
    parameter_constraints={
        "kick_speed": ParameterConstraint(
            type=ParameterType.NUMBER, minimum=0.0, maximum=30.0, description="Speed after being hit."
        ),
        "friction": ParameterConstraint(
            type=ParameterType.NUMBER, minimum=0.0, maximum=1.0, description="Fraction of speed lost per tick."
        ),
        "start_x": ParameterConstraint(type=ParameterType.NUMBER, minimum=0.0, maximum=1000.0),
        "start_y": ParameterConstraint(type=ParameterType.NUMBER, minimum=0.0, maximum=1000.0),
    },
)


def execute(inputs: Mapping[str, Any], parameters: Mapping[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Placeholder: simple kick + friction movement."""
    start = vector2(parameters["start_x"], parameters["start_y"])
    if inputs.get("reset"):
        state["position"], state["velocity"] = start, vector2()

    px, py = read_vector2(state.get("position", start))
    vx, vy = read_vector2(state.get("velocity"))

    if inputs.get("hit"):
        hx, hy = read_vector2(inputs.get("hit_direction"))
        vx, vy = hx * parameters["kick_speed"], hy * parameters["kick_speed"]

    damping = 1.0 - parameters["friction"]
    velocity = vector2(vx * damping, vy * damping)
    position = vector2(px + velocity["x"], py + velocity["y"])
    state["position"], state["velocity"] = position, velocity
    return {"position": position, "velocity": velocity}
