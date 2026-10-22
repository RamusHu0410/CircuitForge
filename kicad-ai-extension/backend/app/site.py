"""What this install is (the desktop app or the public website) and the parts library the website's
playground uses. Free of FastAPI: the KiCad plugin (which ships without the HTTP server) uses it too."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import BaseModel

from app.config import Settings
from app.core.component_registry import COMPONENT_KINDS, POWER_SYMBOLS
from app.core.scene import library_symbols
from app.schemas.scene import LibSymbol


class Features(BaseModel):
    playground: bool
    speedruns: bool
    races: bool


class SiteInfo(BaseModel):
    mode: Literal["desktop", "web"]
    site_url: str | None
    features: Features


def site_info(settings: Settings, mode: Literal["desktop", "web"] | None = None) -> SiteInfo:
    m = mode or settings.site_mode
    web = m == "web"
    return SiteInfo(mode=m, site_url=settings.site_url, features=Features(playground=web, speedruns=web, races=web))


class KindInfo(BaseModel):
    kind: str
    lib_id: str
    prefix: str
    description: str
    default_value: str


class Library(BaseModel):
    symbols: dict[str, LibSymbol]
    kinds: list[KindInfo]
    power: dict[str, str]  # net name -> power symbol lib_id


@lru_cache
def part_library() -> Library:
    return Library(
        symbols=library_symbols(),
        kinds=[KindInfo(kind=k.kind, lib_id=k.lib_id, prefix=k.ref_prefix, description=k.description, default_value=k.default_value) for k in COMPONENT_KINDS.values()],
        power=dict(POWER_SYMBOLS),
    )
