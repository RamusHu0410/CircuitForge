"""Render a validated circuit as a native KiCad 10 schematic (+ minimal project file).

Drawing strategy
- Components are placed on a 2.54 mm routing grid, either from the circuit's layout hints
  (tidy, hand-planned positions) or an automatic grid.
- Every connection is drawn as real wires, routed orthogonally; wires of different nets never
  touch. A connection that cannot be routed falls back to matching net labels, so the
  electrical result is always correct.
- Power symbols are drawn only for nets that have power-input pins (ICs). PWR_FLAGs mark
  externally supplied nets so ERC is clean. Nets with 3+ pins get a name label.
"""

from __future__ import annotations

import copy
import json
import logging
import math
import re
import uuid as uuid_module
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from app.core import sexpr
from app.core.circuit_validator import ResolvedCircuit
from app.core.component_registry import COMPONENT_KINDS, POWER_SYMBOLS, PWR_FLAG
from app.core.geometry import G, Cell, Direction, Grid, LayoutError, PlacedSymbol, place_by_anchor, symbol_extent, to_screen
from app.core.schematic_wiring import NetWiring, PinSite, Wiring, wire_nets
from app.core.sexpr import SExpr, Sym
from app.core.symbol_library import SymbolInfo, get_library
from app.core.wire_router import edges_to_wires
from app.schemas.circuit import SchematicFiles

logger = logging.getLogger(__name__)

SCHEMATIC_VERSION = 20260306  # format written by KiCad 10.0 (`kicad-cli sch upgrade`)
GENERATOR = "kicad_ai_schematic_backend"
PAPERS = [("A4", 297.0, 210.0), ("A3", 420.0, 297.0), ("A2", 594.0, 420.0), ("A1", 841.0, 594.0)]

# Schematic directions (+x right, +y down) and the rotation order of a symbol turning counter-clockwise.
RIGHT, UP, LEFT, DOWN = (1, 0), (0, -1), (-1, 0), (0, 1)
_CCW_ORDER = [DOWN, RIGHT, UP, LEFT]


def safe_name(title: str) -> str:
    """File-system-safe base name derived from the circuit title."""
    slug = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")
    return (slug or "ai_circuit")[:48]


def _yes(flag: bool) -> Sym:
    return Sym("yes" if flag else "no")


# --- Which nets are named / powered -----------------------------------------------------


def _types(circuit: ResolvedCircuit, net: str) -> set[str]:
    return {circuit.symbols[ref].pin(num).electrical_type for ref, num in circuit.net_pins[net]}


def needs_power_symbol(circuit: ResolvedCircuit, net: str) -> bool:
    return net in POWER_SYMBOLS and "power_in" in _types(circuit, net)


def needs_flag(circuit: ResolvedCircuit, net: str) -> bool:
    types = _types(circuit, net)
    return "power_in" in types and "power_out" not in types


def named_nets(circuit: ResolvedCircuit) -> set[str]:
    """Nets whose name appears in the drawing (power symbol or label), so KiCad reports that name."""
    return {
        net
        for net, pins in circuit.net_pins.items()
        if needs_power_symbol(circuit, net) or len(pins) >= 3
    }


# --- Emitting items -----------------------------------------------------------------------


@dataclass
class _Ctx:
    new_uuid: Callable[[], str]
    sheet_uuid: str
    project: str
    items: list[SExpr]
    grid: Grid
    power_counter: int = 0
    flag_counter: int = 0


def _effects(justify: str | None = None) -> list[SExpr]:
    eff: list[SExpr] = [Sym("effects"), [Sym("font"), [Sym("size"), 1.27, 1.27]]]
    if justify:
        eff.append([Sym("justify"), *[Sym(j) for j in justify.split()]])
    return eff


def _place_symbol(
    ctx: _Ctx,
    symbol: SymbolInfo,
    ref: str,
    value: str,
    footprint: str,
    x: float,
    y: float,
    rotation: int = 0,
    mirror: bool = False,
    text_at: dict[str, tuple[float, float, str]] | None = None,
) -> None:
    """Instantiate a library symbol at (x, y).

    Property positions follow the library defaults unless `text_at` gives
    {"Reference"/"Value": (x, y, justify)} in schematic coordinates.
    """
    at: list[SExpr] = [Sym("at"), x, y, rotation]
    item: list[SExpr] = [Sym("symbol"), [Sym("lib_id"), symbol.lib_id], at]
    if mirror:
        item.append([Sym("mirror"), Sym("y")])
    item += [
        [Sym("unit"), 1],
        [Sym("exclude_from_sim"), Sym("no")],
        [Sym("in_bom"), _yes(not symbol.is_power)],
        [Sym("on_board"), _yes(not symbol.is_power)],
        [Sym("dnp"), Sym("no")],
        [Sym("uuid"), ctx.new_uuid()],
    ]
    overrides = {"Reference": ref, "Value": value, "Footprint": footprint}
    for prop in sexpr.children(symbol.tree, "property"):
        name = str(prop[1])
        if name.startswith("ki_"):
            continue
        new_prop = copy.deepcopy(prop)
        if name in overrides:
            new_prop[2] = overrides[name]
        prop_at = sexpr.child(new_prop, "at")
        if prop_at is not None:
            if text_at and name in text_at:
                tx, ty, tjustify = text_at[name]
                # KiCad stores a field's angle relative to the part's rotation; this keeps the text horizontal.
                prop_at[1:] = [tx, ty, (-rotation) % 180]
                effects = sexpr.child(new_prop, "effects")
                if effects is not None:
                    effects[:] = [e for e in effects if sexpr.head(e) != "justify"]
                    if tjustify:
                        effects.append([Sym("justify"), *[Sym(j) for j in tjustify.split()]])
            else:
                px, py = sexpr.to_float(prop_at[1]), sexpr.to_float(prop_at[2])
                angle = int(sexpr.to_float(prop_at[3])) if len(prop_at) > 3 else 0
                dx, dy = to_screen(px, py, rotation, mirror)
                prop_at[1:] = [round(x + dx, 4), round(y + dy, 4), (angle + rotation) % 180]
        item.append(new_prop)
    for number in sorted({p.number for p in symbol.pins}, key=lambda n: (len(n), n)):
        item.append([Sym("pin"), number, [Sym("uuid"), ctx.new_uuid()]])
    item.append(
        [
            Sym("instances"),
            [Sym("project"), ctx.project, [Sym("path"), f"/{ctx.sheet_uuid}", [Sym("reference"), ref], [Sym("unit"), 1]]],
        ]
    )
    ctx.items.append(item)


def _wire(ctx: _Ctx, a: tuple[float, float], b: tuple[float, float]) -> None:
    ctx.items.append(
        [
            Sym("wire"),
            [Sym("pts"), [Sym("xy"), a[0], a[1]], [Sym("xy"), b[0], b[1]]],
            [Sym("stroke"), [Sym("width"), 0], [Sym("type"), Sym("default")]],
            [Sym("uuid"), ctx.new_uuid()],
        ]
    )


def _junction(ctx: _Ctx, at: tuple[float, float]) -> None:
    ctx.items.append(
        [
            Sym("junction"),
            [Sym("at"), at[0], at[1]],
            [Sym("diameter"), 0],
            [Sym("color"), 0, 0, 0, 0],
            [Sym("uuid"), ctx.new_uuid()],
        ]
    )


def _label(ctx: _Ctx, net: str, at: tuple[float, float], direction: Direction) -> None:
    """A net label whose text extends away from the connection point in `direction`."""
    angle, justify = {
        RIGHT: (0, "left bottom"),
        UP: (90, "left bottom"),
        LEFT: (180, "right bottom"),
        DOWN: (270, "right bottom"),
    }[direction]
    ctx.items.append(
        [
            Sym("label"),
            net,
            [Sym("at"), at[0], at[1], angle],
            [Sym("fields_autoplaced"), Sym("yes")],
            _effects(justify),
            [Sym("uuid"), ctx.new_uuid()],
        ]
    )


def _no_connect(ctx: _Ctx, at: tuple[float, float]) -> None:
    ctx.items.append([Sym("no_connect"), [Sym("at"), at[0], at[1]], [Sym("uuid"), ctx.new_uuid()]])


def _power_symbol(ctx: _Ctx, lib_id: str, value: str, at: tuple[float, float], direction: Direction) -> None:
    """Place a power symbol so its body points in `direction` from the connection point."""
    symbol = get_library()[lib_id]
    default = DOWN if lib_id == "power:GND" else UP
    steps = (_CCW_ORDER.index(direction) - _CCW_ORDER.index(default)) % 4
    if lib_id == PWR_FLAG:
        ctx.flag_counter += 1
        ref = f"#FLG{ctx.flag_counter:02d}"
    else:
        ctx.power_counter += 1
        ref = f"#PWR{ctx.power_counter:02d}"
    _place_symbol(ctx, symbol, ref, value, "", at[0], at[1], rotation=90 * steps)


def _text(ctx: _Ctx, text: str, at: tuple[float, float]) -> None:
    ctx.items.append(
        [
            Sym("text"),
            text,
            [Sym("exclude_from_sim"), Sym("no")],
            [Sym("at"), at[0], at[1], 0],
            _effects("left top"),
            [Sym("uuid"), ctx.new_uuid()],
        ]
    )


def _text_positions(pc: PlacedSymbol, value: str) -> dict[str, tuple[float, float, str]] | None:
    """Reference/Value text beside rotated or mirrored parts (library positions only suit upright ones).

    Text is centred (no justification) because KiCad flips left/right justification on rotated parts.
    """
    if pc.rot == 0 and not pc.mirror:
        return None
    x0, y0, x1, y1 = pc.extent()
    half = lambda text: len(text) * 0.65  # noqa: E731  half the width of a 1.27 mm font string, in mm
    if (y1 - y0) >= (x1 - x0):  # tall part: text to the side away from the pins, stacked
        if pc.mirror:  # pins face right, so text goes on the left
            return {
                "Reference": (round(x0 - 1.27 - half(pc.ref), 4), round(pc.y - 1.27, 4), ""),
                "Value": (round(x0 - 1.27 - half(value), 4), round(pc.y + 1.27, 4), ""),
            }
        return {
            "Reference": (round(x1 + 1.27 + half(pc.ref), 4), round(pc.y - 1.27, 4), ""),
            "Value": (round(x1 + 1.27 + half(value), 4), round(pc.y + 1.27, 4), ""),
        }
    return {  # wide part: reference above, value below
        "Reference": (pc.x, round(y0 - 2.54, 4), ""),
        "Value": (pc.x, round(y1 + 2.54, 4), ""),
    }


# --- Layout -------------------------------------------------------------------------------


def _hinted_layout(circuit: ResolvedCircuit, grid: Grid) -> tuple[list[PlacedSymbol], dict[str, int]]:
    layout = circuit.spec.layout
    if layout is None:
        raise LayoutError("no layout hints")
    placed: list[PlacedSymbol] = []
    for component in circuit.spec.components:
        hint = layout.placements.get(component.ref)
        if hint is None:
            raise LayoutError(f"{component.ref} has no placement")
        symbol = circuit.symbols[component.ref]
        try:
            symbol.pin(hint.pin)
        except KeyError:
            raise LayoutError(f"{component.ref} has no pin {hint.pin}") from None
        placed.append(
            place_by_anchor(
                component.ref, symbol, hint.pin, grid.point((hint.col, hint.row)),
                rot=hint.rot, mirror=hint.mirror, direction=hint.direction,
            )
        )
    _check_layout(placed, grid)
    return placed, dict(layout.buses)


def _check_layout(placed: list[PlacedSymbol], grid: Grid) -> None:
    seen: dict[Cell, str] = {}
    for pc in placed:
        for pin in pc.symbol.pins:
            cell = grid.cell(*pc.pin_point(pin))
            if cell is None:
                continue
            if cell in seen:
                raise LayoutError(f"{pc.ref} pin {pin.number} lands on {seen[cell]}")
            seen[cell] = pc.ref


def _auto_layout(circuit: ResolvedCircuit, grid: Grid) -> list[PlacedSymbol]:
    """Simple grid, no rotation. Used when there are no usable layout hints."""
    components = circuit.spec.components
    sizes = []
    for component in components:
        x0, y0, x1, y1 = symbol_extent(circuit.symbols[component.ref])
        sizes.append(math.ceil(max(x1 - x0, y1 - y0) / G))
    spacing = max(sizes) + 8
    columns = max(1, math.ceil(math.sqrt(len(components) * 1.5)))
    placed = []
    for index, component in enumerate(components):
        symbol = circuit.symbols[component.ref]
        anchor = symbol.pins[0]
        col, row = (index % columns) * spacing + spacing // 2 + 2, (index // columns) * spacing + spacing // 2 + 2
        x0, y0, x1, y1 = symbol_extent(symbol)
        # Put the symbol's centre (not its first pin) near the cell, keeping the first pin on the grid.
        centre_dx, centre_dy = to_screen((x0 + x1) / 2, (y0 + y1) / 2, 0, False)
        pin_dx, pin_dy = to_screen(anchor.x, anchor.y, 0, False)
        col += round((pin_dx - centre_dx) / G)
        row += round((pin_dy - centre_dy) / G)
        placed.append(place_by_anchor(component.ref, symbol, anchor.number, grid.point((col, row))))
    return placed


# --- Attachments (power symbols, flags, labels) -----------------------------------------------


def _attach_tip(
    wiring: Wiring, nw: NetWiring, direction: Direction, taken: list[Cell], spacing: int = 3
) -> Cell | None:
    """Reserve a short stub off the net's wire tree for a power symbol/flag; returns the tip cell."""
    router = wiring.router
    key = (lambda c: (c[1], c[0])) if direction == UP else (lambda c: (-c[1], c[0]))
    for cell in sorted((c for c in nw.tree if c not in wiring.pin_cells and c not in router.crossings), key=key):
        tip = (cell[0] + direction[0], cell[1] + direction[1])
        beyond = (tip[0] + direction[0], tip[1] + direction[1])
        beyond2 = (beyond[0] + direction[0], beyond[1] + direction[1])
        px, py = (1, 0) if direction[0] == 0 else (0, 1)  # perpendicular to the stub
        sides = [(tip[0] - px, tip[1] - py), (tip[0] + px, tip[1] + py), (beyond[0] - px, beyond[1] - py), (beyond[0] + px, beyond[1] + py)]
        if any(abs(tip[0] - t[0]) < spacing and abs(tip[1] - t[1]) < spacing for t in taken):
            continue
        cells = [tip, beyond, beyond2, *(sides if direction[0] == 0 else [])]  # symbols beside a wire are not checked
        if any(c in nw.tree or (router.in_bounds(c) is False) or router.owner.get(c) is not None for c in cells):
            continue
        router.owner[tip] = nw.name
        router.add_edge(nw.name, cell, tip)
        nw.attach_tips[tip] = direction
        taken.append(tip)
        return tip
    return None


def _horizontal_edge(wiring: Wiring, net: str, a: Cell, b: Cell) -> bool:
    return ((a, b) if a <= b else (b, a)) in wiring.router.edges[net]


def _run_length(wiring: Wiring, net: str, cell: Cell, direction: Direction) -> int:
    """Number of consecutive wire cells leaving `cell` in `direction`."""
    count, cur = 0, cell
    while True:
        nxt = (cur[0] + direction[0], cur[1] + direction[1])
        if not _horizontal_edge(wiring, net, cur, nxt):
            return count
        count, cur = count + 1, nxt


def _free_run(wiring: Wiring, cell: Cell, direction: Direction, length: int) -> bool:
    for step in range(1, length + 1):
        probe = (cell[0] + direction[0] * step, cell[1] + direction[1] * step)
        if not wiring.router.in_bounds(probe) or wiring.router.owner.get(probe) is not None:
            return False
    return True


def _pick_label_node(wiring: Wiring, nw: NetWiring, nodes: set[Cell]) -> tuple[Cell, Direction] | None:
    """Where to put the net-name label: a wire node (corner, tee or end) that is not a pin.

    Prefers sitting on top of a long straight wire; otherwise points the text into free space,
    so it never lands on a pin number or another part's text.
    """
    candidates = sorted(c for c in nodes if c not in wiring.pin_cells and c not in nw.attach_tips and c in nw.tree)
    needed = max(2, math.ceil(len(nw.name) * 1.0 / G) + 1)  # cells of room for the text
    for cell in candidates:
        if _run_length(wiring, nw.name, cell, RIGHT) >= needed:
            return cell, RIGHT
    for cell in candidates:
        for direction in (UP, RIGHT, LEFT, DOWN):
            if _free_run(wiring, cell, direction, needed):
                return cell, direction
    for cell in candidates:
        if _run_length(wiring, nw.name, cell, RIGHT) >= 1:
            return cell, RIGHT
    return (candidates[0], UP) if candidates else None


def _draw_remote_net(ctx: _Ctx, grid: Grid, net: str, nw: NetWiring, symbol_nets: set[str]) -> None:
    """Connect a net by name: a label at every pin, or a power symbol at every pin for rails.

    Pins that were wired (the layout's hub) already carry the net's power symbol and PWR_FLAG when
    it is a rail, so only the other pins get a symbol of their own.
    """
    is_rail = net in POWER_SYMBOLS

    def label_at(site: PinSite) -> None:
        point = grid.point(site.label_cell) if site.label_cell else site.point
        # Horizontal text reads best, so vertical pins get their label pointing left.
        _label(ctx, net, point, site.out if site.out in (LEFT, RIGHT) else LEFT)

    for site in nw.sites:
        if site.connected:
            continue
        if is_rail:
            point = grid.point(site.label_cell) if site.label_cell else site.point
            _power_symbol(ctx, POWER_SYMBOLS[net], net, point, site.out)
        else:
            label_at(site)
    # The wired pins (the hub's, or a wired group) share one wire, so one label names it.
    wired = [s for s in nw.sites if s.connected]
    if wired and (not is_rail or net not in symbol_nets):
        first = min(wired, key=lambda s: (s.point[0], s.point[1]))
        if is_rail:  # a rail is named by its power symbol (a text label of the same name makes ERC warn)
            point = grid.point(first.label_cell) if first.label_cell else first.point
            _power_symbol(ctx, POWER_SYMBOLS[net], net, point, first.out)
        else:
            label_at(first)


# --- Document -------------------------------------------------------------------------------


def render_schematic(
    circuit: ResolvedCircuit,
    prompt: str = "",
    new_uuid: Callable[[], str] = lambda: str(uuid_module.uuid4()),
) -> SchematicFiles:
    if not circuit.report.valid:
        raise ValueError("cannot render an invalid circuit")

    spec = circuit.spec
    name = safe_name(spec.title)
    grid = Grid()
    ctx = _Ctx(new_uuid=new_uuid, sheet_uuid=new_uuid(), project=name, items=[], grid=grid)

    try:
        placed, buses = _hinted_layout(circuit, grid)
    except LayoutError as exc:
        if spec.layout is not None:
            logger.warning("ignoring layout hints for '%s': %s", spec.title, exc)
        placed, buses = _auto_layout(circuit, grid), {}

    kinds = {c.ref: COMPONENT_KINDS[c.kind] for c in spec.components}
    values = {c.ref: c.value for c in spec.components}
    for pc in placed:
        _place_symbol(
            ctx, pc.symbol, pc.ref, values[pc.ref], kinds[pc.ref].footprint, pc.x, pc.y, pc.rot, pc.mirror,
            text_at=_text_positions(pc, values[pc.ref]),
        )

    wiring = wire_nets(circuit, placed, grid, buses)
    router = wiring.router

    # Power symbols, PWR_FLAGs and labels hang off each net's wire tree.
    symbol_tips: list[tuple[str, str, Cell, Direction]] = []  # (lib_id, value, tip, direction)
    label_wanted: set[str] = set()
    symbol_nets: set[str] = set()  # nets named by a power symbol (never also by a local label)
    remote = set(spec.layout.remote_nets) if spec.layout else set()  # nets drawn by name, not by wire
    for net, nw in wiring.nets.items():
        taken: list[Cell] = []
        has_symbol = False
        if needs_power_symbol(circuit, net) and nw.tree:
            direction = DOWN if net == "GND" else UP
            tip = _attach_tip(wiring, nw, direction, taken)
            if tip:
                symbol_tips.append((POWER_SYMBOLS[net], net, tip, direction))
                has_symbol = True
                symbol_nets.add(net)
        if needs_flag(circuit, net) and nw.tree:
            direction = DOWN if net == "GND" else UP
            tip = _attach_tip(wiring, nw, direction, taken)
            for side in (RIGHT, LEFT):  # a small wire tree (e.g. one part's pins) may have no room above/below
                if tip:
                    break
                direction = side
                tip = _attach_tip(wiring, nw, side, taken, spacing=2)
            if tip:
                symbol_tips.append((PWR_FLAG, "PWR_FLAG", tip, direction))
        if net in remote:
            continue  # its labels / power symbols are drawn below
        if nw.failed_sites or (not has_symbol and len(nw.sites) >= 3 and not needs_power_symbol(circuit, net)):
            label_wanted.add(net)
        elif needs_power_symbol(circuit, net) and not has_symbol:
            label_wanted.add(net)

    for lib_id, value, tip, direction in symbol_tips:
        _power_symbol(ctx, lib_id, value, grid.point(tip), direction)

    # Wires and junctions.
    for net, nw in wiring.nets.items():
        terminals = {s.cell for s in nw.sites if s.cell is not None} | set(nw.attach_tips)
        segments, junctions, nodes = edges_to_wires(router.edges[net], terminals)
        for a, b in segments:
            _wire(ctx, grid.point(a), grid.point(b))
        for cell in sorted(junctions):
            _junction(ctx, grid.point(cell))

        if net in remote:
            _draw_remote_net(ctx, grid, net, nw, symbol_nets)
            continue
        if net not in label_wanted:
            continue
        # Pins whose wires could not be completed are connected by name.
        for site in nw.failed_sites:
            target = site.label_cell
            point = grid.point(target) if target else site.point
            if net in symbol_nets:  # a local label would clash with the global power symbol
                _power_symbol(ctx, POWER_SYMBOLS[net], net, point, site.out)
            else:
                _label(ctx, net, point, site.out)
        if nw.tree and net not in symbol_nets and (nw.failed_sites or len(nw.sites) >= 3):
            # The name goes on the wired part; the stubs of pins that failed already carry their own label.
            failed_cells = {c for s in nw.failed_sites for c in (s.cell, s.stub) if c is not None}
            picked = _pick_label_node(wiring, nw, nodes - failed_cells)
            if picked:
                _label(ctx, net, grid.point(picked[0]), picked[1])

    for point in wiring.no_connects:
        _no_connect(ctx, point)

    for caption in spec.layout.captions if spec.layout else []:
        _text(ctx, caption.text, grid.point((caption.col, caption.row)))

    # Notes under the drawing.
    cells = [c for edges in router.edges.values() for edge in edges for c in edge]
    max_x = max([grid.point(c)[0] for c in cells] + [pc.extent()[2] for pc in placed])
    max_y = max([grid.point(c)[1] for c in cells] + [pc.extent()[3] for pc in placed])
    notes_y = round((max_y + 15.24) / 1.27) * 1.27
    lines = [spec.title]
    if spec.description:
        lines.append(spec.description)
    lines += [f"- {note}" for note in spec.notes]
    lines.append("Generated by AI Schematic Generator. Review values and run ERC before use.")
    _text(ctx, "\n".join(lines), (grid.x0, round(notes_y, 4)))

    width = max_x + 25.4
    height = notes_y + 3.2 * len(lines) + 15.0
    paper = next((p for p in PAPERS if p[1] >= width and p[2] >= height), PAPERS[-1])[0]

    library = get_library()
    used = sorted(
        {s.lib_id for s in circuit.symbols.values()}
        | {str(sexpr.child(item, "lib_id")[1]) for item in ctx.items if sexpr.head(item) == "symbol"}
    )
    title_block: list[SExpr] = [
        Sym("title_block"),
        [Sym("title"), spec.title],
        [Sym("date"), date.today().isoformat()],
        [Sym("rev"), "1"],
        [Sym("company"), "AI Schematic Generator"],
    ]
    if prompt:
        excerpt = " ".join(prompt.split())
        title_block.append([Sym("comment"), 1, f"Prompt: {excerpt[:120]}{'…' if len(excerpt) > 120 else ''}"])

    document: list[SExpr] = [
        Sym("kicad_sch"),
        [Sym("version"), SCHEMATIC_VERSION],
        [Sym("generator"), GENERATOR],
        [Sym("generator_version"), "10.0"],
        [Sym("uuid"), ctx.sheet_uuid],
        [Sym("paper"), paper],
        title_block,
        [Sym("lib_symbols"), *[copy.deepcopy(library[lib_id].tree) for lib_id in used]],
        *ctx.items,
        [Sym("sheet_instances"), [Sym("path"), "/", [Sym("page"), "1"]]],
        [Sym("embedded_fonts"), Sym("no")],
    ]
    return SchematicFiles(
        name=name,
        schematic=sexpr.dumps(document) + "\n",
        project=render_project(name, ctx.sheet_uuid),
    )


def render_project(name: str, sheet_uuid: str) -> str:
    """Minimal .kicad_pro; KiCad fills in every other setting with defaults on first save."""
    project = {
        "board": {"design_settings": {}},
        "libraries": {"pinned_footprint_libs": [], "pinned_symbol_libs": []},
        "meta": {"filename": f"{name}.kicad_pro", "version": 3},
        "sheets": [[sheet_uuid, "Root"]],
        "text_variables": {},
    }
    return json.dumps(project, indent=2) + "\n"
