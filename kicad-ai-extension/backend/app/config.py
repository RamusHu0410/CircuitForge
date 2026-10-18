"""Environment-based configuration.

Values come from environment variables or an optional `.env` file in `backend/`.
See `.env.example` for the supported keys.
"""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Identifies this backend in /api/health so the KiCad plugin can tell it apart
# from any other local server that happens to be listening on the same port.
SERVICE_ID = "kicad-ai-schematic-backend"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "env/gemini.env"), env_file_encoding="utf-8", extra="ignore")

    app_name: str = "KiCad AI Schematic Backend"
    app_version: str = "0.2.0"
    app_env: Literal["development", "test", "production"] = "development"
    debug: bool = False
    api_prefix: str = "/api"

    # ERC with kicad-cli. Leave KICAD_CLI_PATH empty to auto-detect.
    erc_enabled: bool = True
    kicad_cli_path: str | None = None
    erc_timeout_s: float = 60.0

    # Optional language model that reads complex project descriptions (the prompt is sent to this service).
    # Off unless both LLM_API_KEY and LLM_MODEL are set. Uses the Anthropic Messages API.
    llm_api_key: str | None = None
    llm_model: str | None = None
    llm_base_url: str = "https://api.anthropic.com"
    llm_timeout_s: float = 30.0

    # Google Gemini (preferred when a key is set). Put the key in backend/env/gemini.env.
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"

    # Where the save endpoints write projects. Empty = ~/Documents/KiCad/ai_generated.
    output_dir: str | None = None

    # Browser access. The CircuitForge window (served by this backend on :8765) and the Vite dev server
    # (:5173) may call the API; any other website may not. Browsers send Origin even on same-origin POSTs.
    # Comma-separated in the environment. The KiCad plugin sends no Origin header and is unaffected.
    allowed_origins: Annotated[list[str], NoDecode] = [
        "http://127.0.0.1:8765", "http://localhost:8765", "http://localhost:5173", "http://127.0.0.1:5173",
    ]
    # Hostnames the API answers to (blocks DNS-rebinding). "testserver" is the test client's name.
    allowed_hosts: Annotated[list[str], NoDecode] = ["127.0.0.1", "localhost", "[::1]", "testserver"]

    @field_validator("allowed_origins", "allowed_hosts", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value
    # Where the CircuitForge window's "export" writes. Empty = ~/Downloads/CircuitForge.
    export_dir: str | None = None

    # The built CircuitForge UI (`npm run build` in the repo root) served at "/". Empty = <repo>/dist.
    ui_dist_dir: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
