"""Blueprint schemas.

A blueprint is a graph of component nodes connected by edges between ports.
Node `id`, `type`, `position` and edge `id`, `source`, `target` map directly to
React Flow nodes and edges; `source_port`/`target_port` map to React Flow's
`sourceHandle`/`targetHandle`.

These models check structure only (types, unique IDs, edges pointing at real
nodes). Checking component types, ports and parameter values against the
component registry is the graph validator's job.
"""

from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints, model_validator

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
    nodes: list[BlueprintNode] = Field(default_factory=list)
    edges: list[BlueprintEdge] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_graph_structure(self) -> Self:
        node_ids = [node.id for node in self.nodes]
        duplicate_nodes = sorted({i for i in node_ids if node_ids.count(i) > 1})
        if duplicate_nodes:
            raise ValueError(f"duplicate node ids: {duplicate_nodes}")

        edge_ids = [edge.id for edge in self.edges]
        duplicate_edges = sorted({i for i in edge_ids if edge_ids.count(i) > 1})
        if duplicate_edges:
            raise ValueError(f"duplicate edge ids: {duplicate_edges}")

        known = set(node_ids)
        for edge in self.edges:
            missing = [end for end in (edge.source, edge.target) if end not in known]
            if missing:
                raise ValueError(f"edge '{edge.id}' references unknown node(s): {missing}")
        return self
