
import uuid
from sqlalchemy import Column, String, Text, Integer, Boolean, DateTime, CheckConstraint, Index, func, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base
class BarberAccount(Base):
    """KSHURAK barber registration account mapped to public.barber_accounts."""
    __tablename__ = "barber_accounts"
    __table_args__ = (
        CheckConstraint("years_experience BETWEEN 0 AND 50", name="barber_accounts_years_experience_check"),
        CheckConstraint("approval_status IN ('pending', 'approved', 'rejected')", name="barber_accounts_approval_status_check"),
        CheckConstraint("username ~ '^[A-Za-z0-9_]{3,50}$'", name="barber_username_format"),
        CheckConstraint("email = LOWER(BTRIM(email)) AND LENGTH(email) > 3", name="barber_email_normalized"),
        CheckConstraint("LENGTH(BTRIM(shop_address)) >= 10", name="barber_address_length"),
        CheckConstraint("LENGTH(password_hash) > 0", name="barber_password_hash_required"),
        Index("ux_barber_accounts_email", text("LOWER(email)"), unique=True),
        Index("ux_barber_accounts_username", text("LOWER(username)"), unique=True),
        Index("idx_barber_accounts_approval", "approval_status"),
        Index("idx_barber_accounts_created", text("created_at DESC")),
        {"schema": "public"},
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    username = Column(String(50), nullable=False)
    email = Column(String(254), nullable=False)
    password_hash = Column(Text, nullable=False)
    shop_name = Column(String(150), nullable=True)
    shop_address = Column(Text, nullable=False)
    years_experience = Column(Integer, nullable=False)
    shop_phone = Column(String(20), nullable=True)
    shop_image_path = Column(Text, nullable=True)
    document_paths = Column(JSONB, nullable=True, server_default=text("'[]'::jsonb"))
    approval_status = Column(String(20), nullable=False, default="pending", server_default=text("'pending'"))
    is_email_activated = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    approved_at = Column(DateTime(timezone=True), nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    def __repr__(self):
        return f"<BarberAccount(id={self.id}, username={self.username!r}, shop_name={self.shop_name!r}, approval_status={self.approval_status!r})>"
