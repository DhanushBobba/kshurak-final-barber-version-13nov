"""
Shared KSHURAK barber rescheduling rules.

This module validates policy and proposal structure.
Database ownership, availability checks, locks and updates
must be performed by the API endpoints.
"""

from collections.abc import Mapping, Sequence
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException


SHOP_TIMEZONE = ZoneInfo("Asia/Kolkata")
BARBER_CHANGE_WINDOW = timedelta(hours=24)

CANCEL_BOOKING = "cancel_booking"
SAME_WORKER_OTHER_DAY = "same_worker_other_day"
OTHER_WORKER_SAME_DAY = "other_worker_same_day"

RECOVERY_OPTION_TYPES = frozenset(
    {
        CANCEL_BOOKING,
        SAME_WORKER_OTHER_DAY,
        OTHER_WORKER_SAME_DAY,
    }
)


def current_utc() -> datetime:
    return datetime.now(timezone.utc)


def normalize_now(value: datetime | None = None) -> datetime:
    result = value if value is not None else current_utc()

    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError("The current timestamp must include a timezone.")

    return result.astimezone(timezone.utc)


def normalize_uuid(value: Any, field_name: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(
            status_code=422,
            detail=f"{field_name} must be a valid UUID.",
        ) from exc


def normalize_date(value: Any, field_name: str) -> date:
    if isinstance(value, datetime):
        raise HTTPException(
            status_code=422,
            detail=f"{field_name} must contain only a date.",
        )

    if isinstance(value, date):
        return value

    try:
        return date.fromisoformat(str(value))
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=422,
            detail=f"{field_name} must be a valid date.",
        ) from exc


def normalize_time(value: Any, field_name: str) -> time:
    try:
        result = (
            value
            if isinstance(value, time)
            else time.fromisoformat(str(value))
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=422,
            detail=f"{field_name} must be a valid time.",
        ) from exc

    if result.tzinfo is not None:
        raise HTTPException(
            status_code=422,
            detail=f"{field_name} must be a local shop time.",
        )

    if result.second != 0 or result.microsecond != 0:
        raise HTTPException(
            status_code=422,
            detail=f"{field_name} must use whole minutes.",
        )

    return result


def appointment_timestamp(
    appointment_date: Any,
    start_time: Any,
) -> datetime:
    day = normalize_date(
        appointment_date,
        "Appointment date",
    )
    start = normalize_time(
        start_time,
        "Appointment start time",
    )

    return datetime.combine(
        day,
        start,
        tzinfo=SHOP_TIMEZONE,
    ).astimezone(timezone.utc)


def confirmation_timestamp(
    booking: Mapping[str, Any],
) -> datetime | None:
    value = booking.get("confirmed_at")

    if value is None:
        return None

    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(
                value.replace("Z", "+00:00")
            )
        except ValueError:
            return None

    if not isinstance(value, datetime):
        return None

    if value.tzinfo is None or value.utcoffset() is None:
        return None

    return value.astimezone(timezone.utc)


def barber_reschedule_eligibility(
    booking: Mapping[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """
    Evaluate the initiation window.

    At exactly confirmed_at + 24 hours, initiation is closed.
    Missing confirmation timestamps are never replaced by created_at.
    """

    checked_at = normalize_now(now)
    confirmed_at = confirmation_timestamp(booking)

    deadline = (
        confirmed_at + BARBER_CHANGE_WINDOW
        if confirmed_at is not None
        else None
    )

    result: dict[str, Any] = {
        "eligible": False,
        "code": None,
        "message": None,
        "confirmed_at": confirmed_at,
        "deadline": deadline,
        "checked_at": checked_at,
    }

    if booking.get("status") != "confirmed":
        result.update(
            code="BOOKING_NOT_CONFIRMED",
            message="Only confirmed bookings can be rescheduled.",
        )
        return result

    appointment_start = appointment_timestamp(
        booking.get("booking_date"),
        booking.get("start_time"),
    )

    if appointment_start <= checked_at:
        result.update(
            code="APPOINTMENT_ALREADY_STARTED",
            message=(
                "Past appointments and appointments that have "
                "already started cannot be rescheduled."
            ),
        )
        return result

    if confirmed_at is None:
        result.update(
            code="CONFIRMATION_TIMESTAMP_MISSING",
            message=(
                "This booking has no valid confirmation timestamp. "
                "Its rescheduling eligibility cannot be verified."
            ),
        )
        return result

    if confirmed_at > checked_at:
        result.update(
            code="CONFIRMATION_TIMESTAMP_INVALID",
            message="The booking confirmation timestamp is invalid.",
        )
        return result

    if deadline is not None and checked_at >= deadline:
        result.update(
            code="BARBER_RESCHEDULE_WINDOW_CLOSED",
            message=(
                "The barber can initiate a reschedule only within "
                "24 hours of booking confirmation."
            ),
        )
        return result

    result.update(
        eligible=True,
        code="ELIGIBLE",
        message="This booking is eligible for a barber proposal.",
    )

    return result


def require_barber_reschedule_eligibility(
    booking: Mapping[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    eligibility = barber_reschedule_eligibility(
        booking,
        now=now,
    )

    if not eligibility["eligible"]:
        deadline = eligibility["deadline"]

        raise HTTPException(
            status_code=409,
            detail={
                "code": eligibility["code"],
                "message": eligibility["message"],
                "deadline": (
                    deadline.isoformat()
                    if deadline is not None
                    else None
                ),
            },
        )

    return eligibility


def require_upcoming_confirmed_booking(
    booking: Mapping[str, Any],
    *,
    now: datetime | None = None,
) -> None:
    """
    Used when a customer decides an existing proposal.

    This deliberately does not restart or reapply the barber's
    24-hour initiation window.
    """

    if booking.get("status") != "confirmed":
        raise HTTPException(
            status_code=409,
            detail="The original booking is no longer confirmed.",
        )

    appointment_start = appointment_timestamp(
        booking.get("booking_date"),
        booking.get("start_time"),
    )

    if appointment_start <= normalize_now(now):
        raise HTTPException(
            status_code=409,
            detail="The original appointment has already started.",
        )


def require_original_booking_unchanged(
    booking: Mapping[str, Any],
    request: Mapping[str, Any],
) -> None:
    original_worker = request.get("original_worker_id")
    current_worker = booking.get("worker_id")

    worker_changed = (
        str(current_worker) if current_worker is not None else None
    ) != (
        str(original_worker) if original_worker is not None else None
    )

    if (
        booking.get("booking_date") != request.get("original_date")
        or booking.get("start_time")
        != request.get("original_start_time")
        or booking.get("end_time")
        != request.get("original_end_time")
        or worker_changed
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "The original booking has changed. "
                "Refresh the booking before continuing."
            ),
        )


def normalize_reason(value: Any) -> str:
    if not isinstance(value, str):
        raise HTTPException(
            status_code=422,
            detail="An unavailability reason is required.",
        )

    reason = value.strip()

    if not 3 <= len(reason) <= 1000:
        raise HTTPException(
            status_code=422,
            detail="The reason must contain 3 to 1000 characters.",
        )

    return reason


def normalize_recovery_options(
    booking: Mapping[str, Any],
    options: Sequence[Mapping[str, Any]],
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """
    Validate the three choices and normalize their values.

    The caller must additionally verify:
    - every worker belongs to the booked shop;
    - workers and services are active;
    - shop and worker schedules allow each appointment;
    - appointments do not overlap existing bookings.

    Options are proposals, not slot reservations.
    Availability must be checked again on customer selection.
    """

    checked_at = normalize_now(now)

    if (
        isinstance(options, (str, bytes))
        or not isinstance(options, Sequence)
        or len(options) != 3
    ):
        raise HTTPException(
            status_code=422,
            detail="Provide exactly three recovery options.",
        )

    if any(not isinstance(item, Mapping) for item in options):
        raise HTTPException(
            status_code=422,
            detail="Each recovery option must be an object.",
        )

    option_types = [
        item.get("option_type")
        for item in options
    ]

    if (
        any(not isinstance(value, str) for value in option_types)
        or set(option_types) != RECOVERY_OPTION_TYPES
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Provide cancellation, another day with the same "
                "worker, and the same day with another worker."
            ),
        )

    original_worker = normalize_uuid(
        booking.get("worker_id"),
        "Original worker",
    )
    original_date = normalize_date(
        booking.get("booking_date"),
        "Original appointment date",
    )

    try:
        duration = int(booking["service_duration_minutes"])
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=409,
            detail="The booking has an invalid service duration.",
        ) from exc

    if not 1 <= duration <= 720:
        raise HTTPException(
            status_code=409,
            detail="The booking has an invalid service duration.",
        )

    normalized: list[dict[str, Any]] = []

    for item in options:
        option_type = item["option_type"]

        if option_type == CANCEL_BOOKING:
            if any(
                item.get(field) is not None
                for field in (
                    "worker_id",
                    "appointment_date",
                    "start_time",
                    "end_time",
                )
            ):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "The cancellation option must not contain "
                        "worker or appointment details."
                    ),
                )

            normalized.append(
                {
                    "option_type": CANCEL_BOOKING,
                    "worker_id": None,
                    "appointment_date": None,
                    "start_time": None,
                    "end_time": None,
                }
            )
            continue

        worker_id = normalize_uuid(
            item.get("worker_id"),
            "Option worker",
        )
        appointment_date = normalize_date(
            item.get("appointment_date"),
            "Option appointment date",
        )
        start = normalize_time(
            item.get("start_time"),
            "Option start time",
        )
        end = normalize_time(
            item.get("end_time"),
            "Option end time",
        )

        if end <= start:
            raise HTTPException(
                status_code=422,
                detail="Option end time must be after start time.",
            )

        start_minutes = start.hour * 60 + start.minute
        end_minutes = end.hour * 60 + end.minute

        if end_minutes - start_minutes != duration:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Each appointment option must preserve "
                    "the booked service duration."
                ),
            )

        if (
            appointment_timestamp(appointment_date, start)
            <= checked_at
        ):
            raise HTTPException(
                status_code=422,
                detail="Each appointment option must be in the future.",
            )

        if option_type == SAME_WORKER_OTHER_DAY:
            if worker_id != original_worker:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "The other-day option must use "
                        "the original worker."
                    ),
                )

            if appointment_date == original_date:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "The same-worker option must use "
                        "a different appointment date."
                    ),
                )

        if option_type == OTHER_WORKER_SAME_DAY:
            if worker_id == original_worker:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "The same-day option must use "
                        "a different worker."
                    ),
                )

            if appointment_date != original_date:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "The replacement-worker option must use "
                        "the original appointment date."
                    ),
                )

        normalized.append(
            {
                "option_type": option_type,
                "worker_id": worker_id,
                "appointment_date": appointment_date,
                "start_time": start,
                "end_time": end,
            }
        )

    return normalized
