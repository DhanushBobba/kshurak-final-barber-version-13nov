
export interface BarberRegistrationPayload {
  username: string;
  email: string;
  password: string;
  years_experience: number;
  shop_name: string;
  shop_phone: string;
  shop_address: string;
  shop_image: File | null;
  shop_documents: File[];
}

export interface BarberRegistrationResponse {
  id: string;
  status: "pending";
  message: string;
}

export interface BarberDocument {
  path: string;
  original_name: string | null;
  content_type: string | null;
  size: number | null;
  document_type: string | null;
}

export interface BarberProfileResponse {
  id: string;
  username: string;
  email: string;
  years_experience: number;
  shop_name: string | null;
  shop_phone: string | null;
  shop_address: string;
  shop_image_path: string | null;
  document_paths: BarberDocument[];
  approval_status: string;
  is_email_activated: boolean;
}

export interface BarberWorker {
  id: string;
  barber_id: string;
  full_name: string;
  phone: string;
  role: string;
  years_experience: number;
  specializations: string | null;
  shift_start: string;
  shift_end: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkerPayload {
  full_name: string;
  phone: string;
  role: string;
  years_experience: number;
  specializations: string;
  shift_start: string;
  shift_end: string;
  is_active: boolean;
}

export type UpdateWorkerPayload =
  Partial<CreateWorkerPayload>;

export interface WorkerBreak {
  id: string;
  start: string;
  end: string;
}

export interface WorkerSlotPayload {
  slots: Record<string, boolean>;
  breaks: WorkerBreak[];
}

export interface WorkerSlotResponse
  extends WorkerSlotPayload {
  worker_id: string;
  date: string;
  shift_start: string;
  shift_end: string;
  slot_duration_minutes: number;
}

const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || ""
).trim().replace(/\/+$/, "");

const MAX_SHOP_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;
const MAX_DOCUMENTS = 5;

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  ...ALLOWED_IMAGE_TYPES,
];

function requireApiBaseUrl(): string {
  if (!API_BASE_URL) {
    throw new Error(
      "Set VITE_API_BASE_URL in your Web frontend .env file."
    );
  }
  return API_BASE_URL;
}

function apiErrorMessage(
  data: unknown,
  fallback: string
): string {
  if (!data || typeof data !== "object") {
    return fallback;
  }

  const detail =
    (data as { detail?: unknown }).detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (
    detail &&
    typeof detail === "object" &&
    !Array.isArray(detail)
  ) {
    const message =
      (detail as { message?: unknown }).message;

    if (typeof message === "string") {
      return message;
    }
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item: unknown) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          item &&
          typeof item === "object" &&
          "msg" in item
        ) {
          return String(
            (item as { msg: unknown }).msg
          );
        }

        return "Invalid field";
      })
      .join(", ");
  }

  return fallback;
}

function validateRegistrationFiles(
  payload: BarberRegistrationPayload
): void {
  const shopName = payload.shop_name.trim();
  const phone = payload.shop_phone.trim();
  const digits = phone.replace(/\D/g, "");

  if (shopName.length < 2 || shopName.length > 150) {
    throw new Error(
      "Shop name must contain 2 to 150 characters."
    );
  }

  if (
    !/^[0-9+\-\s()]{10,20}$/.test(phone) ||
    digits.length < 10 ||
    digits.length > 15
  ) {
    throw new Error("Enter a valid shop contact number.");
  }

  if (!payload.shop_image) {
    throw new Error("Please upload a shop image.");
  }

  if (
    !ALLOWED_IMAGE_TYPES.includes(
      payload.shop_image.type
    )
  ) {
    throw new Error(
      "Shop image must be JPG, PNG, or WebP."
    );
  }

  if (
    payload.shop_image.size === 0 ||
    payload.shop_image.size > MAX_SHOP_IMAGE_SIZE
  ) {
    throw new Error(
      "Shop image must be a non-empty file smaller than 8 MB."
    );
  }

  if (
    payload.shop_documents.length === 0 ||
    payload.shop_documents.length > MAX_DOCUMENTS
  ) {
    throw new Error(
      "Upload between 1 and 5 shop documents."
    );
  }

  for (const document of payload.shop_documents) {
    if (
      !ALLOWED_DOCUMENT_TYPES.includes(
        document.type
      )
    ) {
      throw new Error(
        "Documents must be PDF, JPG, PNG, or WebP."
      );
    }

    if (
      document.size === 0 ||
      document.size > MAX_DOCUMENT_SIZE
    ) {
      throw new Error(
        `Document "${document.name}" must be smaller than 5 MB.`
      );
    }
  }
}

export async function registerBarber(
  payload: BarberRegistrationPayload
): Promise<BarberRegistrationResponse> {
  validateRegistrationFiles(payload);

  const formData = new FormData();

  formData.append("username", payload.username.trim());
  formData.append(
    "email",
    payload.email.trim().toLowerCase()
  );
  formData.append("password", payload.password);
  formData.append(
    "years_experience",
    String(payload.years_experience)
  );
  formData.append(
    "shop_name",
    payload.shop_name.trim()
  );
  formData.append(
    "shop_phone",
    payload.shop_phone.trim()
  );
  formData.append(
    "shop_address",
    payload.shop_address.trim()
  );

  if (payload.shop_image) {
    formData.append(
      "shop_image",
      payload.shop_image,
      payload.shop_image.name
    );
  }

  for (const document of payload.shop_documents) {
    formData.append(
      "shop_documents",
      document,
      document.name
    );
  }

  let response: Response;

  try {
    response = await fetch(
      `${requireApiBaseUrl()}/api/v1/barber/register`,
      {
        method: "POST",
        body: formData,
      }
    );
  } catch {
    throw new Error(
      "Cannot connect to KSHURAK FastAPI."
    );
  }

  const data: unknown =
    await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      apiErrorMessage(data, "Registration failed.")
    );
  }

  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as { id?: unknown }).id !== "string" ||
    (data as { status?: unknown }).status !== "pending" ||
    typeof (data as { message?: unknown }).message !== "string"
  ) {
    throw new Error(
      "Invalid registration response from backend."
    );
  }

  return data as BarberRegistrationResponse;
}

function getBarberAccessToken(): string {
  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");

  if (!token) {
    throw new Error(
      "Your login session is missing. Please log in again."
    );
  }

  return token;
}

async function requestBarberApi<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "PUT" = "GET",
  payload?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getBarberAccessToken()}`,
    Accept: "application/json",
  };

  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;

  try {
    response = await fetch(
      `${requireApiBaseUrl()}${path}`,
      {
        method,
        headers,
        body:
          payload === undefined
            ? undefined
            : JSON.stringify(payload),
        cache: "no-store",
        signal,
      }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw error;
    }

    throw new Error(
      "Cannot connect to KSHURAK backend. Check FastAPI."
    );
  }

  const data: unknown =
    await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "Login session expired. Please log in again."
      );
    }

    throw new Error(
      apiErrorMessage(
        data,
        `Request failed (${response.status}).`
      )
    );
  }

  if (data === null || data === undefined) {
    throw new Error(
      "Backend returned an empty JSON response."
    );
  }

  return data as T;
}

export async function getBarberProfile(
  signal?: AbortSignal
): Promise<BarberProfileResponse> {
  const result =
    await requestBarberApi<
      Partial<BarberProfileResponse>
    >(
      "/api/v1/barber/profile",
      "GET",
      undefined,
      signal
    );

  if (
    !result ||
    typeof result.id !== "string" ||
    typeof result.username !== "string" ||
    typeof result.email !== "string" ||
    typeof result.shop_address !== "string" ||
    typeof result.years_experience !== "number"
  ) {
    throw new Error(
      "Incomplete barber profile returned by backend."
    );
  }

  return {
    id: result.id,
    username: result.username,
    email: result.email,
    years_experience: result.years_experience,
    shop_name: result.shop_name ?? null,
    shop_phone: result.shop_phone ?? null,
    shop_address: result.shop_address,
    shop_image_path: result.shop_image_path ?? null,
    document_paths: Array.isArray(result.document_paths)
      ? result.document_paths
      : [],
    approval_status: result.approval_status ?? "",
    is_email_activated:
      Boolean(result.is_email_activated),
  };
}

export async function getWorkers(
  signal?: AbortSignal
): Promise<BarberWorker[]> {
  const result =
    await requestBarberApi<unknown>(
      "/api/v1/barber/workers",
      "GET",
      undefined,
      signal
    );

  if (!Array.isArray(result)) {
    throw new Error("Invalid worker list.");
  }

  if (
    !result.every(
      (worker) =>
        worker &&
        typeof worker === "object" &&
        typeof worker.id === "string" &&
        typeof worker.full_name === "string"
    )
  ) {
    throw new Error("Invalid worker records.");
  }

  return result as BarberWorker[];
}

export async function createWorker(
  payload: CreateWorkerPayload
): Promise<BarberWorker> {
  if (
    !payload.full_name.trim() ||
    !payload.phone.trim()
  ) {
    throw new Error(
      "Worker name and phone are required."
    );
  }

  return requestBarberApi<BarberWorker>(
    "/api/v1/barber/workers",
    "POST",
    payload
  );
}

export async function updateWorker(
  workerId: string,
  payload: UpdateWorkerPayload
): Promise<BarberWorker> {
  if (!workerId.trim()) {
    throw new Error("Worker ID is required.");
  }

  return requestBarberApi<BarberWorker>(
    `/api/v1/barber/workers/${encodeURIComponent(workerId)}`,
    "PATCH",
    payload
  );
}

export async function setWorkerActive(
  workerId: string,
  isActive: boolean
): Promise<BarberWorker> {
  return updateWorker(workerId, {
    is_active: isActive,
  });
}

export async function getWorkerSlots(
  workerId: string,
  workDate: string,
  signal?: AbortSignal
): Promise<WorkerSlotResponse> {
  if (
    !workerId.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(workDate)
  ) {
    throw new Error(
      "Valid worker ID and YYYY-MM-DD date are required."
    );
  }

  return requestBarberApi<WorkerSlotResponse>(
    `/api/v1/barber/workers/${encodeURIComponent(workerId)}/slots/${workDate}`,
    "GET",
    undefined,
    signal
  );
}

export async function saveWorkerSlots(
  workerId: string,
  workDate: string,
  payload: WorkerSlotPayload
): Promise<WorkerSlotResponse> {
  if (
    !workerId.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(workDate)
  ) {
    throw new Error(
      "Valid worker ID and YYYY-MM-DD date are required."
    );
  }

  if (
    !payload.slots ||
    !Array.isArray(payload.breaks)
  ) {
    throw new Error(
      "Slots and breaks must be provided."
    );
  }

  return requestBarberApi<WorkerSlotResponse>(
    `/api/v1/barber/workers/${encodeURIComponent(workerId)}/slots/${workDate}`,
    "PUT",
    payload
  );
}

export function toWorkerPayload(worker: {
  fullName: string;
  phone: string;
  role: string;
  experience: string;
  specializations: string;
  startTime: string;
  endTime: string;
  active: boolean;
}): CreateWorkerPayload {
  const yearsExperience = Number(worker.experience);

  if (
    !Number.isInteger(yearsExperience) ||
    yearsExperience < 0 ||
    yearsExperience > 80
  ) {
    throw new Error(
      "Experience must be between 0 and 80 years."
    );
  }

  return {
    full_name: worker.fullName.trim(),
    phone: worker.phone.trim(),
    role: worker.role.trim(),
    years_experience: yearsExperience,
    specializations: worker.specializations.trim(),
    shift_start: worker.startTime,
    shift_end: worker.endTime,
    is_active: worker.active,
  };
}

export function fromBarberWorker(
  worker: BarberWorker
): {
  id: string;
  fullName: string;
  phone: string;
  role: string;
  experience: string;
  specializations: string;
  startTime: string;
  endTime: string;
  active: boolean;
} {
  return {
    id: worker.id,
    fullName: worker.full_name,
    phone: worker.phone,
    role: worker.role,
    experience: String(worker.years_experience),
    specializations: worker.specializations ?? "",
    startTime: worker.shift_start.slice(0, 5),
    endTime: worker.shift_end.slice(0, 5),
    active: worker.is_active,
  };
}
