
"""
KSHURAK - Admin Booking Management API

Read-only Admin APIs:

GET /api/v1/admin/bookings/summary
GET /api/v1/admin/bookings/shops
GET /api/v1/admin/bookings
GET /api/v1/admin/bookings/{booking_id}

Features:
- Overall booking statistics
- Shop-wise booking information
- Booking status filtering
- Shop filtering
- Date range filtering
- Customer, service, shop and booking ID search
- Pagination
- Individual booking details

Database:
- public.barber_bookings
- public.barber_accounts

Security:
- Uses existing Admin JWT authentication
- Does not modify bookings
- Does not expose password hashes
"""

import logging

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
)

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.admin.services.auth_service import (
    verify_admin_token,
)

from app.core.database import AsyncSessionLocal


# ============================================================
# CONFIGURATION
# ============================================================

logger = logging.getLogger(
    "kshurak.admin.bookings"
)

router = APIRouter(
    prefix="/api/v1/admin/bookings",
    tags=["Admin Booking Management"],
)

AdminUser = Annotated[
    dict,
    Depends(verify_admin_token),
]


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def validate_date_range(
    date_from: date | None,
    date_to: date | None,
):
    """
    Prevent invalid date ranges.
    """

    if (
        date_from is not None
        and date_to is not None
        and date_from > date_to
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "From Date cannot be later than To Date."
            ),
        )


def build_booking_filters(
    barber_id: UUID | None = None,
    status: str | None = None,
    search: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    """
    Build parameterized SQL filters.

    Important:
    Only add a SQL condition when its filter
    actually has a value.

    This avoids asyncpg errors caused by:
        :parameter IS NULL
    with untyped NULL parameters.
    """

    conditions = []
    parameters = {}

    # --------------------------------------------------------
    # SHOP FILTER
    # --------------------------------------------------------

    if barber_id is not None:

        conditions.append(
            "b.barber_id = :barber_id"
        )

        parameters["barber_id"] = barber_id

    # --------------------------------------------------------
    # BOOKING STATUS FILTER
    # --------------------------------------------------------

    if status and status.strip():

        normalized_status = (
            status.strip().lower()
        )

        if normalized_status == "confirmed":
            conditions.append(
                "LOWER(b.status) IN ('confirmed', 'accepted')"
            )
        else:
            conditions.append(
                "LOWER(b.status) = :status"
            )

            parameters["status"] = normalized_status

    # --------------------------------------------------------
    # SEARCH FILTER
    # --------------------------------------------------------

    if search and search.strip():

        conditions.append("""
            (
                b.customer_name ILIKE :search
                OR b.customer_phone ILIKE :search
                OR b.service_name ILIKE :search
                OR a.shop_name ILIKE :search
                OR a.username ILIKE :search
                OR CAST(b.id AS TEXT) ILIKE :search
            )
        """)

        parameters["search"] = (
            f"%{search.strip()}%"
        )

    # --------------------------------------------------------
    # FROM DATE
    # --------------------------------------------------------

    if date_from is not None:

        conditions.append(
            "b.booking_date >= :date_from"
        )

        parameters["date_from"] = date_from

    # --------------------------------------------------------
    # TO DATE
    # --------------------------------------------------------

    if date_to is not None:

        conditions.append(
            "b.booking_date <= :date_to"
        )

        parameters["date_to"] = date_to

    # --------------------------------------------------------
    # FINAL SQL WHERE CLAUSE
    # --------------------------------------------------------

    where_clause = (
        "WHERE " + " AND ".join(conditions)
        if conditions
        else ""
    )

    return where_clause, parameters


# ============================================================
# 1. BOOKING SUMMARY
# ============================================================

@router.get("/summary")
async def booking_summary(
    admin: AdminUser,

    barber_id: UUID | None = None,

    date_from: date | None = None,

    date_to: date | None = None,
):
    """
    Return booking statistics.

    Supports:
    - All shops
    - Individual shop
    - Date range

    Confirmed includes accepted bookings.
    """

    validate_date_range(
        date_from,
        date_to,
    )

    where_clause, parameters = (
        build_booking_filters(
            barber_id=barber_id,
            date_from=date_from,
            date_to=date_to,
        )
    )

    query = text(f"""
        SELECT

            COUNT(*) AS total,

            COUNT(*) FILTER (
                WHERE LOWER(b.status) = 'pending'
            ) AS pending,

            COUNT(*) FILTER (
                WHERE LOWER(b.status)
                IN ('confirmed', 'accepted')
            ) AS confirmed,

            COUNT(*) FILTER (
                WHERE LOWER(b.status) = 'completed'
            ) AS completed,

            COUNT(*) FILTER (
                WHERE LOWER(b.status) = 'cancelled'
            ) AS cancelled,

            COUNT(*) FILTER (
                WHERE LOWER(b.status) = 'rejected'
            ) AS rejected,

            COUNT(*) FILTER (
                WHERE b.booking_date = CURRENT_DATE
            ) AS today,

            COUNT(
                DISTINCT b.barber_id
            ) AS shops_with_bookings

        FROM public.barber_bookings b

        LEFT JOIN public.barber_accounts a
            ON a.id = b.barber_id

        {where_clause}
    """)

    try:

        async with AsyncSessionLocal() as session:

            result = await session.execute(
                query,
                parameters,
            )

            row = result.mappings().one()

            return dict(row)

    except SQLAlchemyError as exc:

        logger.exception(
            "Unable to fetch Admin booking summary"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Booking statistics temporarily unavailable."
            ),
        ) from exc


# ============================================================
# 2. SHOP-WISE BOOKING SUMMARY
# ============================================================

@router.get("/shops")
async def shop_booking_summary(
    admin: AdminUser,

    search: str | None = Query(
        default=None,
        max_length=100,
    ),
):
    """
    Return all registered Barber accounts
    with their associated booking counts.

    Shops with zero bookings are included.
    """

    parameters = {}
    where_clause = ""

    # --------------------------------------------------------
    # OPTIONAL SHOP SEARCH
    # --------------------------------------------------------

    if search and search.strip():

        where_clause = """
            WHERE (
                a.shop_name ILIKE :search
                OR a.username ILIKE :search
                OR a.shop_address ILIKE :search
            )
        """

        parameters["search"] = (
            f"%{search.strip()}%"
        )

    # --------------------------------------------------------
    # SHOP QUERY
    # --------------------------------------------------------

    query = text(f"""
        SELECT

            a.id AS barber_id,

            a.username AS barber_username,

            a.shop_name,

            a.shop_phone,

            a.shop_address,

            COUNT(b.id) AS total_bookings,

            COUNT(b.id) FILTER (
                WHERE LOWER(b.status) = 'pending'
            ) AS pending,

            COUNT(b.id) FILTER (
                WHERE LOWER(b.status)
                IN ('confirmed', 'accepted')
            ) AS confirmed,

            COUNT(b.id) FILTER (
                WHERE LOWER(b.status) = 'completed'
            ) AS completed,

            COUNT(b.id) FILTER (
                WHERE LOWER(b.status) = 'cancelled'
            ) AS cancelled,

            COUNT(b.id) FILTER (
                WHERE b.booking_date = CURRENT_DATE
            ) AS today

        FROM public.barber_accounts a

        LEFT JOIN public.barber_bookings b
            ON b.barber_id = a.id

        {where_clause}

        GROUP BY

            a.id,
            a.username,
            a.shop_name,
            a.shop_phone,
            a.shop_address

        ORDER BY

            COALESCE(
                a.shop_name,
                a.username
            ) ASC,

            a.id
    """)

    try:

        async with AsyncSessionLocal() as session:

            result = await session.execute(
                query,
                parameters,
            )

            shops = [
                dict(row)
                for row in result.mappings().all()
            ]

            return {
                "items": shops,
                "total": len(shops),
            }

    except SQLAlchemyError as exc:

        logger.exception(
            "Unable to fetch shop-wise booking summary"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Shop booking information temporarily unavailable."
            ),
        ) from exc


# ============================================================
# 3. ALL BOOKINGS WITH FILTERS
# ============================================================

@router.get("")
async def list_admin_bookings(
    admin: AdminUser,

    barber_id: UUID | None = None,

    status: str | None = Query(
        default=None,
        max_length=40,
    ),

    search: str | None = Query(
        default=None,
        max_length=100,
    ),

    date_from: date | None = None,

    date_to: date | None = None,

    page: int = Query(
        default=1,
        ge=1,
    ),

    page_size: int = Query(
        default=20,
        ge=1,
        le=100,
    ),
):
    """
    Return all booking records.

    Supports:
    - All shops
    - Individual shop
    - Booking status
    - Search
    - Date range
    - Pagination

    Read-only Admin operation.
    """

    validate_date_range(
        date_from,
        date_to,
    )

    # --------------------------------------------------------
    # BUILD FILTERS
    # --------------------------------------------------------

    where_clause, parameters = (
        build_booking_filters(
            barber_id=barber_id,
            status=status,
            search=search,
            date_from=date_from,
            date_to=date_to,
        )
    )

    # --------------------------------------------------------
    # JOIN QUERY
    # --------------------------------------------------------

    join_clause = """
        FROM public.barber_bookings b

        LEFT JOIN public.barber_accounts a
            ON a.id = b.barber_id
    """

    # --------------------------------------------------------
    # TOTAL RECORD COUNT
    # --------------------------------------------------------

    count_query = text(f"""
        SELECT COUNT(*)

        {join_clause}

        {where_clause}
    """)

    # --------------------------------------------------------
    # BOOKING RECORDS
    # --------------------------------------------------------

    bookings_query = text(f"""
        SELECT

            b.id,

            b.barber_id,

            b.worker_id,

            b.customer_id,

            b.customer_name,

            b.customer_phone,

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

            b.updated_at,

            a.shop_name,

            a.username AS barber_username,

            a.shop_address

        {join_clause}

        {where_clause}

        ORDER BY

            b.booking_date DESC,

            b.start_time DESC,

            b.id DESC

        LIMIT :limit

        OFFSET :offset
    """)

    try:

        async with AsyncSessionLocal() as session:

            # ------------------------------------------------
            # FETCH COUNT
            # ------------------------------------------------

            total_result = await session.execute(
                count_query,
                parameters,
            )

            total = total_result.scalar_one()

            # ------------------------------------------------
            # FETCH PAGINATED BOOKINGS
            # ------------------------------------------------

            result = await session.execute(
                bookings_query,
                {
                    **parameters,

                    "limit": page_size,

                    "offset": (
                        (page - 1) * page_size
                    ),
                },
            )

            bookings = [
                dict(row)
                for row in result.mappings().all()
            ]

            # ------------------------------------------------
            # RESPONSE
            # ------------------------------------------------

            return {
                "items": bookings,

                "total": total,

                "page": page,

                "page_size": page_size,

                "total_pages": (
                    total + page_size - 1
                ) // page_size,
            }

    except SQLAlchemyError as exc:

        logger.exception(
            "Unable to fetch Admin booking records"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Booking records temporarily unavailable."
            ),
        ) from exc


# ============================================================
# 4. INDIVIDUAL BOOKING DETAILS
# ============================================================

@router.get("/{booking_id}")
async def admin_booking_details(
    booking_id: UUID,
    admin: AdminUser,
):
    """
    Return complete information for one booking.

    Includes:
    - Customer details
    - Barber account
    - Shop information
    - Service details
    - Appointment date and time
    - Booking status
    - Cancellation information
    """

    query = text("""
        SELECT

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

            b.updated_at,

            a.username AS barber_username,

            a.shop_name,

            a.shop_phone,

            a.shop_address

        FROM public.barber_bookings b

        LEFT JOIN public.barber_accounts a
            ON a.id = b.barber_id

        WHERE b.id = :booking_id

        LIMIT 1
    """)

    try:

        async with AsyncSessionLocal() as session:

            result = await session.execute(
                query,
                {
                    "booking_id": booking_id,
                },
            )

            row = (
                result.mappings().one_or_none()
            )

            if row is None:

                raise HTTPException(
                    status_code=404,
                    detail="Booking not found.",
                )

            return dict(row)

    except HTTPException:
        raise

    except SQLAlchemyError as exc:

        logger.exception(
            "Unable to retrieve booking details: %s",
            booking_id,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Booking details temporarily unavailable."
            ),
        ) from exc
