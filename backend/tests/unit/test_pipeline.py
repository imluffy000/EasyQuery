"""End-to-end pipeline tests using the offline echo provider.

These exercise the real graph, the real SQL guard and the real routing logic.
Only the database and the model are stubbed, so a routing regression (a
correction loop that never terminates, a cost gate that fails open) fails here.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from app.agents.graph import PipelineDeps, build_graph, choose_visualization, summarise_result
from app.agents.llm import EchoProvider
from app.agents.state import ResultSummary, initial_state
from app.database.connectors.base import (
    ConnectionConfig,
    ConnectionTestResult,
    ConnectorError,
    DatabaseConnector,
    Engine,
    ExplainResult,
    QueryResult,
    SchemaSnapshot,
)
from app.security.sql_guard import build_guard

SCHEMA_CONTEXT = """\
table public.orders  (~18,421 rows)
  id uuid [PK, NOT NULL]
  customer_id uuid [NOT NULL]
  total_amount numeric
  created_at timestamptz
  FK customer_id -> public.customers.id

table public.customers  (~2,140 rows)
  id uuid [PK, NOT NULL]
  city text
"""


class StubConnector(DatabaseConnector):
    """In-memory connector that records what it was asked to run."""

    engine = Engine.POSTGRES

    def __init__(
        self,
        *,
        rows: list[dict[str, Any]] | None = None,
        cost: float = 100.0,
        execute_error: ConnectorError | None = None,
    ) -> None:
        super().__init__(
            ConnectionConfig(
                engine=Engine.POSTGRES,
                host="stub",
                port=5432,
                database="stub",
                username="stub",
                password="",
            )
        )
        self.rows = rows if rows is not None else [{"result": 1}]
        self.cost = cost
        self.execute_error = execute_error
        self.executed: list[str] = []
        self.explained: list[str] = []

    async def connect(self) -> None: ...
    async def close(self) -> None: ...

    async def test_connection(self) -> ConnectionTestResult:
        return ConnectionTestResult(ok=True, message="stub")

    async def introspect_schema(self, schemas: list[str] | None = None) -> SchemaSnapshot:
        return SchemaSnapshot(
            database_id=None, schemas=["public"], tables=[], introspected_at=datetime.now(UTC)
        )

    async def execute(
        self, sql: str, *, timeout_seconds: int | None = None, max_rows: int | None = None
    ) -> QueryResult:
        self.executed.append(sql)
        if self.execute_error is not None:
            raise self.execute_error
        columns = list(self.rows[0].keys()) if self.rows else []
        return QueryResult(
            columns=columns, rows=self.rows, row_count=len(self.rows), duration_ms=12
        )

    async def explain(self, sql: str) -> ExplainResult:
        self.explained.append(sql)
        return ExplainResult(total_cost=self.cost, estimated_rows=len(self.rows), plan={})

    async def health_check(self) -> bool:
        return True


def make_deps(**overrides: Any) -> PipelineDeps:
    defaults: dict[str, Any] = {
        "llm": EchoProvider(),
        "connector": StubConnector(),
        "guard": build_guard(allowed_schemas=["public"], max_rows=1000),
        "schema_context": SCHEMA_CONTEXT,
        "glossary": {"revenue": "orders.total_amount"},
        "cost_threshold": 1_000_000.0,
        "max_rows": 1000,
    }
    defaults.update(overrides)
    return PipelineDeps(**defaults)


def make_state(**overrides: Any) -> Any:
    state = initial_state(
        question="How many orders did we get this month?",
        database_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        conversation_id=uuid.uuid4(),
    )
    state.update(overrides)
    return state


# --- happy path -------------------------------------------------------------


async def test_pipeline_reaches_answer() -> None:
    connector = StubConnector(rows=[{"order_count": 42}])
    deps = make_deps(connector=connector)
    result = await build_graph(deps).ainvoke(make_state())

    assert result.get("final_answer")
    assert result.get("validated_sql")
    assert not result.get("awaiting_clarification")
    assert connector.executed, "the pipeline must actually execute SQL"
    assert connector.explained, "EXPLAIN must run before execution"


async def test_guard_applies_limit_to_executed_sql() -> None:
    connector = StubConnector()
    deps = make_deps(connector=connector, llm=EchoProvider(sql="SELECT * FROM public.orders"))
    await build_graph(deps).ainvoke(make_state())

    assert "LIMIT 1000" in connector.executed[0].upper()


async def test_visualization_is_chosen() -> None:
    connector = StubConnector(rows=[{"revenue": 42.0}])
    result = await build_graph(make_deps(connector=connector)).ainvoke(make_state())
    assert result["visualization"].type == "kpi"


# --- security: the model cannot widen privilege -----------------------------


async def test_blocked_sql_never_executes() -> None:
    """Even if the model emits a DELETE, nothing reaches the database."""
    connector = StubConnector()
    deps = make_deps(connector=connector, llm=EchoProvider(sql="DELETE FROM public.orders"))
    result = await build_graph(deps).ainvoke(make_state())

    assert connector.executed == []
    assert not result.get("validated_sql")
    assert any(e.code == "DML_BLOCKED" for e in result["errors"])


async def test_stacked_statement_never_executes() -> None:
    connector = StubConnector()
    deps = make_deps(
        connector=connector, llm=EchoProvider(sql="SELECT 1; DROP TABLE public.orders")
    )
    result = await build_graph(deps).ainvoke(make_state())

    assert connector.executed == []
    assert any(e.code == "MULTIPLE_STATEMENTS" for e in result["errors"])


# --- correction loop --------------------------------------------------------


async def test_correction_loop_is_bounded() -> None:
    """A persistently invalid statement must terminate, not spin."""
    connector = StubConnector()
    deps = make_deps(
        connector=connector,
        # Both the initial and corrected SQL fail to parse.
        llm=EchoProvider(sql="SELECT FROM WHERE", correction_sql="SELECT FROM WHERE"),
        max_sql_retries=2,
    )
    result = await build_graph(deps).ainvoke(make_state())

    assert result["retry_count"] <= 2
    assert connector.executed == []


async def test_execution_error_triggers_correction() -> None:
    connector = StubConnector(
        execute_error=ConnectorError("column x does not exist", code="UNDEFINED_COLUMN")
    )
    deps = make_deps(
        connector=connector,
        llm=EchoProvider(sql="SELECT x FROM public.orders", correction_sql="SELECT 1 AS n"),
    )
    result = await build_graph(deps).ainvoke(make_state())

    # It retried: the corrected statement was attempted after the failure.
    assert len(connector.executed) >= 2
    assert result["retry_count"] >= 1


# --- cost gate --------------------------------------------------------------


async def test_expensive_query_suspends_for_confirmation() -> None:
    connector = StubConnector(cost=5_000_000.0)
    deps = make_deps(connector=connector, cost_threshold=1_000_000.0)
    result = await build_graph(deps).ainvoke(make_state())

    assert result["awaiting_confirmation"] is True
    assert connector.executed == [], "an unapproved expensive query must not run"


async def test_approved_expensive_query_runs() -> None:
    connector = StubConnector(cost=5_000_000.0)
    deps = make_deps(connector=connector, cost_threshold=1_000_000.0)
    result = await build_graph(deps).ainvoke(make_state(user_approved_expensive=True))

    assert not result.get("awaiting_confirmation")
    assert connector.executed


# --- result analysis --------------------------------------------------------


def test_summarise_computes_statistics() -> None:
    payload = {
        "columns": ["city", "revenue"],
        "rows": [{"city": "Hyderabad", "revenue": 10.0}, {"city": "Pune", "revenue": 30.0}],
        "row_count": 2,
    }
    summary = summarise_result(payload)
    assert summary.numeric_columns == ["revenue"]
    assert summary.categorical_columns == ["city"]
    assert summary.statistics["revenue"]["sum"] == 40.0
    assert summary.statistics["revenue"]["avg"] == 20.0


def test_summarise_handles_empty_result() -> None:
    summary = summarise_result({"columns": ["a"], "rows": [], "row_count": 0})
    assert summary.is_empty
    assert summary.row_count == 0


@pytest.mark.parametrize(
    ("summary", "expected"),
    [
        (ResultSummary(row_count=1, column_count=1, is_empty=False, numeric_columns=["n"]), "kpi"),
        (
            ResultSummary(
                row_count=12,
                column_count=2,
                is_empty=False,
                numeric_columns=["revenue"],
                temporal_columns=["month"],
            ),
            "line",
        ),
        (
            ResultSummary(
                row_count=8,
                column_count=2,
                is_empty=False,
                numeric_columns=["revenue"],
                categorical_columns=["city"],
            ),
            "bar",
        ),
        (ResultSummary(is_empty=True), "table"),
        (
            # Too many categories to plot readably -> table.
            ResultSummary(
                row_count=5000,
                column_count=2,
                is_empty=False,
                numeric_columns=["n"],
                categorical_columns=["id"],
            ),
            "table",
        ),
    ],
)
def test_visualization_selection(summary: ResultSummary, expected: str) -> None:
    assert choose_visualization(summary).type == expected
