
"""
KSHURAK Admin - Shop Registry API

Endpoints:
GET /api/v1/admin/shops
GET /api/v1/admin/shops/summary
GET /api/v1/admin/shops/{barber_id}

Features:
- Approved Barber shop listing
- Search and pagination
- Shop Registry summary
- Original Barber registration
- Latest shop setup information
- Registered media metadata
- Account approval and activation details

Authentication:
Existing Admin JWT authentication.

Security:
Read-only APIs.
Never return password hashes, token hashes,
SMTP credentials, or raw media file data.
"""

import logging

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
from app.admin.services.barber_media_service import (
    prepare_registration_media,
)


logger = logging.getLogger(
    "kshurak.admin.shop_registry"
)

router = APIRouter(
    prefix="/api/v1/admin/shops",
    tags=["Admin Shop Registry"],
)

AdminUser = Annotated[
    dict,
    Depends(verify_admin_token),
]


# ============================================================
# 1. SHOP REGISTRY LIST
# ============================================================

@router.get("")
async def get_registered_shops(
    admin: AdminUser,

    search: str = Query(
        default="",
        max_length=150,
    ),

    page: int = Query(
        default=1,
        ge=1,
    ),

    page_size: int = Query(
        default=10,
        ge=1,
        le=100,
    ),
):
    """
    List approved Barber accounts that have
    a registered shop address.

    Includes:
    - Shop name
    - Shop phone
    - Shop address
    - Barber details
    - Approval and activation status

    Each account does not necessarily represent
    a unique physical shop.
    """

    conditions = [
        "approval_status = 'approved'",
        "shop_address IS NOT NULL",
        "BTRIM(shop_address) <> ''",
    ]

    parameters = {}

    search_value = search.strip()

    if search_value:

        conditions.append("""
            (
                username ILIKE :search
                OR email ILIKE :search
                OR shop_name ILIKE :search
                OR shop_phone ILIKE :search
                OR shop_address ILIKE :search
            )
        """)

        parameters["search"] = (
            f"%{search_value}%"
        )

    where_clause = (
        "WHERE " + " AND ".join(conditions)
    )

    count_query = text(f"""
        SELECT COUNT(*)

        FROM public.barber_accounts

        {where_clause}
    """)

    shops_query = text(f"""
        SELECT
            id,
            username,
            email,
            shop_name,
            shop_phone,
            shop_address,
            years_experience,
            approval_status,
            is_email_activated,
            approved_at,
            created_at,
            updated_at

        FROM public.barber_accounts

        {where_clause}

        ORDER BY
            approved_at DESC NULLS LAST,
            id DESC

        LIMIT :limit
        OFFSET :offset
    """)

    try:

        async with AsyncSessionLocal() as session:

            count_result = await session.execute(
                count_query,
                parameters,
            )

            total = count_result.scalar_one()

            result = await session.execute(
                shops_query,
                {
                    **parameters,
                    "limit": page_size,
                    "offset": (page - 1) * page_size,
                },
            )

            shops = [
                dict(row)
                for row in result.mappings().all()
            ]

            return {
                "items": shops,
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": (
                    total + page_size - 1
                ) // page_size,
            }

    except SQLAlchemyError as exc:

        logger.exception(
            "Unable to retrieve Shop Registry"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Shop Registry temporarily unavailable."
            ),
        ) from exc


# ============================================================
# 2. SHOP REGISTRY SUMMARY
# ============================================================

@router.get("/summary")
async def get_shop_registry_summary(
    admin: AdminUser,
):
    """
    Return counts for approved shop registrations.
    """

    query = text("""
        SELECT

            COUNT(*) AS registered_shops,

            COUNT(*) FILTER (
                WHERE is_email_activated = TRUE
            ) AS activated_accounts,

            COUNT(*) FILTER (
                WHERE is_email_activated = FALSE
            ) AS awaiting_activation

        FROM public.barber_accounts

        WHERE approval_status = 'approved'
          AND shop_address IS NOT NULL
          AND BTRIM(shop_address) <> ''
    """)

    try:

        async with AsyncSessionLocal() as session:

            result = await session.execute(query)

            row = result.mappings().one()

            return dict(row)

    except SQLAlchemyError as exc:

        logger.exception(
            "Unable to retrieve Shop Registry summary"
        )

        raise HTTPException(
            status_code=503,
            detail="Shop statistics unavailable.",
        ) from exc


# ============================================================
# 3. COMPLETE SHOP REVIEW DETAILS
# ============================================================

@router.get("/{barber_id}")
async def get_shop_details(
    barber_id: UUID,
    admin: AdminUser,
):
    """
    Return complete available information for
    one approved Barber account.

    Original registration:
        barber_accounts

    Subsequent shop setup:
        barber_applications

    Additional media metadata:
        barber_media

    Missing shop setup or media records
    are handled safely.
    """

    # ========================================================
    # ORIGINAL BARBER REGISTRATION
    # ========================================================

    account_query = text("""
        SELECT

            id,
            username,
            email,
            years_experience,

            shop_name,
            shop_phone,
            shop_address,
            shop_image_path,
            document_paths,

            approval_status,
            is_email_activated,

            approved_at,
            rejected_at,
            rejection_reason,

            created_at,
            updated_at

        FROM public.barber_accounts

        WHERE id = :barber_id
          AND approval_status = 'approved'
          AND shop_address IS NOT NULL
          AND BTRIM(shop_address) <> ''

        LIMIT 1
    """)

    # ========================================================
    # LATEST SHOP SETUP
    # ========================================================

    setup_query = text("""
        SELECT

            id,
            barber_account_id,

            full_name,
            email,
            phone,
            experience_years,

            shop_name,
            shop_phone,
            address,
            city,
            state,
            pincode,

            latitude,
            longitude,
            google_place_id,
            location_verified,

            chair_count,
            barber_count,

            opening_time,
            closing_time,
            working_days,

            document_paths,
            setup_data,
            completed_sections,

            status,
            rejection_reason,
            reviewed_by,
            reviewed_at,

            setup_submission_status,
            submitted_at,
            published_at,

            created_at,
            updated_at

        FROM public.barber_applications

        WHERE barber_account_id = :barber_id

        ORDER BY
            updated_at DESC NULLS LAST,
            created_at DESC,
            id DESC

        LIMIT 1
    """)

    # ========================================================
    # STORED MEDIA METADATA
    # ========================================================

    media_query = text("""
        SELECT

            id,
            barber_account_id,

            media_type,
            document_type,
            original_filename,
            content_type,
            file_size,

            created_at,
            updated_at

        FROM public.barber_media

        WHERE barber_account_id = :barber_id

        ORDER BY
            created_at DESC,
            id DESC
    """)

    try:

        async with AsyncSessionLocal() as session:

            parameters = {
                "barber_id": barber_id,
            }

            # ------------------------------------------------
            # 1. FETCH ORIGINAL REGISTRATION
            # ------------------------------------------------

            account_result = await session.execute(
                account_query,
                parameters,
            )

            account_row = (
                account_result.mappings().one_or_none()
            )

            if account_row is None:

                raise HTTPException(
                    status_code=404,
                    detail=(
                        "Approved Barber shop record not found."
                    ),
                )

            original_registration = dict(
                account_row
            )

            # ------------------------------------------------
            # 2. FETCH LATEST SHOP SETUP
            # ------------------------------------------------

            setup_result = await session.execute(
                setup_query,
                parameters,
            )

            setup_row = (
                setup_result.mappings().one_or_none()
            )

            shop_setup = (
                dict(setup_row)
                if setup_row is not None
                else None
            )

            # ------------------------------------------------
            # 3. FETCH MEDIA METADATA
            # ------------------------------------------------

            media_result = await session.execute(
                media_query,
                parameters,
            )

            media = [
                dict(row)
                for row in media_result.mappings().all()
            ]

            # ------------------------------------------------
            # 4. RETURN COMPLETE DETAILS
            # ------------------------------------------------

            signed_media = await prepare_registration_media(
                barber_id=barber_id,
                shop_image_path=original_registration.get(
                    "shop_image_path"
                ),
                document_paths=original_registration.get(
                    "document_paths"
                ),
            )

            return {

                # Compatibility with existing Shop Registry UI
                "shop": original_registration,

                # Original data received during registration
                "original_registration": original_registration,

                # Latest linked shop application
                "shop_setup": shop_setup,

                # Metadata for stored media
                "media": media,

                # Availability indicators
                "has_shop_setup": (
                    shop_setup is not None
                ),

                "media_count": len(media),

                # Registered image/document references
                "shop_image_path": (
                    original_registration.get(
                        "shop_image_path"
                    )
                ),
                                "shop_image_url": signed_media[
                    "shop_image_url"
                ],

                "signed_documents": signed_media[
                    "signed_documents"
                ],

                "signed_url_expires_in": signed_media[
                    "signed_url_expires_in"
                ],

                "registration_documents": (
                    original_registration.get(
                        "document_paths"
                    ) or []
                ),

                "shop_setup_documents": (
                    shop_setup.get("document_paths")
                    if shop_setup is not None
                    else []
                ),
            }

    except HTTPException:
        raise

    except SQLAlchemyError as exc:

        logger.exception(
            "Unable to retrieve complete Shop Details: %s",
            barber_id,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Unable to retrieve complete Shop Details."
            ),
        ) from exc
