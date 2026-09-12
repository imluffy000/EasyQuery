"""OAuth authorization-request and callback-error behaviour.

Covers the two things that are easy to regress silently: Google's account
chooser, and telling a deliberate cancellation apart from a real failure.
Neither path touches the database, so no session is needed.
"""

from __future__ import annotations

import asyncio
from typing import Any, cast
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.api.v1.auth import (
    _AUTHORIZE_PARAMS,
    _OAUTH_CANCELLED,
    _OAUTH_ERROR_CODES,
    oauth_callback,
    oauth_start,
)
from app.config.settings import Settings

FRONTEND = "https://app.example.com"


def make_settings() -> Settings:
    return Settings(  # type: ignore[call-arg]
        database_url="postgresql+asyncpg://u:p@localhost:5432/d",
        redis_url="redis://localhost:6379/0",
        encryption_key="test-encryption-key-at-least-32-chars",
        jwt_secret="test-jwt-secret-at-least-32-characters",
        frontend_url=FRONTEND,
        google_client_id="google-client-id",
        google_client_secret="google-client-secret",
        google_callback_url="https://api.example.com/api/v1/auth/oauth/google/callback",
        github_client_id="github-client-id",
        github_client_secret="github-client-secret",
        github_callback_url="https://api.example.com/api/v1/auth/oauth/github/callback",
    )


def make_request(provider: str, query: str, cookies: dict[str, str] | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if cookies:
        raw = "; ".join(f"{k}={v}" for k, v in cookies.items())
        headers.append((b"cookie", raw.encode()))
    scope: dict[str, Any] = {
        "type": "http",
        "method": "GET",
        "path": f"/api/v1/auth/oauth/{provider}/callback",
        "query_string": query.encode(),
        "headers": headers,
    }
    return Request(scope)


def start(provider: str) -> Any:
    return asyncio.run(oauth_start(provider, make_settings()))


def callback(provider: str, query: str, cookies: dict[str, str] | None = None) -> Any:
    # The error branches return before the session is ever used.
    return asyncio.run(
        oauth_callback(
            provider,
            make_request(provider, query, cookies),
            make_settings(),
            cast(AsyncSession, None),
        )
    )


def authorize_params(response: Any) -> dict[str, list[str]]:
    return parse_qs(urlsplit(response.headers["location"]).query)


# --- the authorization request ----------------------------------------------


def test_google_requests_the_account_chooser() -> None:
    # Without prompt=select_account Google silently reuses whichever account
    # owns the browser session.
    assert authorize_params(start("google"))["prompt"] == ["select_account"]


def test_google_does_not_force_reauthentication() -> None:
    # prompt=login would make the user retype their password every time.
    assert "login" not in authorize_params(start("google")).get("prompt", [])


def test_google_does_not_request_offline_access() -> None:
    # No refresh token is requested, so account selection cannot disturb one.
    assert "access_type" not in authorize_params(start("google"))


def test_github_sends_no_prompt() -> None:
    # GitHub has no such parameter; sending one would be meaningless.
    assert "prompt" not in authorize_params(start("github"))
    assert _AUTHORIZE_PARAMS["github"] == {}


@pytest.mark.parametrize("provider", ["google", "github"])
def test_state_is_issued_and_scoped(provider: str) -> None:
    response = start(provider)
    params = authorize_params(response)
    assert len(params["state"][0]) >= 32
    cookie = response.headers["set-cookie"]
    assert f"oauth_state_{provider}=" in cookie
    assert "HttpOnly" in cookie
    assert f"/api/v1/auth/oauth/{provider}" in cookie


@pytest.mark.parametrize("provider", ["google", "github"])
def test_client_secret_never_reaches_the_browser(provider: str) -> None:
    response = start(provider)
    blob = response.headers["location"] + response.headers.get("set-cookie", "")
    assert f"{provider}-client-secret" not in blob


# --- cancellation vs genuine failure ----------------------------------------


@pytest.mark.parametrize("provider", ["google", "github"])
def test_cancellation_returns_to_the_login_page(provider: str) -> None:
    # Both providers report a declined authorization as access_denied.
    response = callback(provider, f"error={_OAUTH_CANCELLED}&state=whatever")
    location = response.headers["location"]
    assert location.startswith(f"{FRONTEND}/login")
    assert "notice=oauth_cancelled" in location
    # Never the error page.
    assert "/oauth/callback" not in location


def test_github_user_denied_variant_is_still_a_cancellation() -> None:
    # GitHub adds error_reason=user_denied alongside error=access_denied.
    response = callback("github", f"error={_OAUTH_CANCELLED}&error_reason=user_denied&state=x")
    assert response.headers["location"].startswith(f"{FRONTEND}/login")


@pytest.mark.parametrize("provider", ["google", "github"])
def test_cancellation_clears_the_state_cookie(provider: str) -> None:
    response = callback(provider, f"error={_OAUTH_CANCELLED}")
    cookie = response.headers.get("set-cookie", "")
    assert f"oauth_state_{provider}=" in cookie
    assert "Max-Age=0" in cookie or "expires=Thu, 01 Jan 1970" in cookie.lower()


@pytest.mark.parametrize("code", sorted(_OAUTH_ERROR_CODES))
def test_genuine_errors_still_reach_the_error_page(code: str) -> None:
    # A misconfiguration must stay visible instead of looking like a cancel.
    response = callback("google", f"error={code}&state=x")
    location = response.headers["location"]
    assert location.startswith(f"{FRONTEND}/oauth/callback")
    assert f"error={code}" in location
    assert "notice=oauth_cancelled" not in location


def test_unknown_provider_error_is_not_reflected() -> None:
    # Arbitrary provider text must not land in a redirect URL.
    response = callback("google", "error=totally_made_up_thing&state=x")
    location = response.headers["location"]
    assert "error=provider_error" in location
    assert "totally_made_up_thing" not in location


def test_access_denied_is_not_in_the_genuine_error_table() -> None:
    assert _OAUTH_CANCELLED not in _OAUTH_ERROR_CODES


# --- state validation is still enforced -------------------------------------


def test_missing_state_is_rejected() -> None:
    response = callback("google", "code=abc")
    assert "error=invalid_state" in response.headers["location"]


def test_mismatched_state_is_rejected() -> None:
    response = callback(
        "google", "code=abc&state=attacker", cookies={"oauth_state_google": "genuine"}
    )
    assert "error=invalid_state" in response.headers["location"]


def test_state_mismatch_is_not_treated_as_a_cancellation() -> None:
    # The old code collapsed both into one "cancelled_or_invalid_state" branch.
    location = callback("google", "code=abc&state=wrong").headers["location"]
    assert "notice=oauth_cancelled" not in location


# --- no open redirect --------------------------------------------------------


@pytest.mark.parametrize(
    "query",
    [
        f"error={_OAUTH_CANCELLED}&redirect_uri=https://evil.example.com",
        f"error={_OAUTH_CANCELLED}&next=https://evil.example.com",
        f"error={_OAUTH_CANCELLED}&returnUrl=https://evil.example.com",
        "error=server_error&next=https://evil.example.com",
        "code=abc&state=wrong&returnUrl=//evil.example.com",
    ],
)
def test_redirect_target_ignores_request_supplied_destinations(query: str) -> None:
    # Every redirect is built from the configured frontend_url.
    location = callback("google", query).headers["location"]
    assert location.startswith(FRONTEND)
    assert "evil.example.com" not in location
