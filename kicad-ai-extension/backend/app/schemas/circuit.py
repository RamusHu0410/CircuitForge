"""Request/response schemas for circuit generation."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

MAX_PROMPT_LENGTH = 4000

Prompt = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_PROMPT_LENGTH)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class GenerationContext(BaseModel):
    """Optional information about the user's KiCad session, sent by the plugin."""

    model_config = ConfigDict(extra="forbid")

    kicad_version: ShortText | None = None
    project_name: ShortText | None = None


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: Prompt
    context: GenerationContext | None = None


class GenerateResponse(BaseModel):
    request_id: str
    status: Literal["not_implemented"]
    message: str
    prompt: str
    # Will hold the generated schematic once generation exists; always null for now.
    schematic: None = None
