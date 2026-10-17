"""Whole-blueprint validation.

`validate_blueprint` never raises for an invalid design: it collects every
problem it finds and returns a `ValidationResult`. Checks are deterministic
and linear-ish in the size of the graph; no component code is executed.

Cycle policy: the MVP executes the graph in topological order once per tick.
A cycle is allowed only if it passes through a node whose component sets
`accepts_feedback` (edges into it carry the previous tick's value). Any other
cycle is an error. Allowed feedback loops are reported as warnings.
"""

from collections import Counter
from collections.abc import Iterable

from app.core.component_registry import ComponentRegistry
from app.core.connection_validator import index_nodes, validate_connection, validate_connections
from app.schemas.blueprint import Blueprint, BlueprintEdge, BlueprintNode
from app.schemas.common import ValidationCode, ValidationIssue, ValidationResult


def validate_blueprint(blueprint: Blueprint, registry: ComponentRegistry) -> ValidationResult:
    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    if not blueprint.nodes:
        errors.append(
            ValidationIssue(code=ValidationCode.EMPTY_BLUEPRINT, message="Blueprint has no components.")
        )

    errors.extend(_check_unique_ids(blueprint))
    for node in blueprint.nodes:
        errors.extend(_check_node(node, registry))
    errors.extend(validate_connections(blueprint, registry))
    errors.extend(_check_required_inputs(blueprint, registry))

    cycle_errors, feedback_warnings = _check_cycles(blueprint, registry)
    errors.extend(cycle_errors)
    warnings.extend(feedback_warnings)
    warnings.extend(_check_unconnected_nodes(blueprint))

    return ValidationResult.from_issues(errors, warnings)


# --- Node checks ------------------------------------------------------------


def _check_unique_ids(blueprint: Blueprint) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for node_id, count in Counter(node.id for node in blueprint.nodes).items():
        if count > 1:
            issues.append(
                ValidationIssue(
                    code=ValidationCode.DUPLICATE_NODE_ID,
                    message=f"Node ID '{node_id}' is used by {count} nodes; node IDs must be unique.",
                    node_id=node_id,
                )
            )
    for edge_id, count in Counter(edge.id for edge in blueprint.edges).items():
        if count > 1:
            issues.append(
                ValidationIssue(
                    code=ValidationCode.DUPLICATE_EDGE_ID,
                    message=f"Edge ID '{edge_id}' is used by {count} edges; edge IDs must be unique.",
                    edge_id=edge_id,
                )
            )
    return issues


def _check_node(node: BlueprintNode, registry: ComponentRegistry) -> list[ValidationIssue]:
    if node.type not in registry:
        return [
            ValidationIssue(
                code=ValidationCode.UNKNOWN_COMPONENT,
                message=(
                    f"Node '{node.id}' uses unknown component type '{node.type}'. "
                    f"Available types: {', '.join(sorted(registry.types))}."
                ),
                node_id=node.id,
                field="type",
            )
        ]

    definition = registry.get_definition(node.type)
    issues: list[ValidationIssue] = []
    for name, value in node.parameters.items():
        constraint = definition.parameter_constraints.get(name)
        if constraint is None:
            issues.append(
                ValidationIssue(
                    code=ValidationCode.UNKNOWN_PARAMETER,
                    message=(
                        f"Node '{node.id}' ({node.type}) has no parameter '{name}'. "
                        f"Available parameters: {', '.join(definition.parameter_constraints) or 'none'}."
                    ),
                    node_id=node.id,
                    field=name,
                )
            )
            continue
        error = constraint.validate_value(value)
        if error:
            issues.append(
                ValidationIssue(
                    code=ValidationCode.INVALID_PARAMETER,
                    message=f"Parameter '{name}' on node '{node.id}' ({node.type}) {error}; got {value!r}.",
                    node_id=node.id,
                    field=name,
                )
            )
    return issues


def _check_required_inputs(blueprint: Blueprint, registry: ComponentRegistry) -> list[ValidationIssue]:
    connected = {(edge.target, edge.target_port) for edge in blueprint.edges}
    issues: list[ValidationIssue] = []
    for node in index_nodes(blueprint.nodes).values():
        if node.type not in registry:
            continue
        for port in registry.get_definition(node.type).inputs:
            if port.required and (node.id, port.name) not in connected:
                issues.append(
                    ValidationIssue(
                        code=ValidationCode.MISSING_REQUIRED_INPUT,
                        message=f"Required input '{port.name}' ({port.data_type}) on node '{node.id}' is not connected.",
                        node_id=node.id,
                        field=port.name,
                    )
                )
    return issues


def _check_unconnected_nodes(blueprint: Blueprint) -> list[ValidationIssue]:
    if len(blueprint.nodes) < 2:
        return []
    linked = {end for edge in blueprint.edges for end in (edge.source, edge.target)}
    return [
        ValidationIssue(
            code=ValidationCode.UNCONNECTED_NODE,
            message=f"Node '{node.id}' ({node.type}) is not connected to anything.",
            node_id=node.id,
        )
        for node in index_nodes(blueprint.nodes).values()
        if node.id not in linked
    ]


# --- Cycle checks -----------------------------------------------------------


def _check_cycles(
    blueprint: Blueprint, registry: ComponentRegistry
) -> tuple[list[ValidationIssue], list[ValidationIssue]]:
    """Return (errors for unsupported cycles, warnings for allowed feedback loops)."""
    nodes_by_id = index_nodes(blueprint.nodes)
    order = list(nodes_by_id)

    # Only analyze edges that are otherwise valid; broken edges are already reported.
    edges = [e for e in blueprint.edges if not validate_connection(e, nodes_by_id, registry)]

    def is_feedback(edge: BlueprintEdge) -> bool:
        return registry.get_definition(nodes_by_id[edge.target].type).accepts_feedback

    errors: list[ValidationIssue] = []
    immediate = [e for e in edges if not is_feedback(e)]
    for component in _cyclic_components(order, immediate):
        members = [n for n in order if n in component]
        path = " -> ".join(members)
        for edge in immediate:
            if edge.source in component and edge.target in component:
                errors.append(
                    ValidationIssue(
                        code=ValidationCode.CYCLE_DETECTED,
                        message=(
                            f"Edge '{edge.id}' is part of an unsupported cycle ({path}). "
                            "Cycles must pass through a component that accepts feedback."
                        ),
                        node_id=edge.target,
                        edge_id=edge.id,
                    )
                )

    warnings: list[ValidationIssue] = []
    if not errors:
        for component in _cyclic_components(order, edges):
            for edge in edges:
                if is_feedback(edge) and edge.source in component and edge.target in component:
                    warnings.append(
                        ValidationIssue(
                            code=ValidationCode.FEEDBACK_LOOP,
                            message=(
                                f"Edge '{edge.id}' closes a feedback loop; node '{edge.target}' receives "
                                f"{edge.source}.{edge.source_port} one tick later."
                            ),
                            node_id=edge.target,
                            edge_id=edge.id,
                        )
                    )
    return errors, warnings


def _cyclic_components(nodes: list[str], edges: Iterable[BlueprintEdge]) -> list[set[str]]:
    """Strongly connected components that contain a cycle (size > 1, or a self-loop).

    Iterative Tarjan's algorithm, so deep graphs cannot hit Python's recursion limit.
    """
    adjacency: dict[str, list[str]] = {n: [] for n in nodes}
    self_loops: set[str] = set()
    for edge in edges:
        adjacency[edge.source].append(edge.target)
        if edge.source == edge.target:
            self_loops.add(edge.source)

    index: dict[str, int] = {}
    lowlink: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    result: list[set[str]] = []
    counter = 0

    for root in nodes:
        if root in index:
            continue
        work = [(root, iter(adjacency[root]))]
        index[root] = lowlink[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)

        while work:
            node, neighbors = work[-1]
            advanced = False
            for nxt in neighbors:
                if nxt not in index:
                    index[nxt] = lowlink[nxt] = counter
                    counter += 1
                    stack.append(nxt)
                    on_stack.add(nxt)
                    work.append((nxt, iter(adjacency[nxt])))
                    advanced = True
                    break
                if nxt in on_stack:
                    lowlink[node] = min(lowlink[node], index[nxt])
            if advanced:
                continue

            work.pop()
            if work:
                parent = work[-1][0]
                lowlink[parent] = min(lowlink[parent], lowlink[node])
            if lowlink[node] == index[node]:
                component: set[str] = set()
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    component.add(member)
                    if member == node:
                        break
                if len(component) > 1 or node in self_loops:
                    result.append(component)
    return result
