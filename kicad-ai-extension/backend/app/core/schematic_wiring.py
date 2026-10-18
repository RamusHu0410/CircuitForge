"""Turn a placed circuit into routed wires.

Pins connect to their net with real wires. Any connection that cannot be routed
(for example because it would have to cross another net) is marked as *failed* and
drawn later as a net label instead, so it is still electrically correct.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from app.core.circuit_validator import ResolvedCircuit
from app.core.geometry import G, Cell, Direction, Grid, PlacedSymbol, outward
from app.core.wire_router import BLOCKED, WireRouter

MARGIN = 6  # extra routing cells around the circuit


@dataclass
class PinSite:
    ref: str
    number: str
    net: str | None
    electrical_type: str
    cell: Cell | None  # None if the pin is not on the 2.54 mm grid
    point: tuple[float, float]
    out: Direction
    stub: Cell | None = None  # first wire cell outside the pin, once claimed
    connected: bool = False  # joined to the net's main wire tree

    @property
    def label_cell(self) -> Cell | None:
        return self.stub or self.cell


@dataclass
class NetWiring:
    name: str
    sites: list[PinSite]
    tree: set[Cell] = field(default_factory=set)
    attach_tips: dict[Cell, Direction] = field(default_factory=dict)  # power symbol / flag tips

    @property
    def failed_sites(self) -> list[PinSite]:
        return [s for s in self.sites if not s.connected]


@dataclass
class Wiring:
    router: WireRouter
    sites: dict[tuple[str, str], PinSite]
    nets: dict[str, NetWiring]
    no_connects: list[tuple[float, float]]
    pin_cells: set[Cell]


def _manhattan(a: Cell, b: Cell) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def _prune_dead_ends(router: WireRouter, net: str, keep: set[Cell]) -> set[Cell]:
    """Remove wire pieces that lead nowhere (leaf cells not in `keep`) and free their cells.

    A leaf that isn't a pin would be a dangling wire end in KiCad (an ERC warning). Returns the
    cells still used by the net.
    """
    edges = router.edges[net]
    while True:
        degree: dict[Cell, int] = {}
        for a, b in edges:
            degree[a] = degree.get(a, 0) + 1
            degree[b] = degree.get(b, 0) + 1
        leaves = {cell for cell, d in degree.items() if d == 1 and cell not in keep}
        if not leaves:
            return set(degree)
        for edge in [e for e in edges if e[0] in leaves or e[1] in leaves]:
            edges.discard(edge)
        for cell in leaves:
            if router.owner.get(cell) == net:
                del router.owner[cell]


def wire_nets(circuit: ResolvedCircuit, placed: list[PlacedSymbol], grid: Grid, buses: dict[str, int]) -> Wiring:
    pin_net = {pin: net for net, pins in circuit.net_pins.items() for pin in pins}
    layout = circuit.spec.layout
    remote = set(layout.remote_nets) if layout else set()
    hub = layout.hub if layout else None

    def is_remote(net: str, site: PinSite) -> bool:
        """True if the pin is drawn by name (label / power symbol) rather than wired."""
        return net in remote and site.ref != hub

    sites: dict[tuple[str, str], PinSite] = {}
    all_cells: list[Cell] = []
    for pc in placed:
        x0, y0, x1, y1 = pc.extent()
        for x, y in ((x0, y0), (x1, y1)):
            all_cells.append((math.floor((x - grid.x0) / G), math.floor((y - grid.y0) / G)))
            all_cells.append((math.ceil((x - grid.x0) / G), math.ceil((y - grid.y0) / G)))
        for pin in pc.symbol.pins:
            point = pc.pin_point(pin)
            sites[(pc.ref, pin.number)] = PinSite(
                ref=pc.ref,
                number=pin.number,
                net=pin_net.get((pc.ref, pin.number)),
                electrical_type=pin.electrical_type,
                cell=grid.cell(*point),
                point=point,
                out=outward(pin, pc.rot, pc.mirror),
            )

    i_min = min(c[0] for c in all_cells) - MARGIN
    i_max = max(c[0] for c in all_cells) + MARGIN
    j_min = min([c[1] for c in all_cells] + list(buses.values())) - MARGIN
    j_max = max([c[1] for c in all_cells] + list(buses.values())) + MARGIN
    router = WireRouter((i_min, j_min, i_max, j_max))

    # Symbol bodies (and their pin lines) are obstacles; pin end points are not.
    pin_cells = {s.cell for s in sites.values() if s.cell is not None}
    for pc in placed:
        x0, y0, x1, y1 = pc.extent()
        eps = 1e-6
        for i in range(math.ceil((x0 - grid.x0) / G - eps), math.floor((x1 - grid.x0) / G + eps) + 1):
            for j in range(math.ceil((y0 - grid.y0) / G - eps), math.floor((y1 - grid.y0) / G + eps) + 1):
                if (i, j) not in pin_cells:
                    router.block((i, j))

    router.no_pass = set(pin_cells)

    no_connects: list[tuple[float, float]] = []
    for site in sites.values():
        if site.cell is None:
            continue
        if site.net is None:
            router.owner[site.cell] = BLOCKED
            no_connects.append(site.point)
        elif router.owner.get(site.cell) not in (None, site.net):
            router.owner[site.cell] = BLOCKED  # two different nets on the same cell: leave to labels
            site.cell = None
        else:
            router.owner[site.cell] = site.net

    nets: dict[str, NetWiring] = {}
    net_sites: dict[str, list[PinSite]] = {name: [] for name in circuit.net_pins}
    for key, site in sites.items():
        if site.net is not None:
            net_sites[site.net].append(site)

    def span(name: str) -> int:
        cells = [s.cell for s in net_sites[name] if s.cell is not None]
        if len(cells) < 2:
            return 0
        return (max(c[0] for c in cells) - min(c[0] for c in cells)) + (max(c[1] for c in cells) - min(c[1] for c in cells))

    order = sorted(circuit.net_pins, key=lambda n: (n not in buses, span(n), n))
    for name in order:
        nw = NetWiring(name=name, sites=net_sites[name])
        nets[name] = nw
        if len(nw.sites) < 2:
            continue  # a one-pin net has nothing to connect to; the caller labels it

        tips: dict[Cell, list[PinSite]] = {}
        for site in nw.sites:
            if site.cell is None:
                continue
            tip = (site.cell[0] + site.out[0], site.cell[1] + site.out[1])
            if router.claim(tip, name):
                router.add_edge(name, site.cell, tip)
                site.stub = tip
                tips.setdefault(tip, []).append(site)

        tree: set[Cell] = set()
        routed_tips = [t for t, group in tips.items() if any(not is_remote(name, s) for s in group)]
        if name in buses and routed_tips:
            row = buses[name]
            i0, i1 = min(t[0] for t in routed_tips), max(t[0] for t in routed_tips)
            cells = [(i, row) for i in range(i0, i1 + 1)]
            if all(router.can_use(c, name) for c in cells):
                for c in cells:
                    router.owner[c] = name
                for a, b in zip(cells, cells[1:]):
                    router.add_edge(name, a, b)
                tree = set(cells)

        routed = {t: [s for s in group if not is_remote(name, s)] for t, group in tips.items()}
        routed = {t: group for t, group in routed.items() if group}
        pending = sorted(routed)
        if not tree and pending:
            first = pending.pop(0)
            tree = {first}
            for s in routed[first]:
                s.connected = True
        while pending:
            tip = min(pending, key=lambda t: min(_manhattan(t, c) for c in tree))
            pending.remove(tip)
            if tip in tree:
                path: list[Cell] | None = [tip]
            else:
                path = router.find_path(name, tip, tree)
            if path:
                router.commit_path(name, path)
                tree.update(path)
                for s in routed[tip]:
                    s.connected = True
        if name in buses:
            for tip in routed:
                if tip in tree:
                    for s in routed[tip]:
                        s.connected = True

        # A rail can be drawn further than the pins that ended up using it. Drop dead-end pieces.
        keep = {s.cell for s in nw.sites if s.cell is not None}
        if any(not s.connected for s in nw.sites):
            keep |= set(tips)  # labels hang off these tips
        tree = _prune_dead_ends(router, name, keep) | (tree & keep)
        # Pins drawn by name keep their short stub, but it is not part of the net's wire tree.
        remote_cells = {c for s in nw.sites if is_remote(name, s) for c in (s.cell, s.stub) if c is not None}
        nw.tree = tree - remote_cells

    return Wiring(router=router, sites=sites, nets=nets, no_connects=no_connects, pin_cells=pin_cells)
