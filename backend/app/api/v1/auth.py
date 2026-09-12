"""Registration, login, refresh, and identity."""

from __future__ import annotations

import re
import secrets
import uuid
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep, SettingsDep
from app.models.tenancy import (
    Organization,
    OrganizationMember,
    OAuthIdentity,
    User,
    Workspace,
    WorkspaceMember,
)
from app.schemas.api import (
    LoginRequest,
    MembershipOut,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserOut,
    WorkspaceOut,
)
from app.security import audit
from app.security.audit import AuditEvent
from app.security.auth import create_token, decode_token, hash_password, verify_password
from app.security.rbac import Role, permissions_for

router = APIRouter(prefix="/auth", tags=["auth"])

_OAUTH = {
    "google": {
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "profile": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email profile",
    },
    "github": {
        "authorize": "https://github.com/login/oauth/authorize",
        "token": "https://github.com/login/oauth/access_token",
        "profile": "https://api.github.com/user",
        "emails": "https://api.github.com/user/emails",
        "scope": "read:user user:email",
    },
}

# Extra parameters for the authorization request, per provider.
_AUTHORIZE_PARAMS: dict[str, dict[str, str]] = {
    # Without this, Google signs in whichever account already owns the browser
    # session and never shows a chooser. select_account shows the picker; it
    # does not re-prompt for the password (that would be prompt=login), and it
    # does not touch refresh tokens -- this flow never requests offline
    # access, so Google issues none.
    "google": {"prompt": "select_account"},
    # GitHub has no equivalent parameter: it always authorizes the account
    # owning the current github.com session. That stays correct, because the
    # EasyQuery user is resolved from the numeric account id in the verified
    # profile response and never from an existing EasyQuery session.
    "github": {},
}

# RFC 6749 section 4.1.2.1, plus the OpenID Connect interaction codes Google
# can return. Anything outside this set is reported as a generic provider
# error rather than reflected into a redirect URL.
_OAUTH_ERROR_CODES = frozenset(
    {
        "invalid_request",
        "unauthorized_client",
        "unsupported_response_type",
        "invalid_scope",
        "server_error",
        "temporarily_unavailable",
        "interaction_required",
        "login_required",
        "consent_required",
        "account_selection_required",
    }
)

# What both Google and GitHub send when the user presses Cancel or Deny.
# GitHub also adds error_reason=user_denied, which carries no extra meaning.
_OAUTH_CANCELLED = "access_denied"


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (slug or "workspace")[:80]


def _issue(settings: SettingsDep, user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(
            settings=settings, user_id=user.id, email=user.email, token_type="access"
        ),
        refresh_token=create_token(
            settings=settings, user_id=user.id, email=user.email, token_type="refresh"
        ),
        expires_in=settings.access_token_ttl_minutes * 60,
    )


def _apply_bootstrap_admin(settings: SettingsDep, user: User) -> None:
    """Promote only the explicitly configured operator email."""
    if settings.admin_email and user.email.casefold() == settings.admin_email.casefold():
        user.is_superuser = True


def _oauth_config(settings: SettingsDep, provider: str) -> tuple[str, str, str]:
    if provider not in _OAUTH:
        raise HTTPException(status_code=404, detail={"code": "OAUTH_PROVIDER_NOT_FOUND", "message": "Provider not found."})
    client_id = getattr(settings, f"{provider}_client_id")
    secret = getattr(settings, f"{provider}_client_secret")
    callback = getattr(settings, f"{provider}_callback_url")
    if not client_id or not secret or not callback:
        raise HTTPException(status_code=503, detail={"code": "OAUTH_NOT_CONFIGURED", "message": f"{provider.title()} sign-in is not configured."})
    return client_id, secret, callback


def _clear_oauth_state(response: RedirectResponse, settings: SettingsDep, provider: str) -> None:
    """Drop the single-use CSRF cookie once its authorization round trip ends."""
    response.delete_cookie(
        f"oauth_state_{provider}", path=f"{settings.api_v1_prefix}/auth/oauth/{provider}"
    )


def _oauth_error(settings: SettingsDep, provider: str, code: str) -> RedirectResponse:
    response = RedirectResponse(
        f"{settings.frontend_url.rstrip('/')}/oauth/callback?{urlencode({'error': code})}"
    )
    _clear_oauth_state(response, settings, provider)
    return response


def _oauth_cancelled(settings: SettingsDep, provider: str) -> RedirectResponse:
    """Return a deliberate cancellation to the sign-in page, not the error page.

    Cancelling is a normal choice rather than a failure: no user is created,
    no token pair is issued, and the only state to undo is the CSRF cookie.
    The destination is always built from the configured frontend_url, never
    from a request parameter, so this cannot become an open redirect.
    """
    response = RedirectResponse(
        f"{settings.frontend_url.rstrip('/')}/login?{urlencode({'notice': 'oauth_cancelled'})}"
    )
    _clear_oauth_state(response, settings, provider)
    return response


@router.get("/oauth/{provider}/start")
async def oauth_start(provider: str, settings: SettingsDep) -> RedirectResponse:
    try:
        client_id, _secret, callback = _oauth_config(settings, provider)
    except HTTPException:
        return _oauth_error(settings, provider, "not_configured")
    state = secrets.token_urlsafe(32)
    query = {
        "client_id": client_id,
        "redirect_uri": callback,
        "response_type": "code",
        "scope": _OAUTH[provider]["scope"],
        "state": state,
        **_AUTHORIZE_PARAMS.get(provider, {}),
    }
    response = RedirectResponse(f"{_OAUTH[provider]['authorize']}?{urlencode(query)}")
    response.set_cookie(f"oauth_state_{provider}", state, max_age=600, httponly=True, secure=settings.is_production, samesite="lax", path=f"{settings.api_v1_prefix}/auth/oauth/{provider}")
    return response


@router.get("/oauth/{provider}/callback")
async def oauth_callback(provider: str, request: Request, settings: SettingsDep, session: SessionDep) -> RedirectResponse:
    try:
        client_id, client_secret, callback = _oauth_config(settings, provider)
    except HTTPException:
        return _oauth_error(settings, provider, "not_configured")

    # A provider error arrives in place of a code, so it is resolved before the
    # state check: there is nothing to exchange either way, and a cancellation
    # must not be reported as a failure. Genuine errors keep reaching the error
    # page so a misconfiguration stays visible instead of looking like a
    # user-initiated cancel.
    provider_error = request.query_params.get("error")
    if provider_error:
        if provider_error == _OAUTH_CANCELLED:
            return _oauth_cancelled(settings, provider)
        known = provider_error in _OAUTH_ERROR_CODES
        return _oauth_error(settings, provider, provider_error if known else "provider_error")

    state = request.query_params.get("state")
    if not state or not secrets.compare_digest(
        state, request.cookies.get(f"oauth_state_{provider}", "")
    ):
        return _oauth_error(settings, provider, "invalid_state")
    code = request.query_params.get("code")
    if not code:
        return _oauth_error(settings, provider, "missing_code")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            token_response = await client.post(_OAUTH[provider]["token"], data={"client_id": client_id, "client_secret": client_secret, "code": code, "redirect_uri": callback, "grant_type": "authorization_code"}, headers={"Accept": "application/json"})
            token_response.raise_for_status()
            access_token = token_response.json().get("access_token")
            if not access_token:
                raise ValueError("provider did not return an access token")
            headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
            profile_response = await client.get(_OAUTH[provider]["profile"], headers=headers)
            profile_response.raise_for_status()
            profile = profile_response.json()
            if provider == "google":
                subject, email, name = str(profile["sub"]), str(profile["email"]).lower(), str(profile.get("name", ""))
                if not profile.get("email_verified"):
                    raise ValueError("email is not verified")
            else:
                emails = await client.get(_OAUTH[provider]["emails"], headers=headers)
                emails.raise_for_status()
                primary = next((item for item in emails.json() if item.get("primary") and item.get("verified")), None)
                if not primary:
                    raise ValueError("no verified primary email")
                subject, email, name = str(profile["id"]), str(primary["email"]).lower(), str(profile.get("name") or profile.get("login") or "")
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        return _oauth_error(settings, provider, "provider_error")

    identity = (await session.execute(select(OAuthIdentity).where(OAuthIdentity.provider == provider, OAuthIdentity.provider_subject == subject))).scalar_one_or_none()
    if identity is not None:
        user = (await session.execute(select(User).where(User.id == identity.user_id))).scalar_one()
    else:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            user = User(email=email, full_name=name, hashed_password=hash_password(secrets.token_urlsafe(48)))
            session.add(user)
            await session.flush()
            organization = Organization(name="My Organization", slug=f"workspace-{uuid.uuid4().hex[:6]}")
            session.add(organization)
            await session.flush()
            session.add(OrganizationMember(organization_id=organization.id, user_id=user.id, role=Role.OWNER.value))
            workspace = Workspace(organization_id=organization.id, name="Default", slug="default")
            session.add(workspace)
            await session.flush()
            session.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=Role.OWNER.value))
        session.add(OAuthIdentity(user_id=user.id, provider=provider, provider_subject=subject))
    if not user.is_active:
        return _oauth_error(settings, provider, "account_disabled")
    _apply_bootstrap_admin(settings, user)
    pair = _issue(settings, user)
    fragment = urlencode({"access_token": pair.access_token, "refresh_token": pair.refresh_token})
    response = RedirectResponse(f"{settings.frontend_url.rstrip('/')}/oauth/callback#{fragment}")
    _clear_oauth_state(response, settings, provider)
    return response


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest, session: SessionDep, settings: SettingsDep
) -> TokenPair:
    existing = (
        await session.execute(select(User).where(User.email == payload.email.lower()))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "EMAIL_TAKEN", "message": "An account with this email exists."},
        )

    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
    )
    _apply_bootstrap_admin(settings, user)
    session.add(user)
    await session.flush()

    # A new account gets an organization and a default workspace, so the first
    # database connection has somewhere to live.
    org_slug = f"{_slugify(payload.organization_name)}-{uuid.uuid4().hex[:6]}"
    organization = Organization(name=payload.organization_name, slug=org_slug)
    session.add(organization)
    await session.flush()

    session.add(
        OrganizationMember(organization_id=organization.id, user_id=user.id, role=Role.OWNER.value)
    )
    workspace = Workspace(organization_id=organization.id, name="Default", slug="default")
    session.add(workspace)
    await session.flush()
    session.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=Role.OWNER.value))

    await audit.record(
        session, event=AuditEvent.USER_LOGGED_IN, user_id=user.id, workspace_id=workspace.id
    )
    return _issue(settings, user)


@router.post("/login", response_model=TokenPair)
async def login(
    payload: LoginRequest, request: Request, session: SessionDep, settings: SettingsDep
) -> TokenPair:
    user = (
        await session.execute(select(User).where(User.email == payload.email.lower()))
    ).scalar_one_or_none()

    # Same error and roughly the same work whether the account exists or not,
    # so the response does not reveal which emails are registered.
    if user is None or not verify_password(payload.password, user.hashed_password):
        if user is not None:
            await audit.record(
                session,
                event=AuditEvent.USER_LOGIN_FAILED,
                user_id=user.id,
                ip_address=request.client.host if request.client else None,
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_CREDENTIALS", "message": "Incorrect email or password."},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ACCOUNT_DISABLED", "message": "This account is disabled."},
        )

    _apply_bootstrap_admin(settings, user)

    await audit.record(
        session,
        event=AuditEvent.USER_LOGGED_IN,
        user_id=user.id,
        ip_address=request.client.host if request.client else None,
    )
    return _issue(settings, user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, session: SessionDep, settings: SettingsDep) -> TokenPair:
    claims = decode_token(settings=settings, token=payload.refresh_token, expected_type="refresh")
    if claims is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_TOKEN", "message": "Refresh token is invalid or expired."},
        )

    user = (
        await session.execute(select(User).where(User.id == claims.user_id))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_TOKEN", "message": "Refresh token is invalid or expired."},
        )
    return _issue(settings, user)


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.get("/memberships", response_model=list[MembershipOut])
async def memberships(user: CurrentUser, session: SessionDep) -> list[MembershipOut]:
    rows = (
        await session.execute(
            select(Workspace, WorkspaceMember)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(WorkspaceMember.user_id == user.id)
            .order_by(Workspace.created_at)
        )
    ).all()

    return [
        MembershipOut(
            workspace=WorkspaceOut.model_validate(workspace),
            role=membership.role,
            permissions=sorted(p.value for p in permissions_for(membership.role)),
        )
        for workspace, membership in rows
    ]
