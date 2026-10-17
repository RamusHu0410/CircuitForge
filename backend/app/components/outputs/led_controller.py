"""LED controller output component."""

from collections.abc import Mapping
from typing import Any

from app.schemas.component import (
    ComponentCategory,
    ComponentDefinition,
    ParameterConstraint,
    ParameterType,
    PortDataType,
    PortDefinition,
)

DEFINITION = ComponentDefinition(
    type="led_controller",
    name="LED Controller",
    description="Drives an LED strip: shows match status and flashes on events such as goals.",
    category=ComponentCategory.OUTPUT,
    inputs=[
        PortDefinition(name="game_state", data_type=PortDataType.GAME_STATE, description="Match state to display."),
        PortDefinition(name="flash", data_type=PortDataType.EVENT, description="Trigger a flash, e.g. on a goal."),
    ],
    outputs=[],
    default_parameters={"led_count": 8, "brightness": 0.8, "flash_color": "green", "flash_duration_ms": 500},
    parameter_constraints={
        "led_count": ParameterConstraint(type=ParameterType.INTEGER, minimum=1, maximum=256),
        "brightness": ParameterConstraint(type=ParameterType.NUMBER, minimum=0.0, maximum=1.0),
        "flash_color": ParameterConstraint(
            type=ParameterType.ENUM, options=["red", "green", "blue", "white", "yellow"]
        ),
        "flash_duration_ms": ParameterConstraint(type=ParameterType.INTEGER, minimum=0, maximum=5000),
    },
)


def execute(inputs: Mapping[str, Any], parameters: Mapping[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Placeholder: records the display state for the simulator; has no output ports."""
    game_state = inputs.get("game_state") or {}
    state["display"] = {
        "led_count": parameters["led_count"],
        "brightness": parameters["brightness"],
        "flashing": bool(inputs.get("flash")),
        "color": parameters["flash_color"],
        "status": game_state.get("status", "idle"),
    }
    return {}
