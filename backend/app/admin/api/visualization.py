
"""Read-only KSHURAK Admin Visualization API (TEST PostgreSQL schema).

Existing platform analytics remain available. Booking analytics can be filtered by
shop (barber_accounts.id == barber_bookings.barber_id). Customer/face metrics
are platform-wide because a shop relationship has not been verified for them.
"""

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.admin.services.auth_service import verify_admin_token
from app.core.database import AsyncSessionLocal

logger = logging.getLogger("kshurak.admin.visualization")
router = APIRouter(prefix="/api/v1/admin/visualization", tags=["Admin Visualization"])
AdminUser = Annotated[dict, Depends(verify_admin_token)]

ALLOWED_PERIODS = (7, 30, 90, 365)
MAX_CUSTOM_DAYS = 366


@router.get("/shops")
async def list_visualization_shops(admin: AdminUser):
    """Return selectable barber accounts, including those not yet approved."""
    statement = text("""
        SELECT id::text AS id,
               COALESCE(NULLIF(BTRIM(shop_name), ''), NULLIF(BTRIM(username), ''), id::text) AS shop_name,
               approval_status,
               is_email_activated
        FROM public.barber_accounts
        ORDER BY LOWER(COALESCE(NULLIF(BTRIM(shop_name), ''), username, id::text)), id
    """)
    try:
        async with AsyncSessionLocal() as session:
            rows = (await session.execute(statement)).mappings().all()
        return {"shops": [dict(row) for row in rows]}
    except SQLAlchemyError as exc:
        logger.exception("Unable to retrieve shop filters")
        raise HTTPException(
            status_code=503,
            detail="Shop filters are temporarily unavailable.",
        ) from exc


@router.get("/overview")
async def get_visualization_overview(
    admin: AdminUser,
    days: int = Query(
        default=30,
        description="Preset reporting period: 7, 30, 90 or 365 days",
    ),
    shop_id: UUID | None = Query(
        default=None,
        description="Optional barber_accounts.id for shop-specific data",
    ),
    start_date: date | None = Query(
        default=None,
        description="Optional custom UTC start date (YYYY-MM-DD)",
    ),
    end_date: date | None = Query(
        default=None,
        description="Optional custom UTC end date (YYYY-MM-DD)",
    ),
):
    """Return actual counts and chart series for the selected date/shop.

    Date-range booking analytics use booking_date (scheduled service day);
    booking creation trends use created_at. Revenue is deliberately not
    inferred from service_price. Platform-wide metrics are not silently
    shop-filtered.
    """
    if days not in ALLOWED_PERIODS:
        raise HTTPException(
            status_code=422,
            detail="days must be one of: 7, 30, 90, 365",
        )

    if (start_date is None) != (end_date is None):
        raise HTTPException(
            status_code=422,
            detail="start_date and end_date must be supplied together",
        )

    today = datetime.now(timezone.utc).date()

    if start_date is not None and end_date is not None:
        if start_date > end_date:
            raise HTTPException(
                status_code=422,
                detail="start_date must be on or before end_date",
            )

        if end_date > today:
            raise HTTPException(
                status_code=422,
                detail="end_date cannot be in the future",
            )

        if (end_date - start_date).days + 1 > MAX_CUSTOM_DAYS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Custom reporting period cannot exceed "
                    f"{MAX_CUSTOM_DAYS} days"
                ),
            )

        period_start, period_end = start_date, end_date
        period_days = (period_end - period_start).days + 1
        date_mode = "custom"

    else:
        period_end = today
        period_start = today - timedelta(days=days - 1)
        period_days = days
        date_mode = "preset"

    start_at = datetime.combine(
        period_start,
        time.min,
        tzinfo=timezone.utc,
    )

    end_at = datetime.combine(
        period_end + timedelta(days=1),
        time.min,
        tzinfo=timezone.utc,
    )

    params = {
        "start_date": period_start,
        "end_date": period_end,
        "start_at": start_at,
        "end_at": end_at,
        # child_profiles.created_at is timestamp without time zone,
        # stored as UTC.
        "child_start": start_at.replace(tzinfo=None),
        "child_end": end_at.replace(tzinfo=None),
    }

    shop_params = dict(params)

    if shop_id is not None:
        shop_params["shop_id"] = str(shop_id)

        shop_where_bookings = (
            "AND b.barber_id = CAST(:shop_id AS uuid)"
        )

        shop_where_statuses = (
            "WHERE id = CAST(:shop_id AS uuid)"
        )
    else:
        shop_where_bookings = ""
        shop_where_statuses = ""

    # Preserve previous lifetime platform summary fields.
    platform_summary_sql = text("""
        SELECT
            (SELECT COUNT(*) FROM public.profiles) AS customers,

            (SELECT COUNT(*) FROM public.child_profiles)
                AS child_profiles,

            (SELECT COUNT(*) FROM public.face_scans)
                AS face_scans,

            (SELECT COUNT(*) FROM public.face_metrics)
                AS face_metrics,

            (SELECT COUNT(*) FROM public.barber_accounts)
                AS barber_applications,

            (SELECT COUNT(*) FROM public.barber_accounts
             WHERE approval_status IN ('pending', 'needs_correction'))
                AS pending_review,

            (SELECT COUNT(*) FROM public.barber_accounts
             WHERE approval_status = 'approved')
                AS approved_barbers,

            (SELECT COUNT(*) FROM public.barber_accounts
             WHERE approval_status = 'rejected')
                AS rejected_barbers,

            (SELECT COUNT(*) FROM public.barber_accounts
             WHERE approval_status = 'needs_correction')
                AS info_requested,

            (SELECT COUNT(*) FROM public.barber_accounts
             WHERE approval_status = 'approved'
               AND is_email_activated = TRUE)
                AS activated_barbers,

            (SELECT COUNT(*) FROM public.barber_accounts
             WHERE approval_status = 'approved'
               AND shop_address IS NOT NULL
               AND BTRIM(shop_address) <> '')
                AS registered_shop_entries
    """)

    # Customer and face activity remains platform-wide.
    # Barber registration trends can be scoped to a selected shop.
    daily_sql = text(f"""
        WITH calendar AS (
            SELECT d::date AS day
            FROM generate_series(
                CAST(:start_date AS date),
                CAST(:end_date AS date),
                INTERVAL '1 day'
            ) AS d
        ),

        customers AS (
            SELECT
                (created_at AT TIME ZONE 'UTC')::date AS day,
                COUNT(*) AS n
            FROM public.profiles
            WHERE created_at >= :start_at
              AND created_at < :end_at
            GROUP BY 1
        ),

        children AS (
            SELECT created_at::date AS day, COUNT(*) AS n
            FROM public.child_profiles
            WHERE created_at >= :child_start
              AND created_at < :child_end
            GROUP BY 1
        ),

        barbers AS (
            SELECT
                (created_at AT TIME ZONE 'UTC')::date AS day,
                COUNT(*) AS n
            FROM public.barber_accounts
            WHERE created_at >= :start_at
              AND created_at < :end_at
            {(
                'AND id = CAST(:shop_id AS uuid)'
                if shop_id is not None else ''
            )}
            GROUP BY 1
        ),

        scans AS (
            SELECT
                (scanned_at AT TIME ZONE 'UTC')::date AS day,
                COUNT(*) AS n
            FROM public.face_scans
            WHERE scanned_at >= :start_at
              AND scanned_at < :end_at
            GROUP BY 1
        ),

        metrics AS (
            SELECT
                (created_at AT TIME ZONE 'UTC')::date AS day,
                COUNT(*) AS n
            FROM public.face_metrics
            WHERE created_at >= :start_at
              AND created_at < :end_at
            GROUP BY 1
        )

        SELECT
            TO_CHAR(calendar.day, 'YYYY-MM-DD') AS date,
            COALESCE(customers.n, 0) AS customers,
            COALESCE(children.n, 0) AS child_profiles,
            COALESCE(barbers.n, 0) AS barber_applications,
            COALESCE(scans.n, 0) AS face_scans,
            COALESCE(metrics.n, 0) AS face_metrics

        FROM calendar
        LEFT JOIN customers USING (day)
        LEFT JOIN children USING (day)
        LEFT JOIN barbers USING (day)
        LEFT JOIN scans USING (day)
        LEFT JOIN metrics USING (day)

        ORDER BY calendar.day
    """)

    status_sql = text(f"""
        SELECT
            approval_status AS status,
            COUNT(*) AS count
        FROM public.barber_accounts
        {shop_where_statuses}
        GROUP BY approval_status
        ORDER BY approval_status
    """)

    shape_sql = text("""
        SELECT
            COALESCE(
                NULLIF(BTRIM(face_shape), ''),
                'Unknown'
            ) AS name,
            COUNT(*) AS count

        FROM public.face_scans

        WHERE scanned_at >= :start_at
          AND scanned_at < :end_at

        GROUP BY 1
        ORDER BY count DESC, name ASC
    """)

    hour_sql = text("""
        WITH hours AS (
            SELECT generate_series(0, 23) AS hour
        ),

        counts AS (
            SELECT
                EXTRACT(
                    HOUR FROM scanned_at AT TIME ZONE 'Asia/Kolkata'
                )::integer AS hour,
                COUNT(*) AS count

            FROM public.face_scans

            WHERE scanned_at >= :start_at
              AND scanned_at < :end_at

            GROUP BY 1
        )

        SELECT
            hours.hour,
            COALESCE(counts.count, 0) AS count

        FROM hours
        LEFT JOIN counts USING (hour)
        ORDER BY hours.hour
    """)

    # Date-filtered scheduled bookings.
    booking_filter = (
        f"WHERE b.booking_date BETWEEN :start_date AND :end_date "
        f"{shop_where_bookings}"
    )

    booking_summary_sql = text(f"""
        SELECT
            COUNT(*) AS total_bookings,

            COUNT(*) FILTER (
                WHERE LOWER(COALESCE(b.status, '')) = 'completed'
            ) AS completed_bookings,

            COUNT(*) FILTER (
                WHERE LOWER(COALESCE(b.status, ''))
                IN ('cancelled', 'canceled')
            ) AS cancelled_bookings,

            COUNT(DISTINCT b.customer_id)
                AS distinct_booking_customers,

            COALESCE(
                SUM(b.service_price) FILTER (
                    WHERE LOWER(COALESCE(b.status, '')) = 'completed'
                ),
                0
            ) AS completed_service_value

        FROM public.barber_bookings b
        {booking_filter}
    """)

    booking_status_sql = text(f"""
        SELECT
            COALESCE(
                NULLIF(BTRIM(b.status), ''),
                'Unknown'
            ) AS status,
            COUNT(*) AS count

        FROM public.barber_bookings b
        {booking_filter}

        GROUP BY 1
        ORDER BY count DESC, status
    """)

    services_sql = text(f"""
        SELECT
            COALESCE(
                NULLIF(BTRIM(b.service_name), ''),
                'Unknown'
            ) AS service_name,
            COUNT(*) AS bookings

        FROM public.barber_bookings b
        {booking_filter}

        GROUP BY 1
        ORDER BY bookings DESC, service_name
        LIMIT 12
    """)

    booking_daily_sql = text(f"""
        WITH calendar AS (
            SELECT d::date AS day

            FROM generate_series(
                CAST(:start_date AS date),
                CAST(:end_date AS date),
                INTERVAL '1 day'
            ) AS d
        ),

        scheduled AS (
            SELECT
                b.booking_date AS day,
                COUNT(*) AS total_bookings,

                COUNT(*) FILTER (
                    WHERE LOWER(COALESCE(b.status, '')) = 'completed'
                ) AS completed,

                COUNT(*) FILTER (
                    WHERE LOWER(COALESCE(b.status, ''))
                    IN ('cancelled', 'canceled')
                ) AS cancelled

            FROM public.barber_bookings b
            {booking_filter}
            GROUP BY b.booking_date
        ),

        created AS (
            SELECT
                (b.created_at AT TIME ZONE 'UTC')::date AS day,
                COUNT(*) AS created_bookings

            FROM public.barber_bookings b

            WHERE b.created_at >= :start_at
              AND b.created_at < :end_at
              {shop_where_bookings}

            GROUP BY 1
        )

        SELECT
            TO_CHAR(calendar.day, 'YYYY-MM-DD') AS date,
            COALESCE(scheduled.total_bookings, 0)
                AS total_bookings,
            COALESCE(scheduled.completed, 0)
                AS completed,
            COALESCE(scheduled.cancelled, 0)
                AS cancelled,
            COALESCE(created.created_bookings, 0)
                AS created_bookings

        FROM calendar
        LEFT JOIN scheduled USING (day)
        LEFT JOIN created USING (day)
        ORDER BY calendar.day
    """)

    shop_performance_sql = text("""
        SELECT
            a.id::text AS shop_id,

            COALESCE(
                NULLIF(BTRIM(a.shop_name), ''),
                NULLIF(BTRIM(a.username), ''),
                a.id::text
            ) AS shop_name,

            a.approval_status,

            COUNT(b.id) AS total_bookings,

            COUNT(b.id) FILTER (
                WHERE LOWER(COALESCE(b.status, '')) = 'completed'
            ) AS completed_bookings,

            COUNT(b.id) FILTER (
                WHERE LOWER(COALESCE(b.status, ''))
                IN ('cancelled', 'canceled')
            ) AS cancelled_bookings,

            COALESCE(
                SUM(b.service_price) FILTER (
                    WHERE LOWER(COALESCE(b.status, '')) = 'completed'
                ),
                0
            ) AS completed_service_value

        FROM public.barber_accounts a

        LEFT JOIN public.barber_bookings b
          ON b.barber_id = a.id
         AND b.booking_date BETWEEN :start_date AND :end_date

        """ + (
            "WHERE a.id = CAST(:shop_id AS uuid)"
            if shop_id is not None else ""
        ) + """

        GROUP BY
            a.id,
            a.shop_name,
            a.username,
            a.approval_status

        ORDER BY total_bookings DESC, shop_name
    """)

    shop_check_sql = text("""
        SELECT
            id::text AS id,

            COALESCE(
                NULLIF(BTRIM(shop_name), ''),
                NULLIF(BTRIM(username), ''),
                id::text
            ) AS shop_name,

            approval_status

        FROM public.barber_accounts
        WHERE id = CAST(:shop_id AS uuid)
    """)

    try:
        async with AsyncSessionLocal() as session:

            selected_shop = None

            if shop_id is not None:
                match = (
                    await session.execute(
                        shop_check_sql,
                        shop_params,
                    )
                ).mappings().first()

                if match is None:
                    raise HTTPException(
                        status_code=404,
                        detail="Selected shop was not found",
                    )

                selected_shop = dict(match)

            summary = dict(
                (
                    await session.execute(
                        platform_summary_sql
                    )
                ).mappings().one()
            )

            daily = [
                dict(row)
                for row in (
                    await session.execute(
                        daily_sql,
                        shop_params,
                    )
                ).mappings().all()
            ]

            statuses = [
                dict(row)
                for row in (
                    await session.execute(
                        status_sql,
                        shop_params,
                    )
                ).mappings().all()
            ]

            shapes = [
                dict(row)
                for row in (
                    await session.execute(
                        shape_sql,
                        params,
                    )
                ).mappings().all()
            ]

            hours = [
                dict(row)
                for row in (
                    await session.execute(
                        hour_sql,
                        params,
                    )
                ).mappings().all()
            ]

            booking_summary = dict(
                (
                    await session.execute(
                        booking_summary_sql,
                        shop_params,
                    )
                ).mappings().one()
            )

            booking_daily = [
                dict(row)
                for row in (
                    await session.execute(
                        booking_daily_sql,
                        shop_params,
                    )
                ).mappings().all()
            ]

            booking_statuses = [
                dict(row)
                for row in (
                    await session.execute(
                        booking_status_sql,
                        shop_params,
                    )
                ).mappings().all()
            ]

            services = [
                dict(row)
                for row in (
                    await session.execute(
                        services_sql,
                        shop_params,
                    )
                ).mappings().all()
            ]

            shops = [
                dict(row)
                for row in (
                    await session.execute(
                        shop_performance_sql,
                        shop_params,
                    )
                ).mappings().all()
            ]

        # Convert Decimal totals to numeric JSON values.
        # This represents service value, not confirmed revenue.
        booking_summary["completed_service_value"] = float(
            booking_summary["completed_service_value"]
        )

        for shop in shops:
            shop["completed_service_value"] = float(
                shop["completed_service_value"]
            )

        return {
            "period_days": period_days,
            "date_mode": date_mode,
            "start_date": period_start.isoformat(),
            "end_date": period_end.isoformat(),
            "timezone": "UTC",
            "scan_hour_timezone": "Asia/Kolkata",
            "shop_id": str(shop_id) if shop_id is not None else None,
            "selected_shop": selected_shop,

            "summary": summary,
            "summary_scope": "platform_lifetime",

            "daily_trends": daily,
            "barber_status_distribution": statuses,
            "face_shape_distribution": shapes,
            "scan_hours": hours,

            "booking_summary": booking_summary,
            "booking_daily_trends": booking_daily,
            "booking_status_distribution": booking_statuses,
            "popular_services": services,
            "shop_performance": shops,

            "metric_scopes": {
                "summary": "platform_lifetime",

                "daily_trends.customers": "platform_period",
                "daily_trends.child_profiles": "platform_period",
                "daily_trends.face_scans": "platform_period",
                "daily_trends.face_metrics": "platform_period",

                "daily_trends.barber_applications": (
                    "selected_shop_period"
                    if shop_id else "platform_period"
                ),

                "barber_status_distribution": (
                    "selected_shop_lifetime"
                    if shop_id else "platform_lifetime"
                ),

                "face_shape_distribution": "platform_period",
                "scan_hours": "platform_period",

                "booking_summary": (
                    "selected_shop_period"
                    if shop_id else "all_shops_period"
                ),

                "booking_daily_trends": (
                    "selected_shop_period"
                    if shop_id else "all_shops_period"
                ),

                "booking_status_distribution": (
                    "selected_shop_period"
                    if shop_id else "all_shops_period"
                ),

                "popular_services": (
                    "selected_shop_period"
                    if shop_id else "all_shops_period"
                ),

                "shop_performance": (
                    "selected_shop_period"
                    if shop_id else "all_shops_period"
                ),
            },

            "notes": {
                "booking_dates": (
                    "Scheduled booking date is used for "
                    "booking totals and statuses."
                ),

                "created_bookings": (
                    "Created bookings use created_at in UTC."
                ),

                "completed_service_value": (
                    "Sum of listed service_price for completed "
                    "bookings; NOT confirmed payments or revenue."
                ),

                "shop_scoping": (
                    "Customer profiles and face scans are "
                    "platform-wide; no verified shop linkage exists."
                ),

                "pending_review": (
                    "Includes needs_correction; do not add "
                    "info_requested to pending_review."
                ),
            },

            "unavailable_metrics": ["revenue"],
        }

    except SQLAlchemyError as exc:
        logger.exception("Unable to retrieve visualization data")
        raise HTTPException(
            status_code=503,
            detail="Visualization data is temporarily unavailable.",
        ) from exc
