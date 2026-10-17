"""Schemas shared across API endpoints."""

from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Response body for the health check endpoint."""

    status: Literal["ok"]
    service: str
    version: str
    environment: str
