"""Entry point launched by KiCad for the "AI Schematic Generator" action.

KiCad runs this script with the plugin's virtual-environment Python:
    <venv>/bin/python entrypoint.py

It can also be run by hand for troubleshooting:
    python entrypoint.py           # open the dialog
    python entrypoint.py --check   # print KiCad + backend status, no UI

The plugin runs in its own process, so an exception here cannot crash KiCad.
Errors are still caught, logged, and printed to stderr (KiCad 10.0.1+ shows
plugin stderr in the editor's status-bar message panel).
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import tempfile
from pathlib import Path

LOG_FILE = Path(tempfile.gettempdir()) / "kicad-ai-schematic-generator.log"
logger = logging.getLogger("kicad_ai_plugin")


def _configure_logging() -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stderr)]
    try:
        handlers.append(logging.FileHandler(LOG_FILE, encoding="utf-8"))
    except OSError:
        pass
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=handlers
    )


def _fix_tcl_paths() -> None:
    """Point Tk at its script library when the interpreter can't find it on its own.

    KiCad 10's bundled macOS Python ships the Tcl/Tk files under its own prefix,
    but Tk looks relative to the plugin's virtual environment and fails with
    "Can't find a usable init.tcl". Setting TCL_LIBRARY/TK_LIBRARY fixes that.
    """
    lib = Path(sys.base_prefix) / "lib"
    for variable, folder, marker in (("TCL_LIBRARY", "tcl8.6", "init.tcl"), ("TK_LIBRARY", "tk8.6", "tk.tcl")):
        if not os.environ.get(variable) and (lib / folder / marker).is_file():
            os.environ[variable] = str(lib / folder)


def _build():
    from actions.generate_schematic import GenerateSchematicAction
    from backend_client import BackendClient
    from kicad_client.connection import get_kicad_context
    from plugin_settings import load_settings

    settings = load_settings()
    kicad = get_kicad_context()
    client = BackendClient(settings.backend_url, timeout_s=settings.request_timeout_s)
    return settings, kicad, client, GenerateSchematicAction(client, kicad)


def check() -> int:
    from backend_client import BackendError

    settings, kicad, client, action = _build()
    print(f"Python:  {sys.version.split()[0]} ({sys.executable})")
    print(f"KiCad:   {kicad.describe()}")
    print(f"Output:  {action.output_dir}")
    print(f"Backend: {settings.backend_url}")
    try:
        health = client.health()
        print(f"         OK - {health.get('name')} {health.get('version')}")
    except BackendError as exc:
        print(f"         FAILED - {exc}")
        return 1
    try:
        import tkinter

        root = tkinter.Tk()
        root.destroy()
        print("Dialog:  Tkinter OK")
    except Exception as exc:  # ImportError or TclError
        print(f"Dialog:  Tkinter NOT usable ({exc})")
        return 1
    return 0


def run() -> int:
    try:
        from ui.prompt_dialog import run_dialog
    except ImportError as exc:
        print(
            "AI Schematic Generator: cannot open the dialog because Tkinter is not available in the "
            f"Python used by KiCad ({sys.executable}): {exc}. See the README.",
            file=sys.stderr,
        )
        return 1

    from kicad_client.launcher import open_schematic, reveal

    _, kicad, _, action = _build()
    logger.info("launching dialog; %s; output to %s", kicad.describe(), action.output_dir)
    status = f"{kicad.describe()} Files are saved to {action.output_dir}."
    run_dialog(
        action.submit,
        status_text=status,
        on_open=lambda path: open_schematic(path, kicad.eeschema_path),
        on_reveal=reveal,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    _configure_logging()
    _fix_tcl_paths()
    parser = argparse.ArgumentParser(description="AI Schematic Generator KiCad plugin")
    parser.add_argument("--check", action="store_true", help="print KiCad and backend status without opening the UI")
    # KiCad may append extra arguments in future versions; ignore unknown ones.
    args, _unknown = parser.parse_known_args(argv)
    try:
        return check() if args.check else run()
    except Exception:
        logger.exception("AI Schematic Generator failed")
        print(f"AI Schematic Generator failed unexpectedly. Log: {LOG_FILE}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
