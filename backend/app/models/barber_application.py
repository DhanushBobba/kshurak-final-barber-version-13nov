import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    Text,
    DateTime,
    ForeignKey,
    CheckConstraint,
    Time,
    Index,
)

from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.core.database import Base


# ============================================================
# KSHURAK BARBER APPLICATION MODELS
# ============================================================

APPLICATION_STATUS_PENDING = "PENDING"
APPLICATION_STATUS_APPROVED = "APPROVED"
APPLICATION_STATUS_REJECTED = "REJECTED"
APPLICATION_STATUS_NEEDS_CORRECTION = "NEEDS_CORRECTION"


def utc_now():
    """Return the current UTC datetime."""
    return datetime.now(timezone.utc)


def generate_uuid():
    """Generate a UUID compatible with the existing models."""
    return str(uuid.uuid4())


# ============================================================
# 1. BARBER INVITATION MODEL
# ============================================================

class BarberInvitation(Base):
    """
    Stores invitations sent to barbers.

    Existing invitation-based workflows can continue using
    this table independently of basic barber registration.
    """

    __tablename__ = "barber_invitations"

    id = Column(
        UUID(as_uuid=False),
        primary_key=True,
        default=generate_uuid,
    )

    email = Column(
        String(255),
        nullable=False,
    )

    token_hash = Column(
        String(64),
        nullable=False,
        unique=True,
    )

    created_by = Column(
        String(255),
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

    application_id = Column(
        UUID(as_uuid=False),
        nullable=True,
    )

    created_at = Column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )

    def __repr__(self):
        return (
            f"<BarberInvitation("
            f"id={self.id}, "
            f"email={self.email!r}"
            f")>"
        )


# ============================================================
# 2. BARBER APPLICATION MODEL
# ============================================================

class BarberApplication(Base):
    """
    Stores detailed barber/shop applications.

    Important:
    This is separate from barber_accounts, which stores
    initial username/password registration and approval.

    Existing columns are preserved for compatibility.
    """

    __tablename__ = "barber_applications"

    __table_args__ = (
        CheckConstraint(
            "chair_count >= 1",
            name="barber_chair_count_check",
        ),

        CheckConstraint(
            "barber_count >= 1",
            name="barber_count_check",
        ),

        CheckConstraint(
            """
            status IN (
                'PENDING',
                'APPROVED',
                'REJECTED',
                'NEEDS_CORRECTION'
            )
            """,
            name="barber_app_status_check",
        ),

        Index(
            "idx_barber_applications_status",
            "status",
        ),

        Index(
            "idx_barber_applications_email",
            "email",
        ),

        Index(
            "idx_barber_applications_created",
            "created_at",
        ),
    )

    # --------------------------------------------------------
    # Primary key and invitation
    # --------------------------------------------------------

    id = Column(
        UUID(as_uuid=False),
        primary_key=True,
        default=generate_uuid,
    )

    invitation_id = Column(
        UUID(as_uuid=False),
        ForeignKey("barber_invitations.id"),
        unique=True,
        nullable=True,
    )

    # --------------------------------------------------------
    # Barber personal information
    # --------------------------------------------------------

    full_name = Column(
        String(150),
        nullable=False,
    )

    email = Column(
        String(255),
        nullable=False,
    )

    phone = Column(
        String(30),
        nullable=False,
    )

    years_experience = Column(
        Integer,
        default=0,
    )

    # --------------------------------------------------------
    # Shop information
    # --------------------------------------------------------

    shop_name = Column(
        String(200),
        nullable=False,
    )

    shop_phone = Column(
        String(30),
        nullable=True,
    )

    license_number = Column(
        String(100),
        nullable=True,
    )

    specialties = Column(
        Text,
        nullable=True,
    )

    # --------------------------------------------------------
    # Shop address and location
    # --------------------------------------------------------

    address = Column(
        Text,
        nullable=False,
    )

    city = Column(
        String(100),
        nullable=True,
    )

    state = Column(
        String(100),
        nullable=True,
    )

    pincode = Column(
        String(10),
        nullable=True,
    )

    latitude = Column(
        Float,
        nullable=True,
    )

    longitude = Column(
        Float,
        nullable=True,
    )

    # --------------------------------------------------------
    # Shop capacity
    # --------------------------------------------------------

    chair_count = Column(
        Integer,
        nullable=False,
    )

    barber_count = Column(
        Integer,
        nullable=False,
    )

    # --------------------------------------------------------
    # Working hours
    # --------------------------------------------------------

    opening_time = Column(
        Time,
        nullable=True,
    )

    closing_time = Column(
        Time,
        nullable=True,
    )

    working_days = Column(
        JSONB,
        nullable=True,
    )

    # --------------------------------------------------------
    # Documents
    # --------------------------------------------------------

    document_paths = Column(
        JSONB,
        nullable=True,
    )

    # --------------------------------------------------------
    # Admin approval
    # --------------------------------------------------------

    status = Column(
        String(30),
        default=APPLICATION_STATUS_PENDING,
        nullable=False,
    )

    rejection_reason = Column(
        Text,
        nullable=True,
    )

    reviewed_by = Column(
        String(255),
        nullable=True,
    )

    reviewed_at = Column(
        DateTime(timezone=True),
        nullable=True,
    )

    # --------------------------------------------------------
    # Existing user and shop references
    # --------------------------------------------------------

    user_id = Column(
        String,
        nullable=True,
    )

    shop_id = Column(
        String,
        nullable=True,
    )

    # --------------------------------------------------------
    # Audit timestamps
    # --------------------------------------------------------

    created_at = Column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )

    updated_at = Column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    def __repr__(self):
        return (
            f"<BarberApplication("
            f"id={self.id}, "
            f"status={self.status!r}, "
            f"email={self.email!r}"
            f")>"
        )