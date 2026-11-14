"""
KSHURAK barber rescheduling API.

Existing routes remain available.

Additional routes:
GET  /eligible-bookings
POST /worker-unavailability

The worker-unavailability workflow is disabled by default until
the customer decision endpoint supports explicit option selection.
"""

import json
import logging
import os

from datetime import date, datetime, time
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.barber.api.barber_workers import get_approved_barber

# Reuse the existing canonical slot validation.
# This checks shop hours, worker availability, service duration,
# one-hour start intervals and pending/confirmed booking conflicts.
from app.customer.api.booking_management import (
    lock_booking_days,
    validate_requested_slot,
)

from app.services.rescheduling_policy import (
    SAME_WORKER_OTHER_DAY,
    barber_reschedule_eligibility,
    current_utc,
    normalize_reason,
    normalize_recovery_options,
    normalize_time,
    require_barber_reschedule_eligibility,
    require_original_booking_unchanged,
    require_upcoming_confirmed_booking,
)


logger = logging.getLogger("kshurak.barber.rescheduling")

router = APIRouter(
    prefix="/api/v1/barber/rescheduling",
    tags=["Barber Rescheduling"],
)

RescheduleStatus = Literal[
    "pending",
    "approved",
    "declined",
    "cancelled",
]

RequestKind = Literal[
    "appointment_change",
    "worker_unavailability",
]

OptionType = Literal[
    "cancel_booking",
    "same_worker_other_day",
    "other_worker_same_day",
]

Database = Annotated[AsyncSession, Depends(get_db)]
ApprovedBarber = Annotated[UUID, Depends(get_approved_barber)]


# ============================================================
# REQUEST MODELS
# ============================================================

class CreateRescheduleRequest(BaseModel):
    booking_id: UUID
    requested_date: date
    requested_start_time: time
    requested_end_time: time
    requested_worker_id: UUID | None = None
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("reason", mode="before")
    @classmethod
    def clean_reason(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator(
        "requested_start_time",
        "requested_end_time",
    )
    @classmethod
    def clean_time(cls, value: time) -> time:
        if value.tzinfo is not None:
            raise ValueError("Use local shop times without a timezone.")

        if value.second or value.microsecond:
            raise ValueError("Appointment times must use whole minutes.")

        return value

    @model_validator(mode="after")
    def validate_times(self):
        if self.requested_end_time <= self.requested_start_time:
            raise ValueError("End time must be after start time.")

        return self


class RecoveryOptionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    option_type: OptionType
    worker_id: UUID | None = None
    appointment_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None


class WorkerUnavailabilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    booking_id: UUID
    reason: str = Field(min_length=3, max_length=1000)
    options: list[RecoveryOptionInput] = Field(
        min_length=3,
        max_length=3,
    )

    @field_validator("reason", mode="before")
    @classmethod
    def clean_reason(cls, value):
        return value.strip() if isinstance(value, str) else value


class DecisionRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


# ============================================================
# RESPONSE MODELS
# ============================================================

class RecoveryOptionResponse(BaseModel):
    id: UUID
    request_id: UUID
    option_type: OptionType
    worker_id: UUID | None = None
    appointment_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    created_at: datetime


class RescheduleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    booking_id: UUID
    requested_by: Literal["barber", "customer"]

    requested_date: date
    requested_start_time: time
    requested_end_time: time
    requested_worker_id: UUID | None

    original_date: date
    original_start_time: time
    original_end_time: time
    original_worker_id: UUID | None

    status: RescheduleStatus
    reason: str | None
    decision_reason: str | None
    decided_by: str | None
    decided_at: datetime | None
    created_at: datetime
    updated_at: datetime

    customer_name: str
    customer_phone: str
    service_name: str
    service_price: float
    booking_status: str

    request_kind: RequestKind = "appointment_change"
    selected_option_type: OptionType | None = None
    options: list[RecoveryOptionResponse] = Field(
        default_factory=list
    )


class RescheduleListResponse(BaseModel):
    requests: list[RescheduleResponse]
    total: int
    counts: dict[str, int]


class RescheduleActionResponse(BaseModel):
    message: str
    request: RescheduleResponse


# ============================================================
# QUERIES AND HELPERS
# ============================================================

RESCHEDULE_SELECT = """
    SELECT
        r.*,
        b.customer_name,
        b.customer_phone,
        b.service_name,
        b.service_price,
        b.status AS booking_status,
        COALESCE(
            (
                SELECT jsonb_agg(
                    to_jsonb(option_row)
                    ORDER BY option_row.option_type
                )
                FROM public.barber_reschedule_options option_row
                WHERE option_row.request_id = r.id
            ),
            '[]'::jsonb
        ) AS options
    FROM public.barber_reschedule_requests r
    JOIN public.barber_bookings b
        ON b.id = r.booking_id
    WHERE b.barber_id = :barber_id
"""


def barber_uuid(barber: UUID | object) -> UUID:
    raw_id = barber if isinstance(barber, UUID) else getattr(
        barber,
        "id",
        None,
    )

    try:
        return UUID(str(raw_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid barber authentication context.",
        ) from exc


def as_response(row) -> RescheduleResponse:
    result = dict(row)

    # Handle both decoded JSONB and drivers returning JSON strings.
    if isinstance(result.get("options"), str):
        result["options"] = json.loads(result["options"])

    return RescheduleResponse.model_validate(result)


def require_recovery_enabled() -> None:
    enabled = os.getenv(
        "BARBER_RECOVERY_OPTIONS_ENABLED",
        "false",
    ).strip().lower()

    if enabled not in {"true", "1", "yes"}:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "RECOVERY_WORKFLOW_NOT_ENABLED",
                "message": (
                    "Three-option proposals are not enabled yet. "
                    "The customer decision endpoint must be "
                    "updated before enabling this workflow."
                ),
            },
        )


async def fetch_booking(
    db: AsyncSession,
    barber_id: UUID,
    booking_id: UUID,
    *,
    lock: bool = False,
) -> dict:
    query = """
        SELECT *
        FROM public.barber_bookings
        WHERE id = :booking_id
          AND barber_id = :barber_id
    """

    if lock:
        query += " FOR UPDATE"

    result = await db.execute(
        text(query),
        {
            "booking_id": booking_id,
            "barber_id": barber_id,
        },
    )

    row = result.mappings().first()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Booking not found for this barber.",
        )

    return dict(row)


async def fetch_request(
    db: AsyncSession,
    barber_id: UUID,
    request_id: UUID,
    *,
    lock: bool = False,
) -> dict:
    query = RESCHEDULE_SELECT + " AND r.id = :request_id"

    if lock:
        query += " FOR UPDATE OF r"

    result = await db.execute(
        text(query),
        {
            "barber_id": barber_id,
            "request_id": request_id,
        },
    )

    row = result.mappings().first()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Rescheduling request not found.",
        )

    return dict(row)


async def lock_booking_for_change(
    db: AsyncSession,
    barber_id: UUID,
    booking_id: UUID,
    proposed_days: list[date],
) -> dict:
    initial = await fetch_booking(
        db,
        barber_id,
        booking_id,
    )

    await lock_booking_days(
        db,
        barber_id,
        [initial["booking_date"], *proposed_days],
    )

    booking = await fetch_booking(
        db,
        barber_id,
        booking_id,
        lock=True,
    )

    # A concurrent reschedule may have moved the booking
    # to a day outside the acquired day locks.
    if booking["booking_date"] != initial["booking_date"]:
        raise HTTPException(
            status_code=409,
            detail="The booking changed. Refresh and try again.",
        )

    return booking


async def require_no_pending_request(
    db: AsyncSession,
    booking_id: UUID,
) -> None:
    result = await db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1
                FROM public.barber_reschedule_requests
                WHERE booking_id = :booking_id
                  AND status = 'pending'
            )
        """),
        {"booking_id": booking_id},
    )

    if result.scalar():
        raise HTTPException(
            status_code=409,
            detail=(
                "This booking already has a pending "
                "reschedule request."
            ),
        )


async def insert_request(
    db: AsyncSession,
    booking: dict,
    *,
    requested_date: date,
    requested_start_time: time,
    requested_end_time: time,
    requested_worker_id: UUID,
    reason: str,
    request_kind: RequestKind,
) -> UUID:
    result = await db.execute(
        text("""
            INSERT INTO public.barber_reschedule_requests (
                booking_id,
                requested_by,
                requested_date,
                requested_start_time,
                requested_end_time,
                requested_worker_id,
                original_date,
                original_start_time,
                original_end_time,
                original_worker_id,
                status,
                reason,
                request_kind
            )
            VALUES (
                :booking_id,
                'barber',
                :requested_date,
                :requested_start_time,
                :requested_end_time,
                :requested_worker_id,
                :original_date,
                :original_start_time,
                :original_end_time,
                :original_worker_id,
                'pending',
                :reason,
                :request_kind
            )
            RETURNING id
        """),
        {
            "booking_id": booking["id"],
            "requested_date": requested_date,
            "requested_start_time": requested_start_time,
            "requested_end_time": requested_end_time,
            "requested_worker_id": requested_worker_id,
            "original_date": booking["booking_date"],
            "original_start_time": booking["start_time"],
            "original_end_time": booking["end_time"],
            "original_worker_id": booking["worker_id"],
            "reason": reason,
            "request_kind": request_kind,
        },
    )

    return result.scalar_one()


async def commit_action(
    db: AsyncSession,
    barber_id: UUID,
    request_id: UUID,
    message: str,
) -> RescheduleActionResponse:
    # Build the response before committing, avoiding a second
    # database lookup after a successful commit.
    row = await fetch_request(
        db,
        barber_id,
        request_id,
    )

    response = RescheduleActionResponse(
        message=message,
        request=as_response(row),
    )

    await db.commit()
    return response


async def handle_mutation_error(
    db: AsyncSession,
    exc: Exception,
    message: str,
) -> None:
    await db.rollback()

    if isinstance(exc, HTTPException):
        raise exc

    if isinstance(exc, IntegrityError):
        logger.warning(
            "%s: database constraint conflict",
            message,
        )
        raise HTTPException(
            status_code=409,
            detail=(
                "The request conflicts with the current booking "
                "or application data. Refresh and try again."
            ),
        ) from exc

    logger.error(
        message,
        exc_info=(type(exc), exc, exc.__traceback__),
    )

    raise HTTPException(
        status_code=503,
        detail=message,
    ) from exc


# ============================================================
# ELIGIBLE BOOKINGS
#
# Keep this static route before /{request_id}.
# ============================================================

@router.get("/eligible-bookings")
async def eligible_bookings(
    db: Database,
    barber: ApprovedBarber,
):
    barber_id = barber_uuid(barber)
    checked_at = current_utc()

    try:
        result = await db.execute(
            text("""
                SELECT
                    b.*,
                    w.full_name AS worker_name
                FROM public.barber_bookings b
                LEFT JOIN public.barber_workers w
                    ON w.id = b.worker_id
                   AND w.barber_id = b.barber_id
                WHERE b.barber_id = :barber_id
                  AND b.status = 'confirmed'
                  AND b.worker_id IS NOT NULL
                  AND b.customer_id IS NOT NULL
                  AND b.confirmed_at IS NOT NULL
                  AND b.confirmed_at <=
                      CAST(:checked_at AS timestamptz)
                  AND b.confirmed_at >
                      CAST(:checked_at AS timestamptz)
                      - INTERVAL '24 hours'
                  AND (
                      (b.booking_date + b.start_time)
                      AT TIME ZONE 'Asia/Kolkata'
                  ) > CAST(:checked_at AS timestamptz)
                  AND NOT EXISTS (
                      SELECT 1
                      FROM public.barber_reschedule_requests r
                      WHERE r.booking_id = b.id
                        AND r.status = 'pending'
                  )
                ORDER BY
                    b.booking_date,
                    b.start_time,
                    b.id
                LIMIT 500
            """),
            {
                "barber_id": barber_id,
                "checked_at": checked_at,
            },
        )

        bookings = []

        for row in result.mappings():
            booking = dict(row)

            eligibility = barber_reschedule_eligibility(
                booking,
                now=checked_at,
            )

            if not eligibility["eligible"]:
                continue

            booking["reschedule_deadline"] = eligibility[
                "deadline"
            ]
            bookings.append(booking)

        return {
            "bookings": bookings,
            "total": len(bookings),
            "server_time": checked_at,
            "limit": 500,
        }

    except SQLAlchemyError as exc:
        logger.exception("Unable to retrieve eligible bookings")

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve eligible bookings.",
        ) from exc


# ============================================================
# LIST REQUESTS
# ============================================================

@router.get("", response_model=RescheduleListResponse)
async def list_reschedules(
    db: Database,
    barber: ApprovedBarber,
    request_status: Annotated[
        RescheduleStatus | None,
        Query(alias="status"),
    ] = None,
):
    barber_id = barber_uuid(barber)
    params = {"barber_id": barber_id}
    filters = ""

    if request_status is not None:
        filters = " AND r.status = :request_status"
        params["request_status"] = request_status

    try:
        result = await db.execute(
            text(
                RESCHEDULE_SELECT
                + filters
                + " ORDER BY r.created_at DESC, r.id DESC LIMIT 1000"
            ),
            params,
        )

        requests = [
            as_response(row)
            for row in result.mappings().all()
        ]

        count_result = await db.execute(
            text("""
                SELECT r.status, COUNT(*) AS total
                FROM public.barber_reschedule_requests r
                JOIN public.barber_bookings b
                    ON b.id = r.booking_id
                WHERE b.barber_id = :barber_id
                GROUP BY r.status
            """),
            {"barber_id": barber_id},
        )

        counts = {
            "pending": 0,
            "approved": 0,
            "declined": 0,
            "cancelled": 0,
        }

        for row in count_result.mappings():
            counts[str(row["status"])] = int(row["total"])

        return RescheduleListResponse(
            requests=requests,
            total=sum(counts.values()),
            counts=counts,
        )

    except SQLAlchemyError as exc:
        logger.exception("Unable to list reschedules")

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve rescheduling requests.",
        ) from exc


# ============================================================
# CREATE NORMAL BARBER PROPOSAL
# ============================================================

@router.post(
    "",
    response_model=RescheduleActionResponse,
    status_code=201,
)
async def create_reschedule(
    payload: CreateRescheduleRequest,
    db: Database,
    barber: ApprovedBarber,
):
    barber_id = barber_uuid(barber)

    try:
        booking = await lock_booking_for_change(
            db,
            barber_id,
            payload.booking_id,
            [payload.requested_date],
        )

        require_barber_reschedule_eligibility(booking)

        if booking["customer_id"] is None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "The booking must be linked to a customer "
                    "account before requesting customer approval."
                ),
            )

        worker_id = (
            payload.requested_worker_id
            or booking["worker_id"]
        )

        if worker_id is None:
            raise HTTPException(
                status_code=409,
                detail="A worker must be assigned first.",
            )

        if (
            payload.requested_date == booking["booking_date"]
            and payload.requested_start_time
            == booking["start_time"]
            and payload.requested_end_time
            == booking["end_time"]
            and worker_id == booking["worker_id"]
        ):
            raise HTTPException(
                status_code=422,
                detail=(
                    "The proposed appointment matches "
                    "the current booking."
                ),
            )

        await require_no_pending_request(
            db,
            booking["id"],
        )

        await validate_requested_slot(
            db,
            booking,
            worker_id,
            payload.requested_date,
            payload.requested_start_time,
            payload.requested_end_time,
        )

        # Recheck after database validation in case the window
        # expired while this request was being processed.
        require_barber_reschedule_eligibility(booking)

        request_id = await insert_request(
            db,
            booking,
            requested_date=payload.requested_date,
            requested_start_time=payload.requested_start_time,
            requested_end_time=payload.requested_end_time,
            requested_worker_id=worker_id,
            reason=normalize_reason(payload.reason),
            request_kind="appointment_change",
        )

        return await commit_action(
            db,
            barber_id,
            request_id,
            (
                "Proposal created. The original booking remains "
                "unchanged until customer approval."
            ),
        )

    except (HTTPException, SQLAlchemyError) as exc:
        await handle_mutation_error(
            db,
            exc,
            "Unable to create rescheduling request.",
        )


# ============================================================
# CREATE THREE-OPTION WORKER UNAVAILABILITY PROPOSAL
# ============================================================

@router.post(
    "/worker-unavailability",
    response_model=RescheduleActionResponse,
    status_code=201,
)
async def create_worker_unavailability(
    payload: WorkerUnavailabilityRequest,
    db: Database,
    barber: ApprovedBarber,
):
    require_recovery_enabled()
    barber_id = barber_uuid(barber)

    try:
        proposed_days = [
            option.appointment_date
            for option in payload.options
            if option.appointment_date is not None
        ]

        booking = await lock_booking_for_change(
            db,
            barber_id,
            payload.booking_id,
            proposed_days,
        )

        require_barber_reschedule_eligibility(booking)

        if booking["customer_id"] is None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "This booking is not linked to a customer "
                    "account that can select a recovery option."
                ),
            )

        options = normalize_recovery_options(
            booking,
            [
                option.model_dump()
                for option in payload.options
            ],
        )

        await require_no_pending_request(
            db,
            booking["id"],
        )

        for option in options:
            if option["option_type"] == "cancel_booking":
                continue

            await validate_requested_slot(
                db,
                booking,
                option["worker_id"],
                option["appointment_date"],
                option["start_time"],
                option["end_time"],
            )

        require_barber_reschedule_eligibility(booking)

        # The old table requires a requested appointment.
        # Store the same-worker option in those legacy fields.
        # For this request kind, the options table is authoritative;
        # the customer must explicitly select an option.
        primary_option = next(
            option
            for option in options
            if option["option_type"] == SAME_WORKER_OTHER_DAY
        )

        request_id = await insert_request(
            db,
            booking,
            requested_date=primary_option["appointment_date"],
            requested_start_time=primary_option["start_time"],
            requested_end_time=primary_option["end_time"],
            requested_worker_id=primary_option["worker_id"],
            reason=normalize_reason(payload.reason),
            request_kind="worker_unavailability",
        )

        await db.execute(
            text("""
                INSERT INTO public.barber_reschedule_options (
                    request_id,
                    option_type,
                    worker_id,
                    appointment_date,
                    start_time,
                    end_time
                )
                VALUES (
                    :request_id,
                    :option_type,
                    :worker_id,
                    :appointment_date,
                    :start_time,
                    :end_time
                )
            """),
            [
                {
                    "request_id": request_id,
                    **option,
                }
                for option in options
            ],
        )

        return await commit_action(
            db,
            barber_id,
            request_id,
            (
                "Three recovery options submitted. "
                "The original booking remains unchanged "
                "until the customer selects an option."
            ),
        )

    except (HTTPException, SQLAlchemyError) as exc:
        await handle_mutation_error(
            db,
            exc,
            "Unable to submit worker-unavailability options.",
        )


# ============================================================
# GET ONE REQUEST
# ============================================================

@router.get(
    "/{request_id}",
    response_model=RescheduleResponse,
)
async def get_reschedule(
    request_id: UUID,
    db: Database,
    barber: ApprovedBarber,
):
    try:
        row = await fetch_request(
            db,
            barber_uuid(barber),
            request_id,
        )

        return as_response(row)

    except SQLAlchemyError as exc:
        logger.exception("Unable to fetch reschedule")

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve rescheduling request.",
        ) from exc


# ============================================================
# BARBER DECIDES A CUSTOMER-CREATED REQUEST
# ============================================================

async def decide_reschedule(
    db: AsyncSession,
    barber_id: UUID,
    request_id: UUID,
    *,
    approve: bool,
    reason: str | None,
) -> RescheduleActionResponse:
    try:
        initial = await fetch_request(
            db,
            barber_id,
            request_id,
        )

        await lock_booking_days(
            db,
            barber_id,
            [
                initial["original_date"],
                initial["requested_date"],
            ],
        )

        booking = await fetch_booking(
            db,
            barber_id,
            initial["booking_id"],
            lock=True,
        )

        request = await fetch_request(
            db,
            barber_id,
            request_id,
            lock=True,
        )

        if request["status"] != "pending":
            raise HTTPException(
                status_code=409,
                detail="This request has already been decided.",
            )

        if request["requested_by"] != "customer":
            raise HTTPException(
                status_code=403,
                detail=(
                    "Barbers cannot approve or decline their "
                    "own proposals. Customer approval is required."
                ),
            )

        if request["request_kind"] != "appointment_change":
            raise HTTPException(
                status_code=409,
                detail="This request requires the recovery workflow.",
            )

        if approve:
            # Customer-created requests retain their existing
            # approval flow; the barber initiation window does
            # not apply to customer-initiated changes.
            require_upcoming_confirmed_booking(booking)

            require_original_booking_unchanged(
                booking,
                request,
            )

            worker_id = (
                request["requested_worker_id"]
                or booking["worker_id"]
            )

            if worker_id is None:
                raise HTTPException(
                    status_code=409,
                    detail="No worker is assigned to this request.",
                )

            requested_start = normalize_time(
                request["requested_start_time"],
                "Requested start time",
            )
            requested_end = normalize_time(
                request["requested_end_time"],
                "Requested end time",
            )

            await validate_requested_slot(
                db,
                booking,
                worker_id,
                request["requested_date"],
                requested_start,
                requested_end,
            )

            await db.execute(
                text("""
                    UPDATE public.barber_bookings
                    SET
                        booking_date = :requested_date,
                        start_time = :requested_start_time,
                        end_time = :requested_end_time,
                        worker_id = :worker_id,
                        updated_at = NOW()
                    WHERE id = :booking_id
                      AND barber_id = :barber_id
                      AND status = 'confirmed'
                """),
                {
                    "requested_date": request["requested_date"],
                    "requested_start_time": requested_start,
                    "requested_end_time": requested_end,
                    "worker_id": worker_id,
                    "booking_id": booking["id"],
                    "barber_id": barber_id,
                },
            )

        await db.execute(
            text("""
                UPDATE public.barber_reschedule_requests
                SET
                    status = :new_status,
                    decision_reason = :reason,
                    decided_by = 'barber',
                    decided_at = NOW(),
                    updated_at = NOW()
                WHERE id = :request_id
                  AND status = 'pending'
            """),
            {
                "new_status": (
                    "approved" if approve else "declined"
                ),
                "reason": reason.strip() if reason else None,
                "request_id": request_id,
            },
        )

        return await commit_action(
            db,
            barber_id,
            request_id,
            (
                "Customer reschedule request approved."
                if approve
                else (
                    "Request declined. "
                    "The original booking is unchanged."
                )
            ),
        )

    except (HTTPException, SQLAlchemyError) as exc:
        await handle_mutation_error(
            db,
            exc,
            "Unable to process rescheduling request.",
        )


@router.post(
    "/{request_id}/approve",
    response_model=RescheduleActionResponse,
)
async def approve_reschedule(
    request_id: UUID,
    db: Database,
    barber: ApprovedBarber,
):
    return await decide_reschedule(
        db,
        barber_uuid(barber),
        request_id,
        approve=True,
        reason=None,
    )


@router.post(
    "/{request_id}/decline",
    response_model=RescheduleActionResponse,
)
async def decline_reschedule(
    request_id: UUID,
    payload: DecisionRequest,
    db: Database,
    barber: ApprovedBarber,
):
    return await decide_reschedule(
        db,
        barber_uuid(barber),
        request_id,
        approve=False,
        reason=payload.reason,
    )


# ============================================================
# WITHDRAW A BARBER-CREATED PROPOSAL
# ============================================================

@router.post(
    "/{request_id}/withdraw",
    response_model=RescheduleActionResponse,
)
async def withdraw_reschedule(
    request_id: UUID,
    db: Database,
    barber: ApprovedBarber,
):
    barber_id = barber_uuid(barber)

    try:
        request = await fetch_request(
            db,
            barber_id,
            request_id,
            lock=True,
        )

        if request["requested_by"] != "barber":
            raise HTTPException(
                status_code=403,
                detail=(
                    "Only barber-created proposals can "
                    "be withdrawn by the barber."
                ),
            )

        if request["status"] != "pending":
            raise HTTPException(
                status_code=409,
                detail="Only pending proposals can be withdrawn.",
            )

        await db.execute(
            text("""
                UPDATE public.barber_reschedule_requests
                SET
                    status = 'cancelled',
                    decision_reason = 'Withdrawn by barber',
                    decided_by = 'barber',
                    decided_at = NOW(),
                    updated_at = NOW()
                WHERE id = :request_id
                  AND status = 'pending'
            """),
            {"request_id": request_id},
        )

        return await commit_action(
            db,
            barber_id,
            request_id,
            (
                "Proposal withdrawn. "
                "The original booking is unchanged."
            ),
        )

    except (HTTPException, SQLAlchemyError) as exc:
        await handle_mutation_error(
            db,
            exc,
            "Unable to withdraw rescheduling request.",
        )
