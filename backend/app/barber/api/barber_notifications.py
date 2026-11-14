
import logging
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.barber.api.barber_workers import get_approved_barber

logger = logging.getLogger("kshurak.barber.notifications")
router = APIRouter(
    prefix="/api/v1/barber/notifications",
    tags=["Barber Notifications"],
)
NotificationType = Literal[
    "new_booking",
    "booking_accepted",
    "booking_rejected",
    "booking_cancelled",
    "booking_completed",
    "reschedule_requested",
    "reschedule_approved",
    "reschedule_declined",
    "reschedule_withdrawn",
    "appointment_reminder",
    "shop_update",
    "account_alert",
    "general",
]

class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    recipient_type: str
    recipient_id: UUID
    notification_type: NotificationType
    title: str
    message: str
    reference_type: str | None = None
    reference_id: UUID | None = None
    action_url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_read: bool
    read_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

class NotificationCounts(BaseModel):
    total: int
    unread: int
    booking: int
    rescheduling: int
    other: int

class NotificationListResponse(BaseModel):
    notifications: list[NotificationResponse]
    total: int
    limit: int
    offset: int
    counts: NotificationCounts

class UnreadCountResponse(BaseModel):
    unread_count: int

class NotificationActionResponse(BaseModel):
    message: str
    notification: NotificationResponse

class MarkAllReadResponse(BaseModel):
    message: str
    updated_count: int
    unread_count: int

def to_notification(row: Any) -> NotificationResponse:
    return NotificationResponse.model_validate(dict(row))

def get_authenticated_barber_id(barber: UUID) -> UUID:
    if not isinstance(barber, UUID):
        raise HTTPException(
            status_code=401,
            detail="Invalid barber authentication context.",
        )
    return barber

def notification_category_sql(category: str) -> str:
    if category == "booking":
        return """
            notification_type IN (
                'new_booking',
                'booking_accepted',
                'booking_rejected',
                'booking_cancelled',
                'booking_completed',
                'appointment_reminder'
            )
        """
    if category == "rescheduling":
        return """
            notification_type IN (
                'reschedule_requested',
                'reschedule_approved',
                'reschedule_declined',
                'reschedule_withdrawn'
            )
        """
    if category == "other":
        return """
            notification_type IN (
                'shop_update',
                'account_alert',
                'general'
            )
        """
    return "TRUE"

async def get_counts(
    db: AsyncSession,
    barber_id: UUID,
) -> NotificationCounts:
    result = await db.execute(
        text("""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (
                    WHERE is_read = FALSE
                ) AS unread,
                COUNT(*) FILTER (
                    WHERE notification_type IN (
                        'new_booking',
                        'booking_accepted',
                        'booking_rejected',
                        'booking_cancelled',
                        'booking_completed',
                        'appointment_reminder'
                    )
                ) AS booking,
                COUNT(*) FILTER (
                    WHERE notification_type IN (
                        'reschedule_requested',
                        'reschedule_approved',
                        'reschedule_declined',
                        'reschedule_withdrawn'
                    )
                ) AS rescheduling,
                COUNT(*) FILTER (
                    WHERE notification_type IN (
                        'shop_update',
                        'account_alert',
                        'general'
                    )
                ) AS other
            FROM public.app_notifications
            WHERE recipient_type = 'barber'
              AND recipient_id = :barber_id
        """),
        {"barber_id": barber_id},
    )
    row = result.mappings().one()
    return NotificationCounts(
        total=int(row["total"]),
        unread=int(row["unread"]),
        booking=int(row["booking"]),
        rescheduling=int(row["rescheduling"]),
        other=int(row["other"]),
    )

async def get_unread_count(
    db: AsyncSession,
    barber_id: UUID,
) -> int:
    result = await db.execute(
        text("""
            SELECT COUNT(*)
            FROM public.app_notifications
            WHERE recipient_type = 'barber'
              AND recipient_id = :barber_id
              AND is_read = FALSE
        """),
        {"barber_id": barber_id},
    )
    return int(result.scalar_one())

async def find_notification(
    db: AsyncSession,
    barber_id: UUID,
    notification_id: UUID,
    lock: bool = False,
) -> NotificationResponse:
    query = """
        SELECT *
        FROM public.app_notifications
        WHERE id = :notification_id
          AND recipient_type = 'barber'
          AND recipient_id = :barber_id
    """
    if lock:
        query += " FOR UPDATE"
    result = await db.execute(
        text(query),
        {
            "notification_id": notification_id,
            "barber_id": barber_id,
        },
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Notification not found.",
        )
    return to_notification(row)

@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    barber_id: Annotated[UUID, Depends(get_approved_barber)],
    db: Annotated[AsyncSession, Depends(get_db)],
    category: Literal[
        "all", "booking", "rescheduling", "other"
    ] = "all",
    unread_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    authenticated_id = get_authenticated_barber_id(barber_id)
    conditions = [
        "recipient_type = 'barber'",
        "recipient_id = :barber_id",
    ]
    params: dict[str, Any] = {
        "barber_id": authenticated_id,
        "limit": limit,
        "offset": offset,
    }
    if category != "all":
        conditions.append(notification_category_sql(category))
    if unread_only:
        conditions.append("is_read = FALSE")
    where_clause = " AND ".join(conditions)
    try:
        result = await db.execute(
            text(f"""
                SELECT *
                FROM public.app_notifications
                WHERE {where_clause}
                ORDER BY created_at DESC, id DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        )
        notifications = [
            to_notification(row)
            for row in result.mappings().all()
        ]
        total_result = await db.execute(
            text(f"""
                SELECT COUNT(*)
                FROM public.app_notifications
                WHERE {where_clause}
            """),
            params,
        )
        total = int(total_result.scalar_one())
        counts = await get_counts(db, authenticated_id)
        return NotificationListResponse(
            notifications=notifications,
            total=total,
            limit=limit,
            offset=offset,
            counts=counts,
        )
    except SQLAlchemyError as exc:
        logger.exception(
            "Unable to list notifications for barber %s",
            authenticated_id,
        )
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve notifications.",
        ) from exc

@router.get(
    "/unread-count",
    response_model=UnreadCountResponse,
)
async def unread_notifications_count(
    barber_id: Annotated[UUID, Depends(get_approved_barber)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    authenticated_id = get_authenticated_barber_id(barber_id)
    try:
        unread = await get_unread_count(db, authenticated_id)
        return UnreadCountResponse(unread_count=unread)
    except SQLAlchemyError as exc:
        logger.exception("Unable to retrieve unread notification count")
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve unread notification count.",
        ) from exc

@router.get(
    "/{notification_id}",
    response_model=NotificationResponse,
)
async def get_notification_details(
    notification_id: UUID,
    barber_id: Annotated[UUID, Depends(get_approved_barber)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    try:
        return await find_notification(
            db,
            get_authenticated_barber_id(barber_id),
            notification_id,
        )
    except SQLAlchemyError as exc:
        logger.exception("Unable to retrieve notification details")
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve notification.",
        ) from exc

@router.patch(
    "/{notification_id}/read",
    response_model=NotificationActionResponse,
)
async def mark_notification_read(
    notification_id: UUID,
    barber_id: Annotated[UUID, Depends(get_approved_barber)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    authenticated_id = get_authenticated_barber_id(barber_id)
    try:
        notification = await find_notification(
            db,
            authenticated_id,
            notification_id,
            lock=True,
        )
        if notification.is_read:
            await db.rollback()
            return NotificationActionResponse(
                message="Notification is already marked as read.",
                notification=notification,
            )
        result = await db.execute(
            text("""
                UPDATE public.app_notifications
                SET is_read = TRUE,
                    read_at = NOW(),
                    updated_at = NOW()
                WHERE id = :notification_id
                  AND recipient_type = 'barber'
                  AND recipient_id = :barber_id
                RETURNING *
            """),
            {
                "notification_id": notification_id,
                "barber_id": authenticated_id,
            },
        )
        row = result.mappings().one()
        updated = to_notification(row)
        await db.commit()
        return NotificationActionResponse(
            message="Notification marked as read.",
            notification=updated,
        )
    except HTTPException:
        await db.rollback()
        raise
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Unable to mark notification as read")
        raise HTTPException(
            status_code=503,
            detail="Unable to update notification.",
        ) from exc

@router.post(
    "/read-all",
    response_model=MarkAllReadResponse,
)
async def mark_all_notifications_read(
    barber_id: Annotated[UUID, Depends(get_approved_barber)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    authenticated_id = get_authenticated_barber_id(barber_id)
    try:
        result = await db.execute(
            text("""
                UPDATE public.app_notifications
                SET is_read = TRUE,
                    read_at = NOW(),
                    updated_at = NOW()
                WHERE recipient_type = 'barber'
                  AND recipient_id = :barber_id
                  AND is_read = FALSE
                RETURNING id
            """),
            {"barber_id": authenticated_id},
        )
        updated_count = len(result.fetchall())
        await db.commit()
        return MarkAllReadResponse(
            message="All notifications marked as read.",
            updated_count=updated_count,
            unread_count=0,
        )
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Unable to mark all notifications as read")
        raise HTTPException(
            status_code=503,
            detail="Unable to update notifications.",
        ) from exc
