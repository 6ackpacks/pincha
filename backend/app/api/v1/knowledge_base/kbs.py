"""Knowledge Base CRUD API."""
import uuid
from datetime import datetime

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.auth import get_current_user
from app.models.knowledge_base import KnowledgeBase, KBConversation
from app.models.user import User

router = APIRouter(prefix="/kbs", tags=["knowledge-bases"])

MAX_KBS_PER_USER = 3


class KBCreate(BaseModel):
    name: str
    description: str | None = None


class KBUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class KBResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    is_default: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("id")
    def serialize_id(self, v: uuid.UUID) -> str:
        return str(v)

    @field_serializer("created_at")
    def serialize_created_at(self, v: datetime) -> str:
        return v.isoformat()


class ConversationResponse(BaseModel):
    id: uuid.UUID
    title: str
    messages: list
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("id")
    def serialize_id(self, v: uuid.UUID) -> str:
        return str(v)

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, v: datetime) -> str:
        return v.isoformat()


class ConversationCreate(BaseModel):
    title: str = "新对话"


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=50000)


class ConversationUpdate(BaseModel):
    title: str | None = None
    messages: list[ConversationMessage] | None = Field(default=None, max_length=200)


# ─── Knowledge Base CRUD ──────────────────────────────────────────────────────


@router.get("")
async def list_kbs(
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(KnowledgeBase)
        .where(KnowledgeBase.user_id == user.id)
        .order_by(KnowledgeBase.created_at)
    )
    kbs = result.scalars().all()
    return [KBResponse.model_validate(kb, from_attributes=True) for kb in kbs]


@router.post("", status_code=201)
async def create_kb(
    body: KBCreate,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    count = await db.scalar(
        select(func.count()).select_from(KnowledgeBase).where(KnowledgeBase.user_id == user.id)
    )
    if count >= MAX_KBS_PER_USER:
        raise HTTPException(status_code=400, detail=f"最多创建 {MAX_KBS_PER_USER} 个知识库")

    kb = KnowledgeBase(user_id=user.id, name=body.name, description=body.description)
    db.add(kb)
    await db.commit()
    await db.refresh(kb)
    return KBResponse.model_validate(kb, from_attributes=True)


@router.patch("/{kb_id}")
async def update_kb(
    kb_id: uuid.UUID,
    body: KBUpdate,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb or kb.user_id != user.id:
        raise HTTPException(status_code=404, detail="知识库不存在")
    if body.name is not None:
        kb.name = body.name
    if body.description is not None:
        kb.description = body.description
    await db.commit()
    await db.refresh(kb)
    return KBResponse.model_validate(kb, from_attributes=True)


@router.delete("/{kb_id}", status_code=204)
async def delete_kb(
    kb_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb or kb.user_id != user.id:
        raise HTTPException(status_code=404, detail="知识库不存在")
    if kb.is_default:
        raise HTTPException(status_code=400, detail="默认知识库不能删除")
    await db.delete(kb)
    await db.commit()


# ─── Conversations CRUD ───────────────────────────────────────────────────────


@router.get("/{kb_id}/conversations")
async def list_conversations(
    kb_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(KBConversation)
        .where(KBConversation.kb_id == kb_id, KBConversation.user_id == user.id)
        .order_by(KBConversation.updated_at.desc())
        .limit(50)
    )
    convos = result.scalars().all()
    return [ConversationResponse.model_validate(c, from_attributes=True) for c in convos]


@router.post("/{kb_id}/conversations", status_code=201)
async def create_conversation(
    kb_id: uuid.UUID,
    body: ConversationCreate,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    convo = KBConversation(kb_id=kb_id, user_id=user.id, title=body.title)
    db.add(convo)
    await db.commit()
    await db.refresh(convo)
    return ConversationResponse.model_validate(convo, from_attributes=True)


@router.patch("/{kb_id}/conversations/{convo_id}")
async def update_conversation(
    kb_id: uuid.UUID,
    convo_id: uuid.UUID,
    body: ConversationUpdate,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    convo = await db.get(KBConversation, convo_id)
    if not convo or convo.user_id != user.id or convo.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="对话不存在")
    if body.title is not None:
        convo.title = body.title
    if body.messages is not None:
        convo.messages = body.messages
    await db.commit()
    await db.refresh(convo)
    return ConversationResponse.model_validate(convo, from_attributes=True)


@router.delete("/{kb_id}/conversations/{convo_id}", status_code=204)
async def delete_conversation(
    kb_id: uuid.UUID,
    convo_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    convo = await db.get(KBConversation, convo_id)
    if not convo or convo.user_id != user.id or convo.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="对话不存在")
    await db.delete(convo)
    await db.commit()
