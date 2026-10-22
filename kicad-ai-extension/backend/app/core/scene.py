"""Read a generated schematic back as drawing data with nets attached (see app/schemas/scene.py).

The .kicad_sch is the source of truth: symbols, wires, junctions, labels and power symbols are taken
from it, and each drawn item gets its net by following the connectivity KiCad itself uses (wire ends,
pins, wires touching mid-segment, labels and power symbols joining by name). PWR_FLAG symbols only
exist to satisfy ERC, so they and the wire stubs leading to them are left out.
"""

from __future__ import annotations

from app.core import sexpr
from app.core.circuit_validator import ResolvedCircuit
from app.core.geometry import to_screen
from app.core.sexpr import SExpr
from app.schemas.scene import Graphic, LibPin, LibSymbol, Point, Scene, SceneComponent, SceneJunction, SceneLabel, ScenePort, SceneText, SceneWire

PWR_FLAG = "power:PWR_FLAG"
_EPS = 0.005  # mm; everything sits on a 1.27/2.54 mm grid


def _f(node: list[SExpr] | None, i: int, default: float = 0.0) -> float:
    return sexpr.to_float(node[i]) if node is not None and len(node) > i else default


def _key(p: Point) -> tuple[int, int]:
    return round(p[0] * 100), round(p[1] * 100)


def _flag(node: list[SExpr], name: str) -> bool:
    """`(hide yes)` / bare `hide` inside a node."""
    for item in node:
        if item == name:
            return True
        if isinstance(item, list) and sexpr.head(item) == name:
            return len(item) < 2 or str(item[1]) == "yes"
    return False


# --- Library symbols --------------------------------------------------------------------------


def _fill(item: list[SExpr]) -> str:
    fill = sexpr.child(item, "fill")
    kind = str(sexpr.child(fill, "type")[1]) if fill and sexpr.child(fill, "type") else "none"
    return kind if kind in ("outline", "background") else ("background" if kind == "color" else "none")


def _width(item: list[SExpr]) -> float:
    stroke = sexpr.child(item, "stroke")
    return _f(sexpr.child(stroke, "width"), 1) if stroke else 0.0


def _graphic(item: list[SExpr]) -> Graphic | None:
    kind = sexpr.head(item)
    if kind in ("polyline", "bezier"):
        pts = sexpr.child(item, "pts")
        points = [(_f(p, 1), _f(p, 2)) for p in sexpr.children(pts or [], "xy")]
        return Graphic(type="polyline", pts=points, fill=_fill(item), width=_width(item)) if len(points) >= 2 else None
    if kind == "rectangle":
        start, end = sexpr.child(item, "start"), sexpr.child(item, "end")
        return Graphic(type="rect", pts=[(_f(start, 1), _f(start, 2)), (_f(end, 1), _f(end, 2))], fill=_fill(item), width=_width(item))
    if kind == "circle":
        center = sexpr.child(item, "center")
        return Graphic(type="circle", pts=[(_f(center, 1), _f(center, 2))], r=_f(sexpr.child(item, "radius"), 1), fill=_fill(item), width=_width(item))
    if kind == "arc":
        pts = [sexpr.child(item, k) for k in ("start", "mid", "end")]
        if any(p is None for p in pts):
            return None
        return Graphic(type="arc", pts=[(_f(p, 1), _f(p, 2)) for p in pts], fill=_fill(item), width=_width(item))
    return None


def _unit_wanted(name: str) -> bool:
    """Graphics shared by all units (`_0_`) or of unit 1, body style 1 (not the De Morgan alternate)."""
    parts = name.rsplit("_", 2)
    return len(parts) == 3 and parts[1] in ("0", "1") and parts[2] in ("0", "1")


def _lib_symbol(tree: list[SExpr]) -> LibSymbol:
    lib_id = str(tree[1])
    graphics: list[Graphic] = []
    pins: list[LibPin] = []
    for unit in sexpr.children(tree, "symbol"):
        if not _unit_wanted(str(unit[1])):
            continue
        for item in unit:
            if not isinstance(item, list):
                continue
            if sexpr.head(item) == "pin":
                at = sexpr.child(item, "at")
                name, number = sexpr.child(item, "name"), sexpr.child(item, "number")
                pins.append(
                    LibPin(
                        number=str(number[1]) if number else "",
                        name=str(name[1]) if name else "",
                        type=str(item[1]),
                        x=_f(at, 1),
                        y=_f(at, 2),
                        angle=int(_f(at, 3)),
                        length=_f(sexpr.child(item, "length"), 1),
                        hidden=_flag(item, "hide"),
                    )
                )
            else:
                graphic = _graphic(item)
                if graphic:
                    graphics.append(graphic)
    pin_names = sexpr.child(tree, "pin_names")
    pin_numbers = sexpr.child(tree, "pin_numbers")
    return LibSymbol(
        lib_id=lib_id,
        graphics=graphics,
        pins=pins,
        show_pin_numbers=not (pin_numbers is not None and _flag(pin_numbers, "hide")),
        show_pin_names=not (pin_names is not None and _flag(pin_names, "hide")),
        pin_name_offset=_f(sexpr.child(pin_names, "offset"), 1, 0.508) if pin_names else 0.508,
        power=sexpr.child(tree, "power") is not None,
    )


def _text(prop: list[SExpr], rot: int) -> SceneText | None:
    at = sexpr.child(prop, "at")
    effects = sexpr.child(prop, "effects")
    if at is None or _flag(prop, "hide") or (effects is not None and _flag(effects, "hide")):
        return None
    justify = sexpr.child(effects, "justify") if effects else None
    # Field angles are stored relative to the symbol's rotation (see schematic_renderer._place_symbol).
    return SceneText(
        text=str(prop[2]),
        x=_f(at, 1),
        y=_f(at, 2),
        angle=(_f(at, 3) + rot) % 180,
        justify=" ".join(str(j) for j in justify[1:]) if justify else "",
    )


# --- Connectivity -----------------------------------------------------------------------------


class _Union:
    def __init__(self) -> None:
        self.parent: dict[tuple[int, int], tuple[int, int]] = {}

    def find(self, k: tuple[int, int]) -> tuple[int, int]:
        self.parent.setdefault(k, k)
        while self.parent[k] != k:
            self.parent[k] = self.parent[self.parent[k]]
            k = self.parent[k]
        return k

    def join(self, a: tuple[int, int], b: tuple[int, int]) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


def _on_segment(p: Point, a: Point, b: Point) -> bool:
    """Strictly inside an axis-aligned (or any) segment."""
    if abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) > _EPS * max(1.0, abs(b[0] - a[0]) + abs(b[1] - a[1])):
        return False
    within = min(a[0], b[0]) - _EPS <= p[0] <= max(a[0], b[0]) + _EPS and min(a[1], b[1]) - _EPS <= p[1] <= max(a[1], b[1]) + _EPS
    return within and _key(p) not in (_key(a), _key(b))


# --- Scene ------------------------------------------------------------------------------------


def build_scene(schematic: str, circuit: ResolvedCircuit) -> Scene:
    tree = sexpr.loads(schematic)
    lib_node = sexpr.child(tree, "lib_symbols") or []
    library = {str(s[1]): _lib_symbol(s) for s in sexpr.children(lib_node, "symbol")}

    pin_net = {(ref, num): net for net, pins in circuit.net_pins.items() for ref, num in pins}
    specs = {c.ref: c for c in circuit.spec.components}

    components: list[SceneComponent] = []
    ports: list[ScenePort] = []
    flag_points: set[tuple[int, int]] = set()
    pin_points: list[tuple[Point, str | None]] = []  # (point, net known from the circuit)

    for item in sexpr.children(tree, "symbol"):
        lib_id = str(sexpr.child(item, "lib_id")[1])
        at = sexpr.child(item, "at")
        x, y, rot = _f(at, 1), _f(at, 2), int(_f(at, 3)) % 360
        mirror_node = sexpr.child(item, "mirror")
        mirror = mirror_node is not None and str(mirror_node[1]) == "y"
        props = {str(p[1]): p for p in sexpr.children(item, "property")}
        ref = str(props["Reference"][2]) if "Reference" in props else "?"
        value = str(props["Value"][2]) if "Value" in props else ""
        lib = library.get(lib_id)
        if lib is None:
            continue
        if lib_id == PWR_FLAG:
            flag_points.add(_key((x, y)))
            continue
        if lib.power:
            ports.append(ScenePort(lib_id=lib_id, net=value, x=x, y=y, rot=rot, text=_text(props["Value"], rot) if "Value" in props else None))
            continue
        spec = specs.get(ref)
        pin_nets: dict[str, str] = {}
        for pin in lib.pins:
            if pin.hidden:
                continue
            dx, dy = to_screen(pin.x, pin.y, rot, mirror)
            point = (round(x + dx, 4), round(y + dy, 4))
            net = pin_net.get((ref, pin.number))
            if net:
                pin_nets[pin.number] = net
            pin_points.append((point, net))
        components.append(
            SceneComponent(
                ref=ref,
                kind=spec.kind if spec else "",
                value=value,
                purpose=spec.purpose if spec else "",
                lib_id=lib_id,
                x=x,
                y=y,
                rot=rot,
                mirror=mirror,
                pin_nets=pin_nets,
                ref_text=_text(props["Reference"], rot) if "Reference" in props else None,
                value_text=_text(props["Value"], rot) if "Value" in props else None,
            )
        )

    raw_wires: list[tuple[Point, Point]] = []
    for wire in sexpr.children(tree, "wire"):
        pts = [(_f(p, 1), _f(p, 2)) for p in sexpr.children(sexpr.child(wire, "pts") or [], "xy")]
        raw_wires += [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    junction_points = [(_f(sexpr.child(j, "at"), 1), _f(sexpr.child(j, "at"), 2)) for j in sexpr.children(tree, "junction")]
    raw_labels = [(str(lb[1]), _f(sexpr.child(lb, "at"), 1), _f(sexpr.child(lb, "at"), 2), int(_f(sexpr.child(lb, "at"), 3)))
                  for kind in ("label", "global_label") for lb in sexpr.children(tree, kind)]
    no_connects = [(_f(sexpr.child(n, "at"), 1), _f(sexpr.child(n, "at"), 2)) for n in sexpr.children(tree, "no_connect")]

    # Drop the wire stubs that only lead to a PWR_FLAG: a wire whose end sits on a flag and touches nothing else.
    anchors = {_key(p) for p, _ in pin_points} | {_key((p.x, p.y)) for p in ports} | {_key((lb[1], lb[2])) for lb in raw_labels}
    wires = list(raw_wires)
    while True:
        ends: dict[tuple[int, int], int] = {}
        for a, b in wires:
            for p in (a, b):
                ends[_key(p)] = ends.get(_key(p), 0) + 1
        dangling = [
            w for w in wires
            if any(_key(p) in flag_points and ends[_key(p)] == 1 and _key(p) not in anchors for p in w)
        ]
        if not dangling:
            break
        wires = [w for w in wires if w not in dangling]

    # Connectivity: wire ends, anything on a wire, labels by name, power symbols by name.
    union = _Union()
    for a, b in wires:
        union.join(_key(a), _key(b))
    points = [p for p, _ in pin_points] + [(pt.x, pt.y) for pt in ports] + [(lb[1], lb[2]) for lb in raw_labels] + junction_points + [p for w in wires for p in w]
    for a, b in wires:
        for p in points:
            if _on_segment(p, a, b):
                union.join(_key(p), _key(a))
    by_name: dict[str, tuple[int, int]] = {}
    for name, lx, ly, _ in raw_labels:
        k = _key((lx, ly))
        union.join(k, by_name.setdefault(name, k))
    for port in ports:
        k = _key((port.x, port.y))
        union.join(k, by_name.setdefault(port.net, k))

    root_net: dict[tuple[int, int], str] = {}
    for point, net in pin_points:
        if net:
            root_net.setdefault(union.find(_key(point)), net)
    for name, k in by_name.items():
        root_net.setdefault(union.find(k), name)

    def net_at(p: Point) -> str:
        return root_net.get(union.find(_key(p)), "")

    scene_wires = [SceneWire(net=net_at(a), a=a, b=b) for a, b in wires]
    labels = [SceneLabel(net=name, x=lx, y=ly, angle=angle) for name, lx, ly, angle in raw_labels]
    junctions = [SceneJunction(net=net_at(p), x=p[0], y=p[1]) for p in junction_points]

    xs: list[float] = []
    ys: list[float] = []
    for comp in components:
        lib = library[comp.lib_id]
        for g in lib.graphics:
            pts = g.pts if g.type != "circle" else [(g.pts[0][0] - g.r, g.pts[0][1] - g.r), (g.pts[0][0] + g.r, g.pts[0][1] + g.r)]
            for px, py in pts:
                dx, dy = to_screen(px, py, comp.rot, comp.mirror)
                xs.append(comp.x + dx)
                ys.append(comp.y + dy)
        for pin in lib.pins:
            dx, dy = to_screen(pin.x, pin.y, comp.rot, comp.mirror)
            xs.append(comp.x + dx)
            ys.append(comp.y + dy)
    for w in scene_wires:
        xs += [w.a[0], w.b[0]]
        ys += [w.a[1], w.b[1]]
    for port in ports:
        xs += [port.x - 2.54, port.x + 2.54]
        ys += [port.y - 5.08, port.y + 5.08]
    margin = 5.08
    bbox = (min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin) if xs else (0.0, 0.0, 100.0, 100.0)

    used = {c.lib_id for c in components} | {p.lib_id for p in ports}
    return Scene(
        bbox=tuple(round(v, 3) for v in bbox),  # type: ignore[arg-type]
        library={k: v for k, v in library.items() if k in used},
        components=components,
        ports=ports,
        wires=scene_wires,
        labels=labels,
        junctions=junctions,
        no_connects=no_connects,
    )



def library_symbols() -> dict[str, LibSymbol]:
    """Every symbol a circuit can use (components and power symbols), for the playground's parts box."""
    from app.core.component_registry import COMPONENT_KINDS, POWER_SYMBOLS
    from app.core.symbol_library import get_library

    lib = get_library()
    ids = sorted({k.lib_id for k in COMPONENT_KINDS.values()} | set(POWER_SYMBOLS.values()))
    return {i: _lib_symbol(lib[i].tree) for i in ids}
