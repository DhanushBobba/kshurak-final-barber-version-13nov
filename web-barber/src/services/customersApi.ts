
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");
const CUSTOMERS_ENDPOINT = `${API_BASE_URL}/api/v1/barber/customers`;
export type CustomerRelationship = "new" | "returning" | "regular" | "inactive";
export interface CustomerSummary {
  total_customers: number;
  new_this_month: number;
  returning_customers: number;
  regular_customers: number;
  inactive_customers: number;
  retention_rate: number;
}
export interface CustomerProfile {
  customer_key: string;
  customer_id: string | null;
  name: string;
  phone: string;
  image_url: string | null;
  relationship: CustomerRelationship;
  total_bookings: number;
  completed_visits: number;
  total_spent: number;
  first_booking: string;
  last_booking: string;
  last_visit: string | null;
  favorite_service: string | null;
  pending_bookings: number;
  confirmed_bookings: number;
  cancelled_bookings: number;
  rejected_bookings: number;
}
export interface CustomerVisit {
  booking_id: string;
  booking_date: string;
  start_time: string;
  service_name: string;
  service_price: number;
  status: string;
  customer_notes: string | null;
}
export interface CustomersResponse {
  summary: CustomerSummary;
  customers: CustomerProfile[];
}
export interface CustomerDetailResponse {
  customer: CustomerProfile;
  visits: CustomerVisit[];
}
function accessToken(): string {
  const token = sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");
  if (!token) throw new Error("Your login session has expired. Please log in again.");
  return token;
}
async function customersRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!API_BASE_URL) throw new Error("VITE_API_BASE_URL is not configured.");
  let response: Response;
  try {
    response = await fetch(`${CUSTOMERS_ENDPOINT}${path}`, {
      method: "GET",
      signal,
      headers: {
        Authorization: `Bearer ${accessToken()}`,
        Accept: "application/json"
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("Cannot connect to KSHURAK FastAPI.");
  }
  if (!response.ok) {
    let message = `Customers request failed (${response.status}).`;
    try {
      const data: unknown = await response.json();
      if (data && typeof data === "object" && "detail" in data) {
        const detail = (data as { detail: unknown }).detail;
        if (typeof detail === "string") message = detail;
      }
    } catch {
      // Keep HTTP error message.
    }
    if (response.status === 401) throw new Error("Session expired. Please log in again.");
    if (response.status === 403) throw new Error("You do not have permission to view customers.");
    if (response.status === 404) throw new Error("Customer not found or Customers API is not registered.");
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
export function getShopCustomers(signal?: AbortSignal): Promise<CustomersResponse> {
  return customersRequest<CustomersResponse>("", signal);
}
export function getShopCustomerDetails(
  customerKey: string,
  signal?: AbortSignal
): Promise<CustomerDetailResponse> {
  return customersRequest<CustomerDetailResponse>(
    `/${encodeURIComponent(customerKey)}`,
    signal
  );
}
