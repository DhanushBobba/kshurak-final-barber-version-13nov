import * as SecureStore from "expo-secure-store";

const BASE = String(
  process.env.EXPO_PUBLIC_API_BASE_URL || ""
).trim().replace(/\/+$/, "");

const PATH = "/api/v1/barber/services";

export type BarberService = {
  id: string;
  barber_id: string;
  service_name: string;
  description: string | null;
  duration_minutes: number;
  price: number | string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ServicePayload = {
  service_name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
};

export type ServiceListResponse = {
  services: BarberService[];
  total: number;
};

export type ServiceActionResponse = {
  message: string;
  service: BarberService;
};

export class ServicesApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ServicesApiError";
    this.status = status;
  }
}

async function token(): Promise<string> {
  let value: string | null;

  try {
    value = await SecureStore.getItemAsync("kshurak_barber_token");
  } catch {
    throw new ServicesApiError("Unable to read your secure login session.");
  }

  if (!value) {
    throw new ServicesApiError("Session expired. Please sign in again.", 401);
  }

  return value;
}

function errorDetail(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object" || !("detail" in data)) {
    return fallback;
  }

  const detail = (data as { detail: unknown }).detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return detail.map((item: unknown) => {
      if (item && typeof item === "object" && "msg" in item) {
        return String((item as { msg: unknown }).msg);
      }
      return String(item);
    }).join(", ");
  }

  if (detail && typeof detail === "object" && "message" in detail) {
    return String((detail as { message: unknown }).message);
  }

  return fallback;
}

async function request<T>(
  endpoint: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  payload?: unknown,
  signal?: AbortSignal
): Promise<T> {
  if (!/^https?:\/\/[^/]+/i.test(BASE)) {
    throw new ServicesApiError("EXPO_PUBLIC_API_BASE_URL is missing or invalid.");
  }

  const accessToken = await token();
  let response: Response;

  try {
    response = await fetch(`${BASE}${PATH}${endpoint}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch (error: unknown) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw error;
    }

    throw new ServicesApiError(
      "Unable to connect to KSHURAK. Check the backend and phone network."
    );
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ServicesApiError(
      response.status === 401
        ? "Your session has expired. Please sign in again."
        : errorDetail(data, `Services request failed (${response.status}).`),
      response.status
    );
  }

  if (!data) throw new ServicesApiError("Empty Services API response.");
  return data as T;
}

export async function getBarberServices(
  activeOnly = false,
  signal?: AbortSignal
): Promise<ServiceListResponse> {
  const result = await request<ServiceListResponse>(
    `?active_only=${activeOnly}`, "GET", undefined, signal
  );

  if (!Array.isArray(result.services)) {
    throw new ServicesApiError("Invalid services list response.");
  }

  return result;
}

export function createBarberService(
  payload: ServicePayload
): Promise<ServiceActionResponse> {
  return request("", "POST", payload);
}

export function updateBarberService(
  serviceId: string,
  payload: Partial<ServicePayload> & { is_active?: boolean }
): Promise<ServiceActionResponse> {
  return request(`/${encodeURIComponent(serviceId)}`, "PATCH", payload);
}

export function setBarberServiceStatus(
  serviceId: string,
  isActive: boolean
): Promise<ServiceActionResponse> {
  return request(
    `/${encodeURIComponent(serviceId)}/status?is_active=${isActive}`,
    "PATCH"
  );
}