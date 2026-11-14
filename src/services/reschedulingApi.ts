
import * as SecureStore from "expo-secure-store";

// ============================================================
// CONFIGURATION
// ============================================================

const API_BASE_URL = String(
  process.env.EXPO_PUBLIC_API_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const RESCHEDULING_ENDPOINT =
  `${API_BASE_URL}/api/v1/barber/rescheduling`;

const PRIMARY_TOKEN_KEY = "kshurak_barber_token";
const LEGACY_TOKEN_KEY = "barber_access_token";

// ============================================================
// TYPES - MATCH WEB APP
// ============================================================

export type RescheduleStatus =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled";

export type RescheduleRequester =
  | "barber"
  | "customer";

export type RescheduleRequestKind =
  | "appointment_change"
  | "worker_unavailability";

export type RecoveryOptionType =
  | "cancel_booking"
  | "same_worker_other_day"
  | "other_worker_same_day";

// ============================================================
// RECOVERY OPTIONS
// ============================================================

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

// ============================================================
// RESCHEDULE REQUEST
// ============================================================

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

  selected_option_type:
    | RecoveryOptionType
    | null;

  options: RecoveryOption[];
}

// ============================================================
// COUNTS AND RESPONSES
// ============================================================

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

// ============================================================
// ELIGIBLE BOOKINGS - EXACT WEB APP TYPE STRUCTURE
// ============================================================

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

// ============================================================
// NORMAL RESCHEDULE PAYLOAD
// ============================================================

export interface CreateReschedulePayload {
  booking_id: string;

  requested_date: string;
  requested_start_time: string;
  requested_end_time: string;

  requested_worker_id?: string | null;

  reason: string;
}

// ============================================================
// THREE-OPTION WORKER UNAVAILABILITY PAYLOAD
// ============================================================

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

// ============================================================
// API ERROR
// ============================================================

export class ReschedulingApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly deadline: string | null;

  /**
   * A mutation may have succeeded even though the
   * client could not verify its response.
   *
   * The screen must refresh the requests before
   * allowing another submission.
   */
  readonly outcomeUnknown: boolean;

  constructor(
    message: string,
    status = 0,
    code: string | null = null,
    deadline: string | null = null,
    outcomeUnknown = false
  ) {
    super(message);

    this.name = "ReschedulingApiError";
    this.status = status;
    this.code = code;
    this.deadline = deadline;
    this.outcomeUnknown = outcomeUnknown;

    Object.setPrototypeOf(
      this,
      ReschedulingApiError.prototype
    );
  }
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

// ============================================================
// ENVIRONMENT CONFIGURATION
// ============================================================

function validateApiConfiguration(): void {
  if (
    !/^https?:\/\/[^/]+/i.test(API_BASE_URL)
  ) {
    throw new ReschedulingApiError(
      "EXPO_PUBLIC_API_BASE_URL is missing or invalid.",
      0,
      "API_URL_REQUIRED"
    );
  }
}

// ============================================================
// MOBILE SECURE TOKEN ACCESS
// ============================================================

async function getAccessToken(): Promise<string> {
  let token: string | null = null;

  try {
    token = await SecureStore.getItemAsync(
      PRIMARY_TOKEN_KEY
    );

    // Compatibility with older mobile sessions.
    if (!token?.trim()) {
      token = await SecureStore.getItemAsync(
        LEGACY_TOKEN_KEY
      );
    }
  } catch {
    throw new ReschedulingApiError(
      "Unable to read your secure barber login session.",
      0,
      "SESSION_READ_FAILED"
    );
  }

  if (!token?.trim()) {
    throw new ReschedulingApiError(
      "Your barber session has expired. Please log in again.",
      401,
      "SESSION_REQUIRED"
    );
  }

  return token.trim();
}

// ============================================================
// ABORT HANDLING
// ============================================================

function checkAborted(
  signal?: AbortSignal
): void {
  if (!signal?.aborted) return;

  const error = new Error(
    "The request was cancelled."
  );

  error.name = "AbortError";

  throw error;
}

function isAbortError(
  error: unknown,
  signal?: AbortSignal
): boolean {
  return (
    signal?.aborted === true ||
    (
      error instanceof Error &&
      error.name === "AbortError"
    )
  );
}

// ============================================================
// VALIDATE REQUEST ID
// ============================================================

function requestPath(
  requestId: string
): string {
  const id = requestId.trim();

  if (!id) {
    throw new ReschedulingApiError(
      "The rescheduling request ID is missing.",
      0,
      "REQUEST_ID_REQUIRED"
    );
  }

  return `/${encodeURIComponent(id)}`;
}

// ============================================================
// VALIDATE DATE
// ============================================================

function validDate(
  value: string
): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(
    `${value}T12:00:00Z`
  );

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

// ============================================================
// TIME HELPERS
// ============================================================

function minutesOfDay(
  value: string
): number {
  const match =
    /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(
      value
    );

  if (!match) {
    throw new ReschedulingApiError(
      "Appointment times must use HH:mm with whole minutes.",
      0,
      "INVALID_APPOINTMENT_TIME"
    );
  }

  return (
    Number(match[1]) * 60 +
    Number(match[2])
  );
}

function validateTimeRange(
  start: string,
  end: string
): void {
  if (
    minutesOfDay(end) <=
    minutesOfDay(start)
  ) {
    throw new ReschedulingApiError(
      "The appointment end time must be after its start time.",
      0,
      "INVALID_TIME_RANGE"
    );
  }
}

function validateAppointment(
  date: string,
  start: string,
  end: string
): void {
  if (!validDate(date)) {
    throw new ReschedulingApiError(
      "Enter a valid appointment date in YYYY-MM-DD format.",
      0,
      "INVALID_APPOINTMENT_DATE"
    );
  }

  validateTimeRange(start, end);
}

// ============================================================
// VALIDATE REASONS
// ============================================================

function cleanReason(
  reason: string
): string {
  const value = reason.trim();

  if (
    value.length < 3 ||
    value.length > 1000
  ) {
    throw new ReschedulingApiError(
      "Please provide a reason containing 3 to 1000 characters.",
      0,
      "INVALID_REASON"
    );
  }

  return value;
}

function cleanDecisionReason(
  reason?: string
): string | null {
  const value =
    reason?.trim() || null;

  if (
    value &&
    value.length > 1000
  ) {
    throw new ReschedulingApiError(
      "The response must not exceed 1000 characters.",
      0,
      "INVALID_DECISION_REASON"
    );
  }

  return value;
}

// ============================================================
// PARSE BACKEND ERRORS
// ============================================================

function parseError(
  payload: unknown,
  status: number,
  isMutation: boolean
): ReschedulingApiError {
  let message =
    `Rescheduling request failed (${status}).`;

  let code: string | null = null;
  let deadline: string | null = null;

  const detail = isRecord(payload)
    ? payload.detail ?? payload
    : payload;

  if (typeof detail === "string") {
    message = detail;
  } else if (
    Array.isArray(detail)
  ) {
    const messages = detail.flatMap(
      (item: unknown) => {
        if (
          isRecord(item) &&
          typeof item.msg === "string"
        ) {
          return [item.msg];
        }

        return [];
      }
    );

    if (messages.length > 0) {
      message = messages.join(" ");
    }
  } else if (
    isRecord(detail)
  ) {
    if (
      typeof detail.message === "string"
    ) {
      message = detail.message;
    }

    if (
      typeof detail.code === "string"
    ) {
      code = detail.code;
    }

    if (
      typeof detail.deadline === "string"
    ) {
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
    deadline,
    isMutation && status >= 500
  );
}

// ============================================================
// INVALID RESPONSE
// ============================================================

function invalidResponse(
  isMutation: boolean,
  status = 200
): ReschedulingApiError {
  return new ReschedulingApiError(
    isMutation
      ? "The result could not be verified. Refresh requests before submitting again."
      : "The backend returned an invalid rescheduling response.",
    status,
    "INVALID_RESPONSE",
    null,
    isMutation
  );
}

// ============================================================
// AUTHENTICATED API REQUEST
// ============================================================

async function requestApi<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  validateApiConfiguration();

  checkAborted(
    options.signal ?? undefined
  );

  const token = await getAccessToken();

  checkAborted(
    options.signal ?? undefined
  );

  const method = (
    options.method || "GET"
  ).toUpperCase();

  const isMutation = method !== "GET";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  if (
    options.body !== undefined
  ) {
    headers["Content-Type"] =
      "application/json";
  }

  let response: Response;

  try {
    response = await fetch(
      `${RESCHEDULING_ENDPOINT}${path}`,
      {
        ...options,
        method,
        headers,
        cache: "no-store",
      }
    );
  } catch (error: unknown) {
    if (
      isAbortError(
        error,
        options.signal ?? undefined
      )
    ) {
      throw error;
    }

    throw new ReschedulingApiError(
      isMutation
        ? "Unable to confirm the result. Refresh requests before submitting again."
        : "Unable to connect to KSHURAK. Check your internet connection and backend.",
      0,
      "NETWORK_ERROR",
      null,
      isMutation
    );
  }

  // ==========================================================
  // READ RESPONSE
  // ==========================================================

  let payload: unknown;

  try {
    payload = await response.json();
  } catch (error: unknown) {
    if (
      isAbortError(
        error,
        options.signal ?? undefined
      )
    ) {
      throw error;
    }

    if (!response.ok) {
      throw parseError(
        null,
        response.status,
        isMutation
      );
    }

    throw invalidResponse(
      isMutation,
      response.status
    );
  }

  // ==========================================================
  // HTTP ERROR
  // ==========================================================

  if (!response.ok) {
    throw parseError(
      payload,
      response.status,
      isMutation
    );
  }

  // ==========================================================
  // RESPONSE STRUCTURE
  // ==========================================================

  if (!isRecord(payload)) {
    throw invalidResponse(
      isMutation,
      response.status
    );
  }

  return payload as T;
}

// ============================================================
// GET RESCHEDULE REQUESTS
//
// GET /api/v1/barber/rescheduling
// GET /api/v1/barber/rescheduling?status=pending
// ============================================================

export async function getRescheduleRequests(
  status?: RescheduleStatus,
  signal?: AbortSignal
): Promise<RescheduleListResponse> {
  const params = new URLSearchParams();

  if (status) {
    params.set(
      "status",
      status
    );
  }

  const query =
    params.toString();

  const response =
    await requestApi<RescheduleListResponse>(
      query ? `?${query}` : "",
      {
        method: "GET",
        signal,
      }
    );

  if (
    !Array.isArray(
      response.requests
    ) ||
    !Number.isInteger(
      response.total
    ) ||
    response.total < 0 ||
    !isRecord(
      response.counts
    )
  ) {
    throw invalidResponse(false);
  }

  return response;
}

// ============================================================
// GET SINGLE RESCHEDULE REQUEST
//
// GET /api/v1/barber/rescheduling/{requestId}
// ============================================================

export async function getRescheduleById(
  requestId: string,
  signal?: AbortSignal
): Promise<RescheduleRequest> {
  const response =
    await requestApi<RescheduleRequest>(
      requestPath(requestId),
      {
        method: "GET",
        signal,
      }
    );

  if (
    typeof response.id !== "string" ||
    !response.id
  ) {
    throw invalidResponse(false);
  }

  return response;
}

// ============================================================
// GET ELIGIBLE BOOKINGS
//
// GET /api/v1/barber/rescheduling/eligible-bookings
//
// The backend determines eligibility using:
// - confirmed booking status
// - appointment not yet started
// - 24-hour confirmation window
// - assigned worker and linked customer
// - no existing pending request
// ============================================================

export async function getEligibleRescheduleBookings(
  signal?: AbortSignal
): Promise<EligibleBookingsResponse> {
  const response =
    await requestApi<EligibleBookingsResponse>(
      "/eligible-bookings",
      {
        method: "GET",
        signal,
      }
    );

  if (
    !Array.isArray(
      response.bookings
    ) ||
    !Number.isInteger(
      response.total
    ) ||
    response.total < 0 ||
    typeof response.server_time !==
      "string" ||
    !Number.isFinite(
      Date.parse(response.server_time)
    ) ||
    !Number.isInteger(
      response.limit
    ) ||
    response.limit <= 0
  ) {
    throw invalidResponse(false);
  }

  const validBookings =
    response.bookings.every(
      (booking) =>
        typeof booking.id ===
          "string" &&
        typeof booking.barber_id ===
          "string" &&
        typeof booking.worker_id ===
          "string" &&
        typeof booking.customer_id ===
          "string" &&
        booking.status ===
          "confirmed" &&
        typeof booking.confirmed_at ===
          "string" &&
        Number.isFinite(
          Date.parse(
            booking.confirmed_at
          )
        ) &&
        typeof booking.reschedule_deadline ===
          "string" &&
        Number.isFinite(
          Date.parse(
            booking.reschedule_deadline
          )
        ) &&
        validDate(
          booking.booking_date
        ) &&
        Number.isInteger(
          booking.service_duration_minutes
        ) &&
        booking.service_duration_minutes >
          0
    );

  if (!validBookings) {
    throw invalidResponse(false);
  }

  return response;
}

// ============================================================
// CREATE NORMAL RESCHEDULE REQUEST
//
// POST /api/v1/barber/rescheduling
//
// Retained for compatibility with existing mobile screens.
// ============================================================

export async function createRescheduleRequest(
  payload: CreateReschedulePayload,
  signal?: AbortSignal
): Promise<RescheduleActionResponse> {
  if (
    !payload.booking_id.trim()
  ) {
    throw new ReschedulingApiError(
      "Please select a booking.",
      0,
      "BOOKING_REQUIRED"
    );
  }

  validateAppointment(
    payload.requested_date,
    payload.requested_start_time,
    payload.requested_end_time
  );

  const body = {
    booking_id:
      payload.booking_id.trim(),

    requested_date:
      payload.requested_date,

    requested_start_time:
      payload.requested_start_time,

    requested_end_time:
      payload.requested_end_time,

    requested_worker_id:
      payload.requested_worker_id ||
      null,

    reason: cleanReason(
      payload.reason
    ),
  };

  return requestApi<RescheduleActionResponse>(
    "",
    {
      method: "POST",
      signal,
      body: JSON.stringify(body),
    }
  );
}

// ============================================================
// CREATE WORKER UNAVAILABILITY REQUEST
//
// POST /api/v1/barber/rescheduling/worker-unavailability
//
// Three customer recovery options:
//
// 1. Cancel booking
// 2. Another day with same worker
// 3. Same day with another worker
//
// Options are proposals, not reserved appointments.
// The backend performs final availability validation.
// ============================================================

export async function createWorkerUnavailabilityRequest(
  payload: CreateWorkerUnavailabilityPayload,
  signal?: AbortSignal
): Promise<RescheduleActionResponse> {
  if (
    !payload.booking_id.trim()
  ) {
    throw new ReschedulingApiError(
      "Please select a booking.",
      0,
      "BOOKING_REQUIRED"
    );
  }

  const expectedTypes =
    new Set<RecoveryOptionType>([
      "cancel_booking",
      "same_worker_other_day",
      "other_worker_same_day",
    ]);

  if (
    !Array.isArray(payload.options)
  ) {
    throw new ReschedulingApiError(
      "The three recovery options are required.",
      0,
      "RECOVERY_OPTIONS_REQUIRED"
    );
  }

  const suppliedTypes =
    new Set(
      payload.options.map(
        (option) =>
          option.option_type
      )
    );

  if (
    payload.options.length !==
      3 ||
    suppliedTypes.size !== 3 ||
    [...expectedTypes].some(
      (type) =>
        !suppliedTypes.has(type)
    )
  ) {
    throw new ReschedulingApiError(
      "Provide cancellation, another day with the same worker, and the same day with another worker.",
      0,
      "INVALID_RECOVERY_OPTIONS"
    );
  }

  const options =
    payload.options.map(
      (option) => {
        // ----------------------------------------------------
        // OPTION 1 - CANCELLATION
        // ----------------------------------------------------

        if (
          option.option_type ===
          "cancel_booking"
        ) {
          return {
            option_type:
              "cancel_booking" as const,
          };
        }

        // ----------------------------------------------------
        // OPTION 2 / 3 - APPOINTMENT ALTERNATIVES
        // ----------------------------------------------------

        if (
          !option.worker_id.trim()
        ) {
          throw new ReschedulingApiError(
            "Each appointment alternative must have a worker.",
            0,
            "WORKER_REQUIRED"
          );
        }

        validateAppointment(
          option.appointment_date,
          option.start_time,
          option.end_time
        );

        return {
          option_type:
            option.option_type,

          worker_id:
            option.worker_id.trim(),

          appointment_date:
            option.appointment_date,

          start_time:
            option.start_time,

          end_time:
            option.end_time,
        };
      }
    );

  const body = {
    booking_id:
      payload.booking_id.trim(),

    reason: cleanReason(
      payload.reason
    ),

    options,
  };

  return requestApi<RescheduleActionResponse>(
    "/worker-unavailability",
    {
      method: "POST",
      signal,
      body: JSON.stringify(body),
    }
  );
}

// ============================================================
// APPROVE RESCHEDULE REQUEST
//
// POST /api/v1/barber/rescheduling/{requestId}/approve
// ============================================================

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

// ============================================================
// DECLINE RESCHEDULE REQUEST
//
// POST /api/v1/barber/rescheduling/{requestId}/decline
// ============================================================

export async function declineRescheduleRequest(
  requestId: string,
  reason?: string,
  signal?: AbortSignal
): Promise<RescheduleActionResponse> {
  const body = {
    reason:
      cleanDecisionReason(
        reason
      ),
  };

  return requestApi<RescheduleActionResponse>(
    `${requestPath(requestId)}/decline`,
    {
      method: "POST",
      signal,
      body: JSON.stringify(body),
    }
  );
}

// ============================================================
// WITHDRAW RESCHEDULE REQUEST
//
// POST /api/v1/barber/rescheduling/{requestId}/withdraw
// ============================================================

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
