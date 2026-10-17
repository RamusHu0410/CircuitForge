"""Connection to the running KiCad instance via the official IPC API (kicad-python).

KiCad sets KICAD_API_SOCKET and KICAD_API_TOKEN when it launches the plugin;
`kipy.KiCad()` reads them automatically. For this step the plugin only reads
the KiCad version and the open schematic's project name to send as context.
It does not modify any document.

A failed connection is never fatal: the dialog still opens and the backend can
still be reached. The reason is returned so it can be shown to the user.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class KiCadContext:
    connected: bool
    kicad_version: str | None = None
    project_name: str | None = None
    error: str | None = None

    def as_request_context(self) -> dict[str, str]:
        """Fields for the backend's optional `context` object."""
        context = {}
        if self.kicad_version:
            context["kicad_version"] = self.kicad_version[:200]
        if self.project_name:
            context["project_name"] = self.project_name[:200]
        return context

    def describe(self) -> str:
        if not self.connected:
            return f"Not connected to KiCad ({self.error}). You can still send prompts."
        project = f", project '{self.project_name}'" if self.project_name else ""
        return f"Connected to KiCad {self.kicad_version}{project}."


def get_kicad_context(timeout_ms: int = 2000) -> KiCadContext:
    try:
        from kipy import KiCad
        from kipy.proto.common.types import DocumentType
    except ImportError:
        return KiCadContext(connected=False, error="kicad-python is not installed")

    try:
        kicad = KiCad(timeout_ms=timeout_ms)
        version = kicad.get_version()
    except Exception as exc:  # kipy.errors.ConnectionError, ApiError, protobuf errors
        logger.info("KiCad connection unavailable: %s", exc)
        return KiCadContext(connected=False, error=str(exc) or type(exc).__name__)

    project_name = None
    try:
        documents = kicad.get_open_documents(DocumentType.DOCTYPE_SCHEMATIC)
        if documents:
            project_name = documents[0].project.name or None
    except Exception as exc:  # optional; older KiCad versions may not support this for schematics
        logger.info("could not read open schematic documents: %s", exc)

    return KiCadContext(connected=True, kicad_version=version.full_version or str(version), project_name=project_name)
