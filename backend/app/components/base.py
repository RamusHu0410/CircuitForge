"""Shared types for component implementations.

Each component module exposes:
- `DEFINITION`: a `ComponentDefinition` (metadata only, safe to send to the frontend).
- `execute(inputs, parameters, state)`: the tick function used by the simulator.

`execute` receives input port values keyed by port name, fully resolved
parameters (defaults merged with node overrides), and a mutable per-node state
dict that persists between ticks. It returns output port values keyed by port name.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from app.schemas.component import ComponentDefinition

Vector2 = dict[str, float]
ExecuteFn = Callable[[Mapping[str, Any], Mapping[str, Any], dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class RegisteredComponent:
    """A component definition paired with its execution function."""

    definition: ComponentDefinition
    execute: ExecuteFn


def vector2(x: float = 0.0, y: float = 0.0) -> Vector2:
    return {"x": float(x), "y": float(y)}


def read_vector2(value: Any) -> tuple[float, float]:
    """Read an {x, y} mapping as a tuple, treating missing values as (0, 0)."""
    if isinstance(value, Mapping):
        return float(value.get("x", 0.0)), float(value.get("y", 0.0))
    return 0.0, 0.0
