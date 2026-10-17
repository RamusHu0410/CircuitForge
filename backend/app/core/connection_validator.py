"""Edge (connection) validation against the component registry.

Every edge must go from an existing node's output port to an existing node's
input port of a compatible data type. The registry is the only source of truth
for which ports exist; nothing is inferred or auto-created.
"""

from collections import Counter
from collections.abc import Iterable, Mapping

from app.core.component_registry import ComponentRegistry
from app.schemas.blueprint import Blueprint, BlueprintEdge, BlueprintNode
from app.schemas.common import ValidationCode, ValidationIssue
from app.schemas.component import ComponentDefinition, PortDataType, PortDefinition


def are_port_types_compatible(source: PortDataType, target: PortDataType) -> bool:
    """Whether an output of type `source` may feed an input of type `target`.

    The MVP has no implicit conversions; extend here if any are added.
    """
    return source == target


def index_nodes(nodes: Iterable[BlueprintNode]) -> dict[str, BlueprintNode]:
    """Map node ID to node. With duplicate IDs the first node wins (duplicates are reported separately)."""
    index: dict[str, BlueprintNode] = {}
    for node in nodes:
        index.setdefault(node.id, node)
    return index


def _names(ports: list[PortDefinition]) -> str:
    return ", ".join(port.name for port in ports) or "none"


def _resolve_port(
    edge: BlueprintEdge,
    node: BlueprintNode,
    definition: ComponentDefinition,
    *,
    as_source: bool,
) -> tuple[PortDefinition | None, ValidationIssue | None]:
    """Find the edge's port on `node`; return (port, None) or (None, issue)."""
    port_name = edge.source_port if as_source else edge.target_port
    field = "source_port" if as_source else "target_port"
    wanted, wanted_label = (definition.outputs, "output") if as_source else (definition.inputs, "input")
    other, other_label = (definition.inputs, "input") if as_source else (definition.outputs, "output")

    port = next((p for p in wanted if p.name == port_name), None)
    if port is not None:
        return port, None

    if any(p.name == port_name for p in other):
        role = "source" if as_source else "target"
        issue = ValidationIssue(
            code=ValidationCode.INVALID_PORT_DIRECTION,
            message=(
                f"Port '{port_name}' on node '{node.id}' ({node.type}) is an {other_label}, "
                f"so it cannot be a connection {role}. Available {wanted_label}s: {_names(wanted)}."
            ),
            node_id=node.id,
            edge_id=edge.id,
            field=field,
        )
    else:
        issue = ValidationIssue(
            code=ValidationCode.UNKNOWN_PORT,
            message=(
                f"Node '{node.id}' ({node.type}) has no {wanted_label} port '{port_name}'. "
                f"Available {wanted_label}s: {_names(wanted)}."
            ),
            node_id=node.id,
            edge_id=edge.id,
            field=field,
        )
    return None, issue


def validate_connection(
    edge: BlueprintEdge,
    nodes_by_id: Mapping[str, BlueprintNode],
    registry: ComponentRegistry,
) -> list[ValidationIssue]:
    """Validate a single edge in isolation."""
    issues: list[ValidationIssue] = []
    ports: dict[str, PortDefinition] = {}

    for as_source, node_id, field in ((True, edge.source, "source"), (False, edge.target, "target")):
        node = nodes_by_id.get(node_id)
        if node is None:
            issues.append(
                ValidationIssue(
                    code=ValidationCode.UNKNOWN_NODE,
                    message=f"Edge '{edge.id}' {field} references node '{node_id}', which does not exist.",
                    node_id=node_id,
                    edge_id=edge.id,
                    field=field,
                )
            )
            continue

        if node.type not in registry:
            issues.append(
                ValidationIssue(
                    code=ValidationCode.UNKNOWN_COMPONENT,
                    message=(
                        f"Edge '{edge.id}' {field} node '{node.id}' uses unregistered component type '{node.type}'."
                    ),
                    node_id=node.id,
                    edge_id=edge.id,
                    field=field,
                )
            )
            continue

        port, issue = _resolve_port(edge, node, registry.get_definition(node.type), as_source=as_source)
        if issue:
            issues.append(issue)
        else:
            ports[field] = port

    if "source" in ports and "target" in ports:
        source_type, target_type = ports["source"].data_type, ports["target"].data_type
        if not are_port_types_compatible(source_type, target_type):
            issues.append(
                ValidationIssue(
                    code=ValidationCode.INCOMPATIBLE_PORT_TYPES,
                    message=(
                        f"Edge '{edge.id}' connects {edge.source}.{edge.source_port} ({source_type}) to "
                        f"{edge.target}.{edge.target_port} ({target_type}); port types are incompatible."
                    ),
                    node_id=edge.target,
                    edge_id=edge.id,
                )
            )
    return issues


def validate_connections(blueprint: Blueprint, registry: ComponentRegistry) -> list[ValidationIssue]:
    """Validate all edges, including checks that span multiple edges."""
    nodes_by_id = index_nodes(blueprint.nodes)
    issues: list[ValidationIssue] = []
    seen_connections: dict[tuple[str, str, str, str], str] = {}
    fan_in: Counter[tuple[str, str]] = Counter()
    fan_in_edges: dict[tuple[str, str], list[str]] = {}

    for edge in blueprint.edges:
        edge_issues = validate_connection(edge, nodes_by_id, registry)
        issues.extend(edge_issues)

        key = (edge.source, edge.source_port, edge.target, edge.target_port)
        if key in seen_connections:
            issues.append(
                ValidationIssue(
                    code=ValidationCode.DUPLICATE_CONNECTION,
                    message=(
                        f"Edge '{edge.id}' duplicates edge '{seen_connections[key]}' "
                        f"({edge.source}.{edge.source_port} -> {edge.target}.{edge.target_port})."
                    ),
                    node_id=edge.target,
                    edge_id=edge.id,
                )
            )
            continue
        seen_connections[key] = edge.id

        if not edge_issues:
            target = (edge.target, edge.target_port)
            fan_in[target] += 1
            fan_in_edges.setdefault(target, []).append(edge.id)

    # An input receives exactly one value per tick, so it may have only one incoming edge.
    for (node_id, port_name), count in fan_in.items():
        if count > 1:
            edge_ids = fan_in_edges[(node_id, port_name)]
            for edge_id in edge_ids[1:]:
                issues.append(
                    ValidationIssue(
                        code=ValidationCode.MULTIPLE_INPUT_CONNECTIONS,
                        message=(
                            f"Input '{node_id}.{port_name}' already has a connection ('{edge_ids[0]}'); "
                            "an input port accepts only one connection."
                        ),
                        node_id=node_id,
                        edge_id=edge_id,
                        field="target_port",
                    )
                )
    return issues
