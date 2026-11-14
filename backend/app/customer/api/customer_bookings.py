"""
KSHURAK Customer Booking API.

Direct booking:
    Shop -> Service -> Worker -> Date/time -> Confirmation.

Virtual try-on booking:
    The same booking process with an optional hairstyle snapshot.

Appointment availability and conflict checks are shared by both flows.
"""

import base64
import binascii
import json
import logging
import re

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import (
    BaseModel,
    Field,
    field_validator,
    model_validator,
)
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.customer.api.customer_session import (
    get_authenticated_customer,
)
from app.customer.api.booking_slots import (
    SHOP_TIMEZONE,
    MAX_ADVANCE_DAYS,
    SLOT_INTERVAL_MINUTES,
    is_day_open,
    minutes,
    schedule_allows,
)


logger = logging.getLogger("kshurak.customer.bookings")

router = APIRouter(
    prefix="/api/v1/customer/bookings",
    tags=["Customer Bookings"],
)

MAX_SERVICE_DURATION_MINUTES = 480

# Limits apply only to optional hairstyle snapshots.
MAX_IMAGE_STRING_LENGTH = 4_000_000
MAX_SELECTION_JSON_BYTES = 13_000_000

IMAGE_DATA_PATTERN = re.compile(
    r"^data:image/(jpeg|jpg|png|webp);base64,(.+)$",
    re.IGNORECASE | re.DOTALL,
)


def validate_image_source(value: str) -> str:
    """
    Accept an image data URL, HTTP(S) URL, or local asset path.

    Remote URLs are stored only. This function does not fetch them.
    """
    value = value.strip()

    if not value:
        raise ValueError("Image source cannot be empty.")

    if len(value) > MAX_IMAGE_STRING_LENGTH:
        raise ValueError(
            "A hairstyle image is too large. "
            "Please use a smaller preview."
        )

    if value.lower().startswith("data:"):
        match = IMAGE_DATA_PATTERN.fullmatch(value)

        if not match:
            raise ValueError(
                "Use a JPEG, PNG or WebP image data URL."
            )

        mime = match.group(1).lower()
        encoded = re.sub(r"\s+", "", match.group(2))

        try:
            raw = base64.b64decode(
                encoded,
                validate=True,
            )
        except (ValueError, binascii.Error) as exc:
            raise ValueError(
                "Invalid Base64 hairstyle image."
            ) from exc

        if not raw:
            raise ValueError(
                "Hairstyle image cannot be empty."
            )

        valid_signature = (
            (
                mime in {"jpeg", "jpg"}
                and raw.startswith(b"\xff\xd8\xff")
            )
            or (
                mime == "png"
                and raw.startswith(b"\x89PNG\r\n\x1a\n")
            )
            or (
                mime == "webp"
                and raw.startswith(b"RIFF")
                and raw[8:12] == b"WEBP"
            )
        )

        if not valid_signature:
            raise ValueError(
                "Hairstyle image content does not match its format."
            )

        normalized_mime = "jpeg" if mime == "jpg" else mime

        return (
            f"data:image/{normalized_mime};base64,"
            f"{encoded}"
        )

    # Keep bundled catalog reference paths usable.
    if value.startswith("/") and not value.startswith("//"):
        parsed = urlsplit(value)

        if (
            parsed.netloc
            or "\\" in parsed.path
            or not re.search(
                r"\.(png|jpe?g|webp)$",
                parsed.path,
                re.IGNORECASE,
            )
        ):
            raise ValueError(
                "Invalid local hairstyle image path."
            )

        return value

    try:
        parsed = urlsplit(value)

        valid_url = (
            parsed.scheme.lower() in {"http", "https"}
            and bool(parsed.hostname)
            and parsed.username is None
            and parsed.password is None
            and not any(character.isspace() for character in value)
        )
    except ValueError as exc:
        raise ValueError(
            "Invalid hairstyle image URL."
        ) from exc

    if not valid_url:
        raise ValueError(
            "Use an HTTP(S) image URL or image data URL."
        )

    return value


class HairstylePreview(BaseModel):
    angle: Literal["front", "left", "right"]

    image: str = Field(
        min_length=1,
        max_length=MAX_IMAGE_STRING_LENGTH,
    )

    @field_validator("image")
    @classmethod
    def validate_image(cls, value: str) -> str:
        return validate_image_source(value)


class BookingHairstyleSelection(BaseModel):
    version: Literal[1] = 1
    source: Literal["virtual_tryon"] = "virtual_tryon"

    scan_id: UUID

    hairstyle_id: str = Field(
        min_length=1,
        max_length=150,
    )

    hairstyle_name: str = Field(
        min_length=1,
        max_length=200,
    )

    reference_image: str = Field(
        min_length=1,
        max_length=MAX_IMAGE_STRING_LENGTH,
    )

    style_analysis: str = Field(
        min_length=3,
        max_length=20_000,
    )

    face_shape: str | None = Field(
        default=None,
        max_length=100,
    )

    previews: list[HairstylePreview] = Field(
        min_length=1,
        max_length=3,
    )

    @field_validator(
        "hairstyle_id",
        "hairstyle_name",
        "style_analysis",
    )
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        value = value.strip()

        if not value:
            raise ValueError(
                "Hairstyle information cannot be empty."
            )

        return value

    @field_validator("reference_image")
    @classmethod
    def validate_reference_image(cls, value: str) -> str:
        return validate_image_source(value)

    @field_validator("face_shape")
    @classmethod
    def trim_face_shape(
        cls,
        value: str | None,
    ) -> str | None:
        return value.strip() or None if value is not None else None

    @model_validator(mode="after")
    def validate_snapshot(self):
        angles = [
            preview.angle
            for preview in self.previews
        ]

        if len(angles) != len(set(angles)):
            raise ValueError(
                "Each hairstyle preview angle must be unique."
            )

        encoded = json.dumps(
            self.model_dump(mode="json"),
            ensure_ascii=False,
        ).encode("utf-8")

        if len(encoded) > MAX_SELECTION_JSON_BYTES:
            raise ValueError(
                "The hairstyle selection is too large. "
                "Please use smaller preview images."
            )

        return self


class CustomerBookingCreate(BaseModel):
    barber_id: UUID
    worker_id: UUID
    service_id: UUID

    booking_date: date
    start_time: time

    customer_phone: str = Field(
        min_length=10,
        max_length=20,
    )

    customer_notes: str | None = Field(
        default=None,
        max_length=1000,
    )

    # Optional: existing direct-booking requests still work.
    hairstyle_selection: BookingHairstyleSelection | None = None

    @field_validator("customer_phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value)

        if len(digits) == 12 and digits.startswith("91"):
            digits = digits[2:]

        if not re.fullmatch(r"[6-9]\d{9}", digits):
            raise ValueError(
                "Enter a valid 10-digit Indian mobile number."
            )

        return digits

    @model_validator(mode="after")
    def validate_booking(self):
        if self.start_time.tzinfo is not None:
            raise ValueError(
                "Appointment time must be a local IST time "
                "without an offset."
            )

        if self.start_time.second or self.start_time.microsecond:
            raise ValueError(
                "Appointment start time must use whole minutes."
            )

        if self.customer_notes is not None:
            self.customer_notes = (
                self.customer_notes.strip() or None
            )

        return self


class CustomerBookingResponse(BaseModel):
    id: UUID
    barber_id: UUID
    worker_id: UUID
    customer_id: UUID

    customer_name: str
    service_name: str
    service_duration_minutes: int
    service_price: Decimal

    booking_date: date
    start_time: time
    end_time: time

    status: str
    confirmed_at: datetime | None = None
    customer_notes: str | None = None

    hairstyle_selection: BookingHairstyleSelection | None = None


class BookingCreateResult(BaseModel):
    message: str
    booking: CustomerBookingResponse


def customer_contact(
    customer: dict,
    submitted_phone: str,
    profile_name: str = "",
) -> tuple[str, str]:
    metadata = customer.get("user_metadata") or {}

    if not isinstance(metadata, dict):
        metadata = {}

    name = str(
        profile_name
        or metadata.get("full_name")
        or metadata.get("fullName")
        or metadata.get("name")
        or metadata.get("username")
        or ""
    ).strip()

    if not name:
        raise HTTPException(
            status_code=422,
            detail=(
                "Please complete your customer name "
                "before booking."
            ),
        )

    return name, submitted_phone.strip()


def validate_booking_date(
    booking_date: date,
    now: datetime,
) -> None:
    if booking_date < now.date():
        raise HTTPException(
            status_code=422,
            detail="Booking date cannot be in the past.",
        )

    if booking_date > (
        now.date() + timedelta(days=MAX_ADVANCE_DAYS)
    ):
        raise HTTPException(
            status_code=422,
            detail="Booking date is too far in advance.",
        )


def database_sqlstate(
    exc: IntegrityError,
) -> str | None:
    original = exc.orig

    for candidate in (
        original,
        getattr(original, "__cause__", None),
        getattr(original, "__context__", None),
    ):
        if candidate is None:
            continue

        value = (
            getattr(candidate, "sqlstate", None)
            or getattr(candidate, "pgcode", None)
        )

        if value:
            return str(value)

    return None


SHOP_QUERY = text("""
    SELECT
        app.opening_time,
        app.closing_time,
        app.working_days
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
""")


SERVICE_QUERY = text("""
    SELECT
        service_name,
        duration_minutes,
        price
    FROM public.barber_services
    WHERE id = :service_id
      AND barber_id = :barber_id
      AND is_active = TRUE
    LIMIT 1
    FOR SHARE
""")


WORKER_QUERY = text("""
    SELECT
        shift_start,
        shift_end,
        slot_availability,
        custom_breaks
    FROM public.barber_workers
    WHERE id = :worker_id
      AND barber_id = :barber_id
      AND is_active = TRUE
    LIMIT 1
    FOR SHARE
""")


CONFLICT_QUERY = text("""
    SELECT EXISTS (
        SELECT 1
        FROM public.barber_bookings
        WHERE barber_id = :barber_id
          AND worker_id = :worker_id
          AND booking_date = :booking_date
          AND LOWER(status) IN ('pending', 'confirmed')
          AND start_time < :end_time
          AND end_time > :start_time
    )
""")


SCAN_OWNERSHIP_QUERY = text("""
    SELECT
        scan.id,
        scan.face_shape
    FROM public.face_scans AS scan
    INNER JOIN public.profiles AS profile
        ON profile.id = scan.profile_id
    WHERE scan.id = :scan_id
      AND profile.auth_user_id = :customer_id
    LIMIT 1
""")


INSERT_BOOKING_QUERY = text("""
    INSERT INTO public.barber_bookings (
        barber_id,
        worker_id,
        customer_id,
        customer_name,
        customer_phone,
        service_name,
        service_duration_minutes,
        service_price,
        booking_date,
        start_time,
        end_time,
        status,
        confirmed_at,
        customer_notes,
        hairstyle_selection
    )
    VALUES (
        :barber_id,
        :worker_id,
        :customer_id,
        :customer_name,
        :customer_phone,
        :service_name,
        :service_duration_minutes,
        :service_price,
        :booking_date,
        :start_time,
        :end_time,
        'confirmed',
        NOW(),
        :customer_notes,
        CAST(:hairstyle_selection AS JSONB)
    )
    RETURNING
        id,
        barber_id,
        worker_id,
        customer_id,
        customer_name,
        service_name,
        service_duration_minutes,
        service_price,
        booking_date,
        start_time,
        end_time,
        status,
        confirmed_at,
        customer_notes,
        hairstyle_selection
""")


@router.post(
    "",
    response_model=BookingCreateResult,
    status_code=status.HTTP_201_CREATED,
)
async def create_customer_booking(
    payload: CustomerBookingCreate,
    customer: Annotated[
        dict,
        Depends(get_authenticated_customer),
    ],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    validate_booking_date(
        payload.booking_date,
        datetime.now(SHOP_TIMEZONE),
    )

    try:
        customer_id = UUID(str(customer["id"]))
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid authenticated customer.",
        ) from exc

    # Same transaction-lock key used by the existing booking flow.
    lock_key = (
        f"kshurak:bookings:{payload.barber_id}:"
        f"{payload.booking_date.isoformat()}"
    )

    try:
        async with db.begin():
            await db.execute(
                text("""
                    SELECT pg_advisory_xact_lock(
                        hashtextextended(:key, 0)
                    )
                """),
                {"key": lock_key},
            )

            now = datetime.now(SHOP_TIMEZONE)
            validate_booking_date(
                payload.booking_date,
                now,
            )

            hairstyle_json: str | None = None

            if payload.hairstyle_selection is not None:
                selection = payload.hairstyle_selection

                ownership_result = await db.execute(
                    SCAN_OWNERSHIP_QUERY,
                    {
                        "scan_id": selection.scan_id,
                        "customer_id": customer_id,
                    },
                )

                owned_scan = (
                    ownership_result.mappings().first()
                )

                if owned_scan is None:
                    raise HTTPException(
                        status_code=403,
                        detail=(
                            "The selected face scan is unavailable "
                            "or does not belong to your account."
                        ),
                    )

                # Store the database face shape rather than trusting
                # a face-shape value submitted by the browser.
                saved_face_shape = (
                    str(owned_scan["face_shape"]).strip()
                    if owned_scan["face_shape"] is not None
                    else None
                )

                if (
                    saved_face_shape is not None
                    and len(saved_face_shape) > 100
                ):
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            "The saved face shape is invalid. "
                            "Please review your face scan."
                        ),
                    )

                snapshot = selection.model_dump(mode="json")
                snapshot["face_shape"] = (
                    saved_face_shape or None
                )

                hairstyle_json = json.dumps(
                    snapshot,
                    ensure_ascii=False,
                )

            profile_result = await db.execute(
                text("""
                    SELECT full_name
                    FROM public.profiles
                    WHERE auth_user_id = :auth_id
                      AND (
                          profile_type IS NULL
                          OR profile_type = 'self'
                          OR profile_type = 'primary'
                      )
                    ORDER BY created_at ASC
                    LIMIT 1
                """),
                {"auth_id": customer_id},
            )

            profile = profile_result.mappings().first()

            profile_name = (
                str(profile["full_name"] or "").strip()
                if profile is not None
                else ""
            )

            customer_name, customer_phone = customer_contact(
                customer,
                payload.customer_phone,
                profile_name,
            )

            params = {
                "barber_id": payload.barber_id,
                "service_id": payload.service_id,
                "worker_id": payload.worker_id,
            }

            shop_result = await db.execute(
                SHOP_QUERY,
                params,
            )
            shop_row = shop_result.mappings().first()

            if shop_row is None:
                raise HTTPException(
                    status_code=404,
                    detail="Shop is unavailable for booking.",
                )

            service_result = await db.execute(
                SERVICE_QUERY,
                params,
            )
            service_row = service_result.mappings().first()

            if service_row is None:
                raise HTTPException(
                    status_code=404,
                    detail="Selected service is unavailable.",
                )

            worker_result = await db.execute(
                WORKER_QUERY,
                params,
            )
            worker_row = worker_result.mappings().first()

            if worker_row is None:
                raise HTTPException(
                    status_code=404,
                    detail="Selected worker is unavailable.",
                )

            shop = dict(shop_row)
            service = dict(service_row)
            worker = dict(worker_row)

            if not is_day_open(
                shop.get("working_days"),
                payload.booking_date,
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Shop is closed on the selected date."
                    ),
                )

            try:
                duration = int(
                    service["duration_minutes"]
                )
            except (
                TypeError,
                ValueError,
                OverflowError,
            ) as exc:
                raise HTTPException(
                    status_code=409,
                    detail="Invalid service duration.",
                ) from exc

            if not (
                5
                <= duration
                <= MAX_SERVICE_DURATION_MINUTES
            ):
                raise HTTPException(
                    status_code=409,
                    detail="Invalid service duration.",
                )

            start_minute = minutes(payload.start_time)
            end_minute = start_minute + duration

            if end_minute >= 1440:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Appointment exceeds the supported day."
                    ),
                )

            end_time = time(
                end_minute // 60,
                end_minute % 60,
            )

            shop_open = shop.get("opening_time")
            shop_close = shop.get("closing_time")
            worker_open = worker.get("shift_start")
            worker_close = worker.get("shift_end")

            if any(
                value is None
                for value in (
                    shop_open,
                    shop_close,
                    worker_open,
                    worker_close,
                )
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Shop or worker hours are not configured."
                    ),
                )

            earliest = max(
                minutes(shop_open),
                minutes(worker_open),
            )

            latest = min(
                minutes(shop_close),
                minutes(worker_close),
            )

            if (
                start_minute < earliest
                or end_minute > latest
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Appointment is outside shop "
                        "or worker operating hours."
                    ),
                )

            worker_start = minutes(worker_open)

            if (
                start_minute < worker_start
                or (
                    start_minute - worker_start
                ) % SLOT_INTERVAL_MINUTES != 0
            ):
                raise HTTPException(
                    status_code=409,
                    detail="Invalid appointment start time.",
                )

            if payload.booking_date == now.date():
                appointment_start = datetime.combine(
                    payload.booking_date,
                    payload.start_time,
                    tzinfo=SHOP_TIMEZONE,
                )

                if appointment_start <= now:
                    raise HTTPException(
                        status_code=409,
                        detail="Appointment time has passed.",
                    )

            if not schedule_allows(
                worker,
                payload.booking_date,
                start_minute,
                end_minute,
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "The selected worker is unavailable "
                        "at this date or time."
                    ),
                )

            conflict_result = await db.execute(
                CONFLICT_QUERY,
                {
                    "barber_id": payload.barber_id,
                    "worker_id": payload.worker_id,
                    "booking_date": payload.booking_date,
                    "start_time": payload.start_time,
                    "end_time": end_time,
                },
            )

            if conflict_result.scalar():
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "This appointment is already booked. "
                        "Please select another available slot."
                    ),
                )

            result = await db.execute(
                INSERT_BOOKING_QUERY,
                {
                    "barber_id": payload.barber_id,
                    "worker_id": payload.worker_id,
                    "customer_id": customer_id,
                    "customer_name": customer_name,
                    "customer_phone": customer_phone,
                    "service_name": service["service_name"],
                    "service_duration_minutes": duration,
                    "service_price": service["price"],
                    "booking_date": payload.booking_date,
                    "start_time": payload.start_time,
                    "end_time": end_time,
                    "customer_notes": payload.customer_notes,
                    "hairstyle_selection": hairstyle_json,
                },
            )

            inserted = dict(result.mappings().one())

            # Some database drivers return JSON as a string.
            if isinstance(
                inserted.get("hairstyle_selection"),
                str,
            ):
                inserted["hairstyle_selection"] = json.loads(
                    inserted["hairstyle_selection"]
                )

            confirmed_booking = (
                CustomerBookingResponse.model_validate(
                    inserted
                )
            )

            await db.execute(
                text("""
                    UPDATE public.profiles
                    SET
                        phone = :phone,
                        mobile = :phone,
                        updated_at = NOW()
                    WHERE id = (
                        SELECT id
                        FROM public.profiles
                        WHERE auth_user_id = :auth_id
                          AND (
                              profile_type IS NULL
                              OR profile_type = 'self'
                              OR profile_type = 'primary'
                          )
                        ORDER BY created_at ASC
                        LIMIT 1
                    )
                """),
                {
                    "phone": customer_phone,
                    "auth_id": customer_id,
                },
            )

        logger.info(
            "Customer booking confirmed: "
            "booking=%s barber=%s worker=%s date=%s flow=%s",
            confirmed_booking.id,
            payload.barber_id,
            payload.worker_id,
            payload.booking_date,
            (
                "virtual_tryon"
                if payload.hairstyle_selection is not None
                else "direct"
            ),
        )

        return BookingCreateResult(
            message=(
                "Appointment booked and confirmed successfully."
            ),
            booking=confirmed_booking,
        )

    except HTTPException:
        raise

    except IntegrityError as exc:
        sqlstate = database_sqlstate(exc)

        if sqlstate == "23P01":
            logger.warning(
                "Overlapping booking rejected by database.",
                exc_info=True,
            )

            raise HTTPException(
                status_code=409,
                detail=(
                    "This appointment is already booked. "
                    "Please select another available slot."
                ),
            ) from exc

        if sqlstate == "23505":
            logger.warning(
                "Duplicate booking or related record rejected.",
                exc_info=True,
            )

            raise HTTPException(
                status_code=409,
                detail=(
                    "A duplicate record prevented this booking. "
                    "Check My Bookings and refresh availability."
                ),
            ) from exc

        logger.exception(
            "Customer booking integrity error; SQLSTATE=%s",
            sqlstate,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "The appointment could not be saved because "
                "of a database configuration error. "
                "Please contact support."
            ),
        ) from exc

    except SQLAlchemyError as exc:
        logger.exception(
            "Customer booking database error."
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Booking service is temporarily unavailable."
            ),
        ) from exc