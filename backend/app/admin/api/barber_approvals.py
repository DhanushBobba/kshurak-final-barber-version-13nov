"""KSHURAK Admin Barber Applications API."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.admin.services.auth_service import verify_admin_token
from app.core.database import AsyncSessionLocal
from app.admin.services.barber_media_service import prepare_registration_media
from app.services.barber_token_service import create_barber_token
from app.services.barber_email_service import (
    send_barber_activation_email,
    send_barber_rejection_email,
    send_barber_correction_request_email,
)

logger = logging.getLogger("kshurak.admin.barber_approvals")
router = APIRouter(
    prefix="/api/v1/admin/barber-applications",
    tags=["Admin Barber Applications"],
)
AdminUser = Annotated[dict, Depends(verify_admin_token)]
ApplicationStatus = Literal["pending", "approved", "rejected", "needs_correction"]
ACTIVATION_EXPIRY_MINUTES = 1440
ACTIVATION_RESEND_COOLDOWN_SECONDS = 60
CORRECTION_TOKEN_EXPIRY_MINUTES = 24 * 60


class BarberRejectionRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)


class BarberCorrectionRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def get_existing_application_status(session, barber_id: UUID):
    result = await session.execute(
        text("""
            SELECT approval_status
            FROM public.barber_accounts
            WHERE id = :barber_id
            LIMIT 1
        """),
        {"barber_id": barber_id},
    )
    return result.scalar_one_or_none()


async def ensure_application_is_pending(session, barber_id: UUID):
    """
    Raise 404 when the Barber does not exist,
    otherwise raise 409 when already processed.
    """

    status = await get_existing_application_status(
        session,
        barber_id,
    )

    if status is None:
        raise HTTPException(
            status_code=404,
            detail="Barber application not found.",
        )

    raise HTTPException(
        status_code=409,
        detail=(
            "This Barber application has already "
            f"been processed. Current status: {status}."
        ),
    )


# ============================================================
# 1. BARBER APPLICATION SUMMARY
# ============================================================

@router.get("/summary")
async def get_barber_application_summary(
    admin: AdminUser,
):
    query = text("""
        SELECT
            COUNT(*) AS total,

            COUNT(*) FILTER (
                WHERE approval_status IN ('pending', 'needs_correction')
            ) AS pending,

            COUNT(*) FILTER (
                WHERE approval_status = 'approved'
            ) AS approved,

            COUNT(*) FILTER (
                WHERE approval_status = 'rejected'
            ) AS rejected,

            COUNT(*) FILTER (
                WHERE approval_status = 'needs_correction'
            ) AS needs_correction

        FROM public.barber_accounts
    """)

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(query)
            row = result.mappings().one()

            return {
                "total": row["total"],
                "pending": row["pending"],
                "approved": row["approved"],
                "rejected": row["rejected"],
                "needs_correction": row["needs_correction"],
            }

    except SQLAlchemyError as exc:
        logger.exception(
            "Unable to fetch Barber application summary"
        )

        raise HTTPException(
            status_code=503,
            detail="Barber application statistics unavailable.",
        ) from exc


# ============================================================
# 2. GET BARBER APPLICATIONS LIST
# ============================================================

@router.get("")
async def get_barber_applications(
    admin: AdminUser,
    approval_status: ApplicationStatus | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(
        default=10,
        ge=1,
        le=100,
    ),
):
    """
    Fetch paginated Barber applications.
    Supports filtering by approval status.
    """

    # Pending is a UI review queue, not just a single database status.
    # Keep the original needs_correction value in each returned item so the
    # frontend can show an accurate badge and correction history.
    if approval_status == "pending":
        where_clause = (
            "WHERE approval_status IN ('pending', 'needs_correction')"
        )
    elif approval_status is not None:
        where_clause = "WHERE approval_status = :approval_status"
    else:
        where_clause = ""

    count_query = text(f"""
        SELECT COUNT(*)
        FROM public.barber_accounts
        {where_clause}
    """)

    applications_query = text(f"""
        SELECT
            id,
            username,
            email,
            shop_name,
            shop_phone,
            shop_address,
            shop_image_path,
            years_experience,
            approval_status,
            is_email_activated,
            approved_at,
            rejected_at,
            rejection_reason,
            correction_reason,
            correction_requested_at,
            correction_requested_by,
            correction_resubmitted_at,
            created_at,
            updated_at

        FROM public.barber_accounts

        {where_clause}

        ORDER BY created_at DESC, id DESC

        LIMIT :limit
        OFFSET :offset
    """)

    parameters = {}

    if approval_status is not None and approval_status != "pending":
        parameters["approval_status"] = approval_status

    try:
        async with AsyncSessionLocal() as session:

            count_result = await session.execute(
                count_query,
                parameters,
            )

            total = count_result.scalar_one()

            result = await session.execute(
                applications_query,
                {
                    **parameters,
                    "limit": page_size,
                    "offset": (page - 1) * page_size,
                },
            )

            applications = [
                dict(row)
                for row in result.mappings().all()
            ]

            return {
                "items": applications,
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": (
                    total + page_size - 1
                ) // page_size,
            }

    except SQLAlchemyError as exc:
        logger.exception(
            "Unable to fetch Barber application list"
        )

        raise HTTPException(
            status_code=503,
            detail="Barber applications unavailable.",
        ) from exc


# ============================================================
# 3. GET COMPLETE BARBER DETAILS
# ============================================================

@router.get("/{barber_id}")
async def get_barber_application_details(
    barber_id: UUID,
    admin: AdminUser,
):
    """
    Fetch all available Barber details for Admin UI.

    Tables:
    1. barber_accounts
    2. barber_applications
    3. barber_media

    Returns media metadata, never file_data bytes.
    """

    # --------------------------------------------------------
    # BARBER ACCOUNT QUERY
    # --------------------------------------------------------

    account_query = text("""
        SELECT
            id,
            username,
            email,
            shop_name,
            shop_phone,
            shop_address,
            shop_image_path,
            document_paths,
            years_experience,
            approval_status,
            is_email_activated,
            approved_at,
            rejected_at,
            rejection_reason,
            correction_reason,
            correction_requested_at,
            correction_requested_by,
            correction_resubmitted_at,
            created_at,
            updated_at

        FROM public.barber_accounts

        WHERE id = :barber_id
        LIMIT 1
    """)

    # --------------------------------------------------------
    # SHOP SETUP QUERY
    # --------------------------------------------------------

    application_query = text("""
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
            chair_count,
            barber_count,
            opening_time,
            closing_time,
            working_days,
            document_paths,
            status,
            rejection_reason,
            correction_reason,
            correction_requested_at,
            correction_requested_by,
            correction_resubmitted_at,
            reviewed_by,
            reviewed_at,
            setup_data,
            completed_sections,
            google_place_id,
            location_verified,
            setup_submission_status,
            submitted_at,
            published_at,
            created_at,
            updated_at

        FROM public.barber_applications

        WHERE barber_account_id = :barber_id

        ORDER BY
            updated_at DESC NULLS LAST,
            created_at DESC NULLS LAST,
            id DESC

        LIMIT 1
    """)

    # --------------------------------------------------------
    # MEDIA METADATA QUERY
    # --------------------------------------------------------

    media_query = text("""
        SELECT
            id,
            media_type,
            document_type,
            original_filename,
            content_type,
            file_size,
            created_at,
            updated_at

        FROM public.barber_media

        WHERE barber_account_id = :barber_id

        ORDER BY created_at DESC, id DESC
    """)

    try:
        async with AsyncSessionLocal() as session:

            parameters = {
                "barber_id": barber_id,
            }

            # ------------------------------------------------
            # FETCH BARBER ACCOUNT
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
                    detail="Barber account not found.",
                )

            account = dict(account_row)

            # ------------------------------------------------
            # FETCH SHOP SETUP
            # ------------------------------------------------

            application_result = await session.execute(
                application_query,
                parameters,
            )

            application_row = (
                application_result.mappings().one_or_none()
            )

            application = (
                dict(application_row)
                if application_row is not None
                else None
            )

            # ------------------------------------------------
            # FETCH MEDIA METADATA
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
            # BUILD SHOP SETUP OBJECT
            # ------------------------------------------------

            shop_setup = None

            if application is not None:

                shop_setup = {
                    "application_id": application["id"],
                    "full_name": application["full_name"],
                    "email": application["email"],
                    "phone": application["phone"],

                    "shop_name": application["shop_name"],
                    "shop_phone": application["shop_phone"],

                    "address": application["address"],
                    "city": application["city"],
                    "state": application["state"],
                    "pincode": application["pincode"],

                    "latitude": application["latitude"],
                    "longitude": application["longitude"],

                    "chair_count": application["chair_count"],
                    "barber_count": application["barber_count"],

                    "opening_time": application["opening_time"],
                    "closing_time": application["closing_time"],

                    "working_days": application["working_days"],

                    "location_verified": application[
                        "location_verified"
                    ],

                    "google_place_id": application[
                        "google_place_id"
                    ],

                    "setup_data": application["setup_data"],

                    "completed_sections": (
                        application["completed_sections"] or []
                    ),

                    "setup_submission_status": application[
                        "setup_submission_status"
                    ],

                    "submitted_at": application["submitted_at"],
                    "published_at": application["published_at"],

                    "application_status": application["status"],
                    "correction_reason": application["correction_reason"],
                    "correction_requested_at": application["correction_requested_at"],
                    "correction_requested_by": application["correction_requested_by"],
                    "correction_resubmitted_at": application["correction_resubmitted_at"],

                    "reviewed_by": application["reviewed_by"],
                    "reviewed_at": application["reviewed_at"],

                    "document_paths": application[
                        "document_paths"
                    ],

                    "created_at": application["created_at"],
                    "updated_at": application["updated_at"],
                }

            # ------------------------------------------------
            # FINAL RESPONSE
            # ------------------------------------------------

            response = {
                **account,

                "shop_name": (
                    account.get("shop_name")
                    or (
                        application.get("shop_name")
                        if application else None
                    )
                ),

                "shop_phone": (
                    account.get("shop_phone")
                    or (
                        application.get("shop_phone")
                        if application else None
                    )
                ),

                "shop_address": (
                    account.get("shop_address")
                    or (
                        application.get("address")
                        if application else None
                    )
                ),

                "shop_setup": shop_setup,

                "shop_image_path": account.get(
                    "shop_image_path"
                ),

                "document_paths": (
                    account.get("document_paths")
                    or (
                        application.get("document_paths")
                        if application else None
                    )
                    or []
                ),

                "media": media,
                "media_count": len(media),

                "has_shop_setup": application is not None,
            }

                        # Generate temporary URLs for the original
            # registration image and verification documents.
            # The endpoint is already protected by Admin JWT.

            signed_media = await prepare_registration_media(
                barber_id=barber_id,
                shop_image_path=account.get("shop_image_path"),
                document_paths=account.get("document_paths"),
            )

            response["shop_image_url"] = (
                signed_media["shop_image_url"]
            )

            response["signed_documents"] = (
                signed_media["signed_documents"]
            )

            response["signed_url_expires_in"] = (
                signed_media["signed_url_expires_in"]
            )

            return response

    except HTTPException:
        raise

    except SQLAlchemyError as exc:
        logger.exception(
            "Database error fetching Barber details: %s",
            barber_id,
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve complete Barber details.",
        ) from exc


# ============================================================
# 4. REQUEST ADDITIONAL INFORMATION
# ============================================================

@router.post("/{barber_id}/request-correction")
async def request_barber_correction(
    barber_id: UUID,
    payload: BarberCorrectionRequest,
    admin: AdminUser,
):
    """Request additional registration information from a pending Barber.

    Registration lives in barber_accounts, even if the Barber has not yet
    started the independent shop-setup workflow in barber_applications.
    If a pending shop application exists, keep its correction metadata in
    sync without creating an incomplete application record.
    """
    reason = payload.reason.strip()
    if not 5 <= len(reason) <= 1000:
        raise HTTPException(
            status_code=422,
            detail="Correction reason must contain 5 to 1000 characters.",
        )

    now = utc_now()
    admin_id = UUID(admin["id"])
    shop_application_id = None
    shop_application_status = None
    correction_token = None

    try:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                # Lock the registration row to prevent simultaneous decisions.
                account_result = await session.execute(
                    text("""
                        SELECT id, username, email, approval_status
                        FROM public.barber_accounts
                        WHERE id = :barber_id
                        FOR UPDATE
                    """),
                    {"barber_id": barber_id},
                )
                account = account_result.mappings().one_or_none()
                if account is None:
                    raise HTTPException(
                        status_code=404,
                        detail="Barber account not found.",
                    )
                if account["approval_status"] != "pending":
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Only pending Barber registrations can be sent "
                            "for correction. Current status: "
                            f"{account['approval_status']}."
                        ),
                    )

                # The account is authoritative for initial registration.
                await session.execute(
                    text("""
                        UPDATE public.barber_accounts
                        SET approval_status = 'needs_correction',
                            correction_reason = :reason,
                            correction_requested_at = :now,
                            correction_requested_by = :admin_id,
                            correction_resubmitted_at = NULL,
                            updated_at = :now
                        WHERE id = :barber_id
                          AND approval_status = 'pending'
                    """),
                    {
                        "barber_id": barber_id,
                        "reason": reason,
                        "now": now,
                        "admin_id": admin_id,
                    },
                )

                # Create the restricted correction token in the same transaction.
                # A failed database transaction cannot leave an emailed token valid.
                correction_token = await create_barber_token(
                    db=session,
                    barber_id=barber_id,
                    token_type="registration_correction",
                    expiry_minutes=CORRECTION_TOKEN_EXPIRY_MINUTES,
                )

                # Shop setup is optional at this point. Do not fabricate it.
                application_result = await session.execute(
                    text("""
                        SELECT id, status
                        FROM public.barber_applications
                        WHERE barber_account_id = :barber_id
                        ORDER BY updated_at DESC NULLS LAST,
                                 created_at DESC NULLS LAST, id DESC
                        LIMIT 1
                        FOR UPDATE
                    """),
                    {"barber_id": barber_id},
                )
                application = application_result.mappings().one_or_none()
                if application is not None:
                    shop_application_id = str(application["id"])
                    shop_application_status = application["status"]
                    if application["status"] == "PENDING":
                        await session.execute(
                            text("""
                                UPDATE public.barber_applications
                                SET status = 'NEEDS_CORRECTION',
                                    correction_reason = :reason,
                                    correction_requested_at = :now,
                                    correction_requested_by = :admin_id,
                                    correction_resubmitted_at = NULL,
                                    updated_at = :now
                                WHERE id = :application_id
                                  AND status = 'PENDING'
                            """),
                            {
                                "application_id": application["id"],
                                "reason": reason,
                                "now": now,
                                "admin_id": admin_id,
                            },
                        )
                        shop_application_status = "NEEDS_CORRECTION"

    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        logger.exception("Error requesting correction for Barber %s", barber_id)
        raise HTTPException(
            status_code=503,
            detail="Unable to request Barber registration correction.",
        ) from exc

    # SMTP is intentionally invoked only after the database transaction commits.
    # A delivery failure must not roll back a recorded correction request.
    correction_email_sent = False
    try:
        await send_barber_correction_request_email(
            to_email=account["email"],
            username=account["username"],
            correction_reason=reason,
            raw_token=correction_token,
            expiry_minutes=CORRECTION_TOKEN_EXPIRY_MINUTES,
        )
        correction_email_sent = True
    except Exception:
        logger.exception(
            "Correction request was saved, but email failed for Barber %s",
            barber_id,
        )

    return {
        "message": (
            "Additional information requested and email submitted successfully."
            if correction_email_sent
            else "Additional information requested successfully, but the notification email could not be submitted."
        ),
        "correction_email_sent": correction_email_sent,
        "correction_token_expires_in_minutes": CORRECTION_TOKEN_EXPIRY_MINUTES,
        "barber_id": str(barber_id),
        "application_id": shop_application_id,
        "approval_status": "needs_correction",
        "application_status": shop_application_status,
        "correction_reason": reason,
        "correction_requested_at": now,
        "correction_requested_by": str(admin_id),
    }


# ============================================================
# RESEND CORRECTION ACCESS LINK (ADMIN ONLY)
# ============================================================

@router.post("/{barber_id}/resend-correction-link")
async def resend_barber_correction_link(barber_id: UUID, admin: AdminUser):
    """Issue a new limited correction link without changing review status.

    Only the Admin can invoke this. The earlier unused correction token is
    invalidated; the correction reason and original request date remain intact.
    """
    try:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                result = await session.execute(
                    text("""
                        SELECT id, username, email, approval_status,
                               correction_reason, correction_requested_at
                        FROM public.barber_accounts
                        WHERE id = :barber_id
                        FOR UPDATE
                    """),
                    {"barber_id": barber_id},
                )
                account = result.mappings().one_or_none()
                if account is None:
                    raise HTTPException(404, "Barber account not found.")
                if account["approval_status"] != "needs_correction":
                    raise HTTPException(
                        409,
                        "A correction link can only be resent while the barber is awaiting corrections.",
                    )
                reason = (account["correction_reason"] or "").strip()
                if not reason:
                    raise HTTPException(409, "No correction request reason is recorded.")
                raw_token = await create_barber_token(
                    db=session,
                    barber_id=barber_id,
                    token_type="registration_correction",
                    expiry_minutes=CORRECTION_TOKEN_EXPIRY_MINUTES,
                )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        logger.exception("Unable to issue correction link for %s", barber_id)
        raise HTTPException(503, "Unable to issue correction link.") from exc

    email_sent = False
    try:
        await send_barber_correction_request_email(
            to_email=account["email"],
            username=account["username"],
            correction_reason=reason,
            raw_token=raw_token,
            expiry_minutes=CORRECTION_TOKEN_EXPIRY_MINUTES,
        )
        email_sent = True
    except Exception:
        logger.exception("Correction link email failed for %s", barber_id)

    return {
        "message": (
            "Correction link submitted to email provider."
            if email_sent
            else "A new correction link was created, but email delivery failed."
        ),
        "barber_id": str(barber_id),
        "approval_status": "needs_correction",
        "correction_email_sent": email_sent,
        "correction_token_expires_in_minutes": CORRECTION_TOKEN_EXPIRY_MINUTES,
    }


# ============================================================
# 4. APPROVE BARBER APPLICATION
# ============================================================

@router.post("/{barber_id}/approve")
async def approve_barber_application(
    barber_id: UUID,
    admin: AdminUser,
):
    """
    Approve a pending Barber application.

    Approval and token creation use one transaction.
    SMTP notification is sent after commit.
    """

    now = utc_now()

    query = text("""
        UPDATE public.barber_accounts

        SET
            approval_status = 'approved',
            approved_at = :approved_at,
            rejected_at = NULL,
            rejection_reason = NULL,
            updated_at = :updated_at

        WHERE id = :barber_id
          AND approval_status = 'pending'

        RETURNING
            id,
            username,
            email,
            approval_status,
            is_email_activated,
            approved_at
    """)

    raw_token = None

    try:
        async with AsyncSessionLocal() as session:
            async with session.begin():

                result = await session.execute(
                    query,
                    {
                        "barber_id": barber_id,
                        "approved_at": now,
                        "updated_at": now,
                    },
                )

                row = result.mappings().one_or_none()

                if row is None:
                    await ensure_application_is_pending(
                        session,
                        barber_id,
                    )

                    raise HTTPException(
                        status_code=409,
                        detail="Barber application is no longer pending.",
                    )

                application = dict(row)

                if not application["is_email_activated"]:

                    raw_token = await create_barber_token(
                        db=session,
                        barber_id=application["id"],
                        token_type="email_activation",
                        expiry_minutes=ACTIVATION_EXPIRY_MINUTES,
                    )

    except HTTPException:
        raise

    except SQLAlchemyError as exc:
        logger.exception(
            "Database error approving Barber %s",
            barber_id,
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to approve Barber application.",
        ) from exc

    # --------------------------------------------------------
    # EMAIL AFTER DATABASE COMMIT
    # --------------------------------------------------------

    activation_email_sent = False

    if raw_token is not None:

        try:
            await send_barber_activation_email(
                to_email=application["email"],
                username=application["username"],
                raw_token=raw_token,
            )

            activation_email_sent = True

            logger.info(
                "Activation email accepted by SMTP for %s",
                barber_id,
            )

        except Exception:
            logger.exception(
                "Activation email failed for %s",
                barber_id,
            )

    if activation_email_sent:
        message = (
            "Barber application approved successfully. "
            "Activation email submitted successfully."
        )

    elif raw_token is not None:
        message = (
            "Barber application approved successfully, "
            "but the activation email could not be submitted."
        )

    else:
        message = (
            "Barber application approved successfully. "
            "Email activation was already completed."
        )

    return {
        "message": message,
        "application": application,

        "email_activation_required": (
            not application["is_email_activated"]
        ),

        "activation_email_sent": activation_email_sent,

        "activation_email_expires_in_minutes": (
            ACTIVATION_EXPIRY_MINUTES
            if raw_token is not None
            else None
        ),
    }


# ============================================================
# 5. REJECT BARBER APPLICATION
# ============================================================

@router.post("/{barber_id}/reject")
async def reject_barber_application(
    barber_id: UUID,
    payload: BarberRejectionRequest,
    admin: AdminUser,
):
    """
    Reject a pending Barber application.

    Database status is committed first.
    Rejection email is submitted afterwards.
    """

    reason = payload.reason.strip()

    if len(reason) < 5:
        raise HTTPException(
            status_code=422,
            detail=(
                "Rejection reason must contain "
                "at least 5 characters."
            ),
        )

    now = utc_now()

    query = text("""
        UPDATE public.barber_accounts

        SET
            approval_status = 'rejected',
            rejected_at = :rejected_at,
            rejection_reason = :reason,
            approved_at = NULL,
            updated_at = :updated_at

        WHERE id = :barber_id
          AND approval_status = 'pending'

        RETURNING
            id,
            username,
            email,
            approval_status,
            rejected_at,
            rejection_reason
    """)

    try:
        async with AsyncSessionLocal() as session:
            async with session.begin():

                result = await session.execute(
                    query,
                    {
                        "barber_id": barber_id,
                        "reason": reason,
                        "rejected_at": now,
                        "updated_at": now,
                    },
                )

                row = result.mappings().one_or_none()

                if row is None:
                    await ensure_application_is_pending(
                        session,
                        barber_id,
                    )

                    raise HTTPException(
                        status_code=409,
                        detail="Barber application is no longer pending.",
                    )

                application = dict(row)

    except HTTPException:
        raise

    except SQLAlchemyError as exc:
        logger.exception(
            "Database error rejecting Barber %s",
            barber_id,
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to reject Barber application.",
        ) from exc

    # --------------------------------------------------------
    # SEND REJECTION EMAIL AFTER COMMIT
    # --------------------------------------------------------

    rejection_email_sent = False

    try:
        await send_barber_rejection_email(
            to_email=application["email"],
            username=application["username"],
            rejection_reason=reason,
        )

        rejection_email_sent = True

        logger.info(
            "Rejection email accepted by SMTP for %s",
            barber_id,
        )

    except Exception:
        logger.exception(
            "Rejection email failed for %s",
            barber_id,
        )

    return {
        "message": (
            "Barber application rejected successfully. "
            + (
                "Rejection email submitted successfully."
                if rejection_email_sent
                else "Rejection email could not be submitted."
            )
        ),

        "application": application,
        "rejection_email_sent": rejection_email_sent,
    }


# ============================================================
# 6. RESEND ACTIVATION EMAIL
# ============================================================

@router.post("/{barber_id}/resend-activation")
async def resend_barber_activation(
    barber_id: UUID,
    admin: AdminUser,
):
    """
    Resend email activation link.

    Rules:
    - Barber must be approved
    - Barber must not already be activated
    - 60-second token issuance cooldown
    - Account row locked during token issuance
    - SMTP called only after successful commit
    """

    try:
        async with AsyncSessionLocal() as session:
            async with session.begin():

                # --------------------------------------------
                # LOCK BARBER ACCOUNT
                # --------------------------------------------

                result = await session.execute(
                    text("""
                        SELECT
                            id,
                            username,
                            email,
                            approval_status,
                            is_email_activated

                        FROM public.barber_accounts

                        WHERE id = :barber_id
                        FOR UPDATE
                    """),
                    {"barber_id": barber_id},
                )

                barber = result.mappings().one_or_none()

                if barber is None:
                    raise HTTPException(
                        status_code=404,
                        detail="Barber account not found.",
                    )

                if barber["approval_status"] != "approved":
                    raise HTTPException(
                        status_code=403,
                        detail=(
                            "Only approved Barber accounts "
                            "can receive activation emails."
                        ),
                    )

                if barber["is_email_activated"]:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "This Barber account is "
                            "already activated."
                        ),
                    )

                # --------------------------------------------
                # CHECK TOKEN COOLDOWN
                # --------------------------------------------

                cooldown_result = await session.execute(
                    text("""
                        SELECT MAX(created_at)

                        FROM public.barber_auth_tokens

                        WHERE barber_id = :barber_id
                          AND token_type = 'email_activation'
                    """),
                    {"barber_id": barber_id},
                )

                last_issued_at = (
                    cooldown_result.scalar_one_or_none()
                )

                if last_issued_at is not None:

                    if last_issued_at.tzinfo is None:
                        last_issued_at = last_issued_at.replace(
                            tzinfo=timezone.utc
                        )

                    cooldown_until = (
                        last_issued_at
                        + timedelta(
                            seconds=ACTIVATION_RESEND_COOLDOWN_SECONDS
                        )
                    )

                    if utc_now() < cooldown_until:
                        raise HTTPException(
                            status_code=429,
                            detail=(
                                "An activation link was issued "
                                "recently. Please wait at least "
                                "60 seconds before trying again."
                            ),
                        )

                # --------------------------------------------
                # CREATE NEW ACTIVATION TOKEN
                # --------------------------------------------

                raw_token = await create_barber_token(
                    db=session,
                    barber_id=barber_id,
                    token_type="email_activation",
                    expiry_minutes=ACTIVATION_EXPIRY_MINUTES,
                )

                barber_email = barber["email"]
                barber_username = barber["username"]

    except HTTPException:
        raise

    except SQLAlchemyError as exc:
        logger.exception(
            "Database error resending activation for %s",
            barber_id,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Activation email resend service "
                "temporarily unavailable."
            ),
        ) from exc

    # --------------------------------------------------------
    # SEND EMAIL AFTER DATABASE COMMIT
    # --------------------------------------------------------

    try:
        await send_barber_activation_email(
            to_email=barber_email,
            username=barber_username,
            raw_token=raw_token,
        )

        logger.info(
            "Activation email resend accepted by SMTP for %s",
            barber_id,
        )

    except Exception:
        logger.exception(
            "Activation email resend failed for %s",
            barber_id,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Activation email could not be submitted. "
                "The Barber remains approved. "
                "Please retry after the cooldown."
            ),
        ) from None

    return {
        "message": (
            "Activation email submitted successfully."
        ),

        "barber_id": barber_id,
        "activation_email_sent": True,

        "activation_email_expires_in_minutes": (
            ACTIVATION_EXPIRY_MINUTES
        ),
    }
