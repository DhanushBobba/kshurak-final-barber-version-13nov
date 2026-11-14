
"""
KSHURAK Customer Barber Discovery API.

Returns real, approved and published barber shops
from Supabase PostgreSQL.

Includes signed shop-image URLs for private Supabase Storage.

Default radius: 15 km.
Maximum radius: 15 km.

No simulated shops, hardcoded coordinates,
or exposed Supabase service-role credentials.
"""

import asyncio
import logging
import math
import os

from typing import Annotated
from urllib.parse import quote, urljoin, urlsplit
from uuid import UUID

import httpx

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db


logger = logging.getLogger("kshurak.customer.discovery")

router = APIRouter(
    prefix="/api/v1/customer/barbers",
    tags=["Customer Barber Discovery"],
)

EARTH_RADIUS_KM = 6371.0088
DEFAULT_RADIUS_KM = 15.0
MAX_RADIUS_KM = 15.0

# Same bucket used by Barber Registration.
SHOP_IMAGE_BUCKET = "shop-images"

IMAGE_URL_EXPIRY_SECONDS = 3600
MAX_CONCURRENT_IMAGE_REQUESTS = 8

# ============================================================
# RESPONSE SCHEMAS
# ============================================================

class LocationResponse(BaseModel):
    lat: float
    lng: float


class NearbyBarberResponse(BaseModel):
    barberId: UUID

    shopName: str
    shopType: str | None = None
    description: str | None = None

    address: str
    city: str | None = None
    state: str | None = None
    pincode: str | None = None

    latitude: float
    longitude: float

    distanceKm: float = Field(ge=0)

    shopPhone: str | None = None

    # Existing field, retained for compatibility.
    shopImagePath: str | None = None

    # New browser-displayable image URL.
    shopImageUrl: str | None = None

    openingTime: str | None = None
    closingTime: str | None = None

    workingDays: list[str] = Field(default_factory=list)
    amenities: list[str] = Field(default_factory=list)
    specializations: list[str] = Field(default_factory=list)

    locationVerified: bool = True


class NearbyBarbersListResponse(BaseModel):
    center: LocationResponse
    radiusKm: float
    count: int
    shops: list[NearbyBarberResponse]


# ============================================================
# DISTANCE HELPERS
# ============================================================

def distance_km(
    lat1: float,
    lng1: float,
    lat2: float,
    lng2: float,
) -> float:
    """Haversine distance in kilometres."""

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)

    delta_lat = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad)
        * math.cos(lat2_rad)
        * math.sin(delta_lng / 2) ** 2
    )

    a = min(1.0, max(0.0, a))

    return (
        2
        * EARTH_RADIUS_KM
        * math.asin(math.sqrt(a))
    )


# ============================================================
# DATA HELPERS
# ============================================================

def safe_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []

    return [
        item.strip()
        for item in value
        if isinstance(item, str) and item.strip()
    ]


def safe_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None

    cleaned = value.strip()

    return cleaned or None


def safe_coordinate(
    value: object,
    minimum: float,
    maximum: float,
) -> float | None:
    try:
        if isinstance(value, bool):
            return None

        number = float(value)

        if (
            math.isfinite(number)
            and minimum <= number <= maximum
        ):
            return number

    except (
        TypeError,
        ValueError,
        OverflowError,
    ):
        pass

    return None


def format_db_time(value: object) -> str | None:
    if value is None:
        return None

    if hasattr(value, "strftime"):
        return value.strftime("%H:%M")

    if isinstance(value, str):
        return value[:5]

    return None


# ============================================================
# SUPABASE IMAGE CONFIGURATION
# ============================================================

def image_storage_config() -> tuple[str, str, str] | None:
    """
    Server-only configuration.

    SHOP_IMAGE_BUCKET must match the bucket used
    when Barber Registration uploads the shop image.

    Never send the service-role key to the frontend.
    """

    supabase_url = os.getenv(
        "SUPABASE_URL", ""
    ).strip().rstrip("/")

    service_key = os.getenv(
        "SUPABASE_SERVICE_ROLE_KEY", ""
    ).strip()

    bucket = SHOP_IMAGE_BUCKET.strip()

    if (
        not supabase_url.startswith("https://")
        or not service_key
        or not bucket
    ):
        logger.warning(
            "Shop image signing is not configured. "
            "Check SUPABASE_URL, "
            "SUPABASE_SERVICE_ROLE_KEY, "
            "and SHOP_IMAGE_BUCKET."
        )

        return None

    return supabase_url, service_key, bucket


def safe_storage_path(
    value: object,
    barber_id: UUID,
) -> str | None:
    """
    Only sign a stored image path belonging to
    the requested barber.

    Avoid accepting arbitrary external URLs or
    paths belonging to other accounts.
    """

    path = safe_text(value)

    if not path:
        return None

    if (
        "://" in path
        or path.startswith("/")
        or "\\" in path
        or "?" in path
        or "#" in path
    ):
        return None

    parts = path.split("/")

    if any(
        part in ("", ".", "..")
        for part in parts
    ):
        return None

    expected_prefix = f"barbers/{barber_id}/shop/"

    if not path.startswith(expected_prefix):
        logger.warning(
            "Unexpected shop image path for barber %s",
            barber_id,
        )
        return None

    return path


# ============================================================
# GENERATE SIGNED SHOP IMAGE URL
# ============================================================

async def create_signed_shop_image_url(
    client: httpx.AsyncClient,
    image_path: str,
    storage_config: tuple[str, str, str],
) -> str | None:
    """
    Generate a temporary URL for a private
    Supabase Storage image.

    Signing happens server-side.
    """

    supabase_url, service_key, bucket = storage_config

    encoded_bucket = quote(bucket, safe="")
    encoded_path = quote(image_path, safe="/")

    sign_endpoint = (
        f"{supabase_url}/storage/v1/object/sign/"
        f"{encoded_bucket}/{encoded_path}"
    )

    try:
        response = await client.post(
            sign_endpoint,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            },
            json={
                "expiresIn": IMAGE_URL_EXPIRY_SECONDS,
            },
        )

        response.raise_for_status()

        payload = response.json()

        signed_url = payload.get("signedURL")

        if not isinstance(signed_url, str) or not signed_url:
            logger.warning(
                "Supabase did not return a signed image URL."
            )
            return None

        # A legitimate Supabase signed URL is normally
        # a relative /object/sign/... URL.
        # Resolve it against this Supabase project.
        parsed = urlsplit(signed_url)

        if parsed.scheme or parsed.netloc:
            base = urlsplit(supabase_url)

            if (
                parsed.scheme != "https"
                or parsed.netloc != base.netloc
            ):
                logger.warning(
                    "Unexpected image signing response origin."
                )
                return None

            return signed_url

        if signed_url.startswith("//"):
            return None

        return urljoin(
            f"{supabase_url}/storage/v1/",
            signed_url.lstrip("/")
            if not signed_url.startswith("/")
            else signed_url.replace(
                "/storage/v1/", "", 1
            ).lstrip("/")
        ) if not signed_url.startswith("/storage/v1/") else (
            supabase_url + signed_url
        )

    except (httpx.HTTPError, ValueError, TypeError):
        logger.warning(
            "Unable to create shop image signed URL.",
            exc_info=True,
        )

        return None


# ============================================================
# REAL NEARBY BARBERS
# ============================================================

@router.get(
    "/nearby",
    response_model=NearbyBarbersListResponse,
)
async def get_nearby_barbers(
    lat: Annotated[
        float,
        Query(
            ge=-90,
            le=90,
            allow_inf_nan=False,
            description="Customer selected latitude",
        ),
    ],
    lng: Annotated[
        float,
        Query(
            ge=-180,
            le=180,
            allow_inf_nan=False,
            description="Customer selected longitude",
        ),
    ],
    db: AsyncSession = Depends(get_db),
    radius_km: Annotated[
        float,
        Query(
            ge=0.5,
            le=MAX_RADIUS_KM,
            allow_inf_nan=False,
            description="Discovery radius in kilometres",
        ),
    ] = DEFAULT_RADIUS_KM,
):
    """
    Return real, approved and published shops
    within the selected radius.

    Image signing failures do not block discovery.
    """

    query = text(
        """
        SELECT
            ba.id AS barber_id,

            COALESCE(
                NULLIF(ba.shop_name, ''),
                app.shop_name
            ) AS shop_name,

            ba.shop_phone,
            ba.shop_image_path,

            app.address,
            app.city,
            app.state,
            app.pincode,

            app.latitude,
            app.longitude,

            app.opening_time,
            app.closing_time,
            app.working_days,
            app.setup_data

        FROM public.barber_accounts AS ba

        INNER JOIN public.barber_applications AS app
            ON app.barber_account_id = ba.id

        WHERE LOWER(ba.approval_status) = 'approved'

          AND ba.is_email_activated = TRUE

          AND app.location_verified = TRUE

          AND LOWER(app.setup_submission_status) = 'approved'

          AND app.published_at IS NOT NULL

          AND app.latitude IS NOT NULL
          AND app.longitude IS NOT NULL

          AND app.latitude BETWEEN -90 AND 90
          AND app.longitude BETWEEN -180 AND 180

        ORDER BY
            app.published_at DESC,
            ba.id
        """
    )

    try:
        result = await db.execute(query)

        rows = result.mappings().all()

    except SQLAlchemyError as exc:
        logger.exception(
            "Customer barber discovery query failed"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Nearby barber discovery is "
                "temporarily unavailable."
            ),
        ) from exc

    shops: list[NearbyBarberResponse] = []

    # Only images belonging to shops in the selected
    # search radius are signed.
    image_paths: dict[UUID, str] = {}

    for row in rows:
        shop_lat = safe_coordinate(
            row["latitude"],
            -90,
            90,
        )

        shop_lng = safe_coordinate(
            row["longitude"],
            -180,
            180,
        )

        if shop_lat is None or shop_lng is None:
            continue

        distance = distance_km(
            lat,
            lng,
            shop_lat,
            shop_lng,
        )

        if distance > radius_km:
            continue

        setup_data = row["setup_data"]

        if not isinstance(setup_data, dict):
            setup_data = {}

        barber_id = row["barber_id"]

        image_path = safe_storage_path(
            row["shop_image_path"],
            barber_id,
        )

        if image_path:
            image_paths[barber_id] = image_path

        shops.append(
            NearbyBarberResponse(
                barberId=barber_id,

                shopName=row["shop_name"],

                shopType=safe_text(
                    setup_data.get("shopType")
                ),

                description=safe_text(
                    setup_data.get("description")
                ),

                address=row["address"],
                city=row["city"],
                state=row["state"],
                pincode=row["pincode"],

                latitude=shop_lat,
                longitude=shop_lng,

                distanceKm=round(distance, 2),

                shopPhone=row["shop_phone"],

                shopImagePath=row["shop_image_path"],

                shopImageUrl=None,

                openingTime=format_db_time(
                    row["opening_time"]
                ),

                closingTime=format_db_time(
                    row["closing_time"]
                ),

                workingDays=safe_string_list(
                    row["working_days"]
                ),

                amenities=safe_string_list(
                    setup_data.get("amenities")
                ),

                specializations=safe_string_list(
                    setup_data.get("specializations")
                ),
            )
        )

    shops.sort(
        key=lambda shop: (
            shop.distanceKm,
            shop.shopName.lower(),
            str(shop.barberId),
        )
    )

    # ========================================================
    # RESOLVE PRIVATE SHOP IMAGES
    # ========================================================

    storage_config = image_storage_config()

    if storage_config and image_paths:
        semaphore = asyncio.Semaphore(
            MAX_CONCURRENT_IMAGE_REQUESTS
        )

        async with httpx.AsyncClient(
            timeout=15.0
        ) as client:

            async def sign_shop_image(
                shop: NearbyBarberResponse,
            ) -> None:
                path = image_paths.get(shop.barberId)

                if not path:
                    return

                async with semaphore:
                    shop.shopImageUrl = (
                        await create_signed_shop_image_url(
                            client,
                            path,
                            storage_config,
                        )
                    )

            await asyncio.gather(
                *[
                    sign_shop_image(shop)
                    for shop in shops
                    if shop.barberId in image_paths
                ]
            )

    return NearbyBarbersListResponse(
        center=LocationResponse(
            lat=lat,
            lng=lng,
        ),

        radiusKm=radius_km,

        count=len(shops),

        shops=shops,
    )
