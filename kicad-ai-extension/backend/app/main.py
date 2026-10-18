"""FastAPI application entry point.

Run from the `backend/` directory:
    uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload

Local-only by design (no authentication): it binds to 127.0.0.1, answers only to localhost host
names, and only lets the CircuitForge web UI's origin call it from a browser. Some endpoints
write files and open KiCad, so do not expose it on a network.
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.routes import frontend, generation, health
from app.config import get_settings


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
    return app


app = create_app()
