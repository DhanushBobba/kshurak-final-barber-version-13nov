import logging
import os
import re
import uuid
from io import BytesIO
from pathlib import Path
from dotenv import load_dotenv
from typing import Literal
from uuid import UUID
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, EmailStr, Field, ValidationError, field_validator
from pwdlib import PasswordHash
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile
from app.core.database import get_db
from app.models.barber_account import BarberAccount
logger = logging.getLogger("kshurak.barber.registration")
router = APIRouter(prefix="/api/v1/barber", tags=["Barber Registration"])
password_hasher = PasswordHash.recommended()
MAX_SHOP_IMAGE_SIZE = 8 * 1024 * 1024
MAX_DOCUMENT_SIZE = 5 * 1024 * 1024
MAX_DOCUMENTS = 5
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_DOCUMENT_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
SHOP_IMAGE_BUCKET = "shop-images"
DOCUMENT_BUCKET = "barber-documents"
class BarberRegistrationRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    years_experience: int = Field(ge=0, le=50)
    shop_name: str = Field(min_length=2, max_length=150)
    shop_phone: str = Field(min_length=10, max_length=20)
    shop_address: str = Field(min_length=10, max_length=500)
    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9_]{3,50}", value):
            raise ValueError("Username must contain 3-50 letters, numbers or underscores")
        return value
    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return str(value).strip().lower()
    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
            raise ValueError("Password must contain at least one letter and one number")
        return value
    @field_validator("shop_name")
    @classmethod
    def def_validate_shop_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Shop name must contain at least 2 characters")
        return value
    @field_validator("shop_address")
    @classmethod
    def validate_address(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 10:
            raise ValueError("Please provide a complete shop address")
        return value
    @field_validator("shop_phone")
    @classmethod
    def validate_shop_phone(cls, value: str) -> str:
        value = value.strip()
        digits = re.sub(r"\D", "", value)
        if not re.fullmatch(r"[0-9+\-\s()]{10,20}", value) or not 10 <= len(digits) <= 15:
            raise ValueError("Enter a valid shop contact number containing 10 to 15 digits")
        return value
class BarberRegistrationResponse(BaseModel):
    id: UUID
    status: Literal["pending"]
    message: str
def detect_file_type(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None
def file_extension(mime_type: str) -> str:
    return {
        "application/pdf": ".pdf",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }[mime_type]
    load_dotenv()
def storage_config() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url.startswith("https://") or not key:
        logger.error("Supabase Storage configuration is missing or invalid")
        raise HTTPException(
            status_code=503,
            detail="Media storage is not configured."
        )
    return url, key
def storage_headers(key: str, content_type: str | None = None) -> dict:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    if content_type:
        headers["Content-Type"] = content_type
        headers["x-upsert"] = "false"
    return headers
async def read_validated_upload(
    file: UploadFile,
    allowed_types: set[str],
    max_size: int,
    label: str,
) -> dict:
    if not file.filename:
        raise HTTPException(status_code=422, detail=f"{label}: filename is missing")
    content = await file.read(max_size + 1)
    if not content:
        raise HTTPException(status_code=422, detail=f"{label}: file is empty")
    if len(content) > max_size:
        raise HTTPException(status_code=413, detail=f"{label}: file exceeds the allowed size")
    detected_type = detect_file_type(content)
    if detected_type not in allowed_types:
        raise HTTPException(status_code=422, detail=f"{label}: unsupported file format")
    if file.content_type and file.content_type.lower() != detected_type:
        raise HTTPException(status_code=422, detail=f"{label}: file format mismatch")
    if detected_type.startswith("image/"):
        try:
            with Image.open(BytesIO(content)) as image:
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=f"{label}: invalid image file") from exc
    return {
        "original_name": Path(file.filename.replace("\\", "/")).name[:180],
        "content_type": detected_type,
        "size": len(content),
        "content": content,
    }
async def upload_to_storage(
    client: httpx.AsyncClient,
    url: str,
    key: str,
    bucket: str,
    path: str,
    uploaded: dict,
) -> None:
    try:
        response = await client.post(
            f"{url}/storage/v1/object/{bucket}/{path}",
            headers=storage_headers(key, uploaded["content_type"]),
            content=uploaded["content"],
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error(
            "Supabase Storage upload failed: bucket=%s status=%s",
            bucket,
            getattr(getattr(exc, "response", None), "status_code", "network_error"),
        )
        raise HTTPException(
            status_code=503,
            detail="Unable to store uploaded media. Please try again."
        ) from exc
async def cleanup_storage(
    client: httpx.AsyncClient,
    url: str,
    key: str,
    created_files: list[tuple[str, str]],
) -> None:
    for bucket, path in reversed(created_files):
        try:
            response = await client.request(
    "DELETE",
                f"{url}/storage/v1/object/{bucket}",
                headers={
                    **storage_headers(key),
                    "Content-Type": "application/json",
                },
                json={"prefixes": [path]},
            )
            response.raise_for_status()
        except httpx.HTTPError:
            logger.exception(
                "Storage cleanup failed for bucket=%s path=%s",
                bucket,
                path,
            )
async def parse_registration_request(
    request: Request,
) -> tuple[BarberRegistrationRequest, UploadFile, list[UploadFile]]:
    content_type = request.headers.get("content-type", "").lower()
    shop_image = None
    documents: list[UploadFile] = []
    if "multipart/form-data" in content_type:
        form = await request.form(max_files=MAX_DOCUMENTS + 1, max_fields=20)
        values = {}
        for field in (
            "username", "email", "password", "years_experience",
            "shop_name", "shop_phone", "shop_address",
        ):
            value = form.get(field)
            if value is not None and not isinstance(value, UploadFile):
                values[field] = str(value)
        image_value = form.get("shop_image")
        if image_value is not None:
            if not isinstance(image_value, UploadFile):
                raise HTTPException(status_code=422, detail="Shop image must be a file")
            shop_image = image_value
        for item in form.getlist("shop_documents"):
            if not isinstance(item, UploadFile):
                raise HTTPException(status_code=422, detail="Shop documents must be files")
            documents.append(item)
    elif "application/json" in content_type:
        try:
            values = await request.json()
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid registration JSON") from exc
        if not isinstance(values, dict):
            raise HTTPException(status_code=422, detail="Registration body must be an object")
    else:
        raise HTTPException(status_code=415, detail="Use application/json or multipart/form-data")
    try:
        payload = BarberRegistrationRequest.model_validate(values)
    except ValidationError as exc:
        errors = [
            {"loc": ["body", *item["loc"]], "msg": item["msg"], "type": item["type"]}
            for item in exc.errors()
        ]
        raise HTTPException(status_code=422, detail=errors) from exc
    if shop_image is None:
        raise HTTPException(status_code=422, detail="Shop image is required")
    if not documents:
        raise HTTPException(status_code=422, detail="At least one verification document is required")
    if len(documents) > MAX_DOCUMENTS:
        raise HTTPException(status_code=422, detail=f"Maximum {MAX_DOCUMENTS} documents allowed")
    return payload, shop_image, documents
@router.post(
    "/register",
    response_model=BarberRegistrationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_barber(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    logger.info("Barber registration request received")
    payload, shop_image, documents = await parse_registration_request(request)
    url, key = storage_config()
    account_id = uuid.uuid4()
    created_files: list[tuple[str, str]] = []
    transaction_committed = False
    async with httpx.AsyncClient(timeout=45.0) as client:
        try:
            image_upload = await read_validated_upload(
                shop_image,
                ALLOWED_IMAGE_TYPES,
                MAX_SHOP_IMAGE_SIZE,
                "Shop image",
            )
            document_uploads = []
            for index, document in enumerate(documents, start=1):
                uploaded = await read_validated_upload(
                    document,
                    ALLOWED_DOCUMENT_TYPES,
                    MAX_DOCUMENT_SIZE,
                    f"Document {index}",
                )
                document_uploads.append(uploaded)
            image_path = (
                f"barbers/{account_id}/shop/"
                f"{uuid.uuid4().hex}{file_extension(image_upload['content_type'])}"
            )
            await upload_to_storage(
                client, url, key, SHOP_IMAGE_BUCKET, image_path, image_upload
            )
            created_files.append((SHOP_IMAGE_BUCKET, image_path))
            document_paths = []
            for uploaded in document_uploads:
                document_path = (
                    f"barbers/{account_id}/documents/"
                    f"{uuid.uuid4().hex}{file_extension(uploaded['content_type'])}"
                )
                await upload_to_storage(
                    client, url, key, DOCUMENT_BUCKET, document_path, uploaded
                )
                created_files.append((DOCUMENT_BUCKET, document_path))
                document_paths.append({
                    "path": document_path,
                    "original_name": uploaded["original_name"],
                    "content_type": uploaded["content_type"],
                    "size": uploaded["size"],
                    "document_type": "other",
                })
            hashed_password = password_hasher.hash(payload.password)
            new_account = BarberAccount(
                id=account_id,
                username=payload.username,
                email=str(payload.email),
                password_hash=hashed_password,
                years_experience=payload.years_experience,
                shop_name=payload.shop_name,
                shop_phone=payload.shop_phone,
                shop_address=payload.shop_address,
                shop_image_path=image_path,
                document_paths=document_paths,
                approval_status="pending",
                is_email_activated=False,
            )
            db.add(new_account)
            await db.flush()
            await db.commit()
            transaction_committed = True
            logger.info(
                "Barber registration saved with Supabase Storage: %s",
                account_id,
            )
            return BarberRegistrationResponse(
                id=account_id,
                status="pending",
                message="Registration submitted successfully. Your application is pending admin approval.",
            )
        except IntegrityError as exc:
            if not transaction_committed:
                await db.rollback()
                await cleanup_storage(client, url, key, created_files)
            logger.exception("Integrity error during barber registration")
            raise HTTPException(
                status_code=409,
                detail="Registration conflicts with an existing account or database constraint.",
            ) from exc
        except SQLAlchemyError as exc:
            if not transaction_committed:
                await db.rollback()
                await cleanup_storage(client, url, key, created_files)
            logger.exception("Database error during registration")
            raise HTTPException(
                status_code=503,
                detail="Registration service is temporarily unavailable.",
            ) from exc
        except Exception:
            if not transaction_committed:
                await db.rollback()
                await cleanup_storage(client, url, key, created_files)
            logger.exception("Barber registration failed")
            raise