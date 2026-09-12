"""Every error leaves the API as the same structured envelope.

The client parses `body.error`, so a response that answers with anything else
loses its code and its request id and degrades to "Request failed (404)".
Routing failures used to do exactly that, because the handler was registered
against FastAPI's HTTPException subclass while Starlette raises the parent.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from app.main import app

# A routable client address: the audit log's ip_address column is INET and
# TestClient's default literal "testclient" host is not a valid value.
CLIENT = ("203.0.113.7", 44321)


@pytest.fixture(scope="module")
def client() -> TestClient:
    with TestClient(app, client=CLIENT) as c:
        yield c


def envelope(response: object) -> dict[str, object]:
    body = response.json()  # type: ignore[attr-defined]
    assert set(body) == {"error"}, f"unexpected top-level keys: {sorted(body)}"
    error = body["error"]
    assert set(error) >= {"code", "message", "request_id"}
    return error


@pytest.mark.parametrize(
    ("method", "path", "status", "code"),
    [
        ("GET", "/api/v1/does-not-exist", 404, "NOT_FOUND"),
        ("GET", "/nope", 404, "NOT_FOUND"),
        ("DELETE", "/api/v1/health", 405, "METHOD_NOT_ALLOWED"),
        ("GET", "/api/v1/auth/me", 401, "UNAUTHENTICATED"),
    ],
)
def test_error_envelope(
    client: TestClient, method: str, path: str, status: int, code: str
) -> None:
    response = client.request(method, path)
    assert response.status_code == status
    error = envelope(response)
    assert error["code"] == code
    assert error["message"]
    assert error["request_id"], "a request id is what ties a report to a log line"


def test_validation_error_names_the_field(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"email": "not-an-email"})
    assert response.status_code == 422
    error = envelope(response)
    assert error["code"] == "VALIDATION_ERROR"
    assert "email" in str(error["message"])


def test_unknown_route_does_not_use_fastapis_detail_shape(client: TestClient) -> None:
    # The specific regression: {"detail": "Not Found"} instead of the envelope.
    assert "detail" not in client.get("/api/v1/does-not-exist").json()


@pytest.mark.parametrize("path", ["/api/v1/does-not-exist", "/api/v1/auth/me"])
def test_errors_leak_no_internals(client: TestClient, path: str) -> None:
    body = client.get(path).text.lower()
    for leak in ("traceback", "file \"", "site-packages", "sqlalchemy", "asyncpg"):
        assert leak not in body, f"{leak!r} surfaced to the client"
