"""Score manager component."""

from collections.abc import Mapping
from typing import Any

from app.components.base import read_vector2
from app.schemas.component import (
    ComponentCategory,
    ComponentDefinition,
    ParameterConstraint,
    ParameterType,
    PortDataType,
    PortDefinition,
)

DEFINITION = ComponentDefinition(
    type="score_manager",
    name="Score Manager",
    description="Detects goals from the ball position and keeps the score for both teams.",
    category=ComponentCategory.LOGIC,
    inputs=[
        PortDefinition(name="ball_position", data_type=PortDataType.VECTOR2, description="Current ball position."),
        PortDefinition(name="reset", data_type=PortDataType.EVENT, description="Reset both scores to zero."),
    ],
    outputs=[
        PortDefinition(name="home_score", data_type=PortDataType.NUMBER, description="Goals scored by home."),
        PortDefinition(name="away_score", data_type=PortDataType.NUMBER, description="Goals scored by away."),
        PortDefinition(name="goal", data_type=PortDataType.EVENT, description="Fires when a goal is scored."),
    ],
    default_parameters={"field_width": 100.0, "field_height": 60.0, "goal_width": 20.0},
    parameter_constraints={
        "field_width": ParameterConstraint(type=ParameterType.NUMBER, minimum=10.0, maximum=1000.0),
        "field_height": ParameterConstraint(type=ParameterType.NUMBER, minimum=10.0, maximum=1000.0),
        "goal_width": ParameterConstraint(
            type=ParameterType.NUMBER, minimum=1.0, maximum=500.0, description="Goal mouth size, centered vertically."
        ),
    },
)


def execute(inputs: Mapping[str, Any], parameters: Mapping[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Placeholder: home attacks the right goal (x >= field_width), away attacks the left (x <= 0)."""
    if inputs.get("reset"):
        state["home_score"] = state["away_score"] = 0

    home, away = state.get("home_score", 0), state.get("away_score", 0)
    x, y = read_vector2(inputs.get("ball_position"))
    in_goal_mouth = abs(y - parameters["field_height"] / 2) <= parameters["goal_width"] / 2

    goal = False
    if in_goal_mouth and x >= parameters["field_width"]:
        home, goal = home + 1, True
    elif in_goal_mouth and x <= 0:
        away, goal = away + 1, True

    state["home_score"], state["away_score"] = home, away
    return {"home_score": home, "away_score": away, "goal": goal}
