"""The "AI Schematic Generator" action: turns a prompt into a backend request.

Kept free of UI code so it can be tested without a display. `submit` never
raises; every outcome, including unexpected errors, becomes an `Outcome`
the dialog can show.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from backend_client import BackendClient, BackendError, BackendUnavailableError
from kicad_client.connection import KiCadContext

# Must match MAX_PROMPT_LENGTH in backend/app/schemas/circuit.py.
MAX_PROMPT_LENGTH = 4000

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Outcome:
    ok: bool
    title: str
    message: str


def validate_prompt(prompt: str) -> str | None:
    """Return a user-facing error, or None if the prompt can be sent."""
    text = prompt.strip()
    if not text:
        return "Describe the circuit you want to generate."
    if len(text) > MAX_PROMPT_LENGTH:
        return f"The description is too long ({len(text)} characters; maximum is {MAX_PROMPT_LENGTH})."
    return None


class GenerateSchematicAction:
    def __init__(self, client: BackendClient, kicad: KiCadContext) -> None:
        self.client = client
        self.kicad = kicad

    def submit(self, prompt: str) -> Outcome:
        error = validate_prompt(prompt)
        if error:
            return Outcome(ok=False, title="Check your description", message=error)

        try:
            self.client.health()
            result = self.client.generate(prompt.strip(), self.kicad.as_request_context() or None)
        except BackendUnavailableError as exc:
            return Outcome(ok=False, title="Backend not available", message=str(exc))
        except BackendError as exc:
            return Outcome(ok=False, title="Backend error", message=str(exc))
        except Exception:  # last-resort guard: never let the plugin crash
            logger.exception("unexpected error while calling the backend")
            return Outcome(
                ok=False,
                title="Unexpected error",
                message="Something went wrong while contacting the backend. See the plugin log for details.",
            )

        if result.status == "not_implemented":
            return Outcome(
                ok=True,
                title="Prompt received",
                message=f"{result.message}\n\nRequest ID: {result.request_id}",
            )
        return Outcome(ok=True, title="Done", message=result.message)
