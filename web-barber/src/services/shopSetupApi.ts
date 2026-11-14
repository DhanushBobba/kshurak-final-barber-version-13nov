
const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

export type SetupSection =
  | "profile"
  | "shop"
  | "workers"
  | "documents"
  | "capacity";

export type SubmissionStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected";

export interface RegistrationDocument {
  path: string;
  original_name: string | null;
  content_type: string | null;
  size: number | null;
  document_type: string | null;
}

export interface SavedShopSetup {
  application_id: string | null;
  setup_data: Record<string, unknown>;
  completed_sections: SetupSection[];
  submission_status: SubmissionStatus;
  location_verified: boolean;
  submitted_at: string | null;
  published_at: string | null;
  registration_documents: RegistrationDocument[];
  shop_image_path: string | null;
}

function getToken(): string {
  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");

  if (!token) {
    throw new Error(
      "Please log in again."
    );
  }

  return token;
}

function getApiBaseUrl(): string {
  if (!API_BASE_URL) {
    throw new Error(
      "VITE_API_BASE_URL is not configured."
    );
  }

  return API_BASE_URL;
}

async function request<T>(
  method: "GET" | "PUT" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(
    `${getApiBaseUrl()}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        Accept: "application/json",
        ...(body === undefined
          ? {}
          : {
              "Content-Type": "application/json",
            }),
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(body),
      cache: "no-store",
    }
  );

  const data: unknown =
    await response.json().catch(() => null);

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;

    if (
      data &&
      typeof data === "object" &&
      "detail" in data
    ) {
      const detail = (
        data as { detail?: unknown }
      ).detail;

      if (typeof detail === "string") {
        message = detail;
      } else if (
        detail &&
        typeof detail === "object" &&
        "message" in detail
      ) {
        message = String(
          (detail as { message: unknown }).message
        );
      }
    }

    throw new Error(message);
  }

  if (!data || typeof data !== "object") {
    throw new Error(
      "Invalid Shop Setup response."
    );
  }

  return data as T;
}

export async function getShopSetup():
  Promise<SavedShopSetup> {
  return request<SavedShopSetup>(
    "GET",
    "/api/v1/barber/shop-setup"
  );
}

export async function saveShopSetup(
  setupData: Record<string, unknown>
): Promise<SavedShopSetup> {
  return request<SavedShopSetup>(
    "PUT",
    "/api/v1/barber/shop-setup",
    {
      setup_data: setupData,
      completed_sections: [],
    }
  );
}

export async function submitShopSetup():
  Promise<SavedShopSetup> {
  return request<SavedShopSetup>(
    "POST",
    "/api/v1/barber/shop-setup/submit"
  );
}

export async function uploadShopSetupDocument(
  file: File,
  documentType: string
): Promise<{
  message: string;
  registration_documents: RegistrationDocument[];
}> {
  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");
  if (!token) {
    throw new Error("Please log in again.");
  }
  const formData = new FormData();
  formData.append("document_type", documentType);
  formData.append("document", file, file.name);
  const response = await fetch(
    `${API_BASE_URL}/api/v1/barber/shop-setup/documents`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    }
  );
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : "Document upload failed."
    );
  }
  return result;
}
