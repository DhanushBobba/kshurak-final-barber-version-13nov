import json
import logging
import math
import os
import re
import uuid

from datetime import time
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

import httpx

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
)
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db


# ============================================================
# CONFIGURATION
# ============================================================

logger = logging.getLogger("kshurak.barber.shop_setup")

router = APIRouter(
    prefix="/shop-setup",
    tags=["Barber Shop Setup"],
)

bearer_scheme = HTTPBearer(auto_error=False)

SECTIONS = (
    "profile",
    "shop",
    "workers",
    "documents",
    "capacity",
)

ALLOWED_FIELDS = {
    "fullName",
    "phone",
    "experience",
    "displayName",
    "email",
    "specializations",
    "languages",
    "bio",
    "shopName",
    "shopPhone",
    "shopEmail",
    "shopType",
    "description",
    "address",
    "landmark",
    "city",
    "state",
    "pincode",
    "latitude",
    "longitude",
    "googlePlaceId",
    "openingTime",
    "closingTime",
    "workingDays",
    "amenities",
    "chairs",
    "activeChairs",
    "simultaneousBookings",
    "appointmentDuration",
    "bufferMinutes",
    "advanceNoticeHours",
    "bookingWindowDays",
    "lunchStart",
    "lunchEnd",
}

DOCUMENT_STORAGE_BUCKET = "barber-documents"
MAX_DOCUMENT_SIZE = 5 * 1024 * 1024
MAX_DOCUMENTS = 10

DOCUMENT_TYPES = {
    "trade_license",
    "address_proof",
    "identity_proof",
    "professional_certificate",
    "other",
}

ALLOWED_UPLOAD_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


# ============================================================
# PYDANTIC SCHEMA
# ============================================================

class ShopSetupSave(BaseModel):
    setup_data: dict[str, Any] = Field(
        default_factory=dict
    )

    completed_sections: list[
        Literal[
            "profile",
            "shop",
            "workers",
            "documents",
            "capacity",
        ]
    ] = Field(default_factory=list)


# ============================================================
# AUTHENTICATION
# ============================================================

def authentication_error(
    message: str = "Invalid or expired barber credentials",
) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_barber_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        bearer_scheme
    ),
) -> dict[str, Any]:

    if (
        credentials is None
        or credentials.scheme.lower() != "bearer"
    ):
        raise authentication_error(
            "Barber login required. Please sign in again."
        )

    secret = os.getenv("BARBER_JWT_SECRET", "")

    if len(secret) < 32:
        raise HTTPException(
            status_code=503,
            detail="Barber authentication is not configured.",
        )

    try:
        payload = jwt.decode(
            credentials.credentials,
            secret,
            algorithms=["HS256"],
        )
    except JWTError:
        raise authentication_error()

    if payload.get("type") != "barber_access":
        raise authentication_error(
            "A valid barber access token is required."
        )

    try:
        account_id = uuid.UUID(str(payload["sub"]))
    except (KeyError, TypeError, ValueError):
        raise authentication_error(
            "Invalid barber account identity."
        )

    payload["sub"] = str(account_id)
    return payload


def barber_id(payload: dict[str, Any]) -> uuid.UUID:
    try:
        return uuid.UUID(str(payload["sub"]))
    except (KeyError, TypeError, ValueError):
        raise authentication_error()


# ============================================================
# COMMON HELPERS
# ============================================================

def clean(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def number(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return default

    try:
        result = int(value)
        return result if str(value).strip() == str(result) else default
    except (TypeError, ValueError, OverflowError):
        return default


def valid_phone(value: Any) -> bool:
    phone = clean(value)
    digits = re.sub(r"\D", "", phone)

    return (
        bool(re.fullmatch(r"[0-9+\-\s()]{10,20}", phone))
        and 10 <= len(digits) <= 15
    )


def valid_email(value: Any) -> bool:
    email = clean(value)

    return (
        not email
        or bool(
            re.fullmatch(
                r"[^\s@]+@[^\s@]+\.[^\s@]+",
                email,
            )
        )
    )


def valid_time(value: Any) -> bool:
    try:
        time.fromisoformat(clean(value))
        return True
    except ValueError:
        return False


def time_order(start: Any, end: Any) -> bool:
    if not valid_time(start) or not valid_time(end):
        return False

    return (
        time.fromisoformat(clean(start))
        < time.fromisoformat(clean(end))
    )


# ============================================================
# DOCUMENT HELPERS
# ============================================================

def document_metadata(value: Any) -> list[dict[str, Any]]:

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return []

    if not isinstance(value, list):
        return []

    documents = []

    for item in value:
        if (
            isinstance(item, dict)
            and isinstance(item.get("path"), str)
            and item["path"]
        ):
            documents.append(
                {
                    "path": item["path"],
                    "original_name": item.get("original_name"),
                    "content_type": item.get("content_type"),
                    "size": item.get("size"),
                    "document_type": item.get("document_type"),
                }
            )

        elif isinstance(item, str) and item.strip():
            documents.append(
                {
                    "path": item,
                    "original_name": item.rsplit("/", 1)[-1],
                    "content_type": None,
                    "size": None,
                    "document_type": None,
                }
            )

    return documents


# ============================================================
# VALIDATE SHOP CAPACITY
# ============================================================

def capacity_valid(draft: dict[str, Any]) -> bool:

    chairs = number(draft.get("chairs"))
    active = number(draft.get("activeChairs"))
    simultaneous = number(draft.get("simultaneousBookings"))
    duration = number(draft.get("appointmentDuration"))

    buffer_minutes = number(
        draft.get("bufferMinutes"), -1
    )

    advance_hours = number(
        draft.get("advanceNoticeHours"), -1
    )

    booking_days = number(
        draft.get("bookingWindowDays")
    )

    lunch_start = clean(draft.get("lunchStart"))
    lunch_end = clean(draft.get("lunchEnd"))

    lunch_valid = (
        (not lunch_start and not lunch_end)
        or time_order(lunch_start, lunch_end)
    )

    return (
        chairs > 0
        and 0 < active <= chairs
        and 0 < simultaneous <= active
        and duration > 0
        and buffer_minutes >= 0
        and advance_hours >= 0
        and booking_days > 0
        and lunch_valid
    )


# ============================================================
# VALIDATE BARBER PROFILE
# ============================================================

def profile_valid(draft: dict[str, Any]) -> bool:

    experience = number(
        draft.get("experience"), -1
    )

    specializations = draft.get("specializations")

    return (
        len(clean(draft.get("fullName"))) >= 2
        and valid_phone(draft.get("phone"))
        and 0 <= experience <= 80
        and valid_email(draft.get("email"))
        and isinstance(specializations, list)
        and any(
            isinstance(item, str) and item.strip()
            for item in specializations
        )
    )


# ============================================================
# VALIDATE SHOP LOCATION
# ============================================================

def coordinates_valid(draft: dict[str, Any]) -> bool:

    try:
        latitude = float(draft.get("latitude"))
        longitude = float(draft.get("longitude"))

        return (
            math.isfinite(latitude)
            and math.isfinite(longitude)
            and -90 <= latitude <= 90
            and -180 <= longitude <= 180
            and bool(clean(draft.get("googlePlaceId")))
        )

    except (TypeError, ValueError, OverflowError):
        return False


# ============================================================
# VALIDATE SHOP DETAILS
# ============================================================

def shop_valid(draft: dict[str, Any]) -> bool:

    days = draft.get("workingDays")
    pincode = clean(draft.get("pincode"))

    return (
        len(clean(draft.get("shopName"))) >= 2
        and valid_phone(draft.get("shopPhone"))
        and valid_email(draft.get("shopEmail"))
        and len(clean(draft.get("address"))) >= 10
        and bool(clean(draft.get("city")))
        and bool(clean(draft.get("state")))
        and bool(re.fullmatch(r"\d{6}", pincode))
        and time_order(
            draft.get("openingTime"),
            draft.get("closingTime"),
        )
        and isinstance(days, list)
        and len(days) > 0
        and coordinates_valid(draft)
    )


# ============================================================
# VALIDATE ALL SHOP SETUP SECTIONS
# ============================================================

def sections_for(
    draft: dict[str, Any],
    documents: list[dict[str, Any]],
    worker_ok: bool,
    location_verified: bool = False,
) -> list[str]:

    completed = []

    if profile_valid(draft):
        completed.append("profile")

    if shop_valid(draft) and location_verified:
        completed.append("shop")

    if worker_ok:
        completed.append("workers")

    if documents:
        completed.append("documents")

    if capacity_valid(draft):
        completed.append("capacity")

    return completed


# ============================================================
# LOAD APPROVED BARBER ACCOUNT
# ============================================================

async def load_account(
    db: AsyncSession,
    account_id: uuid.UUID,
    lock: bool = False,
) -> dict[str, Any]:

    query = """
        SELECT
            id,
            username,
            email,
            shop_name,
            shop_phone,
            shop_address,
            years_experience,
            shop_image_path,
            document_paths,
            approval_status,
            is_email_activated
        FROM public.barber_accounts
        WHERE id = :account_id
    """

    if lock:
        query += " FOR UPDATE"

    result = await db.execute(
        text(query),
        {"account_id": account_id},
    )

    row = result.mappings().first()

    if row is None:
        raise HTTPException(
            status_code=403,
            detail="Barber account not found.",
        )

    account = dict(row)

    # Admin approval remains mandatory.
    if (account.get("approval_status") or "").lower() != "approved":
        raise HTTPException(
            status_code=403,
            detail="Barber account is not approved.",
        )

    # Email activation remains mandatory.
    if not account.get("is_email_activated"):
        raise HTTPException(
            status_code=403,
            detail="Barber email activation is required.",
        )

    return account


# ============================================================
# LOAD BARBER APPLICATION
# ============================================================

async def load_application(
    db: AsyncSession,
    account_id: uuid.UUID,
    lock: bool = False,
) -> dict[str, Any] | None:

    query = """
        SELECT *
        FROM public.barber_applications
        WHERE barber_account_id = :account_id
    """

    if lock:
        query += " FOR UPDATE"

    result = await db.execute(
        text(query),
        {"account_id": account_id},
    )

    row = result.mappings().first()

    return dict(row) if row else None


# ============================================================
# COUNT ACTIVE WORKERS
# ============================================================

async def worker_count(
    db: AsyncSession,
    account_id: uuid.UUID,
) -> int:

    table = await db.scalar(
        text("SELECT to_regclass('public.barber_workers')")
    )

    if table is None:
        return 0

    result = await db.execute(
        text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'barber_workers'
        """)
    )

    columns = set(result.scalars().all())

    if "barber_id" not in columns:
        return 0

    query = """
        SELECT COUNT(*)
        FROM public.barber_workers
        WHERE barber_id = :account_id
    """

    if "is_active" in columns:
        query += " AND is_active = TRUE"

    count = await db.scalar(
        text(query),
        {"account_id": account_id},
    )

    return int(count or 0)


# ============================================================
# SHOP SETUP RESPONSE
# ============================================================

def response_data(
    application: dict[str, Any] | None,
    account: dict[str, Any],
    active_workers: int,
) -> dict[str, Any]:

    documents = document_metadata(
        account.get("document_paths")
    )

    draft = (application or {}).get("setup_data") or {}

    if not isinstance(draft, dict):
        draft = {}

    location_verified = bool(
        (application or {}).get("location_verified")
    )

    completed = sections_for(
        draft,
        documents,
        active_workers > 0,
        location_verified,
    )

    return {
        "application_id": (
            str(application["id"]) if application else None
        ),
        "setup_data": draft,
        "completed_sections": completed,
        "submission_status": (
            (application or {}).get("setup_submission_status")
            or "draft"
        ),
        "location_verified": location_verified,
        "submitted_at": (
            application["submitted_at"].isoformat()
            if application and application.get("submitted_at")
            else None
        ),
        "published_at": (
            application["published_at"].isoformat()
            if application and application.get("published_at")
            else None
        ),
        "registration_documents": documents,
        "shop_image_path": account.get("shop_image_path"),
    }


# ============================================================
# HAVERSINE DISTANCE
# ============================================================

def distance_meters(
    latitude_a: float,
    longitude_a: float,
    latitude_b: float,
    longitude_b: float,
) -> float:

    radius = 6371000.0

    lat_a = math.radians(latitude_a)
    lat_b = math.radians(latitude_b)

    delta_lat = math.radians(latitude_b - latitude_a)
    delta_lon = math.radians(longitude_b - longitude_a)

    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat_a)
        * math.cos(lat_b)
        * math.sin(delta_lon / 2) ** 2
    )

    return 2 * radius * math.asin(
        min(1.0, math.sqrt(haversine))
    )


# ============================================================
# VERIFY GOOGLE PLACE ON SERVER
# ============================================================


async def verify_google_place(
    place_id: str,
    expected_address: str,
    requested_latitude: float,
    requested_longitude: float,
) -> tuple[float, float] | None:
    """
    Verify a shop location using Google Places API (New).

    Return verified coordinates when successful.
    Return None when the selected location is invalid.
    Raise HTTPException for Google API configuration,
    permissions, quota, or temporary service failures.
    """

    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()

    if not api_key:
        logger.error(
            "Google Places verification unavailable: "
            "GOOGLE_MAPS_API_KEY is missing."
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Google Places verification is not configured "
                "on the Barber Backend."
            ),
        )

    place_id = clean(place_id)

    if not place_id or len(place_id) > 255:
        logger.warning("Invalid Google Place ID.")
        return None

    if not clean(expected_address):
        logger.warning("Shop address is missing.")
        return None

    try:
        requested_latitude = float(requested_latitude)
        requested_longitude = float(requested_longitude)
    except (TypeError, ValueError, OverflowError):
        return None

    if not (
        math.isfinite(requested_latitude)
        and math.isfinite(requested_longitude)
        and -90 <= requested_latitude <= 90
        and -180 <= requested_longitude <= 180
    ):
        return None

    url = (
        "https://places.googleapis.com/v1/places/"
        f"{quote(place_id, safe='')}"
    )

    headers = {
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "id,formattedAddress,location"
        ),
        "Accept": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                url,
                headers=headers,
            )

    except httpx.TimeoutException as exc:
        logger.warning(
            "Google Places verification timed out: %s",
            place_id,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Google Places verification timed out. "
                "Please retry saving Shop Details."
            ),
        ) from exc

    except httpx.HTTPError as exc:
        logger.exception(
            "Google Places network verification failed."
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Google Places verification is temporarily "
                "unavailable. Please retry."
            ),
        ) from exc

    if response.status_code != 200:
        try:
            payload = response.json()
            error = payload.get("error", {})
            google_message = str(error.get("message", ""))
            google_status = str(error.get("status", ""))
        except (ValueError, TypeError, AttributeError):
            google_message = ""
            google_status = ""

        logger.error(
            "Google Places verification failed: "
            "HTTP %s; Google status=%s; message=%s",
            response.status_code,
            google_status,
            google_message[:500],
        )

        if response.status_code in (401, 403):
            raise HTTPException(
                status_code=503,
                detail=(
                    "Google Places API authorization failed. "
                    "Check the backend API key, Places API (New), "
                    "billing, and public IP restrictions."
                ),
            )

        if response.status_code == 429:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Google Places verification quota or rate "
                    "limit exceeded. Please try again later."
                ),
            )

        if response.status_code in (400, 404):
            return None

        raise HTTPException(
            status_code=503,
            detail=(
                "Google Places verification could not be "
                "completed. Please retry later."
            ),
        )

    try:
        place = response.json()

        if not isinstance(place, dict):
            return None

        returned_place_id = clean(place.get("id"))

        if returned_place_id != place_id:
            logger.warning(
                "Google Place ID mismatch: %s",
                place_id,
            )
            return None

        google_address = clean(
            place.get("formattedAddress")
        )

        if not google_address:
            logger.warning(
                "Google Place returned no formatted address."
            )
            return None

        position = place.get("location")

        if not isinstance(position, dict):
            logger.warning(
                "Google Place returned no coordinates."
            )
            return None

        latitude = float(position["latitude"])
        longitude = float(position["longitude"])

        if not (
            math.isfinite(latitude)
            and math.isfinite(longitude)
            and -90 <= latitude <= 90
            and -180 <= longitude <= 180
        ):
            return None

        deviation = distance_meters(
            latitude,
            longitude,
            requested_latitude,
            requested_longitude,
        )

        if deviation > 200:
            logger.warning(
                "Google Place coordinate mismatch: "
                "%.1f meters. Place ID: %s",
                deviation,
                place_id,
            )
            return None

        logger.info(
            "Google Place successfully verified. "
            "Place ID=%s Latitude=%s Longitude=%s",
            place_id,
            latitude,
            longitude,
        )

        return latitude, longitude

    except (ValueError, KeyError, TypeError):
        logger.warning(
            "Invalid Google Places response.",
            exc_info=True,
        )
        return None


# ============================================================
# VALIDATE AND SANITIZE SHOP DRAFT
# ============================================================

def draft_for_storage(
    data: dict[str, Any],
) -> dict[str, Any]:

    draft = {
        key: value
        for key, value in data.items()
        if key in ALLOWED_FIELDS
    }

    try:
        encoded = json.dumps(
            draft,
            allow_nan=False,
        )
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=422,
            detail="Invalid Shop Setup JSON values.",
        )

    if len(encoded.encode("utf-8")) > 100000:
        raise HTTPException(
            status_code=413,
            detail="Shop Setup data is too large.",
        )

    for key in (
        "specializations",
        "languages",
        "workingDays",
        "amenities",
    ):
        if key in draft and (
            not isinstance(draft[key], list)
            or not all(
                isinstance(item, str)
                for item in draft[key]
            )
        ):
            raise HTTPException(
                status_code=422,
                detail=f"{key} must be a list of strings.",
            )

    return draft


# ============================================================
# SYNCHRONIZE COMPLETED SECTIONS
# ============================================================

async def sync_completed(
    db: AsyncSession,
    account_id: uuid.UUID,
    completed: list[str],
) -> None:

    await db.execute(
        text("""
            UPDATE public.barber_applications
            SET completed_sections = CAST(:completed AS jsonb)
            WHERE barber_account_id = :account_id
              AND completed_sections IS DISTINCT FROM
                  CAST(:completed AS jsonb)
        """),
        {
            "account_id": account_id,
            "completed": json.dumps(completed),
        },
    )


# ============================================================
# SUPABASE DOCUMENT STORAGE
# ============================================================

def document_storage_config() -> tuple[str, str]:

    url = os.getenv(
        "SUPABASE_URL", ""
    ).strip().rstrip("/")

    key = os.getenv(
        "SUPABASE_SERVICE_ROLE_KEY", ""
    ).strip()

    if not url.startswith("https://") or not key:
        raise HTTPException(
            status_code=503,
            detail="Private document storage is not configured.",
        )

    return url, key


def document_storage_headers(
    key: str,
    content_type: str | None = None,
) -> dict[str, str]:

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }

    if content_type:
        headers["Content-Type"] = content_type
        headers["x-upsert"] = "false"

    return headers


async def put_document(
    client: httpx.AsyncClient,
    url: str,
    key: str,
    path: str,
    data: bytes,
    mime: str,
) -> None:

    try:
        response = await client.post(
            f"{url}/storage/v1/object/"
            f"{DOCUMENT_STORAGE_BUCKET}/"
            f"{quote(path, safe='/')}",
            headers=document_storage_headers(key, mime),
            content=data,
        )

        response.raise_for_status()

    except httpx.HTTPError as exc:
        logger.exception(
            "Private document upload failed for %s",
            path,
        )

        raise HTTPException(
            status_code=503,
            detail="Document storage upload failed.",
        ) from exc


async def remove_document(
    client: httpx.AsyncClient,
    url: str,
    key: str,
    path: str,
) -> None:

    try:
        response = await client.delete(
            f"{url}/storage/v1/object/"
            f"{DOCUMENT_STORAGE_BUCKET}",
            headers={
                **document_storage_headers(key),
                "Content-Type": "application/json",
            },
            json={"prefixes": [path]},
        )

        response.raise_for_status()

    except httpx.HTTPError:
        logger.exception(
            "Cannot clean up orphaned private document %s",
            path,
        )


def validate_document_file(
    content: bytes,
    mime: str,
) -> bool:

    if mime == "application/pdf":
        return content.startswith(b"%PDF-")

    if mime == "image/jpeg":
        return content.startswith(b"\xff\xd8\xff")

    if mime == "image/png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")

    if mime == "image/webp":
        return (
            len(content) >= 12
            and content[:4] == b"RIFF"
            and content[8:12] == b"WEBP"
        )

    return False


# ============================================================
# GET SAVED SHOP SETUP
# ============================================================

@router.get("")
async def get_shop_setup(
    current_user: dict = Depends(get_current_barber_payload),
    db: AsyncSession = Depends(get_db),
):

    account_id = barber_id(current_user)

    account = await load_account(db, account_id)

    application = await load_application(
        db,
        account_id,
    )

    active_workers = await worker_count(
        db,
        account_id,
    )

    result = response_data(
        application,
        account,
        active_workers,
    )

    if (
        application
        and application.get("completed_sections")
        != result["completed_sections"]
    ):
        await sync_completed(
            db,
            account_id,
            result["completed_sections"],
        )

        await db.commit()

    return result


# ============================================================
# SAVE OR UPDATE SHOP SETUP DRAFT
# ============================================================

@router.put("")
async def save_shop_setup(
    data: ShopSetupSave,
    current_user: dict = Depends(get_current_barber_payload),
    db: AsyncSession = Depends(get_db),
):

    account_id = barber_id(current_user)
    draft = draft_for_storage(data.setup_data)

    try:
        async with db.begin():

            account = await load_account(
                db,
                account_id,
            )

            existing = await load_application(
                db,
                account_id,
                lock=True,
            )

            # Prevent changes to already submitted/published records.
            # A separate validated editing workflow can be added later.
            if (
                existing
                and existing.get("setup_submission_status")
                in ("pending_review", "approved")
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Submitted or approved Shop Setup "
                        "cannot be edited."
                    ),
                )

            full_name = (
                clean(draft.get("fullName"))
                or account["username"]
            )

            phone = (
                clean(draft.get("phone"))
                or clean(account.get("shop_phone"))
            )

            shop_name = (
                clean(draft.get("shopName"))
                or clean(account.get("shop_name"))
            )

            shop_phone = (
                clean(draft.get("shopPhone"))
                or clean(account.get("shop_phone"))
                or phone
            )

            address = (
                clean(draft.get("address"))
                or clean(account.get("shop_address"))
            )

            if not shop_name:
                shop_name = "Shop Setup In Progress"

            if not phone:
                phone = "Not provided"

            if not address:
                address = "Address Pending"

            # Preserve coordinates for an unchanged Google Place.
            previous_draft = (
                (existing or {}).get("setup_data") or {}
            )

            if not isinstance(previous_draft, dict):
                previous_draft = {}

            previous_place_id = (
                clean(
                    (existing or {}).get("google_place_id")
                )
                or clean(
                    previous_draft.get("googlePlaceId")
                )
            )

            place_id = (
                clean(draft.get("googlePlaceId"))
                or previous_place_id
            )

            same_place = bool(
                place_id and place_id == previous_place_id
            )

            if same_place:
                draft["googlePlaceId"] = place_id

                if (
                    (existing or {}).get("latitude") is not None
                    and (existing or {}).get("longitude") is not None
                ):
                    draft["latitude"] = str(
                        existing["latitude"]
                    )

                    draft["longitude"] = str(
                        existing["longitude"]
                    )

                elif coordinates_valid(previous_draft):
                    draft["latitude"] = str(
                        previous_draft["latitude"]
                    )

                    draft["longitude"] = str(
                        previous_draft["longitude"]
                    )

            selected_coords = (
                (
                    float(draft["latitude"]),
                    float(draft["longitude"]),
                )
                if coordinates_valid(draft)
                else None
            )

            latitude = (
                selected_coords[0] if selected_coords else None
            )

            longitude = (
                selected_coords[1] if selected_coords else None
            )

            location_verified = bool(
                same_place
                and (existing or {}).get("location_verified")
                and selected_coords is not None
            )

            if (
                place_id
                and selected_coords
                and not location_verified
            ):
                verified_coords = await verify_google_place(
                    place_id,
                    clean(draft.get("address")),
                    selected_coords[0],
                    selected_coords[1],
                )

                if verified_coords is not None:
                    latitude, longitude = verified_coords

                    draft["latitude"] = str(latitude)
                    draft["longitude"] = str(longitude)

                    location_verified = True

                else:
                    logger.warning(
                        "Location saved but not yet verified "
                        "for barber %s, place %s",
                        account_id,
                        place_id,
                    )

            elif place_id and not selected_coords:
                logger.warning(
                    "Google Place ID exists without valid "
                    "coordinates for barber %s",
                    account_id,
                )

            documents = document_metadata(
                account.get("document_paths")
            )

            active_workers = await worker_count(
                db,
                account_id,
            )

            completed = sections_for(
                draft,
                documents,
                active_workers > 0,
                location_verified,
            )

            experience = number(
                draft.get("experience"),
                number(account.get("years_experience")),
            )

            if not 0 <= experience <= 80:
                raise HTTPException(
                    status_code=422,
                    detail="Experience must be between 0 and 80.",
                )

            opening_text = clean(
                draft.get("openingTime")
            )

            closing_text = clean(
                draft.get("closingTime")
            )

            try:
                opening = (
                    time.fromisoformat(opening_text)
                    if opening_text
                    else None
                )

                closing = (
                    time.fromisoformat(closing_text)
                    if closing_text
                    else None
                )

            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Invalid opening or closing time "
                        "format. Use HH:MM."
                    ),
                )

            chairs = max(
                1,
                number(draft.get("chairs"), 1),
            )

            if chairs > 10000:
                raise HTTPException(
                    status_code=422,
                    detail="Invalid chair capacity.",
                )

            result = await db.execute(
                text("""
                    INSERT INTO public.barber_applications (
                        barber_account_id,
                        full_name,
                        email,
                        phone,
                        experience_years,
                        shop_name,
                        shop_phone,
                        address,
                        city,
                        state,
                        pincode,
                        latitude,
                        longitude,
                        chair_count,
                        barber_count,
                        opening_time,
                        closing_time,
                        working_days,
                        document_paths,
                        setup_data,
                        completed_sections,
                        google_place_id,
                        location_verified,
                        setup_submission_status,
                        updated_at
                    )
                    VALUES (
                        :account_id,
                        :full_name,
                        :email,
                        :phone,
                        :experience,
                        :shop_name,
                        :shop_phone,
                        :address,
                        :city,
                        :state,
                        :pincode,
                        :latitude,
                        :longitude,
                        :chairs,
                        :barbers,
                        :opening,
                        :closing,
                        CAST(:working_days AS jsonb),
                        CAST(:documents AS jsonb),
                        CAST(:draft AS jsonb),
                        CAST(:completed AS jsonb),
                        :place_id,
                        :location_verified,
                        'draft',
                        now()
                    )
                    ON CONFLICT (barber_account_id)
                    WHERE barber_account_id IS NOT NULL
                    DO UPDATE SET
                        full_name = EXCLUDED.full_name,
                        email = EXCLUDED.email,
                        phone = EXCLUDED.phone,
                        experience_years = EXCLUDED.experience_years,
                        shop_name = EXCLUDED.shop_name,
                        shop_phone = EXCLUDED.shop_phone,
                        address = EXCLUDED.address,
                        city = EXCLUDED.city,
                        state = EXCLUDED.state,
                        pincode = EXCLUDED.pincode,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        chair_count = EXCLUDED.chair_count,
                        barber_count = EXCLUDED.barber_count,
                        opening_time = EXCLUDED.opening_time,
                        closing_time = EXCLUDED.closing_time,
                        working_days = EXCLUDED.working_days,
                        document_paths = EXCLUDED.document_paths,
                        setup_data = EXCLUDED.setup_data,
                        completed_sections = EXCLUDED.completed_sections,
                        google_place_id = EXCLUDED.google_place_id,
                        location_verified = EXCLUDED.location_verified,
                        setup_submission_status = 'draft',
                        rejection_reason = NULL,
                        updated_at = now()
                    RETURNING id
                """),
                {
                    "account_id": account_id,
                    "full_name": full_name,
                    "email": account["email"],
                    "phone": phone,
                    "experience": experience,
                    "shop_name": shop_name,
                    "shop_phone": shop_phone,
                    "address": address,
                    "city": clean(draft.get("city")) or None,
                    "state": clean(draft.get("state")) or None,
                    "pincode": clean(draft.get("pincode")) or None,
                    "latitude": latitude,
                    "longitude": longitude,
                    "chairs": chairs,
                    "barbers": max(1, active_workers),
                    "opening": opening,
                    "closing": closing,
                    "working_days": json.dumps(
                        draft.get("workingDays", [])
                    ),
                    "documents": json.dumps(documents),
                    "draft": json.dumps(draft),
                    "completed": json.dumps(completed),
                    "place_id": place_id or None,
                    "location_verified": location_verified,
                },
            )

            application_id = result.scalar_one()

            application = await load_application(
                db,
                account_id,
            )

            if (
                not application
                or application["id"] != application_id
            ):
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Shop Setup could not be reloaded "
                        "after saving."
                    ),
                )

            output = response_data(
                application,
                account,
                active_workers,
            )

        return output

    except HTTPException:
        raise

    except Exception:
        logger.exception(
            "Shop Setup save failed for barber %s",
            account_id,
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Unable to save Shop Setup. "
                "Check backend logs."
            ),
        )


# ============================================================
# UPLOAD SHOP SETUP DOCUMENT
# ============================================================

@router.post("/documents")
async def upload_shop_setup_document(
    document_type: str = Form(...),
    document: UploadFile = File(...),
    current_user: dict = Depends(get_current_barber_payload),
    db: AsyncSession = Depends(get_db),
):

    account_id = barber_id(current_user)

    if document_type not in DOCUMENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail="Unsupported document type.",
        )

    content_type = (
        document.content_type or ""
    ).lower()

    if content_type not in ALLOWED_UPLOAD_TYPES:
        raise HTTPException(
            status_code=422,
            detail=(
                "Only PDF, JPG, PNG and WebP "
                "documents are allowed."
            ),
        )

    try:
        content = await document.read(
            MAX_DOCUMENT_SIZE + 1
        )
    finally:
        await document.close()

    if not content:
        raise HTTPException(
            status_code=422,
            detail="Document cannot be empty.",
        )

    if len(content) > MAX_DOCUMENT_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Document must not exceed 5 MB.",
        )

    if not validate_document_file(
        content,
        content_type,
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "The file contents do not match "
                "its declared type."
            ),
        )

    safe_original_name = Path(
        (
            document.filename or "document"
        ).replace("\\", "/")
    ).name[:180]

    generated_name = (
        f"{uuid.uuid4().hex}"
        f"{ALLOWED_UPLOAD_TYPES[content_type]}"
    )

    object_path = (
        f"barbers/{account_id}/documents/"
        f"{generated_name}"
    )

    metadata = {
        "path": object_path,
        "original_name": safe_original_name,
        "content_type": content_type,
        "size": len(content),
        "document_type": document_type,
    }

    storage_url, service_key = document_storage_config()

    uploaded = False
    committed = False

    async with httpx.AsyncClient(timeout=45.0) as client:

        try:
            async with db.begin():

                account = await load_account(
                    db,
                    account_id,
                    lock=True,
                )

                existing = await load_application(
                    db,
                    account_id,
                    lock=True,
                )

                if (
                    existing
                    and existing.get("setup_submission_status")
                    in ("pending_review", "approved")
                ):
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Documents cannot be changed "
                            "during or after shop publication."
                        ),
                    )

                documents = document_metadata(
                    account.get("document_paths")
                )

                if len(documents) >= MAX_DOCUMENTS:
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            "Maximum number of registration "
                            "and setup documents reached."
                        ),
                    )

                await put_document(
                    client=client,
                    url=storage_url,
                    key=service_key,
                    path=object_path,
                    data=content,
                    mime=content_type,
                )

                uploaded = True
                documents.append(metadata)

                await db.execute(
                    text("""
                        UPDATE public.barber_accounts
                        SET document_paths =
                                CAST(:documents AS jsonb),
                            updated_at = now()
                        WHERE id = :account_id
                    """),
                    {
                        "documents": json.dumps(documents),
                        "account_id": account_id,
                    },
                )

                if existing:
                    draft = existing.get("setup_data") or {}

                    if not isinstance(draft, dict):
                        draft = {}

                    active_workers = await worker_count(
                        db,
                        account_id,
                    )

                    completed = sections_for(
                        draft,
                        documents,
                        active_workers > 0,
                        bool(
                            existing.get("location_verified")
                        ),
                    )

                    await db.execute(
                        text("""
                            UPDATE public.barber_applications
                            SET document_paths =
                                    CAST(:documents AS jsonb),
                                completed_sections =
                                    CAST(:completed AS jsonb),
                                updated_at = now()
                            WHERE barber_account_id = :account_id
                        """),
                        {
                            "documents": json.dumps(documents),
                            "completed": json.dumps(completed),
                            "account_id": account_id,
                        },
                    )

            committed = True

            logger.info(
                "Shop Setup document saved in private "
                "Storage: barber=%s path=%s",
                account_id,
                object_path,
            )

            return {
                "message": "Document uploaded successfully.",
                "document": metadata,
                "registration_documents": documents,
            }

        except HTTPException:
            if uploaded and not committed:
                await remove_document(
                    client,
                    storage_url,
                    service_key,
                    object_path,
                )
            raise

        except Exception:
            if uploaded and not committed:
                await remove_document(
                    client,
                    storage_url,
                    service_key,
                    object_path,
                )

            logger.exception(
                "Shop Setup document upload failed "
                "for barber %s",
                account_id,
            )

            raise HTTPException(
                status_code=500,
                detail=(
                    "Unable to upload document. "
                    "Check backend logs."
                ),
            )


# ============================================================
# PUBLISH SHOP DIRECTLY
#
# POST /shop-setup/submit
#
# NEW FLOW:
# 1. Admin approves barber account.
# 2. Barber activates email.
# 3. Barber completes shop setup.
# 4. Backend validates all sections and Google location.
# 5. Shop is published immediately.
# 6. No second Admin approval is required.
# ============================================================

@router.post("/submit")
async def submit_shop_setup(
    current_user: dict = Depends(get_current_barber_payload),
    db: AsyncSession = Depends(get_db),
):

    account_id = barber_id(current_user)

    try:
        async with db.begin():

            # Admin account approval and email activation
            # are still checked here.
            account = await load_account(
                db,
                account_id,
            )

            application = await load_application(
                db,
                account_id,
                lock=True,
            )

            if not application:
                raise HTTPException(
                    status_code=404,
                    detail=(
                        "Save your Shop Setup "
                        "before publishing."
                    ),
                )

            current_status = application.get(
                "setup_submission_status"
            )

            # Already published: return existing state.
            # This makes repeated requests safe.
            if (
                current_status == "approved"
                and application.get("published_at")
            ):
                active_workers = await worker_count(
                    db,
                    account_id,
                )

                return response_data(
                    application,
                    account,
                    active_workers,
                )

            # Include pending_review to support shops
            # submitted under the previous workflow.
            allowed_statuses = (
                "draft",
                "rejected",
                "pending_review",
                "approved",
            )

            if current_status not in allowed_statuses:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "This Shop Setup cannot be published "
                        "in its current state."
                    ),
                )

            active_workers = await worker_count(
                db,
                account_id,
            )

            draft = application.get("setup_data") or {}

            if not isinstance(draft, dict):
                draft = {}

            documents = document_metadata(
                account.get("document_paths")
            )

            completed = sections_for(
                draft,
                documents,
                active_workers > 0,
                bool(
                    application.get("location_verified")
                ),
            )

            missing = [
                section
                for section in SECTIONS
                if section not in completed
            ]

            if missing:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "message": (
                            "Complete all required Shop "
                            "Setup sections before publishing."
                        ),
                        "missing_sections": missing,
                    },
                )

            if not application.get("location_verified"):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Verify your Google Maps shop "
                        "location before publishing."
                    ),
                )

            # Atomic publication in Supabase PostgreSQL.
            #
            # Do not modify the separate status column:
            # its existing constraints and consumers may
            # have different semantics.
            result = await db.execute(
                text("""
                    UPDATE public.barber_applications
                    SET
                        setup_submission_status = 'approved',

                        submitted_at = COALESCE(
                            submitted_at,
                            now()
                        ),

                        published_at = COALESCE(
                            published_at,
                            now()
                        ),

                        completed_sections =
                            CAST(:completed AS jsonb),

                        rejection_reason = NULL,

                        updated_at = now()

                    WHERE id = :application_id
                      AND barber_account_id = :account_id
                      AND setup_submission_status IN (
                          'draft',
                          'rejected',
                          'pending_review',
                          'approved'
                      )

                    RETURNING id
                """),
                {
                    "application_id": application["id"],
                    "account_id": account_id,
                    "completed": json.dumps(completed),
                },
            )

            if result.scalar_one_or_none() is None:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Shop Setup changed before publishing. "
                        "Refresh and retry."
                    ),
                )

            updated = await load_application(
                db,
                account_id,
            )

            # Never report success without confirming
            # the updated database record.
            if (
                not updated
                or updated.get("setup_submission_status")
                != "approved"
                or not updated.get("published_at")
            ):
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Shop publication could not "
                        "be confirmed."
                    ),
                )

            output = response_data(
                updated,
                account,
                active_workers,
            )

        logger.info(
            "Shop published successfully for barber %s",
            account_id,
        )

        return output

    except HTTPException:
        raise

    except Exception:
        logger.exception(
            "Shop publication failed for barber %s",
            account_id,
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Unable to publish Shop Setup. "
                "Check backend logs."
            ),
        )