"""
KSHURAK Backend - Shared Database Configuration

Shared by Customer, Admin and Barber modules.

Features:
    - Async SQLAlchemy sessions
    - PostgreSQL asyncpg and psycopg support
    - SQLite development compatibility
    - Configurable connection pooling
    - Connection health checks
    - Bounded asyncpg command execution
    - Safe transaction rollback
    - Controlled responses for database outages
    - Graceful shutdown

Successful mutations must be committed by their endpoint or service.
Database schema changes are managed through SQL migrations.

No booking or payment operation is automatically retried.
"""

import asyncio
import logging
import os

from collections.abc import AsyncGenerator
from typing import Any

from fastapi import HTTPException, status

from sqlalchemy import text
from sqlalchemy.exc import (
    DBAPIError,
    OperationalError,
    TimeoutError as SQLAlchemyTimeoutError,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool

from app.core.config import settings


logger = logging.getLogger("kshurak.database")


# ============================================================
# ENVIRONMENT HELPERS
# ============================================================

def get_int_setting(
    name: str,
    default: int,
    minimum: int = 0,
) -> int:
    raw_value = os.getenv(name)

    if raw_value is None or not raw_value.strip():
        return default

    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(
            f"{name} must contain an integer."
        ) from exc

    if value < minimum:
        raise RuntimeError(
            f"{name} must be at least {minimum}."
        )

    return value


def get_bool_setting(
    name: str,
    default: bool = False,
) -> bool:
    raw_value = os.getenv(name)

    if raw_value is None or not raw_value.strip():
        return default

    value = raw_value.strip().lower()

    if value in {"true", "1", "yes", "on"}:
        return True

    if value in {"false", "0", "no", "off"}:
        return False

    raise RuntimeError(
        f"{name} must be true or false."
    )


# ============================================================
# DATABASE DRIVER
# ============================================================

DATABASE_URL = str(settings.DATABASE_URL)

IS_SQLITE = DATABASE_URL.startswith(
    "sqlite+aiosqlite://"
)

IS_ASYNCPG = DATABASE_URL.startswith(
    "postgresql+asyncpg://"
)

IS_PSYCOPG = DATABASE_URL.startswith(
    "postgresql+psycopg://"
)

IS_POSTGRESQL = IS_ASYNCPG or IS_PSYCOPG

if not (IS_SQLITE or IS_POSTGRESQL):
    raise RuntimeError(
        "Unsupported database driver. "
        "Use sqlite+aiosqlite, postgresql+asyncpg, "
        "or postgresql+psycopg."
    )


# ============================================================
# CONNECTION SETTINGS
# ============================================================

DB_POOL_SIZE = get_int_setting(
    "DB_POOL_SIZE",
    default=5,
    minimum=1,
)

DB_MAX_OVERFLOW = get_int_setting(
    "DB_MAX_OVERFLOW",
    default=5,
    minimum=0,
)

# Time spent waiting for an available pooled connection.
DB_POOL_TIMEOUT = get_int_setting(
    "DB_POOL_TIMEOUT",
    default=10,
    minimum=1,
)

DB_POOL_RECYCLE = get_int_setting(
    "DB_POOL_RECYCLE",
    default=1800,
    minimum=1,
)

# Time allowed to establish a database connection.
DB_CONNECT_TIMEOUT = get_int_setting(
    "DB_CONNECT_TIMEOUT",
    default=10,
    minimum=1,
)

# Default command timeout for the asyncpg driver.
# This is a per-command timeout, not a whole HTTP-request timeout.
DB_COMMAND_TIMEOUT = get_int_setting(
    "DB_COMMAND_TIMEOUT",
    default=20,
    minimum=1,
)

DB_HEALTH_TIMEOUT = get_int_setting(
    "DB_HEALTH_TIMEOUT",
    default=10,
    minimum=1,
)

DB_USE_NULL_POOL = get_bool_setting(
    "DB_USE_NULL_POOL",
    default=False,
)


# ============================================================
# ENGINE OPTIONS
# ============================================================

engine_options: dict[str, Any] = {
    "echo": False,
    "pool_pre_ping": True,
}

if IS_SQLITE:
    engine_options["connect_args"] = {
        "check_same_thread": False,
    }

elif IS_POSTGRESQL:
    if DB_USE_NULL_POOL:
        engine_options["poolclass"] = NullPool

    else:
        engine_options.update(
            {
                "pool_size": DB_POOL_SIZE,
                "max_overflow": DB_MAX_OVERFLOW,
                "pool_timeout": DB_POOL_TIMEOUT,
                "pool_recycle": DB_POOL_RECYCLE,
            }
        )

    if IS_ASYNCPG:
        engine_options["connect_args"] = {
            "timeout": DB_CONNECT_TIMEOUT,
            "command_timeout": DB_COMMAND_TIMEOUT,
        }

    elif IS_PSYCOPG:
        engine_options["connect_args"] = {
            "connect_timeout": DB_CONNECT_TIMEOUT,
        }


# ============================================================
# ENGINE AND SESSION FACTORY
# ============================================================

engine = create_async_engine(
    DATABASE_URL,
    **engine_options,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

Base = declarative_base()


# ============================================================
# ERROR CLASSIFICATION
# ============================================================

def is_database_unavailable(error: Exception) -> bool:
    """
    Identify connection failures and timeouts.

    Programming errors, missing columns and integrity
    violations are not treated as temporary outages.
    """

    if isinstance(
        error,
        (
            SQLAlchemyTimeoutError,
            OperationalError,
            TimeoutError,
            ConnectionError,
        ),
    ):
        return True

    if isinstance(error, DBAPIError):
        if error.connection_invalidated:
            return True

        original = error.orig

        if isinstance(
            original,
            (
                TimeoutError,
                ConnectionError,
                OSError,
            ),
        ):
            return True

    return False


async def rollback_safely(
    session: AsyncSession,
) -> None:
    try:
        await session.rollback()

    except Exception as error:
        # Do not expose SQL parameters or connection credentials.
        logger.warning(
            "Database session rollback failed (%s).",
            type(error).__name__,
        )


# ============================================================
# FASTAPI SESSION DEPENDENCY
# ============================================================

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Provide one session per request.

    Endpoints/services commit successful mutations explicitly.
    Failures trigger rollback and session cleanup.

    Connection failures produce HTTP 503.
    No request or transaction is automatically replayed.
    """

    async with AsyncSessionLocal() as session:
        try:
            yield session

        except HTTPException:
            await rollback_safely(session)
            raise

        except Exception as error:
            await rollback_safely(session)

            if is_database_unavailable(error):
                logger.error(
                    "Database operation unavailable (%s).",
                    type(error).__name__,
                )

                raise HTTPException(
                    status_code=(
                        status.HTTP_503_SERVICE_UNAVAILABLE
                    ),
                    detail={
                        "code": "DATABASE_TEMPORARILY_UNAVAILABLE",
                        "message": (
                            "The database connection was interrupted "
                            "or timed out. Refresh to check the latest "
                            "booking status. If you submitted a booking "
                            "change, check its result before trying again."
                        ),
                    },
                ) from error

            raise


# ============================================================
# DATABASE HEALTH CHECK
# ============================================================

async def check_database_connection() -> bool:
    """
    Check connectivity without logging credentials.

    Requires Python 3.11 or newer.
    """

    try:
        async with asyncio.timeout(DB_HEALTH_TIMEOUT):
            async with engine.connect() as connection:
                await connection.execute(
                    text("SELECT 1")
                )

        return True

    except Exception as error:
        logger.warning(
            "Database health check failed (%s).",
            type(error).__name__,
        )

        return False


# ============================================================
# GRACEFUL SHUTDOWN
# ============================================================

async def close_database_connection() -> None:
    await engine.dispose()

    logger.info(
        "Database connections closed successfully."
    )
