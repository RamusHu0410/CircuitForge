"""Shared pytest fixtures."""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.component_registry import ComponentRegistry, get_component_registry
from app.main import create_app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def registry() -> ComponentRegistry:
    """The real application registry from Step 2."""
    return get_component_registry()


def _node(node_id: str, component_type: str, x: float, y: float, **parameters: Any) -> dict[str, Any]:
    return {"id": node_id, "type": component_type, "position": {"x": x, "y": y}, "parameters": parameters}


def _edge(edge_id: str, source: str, source_port: str, target: str, target_port: str) -> dict[str, str]:
    return {
        "id": edge_id,
        "source": source,
        "source_port": source_port,
        "target": target,
        "target_port": target_port,
    }


@pytest.fixture
def football_blueprint() -> dict[str, Any]:
    """A complete, valid football game using all seven built-in components."""
    return {
        "id": "football-1",
        "version": 1,
        "metadata": {"name": "Football", "description": "One player, one ball, two goals."},
        "nodes": [
            _node("joystick", "joystick", 0, 0),
            _node("player", "player_controller", 250, 0, speed=3.0),
            _node("ball", "ball_controller", 250, 200),
            _node("collision", "collision_detector", 500, 100),
            _node("score", "score_manager", 500, 300),
            _node("game", "game_state_manager", 750, 300, winning_score=3),
            _node("leds", "led_controller", 1000, 300, flash_color="yellow"),
        ],
        "edges": [
            _edge("e-joy-player", "joystick", "direction", "player", "direction"),
            _edge("e-player-col", "player", "position", "collision", "position_a"),
            _edge("e-ball-col", "ball", "position", "collision", "position_b"),
            _edge("e-col-hit", "collision", "collision", "ball", "hit"),
            _edge("e-col-dir", "collision", "direction", "ball", "hit_direction"),
            _edge("e-ball-score", "ball", "position", "score", "ball_position"),
            _edge("e-home", "score", "home_score", "game", "home_score"),
            _edge("e-away", "score", "away_score", "game", "away_score"),
            _edge("e-goal", "score", "goal", "game", "goal"),
            _edge("e-reset", "game", "reset_ball", "ball", "reset"),
            _edge("e-state-led", "game", "game_state", "leds", "game_state"),
            _edge("e-goal-led", "score", "goal", "leds", "flash"),
        ],
    }
