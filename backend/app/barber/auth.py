
import os
import uuid
from typing import Any
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

bearer_scheme = HTTPBearer(auto_error=False)

def auth_error(message: str = "Invalid or expired barber credentials") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )

async def get_current_barber_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise auth_error("Barber login required. Please sign in again.")
    secret = os.getenv("BARBER_JWT_SECRET", "")
    if len(secret) < 32:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Barber authentication is not configured.",
        )
    try:
        payload = jwt.decode(
            credentials.credentials,
            secret,
            algorithms=["HS256"],
        )
    except JWTError:
        raise auth_error()
    if payload.get("type") != "barber_access":
        raise auth_error("This token is not a barber access token.")
    try:
        account_id = uuid.UUID(str(payload["sub"]))
    except (KeyError, ValueError, TypeError):
        raise auth_error("Invalid barber identity.")
    payload["sub"] = str(account_id)
    return payload
