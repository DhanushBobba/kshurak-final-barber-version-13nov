
import logging
import os
import re
import uuid
from datetime import date, datetime, time, timezone
from typing import Annotated
from uuid import UUID
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text, Time, func, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import Base, get_db
from app.models.barber_account import BarberAccount
logger = logging.getLogger("kshurak.barber.workers")
router = APIRouter(prefix="/api/v1/barber/workers", tags=["Barber Workers"])
security = HTTPBearer(auto_error=False)
SLOT_DURATION_MINUTES = 60
class BarberWorker(Base):
    __tablename__ = "barber_workers"
    __table_args__ = (
        CheckConstraint("years_experience BETWEEN 0 AND 80", name="worker_experience_check"),
        CheckConstraint("shift_end > shift_start", name="worker_shift_check"),
        CheckConstraint("jsonb_typeof(slot_availability) = 'object'", name="worker_slot_json_check"),
        CheckConstraint("jsonb_typeof(custom_breaks) = 'object'", name="worker_break_json_check"),
        Index("idx_barber_workers_barber_id", "barber_id"),
        Index("idx_barber_workers_active", "barber_id", "is_active"),
        {"schema": "public"},
    )
    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    barber_id = Column(PGUUID(as_uuid=True), ForeignKey("public.barber_accounts.id", ondelete="CASCADE"), nullable=False)
    full_name = Column(String(150), nullable=False)
    phone = Column(String(20), nullable=False)
    role = Column(String(50), nullable=False, default="Barber", server_default=text("'Barber'"))
    years_experience = Column(Integer, nullable=False, default=0, server_default=text("0"))
    specializations = Column(Text, nullable=True)
    shift_start = Column(Time, nullable=False, default=time(9, 0), server_default=text("'09:00'"))
    shift_end = Column(Time, nullable=False, default=time(21, 0), server_default=text("'21:00'"))
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    slot_availability = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    custom_breaks = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
class WorkerCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    phone: str = Field(min_length=10, max_length=20)
    role: str = Field(default="Barber", min_length=2, max_length=50)
    years_experience: int = Field(default=0, ge=0, le=80)
    specializations: str = Field(default="", max_length=2000)
    shift_start: time = time(9, 0)
    shift_end: time = time(21, 0)
    is_active: bool = True
    @field_validator("full_name", "role")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Enter at least two characters")
        return value
    @field_validator("phone")
    @classmethod
    def check_phone(cls, value: str) -> str:
        value = value.strip()
        digits = re.sub(r"\D", "", value)
        if not re.fullmatch(r"[0-9+\-\s()]{10,20}", value) or not 10 <= len(digits) <= 15:
            raise ValueError("Enter a valid phone number containing 10 to 15 digits")
        return value
    @model_validator(mode="after")
    def check_shift(self):
        if self.shift_start >= self.shift_end:
            raise ValueError("Shift end must be later than shift start")
        return self
class WorkerUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    phone: str | None = Field(default=None, min_length=10, max_length=20)
    role: str | None = Field(default=None, min_length=2, max_length=50)
    years_experience: int | None = Field(default=None, ge=0, le=80)
    specializations: str | None = Field(default=None, max_length=2000)
    shift_start: time | None = None
    shift_end: time | None = None
    is_active: bool | None = None
    @model_validator(mode="after")
    def check_nulls(self):
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self
class WorkerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    barber_id: UUID
    full_name: str
    phone: str
    role: str
    years_experience: int
    specializations: str | None
    shift_start: time
    shift_end: time
    is_active: bool
    created_at: datetime
    updated_at: datetime
class BreakInput(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    start: time
    end: time
    @model_validator(mode="after")
    def check_break(self):
        if self.start >= self.end:
            raise ValueError("Break end must be after break start")
        return self
class SlotUpdate(BaseModel):
    slots: dict[str, bool] = Field(default_factory=dict)
    breaks: list[BreakInput] = Field(default_factory=list, max_length=20)
    @field_validator("slots")
    @classmethod
    def check_slots(cls, value: dict[str, bool]) -> dict[str, bool]:
        if len(value) > 48:
            raise ValueError("Too many slot overrides")
        for slot in value:
            if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", slot):
                raise ValueError(f"Invalid time slot: {slot}")
        return value
class SlotResponse(BaseModel):
    worker_id: UUID
    date: date
    shift_start: time
    shift_end: time
    slot_duration_minutes: int
    slots: dict[str, bool]
    breaks: list[BreakInput]
def minutes(value: time) -> int:
    return value.hour * 60 + value.minute
def slot_keys(worker: BarberWorker) -> list[str]:
    start = minutes(worker.shift_start)
    end = minutes(worker.shift_end)
    return [f"{minute // 60:02d}:{minute % 60:02d}" for minute in range(start, end - SLOT_DURATION_MINUTES + 1, SLOT_DURATION_MINUTES)]
def validate_schedule(worker: BarberWorker, payload: SlotUpdate) -> None:
    allowed = set(slot_keys(worker))
    for slot in payload.slots:
        if slot not in allowed:
            raise HTTPException(status_code=422, detail=f"Slot {slot} is outside the worker's shift")
    breaks = sorted(payload.breaks, key=lambda item: item.start)
    for item in breaks:
        if item.start < worker.shift_start or item.end > worker.shift_end:
            raise HTTPException(status_code=422, detail="Custom breaks must be within the worker's shift")
    for previous, current in zip(breaks, breaks[1:]):
        if current.start < previous.end:
            raise HTTPException(status_code=422, detail="Custom breaks cannot overlap")
def serialize_slots(worker: BarberWorker, work_date: date) -> SlotResponse:
    day = work_date.isoformat()
    stored_slots = worker.slot_availability or {}
    stored_breaks = worker.custom_breaks or {}
    overrides = stored_slots.get(day, {})
    raw_breaks = stored_breaks.get(day, [])
    if not isinstance(overrides, dict):
        overrides = {}
    if not isinstance(raw_breaks, list):
        raw_breaks = []
    parsed_breaks = [BreakInput.model_validate(item) for item in raw_breaks]
    result = {}
    for slot in slot_keys(worker):
        start = int(slot[:2]) * 60 + int(slot[3:])
        end = start + SLOT_DURATION_MINUTES
        blocked = any(start < minutes(item.end) and end > minutes(item.start) for item in parsed_breaks)
        result[slot] = bool(worker.is_active and not blocked and overrides.get(slot, True))
    return SlotResponse(worker_id=worker.id, date=work_date, shift_start=worker.shift_start, shift_end=worker.shift_end, slot_duration_minutes=SLOT_DURATION_MINUTES, slots=result, breaks=parsed_breaks)
def get_barber_id(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)]) -> UUID:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Barber authentication required")
    secret = os.getenv("BARBER_JWT_SECRET", "")
    if not secret:
        logger.error("BARBER_JWT_SECRET is not configured")
        raise HTTPException(status_code=503, detail="Authentication configuration unavailable")
    try:
        payload = jwt.decode(credentials.credentials, secret, algorithms=["HS256"], options={"require": ["sub", "exp"]})
        if payload.get("type") != "barber_access":
            raise HTTPException(status_code=401, detail="Invalid barber token type")
        return UUID(str(payload["sub"]))
    except (jwt.InvalidTokenError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired barber token") from exc
async def get_approved_barber(barber_id: Annotated[UUID, Depends(get_barber_id)], db: Annotated[AsyncSession, Depends(get_db)]) -> UUID:
    try:
        result = await db.execute(select(BarberAccount).where(BarberAccount.id == barber_id))
        barber = result.scalar_one_or_none()
    except SQLAlchemyError as exc:
        logger.exception("Barber account lookup failed")
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    if barber is None:
        raise HTTPException(status_code=401, detail="Barber account not found")
    if barber.approval_status != "approved" or not barber.is_email_activated:
        raise HTTPException(status_code=403, detail="Barber account is not approved and activated")
    return barber_id
async def find_worker(db: AsyncSession, barber_id: UUID, worker_id: UUID, lock: bool = False) -> BarberWorker:
    query = select(BarberWorker).where(BarberWorker.id == worker_id, BarberWorker.barber_id == barber_id)
    if lock:
        query = query.with_for_update()
    result = await db.execute(query)
    worker = result.scalar_one_or_none()
    if worker is None:
        raise HTTPException(status_code=404, detail="Worker not found")
    return worker
@router.get("", response_model=list[WorkerResponse])
async def list_workers(barber_id: Annotated[UUID, Depends(get_approved_barber)], db: Annotated[AsyncSession, Depends(get_db)]):
    try:
        result = await db.execute(select(BarberWorker).where(BarberWorker.barber_id == barber_id).order_by(BarberWorker.created_at, BarberWorker.id))
        return result.scalars().all()
    except SQLAlchemyError as exc:
        logger.exception("Failed to list workers")
        raise HTTPException(status_code=503, detail="Unable to load workers") from exc
@router.post("", response_model=WorkerResponse, status_code=status.HTTP_201_CREATED)
async def create_worker(payload: WorkerCreate, barber_id: Annotated[UUID, Depends(get_approved_barber)], db: Annotated[AsyncSession, Depends(get_db)]):
    worker = BarberWorker(barber_id=barber_id, **payload.model_dump())
    try:
        db.add(worker)
        await db.commit()
        await db.refresh(worker)
        return worker
    except IntegrityError as exc:
        await db.rollback()
        logger.exception("Worker creation conflict")
        raise HTTPException(status_code=409, detail="Worker data conflicts with a database constraint") from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Failed to create worker")
        raise HTTPException(status_code=503, detail="Unable to create worker") from exc
@router.patch("/{worker_id}", response_model=WorkerResponse)
async def update_worker(worker_id: UUID, payload: WorkerUpdate, barber_id: Annotated[UUID, Depends(get_approved_barber)], db: Annotated[AsyncSession, Depends(get_db)]):
    try:
        worker = await find_worker(db, barber_id, worker_id, lock=True)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(worker, field, value)
        if worker.shift_start >= worker.shift_end:
            raise HTTPException(status_code=422, detail="Shift end must be after shift start")
        await db.commit()
        await db.refresh(worker)
        return worker
    except HTTPException:
        await db.rollback()
        raise
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Failed to update worker")
        raise HTTPException(status_code=503, detail="Unable to update worker") from exc
@router.get("/{worker_id}/slots/{work_date}", response_model=SlotResponse)
async def get_slots(worker_id: UUID, work_date: date, barber_id: Annotated[UUID, Depends(get_approved_barber)], db: Annotated[AsyncSession, Depends(get_db)]):
    try:
        worker = await find_worker(db, barber_id, worker_id)
        return serialize_slots(worker, work_date)
    except SQLAlchemyError as exc:
        logger.exception("Failed to fetch worker slots")
        raise HTTPException(status_code=503, detail="Unable to load slots") from exc
@router.put("/{worker_id}/slots/{work_date}", response_model=SlotResponse)
async def save_slots(worker_id: UUID, work_date: date, payload: SlotUpdate, barber_id: Annotated[UUID, Depends(get_approved_barber)], db: Annotated[AsyncSession, Depends(get_db)]):
    if work_date < datetime.now(timezone.utc).date():
        raise HTTPException(status_code=422, detail="Cannot change past dates")
    try:
        worker = await find_worker(db, barber_id, worker_id, lock=True)
        if not worker.is_active:
            raise HTTPException(status_code=409, detail="Activate the worker before changing slots")
        validate_schedule(worker, payload)
        day = work_date.isoformat()
        slot_data = dict(worker.slot_availability or {})
        break_data = dict(worker.custom_breaks or {})
        slot_data[day] = dict(payload.slots)
        break_data[day] = [{"id": item.id, "start": item.start.strftime("%H:%M"), "end": item.end.strftime("%H:%M")} for item in payload.breaks]
        worker.slot_availability = slot_data
        worker.custom_breaks = break_data
        await db.commit()
        await db.refresh(worker)
        return serialize_slots(worker, work_date)
    except HTTPException:
        await db.rollback()
        raise
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Failed to save slots")
        raise HTTPException(status_code=503, detail="Unable to save worker slots") from exc
