"""The LangGraph pipeline (spec section 15).

    START -> intent -> schema retrieval -> ambiguity
      -> [clarification] -> planning -> SQL generation
      -> validation -> [correction loop, max 2]
      -> EXPLAIN -> cost gate -> [confirmation]
      -> execution -> result analysis -> visualization -> answer -> END

Two nodes can suspend the graph and hand control back to the user:
`ambiguity` (needs a clarification) and `cost_gate` (needs approval for an
expensive query). Both set an `awaiting_*` flag and route straight to END; the
caller resumes by starting a new run with the answer supplied.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import structlog
from langgraph.graph import END, StateGraph

from app.agents.llm import LLMError, LLMProvider, LLMUsage
from app.agents.prompts import (
    AMBIGUITY_SYSTEM,
    ANSWER_SYSTEM,
    INTENT_SYSTEM,
    PLANNER_SYSTEM,
    SQL_CORRECTION_SYSTEM,
    SQL_SYSTEM,
    render_context_block,
)
from app.agents.state import (
    AgentError,
    AgentState,
    AmbiguityResult,
    CostAssessment,
    IntentResult,
    QueryPlan,
    ResultSummary,
    SQLResult,
    StreamEvent,
    VisualizationSpec,
)
from app.database.connectors.base import ConnectorError, DatabaseConnector
from app.security.sql_guard import SQLGuard
from app.security.trust_boundary import (
    TrustLevel,
    scan_for_injection,
    wrap_untrusted,
)

log = structlog.get_logger(__name__)

EmitFn = Callable[[StreamEvent, dict[str, Any]], Awaitable[None]]


async def _noop_emit(_event: StreamEvent, _payload: dict[str, Any]) -> None:
    return None


@dataclass
class PipelineDeps:
    """Everything the nodes need, injected rather than imported.

    Keeping these out of module scope is what makes the pipeline unit-testable
    with an echo provider and a stub connector.
    """

    llm: LLMProvider
    connector: DatabaseConnector
    guard: SQLGuard
    schema_context: str
    glossary: dict[str, str] = field(default_factory=dict)
    emit: EmitFn = _noop_emit
    max_sql_retries: int = 2
    cost_threshold: float = 1_000_000.0
    max_rows: int = 10_000


def _accumulate(state: AgentState, usage: LLMUsage) -> dict[str, Any]:
    """Token/cost accounting returned as a state delta."""
    return {
        "total_input_tokens": usage.input_tokens,
        "total_output_tokens": usage.output_tokens,
        "total_cost_usd": usage.cost_usd,
        "step_count": state.get("step_count", 0) + 1,
    }


def build_graph(deps: PipelineDeps) -> Any:
    """Compile the pipeline. One graph per request -- deps are request-scoped."""

    # -- nodes ---------------------------------------------------------------

    async def intent_analysis(state: AgentState) -> dict[str, Any]:
        await deps.emit(StreamEvent.UNDERSTANDING_QUESTION, {})
        question = state["user_question"]

        # A question is user-controlled text; log injection attempts but do
        # not block -- the SQL guard is what actually contains the blast radius.
        findings = scan_for_injection(question)
        if findings:
            log.warning(
                "possible_prompt_injection",
                source="user_question",
                patterns=[f.pattern for f in findings],
            )

        try:
            result, usage = await deps.llm.structured_generate(
                system=INTENT_SYSTEM,
                prompt=wrap_untrusted(question, kind=TrustLevel.USER),
                schema=IntentResult,
            )
        except LLMError as exc:
            return {
                "detected_intent": IntentResult(),
                "errors": [AgentError(stage="intent", code=exc.code, message=exc.message)],
            }
        return {"detected_intent": result, **_accumulate(state, usage)}

    async def schema_retrieval(state: AgentState) -> dict[str, Any]:
        await deps.emit(StreamEvent.RETRIEVING_SCHEMA, {})
        # Retrieval already happened in the service layer (it needs DB access
        # and caching); this node records what was selected so the trace and
        # the query-details drawer can show it.
        tables = _tables_in_context(deps.schema_context)
        return {
            "relevant_schema": deps.schema_context,
            "retrieved_tables": tables,
            "glossary": deps.glossary,
            "step_count": state.get("step_count", 0) + 1,
        }

    async def ambiguity_detection(state: AgentState) -> dict[str, Any]:
        # An answer supplied by the user resolves the previous ambiguity;
        # do not ask again on the resumed run.
        if state.get("clarification_answer"):
            return {"ambiguity": AmbiguityResult(is_ambiguous=False)}

        context = render_context_block(
            schema=deps.schema_context,
            glossary=deps.glossary,
            summary=state.get("conversation_summary", ""),
            turns=state.get("recent_turns", []),
        )
        try:
            result, usage = await deps.llm.structured_generate(
                system=AMBIGUITY_SYSTEM,
                prompt=f"{context}\n\nQuestion:\n"
                f"{wrap_untrusted(state['user_question'], kind=TrustLevel.USER)}",
                schema=AmbiguityResult,
            )
        except LLMError as exc:
            # Failing open here means we guess at intent; failing closed means
            # an unnecessary question. Prefer proceeding -- the plan and SQL
            # are still validated downstream.
            log.warning("ambiguity_check_failed", error=exc.message)
            return {"ambiguity": AmbiguityResult(is_ambiguous=False)}

        if result.is_ambiguous:
            await deps.emit(
                StreamEvent.CLARIFICATION_REQUIRED,
                {
                    "question": result.question,
                    "dimension": result.dimension.value if result.dimension else None,
                    "options": [o.model_dump() for o in result.options],
                    "allow_free_text": result.allow_free_text,
                },
            )
            return {
                "ambiguity": result,
                "awaiting_clarification": True,
                **_accumulate(state, usage),
            }
        return {"ambiguity": result, **_accumulate(state, usage)}

    async def query_planning(state: AgentState) -> dict[str, Any]:
        await deps.emit(StreamEvent.PLANNING_QUERY, {})
        context = render_context_block(
            schema=deps.schema_context,
            glossary=deps.glossary,
            summary=state.get("conversation_summary", ""),
            turns=state.get("recent_turns", []),
        )
        clarification = state.get("clarification_answer")
        question = state["user_question"]
        if clarification:
            question = f"{question}\n\nThe user clarified: {clarification}"

        try:
            plan, usage = await deps.llm.structured_generate(
                system=PLANNER_SYSTEM,
                prompt=f"{context}\n\nQuestion:\n{wrap_untrusted(question, kind=TrustLevel.USER)}",
                schema=QueryPlan,
            )
        except LLMError as exc:
            return {"errors": [AgentError(stage="planning", code=exc.code, message=exc.message)]}
        return {"query_plan": plan, **_accumulate(state, usage)}

    async def sql_generation(state: AgentState) -> dict[str, Any]:
        await deps.emit(StreamEvent.GENERATING_SQL, {})
        plan = state.get("query_plan") or QueryPlan()
        context = render_context_block(
            schema=deps.schema_context,
            glossary=deps.glossary,
            summary=state.get("conversation_summary", ""),
            turns=state.get("recent_turns", []),
        )
        prompt = (
            f"{context}\n\n"
            f"Query plan:\n{plan.model_dump_json(indent=2)}\n\n"
            f"Dialect: {state.get('dialect', 'postgres')}\n"
            f"Row ceiling: {deps.max_rows}\n\n"
            f"Question:\n{wrap_untrusted(state['user_question'], kind=TrustLevel.USER)}"
        )
        try:
            result, usage = await deps.llm.structured_generate(
                system=SQL_SYSTEM, prompt=prompt, schema=SQLResult
            )
        except LLMError as exc:
            return {
                "errors": [AgentError(stage="sql_generation", code=exc.code, message=exc.message)]
            }
        return {"generated_sql": result.sql, **_accumulate(state, usage)}

    async def sql_validation(state: AgentState) -> dict[str, Any]:
        await deps.emit(StreamEvent.VALIDATING_SQL, {})
        sql = state.get("generated_sql", "")
        result = deps.guard.validate(sql)

        if result.ok and result.safe_sql:
            return {
                "validated_sql": result.safe_sql,
                "guard_warnings": result.warnings,
                "step_count": state.get("step_count", 0) + 1,
            }

        return {
            "errors": [
                AgentError(
                    stage="validation",
                    code=e.code.value,
                    message=e.message,
                    # A blocked write is not worth regenerating; a parse or
                    # column error might be fixable.
                    recoverable=e.code.value
                    in {"PARSE_ERROR", "STATEMENT_NOT_ALLOWED", "TOO_MANY_JOINS"},
                )
                for e in result.errors
            ],
            "step_count": state.get("step_count", 0) + 1,
        }

    async def sql_correction(state: AgentState) -> dict[str, Any]:
        """Regenerate SQL from a concrete database or guard error."""
        errors = state.get("errors", [])
        last = errors[-1] if errors else None
        retry = state.get("retry_count", 0) + 1

        # A database error message can carry attacker-influenced text (a column
        # name, a quoted value), so it is fenced like any other untrusted input.
        error_block = wrap_untrusted(last.message if last else "unknown", kind=TrustLevel.TOOL)

        prompt = (
            f"Original question:\n"
            f"{wrap_untrusted(state['user_question'], kind=TrustLevel.USER)}\n\n"
            f"Schema:\n{deps.schema_context}\n\n"
            f"SQL that failed:\n{state.get('generated_sql', '')}\n\n"
            f"Error:\n{error_block}\n\n"
            "Return corrected read-only SQL."
        )
        try:
            result, usage = await deps.llm.structured_generate(
                system=SQL_CORRECTION_SYSTEM, prompt=prompt, schema=SQLResult
            )
        except LLMError as exc:
            return {
                "retry_count": retry,
                "errors": [AgentError(stage="correction", code=exc.code, message=exc.message)],
            }
        return {"generated_sql": result.sql, "retry_count": retry, **_accumulate(state, usage)}

    async def cost_gate(state: AgentState) -> dict[str, Any]:
        """EXPLAIN before executing, and stop if the plan looks expensive."""
        await deps.emit(StreamEvent.CHECKING_COST, {})
        sql = state["validated_sql"]
        try:
            explain = await deps.connector.explain(sql)
        except ConnectorError as exc:
            # A failed EXPLAIN is not fatal -- statement_timeout and the row
            # cap still bound the damage -- but it is worth recording.
            log.info("explain_failed", code=exc.code)
            return {
                "cost_assessment": CostAssessment(
                    warnings=["Query plan could not be estimated before execution."]
                ),
                "step_count": state.get("step_count", 0) + 1,
            }

        assessment = CostAssessment(
            total_cost=explain.total_cost,
            estimated_rows=explain.estimated_rows,
            is_expensive=explain.total_cost >= deps.cost_threshold,
            has_sequential_scan=explain.has_sequential_scan,
            warnings=explain.warnings,
            scanned_relations=explain.scanned_relations,
        )

        if assessment.is_expensive and not state.get("user_approved_expensive"):
            await deps.emit(
                StreamEvent.CONFIRMATION_REQUIRED,
                {
                    "estimated_cost": assessment.total_cost,
                    "estimated_rows": assessment.estimated_rows,
                    "relations": assessment.scanned_relations,
                },
            )
            return {
                "cost_assessment": assessment,
                "awaiting_confirmation": True,
                "step_count": state.get("step_count", 0) + 1,
            }

        return {"cost_assessment": assessment, "step_count": state.get("step_count", 0) + 1}

    async def execution(state: AgentState) -> dict[str, Any]:
        await deps.emit(StreamEvent.EXECUTING_QUERY, {})
        sql = state["validated_sql"]
        try:
            result = await deps.connector.execute(sql, max_rows=deps.max_rows)
        except ConnectorError as exc:
            return {
                "errors": [
                    AgentError(
                        stage="execution",
                        code=exc.code,
                        message=exc.message,
                        recoverable=exc.code
                        in {"UNDEFINED_COLUMN", "UNDEFINED_TABLE", "SQL_SYNTAX_ERROR"},
                    )
                ],
                "step_count": state.get("step_count", 0) + 1,
            }
        return {
            "execution_result": {
                "columns": result.columns,
                "rows": result.rows,
                "row_count": result.row_count,
                "duration_ms": result.duration_ms,
                "truncated": result.truncated,
            },
            "step_count": state.get("step_count", 0) + 1,
        }

    async def result_analysis(state: AgentState) -> dict[str, Any]:
        await deps.emit(StreamEvent.ANALYZING_RESULTS, {})
        payload = state.get("execution_result") or {}
        summary = summarise_result(payload)
        return {"result_summary": summary, "step_count": state.get("step_count", 0) + 1}

    async def visualization_decision(state: AgentState) -> dict[str, Any]:
        summary = state.get("result_summary") or ResultSummary()
        # Chart choice is deterministic from result shape -- no model call, no
        # latency, no chance of the model inventing a chart type.
        spec = choose_visualization(summary)
        return {"visualization": spec, "step_count": state.get("step_count", 0) + 1}

    async def answer_generation(state: AgentState) -> dict[str, Any]:
        summary = state.get("result_summary") or ResultSummary()
        payload = state.get("execution_result") or {}
        plan = state.get("query_plan") or QueryPlan()

        # Only a bounded, masked sample reaches the model -- never the full
        # result set (spec section 25).
        compact = {
            "row_count": payload.get("row_count", 0),
            "columns": payload.get("columns", []),
            "sample_rows": summary.sample_rows,
            "statistics": summary.statistics,
            "truncated": payload.get("truncated", False),
        }
        prompt = (
            f"Question:\n{wrap_untrusted(state['user_question'], kind=TrustLevel.USER)}\n\n"
            f"Assumptions made:\n{json.dumps(plan.assumptions)}\n\n"
            f"Result:\n{wrap_untrusted(json.dumps(compact, default=str), kind=TrustLevel.DATABASE)}"
        )
        try:
            response = await deps.llm.generate(system=ANSWER_SYSTEM, prompt=prompt)
        except LLMError as exc:
            return {
                "final_answer": _fallback_answer(summary),
                "errors": [AgentError(stage="answer", code=exc.code, message=exc.message)],
            }

        text = response.text.strip()
        # The answer node is free-text, so a JSON echo response must be unwrapped.
        if text.startswith("{"):
            try:
                text = str(json.loads(text).get("answer", text))
            except json.JSONDecodeError:
                pass

        await deps.emit(StreamEvent.COMPLETE, {})
        return {
            "final_answer": text or _fallback_answer(summary),
            **_accumulate(state, response.usage),
        }

    # -- routing -------------------------------------------------------------

    def after_ambiguity(state: AgentState) -> str:
        if state.get("awaiting_clarification"):
            return "suspend"
        if _has_fatal_error(state):
            return "suspend"
        return "plan"

    def after_validation(state: AgentState) -> str:
        if state.get("validated_sql"):
            return "cost_gate"
        if _can_retry(state, deps.max_sql_retries):
            return "correct"
        return "suspend"

    def after_cost_gate(state: AgentState) -> str:
        return "suspend" if state.get("awaiting_confirmation") else "execute"

    def after_execution(state: AgentState) -> str:
        if state.get("execution_result") is not None:
            return "analyze"
        if _can_retry(state, deps.max_sql_retries):
            return "correct"
        return "suspend"

    # -- wiring --------------------------------------------------------------

    graph = StateGraph(AgentState)
    graph.add_node("intent", intent_analysis)
    graph.add_node("schema", schema_retrieval)
    graph.add_node("ambiguity", ambiguity_detection)
    graph.add_node("plan", query_planning)
    graph.add_node("generate_sql", sql_generation)
    graph.add_node("validate_sql", sql_validation)
    graph.add_node("correct_sql", sql_correction)
    graph.add_node("cost_gate", cost_gate)
    graph.add_node("execute", execution)
    graph.add_node("analyze", result_analysis)
    graph.add_node("visualize", visualization_decision)
    graph.add_node("answer", answer_generation)

    graph.set_entry_point("intent")
    graph.add_edge("intent", "schema")
    graph.add_edge("schema", "ambiguity")
    graph.add_conditional_edges("ambiguity", after_ambiguity, {"plan": "plan", "suspend": END})
    graph.add_edge("plan", "generate_sql")
    graph.add_edge("generate_sql", "validate_sql")
    graph.add_conditional_edges(
        "validate_sql",
        after_validation,
        {"cost_gate": "cost_gate", "correct": "correct_sql", "suspend": END},
    )
    # Correction re-enters validation, bounded by retry_count.
    graph.add_edge("correct_sql", "validate_sql")
    graph.add_conditional_edges(
        "cost_gate", after_cost_gate, {"execute": "execute", "suspend": END}
    )
    graph.add_conditional_edges(
        "execute",
        after_execution,
        {"analyze": "analyze", "correct": "correct_sql", "suspend": END},
    )
    graph.add_edge("analyze", "visualize")
    graph.add_edge("visualize", "answer")
    graph.add_edge("answer", END)

    return graph.compile()


# --- helpers ----------------------------------------------------------------


def _has_fatal_error(state: AgentState) -> bool:
    return any(not e.recoverable for e in state.get("errors", []))


def _can_retry(state: AgentState, limit: int) -> bool:
    if state.get("retry_count", 0) >= limit:
        return False
    errors = state.get("errors", [])
    return bool(errors) and errors[-1].recoverable


def _tables_in_context(schema_context: str) -> list[str]:
    return sorted(
        {
            line.split()[1].strip(":")
            for line in schema_context.splitlines()
            if line.strip().lower().startswith("table ") and len(line.split()) > 1
        }
    )


def _fallback_answer(summary: ResultSummary) -> str:
    if summary.is_empty:
        return "The query ran successfully but returned no rows."
    return f"The query returned {summary.row_count:,} rows across {summary.column_count} columns."


_NUMERIC = (int, float)


def summarise_result(payload: dict[str, Any], *, sample_size: int = 20) -> ResultSummary:
    """Compute statistics in the backend so the model sees a summary, not data."""
    rows: list[dict[str, Any]] = payload.get("rows") or []
    columns: list[str] = payload.get("columns") or []

    if not rows:
        return ResultSummary(row_count=0, column_count=len(columns), is_empty=True)

    numeric: list[str] = []
    temporal: list[str] = []
    categorical: list[str] = []
    statistics: dict[str, dict[str, float]] = {}

    for column in columns:
        values = [r.get(column) for r in rows if r.get(column) is not None]
        if not values:
            categorical.append(column)
            continue
        first = values[0]
        if isinstance(first, bool):
            categorical.append(column)
        elif isinstance(first, _NUMERIC):
            numeric.append(column)
            nums = [float(v) for v in values if isinstance(v, _NUMERIC)]
            if nums:
                statistics[column] = {
                    "min": min(nums),
                    "max": max(nums),
                    "sum": sum(nums),
                    "avg": sum(nums) / len(nums),
                }
        elif isinstance(first, str) and _looks_temporal(first):
            temporal.append(column)
        else:
            categorical.append(column)

    return ResultSummary(
        row_count=len(rows),
        column_count=len(columns),
        is_empty=False,
        numeric_columns=numeric,
        temporal_columns=temporal,
        categorical_columns=categorical,
        statistics=statistics,
        sample_rows=rows[:sample_size],
    )


def _looks_temporal(value: str) -> bool:
    return len(value) >= 8 and value[:4].isdigit() and value[4] in "-/"


def choose_visualization(summary: ResultSummary) -> VisualizationSpec:
    """Pick a chart from result shape alone (spec section 27)."""
    if summary.is_empty:
        return VisualizationSpec(type="table", title="No results", reason="Empty result set.")

    # Single scalar -> KPI
    if summary.row_count == 1 and summary.column_count == 1 and summary.numeric_columns:
        col = summary.numeric_columns[0]
        return VisualizationSpec(
            type="kpi", y=col, title=_titleise(col), reason="Single numeric value."
        )

    # Time series -> line
    if summary.temporal_columns and summary.numeric_columns:
        x = summary.temporal_columns[0]
        y = summary.numeric_columns[0]
        return VisualizationSpec(
            type="line",
            x=x,
            y=y,
            series=summary.categorical_columns[0] if summary.categorical_columns else None,
            title=f"{_titleise(y)} over {_titleise(x)}",
            reason="A temporal dimension with a numeric measure.",
        )

    # One category + one measure -> bar (only while it stays readable)
    if summary.categorical_columns and summary.numeric_columns and summary.row_count <= 50:
        x = summary.categorical_columns[0]
        y = summary.numeric_columns[0]
        return VisualizationSpec(
            type="bar",
            x=x,
            y=y,
            title=f"{_titleise(y)} by {_titleise(x)}",
            reason="A categorical dimension with a numeric measure.",
        )

    return VisualizationSpec(
        type="table", title="Results", reason="Result shape is best read as a table."
    )


def _titleise(name: str) -> str:
    return name.replace("_", " ").strip().title()
