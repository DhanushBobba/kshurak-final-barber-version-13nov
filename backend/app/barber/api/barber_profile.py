
import logging
import os
from uuid import UUID
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.barber_account import BarberAccount
logger = logging.getLogger("kshurak.barber.profile")
router = APIRouter(prefix="/api/v1/barber", tags=["Barber Profile"])
bearer = HTTPBearer(auto_error=False)
class BarberDocumentResponse(BaseModel):
    path: str
    original_name: str | None = None
    content_type: str | None = None
    size: int | None = None
    document_type: str | None = None
class BarberProfileResponse(BaseModel):
    id: UUID
    username: str
    email: str
    years_experience: int
    shop_name: str | None = None
    shop_phone: str | None = None
    shop_address: str
    shop_image_path: str | None = None
    document_paths: list[BarberDocumentResponse] = Field(default_factory=list)
    approval_status: str
    is_email_activated: bool
def get_barber_id(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> UUID:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Barber authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    secret = os.getenv("BARBER_JWT_SECRET", "")
    if len(secret) < 32:
        logger.error("BARBER_JWT_SECRET is not configured securely")
        raise HTTPException(
            status_code=503,
            detail="Barber authentication service unavailable",
        )
    try:
        payload = jwt.decode(
            credentials.credentials,
            secret,
            algorithms=["HS256"],
            options={"require": ["sub", "type", "iat", "exp"]},
        )
        if payload.get("type") != "barber_access":
            raise HTTPException(
                status_code=401,
                detail="Invalid barber access token",
            )
        return UUID(str(payload["sub"]))
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired barber access token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
@router.get("/profile", response_model=BarberProfileResponse)
async def get_barber_profile(
    barber_id: UUID = Depends(get_barber_id),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await db.execute(
            select(BarberAccount).where(BarberAccount.id == barber_id)
        )
        barber = result.scalar_one_or_none()
    except SQLAlchemyError as exc:
        logger.exception("Failed to fetch barber profile")
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve barber profile",
        ) from exc
    if barber is None:
        raise HTTPException(
            status_code=404,
            detail="Barber account not found",
        )
    if barber.approval_status != "approved" or not barber.is_email_activated:
        raise HTTPException(
            status_code=403,
            detail="Barber account is not authorized",
        )
    documents = []
    if isinstance(barber.document_paths, list):
        for item in barber.document_paths:
            if not isinstance(item, dict):
                continue
            path = item.get("path")
            if not isinstance(path, str) or not path:
                continue
            documents.append(
                BarberDocumentResponse(
                    path=path,
                    original_name=item.get("original_name"),
                    content_type=item.get("content_type"),
                    size=item.get("size"),
                    document_type=item.get("document_type"),
                )
            )
    return BarberProfileResponse(
        id=barber.id,
        username=barber.username,
        email=barber.email,
        years_experience=barber.years_experience,
        shop_name=barber.shop_name,
        shop_phone=barber.shop_phone,
        shop_address=barber.shop_address,
        shop_image_path=barber.shop_image_path,
        document_paths=documents,
        approval_status=barber.approval_status,
        is_email_activated=barber.is_email_activated,
    )
