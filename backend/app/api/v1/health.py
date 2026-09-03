"""Liveness and readiness probes.

/health answers "is the process alive" and must never touch a dependency --
a slow database would otherwise cause the orchestrator to kill healthy pods.
/ready answers "can this instance serve traffic" and does check dependencies.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import text

from app.api.deps import SessionDep, SettingsDep
from app.schemas.api import HealthOut, ReadyOut

router = APIRouter(tags=["health"])

VERSION = "0.1.0"


@router.get("/health", response_model=HealthOut)
async def health(settings: SettingsDep) -> HealthOut:
    return HealthOut(status="ok", version=VERSION, environment=settings.app_env)


@router.get("/ready", response_model=ReadyOut)
async def ready(request: Request, session: SessionDep, response: Response) -> ReadyOut:
    checks: dict[str, bool] = {}

    try:
        await session.execute(text("SELECT 1"))
        checks["postgres"] = True
    except Exception:  # noqa: BLE001 - a probe reports, it does not raise
        checks["postgres"] = False

    redis_client = getattr(request.app.state, "redis", None)
    if redis_client is None:
        checks["redis"] = False
    else:
        try:
            await redis_client.ping()
            checks["redis"] = True
        except Exception:  # noqa: BLE001
            checks["redis"] = False

    checks["llm"] = getattr(request.app.state, "llm", None) is not None

    all_ok = all(checks.values())
    if not all_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadyOut(status="ready" if all_ok else "degraded", checks=checks)
