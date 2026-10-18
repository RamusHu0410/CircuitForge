"""FastAPI application entry point.

Run from the `backend/` directory:
    uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload

The CircuitForge UI (built with `npm run build` in the repo root) is served at "/" and opened in its
own desktop window (app/desktop.py), so the window's API calls are same-origin. In dev, the Vite
server on :5173 proxies "/api" here.

Local-only by design (no authentication): it binds to 127.0.0.1, answers only to localhost host
names, and only lets the CircuitForge UI's origins call it from a browser. Some endpoints write
files and open KiCad, so do not expose it on a network.
"""

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.routes import desktop, frontend, generation, health
from app.config import Settings, get_settings

REPO_DIST = Path(__file__).resolve().parents[3] / "dist"

_NOT_BUILT = """<!doctype html><meta charset="utf-8"><title>CircuitForge</title>
<body style="font:14px -apple-system,sans-serif;padding:40px;color:#292724">
<h2>The CircuitForge UI hasn't been built yet</h2>
<p>In the repo root run <code>npm install</code> and <code>npm run build</code>, then reload this window.</p>
<p>Looking for: <code>{path}</code></p></body>"""


def _ui_dir(settings: Settings) -> Path:
    return Path(settings.ui_dist_dir).expanduser() if settings.ui_dist_dir else REPO_DIST


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version=settings.app_version, debug=settings.debug)

    allowed_origins = set(settings.allowed_origins)

    @app.middleware("http")
    async def reject_foreign_origins(request: Request, call_next):  # type: ignore[no-untyped-def]
        """Browsers always send Origin on cross-site requests. Refuse anything but the web UI."""
        origin = request.headers.get("origin")
        if origin is not None and origin not in allowed_origins:
            return JSONResponse({"detail": f"Origin {origin} is not allowed."}, status_code=403)
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
    )
    # Added last so it runs first: a request for any other Host never reaches the routes.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)

    app.include_router(health.router, prefix=settings.api_prefix)
    app.include_router(generation.router, prefix=settings.api_prefix)
    app.include_router(frontend.router, prefix=settings.api_prefix)
    app.include_router(desktop.router, prefix=settings.api_prefix)

    ui = _ui_dir(settings)

    # Only "/" and "/assets/*" are UI; everything else stays API (so wrong methods still get 405).
    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    def ui_index() -> HTMLResponse:
        index = ui / "index.html"
        if index.is_file():
            return HTMLResponse(index.read_text(encoding="utf-8"), headers={"Cache-Control": "no-store"})
        return HTMLResponse(_NOT_BUILT.format(path=index))

    if (ui / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=ui / "assets"), name="ui-assets")

    return app


app = create_app()
