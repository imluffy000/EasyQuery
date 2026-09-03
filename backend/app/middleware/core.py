"""Request-scoped middleware: request id, access logging, metrics, security
headers, and Redis-backed rate limiting.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable

import structlog
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.observability.metrics import http_request_duration

log = structlog.get_logger(__name__)

Handler = Callable[[Request], Awaitable[Response]]


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach a request id, bind logging context, time the request."""

    async def dispatch(self, request: Request, call_next: Handler) -> Response:
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        request.state.request_id = request_id

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration = time.perf_counter() - started
            log.exception("request_failed", duration_ms=round(duration * 1000, 2))
            raise

        duration = time.perf_counter() - started
        response.headers["X-Request-ID"] = request_id

        # Label by route template, not the raw path: a per-id label would
        # create unbounded cardinality in Prometheus.
        route = request.scope.get("route")
        path_label = getattr(route, "path", request.url.path)
        http_request_duration.labels(
            method=request.method, path=path_label, status=str(response.status_code)
        ).observe(duration)

        log.info(
            "request_completed",
            status=response.status_code,
            duration_ms=round(duration * 1000, 2),
        )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Baseline security headers (spec section 69)."""

    def __init__(self, app: object, *, enable_hsts: bool = False) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.enable_hsts = enable_hsts

    async def dispatch(self, request: Request, call_next: Handler) -> Response:
        response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        # The API serves JSON only; nothing should ever be framed or scripted
        # from this origin.
        headers.setdefault(
            "Content-Security-Policy",
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        )
        if self.enable_hsts:
            headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Fixed-window rate limiting backed by Redis.

    Keyed by authenticated user where possible, falling back to client IP.
    If Redis is unavailable the request is allowed: an outage in the limiter
    must not take down the API, and the guard/timeout layers still bound cost.
    """

    #  Paths where abuse is expensive or security-relevant.
    LIMITED_PREFIXES = (
        "/api/v1/workspaces",
        "/api/v1/auth/login",
        "/api/v1/auth/register",
    )

    def __init__(self, app: object, *, requests_per_minute: int = 30) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.limit = requests_per_minute

    def _should_limit(self, path: str) -> bool:
        return any(path.startswith(prefix) for prefix in self.LIMITED_PREFIXES)

    async def dispatch(self, request: Request, call_next: Handler) -> Response:
        if not self._should_limit(request.url.path):
            return await call_next(request)

        redis = getattr(request.app.state, "redis", None)
        if redis is None:
            return await call_next(request)

        auth = request.headers.get("authorization", "")
        client_host = request.client.host if request.client else "unknown"
        # Hash the token so a credential never becomes a Redis key.
        identity = (
            f"t:{hash(auth) & 0xFFFFFFFF:x}" if auth else f"ip:{client_host}"
        )
        window = int(time.time() // 60)
        key = f"ratelimit:{identity}:{window}"

        try:
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, 90)
        except Exception as exc:  # noqa: BLE001 - fail open, but say so
            log.warning("rate_limit_unavailable", error=str(exc))
            return await call_next(request)

        if count > self.limit:
            retry_after = 60 - int(time.time() % 60)
            log.info("rate_limited", identity=identity, count=count)
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": "RATE_LIMITED",
                        "message": (
                            f"Too many requests. The limit is {self.limit} per minute."
                        ),
                        "request_id": getattr(request.state, "request_id", None),
                    }
                },
                headers={"Retry-After": str(retry_after)},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, self.limit - count))
        return response
