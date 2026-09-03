"""Authentication: password hashing and JWT issue/verify."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config.settings import Settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd_context.verify(plain, hashed)
    except ValueError:
        # Malformed stored hash -- treat as a failed login, never as success.
        return False


@dataclass(frozen=True)
class TokenPayload:
    """Claims we rely on. Anything else in the token is ignored."""

    user_id: uuid.UUID
    email: str
    token_type: TokenType
    jti: str
    expires_at: datetime


def create_token(
    *,
    settings: Settings,
    user_id: uuid.UUID,
    email: str,
    token_type: TokenType = "access",
) -> str:
    now = datetime.now(UTC)
    ttl = (
        timedelta(minutes=settings.access_token_ttl_minutes)
        if token_type == "access"
        else timedelta(days=settings.refresh_token_ttl_days)
    )
    claims: dict[str, Any] = {
        "sub": str(user_id),
        "email": email,
        "type": token_type,
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(
    *, settings: Settings, token: str, expected_type: TokenType = "access"
) -> TokenPayload | None:
    """Return the payload, or None if the token is invalid in any way.

    Returning None rather than raising keeps callers from accidentally
    distinguishing 'expired' from 'forged' in a user-visible message.
    """
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None

    if claims.get("type") != expected_type:
        return None

    try:
        user_id = uuid.UUID(str(claims["sub"]))
        expires_at = datetime.fromtimestamp(int(claims["exp"]), tz=UTC)
    except (KeyError, ValueError, TypeError):
        return None

    return TokenPayload(
        user_id=user_id,
        email=str(claims.get("email", "")),
        token_type=expected_type,
        jti=str(claims.get("jti", "")),
        expires_at=expires_at,
    )
