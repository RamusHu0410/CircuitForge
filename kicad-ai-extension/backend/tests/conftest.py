from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

_SYMBOL_DIRS = [
    Path("/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols"),
    Path("/usr/share/kicad/symbols"),
]


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def kicad_symbol_dir() -> Path | None:
    """Installed KiCad symbol libraries, if any (used to check the vendored copy is current)."""
    return next((d for d in _SYMBOL_DIRS if (d / "Device.kicad_sym").is_file()), None)
