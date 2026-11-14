"""Customer notification inbox.

Reads notifications belonging to the authenticated customer.
Notification creation is handled by booking/rescheduling events.
"""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.customer.api.customer_session import get_authenticated_customer


logger = logging.getLogger("kshurak.customer.notifications")

router = APIRouter(
    prefix="/api/v1/customer/notifications",
    tags=["Customer Notifications"],
)

Customer = Annotated[dict, Depends(get_authenticated_customer)]
Database = Annotated[AsyncSession, Depends(get_db)]


def customer_id(customer: dict) -> UUID:
    try:
        return UUID(str(customer["id"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication.",
        ) from exc


@router.get("")
async def list_notifications(
    customer: Customer,
    db: Database,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    params = {
        "customer_id": customer_id(customer),
        "limit": limit,
        "offset": offset,
    }

    try:
        counts = (
            await db.execute(
                text("""
                    SELECT
                        COUNT(*) AS total,
                        COUNT(*) FILTER (
                            WHERE is_read = FALSE
                        ) AS unread_count
                    FROM public.app_notifications
                    WHERE recipient_type = 'customer'
                      AND recipient_id = :customer_id
                """),
                params,
            )
        ).mappings().one()

        rows = (
            await db.execute(
                text("""
                    SELECT
                        id,
                        notification_type,
                        title,
                        message,
                        reference_type,
                        reference_id,
                        action_url,
                        metadata,
                        is_read,
                        read_at,
                        created_at
                    FROM public.app_notifications
                    WHERE recipient_type = 'customer'
                      AND recipient_id = :customer_id
                    ORDER BY created_at DESC, id DESC
                    LIMIT :limit
                    OFFSET :offset
                """),
                params,
            )
        ).mappings().all()

        return {
            "notifications": [dict(row) for row in rows],
            "total": int(counts["total"]),
            "unread_count": int(counts["unread_count"]),
            "limit": limit,
            "offset": offset,
        }

    except SQLAlchemyError as exc:
        logger.exception("Customer notification list failed.")
        raise HTTPException(
            status_code=503,
            detail="Notifications are temporarily unavailable.",
        ) from exc


@router.get("/unread-count")
async def unread_count(
    customer: Customer,
    db: Database,
):
    try:
        count = await db.scalar(
            text("""
                SELECT COUNT(*)
                FROM public.app_notifications
                WHERE recipient_type = 'customer'
                  AND recipient_id = :customer_id
                  AND is_read = FALSE
            """),
            {"customer_id": customer_id(customer)},
        )

        return {"unread_count": int(count or 0)}

    except SQLAlchemyError as exc:
        logger.exception("Customer unread count failed.")
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve notification count.",
        ) from exc


@router.post("/read-all")
async def mark_all_read(
    customer: Customer,
    db: Database,
):
    try:
        result = await db.execute(
            text("""
                UPDATE public.app_notifications
                SET
                    is_read = TRUE,
                    read_at = NOW(),
                    updated_at = NOW()
                WHERE recipient_type = 'customer'
                  AND recipient_id = :customer_id
                  AND is_read = FALSE
                RETURNING id
            """),
            {"customer_id": customer_id(customer)},
        )

        updated_count = len(result.fetchall())
        await db.commit()

        return {
            "message": "Notifications marked as read.",
            "updated_count": updated_count,
        }

    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Customer mark-all-read failed.")
        raise HTTPException(
            status_code=503,
            detail="Unable to update notifications.",
        ) from exc


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: UUID,
    customer: Customer,
    db: Database,
):
    try:
        result = await db.execute(
            text("""
                UPDATE public.app_notifications
                SET
                    is_read = TRUE,
                    read_at = COALESCE(read_at, NOW()),
                    updated_at = CASE
                        WHEN is_read = FALSE THEN NOW()
                        ELSE updated_at
                    END
                WHERE id = :notification_id
                  AND recipient_type = 'customer'
                  AND recipient_id = :customer_id
                RETURNING id, is_read, read_at
            """),
            {
                "notification_id": notification_id,
                "customer_id": customer_id(customer),
            },
        )

        row = result.mappings().first()

        if row is None:
            raise HTTPException(
                status_code=404,
                detail="Notification not found.",
            )

        notification = dict(row)
        await db.commit()

        return {
            "message": "Notification marked as read.",
            "notification": notification,
        }

    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Customer mark-read failed.")
        raise HTTPException(
            status_code=503,
            detail="Unable to update notification.",
        ) from exc