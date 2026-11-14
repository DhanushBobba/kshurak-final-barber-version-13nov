
"""
KSHURAK Admin User Management API.

Read-only endpoints for:
- Registered customers
- Primary and child profiles
- Facial scan history and facial metrics

Uses existing Admin JWT authentication and PostgreSQL.
No database schema changes.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.admin.services.auth_service import verify_admin_token
from app.core.database import AsyncSessionLocal


router = APIRouter(
    prefix="/api/v1/admin/users",
    tags=["Admin User Management"],
)

AdminUser = Annotated[
    dict,
    Depends(verify_admin_token),
]


# ============================================================
# LIST REGISTERED USERS
# ============================================================

@router.get("")
async def list_users(
    admin: AdminUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str = Query(default="", max_length=200),
):
    """
    Return registered Supabase Auth users.

    Includes primary/child profile counts and face scan counts.
    Supports pagination and search.
    """

    offset = (page - 1) * page_size
    search_value = f"%{search.strip()}%"

    query = text("""
        SELECT
            u.id AS user_id,
            u.email,
            u.created_at,
            u.last_sign_in_at,

            (
                SELECT p.full_name
                FROM public.profiles p
                WHERE p.auth_user_id = u.id
                ORDER BY p.created_at ASC NULLS LAST, p.id
                LIMIT 1
            ) AS full_name,

            (
                SELECT COUNT(*)
                FROM public.profiles p
                WHERE p.auth_user_id = u.id
            ) AS primary_profiles,

            (
                SELECT COUNT(*)
                FROM public.child_profiles cp
                JOIN public.profiles p
                    ON p.id = cp.parent_profile_id
                WHERE p.auth_user_id = u.id
            ) AS child_profiles,

            (
                SELECT COUNT(*)
                FROM public.face_scans fs
                WHERE fs.profile_id IN (
                    SELECT p.id
                    FROM public.profiles p
                    WHERE p.auth_user_id = u.id

                    UNION

                    SELECT cp.id
                    FROM public.child_profiles cp
                    JOIN public.profiles p
                        ON p.id = cp.parent_profile_id
                    WHERE p.auth_user_id = u.id
                )
            ) AS face_scans,

            (
                SELECT COUNT(*)
                FROM public.face_metrics fm
                JOIN public.face_scans fs
                    ON fs.id = fm.scan_id
                WHERE fs.profile_id IN (
                    SELECT p.id
                    FROM public.profiles p
                    WHERE p.auth_user_id = u.id

                    UNION

                    SELECT cp.id
                    FROM public.child_profiles cp
                    JOIN public.profiles p
                        ON p.id = cp.parent_profile_id
                    WHERE p.auth_user_id = u.id
                )
            ) AS face_metrics,

            COUNT(*) OVER() AS total_count

        FROM auth.users u

        WHERE
            (
                :search = '%%'
                OR COALESCE(u.email, '') ILIKE :search
                OR EXISTS (
                    SELECT 1
                    FROM public.profiles p
                    WHERE p.auth_user_id = u.id
                      AND COALESCE(p.full_name, '') ILIKE :search
                )
            )

        ORDER BY u.created_at DESC, u.id
        LIMIT :limit_value
        OFFSET :offset_value
    """)

    count_query = text("""
        SELECT COUNT(*)
        FROM auth.users u
        WHERE
            (
                :search = '%%'
                OR COALESCE(u.email, '') ILIKE :search
                OR EXISTS (
                    SELECT 1
                    FROM public.profiles p
                    WHERE p.auth_user_id = u.id
                      AND COALESCE(p.full_name, '') ILIKE :search
                )
            )
    """)

    try:
        async with AsyncSessionLocal() as session:
            params = {
                "search": search_value,
                "limit_value": page_size,
                "offset_value": offset,
            }

            result = await session.execute(query, params)
            rows = [dict(row) for row in result.mappings().all()]

            if rows:
                total = int(rows[0]["total_count"])
            else:
                count_result = await session.execute(
                    count_query,
                    {"search": search_value},
                )
                total = int(count_result.scalar_one())

            for row in rows:
                row.pop("total_count", None)

            return jsonable_encoder({
                "users": rows,
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": (
                    (total + page_size - 1) // page_size
                ),
            })

    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to load registered users.",
        ) from exc


# ============================================================
# CUSTOMER DETAILS AND FAMILY PROFILES
# ============================================================

@router.get("/{user_id}")
async def get_user_details(
    user_id: UUID,
    admin: AdminUser,
):
    """
    Return customer identity and associated primary/child
    profiles.

    user_id = auth.users.id
    """

    user_query = text("""
        SELECT
            u.id AS user_id,
            u.email,
            u.created_at,
            u.last_sign_in_at
        FROM auth.users u
        WHERE u.id = CAST(:user_id AS uuid)
    """)

    profiles_query = text("""
        SELECT
            p.id,
            p.auth_user_id,
            NULL::uuid AS parent_profile_id,
            p.full_name,
            p.email,
            COALESCE(p.phone, p.mobile) AS phone,
            p.age,
            p.gender,
            COALESCE(
                p.profile_image_url,
                p.profile_image
            ) AS profile_image_url,
            'PRIMARY' AS profile_type,
            p.created_at
        FROM public.profiles p
        WHERE p.auth_user_id = CAST(:user_id AS uuid)

        UNION ALL

        SELECT
            cp.id,
            p.auth_user_id,
            cp.parent_profile_id,
            cp.full_name,
            cp.email,
            cp.phone,
            cp.age,
            cp.gender,
            COALESCE(
                cp.profile_image_url,
                cp.profile_image
            ) AS profile_image_url,
            'CHILD' AS profile_type,
            cp.created_at
        FROM public.child_profiles cp
        JOIN public.profiles p
            ON p.id = cp.parent_profile_id
        WHERE p.auth_user_id = CAST(:user_id AS uuid)

        ORDER BY created_at ASC NULLS LAST
    """)

    try:
        async with AsyncSessionLocal() as session:
            params = {"user_id": str(user_id)}

            user_result = await session.execute(
                user_query,
                params,
            )
            user = user_result.mappings().first()

            if not user:
                raise HTTPException(
                    status_code=404,
                    detail="Customer not found.",
                )

            profiles_result = await session.execute(
                profiles_query,
                params,
            )

            profiles = [
                dict(row)
                for row in profiles_result.mappings().all()
            ]

            return jsonable_encoder({
                "user": dict(user),
                "profiles": profiles,
                "primary_profile_count": sum(
                    1
                    for profile in profiles
                    if profile["profile_type"] == "PRIMARY"
                ),
                "child_profile_count": sum(
                    1
                    for profile in profiles
                    if profile["profile_type"] == "CHILD"
                ),
            })

    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to load customer details.",
        ) from exc


# ============================================================
# CUSTOMER FACE SCANS AND FACIAL METRICS
# ============================================================

@router.get("/{user_id}/metrics")
async def get_user_metrics(
    user_id: UUID,
    admin: AdminUser,
):
    """
    Return facial analysis history for all profiles owned
    by this authenticated customer.

    Matches metrics to scans through face_metrics.scan_id.
    """

    user_check_query = text("""
        SELECT EXISTS (
            SELECT 1
            FROM auth.users u
            WHERE u.id = CAST(:user_id AS uuid)
        )
    """)

    query = text("""
        WITH owned_profiles AS (
            SELECT
                p.id AS profile_id,
                p.full_name AS profile_name,
                'PRIMARY' AS profile_type
            FROM public.profiles p
            WHERE p.auth_user_id = CAST(:user_id AS uuid)

            UNION ALL

            SELECT
                cp.id AS profile_id,
                cp.full_name AS profile_name,
                'CHILD' AS profile_type
            FROM public.child_profiles cp
            JOIN public.profiles p
                ON p.id = cp.parent_profile_id
            WHERE p.auth_user_id = CAST(:user_id AS uuid)
        )

        SELECT
            fs.id AS scan_id,
            fs.profile_id,
            op.profile_name,
            op.profile_type,

            fs.face_shape,
            fs.symmetry_score,
            fs.ai_accuracy,
            fs.scan_version,
            fs.scanned_at,
            fs.created_at AS scan_created_at,

            fs.image_url,
            fs.front_image_url,
            fs.left_image_url,
            fs.right_image_url,

            fm.id AS metric_id,
            fm.face_length,
            fm.face_width,
            fm.face_ratio,
            fm.forehead_width,
            fm.forehead_height,
            fm.cheekbone_width,
            fm.jaw_width,
            fm.jaw_angle,
            fm.jawline_shape,
            fm.face_symmetry,
            fm.created_at AS metrics_created_at

        FROM owned_profiles op

        JOIN public.face_scans fs
            ON fs.profile_id = op.profile_id

        LEFT JOIN LATERAL (
            SELECT m.*
            FROM public.face_metrics m
            WHERE m.scan_id = fs.id
              AND (
                  m.profile_id IS NULL
                  OR m.profile_id = fs.profile_id
              )
            ORDER BY m.created_at DESC NULLS LAST, m.id
            LIMIT 1
        ) fm ON TRUE

        ORDER BY
            fs.created_at DESC NULLS LAST,
            fs.id DESC
    """)

    try:
        async with AsyncSessionLocal() as session:
            params = {"user_id": str(user_id)}

            user_result = await session.execute(
                user_check_query,
                params,
            )

            if not user_result.scalar_one():
                raise HTTPException(
                    status_code=404,
                    detail="Customer not found.",
                )

            result = await session.execute(
                query,
                params,
            )

            scans = []

            for row in result.mappings().all():
                record = dict(row)

                metrics = None

                if record["metric_id"] is not None:
                    metrics = {
                        "id": record["metric_id"],
                        "face_length": record["face_length"],
                        "face_width": record["face_width"],
                        "face_ratio": record["face_ratio"],
                        "forehead_width": record["forehead_width"],
                        "forehead_height": record["forehead_height"],
                        "cheekbone_width": record["cheekbone_width"],
                        "jaw_width": record["jaw_width"],
                        "jaw_angle": record["jaw_angle"],
                        "jawline_shape": record["jawline_shape"],
                        "face_symmetry": record["face_symmetry"],
                        "created_at": record["metrics_created_at"],
                    }

                scans.append({
                    "scan_id": record["scan_id"],
                    "profile_id": record["profile_id"],
                    "profile_name": record["profile_name"],
                    "profile_type": record["profile_type"],
                    "face_shape": record["face_shape"],
                    "symmetry_score": record["symmetry_score"],
                    "ai_accuracy": record["ai_accuracy"],
                    "scan_version": record["scan_version"],
                    "scanned_at": record["scanned_at"],
                    "created_at": record["scan_created_at"],
                    "image_url": record["image_url"],
                    "front_image_url": record["front_image_url"],
                    "left_image_url": record["left_image_url"],
                    "right_image_url": record["right_image_url"],
                    "metrics": metrics,
                })

            return jsonable_encoder({
                "user_id": user_id,
                "total_scans": len(scans),
                "scans_with_metrics": sum(
                    1
                    for scan in scans
                    if scan["metrics"] is not None
                ),
                "scans": scans,
            })

    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to load facial metrics.",
        ) from exc
