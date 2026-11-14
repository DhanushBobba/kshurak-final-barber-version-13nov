import * as SecureStore from "expo-secure-store";

const API_BASE_URL = String(
  process.env.EXPO_PUBLIC_API_BASE_URL || ""
).trim().replace(/\/+$/, "");

const CUSTOMERS_PATH = "/api/v1/barber/customers";
const TOKEN_KEY = "kshurak_barber_token";

export type CustomerRelationship =
  | "new"
  | "returning"
  | "regular"
  | "inactive";

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

export class CustomersApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "CustomersApiError";
    this.status = status;
  }
}

async function accessToken(): Promise<string> {
  let token: string | null;

  try {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    throw new CustomersApiError(
      "Unable to read your secure login session."
    );
  }

  if (!token) {
    throw new CustomersApiError(
      "Your Barber session has expired. Please log in again.",
      401
    );
  }

  return token;
}

function getErrorMessage(status: number, data: unknown): string {
  let detail = `Customers request failed (${status}).`;

  if (data && typeof data === "object" && "detail" in data) {
    const value = (data as { detail: unknown }).detail;

    if (typeof value === "string") {
      detail = value;
    } else if (Array.isArray(value)) {
      detail = value.map((item: unknown) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return String(item);
      }).join(", ");
    } else if (
      value &&
      typeof value === "object" &&
      "message" in value
    ) {
      detail = String((value as { message: unknown }).message);
    }
  }

  if (status === 401) {
    return "Your login session is invalid or expired. Please log in again.";
  }
  if (status === 403) {
    return "You do not have permission to view customers.";
  }
  if (status === 404) {
    return "Customer not found or the Customers API is unavailable.";
  }

  return detail;
}

async function customersRequest<T>(
  path: string,
  signal?: AbortSignal
): Promise<T> {
  if (!/^https?:\/\/[^/]+/i.test(API_BASE_URL)) {
    throw new CustomersApiError(
      "EXPO_PUBLIC_API_BASE_URL is missing or invalid."
    );
  }

  const token = await accessToken();
  let response: Response;

  try {
    response = await fetch(
      `${API_BASE_URL}${CUSTOMERS_PATH}${path}`,
      {
        method: "GET",
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );
  } catch (error: unknown) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }

    throw new CustomersApiError(
      "Unable to connect to KSHURAK. Check your backend and phone network."
    );
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new CustomersApiError(
      getErrorMessage(response.status, data),
      response.status
    );
  }

  if (data === null || data === undefined) {
    throw new CustomersApiError(
      "The Customers API returned an empty response."
    );
  }

  return data as T;
}

export async function getShopCustomers(
  signal?: AbortSignal
): Promise<CustomersResponse> {
  const result = await customersRequest<CustomersResponse>("", signal);

  if (
    !result ||
    !result.summary ||
    !Array.isArray(result.customers)
  ) {
    throw new CustomersApiError(
      "Invalid Customers API response received."
    );
  }

  return result;
}

export async function getShopCustomerDetails(
  customerKey: string,
  signal?: AbortSignal
): Promise<CustomerDetailResponse> {
  if (!customerKey.trim()) {
    throw new CustomersApiError("Customer identification is missing.");
  }

  const result = await customersRequest<CustomerDetailResponse>(
    `/${encodeURIComponent(customerKey)}`,
    signal
  );

  if (
    !result ||
    !result.customer ||
    !Array.isArray(result.visits)
  ) {
    throw new CustomersApiError(
      "Invalid customer profile response received."
    );
  }

  return result;
}