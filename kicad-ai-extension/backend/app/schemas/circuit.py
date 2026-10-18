"""Schemas for circuit generation.

`CircuitSpec` is the contract between interpretation (rules or an LLM) and
the deterministic validator/renderer: components from the registry, and nets
that list which component pins they connect.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.system import SystemPlan

from app.schemas.lesson import Lesson

MAX_PROMPT_LENGTH = 4000

Prompt = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_PROMPT_LENGTH)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Reference = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Z]{1,3}[0-9]{1,3}$")]
NetName = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9_+\-.~/]{1,32}$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- Requests ------------------------------------------------------------------------


class GenerationContext(_Strict):
    """Optional information about the user's KiCad session, sent by the plugin."""

    kicad_version: ShortText | None = None
    project_name: ShortText | None = None


class GenerateRequest(_Strict):
    prompt: Prompt
    plan: SystemPlan | None = Field(
        default=None, description="A plan from /translate (possibly edited). When given it is built instead of re-reading the prompt."
    )
    context: GenerationContext | None = None


# --- Circuit specification ---------------------------------------------------------------


class ComponentSpec(_Strict):
    ref: Reference = Field(description="Reference designator, e.g. R1, D1, U1")
    kind: Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,40}$")] = Field(
        description="Component kind from the component registry"
    )
    value: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    purpose: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""


class PinRef(_Strict):
    ref: Reference
    pin: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)] = Field(
        description="Pin number or name/alias, e.g. '1', 'A', 'anode', 'VCC'"
    )


class NetSpec(_Strict):
    name: NetName
    connections: list[PinRef] = Field(min_length=1, max_length=150)


class Placement(_Strict):
    """Where a component goes, in routing-grid cells (1 cell = 2.54 mm; rows grow downward).

    `pin` is the anchor pin (by number): it lands exactly on cell (col, row). For 2-pin parts,
    `direction` says where the other pin lies relative to the anchor ("down" = vertical with
    the anchor pin on top), and the rotation is chosen automatically. Otherwise use `rot`.
    """

    pin: Annotated[str, StringConstraints(min_length=1, max_length=20)]
    col: int = Field(ge=-200, le=400)
    row: int = Field(ge=-200, le=400)
    direction: Literal["up", "down", "left", "right"] | None = None
    rot: Literal[0, 90, 180, 270] = 0
    mirror: bool = False


class Caption(_Strict):
    """A short text drawn on the sheet (e.g. a block title), top-left at a grid cell."""

    col: int = Field(ge=-200, le=400)
    row: int = Field(ge=-200, le=400)
    text: Annotated[str, StringConstraints(min_length=1, max_length=120)]


class Layout(_Strict):
    """Optional drawing hints. Without them the renderer uses an automatic grid."""

    placements: dict[Reference, Placement] = Field(default_factory=dict)
    buses: dict[NetName, int] = Field(
        default_factory=dict, description="Nets drawn as one straight horizontal wire at this row"
    )
    remote_nets: list[NetName] = Field(
        default_factory=list,
        description=(
            "Nets drawn by name instead of by wire: every pin gets a net label (or a power symbol for "
            "rails such as GND and +5V). Only the `hub` component's pins on such a net stay wired together."
        ),
    )
    hub: Reference | None = Field(
        default=None, description="Component (e.g. the microcontroller) whose pins on remote nets stay wired"
    )
    wired_groups: dict[NetName, list[Reference]] = Field(
        default_factory=dict,
        description=(
            "For a remote net: the components whose pins on it are wired together (instead of the hub's), "
            "with one label for the group. E.g. the LEDs on one row of a matrix."
        ),
    )
    crossing_nets: list[NetName] = Field(
        default_factory=list,
        description="Nets whose wires may cross each other (straight through, never joining), like a matrix's rows and columns",
    )
    captions: list[Caption] = Field(default_factory=list, max_length=60)


class CircuitSpec(_Strict):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] = ""
    components: list[ComponentSpec] = Field(min_length=1, max_length=150)
    nets: list[NetSpec] = Field(min_length=1, max_length=250)
    notes: list[Annotated[str, StringConstraints(max_length=300)]] = Field(default_factory=list, max_length=30)
    layout: Layout | None = None


# --- Responses -----------------------------------------------------------------------


class Issue(BaseModel):
    code: str
    message: str
    ref: str | None = None
    net: str | None = None


class ValidationReport(BaseModel):
    valid: bool
    errors: list[Issue] = []
    warnings: list[Issue] = []


class ErcViolation(BaseModel):
    severity: str
    type: str
    description: str
    items: list[str] = []


class ErcReport(BaseModel):
    ran: bool
    passed: bool | None = None  # None when ERC could not run
    error_count: int = 0
    warning_count: int = 0
    violations: list[ErcViolation] = []
    message: str = ""


class SchematicFiles(BaseModel):
    """Files for a standalone KiCad project. The plugin decides where to write them."""

    name: str = Field(description="Safe base name (no extension, no path separators)")
    schematic: str = Field(description="Contents of <name>.kicad_sch")
    project: str = Field(description="Contents of <name>.kicad_pro")


class Firmware(BaseModel):
    """Program for a microcontroller in the circuit. Pins match the schematic."""

    language: Literal["cpp"] = "cpp"
    framework: Literal["arduino"] = "arduino"
    board: str
    file_name: Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,48}\.ino$")]
    code: Annotated[str, StringConstraints(max_length=200_000)]
    summary: list[str] = []


class SaveRequest(GenerateRequest):
    """Generate, then save the result as a new KiCad project on this computer."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [{"prompt": "3.3V LDO from 5V with power LED", "open_in_kicad": True}]
        },
    )

    open_in_kicad: bool = Field(default=True, description="Open the saved schematic in KiCad's Schematic Editor")


class SaveResponse(BaseModel):
    request_id: str
    message: str
    title: str
    components: list[str]
    notes: list[str] = []
    erc: ErcReport
    folder: str = Field(description="Folder containing the new project")
    schematic_path: str = Field(description="Full path of the .kicad_sch file")
    project_path: str
    opened_in_kicad: bool
    open_error: str | None = None
    firmware_path: str | None = Field(default=None, description="The Arduino sketch, when the circuit has a microcontroller")


class GenerateResponse(BaseModel):
    request_id: str
    status: Literal["generated"]
    message: str
    prompt: str
    generator: Literal["rules", "llm", "plan"]
    circuit: CircuitSpec
    validation: ValidationReport
    erc: ErcReport
    files: SchematicFiles
    firmware: Firmware | None = None
    lesson: Lesson | None = Field(default=None, description="Classroom lesson about this exact circuit")
