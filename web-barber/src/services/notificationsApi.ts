
const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || ""
).trim().replace(/\/+$/, "");

const NOTIFICATIONS_ENDPOINT =
  `${API_BASE_URL}/api/v1/barber/notifications`;

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

function getAccessToken(): string {
  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");

  if (!token) {
    throw new Error(
      "Your Barber session has expired. Please log in again."
    );
  }

  return token;
}

async function notificationRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error(
      "VITE_API_BASE_URL is missing. Configure the KSHURAK backend URL in your frontend .env file."
    );
  }

  const token = getAccessToken();
  const headers = new Headers(options.headers);

  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(
      `${NOTIFICATIONS_ENDPOINT}${path}`,
      {
        ...options,
        headers,
      }
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw error;
    }

    throw new Error(
      "Unable to connect to the KSHURAK backend. Check whether FastAPI is running."
    );
  }

  if (!response.ok) {
    let detail = `Notification request failed (${response.status}).`;

    try {
      const data: unknown = await response.json();

      if (
        data &&
        typeof data === "object" &&
        "detail" in data
      ) {
        const value = (
          data as { detail: unknown }
        ).detail;

        if (typeof value === "string") {
          detail = value;
        } else if (Array.isArray(value)) {
          detail = value
            .map((item: unknown) => {
              if (
                item &&
                typeof item === "object" &&
                "msg" in item
              ) {
                return String(
                  (item as { msg: unknown }).msg
                );
              }

              return String(item);
            })
            .join(", ");
        }
      }
    } catch {
      // Retain the HTTP status error.
    }

    if (response.status === 401) {
      throw new Error(
        `Authentication failed: ${detail} Please log in again if your session has expired.`
      );
    }

    if (response.status === 403) {
      throw new Error(
        `Access denied: ${detail}`
      );
    }

    if (response.status === 404) {
      throw new Error(
        "Notification not found or the Notifications API endpoint is unavailable."
      );
    }

    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}

export async function getNotifications(
  filters: NotificationFilters = {},
  signal?: AbortSignal
): Promise<NotificationListResponse> {
  const params = new URLSearchParams();

  params.set("category", filters.category || "all");

  if (filters.unreadOnly !== undefined) {
    params.set(
      "unread_only",
      String(filters.unreadOnly)
    );
  }

  params.set(
    "limit",
    String(
      Math.min(100, Math.max(1, filters.limit ?? 30))
    )
  );

  params.set(
    "offset",
    String(Math.max(0, filters.offset ?? 0))
  );

  return notificationRequest<NotificationListResponse>(
    `?${params.toString()}`,
    {
      method: "GET",
      signal,
    }
  );
}

export async function getUnreadNotificationCount(
  signal?: AbortSignal
): Promise<UnreadCountResponse> {
  return notificationRequest<UnreadCountResponse>(
    "/unread-count",
    {
      method: "GET",
      signal,
    }
  );
}

export async function getNotificationById(
  notificationId: string,
  signal?: AbortSignal
): Promise<BarberNotification> {
  return notificationRequest<BarberNotification>(
    `/${encodeURIComponent(notificationId)}`,
    {
      method: "GET",
      signal,
    }
  );
}

export async function markNotificationAsRead(
  notificationId: string
): Promise<NotificationActionResponse> {
  return notificationRequest<NotificationActionResponse>(
    `/${encodeURIComponent(notificationId)}/read`,
    {
      method: "PATCH",
    }
  );
}

export async function markAllNotificationsAsRead(): Promise<MarkAllReadResponse> {
  return notificationRequest<MarkAllReadResponse>(
    "/read-all",
    {
      method: "POST",
    }
  );
}
