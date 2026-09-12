"""FastAPI application entrypoint."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.agents.llm import build_provider
from app.api.v1 import admin, analytics, auth, chat, databases, health, queries
from app.config.settings import get_settings
from app.database.manager import ConnectionManager
from app.database.session import dispose_engine, init_engine
from app.middleware.core import (
    RateLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from app.observability.logging import configure_logging
from app.security.encryption import SecretBox

log = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(level=settings.log_level, json_output=settings.is_production)

    init_engine(settings)
    app.state.settings = settings
    app.state.secret_box = SecretBox.from_key(settings.encryption_key)
    app.state.connection_manager = ConnectionManager(app.state.secret_box)

    try:
        app.state.llm = build_provider(
            provider=settings.llm_provider,
            model=settings.llm_model,
            api_key=settings.llm_api_key,
            timeout_seconds=settings.llm_timeout_seconds,
            max_tokens=settings.llm_max_output_tokens,
        )
    except ValueError as exc:
        # Misconfiguration should be loud in production and survivable in dev.
        if settings.is_production:
            raise
        log.error("llm_provider_unavailable", error=str(exc))
        app.state.llm = build_provider(provider="echo", model="echo", api_key=None)

    try:
        app.state.redis = aioredis.from_url(
            str(settings.redis_url), encoding="utf-8", decode_responses=True
        )
        await app.state.redis.ping()
    except Exception as exc:  # noqa: BLE001 - degraded, not fatal
        log.warning("redis_unavailable", error=str(exc))
        app.state.redis = None

    log.info(
        "application_started",
        environment=settings.app_env,
        llm_provider=settings.llm_provider,
        llm_model=settings.llm_model,
    )

    try:
        yield
    finally:
        await app.state.connection_manager.close_all()
        if getattr(app.state, "redis", None) is not None:
            await app.state.redis.aclose()
        await dispose_engine()
        log.info("application_stopped")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
        # No interactive docs in production -- they enumerate the whole surface.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    # Order matters: security headers outermost, then request context (so the
    # request id exists for everything inside), then the rate limiter.
    app.add_middleware(SecurityHeadersMiddleware, enable_hsts=settings.is_production)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(RateLimitMiddleware, requests_per_minute=settings.rate_limit_per_minute)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    prefix = settings.api_v1_prefix
    app.include_router(health.router, prefix=prefix)
    app.include_router(auth.router, prefix=prefix)
    app.include_router(admin.router, prefix=prefix)
    app.include_router(databases.router, prefix=prefix)
    app.include_router(chat.router, prefix=prefix)
    app.include_router(queries.router, prefix=prefix)
    app.include_router(analytics.router, prefix=prefix)

    _install_exception_handlers(app)

    @app.get("/metrics", include_in_schema=False)
    async def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app


def _install_exception_handlers(app: FastAPI) -> None:
    """Every error leaves as the same structured shape (spec section 43)."""

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict) and "code" in detail:
            code = str(detail.get("code"))
            message = str(detail.get("message", ""))
        else:
            code = _default_code(exc.status_code)
            message = str(detail)

        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": code,
                    "message": message,
                    "request_id": getattr(request.state, "request_id", None),
                }
            },
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        location = ".".join(str(p) for p in first.get("loc", [])[1:])
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": (
                        f"{location}: {first.get('msg', 'Invalid request.')}"
                        if location
                        else str(first.get("msg", "Invalid request."))
                    ),
                    "request_id": getattr(request.state, "request_id", None),
                }
            },
        )

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        # A stack trace goes to the log, never to the client.
        log.exception("unhandled_exception", error=str(exc))
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "An unexpected error occurred.",
                    "request_id": getattr(request.state, "request_id", None),
                }
            },
        )


def _default_code(status_code: int) -> str:
    return {
        400: "BAD_REQUEST",
        401: "UNAUTHENTICATED",
        403: "PERMISSION_DENIED",
        404: "NOT_FOUND",
        409: "CONFLICT",
        429: "RATE_LIMITED",
        502: "UPSTREAM_ERROR",
        503: "SERVICE_UNAVAILABLE",
    }.get(status_code, "ERROR")


app = create_app()
