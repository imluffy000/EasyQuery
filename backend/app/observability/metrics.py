"""Prometheus metrics (spec section 32)."""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

# --- HTTP -------------------------------------------------------------------

http_request_duration = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration",
    labelnames=("method", "path", "status"),
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

# --- LLM --------------------------------------------------------------------

llm_latency = Histogram(
    "llm_latency_seconds",
    "Model call latency",
    labelnames=("provider", "model", "stage"),
    buckets=(0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0),
)
llm_tokens = Counter("llm_tokens_total", "Tokens consumed", labelnames=("model", "direction"))
llm_cost = Counter("llm_cost_usd_total", "Estimated model spend", labelnames=("model",))

# --- Pipeline ---------------------------------------------------------------

schema_retrieval_latency = Histogram(
    "schema_retrieval_latency_seconds",
    "Schema retrieval latency",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0),
)
sql_generation_latency = Histogram(
    "sql_generation_latency_seconds",
    "SQL generation latency",
    buckets=(0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0),
)
sql_validation_failures = Counter(
    "sql_validation_failures_total",
    "SQL rejected by the guard",
    labelnames=("code",),
)
sql_retry_count = Counter("sql_retry_total", "SQL regeneration attempts")
clarification_requests = Counter(
    "clarification_requests_total", "Questions the agent asked", labelnames=("dimension",)
)

# --- Query execution --------------------------------------------------------

query_execution_latency = Histogram(
    "query_execution_latency_seconds",
    "User-database query latency",
    labelnames=("engine",),
    buckets=(0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0, 30.0),
)
query_timeouts = Counter("query_timeouts_total", "Queries stopped by the timeout")
query_errors = Counter("query_errors_total", "Query failures", labelnames=("code",))
query_rows_returned = Histogram(
    "query_rows_returned",
    "Rows returned per query",
    buckets=(0, 1, 10, 100, 1000, 10_000, 100_000),
)
expensive_queries_blocked = Counter(
    "expensive_queries_blocked_total", "Queries held for user confirmation"
)

# --- Connections ------------------------------------------------------------

active_connectors = Gauge("active_database_connectors", "Pooled connectors currently open")
