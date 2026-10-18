import pytest

from app.core.geometry import G, Grid, LayoutError, outward, place_by_anchor, rotate, to_screen
from app.core.symbol_library import get_library

LIB = get_library()


def pin_cell(placed, number: str, grid: Grid):
    return grid.cell(*placed.pin_point(placed.symbol.pin(number)))


def test_rotation_table() -> None:
    assert rotate(1, 0, 90) == (0, 1)
    assert rotate(1, 0, 180) == (-1, 0)
    assert rotate(1, 0, 270) == (0, -1)
    # Library Y is up, screen Y is down.
    assert to_screen(0, 3.81, 0, False) == (0, -3.81)
    assert to_screen(3.81, 0, 0, True) == (-3.81, 0)


@pytest.mark.parametrize(
    ("lib_id", "pin", "direction", "other_offset"),
    [
        ("Device:R", "1", "down", (0, 3)),
        ("Device:R", "1", "right", (3, 0)),
        ("Device:LED", "2", "down", (0, 3)),  # anode on top
        ("Device:LED", "1", "up", (0, -3)),
        ("Device:Battery", "1", "down", (0, 4)),  # + on top
        ("Switch:SW_Push", "1", "down", (0, 4)),
    ],
)
def test_two_pin_direction_hint(lib_id: str, pin: str, direction: str, other_offset: tuple[int, int]) -> None:
    grid = Grid()
    symbol = LIB[lib_id]
    placed = place_by_anchor("X1", symbol, pin, grid.point((5, 7)), direction=direction)
    other = next(p.number for p in symbol.pins if p.number != pin)

    assert pin_cell(placed, pin, grid) == (5, 7)
    assert pin_cell(placed, other, grid) == (5 + other_offset[0], 7 + other_offset[1])


def test_direction_hint_rejected_for_multi_pin_parts() -> None:
    with pytest.raises(LayoutError):
        place_by_anchor("U1", LIB["Timer:NE555P"], "1", (0, 0), direction="down")


def test_mirrored_connector_faces_right() -> None:
    grid = Grid()
    symbol = LIB["Connector_Generic:Conn_01x02"]
    normal = place_by_anchor("J1", symbol, "1", grid.point((10, 4)))
    mirrored = place_by_anchor("J1", symbol, "1", grid.point((10, 4)), mirror=True)

    assert outward(symbol.pin("1"), 0, False) == (-1, 0)
    assert outward(symbol.pin("1"), 0, True) == (1, 0)
    assert pin_cell(normal, "2", grid) == pin_cell(mirrored, "2", grid) == (10, 5)
    assert mirrored.extent()[2] < normal.extent()[2]  # the body sits on the other side


@pytest.mark.parametrize("rot", [0, 90, 180, 270])
def test_outward_is_opposite_of_pin_direction_into_body(rot: int) -> None:
    pin = LIB["Device:R"].pin("1")
    dx, dy = outward(pin, rot, False)
    px, py = to_screen(pin.x, pin.y, rot, False)
    # Stepping outward moves away from the symbol centre.
    assert (px + dx) ** 2 + (py + dy) ** 2 > px**2 + py**2


OFF_GRID_PARTS = {"Device:R_Potentiometer"}  # pins at mixed 1.27 mm offsets; wired with labels instead


def test_pins_land_on_the_grid() -> None:
    grid = Grid()
    for lib_id, symbol in LIB.items():
        if symbol.is_power:
            continue
        placed = place_by_anchor("X1", symbol, symbol.pins[0].number, grid.point((3, 3)))
        on_grid = all(grid.cell(*placed.pin_point(p)) is not None for p in symbol.pins)
        assert on_grid == (lib_id not in OFF_GRID_PARTS), lib_id


def test_grid_cell_round_trip_and_off_grid() -> None:
    grid = Grid()
    assert grid.cell(*grid.point((7, -2))) == (7, -2)
    assert grid.cell(grid.x0 + G / 2, grid.y0) is None


def test_extent_covers_body_and_pins() -> None:
    placed = place_by_anchor("R1", LIB["Device:R"], "1", Grid().point((0, 0)), direction="down")
    x0, y0, x1, y1 = placed.extent()
    assert y1 - y0 == pytest.approx(7.62)  # pin end to pin end
    assert x1 - x0 < 3  # narrow body
