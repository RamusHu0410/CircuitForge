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
    app_version: str = "0.2.0"
    app_env: Literal["development", "test", "production"] = "development"
    debug: bool = False
    api_prefix: str = "/api"

    # ERC with kicad-cli. Leave KICAD_CLI_PATH empty to auto-detect.
    erc_enabled: bool = True
    kicad_cli_path: str | None = None
    erc_timeout_s: float = 60.0

    # Where POST /api/generate/save writes projects. Empty = ~/Documents/KiCad/ai_generated.
    output_dir: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
