import logging
import re

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)
from pydantic import (
    BaseModel,
    EmailStr,
    Field,
    field_validator,
)
from pwdlib import PasswordHash
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.barber_account import BarberAccount

from app.services.barber_token_service import (
    consume_barber_token,
    create_barber_token,
)
from app.services.barber_email_service import (
    send_barber_password_reset_email,
)


logger = logging.getLogger("kshurak.barber.auth")

router = APIRouter(
    prefix="/api/v1/barber",
    tags=["Barber Authentication"],
)

password_hasher = PasswordHash.recommended()


# ============================================================
# REQUEST SCHEMAS
# ============================================================

class ActivateAccountRequest(BaseModel):
    token: str = Field(
        min_length=20,
        max_length=512,
    )


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(
        min_length=20,
        max_length=512,
    )

    new_password: str = Field(
        min_length=8,
        max_length=128,
    )

    @field_validator("new_password")
    @classmethod
    def validate_new_password(
        cls,
        value: str,
    ) -> str:
        if not re.search(r"[A-Za-z]", value):
            raise ValueError(
                "Password must contain at least one letter"
            )

        if not re.search(r"\d", value):
            raise ValueError(
                "Password must contain at least one number"
            )

        return value


class AuthMessageResponse(BaseModel):
    message: str


# ============================================================
# 1. ACCOUNT ACTIVATION
# ============================================================

@router.post(
    "/activate",
    response_model=AuthMessageResponse,
)
async def activate_barber_account(
    payload: ActivateAccountRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Activate an existing admin-approved barber.

    Requires a valid, unused email activation token.
    Does not approve pending barber accounts.
    """

    try:
        token_record = await consume_barber_token(
            db=db,
            raw_token=payload.token,
            token_type="email_activation",
        )

        if token_record is None:
            await db.rollback()

            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Activation link is invalid, "
                    "expired, or already used."
                ),
            )

        result = await db.execute(
            select(BarberAccount)
            .where(
                BarberAccount.id
                == token_record.barber_id
            )
            .with_for_update()
        )

        barber = result.scalar_one_or_none()

        if barber is None:
            await db.rollback()

            raise HTTPException(
                status_code=404,
                detail="Barber account not found.",
            )

        if barber.approval_status != "approved":
            await db.rollback()

            raise HTTPException(
                status_code=403,
                detail=(
                    "Admin approval is required "
                    "before account activation."
                ),
            )

        if barber.is_email_activated:
            await db.rollback()

            raise HTTPException(
                status_code=400,
                detail="Account has already been activated.",
            )

        barber.is_email_activated = True

        await db.commit()

        logger.info(
            "Barber account activated successfully: %s",
            barber.id,
        )

        return AuthMessageResponse(
            message=(
                "Your KSHURAK account is activated. "
                "You can now log in."
            ),
        )

    except HTTPException:
        raise

    except SQLAlchemyError:
        await db.rollback()

        logger.exception(
            "Database error during barber activation"
        )

        raise HTTPException(
            status_code=503,
            detail="Activation service temporarily unavailable.",
        )


# ============================================================
# 2. FORGOT PASSWORD
# ============================================================

@router.post(
    "/forgot-password",
    response_model=AuthMessageResponse,
)
async def forgot_barber_password(
    payload: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Request a password-reset email.

    Always returns a generic response so callers
    cannot determine whether an email is registered.
    """

    generic_message = (
        "If an eligible account exists for this email, "
        "a password-reset link will be sent."
    )

    normalized_email = str(payload.email).strip().lower()

    try:
        result = await db.execute(
            select(BarberAccount).where(
                func.lower(BarberAccount.email)
                == normalized_email
            )
        )

        barber = result.scalar_one_or_none()

        if barber is None:
            return AuthMessageResponse(
                message=generic_message
            )

        # Only active, approved accounts are eligible.
        # Pending barbers cannot use password reset
        # to bypass account approval or activation.
        if (
            barber.approval_status != "approved"
            or not barber.is_email_activated
        ):
            return AuthMessageResponse(
                message=generic_message
            )

        raw_token = await create_barber_token(
            db=db,
            barber_id=barber.id,
            token_type="password_reset",
            expiry_minutes=15,
        )

        # Commit before attempting email delivery.
        # Otherwise the emailed token could refer
        # to a transaction that was rolled back.
        await db.commit()

    except SQLAlchemyError:
        await db.rollback()

        logger.exception(
            "Database error during password reset request"
        )

        raise HTTPException(
            status_code=503,
            detail="Password-reset service temporarily unavailable.",
        )

    try:
        await send_barber_password_reset_email(
            to_email=barber.email,
            username=barber.username,
            raw_token=raw_token,
        )

        logger.info(
            "Password-reset email handed to SMTP for barber: %s",
            barber.id,
        )

    except Exception:
        # Do not expose whether an email account exists.
        # The token remains stored until expiry,
        # allowing operational retry workflows later.
        logger.exception(
            "Password-reset email delivery failed"
        )

    return AuthMessageResponse(
        message=generic_message
    )


# ============================================================
# 3. RESET PASSWORD
# ============================================================

@router.post(
    "/reset-password",
    response_model=AuthMessageResponse,
)
async def reset_barber_password(
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Reset a barber password using a single-use token.

    The password update and token consumption are
    committed as one transaction.
    """

    try:
        token_record = await consume_barber_token(
            db=db,
            raw_token=payload.token,
            token_type="password_reset",
        )

        if token_record is None:
            await db.rollback()

            raise HTTPException(
                status_code=400,
                detail=(
                    "Password-reset link is invalid, "
                    "expired, or already used."
                ),
            )

        result = await db.execute(
            select(BarberAccount)
            .where(
                BarberAccount.id
                == token_record.barber_id
            )
            .with_for_update()
        )

        barber = result.scalar_one_or_none()

        if barber is None:
            await db.rollback()

            raise HTTPException(
                status_code=404,
                detail="Barber account not found.",
            )

        if (
            barber.approval_status != "approved"
            or not barber.is_email_activated
        ):
            await db.rollback()

            raise HTTPException(
                status_code=403,
                detail=(
                    "This account is not eligible "
                    "for password reset."
                ),
            )

        # Store only an Argon2 password hash.
        new_hash = password_hasher.hash(
            payload.new_password
        )

        barber.password_hash = new_hash

        # Consume all other outstanding password
        # reset links for this account.
        from datetime import datetime, timezone
        from app.models.barber_auth_token import BarberAuthToken

        now = datetime.now(timezone.utc)

        await db.execute(
            update(BarberAuthToken)
            .where(
                BarberAuthToken.barber_id == barber.id,
                BarberAuthToken.token_type == "password_reset",
                BarberAuthToken.used_at.is_(None),
            )
            .values(used_at=now)
        )

        await db.commit()

        logger.info(
            "Password reset completed for barber: %s",
            barber.id,
        )

        return AuthMessageResponse(
            message=(
                "Password reset successfully. "
                "You can now log in with your new password."
            ),
        )

    except HTTPException:
        raise

    except SQLAlchemyError:
        await db.rollback()

        logger.exception(
            "Database error during barber password reset"
        )

        raise HTTPException(
            status_code=503,
            detail="Password-reset service temporarily unavailable.",
        )