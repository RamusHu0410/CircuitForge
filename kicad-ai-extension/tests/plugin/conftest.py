"""Plugin test setup.

KiCad runs `python plugin/entrypoint.py`, which puts `plugin/` on sys.path.
Mirror that here so tests import modules exactly as the plugin does.
"""

import json
import sys
import threading
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugin"
sys.path.insert(0, str(PLUGIN_DIR))

# (status, headers, body) returned for a request path.
Responder = Callable[[str, str, bytes], tuple[int, dict[str, str], bytes]]


class FakeBackend:
    """A real HTTP server on 127.0.0.1 with scriptable responses."""

    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], Responder] = {}
        self.requests: list[tuple[str, str, bytes]] = []
        self.set_json("GET", "/api/health", 200, {"status": "ok", "service": "kicad-ai-schematic-backend"})
        self.set_json(
            "POST",
            "/api/generate",
            200,
            {"request_id": "abc123", "status": "not_implemented", "message": "Not implemented yet.", "prompt": "x"},
        )

        backend = self

        class Handler(BaseHTTPRequestHandler):
            def _handle(self, method: str) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length)
                backend.requests.append((method, self.path, body))
                responder = backend.routes.get((method, self.path))
                status, headers, payload = responder(method, self.path, body) if responder else (404, {}, b"{}")
                self.send_response(status)
                for key, value in {"Content-Type": "application/json", **headers}.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self) -> None:  # noqa: N802
                self._handle("GET")

            def do_POST(self) -> None:  # noqa: N802
                self._handle("POST")

            def log_message(self, *args: object) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def set_json(self, method: str, path: str, status: int, body: object) -> None:
        payload = json.dumps(body).encode()
        self.routes[(method, path)] = lambda *_: (status, {}, payload)

    def set_raw(self, method: str, path: str, status: int, payload: bytes) -> None:
        self.routes[(method, path)] = lambda *_: (status, {"Content-Type": "text/plain"}, payload)

    def set(self, method: str, path: str, responder: Responder) -> None:
        self.routes[(method, path)] = responder


@pytest.fixture
def fake_backend() -> Iterator[FakeBackend]:
    backend = FakeBackend()
    thread = threading.Thread(target=backend.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    thread.start()
    yield backend
    backend.server.shutdown()
    backend.server.server_close()


@pytest.fixture
def unused_url() -> str:
    """A loopback URL where nothing is listening."""
    import socket

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    return f"http://127.0.0.1:{port}"
