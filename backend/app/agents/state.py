"""Agent state and the structured contracts between nodes.

The pipeline never passes free-form model prose between steps. Each node emits
a validated Pydantic object, which is what makes the graph debuggable and lets
us branch on decisions safely (spec sections 76-77).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal, TypedDict

from pydantic import BaseModel, Field


# --- structured node outputs ------------------------------------------------


class Intent(StrEnum):
    AGGREGATE = "aggregate"
    LOOKUP = "lookup"
    TREND = "trend"
    COMPARISON = "comparison"
    RANKING = "ranking"
    DISTRIBUTION = "distribution"
    SCHEMA_QUESTION = "schema_question"
    UNSUPPORTED = "unsupported"


class AmbiguityDimension(StrEnum):
    """What was unclear. Drives the wording of the clarification prompt."""

    METRIC = "metric"
    ENTITY = "entity"
    TIME_PERIOD = "time_period"
    FILTER = "filter"
    AGGREGATION = "aggregation"
    JOIN_PATH = "join_path"
    BUSINESS_TERM = "business_term"
    COMPARISON_PERIOD = "comparison_period"
    SORTING = "sorting"
    SCOPE = "scope"


class IntentResult(BaseModel):
    intent: Intent = Intent.AGGREGATE
    entities: list[str] = Field(default_factory=list)
    reasoning_summary: str = ""


class ClarificationOption(BaseModel):
    label: str
    value: str
    description: str | None = None


class AmbiguityResult(BaseModel):
    """Whether we must ask before querying.

    `is_ambiguous` is only honoured when the question cannot be resolved from
    schema plus conversation context -- see `AmbiguityNode`.
    """

    is_ambiguous: bool = False
    dimension: AmbiguityDimension | None = None
    question: str | None = None
    options: list[ClarificationOption] = Field(default_factory=list)
    allow_free_text: bool = True


class Filter(BaseModel):
    field: str
    operator: str
    value: Any = None


class TimeRange(BaseModel):
    field: str | None = None
    preset: str | None = None  # this_month, last_30_days, this_year, ...
    start: str | None = None
    end: str | None = None


class QueryPlan(BaseModel):
    """Intermediate representation between language and SQL.

    Generating this first, then SQL from it, is measurably more reliable than
    free-form text-to-SQL, and it gives us something to validate the SQL
    against afterwards.
    """

    intent: Intent = Intent.AGGREGATE
    metrics: list[str] = Field(default_factory=list)
    dimensions: list[str] = Field(default_factory=list)
    filters: list[Filter] = Field(default_factory=list)
    time_range: TimeRange | None = None
    tables: list[str] = Field(default_factory=list)
    joins: list[str] = Field(default_factory=list)
    sort: str | None = None
    limit: int | None = None
    assumptions: list[str] = Field(default_factory=list)


class SQLResult(BaseModel):
    sql: str
    tables_used: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    needs_clarification: bool = False


class VisualizationSpec(BaseModel):
    """Declarative chart description.

    The model chooses a chart *type* from a closed set; it never emits code or
    markup that the frontend would evaluate.
    """

    type: Literal["table", "kpi", "line", "bar", "area", "pie", "histogram", "scatter"] = "table"
    x: str | None = None
    y: str | None = None
    series: str | None = None
    title: str = ""
    reason: str = ""


class ResultSummary(BaseModel):
    row_count: int = 0
    column_count: int = 0
    is_empty: bool = True
    numeric_columns: list[str] = Field(default_factory=list)
    temporal_columns: list[str] = Field(default_factory=list)
    categorical_columns: list[str] = Field(default_factory=list)
    statistics: dict[str, dict[str, float]] = Field(default_factory=dict)
    sample_rows: list[dict[str, Any]] = Field(default_factory=list)


# --- execution artefacts ----------------------------------------------------


class CostAssessment(BaseModel):
    total_cost: float = 0.0
    estimated_rows: int = 0
    is_expensive: bool = False
    has_sequential_scan: bool = False
    warnings: list[str] = Field(default_factory=list)
    scanned_relations: list[str] = Field(default_factory=list)


class AgentError(BaseModel):
    stage: str
    code: str
    message: str
    recoverable: bool = False


class StreamEvent(StrEnum):
    """Operational states surfaced to the UI.

    These are *status*, not chain-of-thought: they say which step is running,
    never what the model is thinking (spec sections 12 and 42).
    """

    CONNECTED = "connected"
    UNDERSTANDING_QUESTION = "understanding_question"
    RETRIEVING_SCHEMA = "retrieving_schema"
    CLARIFICATION_REQUIRED = "clarification_required"
    PLANNING_QUERY = "planning_query"
    GENERATING_SQL = "generating_sql"
    VALIDATING_SQL = "validating_sql"
    CHECKING_COST = "checking_cost"
    CONFIRMATION_REQUIRED = "confirmation_required"
    EXECUTING_QUERY = "executing_query"
    ANALYZING_RESULTS = "analyzing_results"
    COMPLETE = "complete"
    ERROR = "error"


def _last_write(_current: Any, new: Any) -> Any:
    """Reducer: later writes replace earlier ones."""
    return new


def _append(current: list[Any] | None, new: list[Any] | None) -> list[Any]:
    return (current or []) + (new or [])


class AgentState(TypedDict, total=False):
    """State threaded through the LangGraph pipeline."""

    # --- input ---
    user_question: str
    database_id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    conversation_id: uuid.UUID
    schema_name: str
    dialect: str

    # --- context ---
    conversation_summary: str
    recent_turns: list[dict[str, str]]
    glossary: dict[str, str]
    relevant_schema: str
    retrieved_tables: list[str]

    # --- decisions ---
    detected_intent: IntentResult
    ambiguity: AmbiguityResult
    clarification_answer: str | None
    awaiting_clarification: bool

    query_plan: QueryPlan
    generated_sql: str
    validated_sql: str
    guard_warnings: Annotated[list[str], _append]
    cost_assessment: CostAssessment
    awaiting_confirmation: bool
    user_approved_expensive: bool

    # --- results ---
    execution_result: dict[str, Any]
    result_summary: ResultSummary
    visualization: VisualizationSpec
    final_answer: str

    # --- bookkeeping ---
    errors: Annotated[list[AgentError], _append]
    retry_count: int
    step_count: int
    query_id: uuid.UUID
    started_at: datetime
    total_input_tokens: Annotated[int, lambda a, b: (a or 0) + (b or 0)]
    total_output_tokens: Annotated[int, lambda a, b: (a or 0) + (b or 0)]
    total_cost_usd: Annotated[float, lambda a, b: (a or 0.0) + (b or 0.0)]


def initial_state(
    *,
    question: str,
    database_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    schema_name: str = "public",
    dialect: str = "postgres",
    clarification_answer: str | None = None,
    user_approved_expensive: bool = False,
) -> AgentState:
    from datetime import UTC

    return AgentState(
        user_question=question,
        database_id=database_id,
        workspace_id=workspace_id,
        user_id=user_id,
        conversation_id=conversation_id,
        schema_name=schema_name,
        dialect=dialect,
        clarification_answer=clarification_answer,
        user_approved_expensive=user_approved_expensive,
        awaiting_clarification=False,
        awaiting_confirmation=False,
        guard_warnings=[],
        errors=[],
        retry_count=0,
        step_count=0,
        started_at=datetime.now(UTC),
        total_input_tokens=0,
        total_output_tokens=0,
        total_cost_usd=0.0,
    )
