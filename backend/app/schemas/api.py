"""Request and response models.

Response models never include a credential field. `DatabaseConnectionOut` in
particular is the reason there is no `password` or `connection_string` anywhere
in the API surface.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- errors -----------------------------------------------------------------


class ErrorDetail(BaseModel):
    code: str
    message: str
    request_id: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


# --- auth -------------------------------------------------------------------


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    full_name: str = Field(default="", max_length=200)
    organization_name: str = Field(default="My Organization", max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(ORMModel):
    id: uuid.UUID
    email: str
    full_name: str
    is_active: bool


class WorkspaceOut(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    max_rows: int
    query_timeout_seconds: int


class MembershipOut(BaseModel):
    workspace: WorkspaceOut
    role: str
    permissions: list[str]


# --- databases --------------------------------------------------------------

Engine = Literal["postgres", "supabase", "mysql", "sqlite"]
SSLMode = Literal["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]


class DatabaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    engine: Engine = "postgres"
    environment: Literal["development", "staging", "production"] = "development"
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=5432, ge=1, le=65535)
    database_name: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=512)
    ssl_mode: SSLMode = "require"

    read_only: bool = True
    allowed_schemas: list[str] = Field(default_factory=lambda: ["public"])
    query_timeout_seconds: int = Field(default=30, ge=1, le=300)
    max_rows: int = Field(default=10_000, ge=1, le=1_000_000)
    allow_sample_values: bool = False

    @field_validator("allowed_schemas")
    @classmethod
    def _non_empty(cls, v: list[str]) -> list[str]:
        cleaned = [s.strip() for s in v if s.strip()]
        if not cleaned:
            raise ValueError("At least one schema must be allowed.")
        return cleaned


class DatabaseUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=512)
    read_only: bool | None = None
    allowed_schemas: list[str] | None = None
    query_timeout_seconds: int | None = Field(default=None, ge=1, le=300)
    max_rows: int | None = Field(default=None, ge=1, le=1_000_000)
    allow_sample_values: bool | None = None


class DatabaseConnectionOut(ORMModel):
    """Deliberately excludes every credential field."""

    id: uuid.UUID
    name: str
    engine: str
    environment: str
    host: str
    port: int
    database_name: str
    username: str
    ssl_mode: str
    read_only: bool
    allowed_schemas: list[str]
    query_timeout_seconds: int
    max_rows: int
    status: str
    last_error: str | None
    last_tested_at: datetime | None
    last_synced_at: datetime | None
    schema_version: int
    created_at: datetime


class ConnectionTestOut(BaseModel):
    ok: bool
    message: str
    server_version: str | None = None
    latency_ms: int | None = None
    is_read_only_role: bool | None = None


class SchemaSyncOut(BaseModel):
    tables: int
    columns: int
    schema_changed: bool
    schema_version: int
    synced_at: datetime


# --- chat -------------------------------------------------------------------


class ChatRequestIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    database_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    clarification_answer: str | None = Field(default=None, max_length=2000)
    approve_expensive: bool = False


class ClarificationOptionOut(BaseModel):
    label: str
    value: str
    description: str | None = None


class ClarificationOut(BaseModel):
    question: str | None
    dimension: str | None
    options: list[ClarificationOptionOut]
    allow_free_text: bool


class QueryResultOut(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    duration_ms: int
    truncated: bool


class VisualizationOut(BaseModel):
    type: str
    x: str | None = None
    y: str | None = None
    series: str | None = None
    title: str = ""


class CostOut(BaseModel):
    total_cost: float
    estimated_rows: int
    is_expensive: bool
    has_sequential_scan: bool
    warnings: list[str]
    scanned_relations: list[str]


class ChatResponse(BaseModel):
    conversation_id: uuid.UUID
    query_id: uuid.UUID
    answer: str | None = None
    generated_sql: str | None = None
    executed_sql: str | None = None
    awaiting_clarification: bool = False
    clarification: ClarificationOut | None = None
    awaiting_confirmation: bool = False
    cost: CostOut | None = None
    result: QueryResultOut | None = None
    visualization: VisualizationOut | None = None
    warnings: list[str] = Field(default_factory=list)
    errors: list[dict[str, Any]] = Field(default_factory=list)
    tables_used: list[str] = Field(default_factory=list)


class MessageOut(ORMModel):
    id: uuid.UUID
    role: str
    content: str
    payload: dict[str, Any]
    query_id: uuid.UUID | None
    created_at: datetime


class ConversationOut(ORMModel):
    id: uuid.UUID
    title: str
    database_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class ConversationDetailOut(ConversationOut):
    messages: list[MessageOut]


# --- queries ----------------------------------------------------------------


class QueryOut(ORMModel):
    id: uuid.UUID
    question: str
    generated_sql: str | None
    executed_sql: str | None
    status: str
    error_code: str | None
    error_message: str | None
    row_count: int | None
    duration_ms: int | None
    retry_count: int
    was_blocked: bool
    required_clarification: bool
    tables_used: list[str]
    assumptions: list[str]
    cost_usd: float
    model: str | None
    database_id: uuid.UUID | None
    created_at: datetime


class QueryDetailOut(QueryOut):
    query_plan: dict[str, Any]
    explain_plan: dict[str, Any]
    visualization: dict[str, Any]
    answer: str | None


class SavedQueryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    sql: str = Field(min_length=1)
    database_id: uuid.UUID | None = None
    tags: list[str] = Field(default_factory=list)


class SavedQueryOut(ORMModel):
    id: uuid.UUID
    name: str
    description: str
    sql: str
    tags: list[str]
    database_id: uuid.UUID | None
    run_count: int
    last_run_at: datetime | None
    created_at: datetime


class ValidateSQLRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=100_000)
    database_id: uuid.UUID


class ValidateSQLResponse(BaseModel):
    ok: bool
    safe_sql: str | None
    errors: list[dict[str, str]]
    warnings: list[str]
    tables: list[str]
    join_count: int


# --- glossary ---------------------------------------------------------------


class GlossaryTermIn(BaseModel):
    term: str = Field(min_length=1, max_length=120)
    definition: str = Field(min_length=1, max_length=2000)
    maps_to: str | None = Field(default=None, max_length=255)


class GlossaryTermOut(ORMModel):
    id: uuid.UUID
    term: str
    definition: str
    maps_to: str | None
    created_at: datetime


# --- analytics --------------------------------------------------------------


class AnalyticsSummary(BaseModel):
    queries_today: int
    success_rate: float
    avg_latency_ms: float
    p95_latency_ms: float
    avg_llm_latency_ms: float
    llm_cost_usd: float
    clarification_rate: float
    correction_rate: float
    blocked_count: int
    timeout_count: int
    error_count: int


class TimeSeriesPoint(BaseModel):
    bucket: str
    value: float


class AnalyticsResponse(BaseModel):
    summary: AnalyticsSummary
    query_volume: list[TimeSeriesPoint]
    latency_distribution: list[TimeSeriesPoint]
    status_breakdown: dict[str, int]
    top_tables: list[dict[str, Any]]


# --- health -----------------------------------------------------------------


class HealthOut(BaseModel):
    status: Literal["ok"]
    version: str
    environment: str


class ReadyOut(BaseModel):
    status: Literal["ready", "degraded"]
    checks: dict[str, bool]
