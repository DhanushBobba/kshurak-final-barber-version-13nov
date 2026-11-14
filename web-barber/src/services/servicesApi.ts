
const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || ""
).trim().replace(/\/+$/, "");

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

function getToken(): string {
  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");

  if (!token) {
    throw new Error("Your login session is missing. Please sign in.");
  }

  return token;
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error(
      "VITE_API_BASE_URL is not configured."
    );
  }

  const token = getToken();

  let response: Response;

  try {
    response = await fetch(
      `${API_BASE_URL}/api/v1/barber/services${endpoint}`,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body
            ? { "Content-Type": "application/json" }
            : {}),
          ...options.headers,
        },
      }
    );
  } catch {
    throw new Error(
      "Unable to connect to the Barber Backend."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "Your login session has expired. Please sign in again."
      );
    }

    const detail = data.detail;

    throw new Error(
      typeof detail === "string"
        ? detail
        : typeof detail?.message === "string"
          ? detail.message
          : `Request failed (${response.status}).`
    );
  }

  return data as T;
}

export async function getBarberServices(
  activeOnly = false
): Promise<ServiceListResponse> {
  return apiRequest<ServiceListResponse>(
    `?active_only=${activeOnly}`
  );
}

export async function createBarberService(
  payload: ServicePayload
): Promise<ServiceActionResponse> {
  return apiRequest<ServiceActionResponse>("", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateBarberService(
  serviceId: string,
  payload: Partial<ServicePayload> & {
    is_active?: boolean;
  }
): Promise<ServiceActionResponse> {
  return apiRequest<ServiceActionResponse>(
    `/${encodeURIComponent(serviceId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
}

export async function setBarberServiceStatus(
  serviceId: string,
  isActive: boolean
): Promise<ServiceActionResponse> {
  return apiRequest<ServiceActionResponse>(
    `/${encodeURIComponent(serviceId)}/status?is_active=${isActive}`,
    {
      method: "PATCH",
    }
  );
}
