"""Prompt -> circuit spec -> validation -> KiCad schematic -> ERC."""

from __future__ import annotations

import logging
import uuid

from app.ai.circuit_generator import GenerationError, RuleBasedGenerator
from app.config import Settings
from app.core.circuit_validator import validate_circuit
from app.core.erc import find_kicad_cli, run_erc
from app.core.launcher import open_in_schematic_editor
from app.core.output_writer import OutputError, resolve_output_dir, write_project
from app.core.schematic_renderer import render_schematic
from app.schemas.circuit import ErcReport, GenerateRequest, GenerateResponse, SaveRequest, SaveResponse

logger = logging.getLogger(__name__)


class SaveError(RuntimeError):
    """The schematic was generated but could not be written to disk. Message is user-facing."""


class GenerationService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.generator = RuleBasedGenerator()

    def generate(self, request: GenerateRequest) -> GenerateResponse:
        request_id = uuid.uuid4().hex
        spec = self.generator.generate(request.prompt)  # raises GenerationError for unsupported prompts

        resolved = validate_circuit(spec)
        if not resolved.report.valid:
            # The rule-based generator should never produce an invalid circuit; treat it as a bug.
            logger.error("generated circuit failed validation: %s", resolved.report.errors)
            raise GenerationError(
                "The generated circuit did not pass validation: "
                + "; ".join(issue.message for issue in resolved.report.errors)
            )

        files = render_schematic(resolved, prompt=request.prompt)

        if self.settings.erc_enabled:
            erc = run_erc(files, find_kicad_cli(self.settings.kicad_cli_path), self.settings.erc_timeout_s)
        else:
            erc = ErcReport(ran=False, message="ERC is disabled (ERC_ENABLED=false).")

        logger.info(
            "generate %s: '%s' with %d components; ERC: %s",
            request_id, spec.title, len(spec.components), erc.message,
        )
        refs = ", ".join(f"{c.ref} {c.value}" for c in spec.components)
        return GenerateResponse(
            request_id=request_id,
            status="generated",
            message=f"Generated '{spec.title}' with {len(spec.components)} components ({refs}). {erc.message}",
            prompt=request.prompt,
            generator="rules",
            circuit=spec,
            validation=resolved.report,
            erc=erc,
            files=files,
        )

    def generate_and_save(self, request: SaveRequest) -> SaveResponse:
        """Generate, write a new project folder (never overwriting), and optionally open it in KiCad."""
        result = self.generate(request)
        try:
            written = write_project(resolve_output_dir(self.settings.output_dir), result.files)
        except OutputError as exc:
            raise SaveError(str(exc)) from exc

        opened, open_error = False, None
        if request.open_in_kicad:
            open_error = open_in_schematic_editor(written.schematic, find_kicad_cli(self.settings.kicad_cli_path))
            opened = open_error is None

        logger.info("saved %s -> %s (opened=%s)", result.circuit.title, written.schematic, opened)
        return SaveResponse(
            request_id=result.request_id,
            message=f"Saved to {written.schematic}. {result.erc.message}" + (" Opened in KiCad." if opened else ""),
            title=result.circuit.title,
            components=[f"{c.ref} {c.value}" + (f" ({c.purpose})" if c.purpose else "") for c in result.circuit.components],
            notes=result.circuit.notes,
            erc=result.erc,
            folder=str(written.folder),
            schematic_path=str(written.schematic),
            project_path=str(written.project),
            opened_in_kicad=opened,
            open_error=open_error,
        )


__all__ = ["GenerationError", "GenerationService", "SaveError"]
