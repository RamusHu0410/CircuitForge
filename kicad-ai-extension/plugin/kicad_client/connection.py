"""Connection to the running KiCad instance via the official IPC API (kicad-python).

KiCad sets KICAD_API_SOCKET and KICAD_API_TOKEN when it launches the plugin;
`kipy.KiCad()` reads them automatically. The plugin only *reads* from KiCad:
the version, the open project's folder (where generated files are saved),
and the paths of the Schematic Editor (to open the result) and kicad-cli
(for ERC and previews). It never
modifies an open document.

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
    project_dir: str | None = None
    eeschema_path: str | None = None
    kicad_cli_path: str | None = None
    error: str | None = None

    def as_request_context(self) -> dict[str, str]:
        """Fields for the backend's optional `context` object."""
        context = {}
        if self.kicad_version:
            context["kicad_version"] = self.kicad_version[:200]
        if self.project_name:
            context["project_name"] = self.project_name[:200]
        return context

    def as_window_context(self) -> dict[str, str]:
        """Session info for the CircuitForge window (includes the project folder for saving)."""
        context = self.as_request_context()
        if self.project_dir:
            context["project_dir"] = self.project_dir[:1000]
        return context

    def describe(self) -> str:
        if not self.connected:
            return f"Not connected to KiCad ({self.error}). You can still generate schematics."
        project = f", project '{self.project_name}'" if self.project_name else ", no project open"
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

    project_name = project_dir = None
    # KiCad 10 plugins run in the PCB Editor; KiCad 11 adds the Schematic Editor.
    for doc_type in (DocumentType.DOCTYPE_PCB, DocumentType.DOCTYPE_SCHEMATIC):
        try:
            documents = kicad.get_open_documents(doc_type)
        except Exception as exc:  # not every editor answers for every document type
            logger.info("get_open_documents(%s) failed: %s", doc_type, exc)
            continue
        if documents:
            project_name = documents[0].project.name or None
            project_dir = documents[0].project.path or None
            break

    eeschema_path = _binary_path(kicad, "eeschema")
    kicad_cli_path = _binary_path(kicad, "kicad-cli")

    return KiCadContext(
        connected=True,
        kicad_version=version.full_version or str(version),
        project_name=project_name,
        project_dir=project_dir,
        eeschema_path=eeschema_path,
        kicad_cli_path=kicad_cli_path,
    )


def _binary_path(kicad, name: str) -> str | None:
    try:
        return kicad.get_kicad_binary_path(name) or None
    except Exception as exc:
        logger.info("could not get %s path: %s", name, exc)
        return None
