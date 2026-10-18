"""Endpoints used by the CircuitForge web UI (`frontend/api/client.ts`)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from app.ai.circuit_generator import GenerationError
from app.config import Settings, get_settings
from app.core import kicad_env
from app.core.output_writer import resolve_output_dir
from app.core.svg_export import SvgExportError, export_svg
from app.engine.design import DesignParams, build_circuit
from app.engine.planner import PlanError, plan as make_plan
from app.engine.planner import Plan
from app.engine.project import build_project
from app.schemas.frontend import DesignRequest, KiCadStatusOut, PlanRequest, ProjectOut, SendResponse
from app.services.generation_service import GenerationService, SaveError

router = APIRouter(tags=["web ui"])
logger = logging.getLogger(__name__)

SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_service(settings: SettingsDep) -> GenerationService:
    return GenerationService(settings)


ServiceDep = Annotated[GenerationService, Depends(get_service)]


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message)


@router.post(
    "/plan",
    response_model=ProjectOut,
    response_model_by_alias=True,
    summary="Turn a prompt (or a change request) into the UI's project",
    responses={422: {"description": "The request can't be mapped to a design; the detail says why"}},
)
def plan_project(request: PlanRequest, service: ServiceDep) -> ProjectOut:
    current = request.project.params if request.project else None
    current_request = request.project.request if request.project else ""
    try:
        plan = make_plan(request.prompt, current, current_request)
        built = service.build(build_circuit(plan.params), request.prompt)
    except PlanError as exc:
        raise _unprocessable(str(exc)) from exc
    except GenerationError as exc:
        logger.exception("planned design failed to build")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return build_project(plan, built)


def _plan_for(params: DesignParams) -> Plan:
    return Plan(params=params, request="")


@router.post(
    "/design/svg",
    response_class=Response,
    responses={200: {"content": {"image/svg+xml": {}}}, 503: {"description": "kicad-cli is not available"}},
    summary="Draw the design's schematic with KiCad (SVG)",
)
def design_svg(request: DesignRequest, service: ServiceDep) -> Response:
    cli = service.kicad_cli()
    if cli is None:
        raise HTTPException(status_code=503, detail="KiCad's command-line tools were not found, so the schematic can't be drawn.")
    try:
        built = service.build(build_circuit(request.params), "")
        svg = export_svg(built.files, cli)
    except SvgExportError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except GenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(content=svg, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


@router.post(
    "/design/send",
    response_model=SendResponse,
    response_model_by_alias=True,
    summary="Save the design as a new KiCad project and open it in KiCad",
    description=(
        "Rebuilds the schematic from the design values, writes a **new** project folder (never "
        "overwriting anything) and, with `openInKicad`, opens it in KiCad's Schematic Editor on this computer."
    ),
)
def design_send(request: DesignRequest, service: ServiceDep) -> SendResponse:
    try:
        built = service.build(build_circuit(request.params), "")
        written, opened, open_error = service.save(built, request.open_in_kicad)
    except SaveError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except GenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    message = f"Saved to {written.schematic}." + (" Opened in KiCad." if opened else "")
    return SendResponse(
        folder=str(written.folder),
        schematic_path=str(written.schematic),
        project_path=str(written.project),
        opened_in_kicad=opened,
        open_error=open_error,
        erc_message=built.erc.message,
        message=message,
    )


# --- KiCad -------------------------------------------------------------------------------------


@router.get("/kicad/status", response_model=KiCadStatusOut, response_model_by_alias=True, summary="Is KiCad available?")
def kicad_status(settings: SettingsDep, service: ServiceDep) -> KiCadStatusOut:
    cli = service.kicad_cli()
    output_dir = str(resolve_output_dir(settings.output_dir))
    socket_present = Path("/tmp/kicad/api.sock").exists()
    if cli is None:
        return KiCadStatusOut(
            status="disconnected",
            detail="KiCad's command-line tools were not found. Install KiCad, or set KICAD_CLI_PATH.",
            output_dir=output_dir,
            plugin_running=socket_present,
        )
    version = kicad_env.kicad_version(cli)
    return KiCadStatusOut(
        status="connected",
        version=version,
        detail=f"KiCad {version or ''} found; schematics are checked and opened with it.".replace("  ", " "),
        output_dir=output_dir,
        plugin_running=socket_present,
    )
