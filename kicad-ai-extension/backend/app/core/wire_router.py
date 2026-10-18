"""Orthogonal wire routing on a coarse grid.

The router never lets two different nets share a grid cell, so wires of
different nets can never touch, cross, or end on each other by accident. If a
connection cannot be routed, the caller falls back to net labels, so a
failed route never produces a wrong circuit.
"""

from __future__ import annotations

import heapq
import itertools
from collections import defaultdict

from app.core.geometry import Cell

BLOCKED = "#"
_STEPS = ((1, 0), (0, 1), (-1, 0), (0, -1))
TURN_COST = 3


def _edge(a: Cell, b: Cell) -> tuple[Cell, Cell]:
    return (a, b) if a <= b else (b, a)


class WireRouter:
    def __init__(self, bounds: tuple[int, int, int, int]) -> None:
        """bounds = (imin, jmin, imax, jmax), inclusive."""
        self.bounds = bounds
        self.owner: dict[Cell, str] = {}
        self.edges: dict[str, set[tuple[Cell, Cell]]] = defaultdict(set)
        # Pin end points: a wire may start next to one (via its stub) but never pass through it.
        self.no_pass: set[Cell] = set()

    # --- Occupancy --------------------------------------------------------------------

    def in_bounds(self, cell: Cell) -> bool:
        i0, j0, i1, j1 = self.bounds
        return i0 <= cell[0] <= i1 and j0 <= cell[1] <= j1

    def block(self, cell: Cell) -> None:
        self.owner.setdefault(cell, BLOCKED)

    def can_use(self, cell: Cell, net: str) -> bool:
        return self.in_bounds(cell) and cell not in self.no_pass and self.owner.get(cell, net) == net

    def claim(self, cell: Cell, net: str) -> bool:
        if not self.can_use(cell, net):
            return False
        self.owner[cell] = net
        return True

    def add_edge(self, net: str, a: Cell, b: Cell) -> None:
        self.edges[net].add(_edge(a, b))

    # --- Routing ----------------------------------------------------------------------

    def find_path(self, net: str, start: Cell, targets: set[Cell]) -> list[Cell] | None:
        """Cheapest orthogonal path from `start` to any cell in `targets` (turns cost extra)."""
        if start in targets:
            return [start]
        counter = itertools.count()
        heap: list[tuple[int, int, Cell, int]] = [(0, next(counter), start, -1)]
        best: dict[tuple[Cell, int], int] = {(start, -1): 0}
        parent: dict[tuple[Cell, int], tuple[Cell, int] | None] = {(start, -1): None}

        while heap:
            cost, _, cell, heading = heapq.heappop(heap)
            if best.get((cell, heading), cost) < cost:
                continue
            if cell in targets:
                path, state = [], (cell, heading)
                while state is not None:
                    path.append(state[0])
                    state = parent[state]
                return path[::-1]
            for k, (di, dj) in enumerate(_STEPS):
                nxt = (cell[0] + di, cell[1] + dj)
                if not self.can_use(nxt, net):
                    continue
                new_cost = cost + 1 + (TURN_COST if heading not in (-1, k) else 0)
                key = (nxt, k)
                if new_cost < best.get(key, 1 << 30):
                    best[key] = new_cost
                    parent[key] = (cell, heading)
                    heapq.heappush(heap, (new_cost, next(counter), nxt, k))
        return None

    def commit_path(self, net: str, path: list[Cell]) -> None:
        for cell in path:
            self.owner[cell] = net
        for a, b in zip(path, path[1:]):
            self.add_edge(net, a, b)


# --- Edges -> wire segments ----------------------------------------------------------------


def edges_to_wires(
    edges: set[tuple[Cell, Cell]], terminals: set[Cell]
) -> tuple[list[tuple[Cell, Cell]], set[Cell], set[Cell]]:
    """Merge unit edges into straight wires.

    Returns (segments, junction_cells, node_cells). Every wire starts and ends at a
    node (pin/terminal, corner, tee or dead end), so connectivity never depends on a
    wire end touching the *middle* of another wire.
    """
    adjacency: dict[Cell, set[Cell]] = defaultdict(set)
    for a, b in edges:
        adjacency[a].add(b)
        adjacency[b].add(a)

    def is_node(cell: Cell) -> bool:
        neighbors = adjacency[cell]
        if cell in terminals or len(neighbors) != 2:
            return True
        a, b = tuple(neighbors)
        return not (a[0] - cell[0] == cell[0] - b[0] and a[1] - cell[1] == cell[1] - b[1])  # corner

    nodes = {cell for cell in adjacency if is_node(cell)}
    seen: set[tuple[Cell, Cell]] = set()
    segments: list[tuple[Cell, Cell]] = []
    for start in sorted(nodes):
        for first in sorted(adjacency[start]):
            if _edge(start, first) in seen:
                continue
            prev, cur = start, first
            seen.add(_edge(prev, cur))
            while cur not in nodes:
                nxt = next(n for n in adjacency[cur] if n != prev)
                seen.add(_edge(cur, nxt))
                prev, cur = cur, nxt
            segments.append((start, cur))
    junctions = {cell for cell in adjacency if len(adjacency[cell]) >= 3}
    return segments, junctions, nodes
