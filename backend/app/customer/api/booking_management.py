"""
KSHURAK customer booking and rescheduling management.

Customer initiation:
- Only confirmed, upcoming bookings.
- Strictly before original confirmed_at + 24 hours.
- Reschedule to another day with the same worker or another
  available worker at the same shop.
- Barber approval is required.

Barber recovery proposals retain their explicit-choice flow.

Cancellation closes pending proposals.
Rescheduling never resets confirmed_at.
"""

import json
import logging

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

from app.customer.api.customer_session import (
    get_authenticated_customer,
)

from app.customer.api.booking_slots import (
    SHOP_TIMEZONE,
    MAX_ADVANCE_DAYS,
    SLOT_INTERVAL_MINUTES,
    is_day_open,
    minutes,
    schedule_allows,
)

from app.services.rescheduling_policy import (
    CANCEL_BOOKING,
    SAME_WORKER_OTHER_DAY,
    OTHER_WORKER_SAME_DAY,
    appointment_timestamp,
    current_utc,
    confirmation_timestamp,
    normalize_time,
    require_barber_reschedule_eligibility,
    require_original_booking_unchanged,
    require_upcoming_confirmed_booking,
)


logger = logging.getLogger(
    "kshurak.customer.booking_management"
)

router = APIRouter(
    prefix="/api/v1/customer/bookings",
    tags=["Customer Booking Management"],
)

Database = Annotated[AsyncSession, Depends(get_db)]

Customer = Annotated[
    dict,
    Depends(get_authenticated_customer),
]

CUSTOMER_CHANGE_WINDOW = timedelta(hours=24)

OptionType = Literal[
    "cancel_booking",
    "same_worker_other_day",
    "other_worker_same_day",
]


# ============================================================
# RESPONSE AND REQUEST MODELS
# ============================================================

class MyBooking(BaseModel):
    id: UUID
    barber_id: UUID
    worker_id: UUID | None
    customer_id: UUID

    customer_name: str
    customer_phone: str | None = None
    worker_name: str | None = None

    service_name: str
    service_duration_minutes: int
    service_price: Decimal

    booking_date: date
    start_time: time
    end_time: time

    status: str
    confirmed_at: datetime | None = None
    customer_notes: str | None = None

    cancellation_reason: str | None = None
    cancelled_by: str | None = None
    cancelled_at: datetime | None = None
    completed_at: datetime | None = None

    terms_version: str | None = None
    terms_accepted_at: datetime | None = None

    has_pending_request: bool = False
    change_eligible: bool = False
    can_reschedule: bool = False
    can_cancel: bool = False
    change_window_ends_at: datetime | None = None
    change_block_code: str | None = None
    change_block_reason: str | None = None


class MyBookingsResponse(BaseModel):
    bookings: list[MyBooking]
    total: int
    server_time: datetime


class CancelBookingRequest(BaseModel):
    reason: str = Field(
        min_length=3,
        max_length=1000,
    )

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        value = value.strip()

        if len(value) < 3:
            raise ValueError(
                "Please provide a cancellation reason "
                "of at least 3 characters."
            )

        return value


class CancelBookingResponse(BaseModel):
    message: str
    booking: MyBooking


class RescheduleCreate(BaseModel):
    requested_worker_id: UUID | None = None

    change_type: Literal[
        "same_worker_other_day",
        "other_worker_other_day",
    ] | None = None

    requested_date: date
    requested_start_time: time

    customer_reason: str | None = Field(
        default=None,
        max_length=500,
    )

    @field_validator("requested_start_time")
    @classmethod
    def validate_time(cls, value: time) -> time:
        if value.tzinfo is not None:
            raise ValueError(
                "Use a local shop time without a timezone."
            )

        if value.second or value.microsecond:
            raise ValueError(
                "Start time must use whole minutes."
            )

        return value

    @field_validator("customer_reason")
    @classmethod
    def clean_reason(
        cls,
        value: str | None,
    ) -> str | None:
        return value.strip() or None if value else None


class RecoveryOptionResponse(BaseModel):
    id: UUID
    request_id: UUID
    option_type: OptionType

    worker_id: UUID | None = None
    worker_name: str | None = None

    appointment_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None

    created_at: datetime


class RescheduleHistoryItem(BaseModel):
    id: UUID
    booking_id: UUID

    original_date: date
    original_start_time: time
    original_end_time: time

    requested_date: date
    requested_start_time: time
    requested_end_time: time

    status: str
    customer_reason: str | None = None
    barber_response: str | None = None

    requested_at: datetime
    reviewed_at: datetime | None = None

    service_name: str
    worker_name: str | None = None

    requested_by: str = "customer"

    original_worker_id: UUID | None = None
    requested_worker_id: UUID | None = None
    original_worker_name: str | None = None

    request_kind: str = "appointment_change"
    selected_option_type: OptionType | None = None
    booking_status: str
    reason: str | None = None

    options: list[RecoveryOptionResponse] = Field(
        default_factory=list,
    )


class RescheduleHistoryResponse(BaseModel):
    requests: list[RescheduleHistoryItem]
    total: int


class RescheduleCreateResponse(BaseModel):
    message: str
    request: RescheduleHistoryItem


class DecisionRequest(BaseModel):
    reason: str | None = Field(
        default=None,
        max_length=1000,
    )

    @field_validator("reason")
    @classmethod
    def clean_reason(
        cls,
        value: str | None,
    ) -> str | None:
        return value.strip() or None if value else None


class SelectRecoveryOptionRequest(DecisionRequest):
    option_type: OptionType


# ============================================================
# DATABASE QUERIES
# ============================================================

MY_BOOKINGS_QUERY = text("""
    SELECT
        b.*,
        w.full_name AS worker_name,
        EXISTS (
            SELECT 1
            FROM public.barber_reschedule_requests pending_request
            WHERE pending_request.booking_id = b.id
              AND pending_request.status = 'pending'
        ) AS has_pending_request
    FROM public.barber_bookings b
    LEFT JOIN public.barber_workers w
        ON w.id = b.worker_id
       AND w.barber_id = b.barber_id
    WHERE b.customer_id = :customer_id
ORDER BY b.created_at DESC NULLS LAST, b.id DESC
    LIMIT 500
""")


HISTORY_SELECT = """
    SELECT
        r.id,
        r.booking_id,
        r.original_date,
        r.original_start_time,
        r.original_end_time,
        r.original_worker_id,
        r.requested_worker_id,
        original_worker.full_name AS original_worker_name,
        r.requested_date,
        r.requested_start_time,
        r.requested_end_time,
        CASE
            WHEN r.status = 'declined' THEN 'rejected'
            ELSE r.status
        END AS status,
        r.reason AS customer_reason,
        r.reason,
        r.decision_reason AS barber_response,
        r.created_at AS requested_at,
        r.decided_at AS reviewed_at,
        r.requested_by,
        r.request_kind,
        r.selected_option_type,
        b.status AS booking_status,
        b.service_name,
        w.full_name AS worker_name,
        COALESCE(
            (
                SELECT jsonb_agg(
                    to_jsonb(option_details)
                    ORDER BY option_details.option_type
                )
                FROM (
                    SELECT
                        o.*,
                        ow.full_name AS worker_name
                    FROM public.barber_reschedule_options o
                    LEFT JOIN public.barber_workers ow
                        ON ow.id = o.worker_id
                       AND ow.barber_id = b.barber_id
                    WHERE o.request_id = r.id
                ) option_details
            ),
            '[]'::jsonb
        ) AS options
    FROM public.barber_reschedule_requests r
    JOIN public.barber_bookings b
        ON b.id = r.booking_id
    LEFT JOIN public.barber_workers w
        ON w.id = r.requested_worker_id
       AND w.barber_id = b.barber_id
    LEFT JOIN public.barber_workers original_worker
        ON original_worker.id = r.original_worker_id
       AND original_worker.barber_id = b.barber_id
    WHERE b.customer_id = :customer_id
"""


SHOP_QUERY = text("""
    SELECT
        app.opening_time,
        app.closing_time,
        app.working_days
    FROM public.barber_accounts ba
    JOIN public.barber_applications app
        ON app.barber_account_id = ba.id
    WHERE ba.id = :barber_id
      AND LOWER(ba.approval_status) = 'approved'
      AND ba.is_email_activated = TRUE
      AND app.location_verified = TRUE
      AND LOWER(app.setup_submission_status) = 'approved'
      AND app.published_at IS NOT NULL
    ORDER BY app.published_at DESC
    LIMIT 1
""")


WORKER_QUERY = text("""
    SELECT
        id,
        shift_start,
        shift_end,
        slot_availability,
        custom_breaks
    FROM public.barber_workers
    WHERE id = :worker_id
      AND barber_id = :barber_id
      AND is_active = TRUE
    LIMIT 1
""")


SERVICE_QUERY = text("""
    SELECT EXISTS (
        SELECT 1
        FROM public.barber_services
        WHERE barber_id = :barber_id
          AND LOWER(TRIM(service_name)) =
              LOWER(TRIM(:service_name))
          AND duration_minutes = :duration
          AND is_active = TRUE
    )
""")


CONFLICT_QUERY = text("""
    SELECT EXISTS (
        SELECT 1
        FROM public.barber_bookings
        WHERE barber_id = :barber_id
          AND worker_id = :worker_id
          AND booking_date = :booking_date
          AND id <> :booking_id
          AND LOWER(status) IN ('pending', 'confirmed')
          AND start_time < :end_time
          AND end_time > :start_time
    )
""")


# ============================================================
# CUSTOMER CHANGE POLICY
# ============================================================

def customer_change_eligibility(
    booking: dict,
    *,
    now: datetime | None = None,
) -> dict:
    checked_at = now if now is not None else current_utc()

    if (
        checked_at.tzinfo is None
        or checked_at.utcoffset() is None
    ):
        raise ValueError(
            "Eligibility checks require a timezone-aware timestamp."
        )

    checked_at = checked_at.astimezone(timezone.utc)
    confirmed_at = confirmation_timestamp(booking)

    deadline = (
        confirmed_at + CUSTOMER_CHANGE_WINDOW
        if confirmed_at is not None
        else None
    )

    result = {
        "change_eligible": False,
        "can_cancel": False,
        "can_reschedule": False,
        "change_window_ends_at": deadline,
        "change_block_code": None,
        "change_block_reason": None,
    }

    def blocked(code: str, message: str) -> dict:
        result.update(
            change_block_code=code,
            change_block_reason=message,
        )
        return result

    if booking.get("status") != "confirmed":
        return blocked(
            "BOOKING_NOT_CONFIRMED",
            "Only confirmed bookings can be cancelled or rescheduled.",
        )

    if appointment_timestamp(
        booking["booking_date"],
        booking["start_time"],
    ) <= checked_at:
        return blocked(
            "APPOINTMENT_ALREADY_STARTED",
            "The appointment has already started or is in the past.",
        )

    if confirmed_at is None:
        return blocked(
            "CONFIRMATION_TIMESTAMP_MISSING",
            "This booking has no valid confirmation timestamp. "
            "Please contact support.",
        )

    if confirmed_at > checked_at:
        return blocked(
            "CONFIRMATION_TIMESTAMP_INVALID",
            "The booking confirmation timestamp is invalid. "
            "Please contact support.",
        )

    # At exactly confirmed_at + 24 hours, initiation is closed.
    if checked_at >= deadline:
        return blocked(
            "CUSTOMER_CHANGE_WINDOW_CLOSED",
            "You can initiate cancellation or rescheduling only "
            "within 24 hours of the original booking confirmation "
            "and before the appointment starts.",
        )

    result.update(
        change_eligible=True,
        can_cancel=True,
        can_reschedule=True,
    )

    return result


def require_customer_change_eligibility(
    booking: dict,
) -> None:
    eligibility = customer_change_eligibility(booking)

    if not eligibility["change_eligible"]:
        deadline = eligibility["change_window_ends_at"]

        raise HTTPException(
            status_code=409,
            detail={
                "code": eligibility["change_block_code"],
                "message": eligibility["change_block_reason"],
                "deadline": (
                    deadline.isoformat()
                    if deadline is not None
                    else None
                ),
            },
        )


def booking_response(
    booking: dict,
    *,
    now: datetime | None = None,
) -> MyBooking:
    item = dict(booking)
    item.update(customer_change_eligibility(item, now=now))

    if (
        item.get("has_pending_request")
        and item["can_reschedule"]
    ):
        item.update(
            can_reschedule=False,
            change_block_code="PENDING_REQUEST_EXISTS",
            change_block_reason=(
                "This booking already has a pending reschedule "
                "request. You may still cancel within the "
                "eligible window."
            ),
        )

    return MyBooking.model_validate(item)


def customer_requested_worker(
    booking: dict,
    payload: RescheduleCreate,
) -> UUID:
    original_worker = booking.get("worker_id")

    if original_worker is None:
        raise HTTPException(
            status_code=409,
            detail="No worker is assigned to this booking.",
        )

    if payload.requested_date == booking["booking_date"]:
        raise HTTPException(
            status_code=422,
            detail=(
                "Customer rescheduling requires another appointment day."
            ),
        )

    worker_id = payload.requested_worker_id or original_worker
    same_worker = worker_id == original_worker

    if (
        payload.change_type == "same_worker_other_day"
        and not same_worker
    ):
        raise HTTPException(
            status_code=422,
            detail="Select the original professional for this option.",
        )

    if (
        payload.change_type == "other_worker_other_day"
        and same_worker
    ):
        raise HTTPException(
            status_code=422,
            detail="Select a different professional for this option.",
        )

    return worker_id


# ============================================================
# COMMON HELPERS
# ============================================================

def customer_uuid(customer: dict) -> UUID:
    try:
        return UUID(str(customer["id"]))
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid authenticated customer.",
        ) from exc


async def lock_booking_days(
    db: AsyncSession,
    barber_id: UUID,
    days: list[date],
) -> None:
    # Shared with the barber API. Keep key format/order unchanged.
    for day in sorted(set(days)):
        key = (
            f"kshurak:bookings:{barber_id}:"
            f"{day.isoformat()}"
        )

        await db.execute(
            text("""
                SELECT pg_advisory_xact_lock(
                    hashtextextended(:key, 0)
                )
            """),
            {"key": key},
        )


def ensure_upcoming(booking: dict) -> None:
    require_upcoming_confirmed_booking(booking)


def ensure_requested_future(
    requested_date: date,
    requested_start: time,
) -> None:
    now = datetime.now(SHOP_TIMEZONE)

    if requested_date > now.date() + timedelta(
        days=MAX_ADVANCE_DAYS
    ):
        raise HTTPException(
            status_code=422,
            detail="Requested date is too far in advance.",
        )

    if appointment_timestamp(
        requested_date,
        requested_start,
    ) <= now:
        raise HTTPException(
            status_code=409,
            detail="The requested appointment time has passed.",
        )


async def validate_requested_slot(
    db: AsyncSession,
    booking: dict,
    worker_id: UUID,
    requested_date: date,
    requested_start: time,
    requested_end: time,
) -> None:
    """
    Shared with the barber rescheduling API.

    Validates availability without reserving the proposed slot.
    """
    requested_start = normalize_time(
        requested_start,
        "Requested start time",
    )

    requested_end = normalize_time(
        requested_end,
        "Requested end time",
    )

    ensure_requested_future(
        requested_date,
        requested_start,
    )

    if requested_end <= requested_start:
        raise HTTPException(
            status_code=422,
            detail="Invalid requested time range.",
        )

    duration = int(booking["service_duration_minutes"])

    if (
        not 5 <= duration <= 480
        or minutes(requested_end) - minutes(requested_start)
        != duration
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Requested duration does not match the booked service."
            ),
        )

    barber_id = booking["barber_id"]

    result = await db.execute(
        SHOP_QUERY,
        {"barber_id": barber_id},
    )

    shop_row = result.mappings().first()

    if shop_row is None:
        raise HTTPException(
            status_code=409,
            detail="Shop is currently unavailable.",
        )

    shop = dict(shop_row)

    if not is_day_open(
        shop["working_days"],
        requested_date,
    ):
        raise HTTPException(
            status_code=409,
            detail="Shop is closed on the requested date.",
        )

    result = await db.execute(
        SERVICE_QUERY,
        {
            "barber_id": barber_id,
            "service_name": booking["service_name"],
            "duration": duration,
        },
    )

    if not result.scalar():
        raise HTTPException(
            status_code=409,
            detail="Booked service is no longer active.",
        )

    result = await db.execute(
        WORKER_QUERY,
        {
            "barber_id": barber_id,
            "worker_id": worker_id,
        },
    )

    worker_row = result.mappings().first()

    if worker_row is None:
        raise HTTPException(
            status_code=409,
            detail="Selected worker is unavailable at this shop.",
        )

    worker = dict(worker_row)

    required_hours = (
        shop["opening_time"],
        shop["closing_time"],
        worker["shift_start"],
        worker["shift_end"],
    )

    if any(value is None for value in required_hours):
        raise HTTPException(
            status_code=409,
            detail="Shop or worker working hours are missing.",
        )

    start_minute = minutes(requested_start)
    end_minute = minutes(requested_end)

    earliest = max(
        minutes(shop["opening_time"]),
        minutes(worker["shift_start"]),
    )

    latest = min(
        minutes(shop["closing_time"]),
        minutes(worker["shift_end"]),
    )

    if start_minute < earliest or end_minute > latest:
        raise HTTPException(
            status_code=409,
            detail="Requested time is outside working hours.",
        )

    worker_start = minutes(worker["shift_start"])

    if (
        start_minute - worker_start
    ) % SLOT_INTERVAL_MINUTES != 0:
        raise HTTPException(
            status_code=409,
            detail="Requested time is not a valid booking slot.",
        )

    if not schedule_allows(
        worker,
        requested_date,
        start_minute,
        end_minute,
    ):
        raise HTTPException(
            status_code=409,
            detail="Worker is unavailable during the requested slot.",
        )

    conflict = await db.execute(
        CONFLICT_QUERY,
        {
            "barber_id": barber_id,
            "worker_id": worker_id,
            "booking_date": requested_date,
            "booking_id": booking["id"],
            "start_time": requested_start,
            "end_time": requested_end,
        },
    )

    if conflict.scalar():
        raise HTTPException(
            status_code=409,
            detail="The requested appointment is already booked.",
        )


async def fetch_customer_booking(
    db: AsyncSession,
    customer_id: UUID,
    booking_id: UUID,
    *,
    lock: bool = False,
) -> dict:
    query = """
        SELECT *
        FROM public.barber_bookings
        WHERE id = :booking_id
          AND customer_id = :customer_id
    """

    if lock:
        query += " FOR UPDATE"

    result = await db.execute(
        text(query),
        {
            "booking_id": booking_id,
            "customer_id": customer_id,
        },
    )

    row = result.mappings().first()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Booking not found.",
        )

    return dict(row)


async def read_history(
    db: AsyncSession,
    customer_id: UUID,
    request_id: UUID | None = None,
) -> list[RescheduleHistoryItem]:
    query = HISTORY_SELECT
    params = {"customer_id": customer_id}

    if request_id is not None:
        query += " AND r.id = :request_id"
        params["request_id"] = request_id

    query += (
        " ORDER BY r.created_at DESC, r.id DESC LIMIT 500"
    )

    result = await db.execute(text(query), params)
    items = []

    for row in result.mappings():
        item = dict(row)

        if isinstance(item.get("options"), str):
            item["options"] = json.loads(item["options"])

        items.append(
            RescheduleHistoryItem.model_validate(item)
        )

    return items


async def finish_action(
    db: AsyncSession,
    customer_id: UUID,
    request_id: UUID,
    message: str,
) -> RescheduleCreateResponse:
    items = await read_history(
        db,
        customer_id,
        request_id,
    )

    if not items:
        raise HTTPException(
            status_code=404,
            detail="Reschedule request not found.",
        )

    response = RescheduleCreateResponse(
        message=message,
        request=items[0],
    )

    await db.commit()
    return response


async def mutation_error(
    db: AsyncSession,
    exc: Exception,
) -> None:
    await db.rollback()

    if isinstance(exc, HTTPException):
        raise exc

    if isinstance(exc, IntegrityError):
        logger.warning(
            "Customer rescheduling constraint conflict"
        )

        raise HTTPException(
            status_code=409,
            detail=(
                "The booking or request changed. "
                "Refresh before trying again."
            ),
        ) from exc

    logger.error(
        "Customer rescheduling operation failed",
        exc_info=(type(exc), exc, exc.__traceback__),
    )

    raise HTTPException(
        status_code=503,
        detail="Unable to process the rescheduling request.",
    ) from exc


async def lock_customer_proposal(
    db: AsyncSession,
    customer_id: UUID,
    request_id: UUID,
) -> tuple[dict, dict, list[dict]]:
    initial_result = await db.execute(
        text("""
            SELECT r.*, b.barber_id
            FROM public.barber_reschedule_requests r
            JOIN public.barber_bookings b
                ON b.id = r.booking_id
            WHERE r.id = :request_id
              AND b.customer_id = :customer_id
        """),
        {
            "request_id": request_id,
            "customer_id": customer_id,
        },
    )

    initial_row = initial_result.mappings().first()

    if initial_row is None:
        raise HTTPException(
            status_code=404,
            detail="Reschedule proposal not found.",
        )

    initial = dict(initial_row)

    result = await db.execute(
        text("""
            SELECT *
            FROM public.barber_reschedule_options
            WHERE request_id = :request_id
            ORDER BY option_type
        """),
        {"request_id": request_id},
    )

    options = [
        dict(row)
        for row in result.mappings().all()
    ]

    days = [
        initial["original_date"],
        initial["requested_date"],
        *[
            option["appointment_date"]
            for option in options
            if option["appointment_date"] is not None
        ],
    ]

    await lock_booking_days(
        db,
        initial["barber_id"],
        days,
    )

    booking = await fetch_customer_booking(
        db,
        customer_id,
        initial["booking_id"],
        lock=True,
    )

    result = await db.execute(
        text("""
            SELECT *
            FROM public.barber_reschedule_requests
            WHERE id = :request_id
              AND booking_id = :booking_id
            FOR UPDATE
        """),
        {
            "request_id": request_id,
            "booking_id": booking["id"],
        },
    )

    request_row = result.mappings().first()

    if request_row is None:
        raise HTTPException(
            status_code=404,
            detail="Reschedule proposal not found.",
        )

    request = dict(request_row)

    if request["requested_by"] != "barber":
        raise HTTPException(
            status_code=403,
            detail=(
                "Customers can decide only barber-created proposals."
            ),
        )

    return booking, request, options


async def apply_appointment(
    db: AsyncSession,
    booking: dict,
    worker_id: UUID,
    appointment_date: date,
    start: time,
    end: time,
) -> None:
    await validate_requested_slot(
        db,
        booking,
        worker_id,
        appointment_date,
        start,
        end,
    )

    await db.execute(
        text("""
            UPDATE public.barber_bookings
            SET
                booking_date = :appointment_date,
                start_time = :start_time,
                end_time = :end_time,
                worker_id = :worker_id,
                updated_at = NOW()
            WHERE id = :booking_id
              AND customer_id = :customer_id
              AND status = 'confirmed'
        """),
        {
            "appointment_date": appointment_date,
            "start_time": start,
            "end_time": end,
            "worker_id": worker_id,
            "booking_id": booking["id"],
            "customer_id": booking["customer_id"],
        },
    )

    # Do not change confirmed_at or the original consent fields.


# ============================================================
# READ BOOKINGS AND RESCHEDULE HISTORY
# ============================================================

@router.get(
    "/mine",
    response_model=MyBookingsResponse,
)
async def get_my_bookings(
    customer: Customer,
    db: Database,
):
    result = await db.execute(
        MY_BOOKINGS_QUERY,
        {"customer_id": customer_uuid(customer)},
    )

    checked_at = current_utc()

    bookings = [
        booking_response(
            dict(row),
            now=checked_at,
        )
        for row in result.mappings().all()
    ]

    return MyBookingsResponse(
        bookings=bookings,
        total=len(bookings),
        server_time=checked_at,
    )


@router.get(
    "/reschedule-requests/mine",
    response_model=RescheduleHistoryResponse,
)
async def get_my_reschedule_requests(
    customer: Customer,
    db: Database,
):
    requests = await read_history(
        db,
        customer_uuid(customer),
    )

    return RescheduleHistoryResponse(
        requests=requests,
        total=len(requests),
    )


# ============================================================
# CUSTOMER REQUESTS ANOTHER APPOINTMENT DAY
# ============================================================

@router.post(
    "/{booking_id}/reschedule",
    response_model=RescheduleCreateResponse,
    status_code=201,
)
async def create_reschedule_request(
    booking_id: UUID,
    payload: RescheduleCreate,
    customer: Customer,
    db: Database,
):
    customer_id = customer_uuid(customer)

    try:
        initial = await fetch_customer_booking(
            db,
            customer_id,
            booking_id,
        )

        await lock_booking_days(
            db,
            initial["barber_id"],
            [
                initial["booking_date"],
                payload.requested_date,
            ],
        )

        booking = await fetch_customer_booking(
            db,
            customer_id,
            booking_id,
            lock=True,
        )

        if any(
            booking[field] != initial[field]
            for field in (
                "booking_date",
                "start_time",
                "end_time",
                "worker_id",
            )
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "The booking changed. Refresh and try again."
                ),
            )

        require_customer_change_eligibility(booking)

        worker_id = customer_requested_worker(
            booking,
            payload,
        )

        start_minute = minutes(
            payload.requested_start_time
        )

        end_minute = (
            start_minute
            + int(booking["service_duration_minutes"])
        )

        if end_minute >= 1440:
            raise HTTPException(
                status_code=409,
                detail=(
                    "The appointment exceeds the supported day."
                ),
            )

        requested_end = time(
            end_minute // 60,
            end_minute % 60,
        )

        pending = await db.execute(
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

        if pending.scalar():
            raise HTTPException(
                status_code=409,
                detail=(
                    "This booking already has a pending request."
                ),
            )

        await validate_requested_slot(
            db,
            booking,
            worker_id,
            payload.requested_date,
            payload.requested_start_time,
            requested_end,
        )

        # Recheck after availability queries/database waits.
        require_customer_change_eligibility(booking)

        inserted = await db.execute(
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
                    'customer',
                    :requested_date,
                    :requested_start_time,
                    :requested_end_time,
                    :worker_id,
                    :original_date,
                    :original_start_time,
                    :original_end_time,
                    :original_worker_id,
                    'pending',
                    :reason,
                    'appointment_change'
                )
                RETURNING id
            """),
            {
                "booking_id": booking_id,
                "requested_date": payload.requested_date,
                "requested_start_time": (
                    payload.requested_start_time
                ),
                "requested_end_time": requested_end,
                "worker_id": worker_id,
                "original_date": booking["booking_date"],
                "original_start_time": booking["start_time"],
                "original_end_time": booking["end_time"],
                "original_worker_id": booking["worker_id"],
                "reason": payload.customer_reason,
            },
        )

        return await finish_action(
            db,
            customer_id,
            inserted.scalar_one(),
            "Request submitted. Awaiting barber approval.",
        )

    except (HTTPException, SQLAlchemyError) as exc:
        await mutation_error(db, exc)


# ============================================================
# CUSTOMER CANCELS A BOOKING
# ============================================================

@router.post(
    "/{booking_id}/cancel",
    response_model=CancelBookingResponse,
)
async def cancel_customer_booking(
    booking_id: UUID,
    payload: CancelBookingRequest,
    customer: Customer,
    db: Database,
):
    customer_id = customer_uuid(customer)

    try:
        initial = await fetch_customer_booking(
            db,
            customer_id,
            booking_id,
        )

        await lock_booking_days(
            db,
            initial["barber_id"],
            [initial["booking_date"]],
        )

        booking = await fetch_customer_booking(
            db,
            customer_id,
            booking_id,
            lock=True,
        )

        # Retrying a completed cancellation does not cancel again
        # or overwrite its original reason/timestamp.
        already_cancelled = (
            booking["status"] == "cancelled"
            and booking.get("cancelled_by") == "customer"
        )

        if not already_cancelled:
            if any(
                booking[field] != initial[field]
                for field in (
                    "booking_date",
                    "start_time",
                    "end_time",
                    "worker_id",
                )
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "The booking changed. "
                        "Refresh before cancelling."
                    ),
                )

            require_customer_change_eligibility(booking)

            await db.execute(
                text("""
                    UPDATE public.barber_bookings
                    SET
                        status = 'cancelled',
                        cancelled_by = 'customer',
                        cancellation_reason = :reason,
                        cancelled_at = statement_timestamp(),
                        updated_at = statement_timestamp()
                    WHERE id = :booking_id
                      AND customer_id = :customer_id
                      AND status = 'confirmed'
                """),
                {
                    "booking_id": booking_id,
                    "customer_id": customer_id,
                    "reason": payload.reason,
                },
            )

            # A pending proposal must not later revive or change
            # this cancelled booking. This does not issue a refund.
            await db.execute(
                text("""
                    UPDATE public.barber_reschedule_requests
                    SET
                        status = 'cancelled',
                        decision_reason =
                            'Booking cancelled by customer',
                        decided_by = 'customer',
                        decided_at = statement_timestamp(),
                        updated_at = statement_timestamp()
                    WHERE booking_id = :booking_id
                      AND status = 'pending'
                """),
                {"booking_id": booking_id},
            )

        result = await db.execute(
            text("""
                SELECT
                    b.*,
                    w.full_name AS worker_name,
                    EXISTS (
                        SELECT 1
                        FROM public.barber_reschedule_requests r
                        WHERE r.booking_id = b.id
                          AND r.status = 'pending'
                    ) AS has_pending_request
                FROM public.barber_bookings b
                LEFT JOIN public.barber_workers w
                    ON w.id = b.worker_id
                   AND w.barber_id = b.barber_id
                WHERE b.id = :booking_id
                  AND b.customer_id = :customer_id
            """),
            {
                "booking_id": booking_id,
                "customer_id": customer_id,
            },
        )

        response = CancelBookingResponse(
            message=(
                "This booking is already cancelled."
                if already_cancelled
                else "Your booking was cancelled successfully."
            ),
            booking=booking_response(
                dict(result.mappings().one())
            ),
        )

        await db.commit()
        return response

    except (HTTPException, SQLAlchemyError) as exc:
        await mutation_error(db, exc)


# ============================================================
# CUSTOMER APPROVES / DECLINES A BARBER PROPOSAL
# ============================================================

async def decide_barber_proposal(
    db: AsyncSession,
    customer_id: UUID,
    request_id: UUID,
    approve: bool,
    reason: str | None = None,
) -> RescheduleCreateResponse:
    try:
        booking, request, _ = await lock_customer_proposal(
            db,
            customer_id,
            request_id,
        )

        if request["status"] != "pending":
            raise HTTPException(
                status_code=409,
                detail="This proposal is no longer pending.",
            )

        if approve:
            if request["request_kind"] != "appointment_change":
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "EXPLICIT_OPTION_REQUIRED",
                        "message": (
                            "Select cancellation, another day with "
                            "the same worker, or another worker "
                            "on the original day."
                        ),
                    },
                )

            ensure_upcoming(booking)

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
                    detail=(
                        "No worker is assigned to this proposal."
                    ),
                )

            await apply_appointment(
                db,
                booking,
                worker_id,
                request["requested_date"],
                request["requested_start_time"],
                request["requested_end_time"],
            )

        # A decline may close a stale proposal without changing
        # or cancelling the appointment.
        await db.execute(
            text("""
                UPDATE public.barber_reschedule_requests
                SET
                    status = :new_status,
                    decision_reason = :reason,
                    decided_by = 'customer',
                    decided_at = NOW(),
                    updated_at = NOW()
                WHERE id = :request_id
                  AND status = 'pending'
            """),
            {
                "new_status": (
                    "approved" if approve else "declined"
                ),
                "reason": reason,
                "request_id": request_id,
            },
        )

        return await finish_action(
            db,
            customer_id,
            request_id,
            (
                "Reschedule approved. Your booking was updated."
                if approve
                else (
                    "Proposal declined. "
                    "Your booking was not changed."
                )
            ),
        )

    except (HTTPException, SQLAlchemyError) as exc:
        await mutation_error(db, exc)


@router.post(
    "/reschedule-requests/{request_id}/approve",
    response_model=RescheduleCreateResponse,
)
async def approve_barber_reschedule(
    request_id: UUID,
    customer: Customer,
    db: Database,
):
    return await decide_barber_proposal(
        db,
        customer_uuid(customer),
        request_id,
        approve=True,
    )


@router.post(
    "/reschedule-requests/{request_id}/decline",
    response_model=RescheduleCreateResponse,
)
async def decline_barber_reschedule(
    request_id: UUID,
    payload: DecisionRequest,
    customer: Customer,
    db: Database,
):
    return await decide_barber_proposal(
        db,
        customer_uuid(customer),
        request_id,
        approve=False,
        reason=payload.reason,
    )


# ============================================================
# CUSTOMER SELECTS A BARBER RECOVERY OPTION
# ============================================================

@router.post(
    "/reschedule-requests/{request_id}/select-option",
    response_model=RescheduleCreateResponse,
)
async def select_recovery_option(
    request_id: UUID,
    payload: SelectRecoveryOptionRequest,
    customer: Customer,
    db: Database,
):
    customer_id = customer_uuid(customer)

    try:
        booking, request, options = await lock_customer_proposal(
            db,
            customer_id,
            request_id,
        )

        if request["request_kind"] != "worker_unavailability":
            raise HTTPException(
                status_code=409,
                detail=(
                    "This request does not contain recovery choices."
                ),
            )

        if (
            request["status"] == "approved"
            and request["selected_option_type"]
            == payload.option_type
        ):
            return await finish_action(
                db,
                customer_id,
                request_id,
                "This option has already been applied.",
            )

        if request["status"] != "pending":
            raise HTTPException(
                status_code=409,
                detail="This proposal is no longer pending.",
            )

        ensure_upcoming(booking)

        require_original_booking_unchanged(
            booking,
            request,
        )

        # Preserve the previously agreed recovery behavior:
        # the barber must initiate within the eligibility window.
        # The customer may respond later, before the appointment
        # starts, without restarting the original window.
        require_barber_reschedule_eligibility(
            booking,
            now=request["created_at"],
        )

        expected_types = {
            CANCEL_BOOKING,
            SAME_WORKER_OTHER_DAY,
            OTHER_WORKER_SAME_DAY,
        }

        if (
            len(options) != 3
            or {
                option["option_type"]
                for option in options
            } != expected_types
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "This proposal does not contain all three choices."
                ),
            )

        selected = next(
            option
            for option in options
            if option["option_type"] == payload.option_type
        )

        if payload.option_type == CANCEL_BOOKING:
            if any(
                selected[field] is not None
                for field in (
                    "worker_id",
                    "appointment_date",
                    "start_time",
                    "end_time",
                )
            ):
                raise HTTPException(
                    status_code=409,
                    detail="The cancellation option is invalid.",
                )

            cancellation_reason = (
                "Customer selected cancellation following "
                "worker unavailability. "
                f"Barber reason: {request['reason'] or 'Not provided'}"
            )

            if payload.reason:
                cancellation_reason += (
                    f" Customer note: {payload.reason}"
                )

            await db.execute(
                text("""
                    UPDATE public.barber_bookings
                    SET
                        status = 'cancelled',
                        cancelled_by = 'customer',
                        cancellation_reason = :reason,
                        cancelled_at = NOW(),
                        updated_at = NOW()
                    WHERE id = :booking_id
                      AND customer_id = :customer_id
                      AND status = 'confirmed'
                """),
                {
                    "reason": cancellation_reason,
                    "booking_id": booking["id"],
                    "customer_id": customer_id,
                },
            )

            message = (
                "Your appointment was cancelled as requested."
            )

        else:
            worker_id = selected["worker_id"]
            appointment_date = selected["appointment_date"]
            start = selected["start_time"]
            end = selected["end_time"]

            if any(
                value is None
                for value in (
                    worker_id,
                    appointment_date,
                    start,
                    end,
                )
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "The selected appointment option is incomplete."
                    ),
                )

            if payload.option_type == SAME_WORKER_OTHER_DAY:
                if (
                    worker_id != booking["worker_id"]
                    or appointment_date == booking["booking_date"]
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="The same-worker option is invalid.",
                    )

            if payload.option_type == OTHER_WORKER_SAME_DAY:
                if (
                    worker_id == booking["worker_id"]
                    or appointment_date != booking["booking_date"]
                ):
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "The replacement-worker option is invalid."
                        ),
                    )

            if appointment_timestamp(
                appointment_date,
                start,
            ) <= current_utc():
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "The selected appointment time has passed."
                    ),
                )

            # Recheck only the selected option's availability.
            await apply_appointment(
                db,
                booking,
                worker_id,
                appointment_date,
                start,
                end,
            )

            message = (
                "Your appointment was updated using "
                "the selected option."
            )

        await db.execute(
            text("""
                UPDATE public.barber_reschedule_requests
                SET
                    status = 'approved',
                    selected_option_type = :option_type,
                    decision_reason = :reason,
                    decided_by = 'customer',
                    decided_at = NOW(),
                    updated_at = NOW()
                WHERE id = :request_id
                  AND status = 'pending'
            """),
            {
                "option_type": payload.option_type,
                "reason": payload.reason,
                "request_id": request_id,
            },
        )

        return await finish_action(
            db,
            customer_id,
            request_id,
            message,
        )

    except (HTTPException, SQLAlchemyError) as exc:
        await mutation_error(db, exc)
