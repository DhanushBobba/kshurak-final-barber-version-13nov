
"""
KSHURAK Admin Dashboard API.

Features:
- Registered Users
- Customer Profiles
- Child Profiles
- Face Scans
- Face Metrics
- Total Barber Applications
- Pending Barber Approvals
- Approved Barbers
- Rejected Barbers
- Activated Barber Accounts
- Barbers Awaiting Email Activation
- Registered Shops

Authentication:
- ADMIN
- SUPER_ADMIN

Database:
- Supabase PostgreSQL

Barber Data Source:
- public.barber_accounts

Important:
Registered Shops currently represents approved Barber
registrations that contain a valid shop address.

It does not necessarily represent unique physical shops.

All endpoints are read-only.
"""

import logging

from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
)

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.admin.services.auth_service import (
    verify_admin_token,
)

from app.core.database import (
    AsyncSessionLocal,
)


logger = logging.getLogger(
    "kshurak.admin.dashboard"
)


# ============================================================
# ROUTER CONFIGURATION
# ============================================================

router = APIRouter(
    prefix="/api/v1/admin/dashboard",
    tags=["Admin Dashboard"],
)

AdminUser = Annotated[
    dict,
    Depends(verify_admin_token),
]


# ============================================================
# ADMIN DASHBOARD SUMMARY
# ============================================================

@router.get("/summary")
async def get_dashboard_summary(
    admin: AdminUser,
):
    """
    Retrieve actual dashboard statistics
    from the KSHURAK Supabase PostgreSQL database.

    Shop counts use the same conditions as
    the Admin Shop Registry API.
    """

    query = text("""
        SELECT

            -- =========================================
            -- REGISTERED USERS
            -- =========================================

            (
                SELECT COUNT(*)
                FROM auth.users
            ) AS registered_users,


            -- =========================================
            -- CUSTOMER PROFILES
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.profiles
            ) AS customer_profiles,


            -- =========================================
            -- CHILD PROFILES
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.child_profiles
            ) AS child_profiles,


            -- =========================================
            -- FACE SCANS
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.face_scans
            ) AS face_scans,


            -- =========================================
            -- FACE METRICS
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.face_metrics
            ) AS face_metrics,


            -- =========================================
            -- TOTAL BARBER APPLICATIONS
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.barber_accounts
            ) AS barber_applications,


            -- =========================================
            -- PENDING BARBER APPROVALS
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.barber_accounts
                WHERE approval_status = 'pending'
            ) AS pending_approvals,


            -- =========================================
            -- APPROVED BARBER ACCOUNTS
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.barber_accounts
                WHERE approval_status = 'approved'
            ) AS approved_barbers,


            -- =========================================
            -- REJECTED BARBER ACCOUNTS
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.barber_accounts
                WHERE approval_status = 'rejected'
            ) AS rejected_barbers,


            -- =========================================
            -- APPROVED + EMAIL ACTIVATED
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.barber_accounts
                WHERE approval_status = 'approved'
                  AND is_email_activated = TRUE
            ) AS activated_barbers,


            -- =========================================
            -- APPROVED + AWAITING EMAIL ACTIVATION
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.barber_accounts
                WHERE approval_status = 'approved'
                  AND is_email_activated = FALSE
            ) AS awaiting_email_activation,


            -- =========================================
            -- REGISTERED SHOPS
            --
            -- Matches Shop Registry listing conditions.
            --
            -- One approved Barber registration with
            -- a nonempty shop address counts as
            -- one registry entry.
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.barber_accounts
                WHERE approval_status = 'approved'
                  AND shop_address IS NOT NULL
                  AND BTRIM(shop_address) <> ''
            ) AS registered_shops,

            -- =========================================
            -- TOTAL BOOKINGS (POSTGRESQL)
            -- Includes all booking statuses.
            -- =========================================

            (
                SELECT COUNT(*)
                FROM public.barber_bookings
            ) AS total_bookings
    """)

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(query)

            row = result.mappings().one()

            return {
                # =====================================
                # CUSTOMER STATISTICS
                # =====================================

                "registered_users": (
                    row["registered_users"]
                ),

                "customer_profiles": (
                    row["customer_profiles"]
                ),

                "child_profiles": (
                    row["child_profiles"]
                ),

                "face_scans": (
                    row["face_scans"]
                ),

                "face_metrics": (
                    row["face_metrics"]
                ),

                # =====================================
                # BARBER STATISTICS
                # =====================================

                "barber_applications": (
                    row["barber_applications"]
                ),

                "pending_approvals": (
                    row["pending_approvals"]
                ),

                "approved_barbers": (
                    row["approved_barbers"]
                ),

                "rejected_barbers": (
                    row["rejected_barbers"]
                ),

                "activated_barbers": (
                    row["activated_barbers"]
                ),

                "awaiting_email_activation": (
                    row["awaiting_email_activation"]
                ),

                # =====================================
                # SHOP REGISTRY
                # =====================================

                "registered_shops": (
                    row["registered_shops"]
                ),

                # =====================================
                # MODULES NOT YET INTEGRATED
                # =====================================

                "total_bookings": row["total_bookings"],
            }

    except SQLAlchemyError as exc:
        logger.exception(
            "Unable to retrieve Admin Dashboard statistics"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Dashboard statistics temporarily unavailable."
            ),
        ) from exc
