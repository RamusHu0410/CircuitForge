"""Placing KiCad symbols on a grid: transforms, extents, and pin positions.

Conventions
- Library coordinates have +Y up; schematic (screen) coordinates have +Y down.
- A symbol instance is `(at x y rot)` plus an optional horizontal mirror. `rot` is a
  counter-clockwise rotation in degrees (0/90/180/270).
- Pin library `angle` is the direction from the pin's connection point toward the
  symbol body, so the direction a wire leaves a pin is the opposite.
- Wires live on a routing grid of 2.54 mm cells; (i, j) are column/row indices.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core import sexpr
from app.core.symbol_library import PinInfo, SymbolInfo

G = 2.54
Cell = tuple[int, int]
Direction = tuple[int, int]
ROTATIONS = (0, 90, 180, 270)
_DIR_VECTORS = {"right": (1, 0), "down": (0, 1), "left": (-1, 0), "up": (0, -1)}


class LayoutError(ValueError):
    """A layout hint cannot be applied to the circuit. Message is for developers/logs."""


def rotate(px: float, py: float, rot: int) -> tuple[float, float]:
    return {0: (px, py), 90: (-py, px), 180: (-px, -py), 270: (py, -px)}[rot % 360]


def to_screen(px: float, py: float, rot: int, mirror: bool) -> tuple[float, float]:
    """Library offset from the symbol origin -> screen offset (mm), applying mirror then rotation."""
    if mirror:
        px = -px
    rx, ry = rotate(px, py, rot)
    return rx, -ry


def outward(pin: PinInfo, rot: int, mirror: bool) -> Direction:
    """Unit step (di, dj) a wire takes when leaving this pin."""
    vx, vy = {0: (1, 0), 90: (0, 1), 180: (-1, 0), 270: (0, -1)}[pin.angle % 360]
    sx, sy = to_screen(-vx, -vy, rot, mirror)
    return int(round(sx)), int(round(sy))


@dataclass(frozen=True)
class Grid:
    x0: float = 30.48  # 12 cells
    y0: float = 38.1  # 15 cells

    def point(self, cell: Cell) -> tuple[float, float]:
        return round(self.x0 + cell[0] * G, 4), round(self.y0 + cell[1] * G, 4)

    def cell(self, x: float, y: float) -> Cell | None:
        """The cell at (x, y) mm, or None if the point is not on the routing grid."""
        fi, fj = (x - self.x0) / G, (y - self.y0) / G
        i, j = round(fi), round(fj)
        if abs(fi - i) > 0.02 or abs(fj - j) > 0.02:
            return None
        return int(i), int(j)


# --- Symbol extents ---------------------------------------------------------------------


def _xy_points(node: list) -> list[tuple[float, float]]:
    return [(sexpr.to_float(p[1]), sexpr.to_float(p[2])) for p in sexpr.children(node, "xy")]


def symbol_extent(symbol: SymbolInfo) -> tuple[float, float, float, float]:
    """Bounding box (xmin, ymin, xmax, ymax) in library coordinates: body graphics plus pin lines."""
    points: list[tuple[float, float]] = []
    for unit in sexpr.children(symbol.tree, "symbol"):
        for item in unit:
            kind = sexpr.head(item)
            if kind == "rectangle":
                for key in ("start", "end"):
                    node = sexpr.child(item, key)
                    points.append((sexpr.to_float(node[1]), sexpr.to_float(node[2])))
            elif kind in ("polyline", "bezier"):
                pts = sexpr.child(item, "pts")
                points += _xy_points(pts) if pts else []
            elif kind == "circle":
                center, radius = sexpr.child(item, "center"), sexpr.to_float(sexpr.child(item, "radius")[1])
                cx, cy = sexpr.to_float(center[1]), sexpr.to_float(center[2])
                points += [(cx - radius, cy - radius), (cx + radius, cy + radius)]
            elif kind == "arc":
                for key in ("start", "mid", "end"):
                    node = sexpr.child(item, key)
                    points.append((sexpr.to_float(node[1]), sexpr.to_float(node[2])))
            elif kind == "pin":
                at, length = sexpr.child(item, "at"), sexpr.child(item, "length")
                px, py, angle = sexpr.to_float(at[1]), sexpr.to_float(at[2]), int(sexpr.to_float(at[3]))
                ln = sexpr.to_float(length[1])
                vx, vy = {0: (1, 0), 90: (0, 1), 180: (-1, 0), 270: (0, -1)}[angle % 360]
                points += [(px, py), (px + vx * ln, py + vy * ln)]
    if not points:
        return (0.0, 0.0, 0.0, 0.0)
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


# --- Placed symbols ----------------------------------------------------------------------


@dataclass(frozen=True)
class PlacedSymbol:
    ref: str
    symbol: SymbolInfo
    x: float
    y: float
    rot: int = 0
    mirror: bool = False

    def pin_point(self, pin: PinInfo) -> tuple[float, float]:
        dx, dy = to_screen(pin.x, pin.y, self.rot, self.mirror)
        return round(self.x + dx, 4), round(self.y + dy, 4)

    def extent(self) -> tuple[float, float, float, float]:
        """Bounding box on the screen (xmin, ymin, xmax, ymax) in mm."""
        x0, y0, x1, y1 = symbol_extent(self.symbol)
        corners = [to_screen(x, y, self.rot, self.mirror) for x in (x0, x1) for y in (y0, y1)]
        xs, ys = [c[0] for c in corners], [c[1] for c in corners]
        return self.x + min(xs), self.y + min(ys), self.x + max(xs), self.y + max(ys)


def place_by_anchor(
    ref: str,
    symbol: SymbolInfo,
    anchor_pin: str,
    anchor_point: tuple[float, float],
    rot: int = 0,
    mirror: bool = False,
    direction: str | None = None,
) -> PlacedSymbol:
    """Place a symbol so that `anchor_pin` lands exactly on `anchor_point`.

    For 2-pin symbols, `direction` ('up'/'down'/'left'/'right') is where the *other* pin
    lies relative to the anchor pin; the matching rotation is chosen automatically.
    """
    anchor = symbol.pin(anchor_pin)
    if direction is not None:
        if len(symbol.pins) != 2:
            raise LayoutError(f"{ref}: 'direction' only works for 2-pin symbols")
        other = next(p for p in symbol.pins if p.number != anchor_pin)
        want = _DIR_VECTORS[direction]
        for candidate in ROTATIONS:
            ax, ay = to_screen(anchor.x, anchor.y, candidate, mirror)
            bx, by = to_screen(other.x, other.y, candidate, mirror)
            vx, vy = bx - ax, by - ay
            length = max(abs(vx), abs(vy))
            if length > 0 and abs(vx / length - want[0]) < 1e-6 and abs(vy / length - want[1]) < 1e-6:
                rot = candidate
                break
        else:
            raise LayoutError(f"{ref}: no rotation puts pin {other.number} {direction} of pin {anchor_pin}")
    ox, oy = to_screen(anchor.x, anchor.y, rot, mirror)
    return PlacedSymbol(ref, symbol, round(anchor_point[0] - ox, 4), round(anchor_point[1] - oy, 4), rot, mirror)
