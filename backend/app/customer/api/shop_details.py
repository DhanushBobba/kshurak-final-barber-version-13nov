
"""
KSHURAK Customer Shop Details API.

Customer-facing endpoint to fetch:
- One approved and published barber shop
- Active services with prices and durations
- Active workers with their shift timings

This endpoint does not:
- Expose worker phone numbers
- Expose private customer information
- Generate simulated appointment slots
- Create bookings

Database:
    public.barber_accounts
    public.barber_applications
    public.barber_services
    public.barber_workers
"""

import logging
from datetime import time
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db


logger = logging.getLogger("kshurak.customer.shop_details")

router = APIRouter(
    prefix="/api/v1/customer/barbers",
    tags=["Customer Shop Details"],
)


# ============================================================
# RESPONSE SCHEMAS
# ============================================================

class CustomerShopService(BaseModel):
    id: UUID
    service_name: str
    description: str | None = None
    duration_minutes: int
    price: Decimal


class CustomerShopWorker(BaseModel):
    id: UUID
    full_name: str
    role: str
    years_experience: int
    specializations: str | None = None
    shift_start: time
    shift_end: time


class CustomerShopInfo(BaseModel):
    barberId: UUID
    shopName: str
    description: str | None = None

    address: str
    city: str | None = None
    state: str | None = None
    pincode: str | None = None

    shopPhone: str | None = None

    openingTime: time | None = None
    closingTime: time | None = None

    workingDays: list[str] = Field(default_factory=list)

    locationVerified: bool


class ShopDetailsResponse(BaseModel):
    shop: CustomerShopInfo

    services: list[CustomerShopService]
    workers: list[CustomerShopWorker]

    totalServices: int
    totalWorkers: int


# ============================================================
# HELPERS
# ============================================================

def normalize_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []

    return [
        item.strip()
        for item in value
        if isinstance(item, str) and item.strip()
    ]


def normalize_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None

    return value.strip() or None


# ============================================================
# CUSTOMER SHOP DETAILS
# ============================================================

@router.get(
    "/{barber_id}/details",
    response_model=ShopDetailsResponse,
)
async def get_customer_shop_details(
    barber_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Return one verified, approved and published shop,
    together with its active services and workers.

    The barber_id is the account ID already returned
    by the customer nearby-shop discovery endpoint.
    """

    shop_query = text(
        """
        SELECT
            ba.id AS barber_id,

            COALESCE(
                NULLIF(ba.shop_name, ''),
                app.shop_name
            ) AS shop_name,

            ba.shop_phone,

            app.address,
            app.city,
            app.state,
            app.pincode,

            app.opening_time,
            app.closing_time,
            app.working_days,

            app.location_verified,
            app.setup_data

        FROM public.barber_accounts AS ba

        INNER JOIN public.barber_applications AS app
            ON app.barber_account_id = ba.id

        WHERE ba.id = :barber_id

          AND LOWER(ba.approval_status) = 'approved'

          AND ba.is_email_activated = TRUE

          AND app.location_verified = TRUE

          AND LOWER(app.setup_submission_status) = 'approved'

          AND app.published_at IS NOT NULL

        ORDER BY app.published_at DESC

        LIMIT 1
        """
    )

    services_query = text(
        """
        SELECT
            id,
            service_name,
            description,
            duration_minutes,
            price

        FROM public.barber_services

        WHERE barber_id = :barber_id
          AND is_active = TRUE

        ORDER BY service_name ASC, id ASC
        """
    )

    workers_query = text(
        """
        SELECT
            id,
            full_name,
            role,
            years_experience,
            specializations,
            shift_start,
            shift_end

        FROM public.barber_workers

        WHERE barber_id = :barber_id
          AND is_active = TRUE

        ORDER BY full_name ASC, id ASC
        """
    )

    try:
        shop_result = await db.execute(
            shop_query,
            {"barber_id": barber_id},
        )

        shop_row = shop_result.mappings().first()

        if shop_row is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Shop not found or not available "
                    "for customer bookings."
                ),
            )

        services_result = await db.execute(
            services_query,
            {"barber_id": barber_id},
        )

        workers_result = await db.execute(
            workers_query,
            {"barber_id": barber_id},
        )

        service_rows = services_result.mappings().all()
        worker_rows = workers_result.mappings().all()

    except HTTPException:
        raise

    except SQLAlchemyError as exc:
        logger.exception(
            "Unable to retrieve customer shop details "
            "for barber %s",
            barber_id,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Shop details are temporarily unavailable."
            ),
        ) from exc

    setup_data = shop_row["setup_data"]

    if not isinstance(setup_data, dict):
        setup_data = {}

    shop_description = normalize_text(
        setup_data.get("description")
    )

    shop = CustomerShopInfo(
        barberId=shop_row["barber_id"],
        shopName=shop_row["shop_name"],
        description=shop_description,
        address=shop_row["address"],
        city=shop_row["city"],
        state=shop_row["state"],
        pincode=shop_row["pincode"],
        shopPhone=shop_row["shop_phone"],
        openingTime=shop_row["opening_time"],
        closingTime=shop_row["closing_time"],
        workingDays=normalize_string_list(
            shop_row["working_days"]
        ),
        locationVerified=bool(
            shop_row["location_verified"]
        ),
    )

    services = [
        CustomerShopService.model_validate(
            dict(row)
        )
        for row in service_rows
    ]

    workers = [
        CustomerShopWorker.model_validate(
            dict(row)
        )
        for row in worker_rows
    ]

    return ShopDetailsResponse(
        shop=shop,
        services=services,
        workers=workers,
        totalServices=len(services),
        totalWorkers=len(workers),
    )
