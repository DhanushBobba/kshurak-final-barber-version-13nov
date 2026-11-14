"""
KSHURAK Admin JWT security.

Independent from Customer and Barber authentication.
"""

import os
import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt


ADMIN_JWT_ALGORITHM = "HS256"
ADMIN_JWT_ISSUER = "kshurak-admin-api"
ADMIN_JWT_AUDIENCE = "kshurak-admin-portal"
ADMIN_ACCESS_TOKEN_MINUTES = 30


def _get_admin_secret() -> str:
    secret = os.getenv("ADMIN_JWT_SECRET", "").strip()

    if len(secret) < 32:
        raise RuntimeError(
            "ADMIN_JWT_SECRET must contain at least 32 characters"
        )

    return secret


def create_admin_access_token(
    admin_id: str,
) -> str:
    now = datetime.now(timezone.utc)

    payload = {
        "sub": str(uuid.UUID(admin_id)),
        "iss": ADMIN_JWT_ISSUER,
        "aud": ADMIN_JWT_AUDIENCE,
        "token_type": "admin_access",
        "jti": str(uuid.uuid4()),
        "iat": now,
        "nbf": now,
        "exp": now + timedelta(
            minutes=ADMIN_ACCESS_TOKEN_MINUTES
        ),
    }

    return jwt.encode(
        payload,
        _get_admin_secret(),
        algorithm=ADMIN_JWT_ALGORITHM,
    )


def decode_admin_access_token(
    token: str,
) -> dict | None:
    try:
        payload = jwt.decode(
            token,
            _get_admin_secret(),
            algorithms=[ADMIN_JWT_ALGORITHM],
            issuer=ADMIN_JWT_ISSUER,
            audience=ADMIN_JWT_AUDIENCE,
            options={"require": [
                "sub", "iss", "aud", "exp",
                "iat", "nbf", "jti"
            ]},
        )

        if payload.get("token_type") != "admin_access":
            return None

        uuid.UUID(str(payload["sub"]))
        uuid.UUID(str(payload["jti"]))

        return payload

    except (JWTError, ValueError, TypeError):
        return None
