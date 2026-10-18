"""plugin.json must pass the same checks KiCad applies when loading plugins.

Fixtures: `kicad_api.v1.schema.json` is the upstream (KiCad 11) schema;
`kicad10_api.v1.schema.json` is the copy bundled with KiCad 10.0.7. The
identifier regex is copied from API_PLUGIN::IsValidIdentifier in
common/api/api_plugin.cpp.
"""

import json
import re
from pathlib import Path

import jsonschema
import pytest

from conftest import PLUGIN_DIR

FIXTURES = Path(__file__).parent / "fixtures"
MANIFEST = json.loads((PLUGIN_DIR / "plugin.json").read_text())
KICAD_IDENTIFIER_RE = re.compile(r"^[a-zA-Z]{2,}(\.([a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]|[a-zA-Z0-9])){2,}$")


@pytest.mark.parametrize("schema_file", ["kicad_api.v1.schema.json", "kicad10_api.v1.schema.json"])
def test_manifest_matches_kicad_schema(schema_file: str) -> None:
    jsonschema.validate(MANIFEST, json.loads((FIXTURES / schema_file).read_text()))


def test_plugin_identifier_accepted_by_kicad() -> None:
    assert KICAD_IDENTIFIER_RE.match(MANIFEST["identifier"])


def test_python_runtime() -> None:
    assert MANIFEST["runtime"]["type"] == "python"


def test_action_scopes() -> None:
    [action] = MANIFEST["actions"]
    assert action["name"] == "AI Schematic Generator"
    # PCB Editor for KiCad 9/10 (their only plugin scope); Schematic Editor from KiCad 11.
    assert action["scopes"] == ["pcb", "schematic"]
    assert action["show-button"] is True


def test_entrypoint_and_icons_exist_and_are_relative() -> None:
    [action] = MANIFEST["actions"]
    paths = [action["entrypoint"], *action["icons-light"], *action["icons-dark"]]
    for path in paths:
        assert not Path(path).is_absolute(), "KiCad skips actions with absolute entrypoints"
        assert (PLUGIN_DIR / path).is_file(), path
    for icon in action["icons-light"] + action["icons-dark"]:
        assert (PLUGIN_DIR / icon).read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def test_requirements_file_present() -> None:
    # Without requirements.txt KiCad reports a load warning and kicad-python is missing.
    assert "kicad-python" in (PLUGIN_DIR / "requirements.txt").read_text()
