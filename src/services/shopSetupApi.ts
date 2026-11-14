import * as SecureStore from "expo-secure-store";

const BASE_URL = String(
  process.env.EXPO_PUBLIC_API_BASE_URL || ""
).trim().replace(/\/+$/, "");

const TOKEN_KEY = "kshurak_barber_token";
const SHOP_PATH = "/api/v1/barber/shop-setup";
const PROFILE_PATH = "/api/v1/barber/profile";
const WORKERS_PATH = "/api/v1/barber/workers";

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

export interface BarberDocument {
  path: string;
  original_name: string | null;
  content_type: string | null;
  size: number | null;
  document_type: string | null;
}

export type RegistrationDocument = BarberDocument;

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

export interface ShopSetupWorker {
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

export type BarberWorker = ShopSetupWorker;

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

export type UpdateWorkerPayload = Partial<CreateWorkerPayload>;

export interface WorkerFormValues {
  fullName: string;
  phone: string;
  role: string;
  experience: string;
  specializations: string;
  startTime: string;
  endTime: string;
  active: boolean;
}

export interface WorkerBreak {
  id: string;
  start: string;
  end: string;
}

export interface WorkerSlotPayload {
  slots: Record<string, boolean>;
  breaks: WorkerBreak[];
}

export interface WorkerSlotResponse {
  worker_id: string;
  date: string;
  shift_start: string;
  shift_end: string;
  slot_duration_minutes: number;
  slots: Record<string, boolean>;
  breaks: WorkerBreak[];
}

export const WEEK_DAYS = [
  "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
] as const;

export type WeekDay = typeof WEEK_DAYS[number];
export type WeeklyDays = Record<WeekDay, boolean>;

export interface WorkerWeeklyScheduleResponse {
  worker_id: string;
  weekly_days: WeeklyDays;
}

export interface ShopSetupOverview {
  profile: BarberProfileResponse;
  workers: ShopSetupWorker[];
  completed: {
    shop_profile: boolean;
    shop_details: boolean;
    workers: boolean;
    documents: boolean;
  };
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

export interface MobileDocument {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

export class ShopSetupApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ShopSetupApiError";
    this.status = status;
  }
}

function getBaseUrl(): string {
  if (!/^https?:\/\/[^/]+/i.test(BASE_URL)) {
    throw new ShopSetupApiError(
      "EXPO_PUBLIC_API_BASE_URL is missing or invalid."
    );
  }
  return BASE_URL;
}

async function getToken(): Promise<string> {
  let token: string | null;

  try {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    throw new ShopSetupApiError(
      "Unable to access your secure login session."
    );
  }

  if (!token) {
    throw new ShopSetupApiError(
      "Your session is missing. Please log in again.",
      401
    );
  }

  return token;
}

function errorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;

  const result = data as {
    detail?: unknown;
    message?: unknown;
  };

  if (typeof result.detail === "string") return result.detail;

  if (Array.isArray(result.detail)) {
    const messages = result.detail
      .map((item: unknown) => {
        if (!item || typeof item !== "object") return "";
        return String((item as { msg?: unknown }).msg || "");
      })
      .filter(Boolean);

    if (messages.length) return messages.join("; ");
  }

  if (
    result.detail &&
    typeof result.detail === "object" &&
    "message" in result.detail
  ) {
    return String(
      (result.detail as { message?: unknown }).message
    );
  }

  return typeof result.message === "string"
    ? result.message
    : fallback;
}

async function request<T>(
  method: "GET" | "PUT" | "POST" | "PATCH",
  path: string,
  payload?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const base = getBaseUrl();
  const token = await getToken();

  let response: Response;

  try {
    response = await fetch(`${base}${path}`, {
      method,
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
      signal,
    });
  } catch (error: unknown) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }

    throw new ShopSetupApiError(
      "Cannot connect to the backend. Check the server and your connection."
    );
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ShopSetupApiError(
      errorMessage(data, `Request failed (${response.status}).`),
      response.status
    );
  }

  if (data === null || data === undefined) {
    throw new ShopSetupApiError("Empty backend response.");
  }

  return data as T;
}

export function getShopSetup(
  signal?: AbortSignal
): Promise<SavedShopSetup> {
  return request("GET", SHOP_PATH, undefined, signal);
}

export function saveShopSetup(
  setupData: Record<string, unknown>
): Promise<SavedShopSetup> {
  return request("PUT", SHOP_PATH, {
    setup_data: setupData,
    completed_sections: [],
  });
}

export function submitShopSetup(): Promise<SavedShopSetup> {
  return request("POST", `${SHOP_PATH}/submit`);
}

export async function uploadShopSetupDocument(
  file: MobileDocument,
  documentType: string
): Promise<{
  message: string;
  registration_documents: RegistrationDocument[];
}> {
  const base = getBaseUrl();
  const token = await getToken();

  const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  if (!allowedTypes.includes(file.mimeType)) {
    throw new ShopSetupApiError(
      "Upload a PDF, JPEG, PNG or WebP document."
    );
  }

  if (file.size && file.size > 5 * 1024 * 1024) {
    throw new ShopSetupApiError(
      "Document must be 5 MB or smaller."
    );
  }

  const form = new FormData();
  form.append("document_type", documentType);
  form.append(
    "document",
    {
      uri: file.uri,
      name: file.name,
      type: file.mimeType,
    } as unknown as Blob
  );

  let response: Response;

  try {
    response = await fetch(`${base}${SHOP_PATH}/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      body: form,
    });
  } catch {
    throw new ShopSetupApiError(
      "Document upload failed. Check your connection."
    );
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ShopSetupApiError(
      errorMessage(data, "Document upload failed."),
      response.status
    );
  }

  if (!data) {
    throw new ShopSetupApiError("Empty document upload response.");
  }

  return data as {
    message: string;
    registration_documents: RegistrationDocument[];
  };
}

export function getShopSetupProfile(
  signal?: AbortSignal
): Promise<BarberProfileResponse> {
  return request("GET", PROFILE_PATH, undefined, signal);
}

export async function getShopSetupWorkers(
  signal?: AbortSignal
): Promise<ShopSetupWorker[]> {
  const workers = await request<ShopSetupWorker[]>(
    "GET", WORKERS_PATH, undefined, signal
  );

  if (!Array.isArray(workers)) {
    throw new ShopSetupApiError("Invalid workers response.");
  }

  return workers;
}

export function createShopSetupWorker(
  payload: CreateWorkerPayload
): Promise<ShopSetupWorker> {
  return request("POST", WORKERS_PATH, payload);
}

export function updateShopSetupWorker(
  workerId: string,
  payload: UpdateWorkerPayload
): Promise<ShopSetupWorker> {
  return request(
    "PATCH",
    `${WORKERS_PATH}/${encodeURIComponent(workerId)}`,
    payload
  );
}

export function setShopSetupWorkerActive(
  workerId: string,
  active: boolean
): Promise<ShopSetupWorker> {
  return updateShopSetupWorker(workerId, { is_active: active });
}

export async function getShopSetupWorkerSlots(
  workerId: string,
  date: string,
  signal?: AbortSignal
): Promise<WorkerSlotResponse> {
  const result = await request<WorkerSlotResponse>(
    "GET",
    `${WORKERS_PATH}/${encodeURIComponent(workerId)}/slots/${encodeURIComponent(date)}`,
    undefined,
    signal
  );

  validateSlotResponse(result, workerId, date);
  return result;
}

export async function saveShopSetupWorkerSlots(
  workerId: string,
  date: string,
  payload: WorkerSlotPayload
): Promise<WorkerSlotResponse> {
  const result = await request<WorkerSlotResponse>(
    "PUT",
    `${WORKERS_PATH}/${encodeURIComponent(workerId)}/slots/${encodeURIComponent(date)}`,
    payload
  );

  validateSlotResponse(result, workerId, date);
  return result;
}

function validateSlotResponse(
  result: WorkerSlotResponse,
  workerId: string,
  date: string
): void {
  if (
    !result ||
    result.worker_id !== workerId ||
    result.date !== date ||
    !Number.isInteger(result.slot_duration_minutes) ||
    result.slot_duration_minutes <= 0 ||
    !result.slots ||
    typeof result.slots !== "object" ||
    Array.isArray(result.slots) ||
    Object.values(result.slots).some((value) => typeof value !== "boolean") ||
    !Array.isArray(result.breaks)
  ) {
    throw new ShopSetupApiError("Invalid worker slots response.");
  }
}

function validateWeeklyResponse(
  result: WorkerWeeklyScheduleResponse,
  workerId: string
): void {
  if (
    !result ||
    result.worker_id !== workerId ||
    !result.weekly_days ||
    WEEK_DAYS.some(
      (day) => typeof result.weekly_days[day] !== "boolean"
    )
  ) {
    throw new ShopSetupApiError("Invalid weekly schedule response.");
  }
}

export async function getShopSetupWorkerWeeklySchedule(
  workerId: string,
  signal?: AbortSignal
): Promise<WorkerWeeklyScheduleResponse> {
  const result = await request<WorkerWeeklyScheduleResponse>(
    "GET",
    `${WORKERS_PATH}/${encodeURIComponent(workerId)}/weekly-schedule`,
    undefined,
    signal
  );

  validateWeeklyResponse(result, workerId);
  return result;
}

export async function saveShopSetupWorkerWeeklySchedule(
  workerId: string,
  weeklyDays: WeeklyDays
): Promise<WorkerWeeklyScheduleResponse> {
  if (WEEK_DAYS.some((day) => typeof weeklyDays[day] !== "boolean")) {
    throw new ShopSetupApiError(
      "Provide a working-day setting for all seven days."
    );
  }

  const result = await request<WorkerWeeklyScheduleResponse>(
    "PUT",
    `${WORKERS_PATH}/${encodeURIComponent(workerId)}/weekly-schedule`,
    { weekly_days: weeklyDays }
  );

  validateWeeklyResponse(result, workerId);
  return result;
}

export function fromShopSetupWorker(
  worker: ShopSetupWorker
): WorkerFormValues {
  return {
    fullName: worker.full_name,
    phone: worker.phone,
    role: worker.role,
    experience: String(worker.years_experience),
    specializations: worker.specializations || "",
    startTime: worker.shift_start.slice(0, 5),
    endTime: worker.shift_end.slice(0, 5),
    active: worker.is_active,
  };
}

export function toShopSetupWorkerPayload(
  worker: WorkerFormValues
): CreateWorkerPayload {
  return {
    full_name: worker.fullName.trim(),
    phone: worker.phone.trim(),
    role: worker.role.trim() || "Barber",
    years_experience: Number(worker.experience),
    specializations: worker.specializations.trim(),
    shift_start: worker.startTime,
    shift_end: worker.endTime,
    is_active: worker.active,
  };
}

export async function getShopSetupOverview(
  signal?: AbortSignal
): Promise<ShopSetupOverview> {
  const [profile, workers, setup] = await Promise.all([
    getShopSetupProfile(signal),
    getShopSetupWorkers(signal),
    getShopSetup(signal),
  ]);

  return {
    profile,
    workers,
    completed: {
      shop_profile: setup.completed_sections.includes("profile"),
      shop_details: setup.completed_sections.includes("shop"),
      workers: setup.completed_sections.includes("workers"),
      documents: setup.completed_sections.includes("documents"),
    },
  };
}

// Existing imports in other screens remain supported.
export const getBarberProfile = getShopSetupProfile;
export const getWorkers = getShopSetupWorkers;
export const createWorker = createShopSetupWorker;
export const updateWorker = updateShopSetupWorker;
export const setWorkerActive = setShopSetupWorkerActive;
export const getWorkerSlots = getShopSetupWorkerSlots;
export const saveWorkerSlots = saveShopSetupWorkerSlots;
export const fromBarberWorker = fromShopSetupWorker;
export const toWorkerPayload = toShopSetupWorkerPayload;