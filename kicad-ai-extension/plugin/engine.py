"""The CircuitForge engine, run by the plugin itself: no server to start.

In the KiCad package the engine (`app/`), the built UI (`web/`) and pywebview (`vendor/`) sit next to
this file; in the repo they are ../backend/app and ../../dist, so a symlinked plugin folder works while
developing (run `scripts/package_pcm.py --vendor-dev` once to fill vendor/).

- `open_window` starts the CircuitForge window (backend/app/desktop.py) as its own process, or hands the
  click to the window that is already open.
- `LocalEngine` generates in this process for the fallback dialog; it has the same `health` /
  `generate` methods as `BackendClient`.
"""

from __future__ import annotations

import logging
import os
import platform
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from backend_client import EXPECTED_SERVICE, BackendResponseError, BackendUnavailableError, GenerateResult, result_from_body

PLUGIN_DIR = Path(__file__).resolve().parent
ENGINE_CANDIDATES = (PLUGIN_DIR, PLUGIN_DIR.parent / "backend")
UI_CANDIDATES = (PLUGIN_DIR / "web", PLUGIN_DIR.parents[1] / "dist")
VENDOR_DIR = PLUGIN_DIR / "vendor"  # pywebview + proxy_tools (no wheel for proxy_tools; see requirements.txt)
STARTUP_CHECK_S = 2.5  # a window that can't open (e.g. no GUI toolkit) fails within this time
MAX_LOG_BYTES = 1_000_000

logger = logging.getLogger(__name__)


class EngineMissingError(BackendUnavailableError):
    pass


def engine_root() -> Path | None:
    return next((c for c in ENGINE_CANDIDATES if (c / "app" / "__init__.py").is_file()), None)


def ui_dir() -> Path | None:
    return next((c for c in UI_CANDIDATES if (c / "index.html").is_file()), None)


def ensure_importable() -> Path:
    root = engine_root()
    if root is None:
        raise EngineMissingError(
            f"The CircuitForge engine is missing from {PLUGIN_DIR}. Reinstall the plugin from the Plugin and Content Manager."
        )
    for folder in (root, VENDOR_DIR):
        if folder.is_dir() and str(folder) not in sys.path:
            sys.path.insert(0, str(folder))
    return root


def open_window(context: dict[str, Any], kicad_cli: str | None = None) -> str | None:
    """Open the window, or bring the open one forward. Returns a reason if it couldn't, else None."""
    try:
        root = ensure_importable()
        from app import instance
    except (EngineMissingError, ImportError) as exc:
        return str(exc)

    state = instance.state_dir()
    try:
        instance.write_session(state, context)
    except OSError as exc:
        return f"Could not write to {state}: {exc}"
    if instance.window_running(state):
        logger.info("CircuitForge window already open; it will come forward")
        return None

    ui = ui_dir()
    if ui is None:
        return "The CircuitForge UI is missing. Reinstall the plugin, or run `npm run build` in the repo."
    try:
        import webview  # noqa: F401  (vendor/, with its dependencies from requirements.txt)
    except ImportError as exc:
        return f"the window's web view can't load in KiCad's Python for this plugin ({exc})."

    env = dict(os.environ)
    if VENDOR_DIR.is_dir():
        env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(VENDOR_DIR), env.get("PYTHONPATH")]))
    if kicad_cli and not env.get("KICAD_CLI_PATH"):
        env["KICAD_CLI_PATH"] = kicad_cli  # the exact kicad-cli of the KiCad that launched us
    command = [_window_python(), "-m", "app.desktop", "--ui", str(ui), "--from-kicad"]
    log_path = state / "window.log"
    try:
        log = _open_log(log_path)
        with log:
            process = subprocess.Popen(
                command, cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, **_detached()
            )
    except OSError as exc:
        return f"Could not start the CircuitForge window: {exc}"

    deadline = time.monotonic() + STARTUP_CHECK_S
    while time.monotonic() < deadline:
        code = process.poll()
        if code is not None:
            return None if code == 0 else f"the window exited at startup (code {code}); see {log_path}"
        time.sleep(0.1)
    logger.info("opened CircuitForge window (pid %s); log: %s", process.pid, log_path)
    return None


def _window_python() -> str:
    """On Windows pythonw.exe runs without a console window."""
    if platform.system() == "Windows":
        pythonw = Path(sys.executable).with_name("pythonw.exe")
        if pythonw.is_file():
            return str(pythonw)
    return sys.executable


def _detached() -> dict[str, Any]:
    """Keep the window open after this plugin process exits."""
    if platform.system() == "Windows":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW}  # type: ignore[attr-defined]
    return {"start_new_session": True}


def _open_log(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if path.stat().st_size > MAX_LOG_BYTES:
            path.unlink()
    except OSError:
        pass
    return open(path, "ab")


class LocalEngine:
    """Generates in this process, for the fallback dialog (same interface as BackendClient)."""

    def health(self) -> dict[str, Any]:
        root = ensure_importable()
        try:
            import app.services.generation_service  # noqa: F401
        except ImportError as exc:
            raise EngineMissingError(f"The CircuitForge engine at {root} can't load: {exc}") from None
        return {"status": "ok", "service": EXPECTED_SERVICE}

    def generate(self, prompt: str, context: dict[str, Any] | None = None) -> GenerateResult:
        self.health()
        from app.ai.circuit_generator import GenerationError
        from app.config import Settings
        from app.schemas.circuit import GenerateRequest
        from app.services.generation_service import GenerationService

        try:
            response = GenerationService(Settings()).generate(GenerateRequest(prompt=prompt, context=context))
        except GenerationError as exc:
            raise BackendResponseError(str(exc), 422) from None
        return result_from_body(response.model_dump(mode="json"))
