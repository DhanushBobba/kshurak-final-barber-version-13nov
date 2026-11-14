import uuid

from sqlalchemy import (
    Column,
    String,
    DateTime,
    ForeignKey,
    CheckConstraint,
    Index,
    text,
    func,
)

from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class BarberAuthToken(Base):
    """
    Secure authentication tokens for KSHURAK barbers.

    Token types:
    - email_activation
    - password_reset
    - registration_correction

    Only token hashes are stored in the database.
    """

    __tablename__ = "barber_auth_tokens"

    __table_args__ = (
        CheckConstraint(
            "token_type IN ('email_activation', 'password_reset', 'registration_correction')",
            name="barber_auth_tokens_token_type_check",
        ),
        CheckConstraint(
            "expires_at > created_at",
            name="barber_auth_token_expiry_check",
        ),
        Index(
            "idx_barber_auth_tokens_account",
            "barber_id",
            "token_type",
            text("created_at DESC"),
        ),
        Index(
            "idx_barber_auth_tokens_unused",
            "expires_at",
            postgresql_where=text("used_at IS NULL"),
        ),
        {"schema": "public"},
    )

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )

    barber_id = Column(
        UUID(as_uuid=True),
        ForeignKey(
            "public.barber_accounts.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    token_hash = Column(
        String(64),
        nullable=False,
        unique=True,
    )

    token_type = Column(
        String(30),
        nullable=False,
    )

    expires_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )

    used_at = Column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    def __repr__(self):
        return (
            f"<BarberAuthToken("
            f"id={self.id}, "
            f"barber_id={self.barber_id}, "
            f"token_type={self.token_type!r}"
            f")>"
        )
