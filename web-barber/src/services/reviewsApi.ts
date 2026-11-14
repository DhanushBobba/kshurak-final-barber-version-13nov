
const BASE = String(
  import.meta.env.VITE_API_BASE_URL || ""
).trim().replace(/\/+$/, "");

export interface Review {
  id: string;
  booking_id: string;
  customer_id: string | null;
  customer_name: string;
  barber_id: string;
  service_name: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  barber_replied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewStatistics {
  total_reviews: number;
  average_rating: number | null;
  five_star_reviews: number;
  five_star_percentage: number | null;
  replied_reviews: number;
  response_rate: number | null;
  rating_distribution: {
    rating: number;
    count: number;
    percentage: number;
  }[];
}

export type ReviewSort =
  | "newest"
  | "oldest"
  | "highest"
  | "lowest";

export interface ReviewFilters {
  search?: string;
  rating?: number;
  serviceName?: string;
  sort?: ReviewSort;
  limit?: number;
  offset?: number;
}

export interface ReviewList {
  reviews: Review[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReviewReplyResponse {
  message: string;
  review: Review;
}

function getErrorMessage(
  data: unknown,
  status: number
): string {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail?: unknown }).detail;

    if (typeof detail === "string") {
      return detail;
    }

    if (detail && typeof detail === "object" && "message" in detail) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }

    if (Array.isArray(detail)) {
      return detail
        .map((item: { msg?: string }) => item.msg || "Invalid value")
        .join(", ");
    }
  }

  return `Reviews request failed (${status}).`;
}

async function request<T>(
  path: string,
  method: "GET" | "PUT" = "GET",
  payload?: unknown,
  signal?: AbortSignal
): Promise<T> {
  if (!BASE) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }

  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");

  if (!token) {
    throw new Error("Please log in again.");
  }

  let response: Response;

  try {
    response = await fetch(
      `${BASE}/api/v1/barber/reviews${path}`,
      {
        method,
        signal,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(payload === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          payload === undefined
            ? undefined
            : JSON.stringify(payload),
      }
    );
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }

    throw new Error("Unable to connect to the KSHURAK backend.");
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Session expired. Please log in again.");
    }

    throw new Error(getErrorMessage(data, response.status));
  }

  if (data === null) {
    throw new Error("Empty Reviews API response.");
  }

  return data as T;
}

export async function getReviews(
  filters: ReviewFilters = {},
  signal?: AbortSignal
): Promise<ReviewList> {
  const query = new URLSearchParams();

  if (filters.search?.trim()) {
    query.set("search", filters.search.trim());
  }

  if (filters.rating !== undefined) {
    query.set("rating", String(filters.rating));
  }

  if (filters.serviceName?.trim()) {
    query.set("service_name", filters.serviceName.trim());
  }

  query.set("sort", filters.sort || "newest");
  query.set(
    "limit",
    String(Math.min(100, Math.max(1, filters.limit ?? 5)))
  );
  query.set(
    "offset",
    String(Math.max(0, filters.offset ?? 0))
  );

  const result = await request<ReviewList>(
    `?${query.toString()}`,
    "GET",
    undefined,
    signal
  );

  if (
    !Array.isArray(result.reviews) ||
    !Number.isFinite(result.total)
  ) {
    throw new Error("Invalid reviews list response.");
  }

  return result;
}

export async function getReviewStatistics(
  signal?: AbortSignal
): Promise<ReviewStatistics> {
  const result = await request<ReviewStatistics>(
    "/statistics",
    "GET",
    undefined,
    signal
  );

  if (
    !Number.isFinite(result.total_reviews) ||
    !Array.isArray(result.rating_distribution)
  ) {
    throw new Error("Invalid review statistics response.");
  }

  return result;
}

export function getReviewById(
  id: string,
  signal?: AbortSignal
): Promise<Review> {
  return request<Review>(
    `/${encodeURIComponent(id)}`,
    "GET",
    undefined,
    signal
  );
}

export function saveReviewReply(
  id: string,
  reply: string
): Promise<ReviewReplyResponse> {
  const cleaned = reply.trim();

  if (!cleaned || cleaned.length > 3000) {
    throw new Error("Enter a reply between 1 and 3000 characters.");
  }

  return request<ReviewReplyResponse>(
    `/${encodeURIComponent(id)}/reply`,
    "PUT",
    { reply: cleaned }
  );
}
