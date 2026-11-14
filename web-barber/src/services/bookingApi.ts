const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const BOOKINGS_ENDPOINT =
  `${API_BASE_URL}/api/v1/barber/bookings`;

const configuredTimeout = Number(
  import.meta.env.VITE_BOOKING_REQUEST_TIMEOUT_MS || 30000
);

const REQUEST_TIMEOUT_MS =
  Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : 30000;

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "rejected";

export type BookingFilterStatus = BookingStatus | "all";

export type HairstylePreviewAngle = "front" | "left" | "right";

export interface BookingHairstylePreview {
  angle: HairstylePreviewAngle;
  image: string;
}

export interface BookingHairstyleSelection {
  version: 1;
  source: "virtual_tryon";
  scan_id: string;
  hairstyle_id: string;
  hairstyle_name: string;
  reference_image: string;
  style_analysis: string;
  face_shape: string | null;
  previews: BookingHairstylePreview[];
}

export interface BarberBooking {
  id: string;
  barber_id: string;
  worker_id: string | null;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_image_url: string | null;
  service_name: string;
  service_duration_minutes: number;
  service_price: string | number;
  booking_date: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  customer_notes: string | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;

  hairstyle_selection?: BookingHairstyleSelection | null;
  has_hairstyle_selection?: boolean;
  hairstyle_name?: string | null;
  hairstyle_details_loaded?: boolean;
}

export interface BookingCounts {
  pending: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  rejected: number;
}

export interface BookingListResponse {
  bookings: BarberBooking[];
  total: number;
  counts: BookingCounts;
}

export interface BookingActionResponse {
  message: string;
  booking: BarberBooking;
}

export interface BookingFilters {
  status?: BookingFilterStatus;
  dateFrom?: string;
  dateTo?: string;
}

export class BookingApiError extends Error {
  readonly status: number;
  readonly outcomeUnknown: boolean;

  constructor(
    message: string,
    status = 0,
    outcomeUnknown = false
  ) {
    super(message);
    this.name = "BookingApiError";
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
  }
}

function getAccessToken(): string {
  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");

  if (!token?.trim()) {
    throw new BookingApiError(
      "Your login session has expired. Please log in again.",
      401
    );
  }

  return token.trim();
}

function readErrorDetail(
  body: unknown,
  fallback: string
): string {
  if (!body || typeof body !== "object" || !("detail" in body)) {
    return fallback;
  }

  const detail = (body as { detail: unknown }).detail;

  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item: unknown) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String(item.msg);
        }

        return typeof item === "string" ? item : "";
      })
      .filter(Boolean);

    return messages.length ? messages.join(", ") : fallback;
  }

  if (
    detail &&
    typeof detail === "object" &&
    "message" in detail &&
    typeof detail.message === "string"
  ) {
    return detail.message;
  }

  return fallback;
}

function bookingPath(bookingId: string): string {
  const id = bookingId.trim();

  if (!id) {
    throw new BookingApiError("Booking identification is missing.");
  }

  return `/${encodeURIComponent(id)}`;
}

async function bookingRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAccessToken();
  const controller = new AbortController();
  const callerSignal = options.signal;
  const isMutation = (options.method || "GET").toUpperCase() !== "GET";

  let timedOut = false;

  const abortFromCaller = () => controller.abort();

  if (callerSignal?.aborted) {
    controller.abort();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, {
      once: true,
    });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const headers = new Headers(options.headers);

  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const response = await fetch(`${BOOKINGS_ENDPOINT}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    const responseText = await response.text();

    let body: unknown = null;

    if (responseText) {
      try {
        body = JSON.parse(responseText);
      } catch {
        // An invalid response is handled below.
      }
    }

    if (!response.ok) {
      const fallback =
        response.status === 401
          ? "Your session has expired. Please log in again."
          : response.status === 403
          ? "You do not have permission to manage bookings."
          : response.status === 404
          ? "Booking not found or booking API unavailable."
          : `Booking request failed (${response.status}).`;

      throw new BookingApiError(
        readErrorDetail(body, fallback),
        response.status,
        isMutation && response.status >= 500
      );
    }

    if (!body || typeof body !== "object") {
      throw new BookingApiError(
        isMutation
          ? "The booking result could not be verified. Refresh bookings before trying again."
          : "The backend returned an invalid bookings response.",
        response.status,
        isMutation
      );
    }

    return body as T;
  } catch (error: unknown) {
    if (error instanceof BookingApiError) {
      throw error;
    }

    if (callerSignal?.aborted) {
      throw error;
    }

    const message = timedOut
      ? isMutation
        ? "The booking update timed out. Its result is unknown. Refresh bookings before trying again."
        : "Loading bookings timed out. Please use Refresh to try again."
      : isMutation
      ? "The connection was interrupted. Check the booking status before repeating the update."
      : "Unable to connect to the KSHURAK backend.";

    throw new BookingApiError(message, 0, isMutation);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function getBarberBookings(
  filters: BookingFilters = {},
  signal?: AbortSignal
): Promise<BookingListResponse> {
  const params = new URLSearchParams();

  // Excludes the large saved hairstyle JSON from the list query.
  params.set("include_hairstyle", "false");

  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status);
  }

  if (filters.dateFrom) {
    params.set("date_from", filters.dateFrom);
  }

  if (filters.dateTo) {
    params.set("date_to", filters.dateTo);
  }

  const result = await bookingRequest<BookingListResponse>(
    `?${params.toString()}`,
    { method: "GET", signal }
  );

  if (!Array.isArray(result.bookings)) {
    throw new BookingApiError("Invalid bookings list received.");
  }

  return result;
}

export async function getBarberBookingById(
  bookingId: string,
  signal?: AbortSignal
): Promise<BarberBooking> {
  const booking = await bookingRequest<BarberBooking>(
    bookingPath(bookingId),
    { method: "GET", signal }
  );

  if (booking.id !== bookingId.trim()) {
    throw new BookingApiError("Invalid booking details received.");
  }

  return booking;
}

export async function acceptBarberBooking(
  bookingId: string,
  workerId?: string | null
): Promise<BookingActionResponse> {
  return bookingRequest<BookingActionResponse>(
    `${bookingPath(bookingId)}/accept`,
    {
      method: "POST",
      body: JSON.stringify({
        worker_id: workerId?.trim() || null,
      }),
    }
  );
}

export async function rejectBarberBooking(
  bookingId: string,
  reason: string
): Promise<BookingActionResponse> {
  const trimmed = reason.trim();

  if (trimmed.length < 3 || trimmed.length > 500) {
    throw new BookingApiError(
      "Enter a rejection reason between 3 and 500 characters."
    );
  }

  return bookingRequest<BookingActionResponse>(
    `${bookingPath(bookingId)}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ reason: trimmed }),
    }
  );
}

export async function completeBarberBooking(
  bookingId: string
): Promise<BookingActionResponse> {
  return bookingRequest<BookingActionResponse>(
    `${bookingPath(bookingId)}/complete`,
    { method: "POST" }
  );
}

export async function cancelBarberBooking(
  bookingId: string,
  reason: string
): Promise<BookingActionResponse> {
  const trimmed = reason.trim();

  if (trimmed.length < 3 || trimmed.length > 500) {
    throw new BookingApiError(
      "Enter a cancellation reason between 3 and 500 characters."
    );
  }

  return bookingRequest<BookingActionResponse>(
    `${bookingPath(bookingId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ reason: trimmed }),
    }
  );
}