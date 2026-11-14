import * as SecureStore from "expo-secure-store";

const API_BASE_URL = String(
  process.env.EXPO_PUBLIC_API_BASE_URL || ""
).trim().replace(/\/+$/, "");

const ENDPOINT = `${API_BASE_URL}/api/v1/barber/notifications`;

export type NotificationType =
  | "new_booking"
  | "booking_accepted"
  | "booking_rejected"
  | "booking_cancelled"
  | "booking_completed"
  | "reschedule_requested"
  | "reschedule_approved"
  | "reschedule_declined"
  | "reschedule_withdrawn"
  | "appointment_reminder"
  | "shop_update"
  | "account_alert"
  | "general";

export type NotificationCategory =
  | "all"
  | "booking"
  | "rescheduling"
  | "other";

export interface BarberNotification {
  id: string;
  recipient_type: "barber" | "customer" | "admin";
  recipient_id: string;
  notification_type: NotificationType;
  title: string;
  message: string;
  reference_type: string | null;
  reference_id: string | null;
  action_url: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationCounts {
  total: number;
  unread: number;
  booking: number;
  rescheduling: number;
  other: number;
}

export interface NotificationListResponse {
  notifications: BarberNotification[];
  total: number;
  limit: number;
  offset: number;
  counts: NotificationCounts;
}

export interface UnreadCountResponse {
  unread_count: number;
}

export interface NotificationActionResponse {
  message: string;
  notification: BarberNotification;
}

export interface MarkAllReadResponse {
  message: string;
  updated_count: number;
  unread_count: number;
}

export interface NotificationFilters {
  category?: NotificationCategory;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

export class NotificationsApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "NotificationsApiError";
    this.status = status;
  }
}

async function getAccessToken(): Promise<string> {
  let token: string | null;

  try {
    token = await SecureStore.getItemAsync("kshurak_barber_token");
  } catch {
    throw new NotificationsApiError(
      "Unable to read your secure login session."
    );
  }

  if (!token) {
    throw new NotificationsApiError(
      "Your Barber session has expired. Please log in again.",
      401
    );
  }

  return token;
}

function getErrorMessage(status: number, data: unknown): string {
  let detail = `Notification request failed (${status}).`;

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
  if (status === 403) return `Access denied: ${detail}`;
  if (status === 404) {
    return "Notification not found or the Notifications API is unavailable.";
  }

  return detail;
}

async function notificationRequest<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  if (!/^https?:\/\/[^/]+/i.test(API_BASE_URL)) {
    throw new NotificationsApiError(
      "EXPO_PUBLIC_API_BASE_URL is missing or invalid."
    );
  }

  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;

  try {
    response = await fetch(`${ENDPOINT}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error: unknown) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }

    throw new NotificationsApiError(
      "Unable to connect to KSHURAK. Check the server and your connection."
    );
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new NotificationsApiError(
      getErrorMessage(response.status, data),
      response.status
    );
  }

  if (data === null || data === undefined) {
    throw new NotificationsApiError(
      "The Notifications API returned an empty response."
    );
  }

  return data as T;
}

function safeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}

export async function getNotifications(
  filters: NotificationFilters = {},
  signal?: AbortSignal
): Promise<NotificationListResponse> {
  const limit = Math.min(100, Math.max(1, safeInteger(filters.limit, 30)));
  const offset = Math.max(0, safeInteger(filters.offset, 0));

  const params = [
    `category=${encodeURIComponent(filters.category || "all")}`,
    `limit=${limit}`,
    `offset=${offset}`,
  ];

  if (filters.unreadOnly !== undefined) {
    params.push(`unread_only=${String(filters.unreadOnly)}`);
  }

  const result = await notificationRequest<NotificationListResponse>(
    `?${params.join("&")}`,
    "GET",
    undefined,
    signal
  );

  if (
    !result ||
    !Array.isArray(result.notifications) ||
    !result.counts ||
    !Number.isFinite(result.total) ||
    result.total < 0
  ) {
    throw new NotificationsApiError(
      "Invalid notification list received from the backend."
    );
  }

  return result;
}

export function getUnreadNotificationCount(
  signal?: AbortSignal
): Promise<UnreadCountResponse> {
  return notificationRequest("/unread-count", "GET", undefined, signal);
}

export function getNotificationById(
  notificationId: string,
  signal?: AbortSignal
): Promise<BarberNotification> {
  return notificationRequest(
    `/${encodeURIComponent(notificationId)}`,
    "GET",
    undefined,
    signal
  );
}

export function markNotificationAsRead(
  notificationId: string
): Promise<NotificationActionResponse> {
  return notificationRequest(
    `/${encodeURIComponent(notificationId)}/read`,
    "PATCH"
  );
}

export function markAllNotificationsAsRead(): Promise<MarkAllReadResponse> {
  return notificationRequest("/read-all", "POST");
}