"""
KSHURAK Admin Authentication API.

Admin credentials are stored in public.admin_accounts.
Customer and Barber authentication are independent.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.admin.services.auth_service import (
    get_admin_account,
    verify_admin_token,
)
from app.admin.services.password_service import verify_admin_password
from app.admin.services.token_service import create_admin_access_token
from app.core.database import AsyncSessionLocal

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError


router = APIRouter(
    prefix="/api/v1/admin/auth",
    tags=["Admin Authentication"],
)


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)


class AdminProfileResponse(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    role: str


class AdminLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 1800
    admin: AdminProfileResponse


@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(payload: AdminLoginRequest):
    """Authenticate a KSHURAK Admin using PostgreSQL."""

    email = str(payload.email).strip().lower()

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                text("""
                    SELECT
                        id,
                        full_name,
                        email,
                        password_hash,
                        role,
                        account_status
                    FROM public.admin_accounts
                    WHERE email = :email
                    LIMIT 1
                """),
                {"email": email},
            )

            account = result.mappings().one_or_none()

    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="Admin authentication service unavailable",
        ) from exc

    invalid_credentials = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if account is None:
        raise invalid_credentials

    if not verify_admin_password(
        payload.password,
        account["password_hash"],
    ):
        raise invalid_credentials

    if account["account_status"] != "ACTIVE":
        raise HTTPException(
            status_code=403,
            detail="Admin account is not active",
        )

    if account["role"] not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(
            status_code=403,
            detail="Admin access denied",
        )

    access_token = create_admin_access_token(
        str(account["id"])
    )

    return AdminLoginResponse(
        access_token=access_token,
        admin=AdminProfileResponse(
            id=str(account["id"]),
            email=account["email"],
            full_name=account["full_name"],
            role=account["role"],
        ),
    )


@router.get("/me", response_model=AdminProfileResponse)
async def get_admin_profile(
    admin: Annotated[dict, Depends(verify_admin_token)],
):
    """Return the authenticated Admin profile."""

    return AdminProfileResponse(
        id=admin["id"],
        email=admin["email"],
        full_name=admin["full_name"],
        role=admin["role"],
    )


@router.post("/logout")
async def admin_logout(
    admin: Annotated[dict, Depends(verify_admin_token)],
):
    """
    Client must discard its access token.

    Server-side token revocation is not yet implemented.
    """
    return {"message": "Discard the Admin access token"}
