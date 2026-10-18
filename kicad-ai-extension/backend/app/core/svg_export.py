"""Render a generated schematic as an SVG with KiCad's own exporter (`kicad-cli sch export svg`).

The web UI shows this picture as a preview, so what you see is exactly what KiCad will open.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

from app.schemas.circuit import SchematicFiles


class SvgExportError(RuntimeError):
    """User-facing message."""


def export_svg(files: SchematicFiles, kicad_cli: str, timeout_s: float = 60.0) -> str:
    with tempfile.TemporaryDirectory(prefix="kicad-ai-svg-") as tmp:
        folder = Path(tmp)
        schematic = folder / f"{files.name}.kicad_sch"
        schematic.write_text(files.schematic, encoding="utf-8")
        (folder / f"{files.name}.kicad_pro").write_text(files.project, encoding="utf-8")
        out = folder / "svg"
        out.mkdir()
        command = [kicad_cli, "sch", "export", "svg", "-e", "-o", str(out), str(schematic)]
        try:
            result = subprocess.run(command, cwd=folder, capture_output=True, text=True, timeout=timeout_s)
        except subprocess.TimeoutExpired:
            raise SvgExportError(f"Drawing the schematic timed out after {timeout_s:.0f} s.") from None
        except OSError as exc:
            raise SvgExportError(f"Could not run kicad-cli: {exc}") from None
        svgs = sorted(out.glob("*.svg"))
        if result.returncode != 0 or not svgs:
            raise SvgExportError("kicad-cli could not draw the schematic.")
        return crop_to_content(svgs[0].read_text(encoding="utf-8"))


_PATH_D = re.compile(r'<path[^>]*?\sd="([^"]+)"')
_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")
_CIRCLE = re.compile(r'<circle[^>]*?\bcx="(-?[\d.]+)"[^>]*?\bcy="(-?[\d.]+)"[^>]*?\br="([\d.]+)"')
_ROOT = re.compile(r"<svg\b[^>]*>", re.S)


def crop_to_content(svg: str, padding_mm: float = 4.0) -> str:
    """Fit the SVG's view box to the drawing instead of the whole A4 page.

    KiCad draws in millimetres on the sheet, so the circuit would otherwise sit small in a corner.
    The size attributes are dropped so the page can scale it to any container.
    """
    xs: list[float] = []
    ys: list[float] = []
    for d in _PATH_D.findall(svg):
        numbers = [float(n) for n in _NUMBER.findall(d)]
        xs += numbers[0::2]
        ys += numbers[1::2]
    for cx, cy, r in _CIRCLE.findall(svg):
        xs += [float(cx) - float(r), float(cx) + float(r)]
        ys += [float(cy) - float(r), float(cy) + float(r)]
    root = _ROOT.search(svg)
    if not xs or not ys or root is None:
        return svg
    x0, y0 = min(xs) - padding_mm, min(ys) - padding_mm
    width, height = max(xs) - min(xs) + 2 * padding_mm, max(ys) - min(ys) + 2 * padding_mm
    tag = re.sub(r'\s(?:width|height|viewBox)="[^"]*"', "", root.group(0))
    tag = tag[:-1] + f' viewBox="{x0:.3f} {y0:.3f} {width:.3f} {height:.3f}" preserveAspectRatio="xMidYMid meet">'
    return svg[: root.start()] + tag + svg[root.end():]
