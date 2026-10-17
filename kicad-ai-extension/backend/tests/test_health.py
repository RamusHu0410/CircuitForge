from fastapi.testclient import TestClient


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "kicad-ai-schematic-backend"
    assert body["version"]


def test_docs_available(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
