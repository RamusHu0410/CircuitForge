"""The "AI Schematic Generator" action: prompt -> backend -> files on disk.

Kept free of UI code so it can be tested without a display. `submit` never
raises; every outcome, including unexpected errors, becomes an `Outcome`
the dialog can show.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from backend_client import BackendClient, BackendError, BackendUnavailableError
from kicad_client.connection import KiCadContext
from output_writer import OutputError, default_base_dir, write_generated_project

# Must match MAX_PROMPT_LENGTH in backend/app/schemas/circuit.py.
MAX_PROMPT_LENGTH = 4000

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Outcome:
    ok: bool
    title: str
    message: str
    schematic_path: Path | None = None


def validate_prompt(prompt: str) -> str | None:
    """Return a user-facing error, or None if the prompt can be sent."""
    text = prompt.strip()
    if not text:
        return "Describe the circuit you want to generate."
    if len(text) > MAX_PROMPT_LENGTH:
        return f"The description is too long ({len(text)} characters; maximum is {MAX_PROMPT_LENGTH})."
    return None


class GenerateSchematicAction:
    def __init__(self, client: BackendClient, kicad: KiCadContext, output_dir: Path | None = None) -> None:
        self.client = client
        self.kicad = kicad
        self.output_dir = output_dir or default_base_dir(kicad.project_dir)

    def submit(self, prompt: str) -> Outcome:
        error = validate_prompt(prompt)
        if error:
            return Outcome(ok=False, title="Check your description", message=error)

        try:
            self.client.health()
            result = self.client.generate(prompt.strip(), self.kicad.as_request_context() or None)
            if result.status != "generated" or not result.schematic:
                return Outcome(ok=False, title="Nothing generated", message=result.message)
            written = write_generated_project(self.output_dir, result.file_name, result.schematic, result.project)
        except BackendUnavailableError as exc:
            return Outcome(ok=False, title="Backend not available", message=str(exc))
        except BackendError as exc:
            title = "Can't generate that yet" if getattr(exc, "status", None) == 422 else "Backend error"
            return Outcome(ok=False, title=title, message=str(exc))
        except OutputError as exc:
            return Outcome(ok=False, title="Could not save", message=str(exc))
        except Exception:  # last-resort guard: never let the plugin crash
            logger.exception("unexpected error during generation")
            return Outcome(
                ok=False,
                title="Unexpected error",
                message="Something went wrong while generating. See the plugin log for details.",
            )

        logger.info("generated %s -> %s", result.title, written.schematic)
        lines = [f"Saved to {written.schematic}", ""]
        lines.append("Components: " + ", ".join(result.components))
        if result.erc_ran:
            lines.append(("ERC: passed" if result.erc_passed else "ERC: issues found") + f" ({result.erc_message})")
        else:
            lines.append(f"ERC: not run ({result.erc_message})")
        lines += [f"Note: {note}" for note in result.notes]
        lines += [f"Warning: {warning}" for warning in result.warnings]
        return Outcome(
            ok=True,
            title=f"Generated '{result.title}'",
            message="\n".join(lines),
            schematic_path=written.schematic,
        )
