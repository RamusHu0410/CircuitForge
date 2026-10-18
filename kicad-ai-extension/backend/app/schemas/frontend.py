"""Wire format for the CircuitForge web UI (`frontend/types.ts`).

Field names are camelCase on the wire and snake_case in Python. These models mirror the
TypeScript interfaces exactly: `Project`, `Step`, `Part`, `Check`, `Net`, and `DesignParams`.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

from app.engine.design import DesignParams

StepStatus = Literal["done", "warning", "failed", "pending"]
CheckStatus = Literal["pass", "warn", "fail"]
LessonId = Literal["parse", "power", "led", "pulldown", "debounce", "nets", "verify"]


class Wire(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class PartOut(Wire):
    ref: str
    name: str
    value: str


class StepOut(Wire):
    id: str
    title: str
    call: str
    lines: list[str]
    status: StepStatus
    parts: list[PartOut]
    tags: list[str] | None = None
    lesson: LessonId | None = None


class CheckOut(Wire):
    id: str
    label: str
    status: CheckStatus
    step_id: str


class NetOut(Wire):
    name: str
    pins: list[str]


class ProjectOut(Wire):
    name: str
    request: str
    params: DesignParams
    steps: list[StepOut]
    checks: list[CheckOut]
    nets: list[NetOut]
    summary: str | None = None  # what changed, for the chat transcript


# --- Requests --------------------------------------------------------------------------------


class ProjectIn(BaseModel):
    """The part of the current project the engine needs back. Anything else the UI sends is ignored."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    request: Annotated[str, StringConstraints(max_length=2000)] = ""
    params: DesignParams


class PlanRequest(Wire):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    prompt: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    project: ProjectIn | None = None


class DesignRequest(Wire):
    """A design to preview or send to KiCad. The backend rebuilds the schematic from the numbers."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    params: DesignParams
    open_in_kicad: bool = True


class SendResponse(Wire):
    folder: str
    schematic_path: str
    project_path: str
    opened_in_kicad: bool
    open_error: str | None = None
    erc_message: str
    message: str


class KiCadStatusOut(Wire):
    status: Literal["connected", "disconnected"]
    version: str | None = None
    detail: str
    output_dir: str
    plugin_running: bool = Field(default=False, description="KiCad's IPC API socket is present")
