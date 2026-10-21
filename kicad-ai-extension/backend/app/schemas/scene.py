"""The generated schematic as drawing data: what the Classroom's interactive 2D and 3D views show.

Read back from the generated .kicad_sch itself (app/core/scene.py), so the views match KiCad's
drawing exactly. Library graphics stay in library coordinates (+Y up, like KiCad); a symbol is
placed with `at`/`rot`/`mirror`, transformed the same way as app/core/geometry.py `to_screen`.
Everything else is in schematic millimetres (+Y down). Every wire, junction, label and pin carries
the name of the net it belongs to, so the window can explain and simulate any part of the drawing.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

Point = tuple[float, float]


class Graphic(BaseModel):
    """polyline: pts. rect: two corners. circle: center + r. arc: start, mid, end."""

    type: Literal["polyline", "rect", "circle", "arc"]
    pts: list[Point]
    r: float = 0.0
    fill: Literal["none", "outline", "background"] = "none"
    width: float = 0.0


class LibPin(BaseModel):
    number: str
    name: str
    type: str  # KiCad electrical type: passive, input, power_in, ...
    x: float  # connection point (library coordinates)
    y: float
    angle: int  # direction from the connection point toward the body
    length: float
    hidden: bool = False


class LibSymbol(BaseModel):
    lib_id: str
    graphics: list[Graphic]
    pins: list[LibPin]
    show_pin_numbers: bool
    show_pin_names: bool
    pin_name_offset: float
    power: bool = False


class SceneText(BaseModel):
    text: str
    x: float
    y: float
    angle: float = 0  # as displayed (degrees, counter-clockwise)
    justify: str = ""  # KiCad justify words, e.g. "left bottom"


class SceneComponent(BaseModel):
    ref: str
    kind: str
    value: str
    purpose: str = ""
    lib_id: str
    x: float
    y: float
    rot: int = 0
    mirror: bool = False
    pin_nets: dict[str, str]  # pin number -> net (unconnected pins are left out)
    ref_text: SceneText | None = None
    value_text: SceneText | None = None


class ScenePort(BaseModel):
    """A power symbol (GND, +5V, ...): connects by name to every other port of the same net."""

    lib_id: str
    net: str
    x: float  # connection point
    y: float
    rot: int = 0
    text: SceneText | None = None


class SceneWire(BaseModel):
    net: str
    a: Point
    b: Point


class SceneLabel(BaseModel):
    net: str
    x: float
    y: float
    angle: int = 0


class SceneJunction(BaseModel):
    net: str
    x: float
    y: float


class Scene(BaseModel):
    bbox: tuple[float, float, float, float]  # x0, y0, x1, y1 (mm)
    library: dict[str, LibSymbol]
    components: list[SceneComponent]
    ports: list[ScenePort]
    wires: list[SceneWire]
    labels: list[SceneLabel]
    junctions: list[SceneJunction]
    no_connects: list[Point] = []
