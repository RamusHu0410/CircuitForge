"""Health check endpoint."""

from fastapi import APIRouter

from app.api.dependencies import SettingsDep
from app.schemas.common import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse, summary="Backend health check")
def health_check(settings: SettingsDep) -> HealthResponse:
    """Confirm that the backend is running."""
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
    )
