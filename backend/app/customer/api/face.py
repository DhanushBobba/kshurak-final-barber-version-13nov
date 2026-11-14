
"""
Kshurak Face Analysis API

Endpoint:
POST /api/v1/face/analyze

Accepts three face images:
- front
- left
- right

Returns Gemini facial analysis including:
- faceShape
- confidence
- metrics
- analysisSummary
- recommendedHairstyles
"""

import logging

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.services.gemini_face import analyze_face


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1",
    tags=["Face Analysis"],
)


class FaceAnalysisRequest(BaseModel):
    front: str = Field(min_length=1)
    left: str = Field(min_length=1)
    right: str = Field(min_length=1)


def validate_images(data: FaceAnalysisRequest) -> None:
    images = {
        "Front": data.front,
        "Left": data.left,
        "Right": data.right,
    }

    for name, image in images.items():
        if not image.strip():
            raise HTTPException(
                status_code=400,
                detail=f"{name} face image is missing",
            )

        if len(image) < 1000:
            raise HTTPException(
                status_code=400,
                detail=f"{name} face image data is too short",
            )

        if len(image) > 17_000_000:
            raise HTTPException(
                status_code=413,
                detail=f"{name} face image is too large",
            )


@router.post("/face/analyze")
async def face_analysis(data: FaceAnalysisRequest):
    """
    Analyze three facial images using Gemini.

    Returns:
        {
            "faceShape": "...",
            "confidence": 0,
            "metrics": {...},
            "analysisSummary": "...",
            "recommendedHairstyles": [...]
        }
    """

    validate_images(data)

    logger.info(
        "Face analysis request received; "
        "front_chars=%s left_chars=%s right_chars=%s",
        len(data.front),
        len(data.left),
        len(data.right),
    )

    try:
        result = await run_in_threadpool(
            analyze_face,
            data.front,
            data.left,
            data.right,
        )

        if not isinstance(result, dict):
            raise ValueError(
                "Face analysis returned an invalid result"
            )

        face_shape = result.get("faceShape")
        metrics = result.get("metrics")

        if not isinstance(face_shape, str) or not face_shape:
            raise ValueError(
                "Face shape is missing from the analysis"
            )

        if not isinstance(metrics, dict):
            raise ValueError(
                "Facial metrics are missing from the analysis"
            )

        logger.info(
            "Face analysis successful; face_shape=%s",
            face_shape,
        )

        return result

    except ValueError as exc:
        logger.warning(
            "Invalid face analysis input or response: %s",
            exc,
        )

        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except RuntimeError as exc:
        logger.error(
            "Face analysis service failed: %s",
            exc,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Face analysis is temporarily unavailable. "
                "Check the backend logs for Gemini API errors."
            ),
        ) from exc

    except Exception:
        logger.exception(
            "Unexpected face analysis error"
        )

        raise HTTPException(
            status_code=500,
            detail="Unexpected face analysis server error",
        )

