"""Health check endpoint."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.config import SERVICE_ID, Settings, get_settings

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    name: str
    version: str
    environment: str


@router.get("/health", response_model=HealthResponse, summary="Backend health check")
def health_check(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=SERVICE_ID,
        name=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
    )
