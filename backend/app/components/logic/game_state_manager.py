"""Game state manager component."""

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
    type="game_state_manager",
    name="Game State Manager",
    description="Tracks match status, decides the winner, and requests a ball reset after goals.",
    category=ComponentCategory.LOGIC,
    inputs=[
        PortDefinition(name="home_score", data_type=PortDataType.NUMBER),
        PortDefinition(name="away_score", data_type=PortDataType.NUMBER),
        PortDefinition(name="goal", data_type=PortDataType.EVENT, description="Fires when a goal is scored."),
    ],
    outputs=[
        PortDefinition(name="game_state", data_type=PortDataType.GAME_STATE, description="Current match state."),
        PortDefinition(name="reset_ball", data_type=PortDataType.EVENT, description="Fires to re-center the ball."),
    ],
    default_parameters={"winning_score": 5, "reset_on_goal": True},
    parameter_constraints={
        "winning_score": ParameterConstraint(
            type=ParameterType.INTEGER, minimum=1, maximum=99, description="Goals needed to win."
        ),
        "reset_on_goal": ParameterConstraint(
            type=ParameterType.BOOLEAN, description="Reset the ball after each goal."
        ),
    },
)


def execute(inputs: Mapping[str, Any], parameters: Mapping[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Placeholder: first team to `winning_score` wins."""
    home, away = int(inputs.get("home_score", 0)), int(inputs.get("away_score", 0))
    target = parameters["winning_score"]
    winner = "home" if home >= target else "away" if away >= target else None

    game_state = {
        "status": "finished" if winner else "playing",
        "home_score": home,
        "away_score": away,
        "winner": winner,
    }
    return {
        "game_state": game_state,
        "reset_ball": bool(inputs.get("goal")) and parameters["reset_on_goal"],
    }
