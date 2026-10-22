"""What this server is (the desktop app's local service or the public website), and the shared data the
website's playground and races use: the parts library and the leaderboard. See app/site.py."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.config import Settings, get_settings
from app.race import HUB, LeaderboardEntry
from app.site import Library, SiteInfo, part_library, site_info

router = APIRouter(tags=["site"])


@router.get("/site", response_model=SiteInfo, summary="Desktop app or website, and which features are on")
def site(settings: Annotated[Settings, Depends(get_settings)]) -> SiteInfo:
    return site_info(settings)


@router.get("/library", response_model=Library, summary="Every part and power symbol, with its drawing")
def library() -> Library:
    return part_library()


@router.get("/leaderboard", response_model=list[LeaderboardEntry], summary="Fastest correct finishes of a speed-run challenge")
def leaderboard(challenge: Annotated[str, Query(max_length=40)]) -> list[LeaderboardEntry]:
    return HUB.leaderboard(challenge)
