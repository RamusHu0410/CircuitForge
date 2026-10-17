"""Blueprint schemas.

A blueprint is a graph of component nodes connected by edges between ports.
Node `id`, `type`, `position` and edge `id`, `source`, `target` map directly to
React Flow nodes and edges; `source_port`/`target_port` map to React Flow's
`sourceHandle`/`targetHandle`.

These models check shape only: required fields, value types and identifier
formats. Malformed data fails here (HTTP 422). Graph-level rules (unique IDs,
edges pointing at real nodes, registered components, ports, parameters,
cycles) live in `app.core.graph_validator`, which reports every problem as a
structured validation issue instead of failing on the first one.
"""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints

from app.schemas.component import ParameterValue, SnakeCaseName

# Non-empty identifier without whitespace (accepts UUIDs and React Flow style IDs).
Identifier = Annotated[str, StringConstraints(min_length=1, max_length=128, pattern=r"^\S+$")]


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Position(_StrictModel):
    """Canvas position for React Flow rendering."""

    x: FiniteFloat
    y: FiniteFloat


class BlueprintMetadata(_StrictModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)


class BlueprintNode(_StrictModel):
    """A component instance placed in the design."""

    id: Identifier
    type: SnakeCaseName
    position: Position
    parameters: dict[SnakeCaseName, ParameterValue] = Field(default_factory=dict)


class BlueprintEdge(_StrictModel):
    """A connection from an output port of one node to an input port of another."""

    id: Identifier
    source: Identifier
    source_port: SnakeCaseName
    target: Identifier
    target_port: SnakeCaseName


class Blueprint(_StrictModel):
    id: Identifier
    version: int = Field(default=1, ge=1, description="Revision number, incremented on each edit.")
    metadata: BlueprintMetadata
    # Size caps keep validation fast and bound request cost.
    nodes: list[BlueprintNode] = Field(default_factory=list, max_length=500)
    edges: list[BlueprintEdge] = Field(default_factory=list, max_length=2000)
