
"""
KSHURAK Barber Services Management API.

Each approved barber can:
- Add services to their own shop.
- List their services.
- Update service information.
- Activate or deactivate services.

Services are owned by the authenticated barber.
No barber IDs are accepted from request bodies.

Database:
    public.barber_services
"""

import logging
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.barber.api.barber_workers import get_approved_barber


logger = logging.getLogger("kshurak.barber.services")

router = APIRouter(
    prefix="/api/v1/barber/services",
    tags=["Barber Services"],
)


# ============================================================
# SCHEMAS
# ============================================================

class ServiceCreateRequest(BaseModel):
    service_name: str = Field(
        min_length=1,
        max_length=150,
    )

    description: str | None = Field(
        default=None,
        max_length=2000,
    )

    duration_minutes: int = Field(
        ge=5,
        le=480,
    )

    price: Decimal = Field(
        ge=0,
        max_digits=12,
        decimal_places=2,
    )

    @field_validator("service_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        cleaned = value.strip()

        if not cleaned:
            raise ValueError("Service name is required.")

        return cleaned

    @field_validator("description")
    @classmethod
    def clean_description(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        return value.strip() or None


class ServiceUpdateRequest(BaseModel):
    service_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=150,
    )

    description: str | None = Field(
        default=None,
        max_length=2000,
    )

    duration_minutes: int | None = Field(
        default=None,
        ge=5,
        le=480,
    )

    price: Decimal | None = Field(
        default=None,
        ge=0,
        max_digits=12,
        decimal_places=2,
    )

    is_active: bool | None = None

    @field_validator("service_name")
    @classmethod
    def validate_name(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        cleaned = value.strip()

        if not cleaned:
            raise ValueError("Service name cannot be empty.")

        return cleaned

    @field_validator("description")
    @classmethod
    def clean_description(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        return value.strip() or None


class ServiceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    barber_id: UUID

    service_name: str
    description: str | None = None

    duration_minutes: int
    price: Decimal

    is_active: bool

    created_at: object
    updated_at: object


class ServiceListResponse(BaseModel):
    services: list[ServiceResponse]
    total: int


class ServiceActionResponse(BaseModel):
    message: str
    service: ServiceResponse


# ============================================================
# AUTHENTICATED BARBER ID
# ============================================================

def authenticated_barber_id(barber: UUID | object) -> UUID:
    if isinstance(barber, UUID):
        return barber

    raw_id = getattr(barber, "id", None)

    if raw_id is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid barber authentication context.",
        )

    try:
        return UUID(str(raw_id))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid barber authentication context.",
        ) from exc


def service_from_row(row: object) -> ServiceResponse:
    return ServiceResponse.model_validate(dict(row))


# ============================================================
# GET A SERVICE BELONGING TO THIS BARBER
# ============================================================

async def get_owned_service(
    db: AsyncSession,
    barber_id: UUID,
    service_id: UUID,
) -> ServiceResponse:
    result = await db.execute(
        text("""
            SELECT *
            FROM public.barber_services
            WHERE id = :service_id
              AND barber_id = :barber_id
        """),
        {
            "service_id": service_id,
            "barber_id": barber_id,
        },
    )

    row = result.mappings().first()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Service not found for this barber.",
        )

    return service_from_row(row)


# ============================================================
# LIST SERVICES
# ============================================================

@router.get(
    "",
    response_model=ServiceListResponse,
)
async def list_services(
    barber: Annotated[
        UUID,
        Depends(get_approved_barber),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
    active_only: bool = False,
):
    barber_id = authenticated_barber_id(barber)

    try:
        result = await db.execute(
            text("""
                SELECT *
                FROM public.barber_services
                WHERE barber_id = :barber_id
                  AND (
                      :active_only = FALSE
                      OR is_active = TRUE
                  )
                ORDER BY
                    is_active DESC,
                    service_name ASC,
                    id ASC
            """),
            {
                "barber_id": barber_id,
                "active_only": active_only,
            },
        )

        services = [
            service_from_row(row)
            for row in result.mappings().all()
        ]

        return ServiceListResponse(
            services=services,
            total=len(services),
        )

    except SQLAlchemyError as exc:
        logger.exception(
            "Failed to load services for barber %s",
            barber_id,
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to load barber services.",
        ) from exc


# ============================================================
# CREATE SERVICE
# ============================================================

@router.post(
    "",
    response_model=ServiceActionResponse,
    status_code=201,
)
async def create_service(
    payload: ServiceCreateRequest,
    barber: Annotated[
        UUID,
        Depends(get_approved_barber),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
):
    barber_id = authenticated_barber_id(barber)

    try:
        result = await db.execute(
            text("""
                INSERT INTO public.barber_services (
                    barber_id,
                    service_name,
                    description,
                    duration_minutes,
                    price,
                    is_active
                )
                VALUES (
                    :barber_id,
                    :service_name,
                    :description,
                    :duration_minutes,
                    :price,
                    TRUE
                )
                RETURNING *
            """),
            {
                "barber_id": barber_id,
                "service_name": payload.service_name,
                "description": payload.description,
                "duration_minutes": payload.duration_minutes,
                "price": payload.price,
            },
        )

        row = result.mappings().one()
        service = service_from_row(row)

        await db.commit()

        logger.info(
            "Created service %s for barber %s",
            service.id,
            barber_id,
        )

        return ServiceActionResponse(
            message="Service added successfully.",
            service=service,
        )

    except IntegrityError as exc:
        await db.rollback()

        raise HTTPException(
            status_code=409,
            detail=(
                "A service with this name already exists "
                "for your shop, or the service violates "
                "a database constraint."
            ),
        ) from exc

    except SQLAlchemyError as exc:
        await db.rollback()

        logger.exception(
            "Unable to create service for barber %s",
            barber_id,
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to create service.",
        ) from exc


# ============================================================
# GET INDIVIDUAL SERVICE
# ============================================================

@router.get(
    "/{service_id}",
    response_model=ServiceResponse,
)
async def get_service(
    service_id: UUID,
    barber: Annotated[
        UUID,
        Depends(get_approved_barber),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
):
    barber_id = authenticated_barber_id(barber)

    try:
        return await get_owned_service(
            db,
            barber_id,
            service_id,
        )

    except SQLAlchemyError as exc:
        logger.exception("Unable to retrieve service")

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve service.",
        ) from exc


# ============================================================
# UPDATE SERVICE
# ============================================================

@router.patch(
    "/{service_id}",
    response_model=ServiceActionResponse,
)
async def update_service(
    service_id: UUID,
    payload: ServiceUpdateRequest,
    barber: Annotated[
        UUID,
        Depends(get_approved_barber),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
):
    barber_id = authenticated_barber_id(barber)

    updates = payload.model_dump(
        exclude_unset=True,
    )

    if not updates:
        raise HTTPException(
            status_code=422,
            detail="Provide at least one field to update.",
        )

    # Prevent required fields being set to NULL.
    required_fields = {
        "service_name",
        "duration_minutes",
        "price",
        "is_active",
    }

    for field in required_fields:
        if field in updates and updates[field] is None:
            raise HTTPException(
                status_code=422,
                detail=f"{field} cannot be null.",
            )

    try:
        assignments = []
        parameters = {
            "service_id": service_id,
            "barber_id": barber_id,
        }

        for field, value in updates.items():
            assignments.append(f"{field} = :{field}")
            parameters[field] = value

        assignments.append("updated_at = NOW()")

        update_clause = ", ".join(assignments)

        result = await db.execute(
            text(f"""
                UPDATE public.barber_services
                SET {update_clause}
                WHERE id = :service_id
                  AND barber_id = :barber_id
                RETURNING *
            """),
            parameters,
        )

        row = result.mappings().first()

        if row is None:
            await db.rollback()

            raise HTTPException(
                status_code=404,
                detail="Service not found for this barber.",
            )

        service = service_from_row(row)

        await db.commit()

        return ServiceActionResponse(
            message="Service updated successfully.",
            service=service,
        )

    except HTTPException:
        raise

    except IntegrityError as exc:
        await db.rollback()

        raise HTTPException(
            status_code=409,
            detail=(
                "Unable to update service. "
                "A service with this name may "
                "already exist for your shop."
            ),
        ) from exc

    except SQLAlchemyError as exc:
        await db.rollback()

        logger.exception(
            "Unable to update service %s",
            service_id,
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to update service.",
        ) from exc


# ============================================================
# ACTIVATE / DEACTIVATE SERVICE
# ============================================================

@router.patch(
    "/{service_id}/status",
    response_model=ServiceActionResponse,
)
async def change_service_status(
    service_id: UUID,
    barber: Annotated[
        UUID,
        Depends(get_approved_barber),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
    is_active: Annotated[
        bool,
        Query(description="Whether the service is active"),
    ],
):
    barber_id = authenticated_barber_id(barber)

    try:
        result = await db.execute(
            text("""
                UPDATE public.barber_services
                SET
                    is_active = :is_active,
                    updated_at = NOW()
                WHERE id = :service_id
                  AND barber_id = :barber_id
                RETURNING *
            """),
            {
                "service_id": service_id,
                "barber_id": barber_id,
                "is_active": is_active,
            },
        )

        row = result.mappings().first()

        if row is None:
            await db.rollback()

            raise HTTPException(
                status_code=404,
                detail="Service not found for this barber.",
            )

        service = service_from_row(row)

        await db.commit()

        return ServiceActionResponse(
            message=(
                "Service activated successfully."
                if is_active
                else "Service deactivated successfully."
            ),
            service=service,
        )

    except HTTPException:
        raise

    except SQLAlchemyError as exc:
        await db.rollback()

        logger.exception(
            "Unable to change status of service %s",
            service_id,
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to update service status.",
        ) from exc
