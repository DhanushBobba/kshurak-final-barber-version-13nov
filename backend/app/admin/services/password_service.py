"""
KSHURAK Admin password security.
Independent of Customer and Barber authentication.
"""

from argon2 import PasswordHasher
from argon2.exceptions import (
    InvalidHashError,
    VerificationError,
    VerifyMismatchError,
)
from argon2.low_level import Type


_password_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)


def hash_admin_password(password: str) -> str:
    if not isinstance(password, str):
        raise ValueError("Password must be a string")

    if len(password) < 12:
        raise ValueError("Password must contain at least 12 characters")

    if len(password.encode("utf-8")) > 1024:
        raise ValueError("Password is too long")

    return _password_hasher.hash(password)


def verify_admin_password(password: str, stored_hash: str) -> bool:
    if not isinstance(password, str):
        return False

    if not isinstance(stored_hash, str):
        return False

    try:
        return _password_hasher.verify(stored_hash, password)
    except (
        VerifyMismatchError,
        VerificationError,
        InvalidHashError,
    ):
        return False


def admin_password_needs_rehash(stored_hash: str) -> bool:
    return _password_hasher.check_needs_rehash(stored_hash)
