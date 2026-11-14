
import logging
from collections import Counter
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated
from urllib.parse import unquote
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.barber.api.barber_workers import get_approved_barber
logger = logging.getLogger("kshurak.barber.customers")
router = APIRouter(prefix="/api/v1/barber/customers", tags=["Barber Customers"])
class CustomerVisit(BaseModel):
    booking_id: str
    booking_date: date
    start_time: str
    service_name: str
    service_price: float
    status: str
    customer_notes: str | None = None
class CustomerProfile(BaseModel):
    customer_key: str
    customer_id: str | None = None
    name: str
    phone: str
    image_url: str | None = None
    relationship: str
    total_bookings: int
    completed_visits: int
    total_spent: float
    first_booking: date
    last_booking: date
    last_visit: date | None = None
    favorite_service: str | None = None
    pending_bookings: int
    confirmed_bookings: int
    cancelled_bookings: int
    rejected_bookings: int
class CustomerSummary(BaseModel):
    total_customers: int
    new_this_month: int
    returning_customers: int
    regular_customers: int
    inactive_customers: int
    retention_rate: float
class CustomersResponse(BaseModel):
    summary: CustomerSummary
    customers: list[CustomerProfile]
class CustomerDetailResponse(BaseModel):
    customer: CustomerProfile
    visits: list[CustomerVisit]
def get_barber_id(barber: UUID | object) -> UUID:
    if isinstance(barber, UUID):
        return barber
    raw_id = getattr(barber, "id", None)
    if raw_id is None:
        raise HTTPException(status_code=401, detail="Invalid barber authentication context.")
    try:
        return UUID(str(raw_id))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid barber authentication context.") from exc
def normalized_phone(value: object) -> str:
    return "".join(character for character in str(value or "") if character.isdigit())
def customer_key(booking: dict) -> str:
    customer_id = booking.get("customer_id")
    if customer_id:
        return f"id:{customer_id}"
    phone = normalized_phone(booking.get("customer_phone"))
    if phone:
        return f"phone:{phone}"
    return f"booking:{booking['id']}"
def decimal_amount(value: object) -> float:
    if value is None:
        return 0.0
    return float(Decimal(str(value)))
async def load_shop_bookings(db: AsyncSession, barber_id: UUID) -> list[dict]:
    statement = text("""
        SELECT id, customer_id, customer_name, customer_phone,
               customer_image_url, service_name, service_price,
               booking_date, start_time, status, customer_notes,
               created_at
        FROM public.barber_bookings
        WHERE barber_id = :barber_id
        ORDER BY booking_date DESC, created_at DESC, id DESC
    """)
    try:
        result = await db.execute(statement, {"barber_id": barber_id})
        return [dict(row) for row in result.mappings().all()]
    except SQLAlchemyError as exc:
        logger.exception("Unable to load CRM customers for barber")
        raise HTTPException(status_code=500, detail="Unable to load customer information.") from exc
def build_customer(booking_rows: list[dict], today: date) -> CustomerProfile:
    latest = booking_rows[0]
    booking_dates = [row["booking_date"] for row in booking_rows]
    completed = [row for row in booking_rows if row["status"] == "completed"]
    completed_dates = [row["booking_date"] for row in completed]
    service_counts = Counter(row["service_name"] for row in completed if row.get("service_name"))
    completed_count = len(completed)
    last_visit = max(completed_dates) if completed_dates else None
    if completed_count >= 5:
        relationship = "regular"
    elif last_visit and last_visit < today - timedelta(days=90):
        relationship = "inactive"
    elif completed_count >= 2:
        relationship = "returning"
    else:
        relationship = "new"
    return CustomerProfile(
        customer_key=customer_key(latest),
        customer_id=str(latest["customer_id"]) if latest.get("customer_id") else None,
        name=str(latest.get("customer_name") or "Customer"),
        phone=str(latest.get("customer_phone") or ""),
        image_url=latest.get("customer_image_url"),
        relationship=relationship,
        total_bookings=len(booking_rows),
        completed_visits=completed_count,
        total_spent=round(sum(decimal_amount(row.get("service_price")) for row in completed), 2),
        first_booking=min(booking_dates),
        last_booking=max(booking_dates),
        last_visit=last_visit,
        favorite_service=service_counts.most_common(1)[0][0] if service_counts else None,
        pending_bookings=sum(row["status"] == "pending" for row in booking_rows),
        confirmed_bookings=sum(row["status"] == "confirmed" for row in booking_rows),
        cancelled_bookings=sum(row["status"] == "cancelled" for row in booking_rows),
        rejected_bookings=sum(row["status"] == "rejected" for row in booking_rows),
    )
def group_customers(bookings: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for booking in bookings:
        key = customer_key(booking)
        grouped.setdefault(key, []).append(booking)
    return grouped
@router.get("", response_model=CustomersResponse)
async def list_customers(
    db: Annotated[AsyncSession, Depends(get_db)],
    barber: Annotated[UUID, Depends(get_approved_barber)],
):
    barber_id = get_barber_id(barber)
    today = date.today()
    bookings = await load_shop_bookings(db, barber_id)
    grouped = group_customers(bookings)
    customers = [build_customer(rows, today) for rows in grouped.values()]
    customers.sort(key=lambda customer: customer.last_booking, reverse=True)
    new_this_month = sum(
        customer.first_booking.year == today.year
        and customer.first_booking.month == today.month
        for customer in customers
    )
    returning = sum(customer.completed_visits >= 2 for customer in customers)
    regular = sum(customer.relationship == "regular" for customer in customers)
    inactive = sum(customer.relationship == "inactive" for customer in customers)
    visited = sum(customer.completed_visits >= 1 for customer in customers)
    retention_rate = round((returning / visited) * 100, 1) if visited else 0.0
    return CustomersResponse(
        summary=CustomerSummary(
            total_customers=len(customers),
            new_this_month=new_this_month,
            returning_customers=returning,
            regular_customers=regular,
            inactive_customers=inactive,
            retention_rate=retention_rate,
        ),
        customers=customers,
    )
@router.get("/{customer_identifier:path}", response_model=CustomerDetailResponse)
async def get_customer_details(
    customer_identifier: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    barber: Annotated[UUID, Depends(get_approved_barber)],
):
    barber_id = get_barber_id(barber)
    identifier = unquote(customer_identifier)
    bookings = await load_shop_bookings(db, barber_id)
    grouped = group_customers(bookings)
    matching = grouped.get(identifier)
    if not matching:
        raise HTTPException(status_code=404, detail="Customer not found for this shop.")
    customer = build_customer(matching, date.today())
    visits = [
        CustomerVisit(
            booking_id=str(row["id"]),
            booking_date=row["booking_date"],
            start_time=str(row["start_time"]),
            service_name=row["service_name"],
            service_price=decimal_amount(row.get("service_price")),
            status=row["status"],
            customer_notes=row.get("customer_notes"),
        )
        for row in matching
    ]
    return CustomerDetailResponse(customer=customer, visits=visits)
