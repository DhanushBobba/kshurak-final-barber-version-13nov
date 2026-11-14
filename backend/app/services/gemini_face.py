
"""Kshurak - Gemini three-angle facial analysis."""

import base64
import binascii
import json
import logging
import math
import os
import re
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import errors, types


# ---------------------------------------------------------
# Configuration
# ---------------------------------------------------------

BACKEND_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_ROOT / ".env", override=False)

logger = logging.getLogger(__name__)

FACE_SHAPES = {
    "oval": "Oval",
    "round": "Round",
    "square": "Square",
    "diamond": "Diamond",
    "heart": "Heart",
    "oblong": "Oblong",
    "triangular": "Triangular",
    "triangle": "Triangular",
}

METRIC_FIELDS = [
    "faceLength",
    "faceWidth",
    "faceRatio",
    "foreheadWidth",
    "foreheadHeight",
    "cheekboneWidth",
    "jawWidth",
    "jawAngle",
    "faceSymmetry",
]


# ---------------------------------------------------------
# Gemini analysis prompt
# ---------------------------------------------------------

PROMPT = """
You are a facial geometry analysis system for a professional
men's hairstyle recommendation platform.

Analyze ONLY the three newly provided photographs:
1. Front-facing photograph
2. Left profile photograph
3. Right profile photograph

Use all three images together to assess facial proportions.

The frontend supports EXACTLY seven face-shape categories:
Oval, Round, Square, Diamond, Heart, Oblong, Triangular.

You MUST classify the face into the most suitable of these
seven categories, based on the visible facial geometry.

Evaluate:
- Overall face length versus width
- Forehead width and height
- Cheekbone prominence and width
- Jaw width and jawline shape
- Chin shape
- Left and right profile proportions
- Estimated facial symmetry

If the face resembles a category outside these seven,
compare its actual geometric characteristics against all
seven supported categories and select the closest match.

Do not mechanically convert one category into another.
Do not assume Oval or favor any category.
Do not use database records, previous predictions,
user profiles, or previously stored face shapes.

If the supplied images are insufficient for a meaningful
classification, return an empty faceShape.

Use relative measurements where actual scale is unknown.
Do not invent physical measurement values.
Use null for measurements that cannot be estimated.
Confidence must be between 0 and 100.

Return valid JSON only, using this structure.
The empty values below are placeholders, NOT predictions:

{
    "faceShape": "",
    "confidence": null,
    "metrics": {
        "faceLength": null,
        "faceWidth": null,
        "faceRatio": null,
        "foreheadWidth": null,
        "foreheadHeight": null,
        "cheekboneWidth": null,
        "jawWidth": null,
        "jawAngle": null,
        "jawlineShape": "",
        "faceSymmetry": null
    },
    "analysisSummary": "",
    "recommendedHairstyles": []
}

Replace faceShape with the selected supported category.
Provide an evidence-based confidence score.
"""


# ---------------------------------------------------------
# Gemini model configuration
# ---------------------------------------------------------

def configured_models() -> list[str]:
    raw = os.getenv("GEMINI_FACE_MODELS", "").strip()

    models = [
        model.strip()
        for model in raw.split(",")
        if model.strip()
    ]

    models = list(dict.fromkeys(models))

    if not models:
        raise RuntimeError(
            "GEMINI_FACE_MODELS is missing from backend/.env"
        )

    return models


def get_gemini_client():
    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is missing from backend/.env"
        )

    return genai.Client(api_key=api_key)


# ---------------------------------------------------------
# Image decoding
# ---------------------------------------------------------

def decode_image(image: str) -> tuple[bytes, str]:
    if not isinstance(image, str) or not image.strip():
        raise ValueError("Face image is missing")

    image = image.strip()
    mime_type = "image/jpeg"

    if image.startswith("data:"):
        header, separator, payload = image.partition(",")

        if not separator or ";base64" not in header.lower():
            raise ValueError("Invalid image data URL")

        mime_type = header[5:].split(";", 1)[0].lower()
        image = payload

    if mime_type not in {
        "image/jpeg",
        "image/png",
        "image/webp",
    }:
        raise ValueError("Unsupported image format")

    try:
        image_bytes = base64.b64decode(
            re.sub(r"\s+", "", image),
            validate=True,
        )
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 image") from exc

    if not image_bytes:
        raise ValueError("Empty image")

    if len(image_bytes) > 12 * 1024 * 1024:
        raise ValueError("Image exceeds the 12 MB limit")

    if image_bytes.startswith(b"\xff\xd8\xff"):
        actual_mime = "image/jpeg"

    elif image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        actual_mime = "image/png"

    elif (
        image_bytes[:4] == b"RIFF"
        and image_bytes[8:12] == b"WEBP"
    ):
        actual_mime = "image/webp"

    else:
        raise ValueError(
            "Image content is not JPEG, PNG or WEBP"
        )

    return image_bytes, actual_mime


# ---------------------------------------------------------
# JSON and metric normalization
# ---------------------------------------------------------

def clean_json(text: str) -> str:
    text = text.strip()
    text = re.sub(
        r"^```(?:json)?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def extract_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        number = float(value)

    else:
        match = re.search(
            r"-?\d+(?:\.\d+)?",
            str(value),
        )

        if not match:
            return None

        number = float(match.group())

    return number if math.isfinite(number) else None


def normalize_metrics(metrics: Any) -> dict:
    if not isinstance(metrics, dict):
        metrics = {}

    normalized = {
        field: extract_number(metrics.get(field))
        for field in METRIC_FIELDS
    }

    normalized["jawlineShape"] = str(
        metrics.get("jawlineShape") or ""
    ).strip()

    return normalized


def normalize_result(result: Any) -> dict:
    if not isinstance(result, dict):
        raise ValueError(
            "Gemini returned an invalid analysis object"
        )

    raw_shape = str(
        result.get("faceShape") or ""
    ).strip()

    shape = FACE_SHAPES.get(
        raw_shape.lower().replace("-", " ")
    )

    if not shape:
        raise ValueError(
            f"Unsupported face shape: {raw_shape}"
        )

    confidence = extract_number(
        result.get("confidence")
    )

    if confidence is not None:
        confidence = max(
            0.0,
            min(100.0, confidence),
        )

    hairstyles = result.get(
        "recommendedHairstyles", []
    )

    if not isinstance(hairstyles, list):
        hairstyles = []

    hairstyles = [
        hairstyle.strip()
        for hairstyle in hairstyles
        if isinstance(hairstyle, str)
        and hairstyle.strip()
    ]

    return {
        "faceShape": shape,
        "confidence": confidence,
        "metrics": normalize_metrics(
            result.get("metrics", {})
        ),
        "analysisSummary": str(
            result.get("analysisSummary") or ""
        ).strip(),
        "recommendedHairstyles": hairstyles,
    }


# ---------------------------------------------------------
# Safe Gemini error diagnostics
# ---------------------------------------------------------

def describe_error(exc: Exception) -> str:
    if isinstance(exc, errors.APIError):
        return (
            f"{type(exc).__name__}"
            f"(code={exc.code}, status={exc.status})"
        )

    return type(exc).__name__


# ---------------------------------------------------------
# Main face-analysis function
# ---------------------------------------------------------

def analyze_face(
    front: str,
    left: str,
    right: str,
) -> dict:

    models = configured_models()

    images = [
        decode_image(front),
        decode_image(left),
        decode_image(right),
    ]

    image_parts = [
        types.Part.from_bytes(
            data=image_bytes,
            mime_type=mime_type,
        )
        for image_bytes, mime_type in images
    ]

    failures = []

    logger.info(
        "Starting three-angle face analysis; models=%s",
        models,
    )

    with get_gemini_client() as client:

        for model in models:

            logger.info(
                "Trying Gemini face model: %s",
                model,
            )

            try:
                response = client.models.generate_content(
                    model=model,
                    contents=[
                        types.Content(
                            role="user",
                            parts=[
                                types.Part.from_text(
                                    text=PROMPT
                                ),
                                *image_parts,
                            ],
                        )
                    ],
                    config=types.GenerateContentConfig(
                        temperature=0.2,
                        response_mime_type="application/json",
                    ),
                )

                if not response.text:
                    raise ValueError(
                        "Gemini returned an empty response"
                    )

                parsed = json.loads(
                    clean_json(response.text)
                )

                result = normalize_result(parsed)

                logger.info(
                    "Face analysis completed; model=%s shape=%s",
                    model,
                    result["faceShape"],
                )

                return result

            except errors.APIError as exc:

                logger.error(
                    "Gemini API failure: model=%s "
                    "code=%s status=%s message=%s",
                    model,
                    exc.code,
                    exc.status,
                    exc.message,
                )

                failures.append(
                    f"{model}: {describe_error(exc)}"
                )

            except Exception as exc:

                logger.exception(
                    "Gemini face processing failed; model=%s",
                    model,
                )

                failures.append(
                    f"{model}: {describe_error(exc)}"
                )

    raise RuntimeError(
        "All configured Gemini face-analysis models failed: "
        + "; ".join(failures)
        + ". Check backend logs for details."
    )

