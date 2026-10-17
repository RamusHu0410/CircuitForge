"""Environment-based configuration.

Values come from environment variables or an optional `.env` file in `backend/`.
See `.env.example` for the supported keys.
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# Identifies this backend in /api/health so the KiCad plugin can tell it apart
# from any other local server that happens to be listening on the same port.
SERVICE_ID = "kicad-ai-schematic-backend"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "KiCad AI Schematic Backend"
    app_version: str = "0.1.0"
    app_env: Literal["development", "test", "production"] = "development"
    debug: bool = False
    api_prefix: str = "/api"


@lru_cache
def get_settings() -> Settings:
    return Settings()
