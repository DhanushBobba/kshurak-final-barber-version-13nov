
"""
KSHURAK Platform - Centralized Backend Configuration

Modules:
- Customer Website
- Admin Portal
- Barber Website
- Barber Authentication
- AI Face Analysis
- Virtual Try-On

Database:
- Supabase PostgreSQL

Configuration:
- Environment-based settings
- Dynamic CORS
- JWT authentication
- Supabase authentication
- AI integrations
"""

from pathlib import Path
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# ============================================================
# BACKEND ROOT DIRECTORY
# ============================================================

BACKEND_ROOT = Path(__file__).resolve().parents[2]


# ============================================================
# APPLICATION SETTINGS
# ============================================================

class Settings(BaseSettings):

    # ========================================================
    # APPLICATION CONFIGURATION
    # ========================================================

    PROJECT_NAME: str = "Kshurak Platform Core API"

    VERSION: str = "1.0.0"

    API_V1_STR: str = "/api/v1"

    # ========================================================
    # SECURITY & JWT CONFIGURATION
    # ========================================================

    # Loaded from .env
    # No hardcoded JWT secret.
    SECRET_KEY: str = Field(min_length=32)

    ALGORITHM: str = "HS256"

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # ========================================================
    # DATABASE CONFIGURATION
    # ========================================================

    # Uses DATABASE_URL from .env
    # No SQLite fallback.
    DATABASE_URL: str = Field(min_length=1)

    # ========================================================
    # SUPABASE AUTHENTICATION
    # ========================================================

    SUPABASE_URL: str = Field(min_length=1)

    SUPABASE_ANON_KEY: str = Field(min_length=1)

    # ========================================================
    # DYNAMIC CORS CONFIGURATION
    #
    # Example .env format:
    # BACKEND_CORS_ORIGINS=["http://localhost:5173","http://localhost:5174"]
    #
    # No frontend origins hardcoded in Python.
    # ========================================================

    BACKEND_CORS_ORIGINS: List[str]

    # ========================================================
    # AI & DIFFUSION INTEGRATIONS
    # ========================================================

    ANTHROPIC_API_KEY: str = "mock-anthropic-key"

    REPLICATE_API_TOKEN: str = "mock-replicate-key"

    FLUX_DIFFUSION_MODEL_VERSION: str = (
        "black-forest-labs/flux-schnell"
    )

    # ========================================================
    # GOOGLE PLACES & MAPS API
    # ========================================================

    GOOGLE_PLACES_API_KEY: str = "mock-google-places-key"

    SEARCH_RADIUS_METERS: int = 5000

    # ========================================================
    # BIRD VERIFICATION API
    # ========================================================

    BIRD_API_KEY: str = "bk_your_actual_key_here"

    BIRD_REGION: str = "us"

    # ========================================================
    # PYDANTIC SETTINGS CONFIGURATION
    # ========================================================

    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


# ============================================================
# GLOBAL SETTINGS INSTANCE
# ============================================================

settings = Settings()
