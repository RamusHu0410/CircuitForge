"""Prompt -> circuit spec -> validation -> KiCad schematic -> ERC (and saving / opening it)."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from app.ai.circuit_generator import GenerationError
from app.ai.generator import Generator
from app.config import Settings
from app.core.circuit_validator import ResolvedCircuit, validate_circuit
from app.core.erc import find_kicad_cli, run_erc
from app.core.launcher import open_in_schematic_editor
from app.core.output_writer import OutputError, WrittenFiles, resolve_output_dir, write_project
from app.core.schematic_renderer import render_schematic
from app.schemas.circuit import (
    CircuitSpec,
    ErcReport,
    GenerateRequest,
    GenerateResponse,
    SaveRequest,
    SaveResponse,
    SchematicFiles,
)

logger = logging.getLogger(__name__)


class SaveError(RuntimeError):
    """The schematic was generated but could not be written to disk. Message is user-facing."""


@dataclass
class Built:
    """A validated, rendered, ERC-checked schematic."""

    spec: CircuitSpec
    resolved: ResolvedCircuit
    files: SchematicFiles
    erc: ErcReport


class GenerationService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.generator = Generator.from_settings(settings)

    # --- Building ---------------------------------------------------------------------------

    def kicad_cli(self) -> str | None:
        return find_kicad_cli(self.settings.kicad_cli_path)

    def build(self, spec: CircuitSpec, prompt: str = "") -> Built:
        """Validate `spec`, render it as a KiCad schematic, and run ERC. Raises GenerationError if invalid."""
        resolved = validate_circuit(spec)
        if not resolved.report.valid:
            # Our own generators should never produce an invalid circuit; treat it as a bug.
            logger.error("circuit failed validation: %s", resolved.report.errors)
            raise GenerationError(
                "The generated circuit did not pass validation: "
                + "; ".join(issue.message for issue in resolved.report.errors)
            )
        files = render_schematic(resolved, prompt=prompt)
        if self.settings.erc_enabled:
            erc = run_erc(files, self.kicad_cli(), self.settings.erc_timeout_s)
        else:
            erc = ErcReport(ran=False, message="ERC is disabled (ERC_ENABLED=false).")
        return Built(spec=spec, resolved=resolved, files=files, erc=erc)

    # --- Saving -----------------------------------------------------------------------------

    def save(self, built: Built, open_in_kicad: bool) -> tuple[WrittenFiles, bool, str | None]:
        """Write a new project folder (never overwriting) and optionally open it in KiCad."""
        try:
            written = write_project(resolve_output_dir(self.settings.output_dir), built.files)
        except OutputError as exc:
            raise SaveError(str(exc)) from exc
        opened, open_error = False, None
        if open_in_kicad:
            open_error = open_in_schematic_editor(written.schematic, self.kicad_cli())
            opened = open_error is None
        return written, opened, open_error

    # --- Prompt API -------------------------------------------------------------------------

    def generate(self, request: GenerateRequest) -> GenerateResponse:
        request_id = uuid.uuid4().hex
        generated = self.generator.generate(request.prompt)  # raises GenerationError for unsupported prompts
        spec = generated.spec
        built = self.build(spec, request.prompt)

        logger.info(
            "generate %s: '%s' with %d components; ERC: %s",
            request_id, spec.title, len(spec.components), built.erc.message,
        )
        refs = ", ".join(f"{c.ref} {c.value}" for c in spec.components)
        return GenerateResponse(
            request_id=request_id,
            status="generated",
            message=f"Generated '{spec.title}' with {len(spec.components)} components ({refs}). {built.erc.message}",
            prompt=request.prompt,
            generator=generated.source,
            circuit=spec,
            validation=built.resolved.report,
            erc=built.erc,
            files=built.files,
        )

    def generate_and_save(self, request: SaveRequest) -> SaveResponse:
        result = self.generate(request)
        built = Built(
            spec=result.circuit,
            resolved=validate_circuit(result.circuit),
            files=result.files,
            erc=result.erc,
        )
        written, opened, open_error = self.save(built, request.open_in_kicad)

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



__all__ = ["Built", "GenerationError", "GenerationService", "SaveError"]
