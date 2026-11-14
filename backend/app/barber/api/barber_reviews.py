
"""
KSHURAK - Barber Reviews API

Features:
- View only the authenticated barber's reviews
- Search, filter, sort and paginate reviews
- Retrieve real rating statistics and distribution
- Reply to customer reviews
- Edit an existing barber reply

Database:
    public.barber_reviews
    public.barber_bookings

Important:
    Customers create ratings through the Customer Backend.
    Barbers cannot create or modify customer ratings.
"""

import logging
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.barber.api.barber_workers import get_approved_barber


logger = logging.getLogger("kshurak.barber.reviews")

router = APIRouter(
    prefix="/api/v1/barber/reviews",
    tags=["Barber Reviews"],
)


# ============================================================
# RESPONSE SCHEMAS
# ============================================================

class ReviewResponse(BaseModel):
    id: UUID
    booking_id: UUID

    customer_id: UUID | None = None
    customer_name: str

    barber_id: UUID
    service_name: str

    rating: int
    comment: str | None = None

    reply: str | None = None
    barber_replied_at: datetime | None = None

    created_at: datetime
    updated_at: datetime


class RatingDistributionItem(BaseModel):
    rating: int
    count: int
    percentage: float


class ReviewStatisticsResponse(BaseModel):
    total_reviews: int
    average_rating: float | None

    five_star_reviews: int
    five_star_percentage: float | None

    replied_reviews: int
    response_rate: float | None

    rating_distribution: list[RatingDistributionItem]


class ReviewListResponse(BaseModel):
    reviews: list[ReviewResponse]

    total: int
    limit: int
    offset: int


class ReviewReplyRequest(BaseModel):
    reply: str = Field(
        min_length=1,
        max_length=3000,
    )

    @field_validator("reply")
    @classmethod
    def validate_reply(cls, value: str) -> str:
        cleaned = value.strip()

        if not cleaned:
            raise ValueError("Review reply cannot be empty.")

        return cleaned


class ReviewReplyResponse(BaseModel):
    message: str
    review: ReviewResponse


# ============================================================
# INTERNAL HELPERS
# ============================================================

def get_barber_id(barber_id: UUID) -> UUID:
    if not isinstance(barber_id, UUID):
        raise HTTPException(
            status_code=401,
            detail="Invalid barber authentication context.",
        )

    return barber_id


def serialize_review(row) -> ReviewResponse:
    return ReviewResponse.model_validate(dict(row))


REVIEW_SELECT = """
    SELECT
        r.id,
        r.booking_id,

        b.customer_id,
        b.customer_name,
        b.barber_id,
        b.service_name,

        r.rating,
        r.comment,

        r.barber_reply AS reply,
        r.barber_replied_at,

        r.created_at,
        r.updated_at

    FROM public.barber_reviews AS r

    INNER JOIN public.barber_bookings AS b
        ON b.id = r.booking_id
"""


async def find_owned_review(
    db: AsyncSession,
    barber_id: UUID,
    review_id: UUID,
) -> ReviewResponse:
    result = await db.execute(
        text(
            REVIEW_SELECT
            + """
            WHERE r.id = :review_id
              AND b.barber_id = :barber_id
            """
        ),
        {
            "review_id": review_id,
            "barber_id": barber_id,
        },
    )

    row = result.mappings().first()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Review not found.",
        )

    return serialize_review(row)


# ============================================================
# REVIEW STATISTICS
# ============================================================

@router.get(
    "/statistics",
    response_model=ReviewStatisticsResponse,
)
async def get_review_statistics(
    barber_id: Annotated[
        UUID,
        Depends(get_approved_barber),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
):
    authenticated_id = get_barber_id(barber_id)

    try:
        result = await db.execute(
            text("""
                SELECT
                    COUNT(*) AS total_reviews,

                    AVG(r.rating) AS average_rating,

                    COUNT(*) FILTER (
                        WHERE r.rating = 5
                    ) AS five_star_reviews,

                    COUNT(*) FILTER (
                        WHERE r.barber_reply IS NOT NULL
                    ) AS replied_reviews

                FROM public.barber_reviews AS r

                JOIN public.barber_bookings AS b
                    ON b.id = r.booking_id

                WHERE b.barber_id = :barber_id
            """),
            {
                "barber_id": authenticated_id,
            },
        )

        row = result.mappings().one()

        total = int(row["total_reviews"])
        five_star = int(row["five_star_reviews"])
        replied = int(row["replied_reviews"])

        average = (
            round(float(row["average_rating"]), 2)
            if row["average_rating"] is not None
            else None
        )

        distribution_result = await db.execute(
            text("""
                SELECT
                    r.rating,
                    COUNT(*) AS review_count

                FROM public.barber_reviews AS r

                JOIN public.barber_bookings AS b
                    ON b.id = r.booking_id

                WHERE b.barber_id = :barber_id

                GROUP BY r.rating
            """),
            {
                "barber_id": authenticated_id,
            },
        )

        counts = {
            int(item["rating"]): int(item["review_count"])
            for item in distribution_result.mappings().all()
        }

        distribution = [
            RatingDistributionItem(
                rating=rating,
                count=counts.get(rating, 0),
                percentage=(
                    round(counts.get(rating, 0) * 100 / total, 2)
                    if total > 0
                    else 0.0
                ),
            )
            for rating in range(5, 0, -1)
        ]

        return ReviewStatisticsResponse(
            total_reviews=total,
            average_rating=average,
            five_star_reviews=five_star,
            five_star_percentage=(
                round(five_star * 100 / total, 2)
                if total > 0
                else None
            ),
            replied_reviews=replied,
            response_rate=(
                round(replied * 100 / total, 2)
                if total > 0
                else None
            ),
            rating_distribution=distribution,
        )

    except SQLAlchemyError as exc:
        logger.exception(
            "Unable to retrieve review statistics for barber %s",
            authenticated_id,
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve review statistics.",
        ) from exc


# ============================================================
# LIST REVIEWS
# ============================================================

@router.get(
    "",
    response_model=ReviewListResponse,
)
async def list_reviews(
    barber_id: Annotated[
        UUID,
        Depends(get_approved_barber),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
    search: str | None = Query(
        default=None,
        max_length=150,
    ),
    rating: int | None = Query(
        default=None,
        ge=1,
        le=5,
    ),
    service_name: str | None = Query(
        default=None,
        max_length=150,
    ),
    sort: Literal[
        "newest",
        "oldest",
        "highest",
        "lowest",
    ] = "newest",
    limit: int = Query(
        default=20,
        ge=1,
        le=100,
    ),
    offset: int = Query(
        default=0,
        ge=0,
    ),
):
    authenticated_id = get_barber_id(barber_id)

    conditions = [
        "b.barber_id = :barber_id",
    ]

    parameters = {
        "barber_id": authenticated_id,
        "limit": limit,
        "offset": offset,
    }

    if search and search.strip():
        conditions.append(
            """
            (
                b.customer_name ILIKE :search
                OR b.service_name ILIKE :search
                OR COALESCE(r.comment, '') ILIKE :search
            )
            """
        )

        escaped = (
            search.strip()
            .replace("!", "!!")
            .replace("%", "!%")
            .replace("_", "!_")
        )

        conditions[-1] = conditions[-1].replace(
            "ILIKE :search",
            "ILIKE :search ESCAPE '!'",
        )

        parameters["search"] = f"%{escaped}%"

    if rating is not None:
        conditions.append("r.rating = :rating")
        parameters["rating"] = rating

    if service_name and service_name.strip():
        conditions.append(
            "b.service_name = :service_name"
        )
        parameters["service_name"] = service_name.strip()

    sort_sql = {
        "newest": "r.created_at DESC, r.id DESC",
        "oldest": "r.created_at ASC, r.id ASC",
        "highest": (
            "r.rating DESC, r.created_at DESC, r.id DESC"
        ),
        "lowest": (
            "r.rating ASC, r.created_at DESC, r.id DESC"
        ),
    }[sort]

    where_clause = " AND ".join(conditions)

    try:
        count_result = await db.execute(
            text(f"""
                SELECT COUNT(*)

                FROM public.barber_reviews AS r

                JOIN public.barber_bookings AS b
                    ON b.id = r.booking_id

                WHERE {where_clause}
            """),
            parameters,
        )

        total = int(count_result.scalar_one())

        result = await db.execute(
            text(
                REVIEW_SELECT
                + f"""
                WHERE {where_clause}

                ORDER BY {sort_sql}

                LIMIT :limit
                OFFSET :offset
                """
            ),
            parameters,
        )

        reviews = [
            serialize_review(row)
            for row in result.mappings().all()
        ]

        return ReviewListResponse(
            reviews=reviews,
            total=total,
            limit=limit,
            offset=offset,
        )

    except SQLAlchemyError as exc:
        logger.exception(
            "Unable to list reviews for barber %s",
            authenticated_id,
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve customer reviews.",
        ) from exc


# ============================================================
# GET REVIEW DETAILS
# ============================================================

@router.get(
    "/{review_id}",
    response_model=ReviewResponse,
)
async def get_review_details(
    review_id: UUID,
    barber_id: Annotated[
        UUID,
        Depends(get_approved_barber),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
):
    authenticated_id = get_barber_id(barber_id)

    try:
        return await find_owned_review(
            db,
            authenticated_id,
            review_id,
        )

    except SQLAlchemyError as exc:
        logger.exception(
            "Unable to retrieve review %s",
            review_id,
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve review.",
        ) from exc


# ============================================================
# POST OR EDIT BARBER REPLY
# ============================================================

@router.put(
    "/{review_id}/reply",
    response_model=ReviewReplyResponse,
)
async def reply_to_review(
    review_id: UUID,
    payload: ReviewReplyRequest,
    barber_id: Annotated[
        UUID,
        Depends(get_approved_barber),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
):
    authenticated_id = get_barber_id(barber_id)

    try:
        result = await db.execute(
            text("""
                UPDATE public.barber_reviews AS r

                SET
                    barber_reply = :reply,
                    barber_replied_at = NOW(),
                    updated_at = NOW()

                FROM public.barber_bookings AS b

                WHERE r.id = :review_id
                  AND b.id = r.booking_id
                  AND b.barber_id = :barber_id

                RETURNING r.id
            """),
            {
                "review_id": review_id,
                "barber_id": authenticated_id,
                "reply": payload.reply,
            },
        )

        updated_id = result.scalar_one_or_none()

        if updated_id is None:
            await db.rollback()

            raise HTTPException(
                status_code=404,
                detail="Review not found.",
            )

        updated_review = await find_owned_review(
            db,
            authenticated_id,
            review_id,
        )

        await db.commit()

        logger.info(
            "Barber %s replied to review %s",
            authenticated_id,
            review_id,
        )

        return ReviewReplyResponse(
            message="Review reply saved successfully.",
            review=updated_review,
        )

    except HTTPException:
        raise

    except SQLAlchemyError as exc:
        await db.rollback()

        logger.exception(
            "Unable to reply to review %s",
            review_id,
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to save review reply.",
        ) from exc
