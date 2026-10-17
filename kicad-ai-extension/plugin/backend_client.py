"""HTTP client for the local FastAPI backend.

Standard library only, so it works in any Python KiCad is configured to use.
Every failure is raised as a `BackendError` subclass with a message suitable
for showing to the user; nothing here should crash the plugin.
"""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

EXPECTED_SERVICE = "kicad-ai-schematic-backend"
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


class BackendError(Exception):
    """Base class; `str(error)` is a user-facing message."""


class BackendUnavailableError(BackendError):
    """The backend could not be reached (not running, wrong port, timeout)."""


class BackendResponseError(BackendError):
    """The backend answered, but with an error or an unexpected response."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class GenerateResult:
    request_id: str
    status: str
    message: str


class BackendClient:
    def __init__(self, base_url: str, timeout_s: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        handlers: list[urllib.request.BaseHandler] = []
        # Never route local traffic through a system/HTTP proxy.
        if urlparse(self.base_url).hostname in _LOOPBACK_HOSTS:
            handlers.append(urllib.request.ProxyHandler({}))
        self._opener = urllib.request.build_opener(*handlers)

    # --- Public API ---------------------------------------------------------

    def health(self) -> dict[str, Any]:
        body = self._request("GET", "/api/health", timeout_s=min(self.timeout_s, 5.0))
        if body.get("status") != "ok" or body.get("service") != EXPECTED_SERVICE:
            raise BackendResponseError(
                f"A server is running at {self.base_url}, but it is not the KiCad AI backend. "
                "Check the backend URL or port."
            )
        return body

    def generate(self, prompt: str, context: dict[str, Any] | None = None) -> GenerateResult:
        payload: dict[str, Any] = {"prompt": prompt}
        if context:
            payload["context"] = context
        body = self._request("POST", "/api/generate", payload)
        try:
            return GenerateResult(
                request_id=str(body["request_id"]),
                status=str(body["status"]),
                message=str(body["message"]),
            )
        except KeyError as exc:
            raise BackendResponseError(f"Backend response is missing field {exc}.") from None

    # --- Internals ----------------------------------------------------------

    def _request(
        self, method: str, path: str, payload: dict[str, Any] | None = None, timeout_s: float | None = None
    ) -> dict[str, Any]:
        url = self.base_url + path
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(url, data=data, method=method, headers={"Accept": "application/json"})
        if data is not None:
            request.add_header("Content-Type", "application/json")

        try:
            with self._opener.open(request, timeout=timeout_s or self.timeout_s) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            raise _http_error(exc) from None
        except (TimeoutError, socket.timeout):
            raise BackendUnavailableError(
                f"The backend at {self.base_url} did not respond in time. It may be busy or stuck; try again."
            ) from None
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, (TimeoutError, socket.timeout)):
                raise BackendUnavailableError(
                    f"The backend at {self.base_url} did not respond in time. It may be busy or stuck; try again."
                ) from None
            raise BackendUnavailableError(
                f"Cannot reach the backend at {self.base_url} ({exc.reason}). "
                "Make sure it is running: cd backend && uvicorn app.main:app --port 8765"
            ) from None
        except (OSError, ValueError) as exc:  # connection reset, bad URL, etc.
            raise BackendUnavailableError(f"Cannot reach the backend at {self.base_url} ({exc}).") from None

        return _parse_json_object(raw)


def _parse_json_object(raw: bytes) -> dict[str, Any]:
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise BackendResponseError("The backend returned a response that is not valid JSON.") from None
    if not isinstance(body, dict):
        raise BackendResponseError("The backend returned an unexpected response format.")
    return body


def _http_error(exc: urllib.error.HTTPError) -> BackendResponseError:
    try:
        detail = json.loads(exc.read().decode("utf-8")).get("detail")
    except Exception:
        detail = None

    if exc.code == 422 and isinstance(detail, list):
        problems = []
        for item in detail:
            if isinstance(item, dict):
                field = ".".join(str(p) for p in item.get("loc", []) if p != "body")
                problems.append(f"{field}: {item.get('msg')}" if field else str(item.get("msg")))
        return BackendResponseError("The backend rejected the request: " + "; ".join(problems), exc.code)
    if isinstance(detail, str):
        return BackendResponseError(f"The backend returned an error ({exc.code}): {detail}", exc.code)
    if exc.code >= 500:
        return BackendResponseError(
            f"The backend hit an internal error ({exc.code}). Check the backend console for details.", exc.code
        )
    return BackendResponseError(f"The backend returned HTTP {exc.code}.", exc.code)
