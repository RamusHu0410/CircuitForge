"""Run KiCad's Electrical Rules Check on generated files using `kicad-cli`."""

from __future__ import annotations

import json
import logging
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.schemas.circuit import ErcReport, ErcViolation, SchematicFiles

logger = logging.getLogger(__name__)

_CANDIDATES = {
    "Darwin": [
        "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
        "/Applications/KiCad-nightly/KiCad.app/Contents/MacOS/kicad-cli",
    ],
    "Windows": [
        r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe",
        r"C:\Program Files\KiCad\11.0\bin\kicad-cli.exe",
        r"C:\Program Files\KiCad\10.99\bin\kicad-cli.exe",
    ],
    "Linux": ["/usr/bin/kicad-cli", "/usr/local/bin/kicad-cli"],
}


def find_kicad_cli(configured: str | None = None) -> str | None:
    if configured:
        return configured if Path(configured).is_file() else None
    found = shutil.which("kicad-cli")
    if found:
        return found
    for candidate in _CANDIDATES.get(platform.system(), []):
        if Path(candidate).is_file():
            return candidate
    return None


def run_erc(files: SchematicFiles, kicad_cli: str | None, timeout_s: float = 60.0) -> ErcReport:
    if not kicad_cli:
        return ErcReport(ran=False, message="kicad-cli not found; ERC was skipped. Set KICAD_CLI_PATH to enable it.")

    with tempfile.TemporaryDirectory(prefix="kicad-ai-erc-") as tmp:
        folder = Path(tmp)
        schematic = folder / f"{files.name}.kicad_sch"
        schematic.write_text(files.schematic, encoding="utf-8")
        (folder / f"{files.name}.kicad_pro").write_text(files.project, encoding="utf-8")
        report_path = folder / "erc.json"
        command = [kicad_cli, "sch", "erc", "--format", "json", "--severity-all", "-o", str(report_path), str(schematic)]
        try:
            result = subprocess.run(command, cwd=folder, capture_output=True, text=True, timeout=timeout_s)
        except subprocess.TimeoutExpired:
            return ErcReport(ran=False, message=f"ERC timed out after {timeout_s:.0f} s.")
        except OSError as exc:
            return ErcReport(ran=False, message=f"Could not run kicad-cli: {exc}")

        if result.returncode != 0 or not report_path.is_file():
            detail = (result.stderr or result.stdout).strip().splitlines()[-1:] or ["no output"]
            logger.warning("kicad-cli erc failed (%s): %s", result.returncode, result.stderr)
            return ErcReport(ran=False, message=f"kicad-cli could not check the schematic: {detail[0]}")
        return parse_erc_report(json.loads(report_path.read_text(encoding="utf-8")))


def parse_erc_report(report: dict) -> ErcReport:
    violations: list[ErcViolation] = []
    for sheet in report.get("sheets", []):
        for violation in sheet.get("violations", []):
            violations.append(
                ErcViolation(
                    severity=str(violation.get("severity", "")),
                    type=str(violation.get("type", "")),
                    description=str(violation.get("description", "")),
                    items=[str(item.get("description", "")) for item in violation.get("items", [])],
                )
            )
    errors = sum(1 for v in violations if v.severity == "error")
    warnings = sum(1 for v in violations if v.severity == "warning")
    message = "ERC passed with no issues." if not violations else f"ERC found {errors} error(s), {warnings} warning(s)."
    return ErcReport(
        ran=True, passed=errors == 0, error_count=errors, warning_count=warnings, violations=violations, message=message
    )
