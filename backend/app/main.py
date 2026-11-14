"""
KSHURAK Backend - Unified FastAPI Application

Modules:
1. Customer Face Analysis and Virtual Try-On
2. Customer Discovery and Shop Details
3. Customer Bookings and Notifications
4. Admin Authentication and Dashboard
5. Admin Barber Verification
6. Admin Shop Registry
7. Admin User and Booking Management
8. Barber Registration and Authentication
9. Barber Shop Setup and Profile
10. Barber Workers, Services, Reviews and Scheduling
11. Barber Bookings, Rescheduling and Notifications
12. Admin Visualization Analytics

Database: Supabase PostgreSQL
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load backend environment before importing configuration.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(dotenv_path=BACKEND_ROOT / ".env", override=False)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import close_database_connection


# ============================================================
# CUSTOMER API IMPORTS
# ============================================================

from app.customer.api.face import router as face_router
from app.customer.api.tryon import router as tryon_router
from app.customer.api.discovery import router as discovery_router

from app.customer.api.booking_slots import (
    router as customer_booking_slots_router,
)


from app.customer.api.customer_reviews import (
    router as customer_reviews_router,
)


from app.customer.api.shop_details import (
    router as customer_shop_details_router,
)
from app.customer.api.customer_bookings import (
    router as customer_bookings_router,
)
from app.customer.api.booking_management import (
    router as customer_booking_management_router,
)
from app.customer.api.customer_notifications import (
    router as customer_notifications_router,
)


# ============================================================
# ADMIN API IMPORTS
# ============================================================

from app.admin.api.auth import router as admin_auth_router

from app.admin.api.dashboard import (
    router as admin_dashboard_router,
)
from app.admin.api.visualization import (
    router as admin_visualization_router,
)
from app.admin.api.users import (
    router as admin_users_router,
)
from app.admin.api.barber_approvals import (
    router as admin_barber_approvals_router,
)
from app.admin.api.shop_registry import (
    router as admin_shop_registry_router,
)
from app.admin.api.bookings import (
    router as admin_bookings_router,
)


# ============================================================
# BARBER API IMPORTS
# ============================================================

from app.barber.api.barber_registration import (
    router as barber_registration_router,
)
from app.barber.api.registration_correction import (
    router as barber_registration_correction_router,
)
from app.barber.api.barber_login import (
    router as barber_login_router,
)
from app.barber.api.barber_auth import (
    router as barber_auth_router,
)
from app.barber.api.barber_profile import (
    router as barber_profile_router,
)
from app.barber.api.barber_workers import (
    router as barber_workers_router,
)
from app.barber.api.barber_services import (
    router as barber_services_router,
)
from app.barber.api.barber_reviews import (
    router as barber_reviews_router,
)
from app.barber.api.barber_weekly_schedule import (
    router as barber_weekly_schedule_router,
)
from app.barber.api.barber_bookings import (
    router as barber_bookings_router,
)
from app.barber.api.barber_rescheduling import (
    router as barber_rescheduling_router,
)
from app.barber.api.barber_notifications import (
    router as barber_notifications_router,
)
from app.barber.api.shop_setup import (
    router as barber_shop_setup_router,
)

from app.barber.api import barber_customers


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format=(
        "%(asctime)s - %(levelname)s - "
        "%(name)s - %(message)s"
    ),
)

logger = logging.getLogger("kshurak.backend")


# ============================================================
# APPLICATION LIFESPAN
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage FastAPI startup and shutdown.

    Database schema changes are handled
    through SQL migrations.
    """

    logger.info("Starting KSHURAK FastAPI backend...")
    logger.info(
        "Customer, Admin and Barber modules configured."
    )
    logger.info(
        "Database schema managed through SQL migrations."
    )

    try:
        yield

    finally:
        logger.info("Shutting down KSHURAK backend...")

        await close_database_connection()

        logger.info(
            "Database connection pool closed successfully."
        )


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title=settings.PROJECT_NAME,
    description=(
        "Unified KSHURAK API for Customer, "
        "Admin and Barber Management, "
        "Virtual Hairstyle Try-On, "
        "Appointments and Shop Operations."
    ),
    version=settings.VERSION,
    lifespan=lifespan,
)


# ============================================================
# CORS CONFIGURATION
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# CUSTOMER ROUTERS
# ============================================================

app.include_router(customer_reviews_router)
app.include_router(face_router)
app.include_router(tryon_router)
app.include_router(discovery_router)

app.include_router(customer_booking_slots_router)
app.include_router(customer_shop_details_router)
app.include_router(customer_bookings_router)
app.include_router(customer_booking_management_router)
app.include_router(customer_notifications_router)


# ============================================================
# ADMIN ROUTERS
# ============================================================

app.include_router(admin_auth_router)
app.include_router(admin_dashboard_router)
app.include_router(admin_visualization_router)
app.include_router(admin_users_router)
app.include_router(admin_barber_approvals_router)
app.include_router(admin_shop_registry_router)
app.include_router(admin_bookings_router)


# ============================================================
# BARBER ROUTERS
# ============================================================

app.include_router(barber_registration_router)
app.include_router(barber_login_router)
app.include_router(barber_auth_router)
app.include_router(barber_profile_router)
app.include_router(
    barber_registration_correction_router
)
app.include_router(barber_workers_router)
app.include_router(barber_services_router)
app.include_router(barber_reviews_router)
app.include_router(barber_weekly_schedule_router)

app.include_router(barber_bookings_router)
app.include_router(barber_rescheduling_router)
app.include_router(barber_notifications_router)
app.include_router(barber_customers.router)

# Preserve existing shop setup router prefix.
app.include_router(
    barber_shop_setup_router,
    prefix="/api/v1/barber",
)

# Legacy mock Barber router intentionally not registered.


# ============================================================
# ROOT ENDPOINT
# ============================================================

@app.get("/", tags=["System"])
async def root():
    return {
        "application": "KSHURAK Backend",
        "status": "running",
        "version": settings.VERSION,
        "modules": [
            "Customer Face Analysis",
            "Customer Virtual Try-On",
            "Customer Discovery",
            "Customer Bookings",
            "Customer Notifications",
            "Admin Authentication",
            "Admin Dashboard",
            "Admin Visualization Analytics",
            "Admin Barber Verification",
            "Admin Shop Registry",
            "Admin User Management",
            "Admin Booking Management",
            "Barber Registration",
            "Barber Authentication",
            "Barber Profile",
            "Barber Shop Setup",
            "Barber Workers Management",
            "Barber Services",
            "Barber Reviews",
            "Barber Weekly Schedule",
            "Barber Bookings",
            "Barber Rescheduling",
            "Barber Notifications",
        ],
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health", tags=["System"])
async def health():
    return {
        "status": "healthy",
        "service": "KSHURAK API",
    }
