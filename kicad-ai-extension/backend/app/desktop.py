"""The CircuitForge window: a native desktop window (not a browser tab) showing the UI.

Two ways to run it, from `backend/` (or the plugin folder in the KiCad package):

    python -m app.desktop                     # the engine runs in this process: no server needed
    python -m app.desktop --url http://127.0.0.1:8765/   # load the UI from a running backend instead

The KiCad plugin starts the first form with `--from-kicad` (plugin/engine.py). The page then calls the
engine through pywebview's JavaScript bridge (app/bridge.py); pywebview serves the built UI's files to
the window itself. Uses the operating system's own web engine (WebKit on macOS, WebView2 on Windows).
"""

from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import threading
import time
from pathlib import Path

DEFAULT_URL = "http://127.0.0.1:8765/"
APP_DIR = Path(__file__).resolve().parent
# Where the built UI is: next to app/ in the KiCad package, the repo's dist/ when developing.
UI_CANDIDATES = (APP_DIR.parent / "web", APP_DIR.parents[2] / "dist")
# The UI's saved settings live with its address, so keep the same port between runs when it's free.
PREFERRED_UI_PORT = 47615

logger = logging.getLogger("circuitforge.window")


def find_ui_dir(configured: str | None = None) -> Path | None:
    candidates = (Path(configured).expanduser(),) if configured else UI_CANDIDATES
    return next((c for c in candidates if (c / "index.html").is_file()), None)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Open the CircuitForge window")
    parser.add_argument("--url", help="load the UI from a running backend instead of running the engine here")
    parser.add_argument("--ui", help="folder with the built UI (default: next to app/, or the repo's dist/)")
    parser.add_argument("--from-kicad", action="store_true", help="opened by the KiCad button (keeps its session)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        import webview  # noqa: F401
    except ImportError:
        print("pywebview is not installed. Run: pip install -r requirements.txt", file=sys.stderr)
        return 1
    if args.url:
        return _run_with_server(args.url)
    return _run_with_bridge(args.ui, args.from_kicad)


# --- engine in this process (the KiCad plugin) --------------------------------------------


def _run_with_bridge(ui_arg: str | None, from_kicad: bool) -> int:
    import webview

    from app import instance
    from app.bridge import Api
    from app.config import get_settings

    settings = get_settings()
    ui = find_ui_dir(ui_arg or settings.ui_dist_dir)
    if ui is None:
        print("The CircuitForge UI hasn't been built. In the repo root run: npm install && npm run build", file=sys.stderr)
        return 1

    state = instance.state_dir()
    lock = instance.WindowLock(state)
    if not lock.acquire():
        # Another window is open; the session file the plugin just wrote brings it forward.
        logger.info("a CircuitForge window is already open")
        return 0
    if not from_kicad:
        instance.clear_session(state)  # opened by hand: don't save into whatever project KiCad had last

    closed = threading.Event()
    window = webview.create_window(
        "CircuitForge",
        str(ui / "index.html") + "#bridge",  # "#bridge" tells the UI to call Python instead of HTTP
        js_api=Api(settings, state_dir=state),
        width=1440,
        height=900,
        min_size=(980, 640),
    )
    window.events.closed += closed.set
    webview.start(
        _watch_kicad_clicks,
        (window, state, closed),
        private_mode=False,  # keep the UI's settings between runs
        storage_path=str(state / "webview"),
        http_port=_ui_port(),
    )
    closed.set()
    lock.release()
    os._exit(0)  # don't wait on pywebview's background threads (that looked like a frozen app)


def _ui_port() -> int | None:
    """PREFERRED_UI_PORT if it's free; otherwise let pywebview pick one (settings then start fresh)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", PREFERRED_UI_PORT))
        except OSError:
            return None
    return PREFERRED_UI_PORT


def _watch_kicad_clicks(window, state: Path, closed: threading.Event) -> None:
    """Bring the window forward when the KiCad button is clicked while it's already open.

    Each click rewrites the session file (app/instance.py); runs on pywebview's worker thread and stops
    as soon as the window closes. The page re-reads the session the next time it gains focus.
    """
    from app import instance

    seen = instance.session_stamp(state)
    while not closed.wait(0.5):
        stamp = instance.session_stamp(state)
        if stamp is not None and stamp != seen:
            _bring_forward(window)
        seen = stamp


# --- UI from a running backend ------------------------------------------------------------


def _run_with_server(url: str) -> int:
    import webview

    closed = threading.Event()
    window = webview.create_window("CircuitForge", url, width=1440, height=900, min_size=(980, 640))
    window.events.closed += closed.set
    webview.start(_watch_focus_requests, (window, url, closed))
    closed.set()
    os._exit(0)


def _watch_focus_requests(window, base_url: str, closed: threading.Event) -> None:
    """Bring the window forward when the backend's `focus_seq` changes (POST /api/desktop/open)."""
    import json
    import urllib.request

    url = base_url.rstrip("/") + "/api/desktop/info"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    seen = None
    while not closed.is_set():
        try:
            with opener.open(url, timeout=1) as response:
                seq = json.loads(response.read()).get("focus_seq")
        except (OSError, ValueError):
            seq = seen
        if seen is not None and seq != seen:
            _bring_forward(window)
        seen = seq
        closed.wait(1.0)


def _bring_forward(window) -> None:
    try:
        window.restore()
        window.show()
        window.on_top = True
        time.sleep(0.3)
        window.on_top = False
    except Exception:  # window closing, or a GUI backend without these calls
        pass


if __name__ == "__main__":
    sys.exit(main())
