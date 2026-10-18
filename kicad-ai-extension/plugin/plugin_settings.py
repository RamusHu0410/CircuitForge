"""Plugin settings.

KiCad launches the plugin with its own environment, so shell variables are
often not visible (for example when KiCad is started from the macOS Dock).
The backend URL is therefore resolved in this order:

1. `KICAD_AI_BACKEND_URL` environment variable
2. `"backend_url"` in `config.json` next to `plugin.json`
3. `DEFAULT_BACKEND_URL`
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

PLUGIN_DIR = Path(__file__).resolve().parent
CONFIG_FILE = PLUGIN_DIR / "config.json"
DEFAULT_BACKEND_URL = "http://127.0.0.1:8765"
BACKEND_URL_ENV = "KICAD_AI_BACKEND_URL"

logger = logging.getLogger(__name__)


INTERFACES = ("circuitforge", "dialog")


@dataclass(frozen=True)
class PluginSettings:
    backend_url: str
    request_timeout_s: float = 90.0  # generation includes running KiCad's ERC
    # "circuitforge": open the CircuitForge window (served by the backend); "dialog": the built-in Tk dialog.
    interface: str = "circuitforge"


def _normalize_url(url: str) -> str | None:
    url = url.strip().rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return url


def load_settings(config_file: Path = CONFIG_FILE, environ: dict[str, str] | None = None) -> PluginSettings:
    environ = os.environ if environ is None else environ
    candidates: list[tuple[str, str]] = []
    interface = "circuitforge"

    if environ.get(BACKEND_URL_ENV):
        candidates.append((BACKEND_URL_ENV, environ[BACKEND_URL_ENV]))

    if config_file.is_file():
        try:
            data = json.loads(config_file.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("backend_url"), str):
                candidates.append((str(config_file), data["backend_url"]))
            if isinstance(data, dict) and data.get("interface") in INTERFACES:
                interface = data["interface"]
        except (OSError, ValueError) as exc:
            logger.warning("ignoring unreadable %s: %s", config_file, exc)

    for source, value in candidates:
        url = _normalize_url(value)
        if url:
            return PluginSettings(backend_url=url, interface=interface)
        logger.warning("ignoring invalid backend URL from %s: %r", source, value)

    return PluginSettings(backend_url=DEFAULT_BACKEND_URL, interface=interface)
