import hashlib
import secrets

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.barber_auth_token import BarberAuthToken


TokenType = Literal[
    "email_activation",
    "password_reset",
    "registration_correction",
]


def utc_now() -> datetime:
    """Return the current UTC timestamp."""
    return datetime.now(timezone.utc)


def hash_token(raw_token: str) -> str:
    """
    Convert a raw token into a SHA-256 hash.

    Raw tokens must never be saved in the database.
    """
    return hashlib.sha256(
        raw_token.encode("utf-8")
    ).hexdigest()


async def create_barber_token(
    db: AsyncSession,
    barber_id: UUID,
    token_type: TokenType,
    expiry_minutes: int = 30,
) -> str:
    """
    Generate and store a secure, single-use token.

    Returns the raw token for sending by email.

    The caller is responsible for committing
    the database transaction.
    """

    if token_type not in (
        "email_activation",
        "password_reset",
        "registration_correction",
    ):
        raise ValueError("Invalid token type")

    if expiry_minutes <= 0:
        raise ValueError(
            "Token expiry must be greater than zero"
        )

    now = utc_now()

    # Invalidate previously issued unused tokens
    # of the same type for this barber.
    await db.execute(
        update(BarberAuthToken)
        .where(
            BarberAuthToken.barber_id == barber_id,
            BarberAuthToken.token_type == token_type,
            BarberAuthToken.used_at.is_(None),
        )
        .values(used_at=now)
    )

    # Generate cryptographically secure random token
    raw_token = secrets.token_urlsafe(48)

    token_record = BarberAuthToken(
        barber_id=barber_id,
        token_hash=hash_token(raw_token),
        token_type=token_type,
        expires_at=now + timedelta(
            minutes=expiry_minutes
        ),
    )

    db.add(token_record)

    await db.flush()

    return raw_token


async def get_valid_barber_token(
    db: AsyncSession,
    raw_token: str,
    token_type: TokenType,
) -> BarberAuthToken | None:
    """
    Find a valid unused token.

    Does not consume the token.
    """
    if not raw_token:
        return None

    token_digest = hash_token(raw_token)

    result = await db.execute(
        select(BarberAuthToken)
        .where(
            BarberAuthToken.token_hash == token_digest,
            BarberAuthToken.token_type == token_type,
            BarberAuthToken.used_at.is_(None),
            BarberAuthToken.expires_at > utc_now(),
        )
    )

    return result.scalar_one_or_none()


async def consume_barber_token(
    db: AsyncSession,
    raw_token: str,
    token_type: TokenType,
) -> BarberAuthToken | None:
    """
    Atomically consume a token.

    Only one request can consume a particular
    unused token successfully.

    The caller must commit the transaction.
    """
    if not raw_token:
        return None

    now = utc_now()

    statement = (
        update(BarberAuthToken)
        .where(
            BarberAuthToken.token_hash
            == hash_token(raw_token),
            BarberAuthToken.token_type == token_type,
            BarberAuthToken.used_at.is_(None),
            BarberAuthToken.expires_at > now,
        )
        .values(used_at=now)
        .returning(BarberAuthToken)
    )

    result = await db.execute(statement)

    return result.scalar_one_or_none()
