const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const RESCHEDULING_ENDPOINT =
  `${API_BASE_URL}/api/v1/barber/rescheduling`;

/* ============================================================
   TYPES
============================================================ */

export type RescheduleStatus =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled";

export type RescheduleRequester = "barber" | "customer";

export type RescheduleRequestKind =
  | "appointment_change"
  | "worker_unavailability";

export type RecoveryOptionType =
  | "cancel_booking"
  | "same_worker_other_day"
  | "other_worker_same_day";

export interface RecoveryOption {
  id: string;
  request_id: string;
  option_type: RecoveryOptionType;
  worker_id: string | null;
  appointment_date: string | null;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
}

export interface RescheduleRequest {
  id: string;
  booking_id: string;
  requested_by: RescheduleRequester;

  requested_date: string;
  requested_start_time: string;
  requested_end_time: string;
  requested_worker_id: string | null;

  original_date: string;
  original_start_time: string;
  original_end_time: string;
  original_worker_id: string | null;

  status: RescheduleStatus;
  reason: string | null;
  decision_reason: string | null;
  decided_by: RescheduleRequester | null;
  decided_at: string | null;

  created_at: string;
  updated_at: string;

  customer_name: string;
  customer_phone: string;
  service_name: string;
  service_price: number;
  booking_status: string;

  request_kind: RescheduleRequestKind;
  selected_option_type: RecoveryOptionType | null;
  options: RecoveryOption[];
}

export interface RescheduleCounts {
  pending: number;
  approved: number;
  declined: number;
  cancelled: number;
}

export interface RescheduleListResponse {
  requests: RescheduleRequest[];
  total: number;
  counts: RescheduleCounts;
}

export interface RescheduleActionResponse {
  message: string;
  request: RescheduleRequest;
}

export interface EligibleRescheduleBooking {
  id: string;
  barber_id: string;
  worker_id: string;
  customer_id: string;

  customer_name: string;
  customer_phone: string;
  customer_image_url: string | null;

  worker_name: string | null;
  service_name: string;
  service_duration_minutes: number;
  service_price: number | string;

  booking_date: string;
  start_time: string;
  end_time: string;
  status: "confirmed";

  confirmed_at: string;
  created_at: string;
  updated_at: string;

  reschedule_deadline: string;
}

export interface EligibleBookingsResponse {
  bookings: EligibleRescheduleBooking[];
  total: number;
  server_time: string;
  limit: number;
}

export interface CreateReschedulePayload {
  booking_id: string;
  requested_date: string;
  requested_start_time: string;
  requested_end_time: string;
  requested_worker_id?: string | null;
  reason: string;
}

export interface CancellationOptionInput {
  option_type: "cancel_booking";
}

export interface AppointmentOptionInput {
  option_type:
    | "same_worker_other_day"
    | "other_worker_same_day";

  worker_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
}

export type RecoveryOptionInput =
  | CancellationOptionInput
  | AppointmentOptionInput;

export interface CreateWorkerUnavailabilityPayload {
  booking_id: string;
  reason: string;
  options: RecoveryOptionInput[];
}

/* ============================================================
   API ERROR
============================================================ */

export class ReschedulingApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly deadline: string | null;

  constructor(
    message: string,
    status: number,
    code: string | null = null,
    deadline: string | null = null
  ) {
    super(message);
    this.name = "ReschedulingApiError";
    this.status = status;
    this.code = code;
    this.deadline = deadline;
  }
}

/* ============================================================
   INTERNAL HELPERS
============================================================ */

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function getAccessToken(): string {
  const token = (
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token") ||
    ""
  ).trim();

  if (!token) {
    throw new ReschedulingApiError(
      "Your barber session has expired. Please log in again.",
      401,
      "SESSION_REQUIRED"
    );
  }

  return token;
}

function requestPath(requestId: string): string {
  const id = requestId.trim();

  if (!id) {
    throw new Error("The rescheduling request ID is missing.");
  }

  return `/${encodeURIComponent(id)}`;
}

function cleanReason(reason: string): string {
  const value = reason.trim();

  if (value.length < 3 || value.length > 1000) {
    throw new Error(
      "Please provide a reason containing 3 to 1000 characters."
    );
  }

  return value;
}

function cleanDecisionReason(
  reason?: string
): string | null {
  const value = reason?.trim() || null;

  if (value && value.length > 1000) {
    throw new Error(
      "The response must not exceed 1000 characters."
    );
  }

  return value;
}

function minutesOfDay(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(
    value
  );

  if (!match) {
    throw new Error(
      "Appointment times must use HH:mm with whole minutes."
    );
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function validateTimeRange(
  start: string,
  end: string
): void {
  if (minutesOfDay(end) <= minutesOfDay(start)) {
    throw new Error(
      "The appointment end time must be after its start time."
    );
  }
}

function parseError(
  payload: unknown,
  status: number
): ReschedulingApiError {
  let message = `Rescheduling request failed (${status}).`;
  let code: string | null = null;
  let deadline: string | null = null;

  const detail = isRecord(payload)
    ? payload.detail ?? payload
    : payload;

  if (typeof detail === "string") {
    message = detail;
  } else if (Array.isArray(detail)) {
    const messages = detail.flatMap((item: unknown) => {
      if (isRecord(item) && typeof item.msg === "string") {
        return [item.msg];
      }

      return [];
    });

    if (messages.length > 0) {
      message = messages.join(" ");
    }
  } else if (isRecord(detail)) {
    if (typeof detail.message === "string") {
      message = detail.message;
    }

    if (typeof detail.code === "string") {
      code = detail.code;
    }

    if (typeof detail.deadline === "string") {
      deadline = detail.deadline;
    }
  }

  if (status === 401) {
    message =
      "Your login session is invalid or expired. Please log in again.";
  }

  return new ReschedulingApiError(
    message,
    status,
    code,
    deadline
  );
}

async function requestApi<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error(
      "VITE_API_BASE_URL is missing from your frontend environment."
    );
  }

  const headers = new Headers(options.headers);

  headers.set("Authorization", `Bearer ${getAccessToken()}`);
  headers.set("Accept", "application/json");

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const isMutation =
    (options.method || "GET").toUpperCase() !== "GET";

  let response: Response;

  try {
    response = await fetch(
      `${RESCHEDULING_ENDPOINT}${path}`,
      {
        ...options,
        headers,
        cache: "no-store",
      }
    );
  } catch (error: unknown) {
    if (
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }

    throw new ReschedulingApiError(
      isMutation
        ? "Unable to confirm the result. Refresh the requests before submitting again."
        : "Unable to connect to the KSHURAK backend.",
      0,
      "NETWORK_ERROR"
    );
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch (error: unknown) {
    if (
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }

    if (!response.ok) {
      throw parseError(null, response.status);
    }

    throw new ReschedulingApiError(
      isMutation
        ? "The server returned an unreadable result. Refresh the requests before submitting again."
        : "The server returned an unreadable response.",
      response.status,
      "INVALID_RESPONSE"
    );
  }

  if (!response.ok) {
    throw parseError(payload, response.status);
  }

  if (!isRecord(payload)) {
    throw new ReschedulingApiError(
      "The server returned an unexpected response.",
      response.status,
      "INVALID_RESPONSE"
    );
  }

  return payload as T;
}

/* ============================================================
   READ REQUESTS
============================================================ */

export async function getRescheduleRequests(
  status?: RescheduleStatus,
  signal?: AbortSignal
): Promise<RescheduleListResponse> {
  const params = new URLSearchParams();

  if (status) {
    params.set("status", status);
  }

  const query = params.toString();

  return requestApi<RescheduleListResponse>(
    query ? `?${query}` : "",
    {
      method: "GET",
      signal,
    }
  );
}

export async function getRescheduleById(
  requestId: string,
  signal?: AbortSignal
): Promise<RescheduleRequest> {
  return requestApi<RescheduleRequest>(
    requestPath(requestId),
    {
      method: "GET",
      signal,
    }
  );
}

/* ============================================================
   ELIGIBLE BOOKINGS

   Backend filters:
   - confirmed bookings;
   - appointments that have not started;
   - within 24 hours of confirmation;
   - assigned worker and linked customer;
   - no existing pending reschedule request.
============================================================ */

export async function getEligibleRescheduleBookings(
  signal?: AbortSignal
): Promise<EligibleBookingsResponse> {
  return requestApi<EligibleBookingsResponse>(
    "/eligible-bookings",
    {
      method: "GET",
      signal,
    }
  );
}

/* ============================================================
   NORMAL BARBER PROPOSAL
============================================================ */

export async function createRescheduleRequest(
  payload: CreateReschedulePayload,
  signal?: AbortSignal
): Promise<RescheduleActionResponse> {
  if (!payload.booking_id.trim()) {
    throw new Error("Please select a booking.");
  }

  if (!payload.requested_date) {
    throw new Error("Please select an appointment date.");
  }

  validateTimeRange(
    payload.requested_start_time,
    payload.requested_end_time
  );

  return requestApi<RescheduleActionResponse>("", {
    method: "POST",
    signal,
    body: JSON.stringify({
      booking_id: payload.booking_id.trim(),
      requested_date: payload.requested_date,
      requested_start_time: payload.requested_start_time,
      requested_end_time: payload.requested_end_time,
      requested_worker_id:
        payload.requested_worker_id || null,
      reason: cleanReason(payload.reason),
    }),
  });
}

/* ============================================================
   WORKER UNAVAILABILITY: THREE CUSTOMER CHOICES
============================================================ */

export async function createWorkerUnavailabilityRequest(
  payload: CreateWorkerUnavailabilityPayload,
  signal?: AbortSignal
): Promise<RescheduleActionResponse> {
  if (!payload.booking_id.trim()) {
    throw new Error("Please select a booking.");
  }

  const expectedTypes = new Set<RecoveryOptionType>([
    "cancel_booking",
    "same_worker_other_day",
    "other_worker_same_day",
  ]);

  const suppliedTypes = new Set(
    payload.options.map((option) => option.option_type)
  );

  if (
    payload.options.length !== 3 ||
    suppliedTypes.size !== 3 ||
    [...expectedTypes].some(
      (type) => !suppliedTypes.has(type)
    )
  ) {
    throw new Error(
      "Provide cancellation, another day with the same worker, and the same day with another worker."
    );
  }

  const options = payload.options.map((option) => {
    if (option.option_type === "cancel_booking") {
      return {
        option_type: "cancel_booking" as const,
      };
    }

    if (
      !option.worker_id.trim() ||
      !option.appointment_date
    ) {
      throw new Error(
        "Each appointment option needs a worker and date."
      );
    }

    validateTimeRange(option.start_time, option.end_time);

    return {
      option_type: option.option_type,
      worker_id: option.worker_id.trim(),
      appointment_date: option.appointment_date,
      start_time: option.start_time,
      end_time: option.end_time,
    };
  });

  return requestApi<RescheduleActionResponse>(
    "/worker-unavailability",
    {
      method: "POST",
      signal,
      body: JSON.stringify({
        booking_id: payload.booking_id.trim(),
        reason: cleanReason(payload.reason),
        options,
      }),
    }
  );
}

/* ============================================================
   DECISIONS AND WITHDRAWAL
============================================================ */

export async function approveRescheduleRequest(
  requestId: string,
  signal?: AbortSignal
): Promise<RescheduleActionResponse> {
  return requestApi<RescheduleActionResponse>(
    `${requestPath(requestId)}/approve`,
    {
      method: "POST",
      signal,
    }
  );
}

export async function declineRescheduleRequest(
  requestId: string,
  reason?: string,
  signal?: AbortSignal
): Promise<RescheduleActionResponse> {
  return requestApi<RescheduleActionResponse>(
    `${requestPath(requestId)}/decline`,
    {
      method: "POST",
      signal,
      body: JSON.stringify({
        reason: cleanDecisionReason(reason),
      }),
    }
  );
}

export async function withdrawRescheduleRequest(
  requestId: string,
  signal?: AbortSignal
): Promise<RescheduleActionResponse> {
  return requestApi<RescheduleActionResponse>(
    `${requestPath(requestId)}/withdraw`,
    {
      method: "POST",
      signal,
    }
  );
}