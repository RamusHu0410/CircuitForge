"""The CircuitForge window: a native desktop window (not a browser tab) showing the UI.

Launched by the backend when the KiCad plugin's button is clicked
(`POST /api/desktop/open`), or by hand from `backend/`:

    python -m app.desktop                     # uses http://127.0.0.1:8765/
    python -m app.desktop --url http://127.0.0.1:8765/

Uses pywebview, which wraps the operating system's own web engine
(WebKit on macOS, WebView2 on Windows) in a normal app window.
"""

from __future__ import annotations

import argparse
import os
import sys
import threading

DEFAULT_URL = "http://127.0.0.1:8765/"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Open the CircuitForge window")
    parser.add_argument("--url", default=DEFAULT_URL)
    args = parser.parse_args(argv)
    try:
        import webview
    except ImportError:
        print("pywebview is not installed. Run: pip install -r requirements.txt", file=sys.stderr)
        return 1

    closed = threading.Event()
    window = webview.create_window("CircuitForge", args.url, width=1440, height=900, min_size=(980, 640))
    window.events.closed += closed.set
    webview.start(_watch_focus_requests, (window, args.url, closed))
    # The window is gone: exit right away instead of waiting on background threads
    # (a lingering thread is what made the app look frozen after closing it).
    closed.set()
    os._exit(0)


def _watch_focus_requests(window, base_url: str, closed: threading.Event) -> None:
    """Bring the window forward when the KiCad button is clicked while it's already open.

    The backend bumps `focus_seq` in /api/desktop/info on each click; runs on pywebview's worker
    thread and stops as soon as the window closes.
    """
    import json
    import time
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
            try:
                window.restore()
                window.show()
                window.on_top = True
                time.sleep(0.3)
                window.on_top = False
            except Exception:  # window closing, or a backend without these calls
                pass
        seen = seq
        closed.wait(1.0)


if __name__ == "__main__":
    sys.exit(main())
