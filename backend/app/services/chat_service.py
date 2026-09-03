"""Chat orchestration: runs the agent pipeline and persists everything.

This is the only place that assembles a `PipelineDeps` and invokes the graph.
It owns the boundary responsibilities the graph deliberately does not have:
authorization has already happened upstream, persistence and audit happen
here, and results are masked here before they are returned.
"""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.graph import PipelineDeps, build_graph
from app.agents.llm import LLMProvider
from app.agents.state import AgentState, StreamEvent, initial_state
from app.config.settings import Settings
from app.database.connectors.base import DatabaseConnector
from app.models.conversation import Clarification, Conversation, Message, Query
from app.models.database_connection import DatabaseConnection
from app.retrieval.retriever import SchemaRetriever
from app.security import audit
from app.security.audit import AuditEvent
from app.security.pii import Sensitivity, mask_rows
from app.security.sql_guard import build_guard
from app.services.schema_service import SchemaService

log = structlog.get_logger(__name__)


@dataclass
class ChatRequest:
    question: str
    workspace_id: uuid.UUID
    database_id: uuid.UUID
    user_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    clarification_answer: str | None = None
    approve_expensive: bool = False


@dataclass
class ChatOutcome:
    conversation_id: uuid.UUID
    query_id: uuid.UUID
    state: AgentState


class ChatService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        settings: Settings,
        llm: LLMProvider,
    ) -> None:
        self.session = session
        self.settings = settings
        self.llm = llm

    # -- public API ----------------------------------------------------------

    async def run(
        self,
        request: ChatRequest,
        connection: DatabaseConnection,
        connector: DatabaseConnector,
        *,
        emit: Any = None,
    ) -> ChatOutcome:
        conversation = await self._ensure_conversation(request, connection)
        schema_service = SchemaService(self.session)

        context, tables, glossary = await schema_service.build_context(
            database_id=connection.id,
            question=request.question,
            retriever=SchemaRetriever(),
        )

        # Workspace policy may only tighten the global ceiling, never widen it.
        max_rows = min(connection.max_rows, self.settings.query.max_rows)

        deps = PipelineDeps(
            llm=self.llm,
            connector=connector,
            guard=build_guard(
                allowed_schemas=list(connection.allowed_schemas),
                max_rows=max_rows,
                max_joins=self.settings.query.max_joins,
                dialect=connector.dialect,
                read_only=connection.read_only,
            ),
            schema_context=context,
            glossary=glossary,
            emit=emit or _noop,
            max_sql_retries=self.settings.max_sql_retries,
            cost_threshold=self.settings.query.cost_warning_threshold,
            max_rows=max_rows,
        )

        state = initial_state(
            question=request.question,
            database_id=connection.id,
            workspace_id=request.workspace_id,
            user_id=request.user_id,
            conversation_id=conversation.id,
            schema_name=(connection.allowed_schemas or ["public"])[0],
            dialect=connector.dialect,
            clarification_answer=request.clarification_answer,
            user_approved_expensive=request.approve_expensive,
        )
        state["recent_turns"] = await self._recent_turns(conversation.id)
        state["conversation_summary"] = conversation.summary
        state["retrieved_tables"] = tables

        await self._record_user_message(conversation, request.question)

        graph = build_graph(deps)
        try:
            final: AgentState = await asyncio.wait_for(
                graph.ainvoke(state),
                timeout=self.settings.query.max_execution_time_seconds
                + self.settings.llm_timeout_seconds,
            )
        except TimeoutError:
            final = dict(state)  # type: ignore[assignment]
            final["errors"] = [
                *(state.get("errors") or []),
            ]
            log.warning("pipeline_timeout", conversation_id=str(conversation.id))

        query = await self._persist(request, connection, conversation, final)
        await self._record_assistant_message(conversation, final, query)
        await self._audit(request, connection, final, query)

        return ChatOutcome(conversation_id=conversation.id, query_id=query.id, state=final)

    async def stream(
        self,
        request: ChatRequest,
        connection: DatabaseConnection,
        connector: DatabaseConnector,
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        """Run the pipeline, yielding operational status events as they occur.

        Status only -- never model reasoning (spec sections 12 and 42).
        """
        queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()

        async def emit(event: StreamEvent, payload: dict[str, Any]) -> None:
            await queue.put((event.value, payload))

        async def drive() -> None:
            try:
                outcome = await self.run(request, connection, connector, emit=emit)
                await queue.put(("result", _serialise_outcome(outcome)))
            except Exception as exc:  # noqa: BLE001 - surfaced as an error event
                log.exception("chat_stream_failed")
                await queue.put(("error", {"code": "INTERNAL_ERROR", "message": str(exc)[:200]}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(drive())
        yield (StreamEvent.CONNECTED.value, {})
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            if not task.done():
                task.cancel()

    # -- persistence ---------------------------------------------------------

    async def _ensure_conversation(
        self, request: ChatRequest, connection: DatabaseConnection
    ) -> Conversation:
        if request.conversation_id is not None:
            existing = (
                await self.session.execute(
                    select(Conversation).where(
                        Conversation.id == request.conversation_id,
                        # Tenant scoping is re-checked here even though the
                        # route already authorised the workspace.
                        Conversation.workspace_id == request.workspace_id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                return existing

        conversation = Conversation(
            workspace_id=request.workspace_id,
            database_id=connection.id,
            user_id=request.user_id,
            title=request.question[:120] or "New conversation",
        )
        self.session.add(conversation)
        await self.session.flush()
        return conversation

    async def _recent_turns(
        self, conversation_id: uuid.UUID, limit: int = 8
    ) -> list[dict[str, str]]:
        rows = (
            (
                await self.session.execute(
                    select(Message)
                    .where(Message.conversation_id == conversation_id)
                    .order_by(Message.created_at.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        return [{"role": m.role, "content": m.content} for m in reversed(rows)]

    async def _record_user_message(self, conversation: Conversation, question: str) -> None:
        self.session.add(Message(conversation_id=conversation.id, role="user", content=question))
        await self.session.flush()

    async def _record_assistant_message(
        self, conversation: Conversation, state: AgentState, query: Query
    ) -> None:
        payload: dict[str, Any] = {}
        content = state.get("final_answer") or ""

        ambiguity = state.get("ambiguity")
        if state.get("awaiting_clarification") and ambiguity is not None:
            content = ambiguity.question or "Could you clarify that?"
            payload["clarification"] = {
                "question": ambiguity.question,
                "dimension": ambiguity.dimension.value if ambiguity.dimension else None,
                "options": [o.model_dump() for o in ambiguity.options],
                "allow_free_text": ambiguity.allow_free_text,
            }
            self.session.add(
                Clarification(
                    conversation_id=conversation.id,
                    workspace_id=conversation.workspace_id,
                    question=ambiguity.question or "",
                    dimension=ambiguity.dimension.value if ambiguity.dimension else None,
                    options=[o.model_dump() for o in ambiguity.options],
                )
            )
        elif state.get("awaiting_confirmation"):
            cost = state.get("cost_assessment")
            content = "This query may scan a large amount of data."
            payload["confirmation"] = {
                "estimated_rows": cost.estimated_rows if cost else 0,
                "estimated_cost": cost.total_cost if cost else 0.0,
                "relations": cost.scanned_relations if cost else [],
            }
        elif not content:
            errors = state.get("errors") or []
            content = errors[-1].message if errors else "The request could not be completed."

        visualization = state.get("visualization")
        if visualization is not None:
            payload["visualization"] = visualization.model_dump()

        self.session.add(
            Message(
                conversation_id=conversation.id,
                role="assistant",
                content=content,
                query_id=query.id,
                payload=payload,
            )
        )
        await self.session.flush()

    async def _persist(
        self,
        request: ChatRequest,
        connection: DatabaseConnection,
        conversation: Conversation,
        state: AgentState,
    ) -> Query:
        errors = state.get("errors") or []
        execution = state.get("execution_result") or {}
        plan = state.get("query_plan")
        cost = state.get("cost_assessment")

        blocked = any(
            e.code
            in {
                "DML_BLOCKED",
                "DDL_BLOCKED",
                "MULTIPLE_STATEMENTS",
                "SYSTEM_CATALOG",
                "FUNCTION_BLOCKED",
                "SCHEMA_NOT_ALLOWED",
                "STATEMENT_NOT_ALLOWED",
            }
            for e in errors
        )

        if state.get("awaiting_clarification"):
            status = "needs_clarification"
        elif state.get("awaiting_confirmation"):
            status = "needs_confirmation"
        elif blocked:
            status = "blocked"
        elif errors and not execution:
            status = "failed"
        elif execution:
            status = "success"
        else:
            status = "failed"

        executed_sql = state.get("validated_sql")
        query = Query(
            workspace_id=request.workspace_id,
            database_id=connection.id,
            user_id=request.user_id,
            conversation_id=conversation.id,
            question=request.question,
            generated_sql=state.get("generated_sql"),
            executed_sql=executed_sql if execution else None,
            query_plan=plan.model_dump() if plan else {},
            tables_used=list(state.get("retrieved_tables") or []),
            assumptions=list(plan.assumptions) if plan else [],
            status=status,
            error_code=errors[-1].code if errors else None,
            error_message=errors[-1].message if errors else None,
            row_count=execution.get("row_count"),
            duration_ms=execution.get("duration_ms"),
            input_tokens=int(state.get("total_input_tokens") or 0),
            output_tokens=int(state.get("total_output_tokens") or 0),
            cost_usd=float(state.get("total_cost_usd") or 0.0),
            model=self.llm.model,
            retry_count=int(state.get("retry_count") or 0),
            required_clarification=bool(state.get("awaiting_clarification")),
            was_blocked=blocked,
            query_hash=(
                hashlib.sha256(executed_sql.encode()).hexdigest() if executed_sql else None
            ),
            explain_plan=cost.model_dump() if cost else {},
            visualization=(
                state["visualization"].model_dump() if state.get("visualization") else {}
            ),
            answer=state.get("final_answer"),
        )
        self.session.add(query)
        await self.session.flush()
        return query

    async def _audit(
        self,
        request: ChatRequest,
        connection: DatabaseConnection,
        state: AgentState,
        query: Query,
    ) -> None:
        if query.was_blocked:
            event = AuditEvent.QUERY_BLOCKED
        elif query.status == "success":
            event = AuditEvent.QUERY_EXECUTED
        elif query.error_code == "QUERY_TIMEOUT":
            event = AuditEvent.QUERY_TIMED_OUT
        elif query.status == "failed":
            event = AuditEvent.QUERY_FAILED
        else:
            event = AuditEvent.QUERY_GENERATED

        await audit.record(
            self.session,
            event=event,
            workspace_id=request.workspace_id,
            user_id=request.user_id,
            database_id=connection.id,
            query_id=query.id,
            metadata={
                "status": query.status,
                "row_count": query.row_count,
                "duration_ms": query.duration_ms,
                "retry_count": query.retry_count,
                "error_code": query.error_code,
                "tables": query.tables_used,
            },
        )


def mask_result_rows(
    rows: list[dict[str, Any]], columns_meta: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Apply the sensitivity classification recorded at schema-sync time."""
    sensitivity = {
        str(c["name"]): Sensitivity(c.get("sensitivity", "none"))
        for c in columns_meta
        if c.get("sensitivity", "none") != "none"
    }
    return mask_rows(rows, sensitivity) if sensitivity else rows


async def _noop(_event: StreamEvent, _payload: dict[str, Any]) -> None:
    return None


def _serialise_outcome(outcome: ChatOutcome) -> dict[str, Any]:
    state = outcome.state
    execution = state.get("execution_result") or {}
    visualization = state.get("visualization")
    cost = state.get("cost_assessment")
    ambiguity = state.get("ambiguity")
    errors = state.get("errors") or []

    return {
        "conversation_id": str(outcome.conversation_id),
        "query_id": str(outcome.query_id),
        "answer": state.get("final_answer"),
        "generated_sql": state.get("generated_sql"),
        "executed_sql": state.get("validated_sql"),
        "awaiting_clarification": bool(state.get("awaiting_clarification")),
        "clarification": (
            {
                "question": ambiguity.question,
                "dimension": ambiguity.dimension.value if ambiguity.dimension else None,
                "options": [o.model_dump() for o in ambiguity.options],
                "allow_free_text": ambiguity.allow_free_text,
            }
            if state.get("awaiting_clarification") and ambiguity
            else None
        ),
        "awaiting_confirmation": bool(state.get("awaiting_confirmation")),
        "cost": cost.model_dump() if cost else None,
        "result": {
            "columns": execution.get("columns", []),
            "rows": execution.get("rows", []),
            "row_count": execution.get("row_count", 0),
            "duration_ms": execution.get("duration_ms", 0),
            "truncated": execution.get("truncated", False),
        }
        if execution
        else None,
        "visualization": visualization.model_dump() if visualization else None,
        "warnings": list(state.get("guard_warnings") or []),
        "errors": [e.model_dump() for e in errors],
        "tables_used": list(state.get("retrieved_tables") or []),
        "generated_at": datetime.now(UTC).isoformat(),
    }
