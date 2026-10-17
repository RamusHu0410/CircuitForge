"""Backend client error handling against a real local HTTP server."""

import json
import time

import pytest

from backend_client import BackendClient, BackendResponseError, BackendUnavailableError
from conftest import FakeBackend


def test_health_ok(fake_backend: FakeBackend) -> None:
    assert BackendClient(fake_backend.url).health()["status"] == "ok"


def test_generate_sends_prompt_and_context(fake_backend: FakeBackend) -> None:
    result = BackendClient(fake_backend.url).generate("LED blinker", {"kicad_version": "11.0.0"})

    assert result.status == "not_implemented"
    assert result.request_id == "abc123"
    method, path, body = fake_backend.requests[-1]
    assert (method, path) == ("POST", "/api/generate")
    assert json.loads(body) == {"prompt": "LED blinker", "context": {"kicad_version": "11.0.0"}}


def test_backend_not_running(unused_url: str) -> None:
    with pytest.raises(BackendUnavailableError, match="Cannot reach the backend"):
        BackendClient(unused_url).health()


def test_backend_timeout(fake_backend: FakeBackend) -> None:
    def slow(*_):
        time.sleep(1.0)
        return 200, {}, b"{}"

    fake_backend.set("POST", "/api/generate", slow)
    with pytest.raises(BackendUnavailableError, match="did not respond in time"):
        BackendClient(fake_backend.url, timeout_s=0.2).generate("LED")


def test_wrong_service_on_port(fake_backend: FakeBackend) -> None:
    fake_backend.set_json("GET", "/api/health", 200, {"status": "ok", "service": "something-else"})
    with pytest.raises(BackendResponseError, match="not the KiCad AI backend"):
        BackendClient(fake_backend.url).health()


def test_validation_error_is_readable(fake_backend: FakeBackend) -> None:
    fake_backend.set_json(
        "POST",
        "/api/generate",
        422,
        {"detail": [{"loc": ["body", "prompt"], "msg": "String should have at least 1 character"}]},
    )
    with pytest.raises(BackendResponseError) as exc_info:
        BackendClient(fake_backend.url).generate("x")
    assert exc_info.value.status == 422
    assert str(exc_info.value) == "The backend rejected the request: prompt: String should have at least 1 character"


def test_server_error(fake_backend: FakeBackend) -> None:
    fake_backend.set_raw("POST", "/api/generate", 500, b"Internal Server Error")
    with pytest.raises(BackendResponseError, match="internal error \\(500\\)"):
        BackendClient(fake_backend.url).generate("x")


def test_string_detail_error(fake_backend: FakeBackend) -> None:
    fake_backend.set_json("POST", "/api/generate", 503, {"detail": "AI provider unavailable"})
    with pytest.raises(BackendResponseError, match="AI provider unavailable"):
        BackendClient(fake_backend.url).generate("x")


def test_not_found(fake_backend: FakeBackend) -> None:
    fake_backend.routes.pop(("POST", "/api/generate"))
    with pytest.raises(BackendResponseError, match="HTTP 404"):
        BackendClient(fake_backend.url).generate("x")


@pytest.mark.parametrize("payload", [b"not json", b"[1, 2]", b"\xff\xfe"])
def test_invalid_json(fake_backend: FakeBackend, payload: bytes) -> None:
    fake_backend.set_raw("GET", "/api/health", 200, payload)
    with pytest.raises(BackendResponseError):
        BackendClient(fake_backend.url).health()


def test_missing_response_field(fake_backend: FakeBackend) -> None:
    fake_backend.set_json("POST", "/api/generate", 200, {"status": "not_implemented"})
    with pytest.raises(BackendResponseError, match="missing field"):
        BackendClient(fake_backend.url).generate("x")


def test_loopback_ignores_proxy_env(fake_backend: FakeBackend, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9")
    assert BackendClient(fake_backend.url).health()["status"] == "ok"
