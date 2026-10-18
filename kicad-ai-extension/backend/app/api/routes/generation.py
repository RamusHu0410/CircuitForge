"""Circuit generation endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.ai.circuit_generator import SUPPORTED_CIRCUITS
from app.config import Settings, get_settings
from app.core.component_registry import COMPONENT_KINDS
from app.schemas.circuit import GenerateRequest, GenerateResponse, SaveRequest, SaveResponse
from app.services.generation_service import GenerationError, GenerationService, SaveError

router = APIRouter(tags=["generation"])


def get_service(settings: Annotated[Settings, Depends(get_settings)]) -> GenerationService:
    return GenerationService(settings)


@router.post(
    "/generate",
    response_model=GenerateResponse,
    summary="Generate a KiCad schematic from a prompt",
    responses={422: {"description": "Malformed request, or a prompt the generator cannot handle"}},
)
def generate(
    request: GenerateRequest, service: Annotated[GenerationService, Depends(get_service)]
) -> GenerateResponse:
    try:
        return service.generate(request)
    except GenerationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@router.post(
    "/generate/save",
    response_model=SaveResponse,
    summary="Generate, save as a new KiCad project, and open it in KiCad",
    description=(
        "Convenience for testing without the plugin. Saves a **new** project folder under the backend's "
        "output directory (default `~/Documents/KiCad/ai_generated`, or `OUTPUT_DIR`); existing folders are "
        "never overwritten. With `open_in_kicad` true, the schematic also opens in KiCad's Schematic Editor "
        "on the machine running this backend."
    ),
    responses={
        422: {"description": "Malformed request, or a prompt the generator cannot handle"},
        500: {"description": "The schematic could not be written to disk"},
    },
)
def generate_and_save(
    request: SaveRequest, service: Annotated[GenerationService, Depends(get_service)]
) -> SaveResponse:
    try:
        return service.generate_and_save(request)
    except GenerationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except SaveError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


class CapabilitiesResponse(BaseModel):
    circuits: list[str]
    component_kinds: dict[str, str]


@router.get("/capabilities", response_model=CapabilitiesResponse, summary="What the generator can build")
def capabilities() -> CapabilitiesResponse:
    return CapabilitiesResponse(
        circuits=SUPPORTED_CIRCUITS,
        component_kinds={kind: info.description for kind, info in COMPONENT_KINDS.items()},
    )
