
"""
KSHURAK Customer Appointment Availability API.

Features:
- Approved and published shop verification
- Active services and workers
- Shop working days (Mon/Thu and Monday/Thursday)
- Worker-specific weekly holidays
- Worker daily shifts
- Date-specific manual slot blocking
- Custom worker breaks
- Existing pending/confirmed booking conflicts
- Rolling seven-day availability
- India Standard Time (Asia/Kolkata)

Endpoints:
GET /api/v1/customer/barbers/{barber_id}/slots
GET /api/v1/customer/barbers/{barber_id}/slots/week

Both endpoints are read-only.

IMPORTANT:
The booking-creation API must independently revalidate
availability in its database transaction before insertion.
"""

import json
import logging

from datetime import (
    date,
    datetime,
    time,
    timedelta,
)
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
)
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db


logger = logging.getLogger(
    "kshurak.customer.booking_slots"
)

router = APIRouter(
    prefix="/api/v1/customer/barbers",
    tags=["Customer Appointment Slots"],
)

SHOP_TIMEZONE = ZoneInfo("Asia/Kolkata")

SLOT_INTERVAL_MINUTES = 60

MAX_ADVANCE_DAYS = 30

WEEK_WINDOW_DAYS = 7

MAX_SERVICE_DURATION_MINUTES = 480


# ============================================================
# WEEKDAY CONFIGURATION
# ============================================================

WEEKDAY_NAMES = (
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "Sun",
)


def normalize_weekday(value: object) -> str | None:
    """
    Convert supported weekday representations into
    a consistent three-character weekday.

    Examples:
    Monday -> mon
    Mon    -> mon
    THU    -> thu
    Thursday -> thu
    """

    if not isinstance(value, str):
        return None

    cleaned = value.strip().lower()

    days = {
        "mon": "mon",
        "monday": "mon",

        "tue": "tue",
        "tues": "tue",
        "tuesday": "tue",

        "wed": "wed",
        "wednesday": "wed",

        "thu": "thu",
        "thur": "thu",
        "thurs": "thu",
        "thursday": "thu",

        "fri": "fri",
        "friday": "fri",

        "sat": "sat",
        "saturday": "sat",

        "sun": "sun",
        "sunday": "sun",
    }

    return days.get(cleaned)


# ============================================================
# RESPONSE MODELS
# ============================================================

class AvailableSlot(BaseModel):
    startTime: str
    endTime: str
    available: bool = True


class SlotAvailabilityResponse(BaseModel):
    barberId: UUID
    workerId: UUID
    serviceId: UUID

    date: date

    timezone: str = "Asia/Kolkata"

    serviceDurationMinutes: int

    slots: list[AvailableSlot] = Field(
        default_factory=list
    )

    totalAvailable: int


class DayAvailability(BaseModel):
    date: date
    dayName: str

    isOpen: bool

    totalAvailable: int

    slots: list[AvailableSlot] = Field(
        default_factory=list
    )


class WeeklySlotAvailabilityResponse(BaseModel):
    barberId: UUID
    workerId: UUID
    serviceId: UUID

    startDate: date
    endDate: date

    timezone: str = "Asia/Kolkata"

    serviceDurationMinutes: int

    days: list[DayAvailability] = Field(
        default_factory=list
    )

    totalAvailable: int


# ============================================================
# JSON HELPERS
# ============================================================

def parse_json_object(value: object) -> dict:
    """
    PostgreSQL JSONB is usually returned as dict.

    Also supports JSON text if a driver or existing
    record provides its serialized representation.

    Invalid JSON is rejected instead of silently
    marking potentially blocked time as available.
    """

    if isinstance(value, dict):
        return value

    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            raise ValueError(
                "Invalid worker schedule JSON."
            )

        if isinstance(parsed, dict):
            return parsed

    raise ValueError(
        "Worker schedule must be a JSON object."
    )


def optional_json_object(value: object) -> dict:
    if value is None:
        return {}

    return parse_json_object(value)


def parse_working_days(value: object) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return []

    if not isinstance(value, list):
        return []

    return [
        item.strip()
        for item in value
        if isinstance(item, str) and item.strip()
    ]


# ============================================================
# TIME HELPERS
# ============================================================

def minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def to_time(value: int) -> time:
    if value < 0 or value >= 1440:
        raise ValueError(
            "Time must be within the same calendar day."
        )

    return time(
        hour=value // 60,
        minute=value % 60,
    )


def parse_slot_time(value: object) -> int:
    if not isinstance(value, str):
        raise ValueError(
            "Invalid slot time."
        )

    parsed = time.fromisoformat(value)

    if parsed.second or parsed.microsecond:
        raise ValueError(
            "Slot time must use whole minutes."
        )

    return minutes(parsed)


def overlaps(
    start_a: int,
    end_a: int,
    start_b: int,
    end_b: int,
) -> bool:
    return (
        start_a < end_b
        and end_a > start_b
    )


# ============================================================
# SHOP WORKING DAYS
# ============================================================

def is_day_open(
    working_days: object,
    requested_date: date,
) -> bool:
    """
    Supports:
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    and:

    ["Monday", "Tuesday", "Wednesday", ...]
    """

    days = parse_working_days(
        working_days
    )

    normalized = {
        normalized_day
        for value in days
        if (
            normalized_day := normalize_weekday(value)
        ) is not None
    }

    requested_weekday = WEEKDAY_NAMES[
        requested_date.weekday()
    ].lower()

    return requested_weekday in normalized


# ============================================================
# WORKER WEEKLY AVAILABILITY
# ============================================================

def is_worker_weekly_available(
    worker: dict,
    requested_date: date,
) -> bool:
    """
    Optional weekly availability configuration.

    Stored inside existing:
        barber_workers.slot_availability

    Supported format:

    {
        "weekly_days": {
            "Mon": true,
            "Tue": false,
            "Wed": true,
            "Thu": true,
            "Fri": true,
            "Sat": true,
            "Sun": false
        },

        "2026-10-29": {
            "09:00": true,
            "10:00": true,
            "17:00": false
        }
    }

    Missing weekly_days:
        Existing worker shift remains the fallback.

    Explicit false:
        Worker is unavailable for the entire weekday.

    Worker weekly settings cannot override the
    shop's closed days.
    """

    availability = optional_json_object(
        worker.get("slot_availability")
    )

    weekly_days = availability.get(
        "weekly_days"
    )

    if weekly_days is None:
        return True

    if not isinstance(weekly_days, dict):
        return False

    requested_day = WEEKDAY_NAMES[
        requested_date.weekday()
    ].lower()

    for day_label, enabled in weekly_days.items():
        normalized = normalize_weekday(
            day_label
        )

        if normalized != requested_day:
            continue

        # Only explicit boolean configuration is valid.
        if not isinstance(enabled, bool):
            return False

        return enabled

    # A weekday omitted from the weekly override
    # continues using the worker's existing shift.
    return True


# ============================================================
# DATE-SPECIFIC WORKER AVAILABILITY
# ============================================================

def schedule_allows(
    worker: dict,
    requested_date: date,
    start_minutes: int,
    end_minutes: int,
) -> bool:
    """
    Check:
    1. Weekly worker holiday
    2. Date-specific closed day
    3. Manually blocked hourly slots
    4. Custom breaks

    This helper is also imported by the customer
    booking-creation API.
    """

    if not is_worker_weekly_available(
        worker,
        requested_date,
    ):
        return False

    try:
        availability = optional_json_object(
            worker.get("slot_availability")
        )

        breaks = optional_json_object(
            worker.get("custom_breaks")
        )

    except ValueError:
        return False

    day_key = requested_date.isoformat()

    day_availability = availability.get(
        day_key,
        {},
    )

    custom_breaks = breaks.get(
        day_key,
        [],
    )

    if not isinstance(day_availability, dict):
        return False

    if not isinstance(custom_breaks, list):
        return False

    # Optional full-day closure.
    if day_availability.get("closed") is True:
        return False

    # --------------------------------------------------------
    # BLOCKED HOURLY SLOTS
    # --------------------------------------------------------

    for label, enabled in day_availability.items():
        if label == "closed":
            continue

        # Explicit false represents a blocked hour.
        if enabled is not False:
            continue

        try:
            blocked_start = parse_slot_time(
                label
            )
        except (ValueError, TypeError):
            return False

        blocked_end = (
            blocked_start
            + SLOT_INTERVAL_MINUTES
        )

        if overlaps(
            start_minutes,
            end_minutes,
            blocked_start,
            blocked_end,
        ):
            return False

    # --------------------------------------------------------
    # CUSTOM BREAKS
    # --------------------------------------------------------

    for item in custom_breaks:
        if not isinstance(item, dict):
            return False

        try:
            break_start = parse_slot_time(
                item["start"]
            )

            break_end = parse_slot_time(
                item["end"]
            )

        except (
            KeyError,
            ValueError,
            TypeError,
        ):
            return False

        if break_end <= break_start:
            return False

        if overlaps(
            start_minutes,
            end_minutes,
            break_start,
            break_end,
        ):
            return False

    return True


# ============================================================
# AVAILABILITY CALCULATION
# ============================================================

def calculate_day_slots(
    shop: dict,
    worker: dict,
    duration: int,
    requested_date: date,
    bookings: list[dict],
    now: datetime,
) -> tuple[bool, list[AvailableSlot]]:
    """
    Calculate availability for one date.

    Returns:
        (is_open, available_slots)

    Database booking conflicts are evaluated on
    half-open intervals [start_time, end_time).
    """

    # Shop closed.
    if not is_day_open(
        shop.get("working_days"),
        requested_date,
    ):
        return False, []

    # Worker weekly holiday.
    try:
        if not is_worker_weekly_available(
            worker,
            requested_date,
        ):
            return False, []
    except ValueError:
        return False, []

    day_key = requested_date.isoformat()

    try:
        availability = optional_json_object(
            worker.get("slot_availability")
        )

        day_data = availability.get(
            day_key,
            {},
        )

        if not isinstance(day_data, dict):
            return False, []

        if day_data.get("closed") is True:
            return False, []

    except ValueError:
        return False, []

    shop_open = shop.get("opening_time")
    shop_close = shop.get("closing_time")

    worker_open = worker.get("shift_start")
    worker_close = worker.get("shift_end")

    if any(
        value is None
        for value in (
            shop_open,
            shop_close,
            worker_open,
            worker_close,
        )
    ):
        return False, []

    earliest = max(
        minutes(shop_open),
        minutes(worker_open),
    )

    latest = min(
        minutes(shop_close),
        minutes(worker_close),
    )

    # Overnight shifts are not supported by this
    # existing date + time booking schema.
    if latest <= earliest:
        return False, []

    if duration <= 0:
        return False, []

    if duration > (
        latest - earliest
    ):
        return True, []

    busy_intervals = []

    for booking in bookings:
        if booking["booking_date"] != requested_date:
            continue

        busy_intervals.append(
            (
                minutes(booking["start_time"]),
                minutes(booking["end_time"]),
            )
        )

    slots: list[AvailableSlot] = []

    # Preserve the existing worker slot grid.
    candidate = minutes(
        worker_open
    )

    while candidate + duration <= latest:
        start_minutes = candidate

        end_minutes = (
            candidate + duration
        )

        candidate += SLOT_INTERVAL_MINUTES

        if start_minutes < earliest:
            continue

        if (
            start_minutes >= 1440
            or end_minutes >= 1440
        ):
            continue

        # Do not offer slots that have already started.
        if requested_date == now.date():
            current_minutes = (
                now.hour * 60
                + now.minute
                + (
                    1
                    if now.second or now.microsecond
                    else 0
                )
            )

            if start_minutes <= current_minutes:
                continue

        if not schedule_allows(
            worker,
            requested_date,
            start_minutes,
            end_minutes,
        ):
            continue

        conflict = any(
            overlaps(
                start_minutes,
                end_minutes,
                busy_start,
                busy_end,
            )
            for busy_start, busy_end in busy_intervals
        )

        if conflict:
            continue

        slots.append(
            AvailableSlot(
                startTime=to_time(
                    start_minutes
                ).strftime("%H:%M"),

                endTime=to_time(
                    end_minutes
                ).strftime("%H:%M"),

                available=True,
            )
        )

    return True, slots


# ============================================================
# DATABASE QUERIES
# ============================================================

SHOP_QUERY = text("""
    SELECT
        app.opening_time,
        app.closing_time,
        app.working_days

    FROM public.barber_accounts AS ba

    INNER JOIN public.barber_applications AS app
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


SERVICE_QUERY = text("""
    SELECT
        id,
        duration_minutes

    FROM public.barber_services

    WHERE id = :service_id
      AND barber_id = :barber_id
      AND is_active = TRUE

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


BOOKINGS_QUERY = text("""
    SELECT
        booking_date,
        start_time,
        end_time

    FROM public.barber_bookings

    WHERE barber_id = :barber_id
      AND worker_id = :worker_id

      AND booking_date >= :start_date
      AND booking_date <= :end_date

      AND LOWER(status) IN (
          'pending',
          'confirmed'
      )

    ORDER BY
        booking_date,
        start_time
""")


# ============================================================
# LOAD REAL SHOP, SERVICE, WORKER, BOOKINGS
# ============================================================

async def load_booking_context(
    db: AsyncSession,
    barber_id: UUID,
    worker_id: UUID,
    service_id: UUID,
    start_date: date,
    end_date: date,
) -> tuple[
    dict,
    dict,
    int,
    list[dict],
]:
    """
    Reuse the same database retrieval for both
    single-day and seven-day availability.
    """

    params = {
        "barber_id": barber_id,
        "worker_id": worker_id,
        "service_id": service_id,
    }

    try:
        shop_result = await db.execute(
            SHOP_QUERY,
            params,
        )

        shop_row = shop_result.mappings().first()

        if shop_row is None:
            raise HTTPException(
                status_code=404,
                detail="Published shop not found.",
            )

        service_result = await db.execute(
            SERVICE_QUERY,
            params,
        )

        service_row = service_result.mappings().first()

        if service_row is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Selected service is not available."
                ),
            )

        worker_result = await db.execute(
            WORKER_QUERY,
            params,
        )

        worker_row = worker_result.mappings().first()

        if worker_row is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Selected worker is not available."
                ),
            )

        bookings_result = await db.execute(
            BOOKINGS_QUERY,
            {
                "barber_id": barber_id,
                "worker_id": worker_id,
                "start_date": start_date,
                "end_date": end_date,
            },
        )

        booking_rows = bookings_result.mappings().all()

    except HTTPException:
        raise

    except SQLAlchemyError as exc:
        logger.exception(
            "Failed to load appointment availability "
            "for barber=%s worker=%s",
            barber_id,
            worker_id,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Appointment availability is "
                "temporarily unavailable."
            ),
        ) from exc

    duration = int(
        service_row["duration_minutes"]
    )

    if (
        duration <= 0
        or duration > MAX_SERVICE_DURATION_MINUTES
    ):
        raise HTTPException(
            status_code=409,
            detail="Service duration is invalid.",
        )

    shop = dict(shop_row)
    worker = dict(worker_row)

    # Validate stored JSON before calculating slots.
    try:
        worker["slot_availability"] = (
            optional_json_object(
                worker.get("slot_availability")
            )
        )

        worker["custom_breaks"] = (
            optional_json_object(
                worker.get("custom_breaks")
            )
        )

    except ValueError as exc:
        logger.warning(
            "Invalid worker schedule data: worker=%s",
            worker_id,
        )

        raise HTTPException(
            status_code=409,
            detail=(
                "Worker availability configuration "
                "is invalid."
            ),
        ) from exc

    bookings = [
        dict(row)
        for row in booking_rows
    ]

    return (
        shop,
        worker,
        duration,
        bookings,
    )


# ============================================================
# DATE VALIDATION
# ============================================================

def validate_date_range(
    start_date: date,
    end_date: date,
) -> None:
    now = datetime.now(SHOP_TIMEZONE)

    if start_date < now.date():
        raise HTTPException(
            status_code=422,
            detail=(
                "Appointment date cannot be "
                "in the past."
            ),
        )

    maximum_date = (
        now.date()
        + timedelta(days=MAX_ADVANCE_DAYS)
    )

    if end_date > maximum_date:
        raise HTTPException(
            status_code=422,
            detail=(
                "Appointment date is too far "
                "in advance."
            ),
        )


# ============================================================
# SINGLE-DAY SLOT AVAILABILITY
# ============================================================

@router.get(
    "/{barber_id}/slots",
    response_model=SlotAvailabilityResponse,
)
async def get_customer_available_slots(
    barber_id: UUID,

    worker_id: Annotated[
        UUID,
        Query(),
    ],

    service_id: Annotated[
        UUID,
        Query(),
    ],

    booking_date: Annotated[
        date,
        Query(),
    ],

    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
):
    """
    Existing endpoint preserved for Customer
    ShopDetailsBookingCard compatibility.
    """

    validate_date_range(
        booking_date,
        booking_date,
    )

    shop, worker, duration, bookings = (
        await load_booking_context(
            db=db,
            barber_id=barber_id,
            worker_id=worker_id,
            service_id=service_id,
            start_date=booking_date,
            end_date=booking_date,
        )
    )

    now = datetime.now(SHOP_TIMEZONE)

    _, slots = calculate_day_slots(
        shop=shop,
        worker=worker,
        duration=duration,
        requested_date=booking_date,
        bookings=bookings,
        now=now,
    )

    return SlotAvailabilityResponse(
        barberId=barber_id,
        workerId=worker_id,
        serviceId=service_id,
        date=booking_date,
        serviceDurationMinutes=duration,
        slots=slots,
        totalAvailable=len(slots),
    )


# ============================================================
# ROLLING SEVEN-DAY AVAILABILITY
# ============================================================

@router.get(
    "/{barber_id}/slots/week",
    response_model=WeeklySlotAvailabilityResponse,
)
async def get_customer_weekly_slots(
    barber_id: UUID,

    worker_id: Annotated[
        UUID,
        Query(),
    ],

    service_id: Annotated[
        UUID,
        Query(),
    ],

    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
    start_date: Annotated[
        date | None,
        Query(
            description=(
                "First date of the seven-day window. "
                "Defaults to today in Asia/Kolkata."
            ),
        ),
    ] = None,
):
    """
    Returns seven consecutive dates.

    Each day includes:
      - date
      - weekday
      - open/closed status
      - total available slots
      - actual available time intervals

    All information comes from shop/worker schedules
    and existing database bookings.
    """

    now = datetime.now(SHOP_TIMEZONE)

    first_date = (
        start_date
        if start_date is not None
        else now.date()
    )

    last_date = (
        first_date
        + timedelta(days=WEEK_WINDOW_DAYS - 1)
    )

    validate_date_range(
        first_date,
        last_date,
    )

    shop, worker, duration, bookings = (
        await load_booking_context(
            db=db,
            barber_id=barber_id,
            worker_id=worker_id,
            service_id=service_id,
            start_date=first_date,
            end_date=last_date,
        )
    )

    days: list[DayAvailability] = []

    total_available = 0

    for offset in range(WEEK_WINDOW_DAYS):
        requested_date = (
            first_date
            + timedelta(days=offset)
        )

        is_open, slots = calculate_day_slots(
            shop=shop,
            worker=worker,
            duration=duration,
            requested_date=requested_date,
            bookings=bookings,
            now=now,
        )

        total_available += len(slots)

        days.append(
            DayAvailability(
                date=requested_date,
                dayName=WEEKDAY_NAMES[
                    requested_date.weekday()
                ],
                isOpen=is_open,
                totalAvailable=len(slots),
                slots=slots,
            )
        )

    return WeeklySlotAvailabilityResponse(
        barberId=barber_id,
        workerId=worker_id,
        serviceId=service_id,
        startDate=first_date,
        endDate=last_date,
        serviceDurationMinutes=duration,
        days=days,
        totalAvailable=total_available,
    )
