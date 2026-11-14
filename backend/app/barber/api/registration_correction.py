"""
Barber registration correction API.

Correction tokens authorize only this correction workflow.
They do not activate accounts or provide dashboard access.

Validation:
    JSON body: {"token": "TOKEN_FROM_EMAIL"}

Resubmission:
    multipart/form-data:
        token
        shop_name
        shop_phone
        shop_address
        years_experience
        shop_image       optional replacement
        shop_documents   optional replacement list

Existing email, username and password cannot be changed here.
"""

import json
import logging
import re

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

import httpx

from fastapi import (
    APIRouter,
    HTTPException,
    Request,
    Response,
)
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    ValidationError,
    field_validator,
)
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from starlette.datastructures import UploadFile

from app.core.database import AsyncSessionLocal
from app.models.barber_auth_token import BarberAuthToken

from app.services.barber_token_service import (
    consume_barber_token,
    hash_token,
)

from app.admin.services.barber_media_service import (
    prepare_registration_media,
)

from app.barber.api.barber_registration import (
    ALLOWED_DOCUMENT_TYPES,
    ALLOWED_IMAGE_TYPES,
    DOCUMENT_BUCKET,
    MAX_DOCUMENTS,
    MAX_DOCUMENT_SIZE,
    MAX_SHOP_IMAGE_SIZE,
    SHOP_IMAGE_BUCKET,
    cleanup_storage,
    file_extension,
    read_validated_upload,
    storage_config,
    upload_to_storage,
)


logger = logging.getLogger(
    "kshurak.barber.registration_correction"
)

router = APIRouter(
    prefix="/api/v1/barber/registration-correction",
    tags=["Barber Registration Correction"],
)

TOKEN_TYPE = "registration_correction"


class ValidateCorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: SecretStr = Field(
        min_length=32,
        max_length=512,
    )


class CorrectionDetails(BaseModel):
    barber_id: UUID
    username: str
    email: str

    approval_status: Literal["needs_correction"]

    shop_name: str | None
    shop_phone: str | None
    shop_address: str
    years_experience: int

    correction_reason: str
    correction_requested_at: datetime
    token_expires_at: datetime

    shop_image_url: str | None
    documents: list[dict]
    signed_url_expires_in: int


class CorrectionFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shop_name: str = Field(
        min_length=2,
        max_length=150,
    )
    shop_phone: str = Field(
        min_length=10,
        max_length=20,
    )
    shop_address: str = Field(
        min_length=10,
        max_length=500,
    )
    years_experience: int = Field(
        ge=0,
        le=50,
    )

    @field_validator(
        "shop_name",
        "shop_phone",
        "shop_address",
        mode="before",
    )
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("shop_phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value)

        if (
            not re.fullmatch(r"[0-9+\-\s()]{10,20}", value)
            or not 10 <= len(digits) <= 15
        ):
            raise ValueError(
                "Enter a valid shop phone number containing "
                "10 to 15 digits."
            )

        return value


class ResubmitResponse(BaseModel):
    barber_id: UUID
    approval_status: Literal["pending"]
    correction_resubmitted_at: datetime
    message: str


def invalid_token():
    raise HTTPException(
        status_code=401,
        detail=(
            "This correction link is invalid, expired or already used. "
            "Please request a new correction link from Admin."
        ),
    )


def check_raw_token(raw_token: str) -> str:
    if not 32 <= len(raw_token) <= 512:
        invalid_token()

    return raw_token


def private_response_headers(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["Referrer-Policy"] = "no-referrer"


async def get_correction_context(
    db,
    raw_token: str,
    *,
    lock: bool,
):
    """
    Lock order matches Admin correction-token issuance:
        account -> token

    Token lookup is repeated after acquiring the account lock
    to detect token replacement, expiry or consumption.
    """
    raw_token = check_raw_token(raw_token)
    digest = hash_token(raw_token)

    barber_id = await db.scalar(
        select(BarberAuthToken.barber_id).where(
            BarberAuthToken.token_hash == digest,
            BarberAuthToken.token_type == TOKEN_TYPE,
            BarberAuthToken.used_at.is_(None),
            BarberAuthToken.expires_at
            > datetime.now(timezone.utc),
        )
    )

    if barber_id is None:
        invalid_token()

    account_sql = """
        SELECT
            id,
            username,
            email,
            approval_status,
            shop_name,
            shop_phone,
            shop_address,
            years_experience,
            shop_image_path,
            document_paths,
            correction_reason,
            correction_requested_at
        FROM public.barber_accounts
        WHERE id = :barber_id
    """

    if lock:
        account_sql += " FOR UPDATE"

    result = await db.execute(
        text(account_sql),
        {"barber_id": barber_id},
    )

    row = result.mappings().one_or_none()

    if row is None:
        invalid_token()

    token_query = select(BarberAuthToken).where(
        BarberAuthToken.token_hash == digest,
        BarberAuthToken.barber_id == barber_id,
        BarberAuthToken.token_type == TOKEN_TYPE,
        BarberAuthToken.used_at.is_(None),
        BarberAuthToken.expires_at
        > datetime.now(timezone.utc),
    )

    if lock:
        token_query = token_query.with_for_update()

    token = (
        await db.execute(token_query)
    ).scalar_one_or_none()

    if token is None:
        invalid_token()

    account = dict(row)

    if account["approval_status"] != "needs_correction":
        raise HTTPException(
            status_code=409,
            detail=(
                "This registration is no longer awaiting corrections."
            ),
        )

    if (
        not account["correction_reason"]
        or not account["correction_requested_at"]
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Correction instructions are incomplete. "
                "Please contact Admin."
            ),
        )

    return account, token


@router.post(
    "/validate",
    response_model=CorrectionDetails,
)
async def validate_correction(
    payload: ValidateCorrectionRequest,
    response: Response,
):
    private_response_headers(response)

    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                account, token = await get_correction_context(
                    db,
                    payload.token.get_secret_value(),
                    lock=False,
                )

                expires_at = token.expires_at

        # Sign only saved media belonging to this barber.
        media = await prepare_registration_media(
            barber_id=account["id"],
            shop_image_path=account["shop_image_path"],
            document_paths=account["document_paths"],
        )

        return CorrectionDetails(
            barber_id=account["id"],
            username=account["username"],
            email=account["email"],
            approval_status="needs_correction",
            shop_name=account["shop_name"],
            shop_phone=account["shop_phone"],
            shop_address=account["shop_address"],
            years_experience=account["years_experience"],
            correction_reason=account["correction_reason"],
            correction_requested_at=(
                account["correction_requested_at"]
            ),
            token_expires_at=expires_at,
            shop_image_url=media["shop_image_url"],
            documents=media["signed_documents"],
            signed_url_expires_in=(
                media["signed_url_expires_in"]
            ),
        )

    except SQLAlchemyError as exc:
        logger.error(
            "Database failure validating correction access: %s",
            type(exc).__name__,
        )

        raise HTTPException(
            status_code=503,
            detail="Correction service is temporarily unavailable.",
        ) from None


async def parse_resubmission(request: Request):
    if not request.headers.get(
        "content-type", ""
    ).lower().startswith("multipart/form-data"):
        raise HTTPException(
            status_code=415,
            detail="Use multipart/form-data.",
        )

    form = await request.form(
        max_files=MAX_DOCUMENTS + 1,
        max_fields=10,
    )

    allowed = {
        "token",
        "shop_name",
        "shop_phone",
        "shop_address",
        "years_experience",
        "shop_image",
        "shop_documents",
    }

    if any(key not in allowed for key in form.keys()):
        raise HTTPException(
            status_code=422,
            detail="The request contains unsupported fields.",
        )

    values = {}

    for field in (
        "token",
        "shop_name",
        "shop_phone",
        "shop_address",
        "years_experience",
    ):
        items = form.getlist(field)

        if len(items) != 1 or not isinstance(items[0], str):
            raise HTTPException(
                status_code=422,
                detail=f"Provide exactly one value for {field}.",
            )

        values[field] = items[0]

    raw_token = check_raw_token(values.pop("token"))

    try:
        fields = CorrectionFields.model_validate(values)
    except ValidationError as exc:
        errors = [
            {
                "loc": ["body", *item["loc"]],
                "msg": item["msg"],
                "type": item["type"],
            }
            for item in exc.errors()
        ]

        raise HTTPException(
            status_code=422,
            detail=errors,
        ) from None

    image_items = form.getlist("shop_image")

    if len(image_items) > 1:
        raise HTTPException(
            status_code=422,
            detail="Provide only one replacement shop image.",
        )

    image = image_items[0] if image_items else None

    if image is not None and not isinstance(image, UploadFile):
        raise HTTPException(
            status_code=422,
            detail="Shop image must be a file.",
        )

    documents = form.getlist("shop_documents")

    if (
        len(documents) > MAX_DOCUMENTS
        or any(
            not isinstance(item, UploadFile)
            for item in documents
        )
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                f"Provide at most {MAX_DOCUMENTS} "
                "verification document files."
            ),
        )

    return raw_token, fields, image, documents


@router.post(
    "/resubmit",
    response_model=ResubmitResponse,
)
async def resubmit_correction(
    request: Request,
    response: Response,
):
    private_response_headers(response)

    raw_token, fields, image, documents = (
        await parse_resubmission(request)
    )

    # Reject invalid links before processing file contents.
    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                initial_account, _ = await get_correction_context(
                    db,
                    raw_token,
                    lock=False,
                )
    except SQLAlchemyError as exc:
        logger.error(
            "Database failure checking correction access: %s",
            type(exc).__name__,
        )

        raise HTTPException(
            status_code=503,
            detail="Correction service is temporarily unavailable.",
        ) from None

    image_upload = None

    if image is not None:
        image_upload = await read_validated_upload(
            image,
            ALLOWED_IMAGE_TYPES,
            MAX_SHOP_IMAGE_SIZE,
            "Shop image",
        )

    document_uploads = []

    for index, document in enumerate(documents, start=1):
        document_uploads.append(
            await read_validated_upload(
                document,
                ALLOWED_DOCUMENT_TYPES,
                MAX_DOCUMENT_SIZE,
                f"Document {index}",
            )
        )

    barber_id = initial_account["id"]
    new_image_path = None
    new_documents = None
    created_files = []

    storage_url = None
    storage_key = None

    if image_upload is not None or document_uploads:
        storage_url, storage_key = storage_config()

    async with httpx.AsyncClient(timeout=45.0) as client:
        try:
            if image_upload is not None:
                new_image_path = (
                    f"barbers/{barber_id}/shop/"
                    f"{uuid4().hex}"
                    f"{file_extension(image_upload['content_type'])}"
                )

                # Track before upload so failed HTTP attempts can
                # also be cleaned up when their outcome is uncertain.
                created_files.append(
                    (SHOP_IMAGE_BUCKET, new_image_path)
                )

                await upload_to_storage(
                    client,
                    storage_url,
                    storage_key,
                    SHOP_IMAGE_BUCKET,
                    new_image_path,
                    image_upload,
                )

            if document_uploads:
                new_documents = []

                for uploaded in document_uploads:
                    path = (
                        f"barbers/{barber_id}/documents/"
                        f"{uuid4().hex}"
                        f"{file_extension(uploaded['content_type'])}"
                    )

                    created_files.append(
                        (DOCUMENT_BUCKET, path)
                    )

                    await upload_to_storage(
                        client,
                        storage_url,
                        storage_key,
                        DOCUMENT_BUCKET,
                        path,
                        uploaded,
                    )

                    new_documents.append(
                        {
                            "path": path,
                            "original_name": uploaded["original_name"],
                            "content_type": uploaded["content_type"],
                            "size": uploaded["size"],
                            "document_type": "other",
                        }
                    )

        except Exception:
            if created_files:
                await cleanup_storage(
                    client,
                    storage_url,
                    storage_key,
                    created_files,
                )
            raise

        try:
            async with AsyncSessionLocal() as db:
                async with db.begin():
                    account, _ = await get_correction_context(
                        db,
                        raw_token,
                        lock=True,
                    )

                    image_path = (
                        new_image_path
                        if new_image_path is not None
                        else account["shop_image_path"]
                    )

                    document_paths = (
                        new_documents
                        if new_documents is not None
                        else account["document_paths"]
                    )

                    if not image_path:
                        raise HTTPException(
                            status_code=422,
                            detail="A shop image is required.",
                        )

                    if (
                        not isinstance(document_paths, list)
                        or not document_paths
                        or len(document_paths) > MAX_DOCUMENTS
                    ):
                        raise HTTPException(
                            status_code=422,
                            detail=(
                                "Provide between 1 and "
                                f"{MAX_DOCUMENTS} verification documents."
                            ),
                        )

                    consumed = await consume_barber_token(
                        db,
                        raw_token,
                        TOKEN_TYPE,
                    )

                    if consumed is None:
                        invalid_token()

                    now = datetime.now(timezone.utc)

                    params = {
                        "barber_id": account["id"],
                        "shop_name": fields.shop_name,
                        "shop_phone": fields.shop_phone,
                        "shop_address": fields.shop_address,
                        "years_experience": fields.years_experience,
                        "shop_image_path": image_path,
                        "document_paths": json.dumps(document_paths),
                        "now": now,
                        "requested_at": (
                            account["correction_requested_at"]
                        ),
                    }

                    await db.execute(
                        text("""
                            UPDATE public.barber_accounts
                            SET
                                shop_name = :shop_name,
                                shop_phone = :shop_phone,
                                shop_address = :shop_address,
                                years_experience = :years_experience,
                                shop_image_path = :shop_image_path,
                                document_paths =
                                    CAST(:document_paths AS JSONB),
                                approval_status = 'pending',
                                correction_resubmitted_at = :now,
                                updated_at = :now
                            WHERE id = :barber_id
                              AND approval_status = 'needs_correction'
                        """),
                        params,
                    )

                    # Synchronize only applications belonging to
                    # this correction cycle. Do not fabricate setup.
                    address_changed = (
                        account["shop_address"].strip()
                        != fields.shop_address
                    )

                    await db.execute(
                        text("""
                            UPDATE public.barber_applications
                            SET
                                shop_name = :shop_name,
                                shop_phone = :shop_phone,
                                address = :shop_address,
                                experience_years = :years_experience,
                                document_paths =
                                    CAST(:document_paths AS JSONB),
                                status = 'PENDING',
                                correction_resubmitted_at = :now,
                                latitude = CASE
                                    WHEN :address_changed THEN NULL
                                    ELSE latitude
                                END,
                                longitude = CASE
                                    WHEN :address_changed THEN NULL
                                    ELSE longitude
                                END,
                                google_place_id = CASE
                                    WHEN :address_changed THEN NULL
                                    ELSE google_place_id
                                END,
                                location_verified = CASE
                                    WHEN :address_changed THEN FALSE
                                    ELSE location_verified
                                END,
                                updated_at = :now
                            WHERE barber_account_id = :barber_id
                              AND status = 'NEEDS_CORRECTION'
                              AND correction_requested_at = :requested_at
                        """),
                        {
                            **params,
                            "address_changed": address_changed,
                        },
                    )

            # Both status updates and token consumption have committed.
            # Old media is retained; no old files are deleted here.

        except HTTPException:
            # Rejection occurred before commit; remove only new uploads.
            if created_files:
                await cleanup_storage(
                    client,
                    storage_url,
                    storage_key,
                    created_files,
                )
            raise

        except SQLAlchemyError as exc:
            # A connection loss during COMMIT can leave the outcome
            # unknown. Retain new uploads instead of deleting files
            # that may now be referenced by a committed registration.
            logger.error(
                "Correction database failure for barber %s; "
                "uploaded media retained for reconciliation; "
                "error_type=%s",
                barber_id,
                type(exc).__name__,
            )

            raise HTTPException(
                status_code=503,
                detail=(
                    "Unable to confirm the resubmission result. "
                    "Refresh your correction link before retrying. "
                    "If it is already used, contact Admin to confirm "
                    "whether your application is pending review."
                ),
            ) from None

    return ResubmitResponse(
        barber_id=barber_id,
        approval_status="pending",
        correction_resubmitted_at=now,
        message=(
            "Your corrected registration has been submitted. "
            "Please wait for Admin review. Dashboard access "
            "will be available only after approval and activation."
        ),
    )
