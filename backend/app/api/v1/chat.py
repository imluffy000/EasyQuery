"""Chat endpoints: synchronous turn, SSE stream, and conversation history."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import (
    LLMDep,
    ManagerDep,
    SessionDep,
    SettingsDep,
    WorkspaceDep,
)
from app.models.conversation import Conversation
from app.models.database_connection import DatabaseConnection
from app.schemas.api import (
    ChatRequestIn,
    ChatResponse,
    ConversationDetailOut,
    ConversationOut,
)
from app.security.rbac import Permission
from app.services.chat_service import ChatRequest, ChatService, _serialise_outcome

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["chat"])


async def _load_connection(
    session: SessionDep, workspace_id: uuid.UUID, database_id: uuid.UUID
) -> DatabaseConnection:
    """Resolve a database from the request body, scoped to the workspace.

    The id arrives in the payload rather than the path here, so it gets the
    same workspace scoping the path dependency would have applied.
    """
    connection = (
        await session.execute(
            select(DatabaseConnection).where(
                DatabaseConnection.id == database_id,
                DatabaseConnection.workspace_id == workspace_id,
            )
        )
    ).scalar_one_or_none()
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DATABASE_NOT_FOUND", "message": "Database connection not found."},
        )
    return connection


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequestIn,
    context: WorkspaceDep,
    session: SessionDep,
    settings: SettingsDep,
    manager: ManagerDep,
    llm: LLMDep,
) -> ChatResponse:
    context.require(Permission.QUERY_DATABASE)

    connection = await _load_connection(session, context.workspace.id, payload.database_id)

    # Overriding a cost warning is a separate, higher permission.
    if payload.approve_expensive:
        context.require(Permission.RUN_EXPENSIVE_QUERY)

    connector = await manager.get(connection)
    service = ChatService(session, settings=settings, llm=llm)

    outcome = await service.run(
        ChatRequest(
            question=payload.question,
            workspace_id=context.workspace.id,
            database_id=connection.id,
            user_id=context.user.id,
            conversation_id=payload.conversation_id,
            clarification_answer=payload.clarification_answer,
            approve_expensive=payload.approve_expensive,
        ),
        connection,
        connector,
    )
    return ChatResponse.model_validate(_serialise_outcome(outcome))


@router.post("/chat/stream")
async def chat_stream(
    payload: ChatRequestIn,
    context: WorkspaceDep,
    session: SessionDep,
    settings: SettingsDep,
    manager: ManagerDep,
    llm: LLMDep,
) -> StreamingResponse:
    """Server-sent events carrying operational status, then the result.

    Only status is streamed -- never model reasoning.
    """
    context.require(Permission.QUERY_DATABASE)
    if payload.approve_expensive:
        context.require(Permission.RUN_EXPENSIVE_QUERY)

    connection = await _load_connection(session, context.workspace.id, payload.database_id)
    connector = await manager.get(connection)
    service = ChatService(session, settings=settings, llm=llm)

    request = ChatRequest(
        question=payload.question,
        workspace_id=context.workspace.id,
        database_id=connection.id,
        user_id=context.user.id,
        conversation_id=payload.conversation_id,
        clarification_answer=payload.clarification_answer,
        approve_expensive=payload.approve_expensive,
    )

    async def event_source() -> AsyncIterator[bytes]:
        async for event, data in service.stream(request, connection, connector):
            payload_json = json.dumps(data, default=str)
            yield f"event: {event}\ndata: {payload_json}\n\n".encode()

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Stops nginx buffering the stream into one late blob.
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    context: WorkspaceDep, session: SessionDep, limit: int = 50
) -> list[ConversationOut]:
    context.require(Permission.VIEW_RESULTS)
    rows = (
        await session.execute(
            select(Conversation)
            .where(Conversation.workspace_id == context.workspace.id)
            .order_by(Conversation.updated_at.desc())
            .limit(min(limit, 200))
        )
    ).scalars().all()
    return [ConversationOut.model_validate(r) for r in rows]


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailOut)
async def get_conversation(
    conversation_id: uuid.UUID, context: WorkspaceDep, session: SessionDep
) -> ConversationDetailOut:
    context.require(Permission.VIEW_RESULTS)
    conversation = (
        await session.execute(
            select(Conversation)
            .options(selectinload(Conversation.messages))
            .where(
                Conversation.id == conversation_id,
                Conversation.workspace_id == context.workspace.id,
            )
        )
    ).scalar_one_or_none()

    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CONVERSATION_NOT_FOUND", "message": "Conversation not found."},
        )
    return ConversationDetailOut.model_validate(conversation)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: uuid.UUID, context: WorkspaceDep, session: SessionDep
) -> None:
    context.require(Permission.QUERY_DATABASE)
    conversation = (
        await session.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.workspace_id == context.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CONVERSATION_NOT_FOUND", "message": "Conversation not found."},
        )
    await session.delete(conversation)
