"""FastAPI application entry point.

Run from the `backend/` directory:
    uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload

No CORS middleware: the only client is the KiCad plugin, which calls the API
directly (not from a browser).
"""

from fastapi import FastAPI

from app.api.routes import generation, health
from app.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version=settings.app_version, debug=settings.debug)
    app.include_router(health.router, prefix=settings.api_prefix)
    app.include_router(generation.router, prefix=settings.api_prefix)
    return app


app = create_app()
