"""plugin.json must pass the same checks KiCad applies when loading plugins.

The schema fixture is KiCad's official api/schemas/api.v1.schema.json.
The identifier regex is copied from API_PLUGIN::IsValidIdentifier in
common/api/api_plugin.cpp.
"""

import json
import re
from pathlib import Path

import jsonschema

from conftest import PLUGIN_DIR

SCHEMA = json.loads((Path(__file__).parent / "fixtures" / "kicad_api.v1.schema.json").read_text())
MANIFEST = json.loads((PLUGIN_DIR / "plugin.json").read_text())
KICAD_IDENTIFIER_RE = re.compile(r"^[a-zA-Z]{2,}(\.([a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]|[a-zA-Z0-9])){2,}$")


def test_manifest_matches_kicad_schema() -> None:
    jsonschema.validate(MANIFEST, SCHEMA)


def test_plugin_identifier_accepted_by_kicad() -> None:
    assert KICAD_IDENTIFIER_RE.match(MANIFEST["identifier"])


def test_python_runtime() -> None:
    assert MANIFEST["runtime"]["type"] == "python"


def test_single_schematic_action() -> None:
    [action] = MANIFEST["actions"]
    assert action["name"] == "AI Schematic Generator"
    assert action["scopes"] == ["schematic"]
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
