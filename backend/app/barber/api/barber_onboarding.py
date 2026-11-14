import hashlib
import json
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional
from datetime import time

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.barber_application import (
    BarberApplication,
    BarberInvitation,
)

router = APIRouter()

bearer = HTTPBearer(auto_error=False)

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_FILES = 5

# Private local storage for development.
# Production should use private object storage.
PRIVATE_UPLOAD_DIR = (
    Path(__file__).resolve().parents[3]
    / "private_uploads"
    / "barber_documents"
)


class InvitationRequest(BaseModel):
    email: EmailStr
    expires_hours: int = Field(
        default=72,
        ge=1,
        le=168,
    )


def utc_now():
    return datetime.now(timezone.utc)


def as_utc(value):
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


async def require_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
):
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Admin authentication required",
        )

    payload = decode_access_token(credentials.credentials)

    if not payload or not payload.get("sub"):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
        )

    if payload.get("role") not in ("ADMIN", "SUPER_ADMIN"):
        raise HTTPException(
            status_code=403,
            detail="Admin access required",
        )

    return payload


def normalize_email(email: str):
    return email.strip().lower()


def hash_token(token: str):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.post("/invitations", status_code=201)
async def create_invitation(
    body: InvitationRequest,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    invitation_id = str(uuid.uuid4())
    expires_at = utc_now() + timedelta(
        hours=body.expires_hours
    )

    invitation_token = jwt.encode(
        {
            "sub": invitation_id,
            "purpose": "BARBER_REGISTRATION",
            "jti": secrets.token_hex(16),
            "exp": expires_at,
        },
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )

    invitation = BarberInvitation(
        id=invitation_id,
        email=normalize_email(body.email),
        token_hash=hash_token(invitation_token),
        created_by=str(admin["sub"]),
        expires_at=expires_at,
    )

    db.add(invitation)
    await db.commit()

    return {
        "invitationId": invitation_id,
        "email": invitation.email,
        "registrationToken": invitation_token,
        "expiresAt": expires_at.isoformat(),
        "message": "Invitation created successfully",
    }


def validate_time(value: str):
    if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
        raise HTTPException(
            status_code=422,
            detail="Invalid time format. Use HH:MM",
        )


def validate_document(data: bytes):
    if data.startswith(b"%PDF-"):
        return ".pdf"

    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"

    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"

    raise HTTPException(
        status_code=422,
        detail="Only valid PDF, PNG and JPG files are supported",
    )


@router.post("/applications", status_code=201)
async def submit_barber_application(
    registrationToken: str = Form(...),
    fullName: str = Form(...),
    email: EmailStr = Form(...),
    phone: str = Form(...),
    yearsExperience: int = Form(0),

    shopName: str = Form(...),
    shopPhone: str = Form(...),
    licenseNumber: Optional[str] = Form(None),
    specialties: str = Form(""),

    address: str = Form(...),
    city: str = Form(...),
    state: str = Form(...),
    pincode: str = Form(...),

    latitude: float = Form(...),
    longitude: float = Form(...),

    chairCount: int = Form(...),
    barberCount: int = Form(...),

    openingTime: str = Form(...),
    closingTime: str = Form(...),
    workingDays: str = Form(...),

    documents: Optional[List[UploadFile]] = File(None),

    db: AsyncSession = Depends(get_db),
):
    # Validate invitation JWT.
    try:
        payload = jwt.decode(
            registrationToken,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
    except JWTError:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired registration invitation",
        )

    if payload.get("purpose") != "BARBER_REGISTRATION":
        raise HTTPException(
            status_code=401,
            detail="Invalid invitation purpose",
        )

    invitation_id = payload.get("sub")

    if not invitation_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid invitation",
        )

    result = await db.execute(
        select(BarberInvitation).where(
            BarberInvitation.id == invitation_id
        )
    )

    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(
            status_code=404,
            detail="Invitation not found",
        )

    if not secrets.compare_digest(
        invitation.token_hash,
        hash_token(registrationToken),
    ):
        raise HTTPException(
            status_code=401,
            detail="Invitation token does not match",
        )

    if invitation.used_at is not None:
        raise HTTPException(
            status_code=409,
            detail="Invitation already used",
        )

    if as_utc(invitation.expires_at) <= utc_now():
        raise HTTPException(
            status_code=401,
            detail="Invitation expired",
        )

    if normalize_email(email) != invitation.email:
        raise HTTPException(
            status_code=422,
            detail="Email must match the invitation",
        )

    # Validate registration information.
    if not fullName.strip() or not shopName.strip():
        raise HTTPException(
            status_code=422,
            detail="Barber name and shop name are required",
        )

    if len(fullName) > 150 or len(shopName) > 200:
        raise HTTPException(
            status_code=422,
            detail="Name exceeds permitted length",
        )

    if not re.fullmatch(r"\+?[0-9 -]{10,20}", phone.strip()):
        raise HTTPException(
            status_code=422,
            detail="Invalid phone number",
        )

    if not re.fullmatch(r"\+?[0-9 -]{10,20}", shopPhone.strip()):
        raise HTTPException(
            status_code=422,
            detail="Invalid shop phone number",
        )

    if yearsExperience < 0 or yearsExperience > 80:
        raise HTTPException(
            status_code=422,
            detail="Invalid experience",
        )

    if chairCount < 1 or barberCount < 1:
        raise HTTPException(
            status_code=422,
            detail="Chair and barber counts must be positive",
        )

    if not (-90 <= latitude <= 90):
        raise HTTPException(
            status_code=422,
            detail="Invalid latitude",
        )

    if not (-180 <= longitude <= 180):
        raise HTTPException(
            status_code=422,
            detail="Invalid longitude",
        )

    if not re.fullmatch(r"\d{6}", pincode.strip()):
        raise HTTPException(
            status_code=422,
            detail="PIN code must have six digits",
        )

    validate_time(openingTime)
    validate_time(closingTime)

    if openingTime >= closingTime:
        raise HTTPException(
            status_code=422,
            detail="Closing time must be after opening time",
        )

    try:
        days = json.loads(workingDays)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=422,
            detail="Invalid working days",
        )

    valid_days = {
        "Mon", "Tue", "Wed", "Thu",
        "Fri", "Sat", "Sun",
    }

    if (
        not isinstance(days, list)
        or not days
        or len(days) != len(set(days))
        or not all(day in valid_days for day in days)
    ):
        raise HTTPException(
            status_code=422,
            detail="Select valid working days",
        )

    # Validate document contents before storing.
    document_data = []

    if documents and len(documents) > MAX_FILES:
        raise HTTPException(
            status_code=422,
            detail="Maximum five documents allowed",
        )

    for document in documents or []:
        data = await document.read(MAX_FILE_BYTES + 1)

        if not data or len(data) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=422,
                detail="Each document must be 1 byte to 10 MB",
            )

        extension = validate_document(data)
        document_data.append((data, extension))

    application_id = str(uuid.uuid4())
    stored_paths = []

    try:
        if document_data:
            PRIVATE_UPLOAD_DIR.mkdir(
                parents=True,
                exist_ok=True,
                mode=0o700,
            )

        for content, extension in document_data:
            filename = f"{uuid.uuid4().hex}{extension}"
            path = PRIVATE_UPLOAD_DIR / filename

            # Exclusive creation prevents accidental overwrites.
            with path.open("xb") as output:
                output.write(content)

            stored_paths.append(path)

        application = BarberApplication(
            id=application_id,
            invitation_id=invitation.id,

            full_name=fullName.strip(),
            email=normalize_email(email),
            phone=phone.strip(),
            years_experience=yearsExperience,

            shop_name=shopName.strip(),
            shop_phone=shopPhone.strip(),
            license_number=licenseNumber,
            specialties=specialties,

            address=address.strip(),
            city=city.strip(),
            state=state.strip(),
            pincode=pincode.strip(),

            latitude=latitude,
            longitude=longitude,

            chair_count=chairCount,
            barber_count=barberCount,
            
            opening_time=time.fromisoformat(openingTime),
            closing_time=time.fromisoformat(closingTime),
            working_days=days,

            document_paths=[
                str(path) for path in stored_paths
],

            status="PENDING",
        )

        db.add(application)

        # Atomic claim: only one request can consume
        # this invitation successfully.
        claim = await db.execute(
            update(BarberInvitation)
            .where(
                BarberInvitation.id == invitation.id,
                BarberInvitation.used_at.is_(None),
            )
            .values(used_at=utc_now())
        )

        if claim.rowcount != 1:
            raise HTTPException(
                status_code=409,
                detail="Invitation already used",
            )

        await db.commit()

    except IntegrityError:
        await db.rollback()

        for path in stored_paths:
            path.unlink(missing_ok=True)

        raise HTTPException(
            status_code=409,
            detail="Registration already submitted",
        )

    except Exception:
        await db.rollback()

        for path in stored_paths:
            path.unlink(missing_ok=True)

        raise

    return {
        "applicationId": application_id,
        "status": "PENDING",
        "message": (
            "Registration submitted successfully. "
            "Your application is awaiting admin approval."
        ),
    }