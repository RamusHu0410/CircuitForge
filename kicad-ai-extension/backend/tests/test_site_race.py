"""Desktop vs website mode, the parts library, the generation rate limit, and live races."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app import race as race_module
from app.api.routes import race as race_route
from app.config import Settings, get_settings
from app.core.component_registry import COMPONENT_KINDS, POWER_SYMBOLS
from app.main import create_app
from app.ratelimit import RateLimiter

ORIGIN = "http://127.0.0.1:8765"


def make_client(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> TestClient:
    settings = Settings(erc_enabled=False, **overrides)  # type: ignore[arg-type]
    monkeypatch.setattr(main_module, "get_settings", lambda: settings)
    monkeypatch.setattr(race_route, "get_settings", lambda: settings)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


@pytest.fixture
def web(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(race_module, "COUNTDOWN_S", 0.05)
    race_module.HUB.rooms.clear()  # one shared hub: start each test with it empty
    race_module.HUB.board.clear()
    with make_client(monkeypatch, site_mode="web", generate_per_minute=3) as client:
        yield client


def test_desktop_mode_has_no_website_features(monkeypatch: pytest.MonkeyPatch) -> None:
    client = make_client(monkeypatch)
    site = client.get("/api/site").json()
    assert site["mode"] == "desktop"
    assert site["features"] == {"playground": False, "speedruns": False, "races": False}
    assert client.get("/api/desktop/info").status_code == 200


def test_website_turns_off_what_touches_the_visitors_computer(web: TestClient) -> None:
    site = web.get("/api/site").json()
    assert site["mode"] == "web" and all(site["features"].values())
    assert web.get("/api/desktop/info").status_code == 404
    assert web.post("/api/desktop/save", json={}).status_code in (404, 405)


def test_library_has_every_part_and_power_symbol(web: TestClient) -> None:
    lib = web.get("/api/library").json()
    assert {k["kind"] for k in lib["kinds"]} == set(COMPONENT_KINDS)
    for k in lib["kinds"]:
        symbol = lib["symbols"][k["lib_id"]]
        assert symbol["pins"], k["kind"]
    for net, lib_id in POWER_SYMBOLS.items():
        assert lib["power"][net] == lib_id and lib_id in lib["symbols"]


def test_generation_is_rate_limited_on_the_website(web: TestClient) -> None:
    codes = [web.post("/api/generate", json={"prompt": "red LED on 5V at 10mA"}, headers={"origin": ORIGIN}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


def test_rate_limiter_window() -> None:
    limiter = RateLimiter(2, 10.0)
    assert limiter.allow("a", 0) and limiter.allow("a", 1)
    assert not limiter.allow("a", 2)
    assert limiter.allow("b", 2)
    assert limiter.allow("a", 10.5)


def recv_until(ws, kind: str, pred=lambda m: True, limit: int = 30) -> dict:  # type: ignore[no-untyped-def]
    for _ in range(limit):
        msg = ws.receive_json()
        if msg.get("type") == kind and pred(msg):
            return msg
    raise AssertionError(f"no {kind} message")


def test_two_players_race_and_the_winner_goes_on_the_leaderboard(web: TestClient) -> None:
    with web.websocket_connect("/api/race/ws?name=Ada", headers={"origin": ORIGIN}) as a, web.websocket_connect("/api/race/ws?name=Linus", headers={"origin": ORIGIN}) as b:
        assert recv_until(a, "hello")["id"]
        recv_until(b, "hello")
        a.send_json({"type": "create", "challenge": "first-light"})
        room = recv_until(a, "room")["room"]
        assert room["challenge"] == "first-light" and len(room["code"]) == 5
        b.send_json({"type": "join", "code": room["code"].lower()})
        recv_until(a, "room", lambda m: len(m["room"]["players"]) == 2)
        a.send_json({"type": "ready", "ready": True})
        b.send_json({"type": "ready", "ready": True})
        recv_until(a, "room", lambda m: m["room"]["state"] == "racing")
        recv_until(b, "room", lambda m: m["room"]["state"] == "racing")
        b.send_json({"type": "submit", "ok": False})
        b.send_json({"type": "submit", "ok": True, "score": 87})
        recv_until(a, "room", lambda m: any(p["finished_ms"] is not None for p in m["room"]["players"]))
        a.send_json({"type": "submit", "ok": True, "score": 95})
        done = recv_until(a, "room", lambda m: m["room"]["state"] == "done")["room"]
    finished = sorted(done["players"], key=lambda p: p["finished_ms"])
    assert [p["name"] for p in finished] == ["Linus", "Ada"]
    assert finished[0]["attempts"] == 2 and finished[0]["score"] == 87
    board = web.get("/api/leaderboard", params={"challenge": "first-light"}).json()
    assert [e["name"] for e in board] == ["Linus", "Ada"]


def test_quick_match_puts_players_in_the_same_room(web: TestClient) -> None:
    with web.websocket_connect("/api/race/ws?name=a", headers={"origin": ORIGIN}) as a, web.websocket_connect("/api/race/ws?name=b", headers={"origin": ORIGIN}) as b:
        a.send_json({"type": "quick"})
        code = recv_until(a, "room")["room"]["code"]
        b.send_json({"type": "quick"})
        room = recv_until(b, "room")["room"]
        assert room["code"] == code and room["public"] and len(room["players"]) == 2
        assert room["challenge"] in race_module.CHALLENGES


def test_only_the_host_starts_and_a_race_needs_two(web: TestClient) -> None:
    with web.websocket_connect("/api/race/ws?name=solo", headers={"origin": ORIGIN}) as a:
        a.send_json({"type": "create", "challenge": "divider"})
        recv_until(a, "room")
        a.send_json({"type": "start"})
        assert "two players" in recv_until(a, "error")["message"]


def test_other_websites_cannot_connect(web: TestClient) -> None:
    with pytest.raises(Exception):
        with web.websocket_connect("/api/race/ws", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()


def test_names_are_cleaned_and_bad_messages_ignored(web: TestClient) -> None:
    with web.websocket_connect("/api/race/ws?name=<b>" + "x" * 50, headers={"origin": ORIGIN}) as a:
        recv_until(a, "hello")
        a.send_text("not json")
        a.send_text("{" * 5000)
        a.send_json({"type": "create", "challenge": "no-such-challenge"})
        room = recv_until(a, "room")["room"]
        assert room["challenge"] == "first-light"
        name = room["players"][0]["name"]
        assert "<" not in name and len(name) <= 20
