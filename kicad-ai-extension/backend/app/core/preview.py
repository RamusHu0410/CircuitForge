"""Render a generated schematic to SVG with `kicad-cli`, for the CircuitForge window's preview."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from app.schemas.circuit import SchematicFiles


class PreviewError(RuntimeError):
    """User-facing message."""


def export_svg(files: SchematicFiles, kicad_cli: str | None, timeout_s: float = 60.0) -> str:
    if not kicad_cli:
        raise PreviewError("kicad-cli not found, so the preview can't be drawn. Set KICAD_CLI_PATH.")
    with tempfile.TemporaryDirectory(prefix="kicad-ai-svg-") as tmp:
        folder = Path(tmp)
        schematic = folder / f"{files.name}.kicad_sch"
        schematic.write_text(files.schematic, encoding="utf-8")
        (folder / f"{files.name}.kicad_pro").write_text(files.project, encoding="utf-8")
        out = folder / "svg"
        command = [kicad_cli, "sch", "export", "svg", "--exclude-drawing-sheet", "--no-background-color", "-o", str(out), str(schematic)]
        try:
            subprocess.run(command, cwd=folder, capture_output=True, text=True, timeout=timeout_s, check=True)
        except subprocess.TimeoutExpired:
            raise PreviewError(f"Preview timed out after {timeout_s:.0f} s.") from None
        except (OSError, subprocess.CalledProcessError) as exc:
            raise PreviewError(f"kicad-cli could not draw the preview: {exc}") from None
        svgs = sorted(out.glob("*.svg"))
        if not svgs:
            raise PreviewError("kicad-cli produced no SVG.")
        return svgs[0].read_text(encoding="utf-8")


def export_pdf(files: SchematicFiles, kicad_cli: str | None, timeout_s: float = 60.0) -> bytes:
    if not kicad_cli:
        raise PreviewError("kicad-cli not found, so the PDF can't be made. Set KICAD_CLI_PATH.")
    with tempfile.TemporaryDirectory(prefix="kicad-ai-pdf-") as tmp:
        folder = Path(tmp)
        schematic = folder / f"{files.name}.kicad_sch"
        schematic.write_text(files.schematic, encoding="utf-8")
        (folder / f"{files.name}.kicad_pro").write_text(files.project, encoding="utf-8")
        out = folder / f"{files.name}.pdf"
        command = [kicad_cli, "sch", "export", "pdf", "-o", str(out), str(schematic)]
        try:
            subprocess.run(command, cwd=folder, capture_output=True, text=True, timeout=timeout_s, check=True)
        except subprocess.TimeoutExpired:
            raise PreviewError(f"PDF export timed out after {timeout_s:.0f} s.") from None
        except (OSError, subprocess.CalledProcessError) as exc:
            raise PreviewError(f"kicad-cli could not make the PDF: {exc}") from None
        if not out.is_file():
            raise PreviewError("kicad-cli produced no PDF.")
        return out.read_bytes()
