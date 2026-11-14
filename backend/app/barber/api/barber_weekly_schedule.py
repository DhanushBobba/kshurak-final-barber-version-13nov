"""
KSHURAK worker weekly schedules.

Storage:
    public.barber_workers.slot_availability["weekly_days"]

True  = working day
False = weekly holiday
"""

import json
import logging
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, StrictBool, model_validator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.barber.api.barber_workers import get_approved_barber


logger = logging.getLogger("kshurak.barber.weekly_schedule")

router = APIRouter(
    prefix="/api/v1/barber/workers",
    tags=["Barber Weekly Schedule"],
)

DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

DayName = Literal[
    "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"
]


class WeeklyScheduleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weekly_days: dict[DayName, StrictBool]

    @model_validator(mode="after")
    def validate_week(self):
        if set(self.weekly_days) != set(DAYS):
            raise ValueError(
                "Provide Mon, Tue, Wed, Thu, Fri, Sat and Sun."
            )
        return self


class WeeklyScheduleResponse(BaseModel):
    worker_id: UUID
    weekly_days: dict[str, bool]


def authenticated_barber_id(barber: object) -> UUID:
    if isinstance(barber, UUID):
        return barber

    if isinstance(barber, dict):
        raw_id = barber.get("id")
    elif isinstance(barber, str):
        raw_id = barber
    else:
        raw_id = getattr(barber, "id", None)

    try:
        return UUID(str(raw_id))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid barber session. Please log in again.",
        ) from exc


def read_week(availability: object) -> dict[str, bool]:
    if availability is None:
        return {day: True for day in DAYS}

    if not isinstance(availability, dict):
        raise HTTPException(
            status_code=409,
            detail="Worker slot availability must be a JSON object.",
        )

    stored = availability.get("weekly_days")

    # Existing workers without a schedule display all days as working.
    # This default is not written until Save is clicked.
    if stored is None:
        return {day: True for day in DAYS}

    if not isinstance(stored, dict):
        raise HTTPException(
            status_code=409,
            detail="Stored weekly schedule is invalid.",
        )

    aliases = {
        "mon": "Mon",
        "monday": "Mon",
        "tue": "Tue",
        "tuesday": "Tue",
        "wed": "Wed",
        "wednesday": "Wed",
        "thu": "Thu",
        "thursday": "Thu",
        "fri": "Fri",
        "friday": "Fri",
        "sat": "Sat",
        "saturday": "Sat",
        "sun": "Sun",
        "sunday": "Sun",
    }

    result = {day: True for day in DAYS}

    for name, working in stored.items():
        day = aliases.get(str(name).strip().lower())

        if day is None or not isinstance(working, bool):
            raise HTTPException(
                status_code=409,
                detail="Stored weekly schedule contains invalid values.",
            )

        result[day] = working

    return result


async def find_worker(
    db: AsyncSession,
    worker_id: UUID,
    barber_id: UUID,
    *,
    lock: bool = False,
) -> dict:
    query = """
        SELECT id, slot_availability
        FROM public.barber_workers
        WHERE id = :worker_id
          AND barber_id = :barber_id
          AND is_active = TRUE
    """

    if lock:
        query += " FOR UPDATE"

    result = await db.execute(
        text(query),
        {
            "worker_id": worker_id,
            "barber_id": barber_id,
        },
    )

    row = result.mappings().first()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Active worker not found for your shop.",
        )

    return dict(row)


@router.get(
    "/{worker_id}/weekly-schedule",
    response_model=WeeklyScheduleResponse,
)
async def get_weekly_schedule(
    worker_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    barber: Annotated[object, Depends(get_approved_barber)],
):
    barber_id = authenticated_barber_id(barber)

    try:
        worker = await find_worker(
            db,
            worker_id,
            barber_id,
        )

        return WeeklyScheduleResponse(
            worker_id=worker_id,
            weekly_days=read_week(worker["slot_availability"]),
        )

    except SQLAlchemyError as exc:
        logger.exception(
            "Weekly schedule read failed for worker %s",
            worker_id,
        )
        raise HTTPException(
            status_code=503,
            detail="Unable to load weekly schedule.",
        ) from exc


@router.put(
    "/{worker_id}/weekly-schedule",
    response_model=WeeklyScheduleResponse,
)
async def save_weekly_schedule(
    worker_id: UUID,
    payload: WeeklyScheduleUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    barber: Annotated[object, Depends(get_approved_barber)],
):
    barber_id = authenticated_barber_id(barber)

    # Store real JSON booleans, not strings.
    weekly_days = {
        day: payload.weekly_days[day]
        for day in DAYS
    }

    try:
        worker = await find_worker(
            db,
            worker_id,
            barber_id,
            lock=True,
        )

        availability = worker["slot_availability"]

        if availability is not None and not isinstance(
            availability, dict
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Worker availability contains invalid data. "
                    "Existing slot settings were not overwritten."
                ),
            )

        result = await db.execute(
            text("""
                UPDATE public.barber_workers
                SET slot_availability = jsonb_set(
                    COALESCE(
                        slot_availability::jsonb,
                        '{}'::jsonb
                    ),
                    '{weekly_days}',
                    CAST(:weekly_json AS jsonb),
                    TRUE
                )
                WHERE id = :worker_id
                  AND barber_id = :barber_id
                  AND is_active = TRUE
                RETURNING id, slot_availability
            """),
            {
                "worker_id": worker_id,
                "barber_id": barber_id,
                "weekly_json": json.dumps(weekly_days),
            },
        )

        updated = result.mappings().first()

        if updated is None:
            raise HTTPException(
                status_code=404,
                detail="Worker is no longer available for editing.",
            )

        response = WeeklyScheduleResponse(
            worker_id=updated["id"],
            weekly_days=read_week(updated["slot_availability"]),
        )

        await db.commit()

        return response

    except HTTPException:
        await db.rollback()
        raise

    except SQLAlchemyError as exc:
        await db.rollback()

        logger.exception(
            "Weekly schedule save failed for worker %s",
            worker_id,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Unable to save weekly schedule. "
                "The backend terminal contains the database error."
            ),
        ) from exc