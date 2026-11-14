
"""
KSHURAK Admin - Private Barber Media Service

Creates temporary Supabase Storage signed URLs
for files uploaded during Barber registration.

Buckets:
- shop-images
- barber-documents

Security:
- Called only from Admin-authenticated endpoints.
- File paths must belong to the requested Barber.
- No service-role key is sent to the frontend.
- Signed URLs expire after 5 minutes.
- No database changes.
"""

import logging
import os
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx
from dotenv import load_dotenv


logger = logging.getLogger(
    "kshurak.admin.barber_media"
)

SIGNED_URL_EXPIRY_SECONDS = 300

SHOP_IMAGE_BUCKET = "shop-images"
DOCUMENT_BUCKET = "barber-documents"


def _storage_credentials() -> tuple[str, str]:
    load_dotenv()

    supabase_url = os.getenv(
        "SUPABASE_URL", ""
    ).strip().rstrip("/")

    service_role_key = os.getenv(
        "SUPABASE_SERVICE_ROLE_KEY", ""
    ).strip()

    if (
        not supabase_url.startswith("https://")
        or not service_role_key
    ):
        raise RuntimeError(
            "Supabase Storage is not configured."
        )

    return supabase_url, service_role_key


def _validate_path(
    barber_id: UUID,
    bucket: str,
    path: str,
) -> bool:
    """
    Only allow files in the Barber's own
    registration storage directories.
    """

    if not isinstance(path, str):
        return False

    path = path.strip()

    if not path:
        return False

    if (
        ".." in path
        or "\\" in path
        or "?" in path
        or "#" in path
        or path.startswith("/")
    ):
        return False

    allowed_prefix = {
        SHOP_IMAGE_BUCKET: (
            f"barbers/{barber_id}/shop/"
        ),
        DOCUMENT_BUCKET: (
            f"barbers/{barber_id}/documents/"
        ),
    }.get(bucket)

    if not allowed_prefix:
        return False

    return path.startswith(
        allowed_prefix
    ) and len(path) > len(allowed_prefix)


async def create_signed_media_url(
    barber_id: UUID,
    bucket: str,
    path: str | None,
) -> str | None:
    """
    Request a temporary URL from Supabase Storage.

    Returns None when the path is missing,
    invalid, or signing fails.
    """

    if not path:
        return None

    if not _validate_path(
        barber_id,
        bucket,
        path,
    ):
        logger.warning(
            "Rejected invalid Barber media reference: "
            "barber=%s bucket=%s",
            barber_id,
            bucket,
        )
        return None

    try:
        supabase_url, key = (
            _storage_credentials()
        )

        encoded_path = quote(
            path,
            safe="/",
        )

        endpoint = (
            f"{supabase_url}"
            f"/storage/v1/object/sign/"
            f"{bucket}/{encoded_path}"
        )

        async with httpx.AsyncClient(
            timeout=15.0,
        ) as client:
            response = await client.post(
                endpoint,
                headers={
                    "apikey": key,
                    "Authorization": (
                        f"Bearer {key}"
                    ),
                    "Content-Type": (
                        "application/json"
                    ),
                },
                json={
                    "expiresIn": (
                        SIGNED_URL_EXPIRY_SECONDS
                    )
                },
            )

            response.raise_for_status()

            payload = response.json()

        signed_path = (
            payload.get("signedURL")
            or payload.get("signedUrl")
        )

        if not isinstance(
            signed_path, str
        ) or not signed_path:
            return None

        # Supabase commonly returns:
        # /object/sign/bucket/path?token=...

        if signed_path.startswith(
            "/storage/v1/"
        ):
            return (
                f"{supabase_url}{signed_path}"
            )

        if signed_path.startswith(
            "/object/"
        ):
            return (
                f"{supabase_url}"
                f"/storage/v1{signed_path}"
            )

        # Reject unexpected URL formats rather
        # than returning an unverified destination.
        logger.warning(
            "Unexpected signed URL format "
            "for Barber %s",
            barber_id,
        )
        return None

    except (
        httpx.HTTPError,
        ValueError,
        RuntimeError,
    ):
        logger.exception(
            "Unable to sign Barber media: "
            "barber=%s bucket=%s",
            barber_id,
            bucket,
        )
        return None


async def prepare_registration_media(
    barber_id: UUID,
    shop_image_path: str | None,
    document_paths: Any,
) -> dict:
    """
    Prepare shop image URL and document URLs.

    Preserves existing document metadata
    while adding signed_url to each document.
    """

    shop_image_url = (
        await create_signed_media_url(
            barber_id=barber_id,
            bucket=SHOP_IMAGE_BUCKET,
            path=shop_image_path,
        )
    )

    if not isinstance(
        document_paths, list
    ):
        document_paths = []

    signed_documents = []

    for document in document_paths:

        if isinstance(document, str):
            item = {
                "path": document
            }

        elif isinstance(document, dict):
            item = document.copy()

        else:
            continue

        document_path = item.get(
            "path"
        )

        signed_url = (
            await create_signed_media_url(
                barber_id=barber_id,
                bucket=DOCUMENT_BUCKET,
                path=document_path,
            )
        )

        item["signed_url"] = signed_url

        signed_documents.append(item)

    return {
        "shop_image_url": shop_image_url,
        "signed_documents": signed_documents,
        "signed_url_expires_in": (
            SIGNED_URL_EXPIRY_SECONDS
        ),
    }
