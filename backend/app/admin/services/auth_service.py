"""
KSHURAK Admin authentication and authorization.

Admin identities are stored in public.admin_accounts.
Customer and Barber authentication remain independent.
"""

import uuid
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.database import AsyncSessionLocal
from app.admin.services.token_service import decode_admin_access_token


admin_bearer = HTTPBearer(auto_error=False)

ADMIN_ROLES = frozenset({"ADMIN", "SUPER_ADMIN"})


async def get_admin_account(admin_id: uuid.UUID) -> dict | None:
    """Load an Admin account from PostgreSQL."""

    query = text("""
        SELECT
            id,
            full_name,
            email,
            password_hash,
            role,
            account_status
        FROM public.admin_accounts
        WHERE id = :admin_id
        LIMIT 1
    """)

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                query,
                {"admin_id": admin_id},
            )
            account = result.mappings().one_or_none()

            return dict(account) if account else None

    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="Admin database service unavailable",
        ) from exc


async def verify_admin_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        admin_bearer
    ),
) -> dict[str, Any]:
    """Validate the Admin JWT and current database permissions."""

    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired Admin credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise unauthorized

    if credentials.scheme.lower() != "bearer":
        raise unauthorized

    payload = decode_admin_access_token(
        credentials.credentials
    )

    if payload is None:
        raise unauthorized

    try:
        admin_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError, TypeError):
        raise unauthorized

    account = await get_admin_account(admin_id)

    if account is None:
        raise unauthorized

    if account["account_status"] != "ACTIVE":
        raise HTTPException(
            status_code=403,
            detail="Admin account is not active",
        )

    if account["role"] not in ADMIN_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Admin access denied",
        )

    return {
        "id": str(account["id"]),
        "full_name": account["full_name"],
        "email": account["email"],
        "role": account["role"],
    }


async def require_super_admin(
    admin: dict[str, Any] = Depends(verify_admin_token),
) -> dict[str, Any]:
    """Restrict access to Super Admins."""

    if admin["role"] != "SUPER_ADMIN":
        raise HTTPException(
            status_code=403,
            detail="Super Admin access required",
        )

    return admin
