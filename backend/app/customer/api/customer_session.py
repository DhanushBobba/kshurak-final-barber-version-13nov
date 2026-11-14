
"""
KSHURAK Customer Authentication Dependency.

Validates a customer Supabase access token using
the Supabase Auth service.

Never accepts a client-supplied customer ID.
Never uses the legacy guest-user fallback.
Never exposes the server API key to the browser.
"""

import logging
import os
from typing import Annotated
from uuid import UUID

import httpx

from fastapi import (
    Depends,
    HTTPException,
    status,
)
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
)


logger = logging.getLogger(
    "kshurak.customer.session"
)

bearer_scheme = HTTPBearer(
    auto_error=False
)


async def get_authenticated_customer(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
) -> dict:
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Customer login is required.",
        )

    token = credentials.credentials.strip()

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Customer access token is required.",
        )

    supabase_url = os.getenv(
        "SUPABASE_URL", ""
    ).strip().rstrip("/")

    supabase_key = (
        os.getenv("SUPABASE_ANON_KEY", "").strip()
        or os.getenv(
            "SUPABASE_PUBLISHABLE_KEY", ""
        ).strip()
    )

    if not supabase_url.startswith("https://"):
        logger.error(
            "SUPABASE_URL is not configured."
        )
        raise HTTPException(
            status_code=503,
            detail="Customer authentication is unavailable.",
        )

    if not supabase_key:
        logger.error(
            "Supabase public API key is not configured."
        )
        raise HTTPException(
            status_code=503,
            detail="Customer authentication is unavailable.",
        )

    try:
        async with httpx.AsyncClient(
            timeout=10.0
        ) as client:
            response = await client.get(
                f"{supabase_url}/auth/v1/user",
                headers={
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
            )

    except httpx.HTTPError as exc:
        logger.warning(
            "Supabase authentication request failed."
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to verify customer session.",
        ) from exc

    if response.status_code in (401, 403):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired customer session.",
            headers={
                "WWW-Authenticate": "Bearer"
            },
        )

    if response.status_code != 200:
        logger.error(
            "Supabase Auth returned HTTP %s",
            response.status_code,
        )

        raise HTTPException(
            status_code=503,
            detail="Customer authentication is unavailable.",
        )

    try:
        customer = response.json()

        if not isinstance(customer, dict):
            raise ValueError(
                "Invalid authentication response."
            )

        customer_id = UUID(
            str(customer["id"])
        )

    except (
        ValueError,
        KeyError,
        TypeError,
    ) as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer identity.",
        ) from exc

    return {
        "id": customer_id,
        "email": customer.get("email"),
        "phone": customer.get("phone"),
        "user_metadata": (
            customer.get("user_metadata") or {}
        ),
    }
