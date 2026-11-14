"""
KSHURAK - Barber Booking Management API.

Lightweight lists:
    GET /api/v1/barber/bookings?include_hairstyle=false

Full booking details:
    GET /api/v1/barber/bookings/{booking_id}

Existing clients remain compatible because include_hairstyle
defaults to True during the frontend migration.

No booking mutation is automatically retried.
"""

import json
import logging

from datetime import date, datetime, time
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, is_database_unavailable
from app.barber.api.barber_workers import get_approved_barber
from app.customer.api.booking_slots import schedule_allows


logger = logging.getLogger("kshurak.barber.bookings")

router = APIRouter(
    prefix="/api/v1/barber/bookings",
    tags=["Barber Bookings"],
)

BookingStatus = Literal[
    "pending",
    "confirmed",
    "completed",
    "cancelled",
    "rejected",
]


# ============================================================
# RESPONSE MODELS
# ============================================================

class HairstylePreviewResponse(BaseModel):
    angle: Literal["front", "left", "right"]
    image: str


class HairstyleSelectionResponse(BaseModel):
    version: Literal[1] = 1
    source: Literal["virtual_tryon"] = "virtual_tryon"

    scan_id: UUID
    hairstyle_id: str
    hairstyle_name: str
    reference_image: str
    style_analysis: str
    face_shape: str | None = None

    previews: list[HairstylePreviewResponse] = Field(
        default_factory=list
    )


class BookingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    barber_id: UUID
    worker_id: UUID | None = None
    customer_id: UUID | None = None

    customer_name: str
    customer_phone: str | None = None
    customer_image_url: str | None = None

    service_name: str
    service_duration_minutes: int
    service_price: Decimal

    booking_date: date
    start_time: time
    end_time: time
    status: BookingStatus

    customer_notes: str | None = None
    cancellation_reason: str | None = None
    cancelled_by: str | None = None

    confirmed_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None

    created_at: datetime
    updated_at: datetime

    hairstyle_selection: HairstyleSelectionResponse | None = None

    # For lightweight lists, these identify saved hairstyle data
    # without transferring images or the complete JSON document.
    has_hairstyle_selection: bool = False
    hairstyle_name: str | None = None
    hairstyle_details_loaded: bool = True


class BookingListResponse(BaseModel):
    bookings: list[BookingResponse]
    total: int
    counts: dict[str, int]


class BookingActionResponse(BaseModel):
    message: str
    booking: BookingResponse


# ============================================================
# REQUEST MODELS
# ============================================================

class AcceptBookingRequest(BaseModel):
    worker_id: UUID | None = None


class RejectBookingRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class CancelBookingRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


# ============================================================
# COLUMN PROJECTIONS
# ============================================================

# Explicit projection is essential: SELECT * would still fetch
# hairstyle_selection even if Python removed it afterwards.
BOOKING_COLUMNS = """
    b.id,
    b.barber_id,
    b.worker_id,
    b.customer_id,
    b.customer_name,
    b.customer_phone,
    b.customer_image_url,
    b.service_name,
    b.service_duration_minutes,
    b.service_price,
    b.booking_date,
    b.start_time,
    b.end_time,
    b.status,
    b.customer_notes,
    b.cancellation_reason,
    b.cancelled_by,
    b.confirmed_at,
    b.completed_at,
    b.cancelled_at,
    b.created_at,
    b.updated_at
"""


def booking_projection(include_hairstyle: bool) -> str:
    if include_hairstyle:
        return f"""
            {BOOKING_COLUMNS},
            b.hairstyle_selection,
            TRUE AS hairstyle_details_loaded
        """

    # Checking NULL does not require returning the saved JSON.
    # Name extraction is intentionally omitted here so the list
    # does not need to read the large JSON document.
    return f"""
        {BOOKING_COLUMNS},
        NULL::jsonb AS hairstyle_selection,
        (b.hairstyle_selection IS NOT NULL)
            AS has_hairstyle_selection,
        NULL::text AS hairstyle_name,
        FALSE AS hairstyle_details_loaded
    """


# ============================================================
# AUTHENTICATION AND SERIALIZATION
# ============================================================

def get_barber_uuid(barber: UUID | object) -> UUID:
    if isinstance(barber, UUID):
        return barber

    raw_id = getattr(barber, "id", None)

    if raw_id is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid barber authentication context.",
        )

    try:
        return UUID(str(raw_id))
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid barber authentication context.",
        ) from exc


def booking_from_row(row) -> BookingResponse:
    values = dict(row)
    selection = values.get("hairstyle_selection")

    if isinstance(selection, str):
        try:
            selection = json.loads(selection)
        except json.JSONDecodeError as exc:
            logger.error(
                "Invalid saved hairstyle JSON | booking_id=%s",
                values.get("id"),
            )
            raise HTTPException(
                status_code=500,
                detail="Unable to read saved hairstyle information.",
            ) from exc

    values["hairstyle_selection"] = selection

    if selection is not None:
        values["has_hairstyle_selection"] = True

        if isinstance(selection, dict):
            values["hairstyle_name"] = selection.get(
                "hairstyle_name"
            )

    values.setdefault("has_hairstyle_selection", False)
    values.setdefault("hairstyle_details_loaded", True)

    return BookingResponse.model_validate(values)


# ============================================================
# DATABASE HELPERS
# ============================================================

async def fetch_booking(
    db: AsyncSession,
    barber_id: UUID,
    booking_id: UUID,
    lock: bool = False,
    include_hairstyle: bool = True,
) -> dict:
    statement = f"""
        SELECT {booking_projection(include_hairstyle)}
        FROM public.barber_bookings AS b
        WHERE b.id = :booking_id
          AND b.barber_id = :barber_id
    """

    if lock:
        statement += " FOR UPDATE OF b"

    result = await db.execute(
        text(statement),
        {
            "booking_id": booking_id,
            "barber_id": barber_id,
        },
    )

    booking = result.mappings().first()

    if booking is None:
        raise HTTPException(
            status_code=404,
            detail="Booking not found for this barber.",
        )

    return dict(booking)


async def lock_booking_day(
    db: AsyncSession,
    barber_id: UUID,
    booking_day: date,
) -> None:
    key = (
        f"kshurak:bookings:"
        f"{barber_id}:"
        f"{booking_day.isoformat()}"
    )

    await db.execute(
        text("""
            SELECT pg_advisory_xact_lock(
                hashtextextended(:lock_key, 0)
            )
        """),
        {"lock_key": key},
    )


# ============================================================
# WORKER AVAILABILITY
# ============================================================

async def load_worker_candidates(
    db: AsyncSession,
    barber_id: UUID,
    requested_worker_id: UUID | None,
) -> list[dict]:
    statement = """
        SELECT
            id,
            full_name,
            shift_start,
            shift_end,
            is_active,
            slot_availability,
            custom_breaks
        FROM public.barber_workers
        WHERE barber_id = :barber_id
          AND is_active = TRUE
    """

    params = {"barber_id": barber_id}

    if requested_worker_id is not None:
        statement += " AND id = :worker_id"
        params["worker_id"] = requested_worker_id

    statement += " ORDER BY created_at, id"

    result = await db.execute(text(statement), params)

    return [
        dict(row)
        for row in result.mappings().all()
    ]


def worker_has_availability(
    worker: dict,
    booking: dict,
) -> bool:
    start = booking["start_time"]
    end = booking["end_time"]

    worker_start = worker.get("shift_start")
    worker_end = worker.get("shift_end")

    if worker_start is None or worker_end is None:
        return False

    if start < worker_start or end > worker_end:
        return False

    return schedule_allows(
        worker,
        booking["booking_date"],
        start.hour * 60 + start.minute,
        end.hour * 60 + end.minute,
    )


async def worker_has_conflict(
    db: AsyncSession,
    worker_id: UUID,
    booking: dict,
) -> bool:
    result = await db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1
                FROM public.barber_bookings
                WHERE worker_id = :worker_id
                  AND booking_date = :booking_date
                  AND LOWER(status) IN (
                      'pending',
                      'confirmed'
                  )
                  AND id <> :booking_id
                  AND start_time < :end_time
                  AND end_time > :start_time
            )
        """),
        {
            "worker_id": worker_id,
            "booking_date": booking["booking_date"],
            "booking_id": booking["id"],
            "start_time": booking["start_time"],
            "end_time": booking["end_time"],
        },
    )

    return bool(result.scalar())


# ============================================================
# STATUS VALIDATION
# ============================================================

ALLOWED_TRANSITIONS = {
    "confirmed": {"pending"},
    "rejected": {"pending"},
    "completed": {"confirmed"},
    "cancelled": {"pending", "confirmed"},
}


def validate_status_transition(
    current_status: str,
    new_status: str,
) -> None:
    allowed_previous = ALLOWED_TRANSITIONS.get(
        new_status,
        set(),
    )

    if current_status not in allowed_previous:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot change a {current_status} "
                f"booking to {new_status}."
            ),
        )


def validate_booking_time(booking: dict) -> None:
    if booking["end_time"] <= booking["start_time"]:
        raise HTTPException(
            status_code=409,
            detail="Booking time range is invalid.",
        )


# ============================================================
# STATUS UPDATE QUERIES
# ============================================================

COMPLETE_BOOKING_SQL = text("""
    UPDATE public.barber_bookings
    SET
        status = 'completed',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = :booking_id
      AND barber_id = :barber_id
      AND status = 'confirmed'
    RETURNING *
""")

CONFIRM_BOOKING_SQL = text("""
    UPDATE public.barber_bookings
    SET
        status = 'confirmed',
        worker_id = :worker_id,
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = :booking_id
      AND barber_id = :barber_id
      AND status = 'pending'
    RETURNING *
""")

CANCEL_BOOKING_SQL = text("""
    UPDATE public.barber_bookings
    SET
        status = 'cancelled',
        cancellation_reason = :reason,
        cancelled_by = 'barber',
        cancelled_at = NOW(),
        updated_at = NOW()
    WHERE id = :booking_id
      AND barber_id = :barber_id
      AND status IN ('pending', 'confirmed')
    RETURNING *
""")

REJECT_BOOKING_SQL = text("""
    UPDATE public.barber_bookings
    SET
        status = 'rejected',
        cancellation_reason = :reason,
        cancelled_by = 'barber',
        cancelled_at = NOW(),
        updated_at = NOW()
    WHERE id = :booking_id
      AND barber_id = :barber_id
      AND status = 'pending'
    RETURNING *
""")


# ============================================================
# CENTRAL STATUS UPDATE
# ============================================================

async def update_status(
    db: AsyncSession,
    barber_id: UUID,
    booking_id: UUID,
    new_status: str,
    worker_id: UUID | None = None,
    reason: str | None = None,
) -> BookingResponse:
    try:
        # Status validation and availability checks do not need
        # saved hairstyle image data.
        initial = await fetch_booking(
            db=db,
            barber_id=barber_id,
            booking_id=booking_id,
            include_hairstyle=False,
        )

        await lock_booking_day(
            db=db,
            barber_id=barber_id,
            booking_day=initial["booking_date"],
        )

        booking = await fetch_booking(
            db=db,
            barber_id=barber_id,
            booking_id=booking_id,
            lock=True,
            include_hairstyle=False,
        )

        if booking["booking_date"] != initial["booking_date"]:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Appointment date changed. "
                    "Refresh before trying again."
                ),
            )

        validate_status_transition(
            current_status=str(booking["status"]).lower(),
            new_status=new_status,
        )

        if new_status == "confirmed":
            validate_booking_time(booking)

            candidates = await load_worker_candidates(
                db=db,
                barber_id=barber_id,
                requested_worker_id=worker_id,
            )

            if not candidates:
                raise HTTPException(
                    status_code=409,
                    detail="No active worker is available.",
                )

            selected_worker = None

            for candidate in candidates:
                if not worker_has_availability(candidate, booking):
                    continue

                if await worker_has_conflict(
                    db=db,
                    worker_id=candidate["id"],
                    booking=booking,
                ):
                    continue

                selected_worker = candidate
                break

            if selected_worker is None:
                raise HTTPException(
                    status_code=409,
                    detail="No worker is free during this appointment.",
                )

            query = CONFIRM_BOOKING_SQL
            params = {
                "booking_id": booking_id,
                "barber_id": barber_id,
                "worker_id": selected_worker["id"],
            }

        elif new_status == "completed":
            query = COMPLETE_BOOKING_SQL
            params = {
                "booking_id": booking_id,
                "barber_id": barber_id,
            }

        elif new_status == "cancelled":
            query = CANCEL_BOOKING_SQL
            params = {
                "booking_id": booking_id,
                "barber_id": barber_id,
                "reason": reason,
            }

        elif new_status == "rejected":
            query = REJECT_BOOKING_SQL
            params = {
                "booking_id": booking_id,
                "barber_id": barber_id,
                "reason": reason,
            }

        else:
            raise HTTPException(
                status_code=422,
                detail="Unsupported booking status.",
            )

        result = await db.execute(query, params)
        row = result.mappings().first()

        if row is None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Booking status changed. "
                    "Please refresh your appointments."
                ),
            )

        updated_booking = booking_from_row(row)

        await db.commit()

        logger.info(
            "Booking updated | booking_id=%s | status=%s",
            booking_id,
            new_status,
        )

        return updated_booking

    except HTTPException:
        # The shared get_db dependency performs rollback.
        raise

    except SQLAlchemyError as exc:
        # Preserve shared HTTP 503 handling for connection errors.
        if is_database_unavailable(exc):
            raise

        logger.error(
            "Booking update failed | booking_id=%s | error=%s",
            booking_id,
            type(exc).__name__,
        )

        raise HTTPException(
            status_code=500,
            detail="Unable to update booking in database.",
        ) from exc


# ============================================================
# LIST BOOKINGS
# ============================================================

@router.get("", response_model=BookingListResponse)
async def list_bookings(
    db: Annotated[AsyncSession, Depends(get_db)],
    barber: Annotated[UUID, Depends(get_approved_barber)],
    booking_status: Annotated[
        str | None,
        Query(alias="status"),
    ] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    include_hairstyle: bool = True,
):
    barber_id = get_barber_uuid(barber)

    allowed_statuses = {
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "rejected",
    }

    if booking_status and booking_status not in allowed_statuses:
        raise HTTPException(
            status_code=422,
            detail="Invalid booking status.",
        )

    if date_from and date_to and date_from > date_to:
        raise HTTPException(
            status_code=422,
            detail="date_from cannot be after date_to.",
        )

    filters = ["b.barber_id = :barber_id"]
    params = {"barber_id": barber_id}

    if booking_status:
        filters.append("b.status = :booking_status")
        params["booking_status"] = booking_status

    if date_from:
        filters.append("b.booking_date >= :date_from")
        params["date_from"] = date_from

    if date_to:
        filters.append("b.booking_date <= :date_to")
        params["date_to"] = date_to

    where_clause = " AND ".join(filters)

    statement = text(f"""
        SELECT {booking_projection(include_hairstyle)}
        FROM public.barber_bookings AS b
        WHERE {where_clause}
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT 1000
    """)

    try:
        result = await db.execute(statement, params)

        bookings = [
            booking_from_row(row)
            for row in result.mappings().all()
        ]

        counts = {
            "pending": 0,
            "confirmed": 0,
            "completed": 0,
            "cancelled": 0,
            "rejected": 0,
        }

        for booking in bookings:
            counts[booking.status] += 1

        # Preserve existing loaded-record count semantics.
        return BookingListResponse(
            bookings=bookings,
            total=len(bookings),
            counts=counts,
        )

    except SQLAlchemyError as exc:
        if is_database_unavailable(exc):
            raise

        logger.error(
            "Unable to load bookings | barber_id=%s | error=%s",
            barber_id,
            type(exc).__name__,
        )

        raise HTTPException(
            status_code=500,
            detail="Unable to load bookings.",
        ) from exc


# ============================================================
# BOOKING DETAILS
# ============================================================

@router.get(
    "/{booking_id}",
    response_model=BookingResponse,
)
async def get_booking_details(
    booking_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    barber: Annotated[UUID, Depends(get_approved_barber)],
):
    return booking_from_row(
        await fetch_booking(
            db=db,
            barber_id=get_barber_uuid(barber),
            booking_id=booking_id,
            include_hairstyle=True,
        )
    )


# ============================================================
# BOOKING ACTIONS
# ============================================================

@router.post(
    "/{booking_id}/accept",
    response_model=BookingActionResponse,
)
async def accept_booking(
    booking_id: UUID,
    payload: AcceptBookingRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    barber: Annotated[UUID, Depends(get_approved_barber)],
):
    booking = await update_status(
        db=db,
        barber_id=get_barber_uuid(barber),
        booking_id=booking_id,
        new_status="confirmed",
        worker_id=payload.worker_id,
    )

    return BookingActionResponse(
        message="Booking accepted successfully.",
        booking=booking,
    )


@router.post(
    "/{booking_id}/reject",
    response_model=BookingActionResponse,
)
async def reject_booking(
    booking_id: UUID,
    payload: RejectBookingRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    barber: Annotated[UUID, Depends(get_approved_barber)],
):
    booking = await update_status(
        db=db,
        barber_id=get_barber_uuid(barber),
        booking_id=booking_id,
        new_status="rejected",
        reason=payload.reason.strip(),
    )

    return BookingActionResponse(
        message="Booking rejected successfully.",
        booking=booking,
    )


@router.post(
    "/{booking_id}/complete",
    response_model=BookingActionResponse,
)
async def complete_booking(
    booking_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    barber: Annotated[UUID, Depends(get_approved_barber)],
):
    booking = await update_status(
        db=db,
        barber_id=get_barber_uuid(barber),
        booking_id=booking_id,
        new_status="completed",
    )

    return BookingActionResponse(
        message="Booking completed successfully.",
        booking=booking,
    )


@router.post(
    "/{booking_id}/cancel",
    response_model=BookingActionResponse,
)
async def cancel_booking(
    booking_id: UUID,
    payload: CancelBookingRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    barber: Annotated[UUID, Depends(get_approved_barber)],
):
    booking = await update_status(
        db=db,
        barber_id=get_barber_uuid(barber),
        booking_id=booking_id,
        new_status="cancelled",
        reason=payload.reason.strip(),
    )

    return BookingActionResponse(
        message="Booking cancelled successfully.",
        booking=booking,
    )
