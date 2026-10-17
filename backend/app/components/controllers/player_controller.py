"""Player controller component."""

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
    type="player_controller",
    name="Player Controller",
    description="Moves a player on the field according to a direction input.",
    category=ComponentCategory.CONTROLLER,
    inputs=[
        PortDefinition(name="direction", data_type=PortDataType.VECTOR2, description="Desired movement direction."),
    ],
    outputs=[
        PortDefinition(name="position", data_type=PortDataType.VECTOR2, description="Current player position."),
        PortDefinition(name="velocity", data_type=PortDataType.VECTOR2, description="Movement this tick."),
    ],
    default_parameters={"speed": 2.0, "start_x": 20.0, "start_y": 30.0},
    parameter_constraints={
        "speed": ParameterConstraint(
            type=ParameterType.NUMBER, minimum=0.1, maximum=20.0, description="Field units moved per tick."
        ),
        "start_x": ParameterConstraint(type=ParameterType.NUMBER, minimum=0.0, maximum=1000.0),
        "start_y": ParameterConstraint(type=ParameterType.NUMBER, minimum=0.0, maximum=1000.0),
    },
)


def execute(inputs: Mapping[str, Any], parameters: Mapping[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Placeholder: moves the player by direction * speed each tick."""
    dx, dy = read_vector2(inputs.get("direction"))
    x, y = read_vector2(state.get("position", vector2(parameters["start_x"], parameters["start_y"])))

    velocity = vector2(dx * parameters["speed"], dy * parameters["speed"])
    position = vector2(x + velocity["x"], y + velocity["y"])
    state["position"] = position
    return {"position": position, "velocity": velocity}
