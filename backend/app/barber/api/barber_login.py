import logging
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from pwdlib import PasswordHash
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.barber_account import BarberAccount


logger = logging.getLogger("kshurak.barber.login")

router = APIRouter(
    prefix="/api/v1/barber",
    tags=["Barber Login"],
)

password_hasher = PasswordHash.recommended()


class BarberLoginRequest(BaseModel):
    identifier: str = Field(
        min_length=1,
        max_length=254,
    )
    password: str = Field(min_length=1)


class BarberLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    barber_id: str
    username: str
    message: str


def login_error(code: str, message: str):
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": code,
            "message": message,
        },
    )


@router.post(
    "/login",
    response_model=BarberLoginResponse,
)
async def login_barber(
    payload: BarberLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    identifier = payload.identifier.strip().lower()

    if not identifier:
        raise HTTPException(
            status_code=422,
            detail="Email address is required.",
        )

    # Query existing barber accounts only.
    try:
        statement = select(BarberAccount).where(
            func.lower(BarberAccount.email) == identifier
        )
        result = await db.execute(statement)
        barber = result.scalar_one_or_none()
    except SQLAlchemyError:
        logger.exception("Database error during barber login")

        raise HTTPException(
            status_code=503,
            detail="Login service temporarily unavailable.",
        )

    # Do not reveal whether the account exists.
    if barber is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password.",
        )

    try:
        password_valid = password_hasher.verify(
            payload.password,
            barber.password_hash,
        )
    except Exception:
        logger.exception("Password verification failed")

        raise HTTPException(
            status_code=503,
            detail="Unable to verify credentials.",
        )

    if not password_valid:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password.",
        )

    # Approval rules must be enforced by the server.
    approval_status = (barber.approval_status or "").lower()

    if approval_status == "pending":
        login_error(
            "ADMIN_APPROVAL_REQUIRED",
            "Your account is awaiting admin approval. "
            "Please wait for approval before logging in.",
        )

    if approval_status == "rejected":
        login_error(
            "APPLICATION_REJECTED",
            "Your barber registration was not approved. "
            "Please contact KSHURAK support.",
        )

    if approval_status != "approved":
        login_error(
            "ACCOUNT_NOT_APPROVED",
            "Your account is not approved for login.",
        )

    if not barber.is_email_activated:
        login_error(
            "EMAIL_ACTIVATION_REQUIRED",
            "Your account has been approved, but your email "
            "is not activated. Please use the activation link "
            "sent to your registered email.",
        )

    # Only approved + activated barbers receive a token.
    secret = os.getenv("BARBER_JWT_SECRET", "")

    if len(secret) < 32:
        logger.error("BARBER_JWT_SECRET is not configured securely")

        raise HTTPException(
            status_code=503,
            detail="Login service is not configured.",
        )

    now = datetime.now(timezone.utc)
    expires_in = 30 * 60

    token = jwt.encode(
        {
            "sub": str(barber.id),
            "type": "barber_access",
            "jti": str(uuid4()),
            "iat": now,
            "exp": now + timedelta(seconds=expires_in),
        },
        secret,
        algorithm="HS256",
    )

    logger.info("Approved barber logged in: %s", barber.id)

    return BarberLoginResponse(
        access_token=token,
        expires_in=expires_in,
        barber_id=str(barber.id),
        username=barber.username,
        message="Login successful.",
    )