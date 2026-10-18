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

# Shape of a real /api/generate response (trimmed schematic text).
GENERATED_RESPONSE = {
    "request_id": "abc123",
    "status": "generated",
    "message": "Generated 'Red LED indicator' with 3 components.",
    "prompt": "LED",
    "generator": "rules",
    "circuit": {
        "title": "Red LED indicator",
        "description": "",
        "components": [
            {"ref": "J1", "kind": "connector_2pin", "value": "Power", "purpose": "5V input"},
            {"ref": "R1", "kind": "resistor", "value": "330", "purpose": "LED current limiting"},
            {"ref": "D1", "kind": "led", "value": "LED_Red", "purpose": ""},
        ],
        "nets": [],
        "notes": ["R1 = 330 for 9.1 mA."],
    },
    "validation": {"valid": True, "errors": [], "warnings": []},
    "erc": {"ran": True, "passed": True, "error_count": 0, "warning_count": 0, "violations": [],
            "message": "ERC passed with no issues."},
    "files": {
        "name": "red_led_indicator",
        "schematic": '(kicad_sch\n\t(version 20260306)\n\t(symbol (instances (project "red_led_indicator"))))\n',
        "project": '{"meta": {"filename": "red_led_indicator.kicad_pro"}}\n',
    },
}


class FakeBackend:
    """A real HTTP server on 127.0.0.1 with scriptable responses."""

    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], Responder] = {}
        self.requests: list[tuple[str, str, bytes]] = []
        self.set_json("GET", "/api/health", 200, {"status": "ok", "service": "kicad-ai-schematic-backend"})
        self.set_json("POST", "/api/generate", 200, GENERATED_RESPONSE)

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
