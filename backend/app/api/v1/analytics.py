"""Usage analytics.

Every figure is computed from recorded `queries` rows -- these are measured
values, not targets. Percentiles use PostgreSQL's `percentile_cont` rather
than being approximated in Python over a truncated sample.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Query as QueryParam
from sqlalchemy import Float, case, cast, func, select

from app.api.deps import SessionDep, WorkspaceDep
from app.models.conversation import Query
from app.schemas.api import (
    AnalyticsResponse,
    AnalyticsSummary,
    TimeSeriesPoint,
)
from app.security.rbac import Permission

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["analytics"])


@router.get("/analytics", response_model=AnalyticsResponse)
async def analytics(
    context: WorkspaceDep,
    session: SessionDep,
    days: Annotated[int, QueryParam(ge=1, le=90)] = 7,
) -> AnalyticsResponse:
    context.require(Permission.VIEW_ANALYTICS)

    workspace_id = context.workspace.id
    since = datetime.now(UTC) - timedelta(days=days)
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)

    base = select(Query).where(
        Query.workspace_id == workspace_id, Query.created_at >= since
    ).subquery()

    totals = (
        await session.execute(
            select(
                func.count().label("total"),
                func.count().filter(base.c.status == "success").label("success"),
                func.count().filter(base.c.was_blocked.is_(True)).label("blocked"),
                func.count().filter(base.c.error_code == "QUERY_TIMEOUT").label("timeouts"),
                func.count().filter(base.c.status == "failed").label("failed"),
                func.count()
                .filter(base.c.required_clarification.is_(True))
                .label("clarified"),
                func.count().filter(base.c.retry_count > 0).label("corrected"),
                func.coalesce(func.avg(base.c.duration_ms), 0.0).label("avg_latency"),
                func.coalesce(
                    func.percentile_cont(0.95).within_group(base.c.duration_ms), 0.0
                ).label("p95_latency"),
                func.coalesce(func.avg(base.c.llm_latency_ms), 0.0).label("avg_llm_latency"),
                func.coalesce(func.sum(base.c.cost_usd), 0.0).label("cost"),
            ).select_from(base)
        )
    ).one()

    queries_today = (
        await session.execute(
            select(func.count())
            .select_from(Query)
            .where(Query.workspace_id == workspace_id, Query.created_at >= today)
        )
    ).scalar_one()

    total = int(totals.total or 0)

    def rate(numerator: int | None) -> float:
        return round((int(numerator or 0) / total) * 100, 2) if total else 0.0

    summary = AnalyticsSummary(
        queries_today=int(queries_today or 0),
        success_rate=rate(totals.success),
        avg_latency_ms=round(float(totals.avg_latency or 0.0), 2),
        p95_latency_ms=round(float(totals.p95_latency or 0.0), 2),
        avg_llm_latency_ms=round(float(totals.avg_llm_latency or 0.0), 2),
        llm_cost_usd=round(float(totals.cost or 0.0), 4),
        clarification_rate=rate(totals.clarified),
        correction_rate=rate(totals.corrected),
        blocked_count=int(totals.blocked or 0),
        timeout_count=int(totals.timeouts or 0),
        error_count=int(totals.failed or 0),
    )

    volume_rows = (
        await session.execute(
            select(
                func.date_trunc("day", Query.created_at).label("bucket"),
                func.count().label("value"),
            )
            .where(Query.workspace_id == workspace_id, Query.created_at >= since)
            .group_by("bucket")
            .order_by("bucket")
        )
    ).all()

    # Latency histogram over fixed buckets, so the chart is comparable
    # between workspaces and over time.
    latency_bucket = case(
        (Query.duration_ms < 100, "<100ms"),
        (Query.duration_ms < 500, "100-500ms"),
        (Query.duration_ms < 1000, "500ms-1s"),
        (Query.duration_ms < 5000, "1-5s"),
        else_=">5s",
    ).label("bucket")

    latency_rows = (
        await session.execute(
            select(latency_bucket, func.count().label("value"))
            .where(
                Query.workspace_id == workspace_id,
                Query.created_at >= since,
                Query.duration_ms.isnot(None),
            )
            .group_by("bucket")
        )
    ).all()

    status_rows = (
        await session.execute(
            select(Query.status, func.count().label("value"))
            .where(Query.workspace_id == workspace_id, Query.created_at >= since)
            .group_by(Query.status)
        )
    ).all()

    table_rows = (
        await session.execute(
            select(
                func.unnest(Query.tables_used).label("table_name"),
                func.count().label("value"),
            )
            .where(Query.workspace_id == workspace_id, Query.created_at >= since)
            .group_by("table_name")
            .order_by(func.count().desc())
            .limit(10)
        )
    ).all()

    return AnalyticsResponse(
        summary=summary,
        query_volume=[
            TimeSeriesPoint(bucket=r.bucket.date().isoformat(), value=float(r.value))
            for r in volume_rows
        ],
        latency_distribution=[
            TimeSeriesPoint(bucket=str(r.bucket), value=float(r.value)) for r in latency_rows
        ],
        status_breakdown={str(r.status): int(r.value) for r in status_rows},
        top_tables=[{"table": str(r.table_name), "count": int(r.value)} for r in table_rows],
    )
