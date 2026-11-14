"""
KSHURAK - MULTI-MODEL THREE-ANGLE HAIRSTYLE TRY-ON

Endpoints:
GET  /api/v1/tryon/health
POST /api/v1/tryon/analyze-style
POST /api/v1/tryon/generate-angle
POST /api/v1/tryon/generate

The /generate endpoint is compatible with the existing
Kshurak React frontend.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import logging
import os
import random
import re
import time

from pathlib import Path
from dotenv import load_dotenv
from typing import Literal
from uuid import UUID
from PIL import Image, ImageOps, UnidentifiedImageError

import httpx
from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from google import genai
from google.genai import types
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/tryon",
    tags=["Virtual Try-On"]
)


# ============================================================
# CONFIGURATION
# ============================================================

MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 12_000_000

INPUT_MAX_SIDE = 1024
OUTPUT_MAX_SIZE = (720, 960)

ANGLE_NAMES = {
    "front": "front-facing view",
    "left": "left-side 45-degree view",
    "right": "right-side 45-degree view",
}


def env_bool(name: str, default: bool) -> bool:
    return os.getenv(
        name, str(default)
    ).strip().lower() in (
        "1", "true", "yes", "on"
    )


def env_int(
    name: str,
    default: int,
    maximum: int
) -> int:
    try:
        return max(
            0,
            min(
                int(os.getenv(name, str(default))),
                maximum
            )
        )
    except ValueError:
        return default


# ============================================================
# THREE GEMINI IMAGE MODELS
# ============================================================

# Resolve backend/.env independently of the process working directory.
BACKEND_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(BACKEND_ROOT / ".env", override=False)


def image_models() -> list[str]:
    """Return image-capable Gemini models configured exclusively in .env."""
    raw = os.getenv("GEMINI_IMAGE_MODELS", "").strip()
    models = list(dict.fromkeys(
        item.strip() for item in raw.split(",") if item.strip()
    ))
    if not models:
        raise RuntimeError("GEMINI_IMAGE_MODELS is missing in backend/.env")
    return models


def vision_model() -> str:
    """Return the text/vision analysis model configured in .env."""
    model = os.getenv("GEMINI_VISION_MODEL", "").strip()
    if not model:
        raise RuntimeError("GEMINI_VISION_MODEL is missing in backend/.env")
    return model


def get_gemini_client():
    api_key = os.getenv(
        "GEMINI_API_KEY", ""
    ).strip()

    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is missing"
        )

    return genai.Client(api_key=api_key)


# ============================================================
# REQUEST MODELS
# ============================================================

class StyleAnalysisRequest(BaseModel):
    scan_id: UUID

    hairstyle_id: str = Field(
        min_length=1,
        max_length=100
    )

    hairstyle_name: str = Field(
        min_length=1,
        max_length=100
    )

    hairstyle_reference: str


class AngleTryOnRequest(StyleAnalysisRequest):

    angle: Literal[
        "front",
        "left",
        "right"
    ]

    source_image: str

    style_description: str = Field(
        default="",
        max_length=4000
    )

    consistency_reference: str | None = None


class ThreeAngleRequest(StyleAnalysisRequest):

    front_image: str
    left_image: str
    right_image: str

    face_shape: str = ""


# ============================================================
# IMAGE DECODING
# ============================================================

def decode_image(encoded: str) -> Image.Image:

    try:
        if not isinstance(encoded, str) or not encoded:
            raise ValueError("Empty image")

        payload = encoded.split(",", 1)[-1].strip()

        maximum_encoded = (
            ((MAX_SOURCE_BYTES + 2) // 3) * 4 + 16
        )

        if len(payload) > maximum_encoded:
            raise ValueError("Image too large")

        raw = base64.b64decode(
            payload,
            validate=True
        )

        if len(raw) > MAX_SOURCE_BYTES:
            raise ValueError("Image too large")

        with Image.open(io.BytesIO(raw)) as opened:

            if opened.width * opened.height > MAX_PIXELS:
                raise ValueError(
                    "Image resolution too large"
                )

            corrected = ImageOps.exif_transpose(opened)

            return corrected.convert("RGB")

    except (
        ValueError,
        binascii.Error,
        OSError,
        UnidentifiedImageError
    ) as exc:

        raise HTTPException(
            status_code=422,
            detail="Invalid or oversized source/reference image"
        ) from exc


def resize_for_model(
    image: Image.Image
) -> Image.Image:

    result = image.convert("RGB").copy()

    result.thumbnail(
        (INPUT_MAX_SIDE, INPUT_MAX_SIDE),
        Image.Resampling.LANCZOS
    )

    return result


def encode_output(
    image: Image.Image
) -> tuple[str, int, int]:

    result = ImageOps.exif_transpose(
        image
    ).convert("RGB")

    result.thumbnail(
        OUTPUT_MAX_SIZE,
        Image.Resampling.LANCZOS
    )

    buffer = io.BytesIO()

    result.save(
        buffer,
        format="JPEG",
        quality=88,
        optimize=True
    )

    encoded = base64.b64encode(
        buffer.getvalue()
    ).decode("ascii")

    return (
        encoded,
        result.width,
        result.height
    )


# ============================================================
# GEMINI RESPONSE HELPERS
# ============================================================

def text_of(response) -> str:

    chunks = []

    candidates = getattr(
        response, "candidates", None
    ) or []

    for candidate in candidates:

        content = getattr(
            candidate, "content", None
        )

        parts = getattr(
            content, "parts", None
        ) or []

        for part in parts:
            value = getattr(part, "text", None)

            if value:
                chunks.append(value)

    result = "\n".join(chunks).strip()

    if result:
        return result

    return str(
        getattr(response, "text", "") or ""
    ).strip()


def extract_image(response) -> Image.Image:

    candidates = getattr(
        response, "candidates", None
    ) or []

    for index, candidate in enumerate(candidates):

        content = getattr(
            candidate, "content", None
        )

        parts = getattr(
            content, "parts", None
        ) or []

        for part in parts:

            inline = getattr(
                part, "inline_data", None
            )

            if inline is None:
                continue

            raw = getattr(
                inline, "data", None
            )

            if not raw:
                continue

            mime = str(
                getattr(inline, "mime_type", "") or ""
            )

            if mime and not mime.startswith("image/"):
                continue

            try:
                if isinstance(raw, str):
                    raw = base64.b64decode(raw)

                with Image.open(
                    io.BytesIO(raw)
                ) as opened:

                    return opened.convert("RGB")

            except Exception:
                logger.exception(
                    "Unreadable Gemini image candidate=%s",
                    index
                )

        logger.warning(
            "Gemini candidate=%s finish_reason=%s",
            index,
            getattr(
                candidate, "finish_reason", None
            )
        )

    logger.warning(
        "Gemini returned no image; feedback=%s text=%s",
        getattr(response, "prompt_feedback", None),
        text_of(response)[:350]
    )

    raise RuntimeError(
        "Gemini returned no generated image"
    )


# ============================================================
# SUPABASE USER VERIFICATION
# ============================================================

async def verify_owner(
    access_token: str,
    scan_id: UUID
) -> None:

    base_url = os.getenv(
        "SUPABASE_URL", ""
    ).rstrip("/")

    anon_key = os.getenv(
        "SUPABASE_ANON_KEY", ""
    )

    if not base_url or not anon_key:
        raise HTTPException(
            status_code=503,
            detail="Supabase configuration missing"
        )

    headers = {
        "apikey": anon_key,
        "Authorization": f"Bearer {access_token}"
    }

    try:
        async with httpx.AsyncClient(
            timeout=20
        ) as client:

            auth = await client.get(
                f"{base_url}/auth/v1/user",
                headers=headers
            )

            if auth.status_code != 200:
                raise HTTPException(
                    status_code=401,
                    detail="Invalid login session"
                )

            user_id = auth.json().get("id")

            if not user_id:
                raise HTTPException(
                    status_code=401,
                    detail="User authentication failed"
                )

            scans = await client.get(
                f"{base_url}/rest/v1/face_scans",
                headers=headers,
                params={
                    "select": "id,profile_id",
                    "id": f"eq.{scan_id}",
                    "limit": "1"
                }
            )

            if scans.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail="Unable to verify face scan"
                )

            rows = scans.json()

            if not rows:
                raise HTTPException(
                    status_code=403,
                    detail="Face scan not accessible"
                )

            profile_id = rows[0].get("profile_id")

            if not profile_id:
                raise HTTPException(
                    status_code=403,
                    detail="Scan profile missing"
                )

            profiles = await client.get(
                f"{base_url}/rest/v1/profiles",
                headers=headers,
                params={
                    "select": "id",
                    "id": f"eq.{profile_id}",
                    "auth_user_id": f"eq.{user_id}",
                    "limit": "1"
                }
            )

            if profiles.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail="Unable to verify profile ownership"
                )

            if not profiles.json():
                raise HTTPException(
                    status_code=403,
                    detail="You do not own this face scan"
                )

    except httpx.HTTPError as exc:

        logger.exception(
            "Supabase ownership check failed"
        )

        raise HTTPException(
            status_code=502,
            detail="Authentication service unavailable"
        ) from exc


def bearer_token(authorization: str) -> str:

    scheme, _, token = authorization.partition(" ")

    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=401,
            detail="Login required"
        )

    return token.strip()


# ============================================================
# HAIRSTYLE REFERENCE ANALYSIS
# ============================================================

def analyze_style(
    reference: Image.Image,
    hairstyle_name: str
) -> str:

    prompt = f"""
You are an expert professional barber.

Analyze the supplied front-facing hairstyle reference.

SELECTED HAIRSTYLE:
{hairstyle_name}

Describe:

1. Actual hair length on top.
2. Side hair length, if visible.
3. Fade or taper.
4. Hairline and fringe.
5. Hair texture.
6. Overall hair volume.
7. Styling direction.
8. Silhouette and distinguishing haircut features.

IMPORTANT:
- Describe only the hairstyle.
- Do not describe the reference person's face.
- Do not invent details of hidden sides.
- Make conservative inferences about the side views.
- Keep the specification suitable for applying the
  same haircut to front, left, and right photographs.

Return a concise technical haircut specification.
"""

    client = get_gemini_client()

    response = client.models.generate_content(
        model=vision_model(),
        contents=[
            resize_for_model(reference),
            prompt
        ]
    )

    result = text_of(response)

    if not result:
        raise RuntimeError(
            "Could not analyze selected hairstyle"
        )

    return result[:4000]


# ============================================================
# ANGLE-SPECIFIC HAIRSTYLE PROMPT
# ============================================================

def edit_prompt(
    name: str,
    angle: str,
    description: str,
    retry_note: str = ""
) -> str:

    return f"""
TASK: PHOTOREALISTIC HAIRSTYLE IMAGE EDITING.

IMAGE 1:
The customer's original {ANGLE_NAMES[angle]} photograph.

IMAGE 2:
The selected hairstyle reference.

SELECTED HAIRSTYLE:
{name}

HAIRCUT SPECIFICATION:
{description or name}

PRIMARY OBJECTIVE:
Apply the selected hairstyle from IMAGE 2
to the original customer in IMAGE 1.

IDENTITY PRESERVATION:
- Keep the customer's original face.
- Preserve face shape.
- Preserve eyes, nose, lips, and ears.
- Preserve original skin tone.
- Preserve beard and moustache.
- Preserve facial expression.
- Preserve head orientation.
- Preserve camera perspective.
- Preserve clothes.
- Preserve background.
- Preserve lighting and shadows.

HAIRSTYLE TRANSFORMATION:
- Change only the hair on the customer's scalp.
- Match the reference haircut's top length.
- Match hair volume and silhouette.
- Match hair texture and styling direction.
- Match the fringe and hairline where appropriate.
- Match side taper or fade when visible.
- Interpret unseen parts realistically.

ANGLE REQUIREMENT:
Preserve the exact {ANGLE_NAMES[angle]} viewpoint.

Do not change left-facing or right-facing
head positions into front-facing portraits.

IMAGE PRIORITY:
IMAGE 1 controls identity, pose, lighting and background.
IMAGE 2 controls the target scalp hairstyle.

DO NOT:
- Copy the reference model's face.
- Change the customer's facial structure.
- Generate an unrelated hairstyle.
- Return the unchanged original photograph.
- Add text, watermarks, or collages.

RETRY INSTRUCTION:
{retry_note}

FINAL OUTPUT:
Return exactly ONE realistic edited photograph
of the original customer with the selected
'{name}' hairstyle visibly applied.
"""


# ============================================================
# TRANSIENT API ERROR DETECTION
# ============================================================

def is_transient(exc: Exception) -> bool:

    message = str(exc).lower()

    status = (
        getattr(exc, "status_code", None)
        or getattr(exc, "code", None)
    )

    try:
        status = int(status)
    except (ValueError, TypeError):
        status = None

    if status in (
        408, 429, 500, 502, 503, 504
    ):
        return True

    transient_messages = (
        "returned no generated image",
        "resource_exhausted",
        "rate limit",
        "too many requests",
        "timeout",
        "timed out",
        "temporarily unavailable",
        "service unavailable",
        "connection reset",
        " 429",
        " 502",
        " 503",
        " 504",
    )

    return any(
        word in message
        for word in transient_messages
    )


# ============================================================
# AI HAIRSTYLE QUALITY VALIDATION
# ============================================================

def validate_image(
    client,
    original: Image.Image,
    generated: Image.Image,
    reference: Image.Image,
    name: str,
    angle: str,
    description: str
) -> tuple[bool, str]:

    prompt = f"""
Evaluate this virtual hairstyle transformation.

IMAGE 1: Original customer photograph.
IMAGE 2: AI-generated hairstyle photograph.
IMAGE 3: Selected hairstyle reference.

Selected hairstyle: {name}
Requested angle: {ANGLE_NAMES[angle]}

Haircut specification:
{description}

Evaluate:

1. Is IMAGE 2 recognizably the same customer?
2. Is the original head orientation preserved?
3. Does the generated hairstyle resemble
   the selected hairstyle?
4. Is the hairstyle realistically applied?

Do not require a side-view image to look
like a front-facing photograph.

If the original hairstyle already resembles
the target, a subtle edit is acceptable.

Return only valid JSON:

{{
    "passed": true,
    "feedback": "brief reason"
}}

Set passed=false if the hairstyle is clearly
incorrect or the person's identity is changed.
"""

    response = client.models.generate_content(
        model=vision_model(),
        contents=[
            resize_for_model(original),
            resize_for_model(generated),
            resize_for_model(reference),
            prompt
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json"
        )
    )

    raw = text_of(response)

    raw = re.sub(
        r"^```(?:json)?\s*|\s*```$",
        "",
        raw,
        flags=re.IGNORECASE
    )

    payload = json.loads(raw)

    if (
        not isinstance(payload, dict)
        or not isinstance(payload.get("passed"), bool)
    ):
        raise ValueError(
            "Unexpected validation response"
        )

    return (
        payload["passed"],
        str(payload.get("feedback", ""))[:700]
    )


# ============================================================
# MULTI-MODEL GENERATION FOR ONE ANGLE
# ============================================================

def generate_one_angle(
    source: Image.Image,
    reference: Image.Image,
    hairstyle_name: str,
    angle: str,
    description: str
) -> dict:

    client = get_gemini_client()

    retries = env_int(
        "TRYON_MAX_RETRIES",
        2,
        4
    )

    validate = env_bool(
        "TRYON_VALIDATE",
        False
    )

    validation_strict = env_bool(
        "TRYON_VALIDATION_STRICT",
        False
    )

    failures = []

    # Try configured models in order.
    for model in image_models():

        for attempt in range(retries + 1):

            logger.info(
                "Try-on angle=%s model=%s attempt=%s",
                angle,
                model,
                attempt + 1
            )

            retry_note = ""

            if attempt > 0:
                retry_note = (
                    "Previous generation produced no usable edit. "
                    "Generate a clear hairstyle transformation."
                )

            try:
                response = client.models.generate_content(
                    model=model,
                    contents=[
                        resize_for_model(source),
                        resize_for_model(reference),
                        edit_prompt(
                            hairstyle_name,
                            angle,
                            description,
                            retry_note
                        )
                    ],
                    config=types.GenerateContentConfig(
                        response_modalities=["IMAGE"]
                    )
                )

                generated = extract_image(response)

                verified = None
                feedback = "Validation disabled"

                # Validation is optional.
                if validate:
                    try:
                        verified, feedback = validate_image(
                            client,
                            source,
                            generated,
                            reference,
                            hairstyle_name,
                            angle,
                            description
                        )

                    except Exception as validation_exc:
                        verified = None
                        feedback = "Validation unavailable"

                        logger.warning(
                            "Validation unavailable angle=%s: %s",
                            angle,
                            validation_exc
                        )

                    if validation_strict and verified is not True:
                        failures.append(
                            f"{model}: validation rejected: {feedback}"
                        )
                        continue

                image_base64, width, height = encode_output(
                    generated
                )

                logger.info(
                    "Try-on success angle=%s model=%s attempt=%s",
                    angle,
                    model,
                    attempt + 1
                )

                return {
                    "image": image_base64,
                    "width": width,
                    "height": height,
                    "verified": verified,
                    "attempts": attempt + 1,
                    "model": model,
                    "validation_feedback": feedback
                }

            except Exception as exc:

                logger.exception(
                    "Try-on error angle=%s model=%s attempt=%s",
                    angle,
                    model,
                    attempt + 1
                )

                failures.append(
                    f"{model}: {type(exc).__name__}: "
                    f"{str(exc)[:150]}"
                )

                # Skip the remaining attempts for permanent errors.
                if not is_transient(exc):
                    break

                # Exponential backoff for temporary failures.
                if attempt < retries:
                    delay = min(
                        1.5 * (2 ** attempt)
                        + random.uniform(0, 0.5),
                        8
                    )

                    time.sleep(delay)

    # Never return the original photo as a fake success.
    raise RuntimeError(
        f"Could not generate {angle} hairstyle. "
        + " | ".join(failures[-4:])
    )


# ============================================================
# THREE-ANGLE GENERATION PIPELINE
# ============================================================

def generate_three(
    source_images: dict[str, Image.Image],
    reference: Image.Image,
    hairstyle_name: str,
    description: str
) -> tuple[dict, dict]:

    images = {}
    errors = {}

    # Sequential generation limits simultaneous API load.
    for angle in ("front", "left", "right"):

        try:
            logger.info(
                "Starting hairstyle generation angle=%s",
                angle
            )

            images[angle] = generate_one_angle(
                source=source_images[angle],
                reference=reference,
                hairstyle_name=hairstyle_name,
                angle=angle,
                description=description
            )

        except Exception as exc:

            logger.exception(
                "Three-angle generation failed angle=%s",
                angle
            )

            errors[angle] = str(exc)[:500]

    return images, errors


# ============================================================
# HEALTH CHECK
# ============================================================

@router.get("/health")
async def health():

    return {
        "status": "ok",
        "service": "Kshurak Virtual Try-On",
        "image_models": image_models(),
        "vision_model": vision_model(),
        "validation_enabled": env_bool(
            "TRYON_VALIDATE",
            False
        ),
        "validation_strict": env_bool(
            "TRYON_VALIDATION_STRICT",
            False
        ),
        "max_retries": env_int(
            "TRYON_MAX_RETRIES",
            2,
            4
        )
    }


# ============================================================
# ANALYZE SELECTED HAIRSTYLE
# ============================================================

@router.post("/analyze-style")
async def analyze_hairstyle_endpoint(
    request: StyleAnalysisRequest,
    authorization: str = Header(default="")
):

    token = bearer_token(authorization)

    await verify_owner(
        token,
        request.scan_id
    )

    reference = decode_image(
        request.hairstyle_reference
    )

    try:
        description = await run_in_threadpool(
            analyze_style,
            reference,
            request.hairstyle_name
        )

        return {
            "success": True,
            "hairstyle_id": request.hairstyle_id,
            "hairstyle_name": request.hairstyle_name,
            "style_description": description
        }

    except Exception as exc:

        logger.exception(
            "Hairstyle analysis failed"
        )

        raise HTTPException(
            status_code=502,
            detail="Could not analyze selected hairstyle"
        ) from exc


# ============================================================
# GENERATE SINGLE ANGLE
# ============================================================

@router.post("/generate-angle")
async def generate_angle(
    request: AngleTryOnRequest,
    authorization: str = Header(default="")
):

    token = bearer_token(authorization)

    await verify_owner(
        token,
        request.scan_id
    )

    source = decode_image(
        request.source_image
    )

    reference = decode_image(
        request.hairstyle_reference
    )

    try:
        output = await run_in_threadpool(
            generate_one_angle,
            source,
            reference,
            request.hairstyle_name,
            request.angle,
            request.style_description
        )

    except Exception as exc:

        logger.exception(
            "Angle generation failed: %s",
            request.angle
        )

        raise HTTPException(
            status_code=502,
            detail=(
                f"Generation failed for {request.angle}. "
                "Check backend logs."
            )
        ) from exc

    return {
        "success": True,
        "scan_id": str(request.scan_id),
        "hairstyle_id": request.hairstyle_id,
        "hairstyle_name": request.hairstyle_name,
        "angle": request.angle,
        "image": output["image"],
        "width": output["width"],
        "height": output["height"],
        "mime_type": "image/jpeg",
        "verified": output["verified"],
        "attempts": output["attempts"],
        "model": output["model"],
        "validation_feedback": output[
            "validation_feedback"
        ]
    }


# ============================================================
# GENERATE ALL THREE ANGLES
# FRONT + LEFT + RIGHT
# ============================================================

@router.post("/generate")
async def generate_all_angles(
    request: ThreeAngleRequest,
    authorization: str = Header(default="")
):

    token = bearer_token(authorization)

    await verify_owner(
        token,
        request.scan_id
    )

    sources = {
        "front": decode_image(
            request.front_image
        ),
        "left": decode_image(
            request.left_image
        ),
        "right": decode_image(
            request.right_image
        )
    }

    reference = decode_image(
        request.hairstyle_reference
    )

    # Analyze reference once.
    try:
        description = await run_in_threadpool(
            analyze_style,
            reference,
            request.hairstyle_name
        )

    except Exception:
        logger.exception(
            "Hairstyle specification unavailable; "
            "using selected hairstyle name"
        )

        description = request.hairstyle_name

    # Generate three views.
    results, errors = await run_in_threadpool(
        generate_three,
        sources,
        reference,
        request.hairstyle_name,
        description
    )

    generated_images = {
        angle: result["image"]
        for angle, result in results.items()
    }

    angle_status = {
        angle: {
            key: value
            for key, value in result.items()
            if key != "image"
        }
        for angle, result in results.items()
    }

    # Return partial results if any angle fails.
    if errors:
        return {
            "success": False,
            "scan_id": str(request.scan_id),
            "hairstyle_id": request.hairstyle_id,
            "hairstyle_name": request.hairstyle_name,
            "generated_images": generated_images,
            "angle_status": angle_status,
            "angle_errors": errors,
            "detail": (
                "Some angles could not be generated. "
                "See angle_errors."
            )
        }

    # All three images generated.
    return {
        "success": True,
        "scan_id": str(request.scan_id),
        "hairstyle_id": request.hairstyle_id,
        "hairstyle_name": request.hairstyle_name,
        "generated_images": generated_images,
        "angle_status": angle_status
    }

