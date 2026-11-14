"""
KSHURAK Customer Reviews API.

Features:
- Review only appointments owned by the authenticated customer.
- Submit reviews only after appointment status becomes completed.
- Require an integer rating from 1 to 5.
- Allow an optional comment of up to 3000 characters.
- Allow one review per booking.
- Safely handle identical submission retries.
- Show the customer's existing review and barber reply.

Uses the existing public.barber_reviews table.
"""

import logging

from datetime import date, datetime, time
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Response,
    status,
)

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

from app.customer.api.customer_session import (
    get_authenticated_customer,
)


logger = logging.getLogger(
    "kshurak.customer.reviews"
)

router = APIRouter(
    prefix="/api/v1/customer/reviews",
    tags=["Customer Reviews"],
)

Database = Annotated[
    AsyncSession,
    Depends(get_db),
]

Customer = Annotated[
    dict,
    Depends(get_authenticated_customer),
]


# ============================================================
# REQUEST AND RESPONSE MODELS
# ============================================================

class ReviewCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    rating: int = Field(
        strict=True,
        ge=1,
        le=5,
    )

    comment: str | None = Field(
        default=None,
        max_length=3000,
    )

    @field_validator("comment")
    @classmethod
    def clean_comment(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        return value.strip() or None


class ReviewBooking(BaseModel):
    id: UUID
    barber_id: UUID
    customer_id: UUID

    worker_id: UUID | None = None
    worker_name: str | None = None
    shop_name: str | None = None

    service_name: str
    service_duration_minutes: int
    service_price: Decimal

    booking_date: date
    start_time: time
    end_time: time

    status: str
    completed_at: datetime | None = None


class CustomerReview(BaseModel):
    id: UUID
    booking_id: UUID

    customer_id: UUID
    customer_name: str

    barber_id: UUID
    service_name: str

    rating: int
    comment: str | None = None

    reply: str | None = None
    barber_replied_at: datetime | None = None

    created_at: datetime
    updated_at: datetime


class ReviewContextResponse(BaseModel):
    booking: ReviewBooking
    review: CustomerReview | None = None

    can_review: bool
    reason: str | None = None


class ReviewSubmitResponse(BaseModel):
    message: str
    review: CustomerReview


class CustomerReviewListResponse(BaseModel):
    reviews: list[CustomerReview]

    total: int
    limit: int
    offset: int


# ============================================================
# QUERIES
# ============================================================

BOOKING_SELECT = """
    SELECT
        b.id,
        b.barber_id,
        b.worker_id,
        b.customer_id,
        b.service_name,
        b.service_duration_minutes,
        b.service_price,
        b.booking_date,
        b.start_time,
        b.end_time,
        b.status,
        b.completed_at,
        w.full_name AS worker_name,
        ba.shop_name
    FROM public.barber_bookings b
    LEFT JOIN public.barber_workers w
        ON w.id = b.worker_id
       AND w.barber_id = b.barber_id
    LEFT JOIN public.barber_accounts ba
        ON ba.id = b.barber_id
    WHERE b.id = :booking_id
      AND b.customer_id = :customer_id
"""


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
    FROM public.barber_reviews r
    JOIN public.barber_bookings b
        ON b.id = r.booking_id
    WHERE b.customer_id = :customer_id
"""


# ============================================================
# HELPERS
# ============================================================

def authenticated_customer_id(
    customer: dict,
) -> UUID:
    try:
        return UUID(str(customer["id"]))

    except (
        KeyError,
        ValueError,
        TypeError,
        AttributeError,
    ) as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid authenticated customer.",
        ) from exc


async def owned_booking(
    db: AsyncSession,
    customer_id: UUID,
    booking_id: UUID,
    *,
    lock: bool = False,
) -> dict:
    query = BOOKING_SELECT

    if lock:
        query += " FOR UPDATE OF b"

    result = await db.execute(
        text(query),
        {
            "booking_id": booking_id,
            "customer_id": customer_id,
        },
    )

    row = result.mappings().first()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Booking not found.",
        )

    return dict(row)


async def find_review(
    db: AsyncSession,
    customer_id: UUID,
    booking_id: UUID,
) -> CustomerReview | None:
    result = await db.execute(
        text(
            REVIEW_SELECT
            + " AND r.booking_id = :booking_id"
        ),
        {
            "customer_id": customer_id,
            "booking_id": booking_id,
        },
    )

    row = result.mappings().first()

    if row is None:
        return None

    return CustomerReview.model_validate(
        dict(row)
    )


def require_completed(
    booking: dict,
) -> None:
    if booking["status"] != "completed":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "APPOINTMENT_NOT_COMPLETED",
                "message": (
                    "You can review an appointment after "
                    "the barber marks it completed."
                ),
            },
        )


def repeat_submission(
    existing: CustomerReview,
    payload: ReviewCreate,
) -> ReviewSubmitResponse:
    """
    Identical retries return the saved review.

    Different content never overwrites an existing review.
    """
    if (
        existing.rating != payload.rating
        or existing.comment != payload.comment
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "REVIEW_ALREADY_SUBMITTED",
                "message": (
                    "You have already reviewed this appointment. "
                    "Your existing review has not been changed."
                ),
            },
        )

    return ReviewSubmitResponse(
        message=(
            "Your review was already submitted successfully."
        ),
        review=existing,
    )


# ============================================================
# LIST THE AUTHENTICATED CUSTOMER'S REVIEWS
# ============================================================

@router.get(
    "/mine",
    response_model=CustomerReviewListResponse,
)
async def list_my_reviews(
    customer: Customer,
    db: Database,
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
    customer_id = authenticated_customer_id(
        customer
    )

    parameters = {
        "customer_id": customer_id,
        "limit": limit,
        "offset": offset,
    }

    try:
        count_result = await db.execute(
            text("""
                SELECT COUNT(*)
                FROM public.barber_reviews r
                JOIN public.barber_bookings b
                    ON b.id = r.booking_id
                WHERE b.customer_id = :customer_id
            """),
            {
                "customer_id": customer_id,
            },
        )

        result = await db.execute(
            text(
                REVIEW_SELECT
                + """
                ORDER BY r.created_at DESC, r.id DESC
                LIMIT :limit
                OFFSET :offset
                """
            ),
            parameters,
        )

        reviews = [
            CustomerReview.model_validate(
                dict(row)
            )
            for row in result.mappings().all()
        ]

        return CustomerReviewListResponse(
            reviews=reviews,
            total=int(
                count_result.scalar_one()
            ),
            limit=limit,
            offset=offset,
        )

    except SQLAlchemyError as exc:
        logger.exception(
            "Unable to retrieve customer reviews"
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve your reviews.",
        ) from exc


# ============================================================
# GET BOOKING INFORMATION AND EXISTING REVIEW
# ============================================================

@router.get(
    "/bookings/{booking_id}",
    response_model=ReviewContextResponse,
)
async def get_booking_review(
    booking_id: UUID,
    customer: Customer,
    db: Database,
):
    customer_id = authenticated_customer_id(
        customer
    )

    try:
        booking = await owned_booking(
            db,
            customer_id,
            booking_id,
        )

        review = await find_review(
            db,
            customer_id,
            booking_id,
        )

        can_review = (
            booking["status"] == "completed"
            and review is None
        )

        if review is not None:
            reason = (
                "You have already reviewed this appointment."
            )
        elif can_review:
            reason = None
        else:
            reason = (
                "You can review an appointment after "
                "the barber marks it completed."
            )

        return ReviewContextResponse(
            booking=ReviewBooking.model_validate(
                booking
            ),
            review=review,
            can_review=can_review,
            reason=reason,
        )

    except SQLAlchemyError as exc:
        logger.exception(
            "Unable to retrieve booking review context"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Unable to retrieve this appointment's "
                "review details."
            ),
        ) from exc


# ============================================================
# SUBMIT A REVIEW FOR A COMPLETED APPOINTMENT
# ============================================================

@router.post(
    "/bookings/{booking_id}",
    response_model=ReviewSubmitResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_booking_review(
    booking_id: UUID,
    payload: ReviewCreate,
    response: Response,
    customer: Customer,
    db: Database,
):
    customer_id = authenticated_customer_id(
        customer
    )

    try:
        async with db.begin():
            # Ownership, completion and duplicate checks run
            # while holding the booking row lock.
            booking = await owned_booking(
                db,
                customer_id,
                booking_id,
                lock=True,
            )

            existing = await find_review(
                db,
                customer_id,
                booking_id,
            )

            if existing is not None:
                result = repeat_submission(
                    existing,
                    payload,
                )

                response.status_code = (
                    status.HTTP_200_OK
                )

                return result

            require_completed(booking)

            inserted = await db.execute(
                text("""
                    INSERT INTO public.barber_reviews (
                        booking_id,
                        rating,
                        comment,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        :booking_id,
                        :rating,
                        :comment,
                        statement_timestamp(),
                        statement_timestamp()
                    )
                    ON CONFLICT (booking_id) DO NOTHING
                    RETURNING id
                """),
                {
                    "booking_id": booking_id,
                    "rating": payload.rating,
                    "comment": payload.comment,
                },
            )

            inserted_id = (
                inserted.scalar_one_or_none()
            )

            saved = await find_review(
                db,
                customer_id,
                booking_id,
            )

            if saved is None:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "Unable to verify review submission. "
                        "Refresh the review page before "
                        "trying again."
                    ),
                )

            if inserted_id is None:
                result = repeat_submission(
                    saved,
                    payload,
                )

                response.status_code = (
                    status.HTTP_200_OK
                )

                return result

            result = ReviewSubmitResponse(
                message=(
                    "Thank you! Your review was "
                    "submitted successfully."
                ),
                review=saved,
            )

        logger.info(
            "Customer review saved: review=%s booking=%s",
            result.review.id,
            booking_id,
        )

        return result

    except HTTPException:
        raise

    except IntegrityError as exc:
        logger.exception(
            "Customer review constraint conflict"
        )

        raise HTTPException(
            status_code=409,
            detail=(
                "The appointment or review changed. "
                "Refresh the review page before trying again."
            ),
        ) from exc

    except SQLAlchemyError as exc:
        logger.exception(
            "Unable to save customer review"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "The review result could not be verified. "
                "Refresh the review page before trying again."
            ),
        ) from exc
