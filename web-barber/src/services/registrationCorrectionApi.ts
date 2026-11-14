const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const CORRECTION_PATH =
  "/api/v1/barber/registration-correction";

export interface CorrectionDocument {
  path: string;
  original_name?: string;
  content_type?: string;
  size?: number;
  document_type?: string;
  signed_url?: string | null;
}

export interface RegistrationCorrectionDetails {
  barber_id: string;
  username: string;
  email: string;

  approval_status: "needs_correction";

  shop_name: string | null;
  shop_phone: string | null;
  shop_address: string;
  years_experience: number;

  correction_reason: string;
  correction_requested_at: string;
  token_expires_at: string;

  shop_image_url: string | null;
  documents: CorrectionDocument[];
  signed_url_expires_in: number;
}

export interface RegistrationCorrectionPayload {
  token: string;
  shop_name: string;
  shop_phone: string;
  shop_address: string;
  years_experience: number;

  shop_image?: File | null;

  // If supplied, replaces the entire existing document list.
  shop_documents?: File[];
}

export interface RegistrationCorrectionResult {
  barber_id: string;
  approval_status: "pending";
  correction_resubmitted_at: string;
  message: string;
}

export class RegistrationCorrectionError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "RegistrationCorrectionError";
    this.status = status;
  }
}

function requireBaseUrl(): string {
  let url: URL;

  try {
    url = new URL(API_BASE_URL);
  } catch {
    throw new RegistrationCorrectionError(
      "VITE_API_BASE_URL is missing or invalid."
    );
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new RegistrationCorrectionError(
      "The backend URL must use HTTP or HTTPS."
    );
  }

  return API_BASE_URL;
}

function requireToken(token: string): string {
  const value = token.trim();

  if (value.length < 32 || value.length > 512) {
    throw new RegistrationCorrectionError(
      "This correction link is invalid. Please request a new link from Admin.",
      401
    );
  }

  return value;
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function getErrorMessage(
  data: unknown,
  status: number
): string {
  if (isRecord(data)) {
    const detail = data.detail;

    if (typeof detail === "string") {
      return detail;
    }

    if (
      isRecord(detail) &&
      typeof detail.message === "string"
    ) {
      return detail.message;
    }

    if (Array.isArray(detail)) {
      const messages = detail.flatMap((item: unknown) => {
        if (!isRecord(item) || typeof item.msg !== "string") {
          return [];
        }

        const field = Array.isArray(item.loc)
          ? item.loc
              .filter((part) => part !== "body")
              .map(String)
              .join(".")
          : "";

        return [field ? `${field}: ${item.msg}` : item.msg];
      });

      if (messages.length) return messages.join("\n");
    }
  }

  if (status === 401) {
    return (
      "This correction link is invalid, expired or already used. " +
      "Please request a new link from Admin."
    );
  }

  if (status === 409) {
    return "This registration is no longer awaiting corrections.";
  }

  if (status === 413) {
    return "An uploaded file exceeds the allowed size.";
  }

  return "Unable to complete the request. Please try again.";
}

async function postCorrectionRequest(
  endpoint: string,
  body: BodyInit,
  contentType?: string,
  signal?: AbortSignal
): Promise<unknown> {
  const baseUrl = requireBaseUrl();

  let response: Response;

  try {
    response = await fetch(
      `${baseUrl}${CORRECTION_PATH}${endpoint}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(contentType
            ? { "Content-Type": contentType }
            : {}),
        },
        body,
        signal,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }
    );
  } catch (error: unknown) {
    if (signal?.aborted) throw error;

    throw new RegistrationCorrectionError(
      endpoint === "/resubmit"
        ? (
            "The connection was interrupted. Your submission outcome " +
            "is unknown. Reload the correction page before retrying."
          )
        : (
            "Unable to connect to KSHURAK. " +
            "Check that the backend is running."
          )
    );
  }

  const data: unknown = await response
    .json()
    .catch(() => null);

  if (!response.ok) {
    throw new RegistrationCorrectionError(
      getErrorMessage(data, response.status),
      response.status
    );
  }

  return data;
}

export async function validateRegistrationCorrection(
  token: string,
  signal?: AbortSignal
): Promise<RegistrationCorrectionDetails> {
  const data = await postCorrectionRequest(
    "/validate",
    JSON.stringify({
      token: requireToken(token),
    }),
    "application/json",
    signal
  );

  if (
    !isRecord(data) ||
    typeof data.barber_id !== "string" ||
    typeof data.username !== "string" ||
    typeof data.email !== "string" ||
    data.approval_status !== "needs_correction" ||
    typeof data.shop_address !== "string" ||
    typeof data.years_experience !== "number" ||
    typeof data.correction_reason !== "string" ||
    typeof data.correction_requested_at !== "string" ||
    typeof data.token_expires_at !== "string" ||
    typeof data.signed_url_expires_in !== "number" ||
    !(
      data.shop_name === null ||
      typeof data.shop_name === "string"
    ) ||
    !(
      data.shop_phone === null ||
      typeof data.shop_phone === "string"
    ) ||
    !(
      data.shop_image_url === null ||
      typeof data.shop_image_url === "string"
    ) ||
    !Array.isArray(data.documents) ||
    !data.documents.every(
      (document: unknown) =>
        isRecord(document) &&
        typeof document.path === "string"
    )
  ) {
    throw new RegistrationCorrectionError(
      "The backend returned an unexpected correction response."
    );
  }

  return data as unknown as RegistrationCorrectionDetails;
}

export async function resubmitRegistrationCorrection(
  payload: RegistrationCorrectionPayload
): Promise<RegistrationCorrectionResult> {
  const formData = new FormData();

  formData.append("token", requireToken(payload.token));
  formData.append("shop_name", payload.shop_name.trim());
  formData.append("shop_phone", payload.shop_phone.trim());
  formData.append("shop_address", payload.shop_address.trim());
  formData.append(
    "years_experience",
    String(payload.years_experience)
  );

  if (payload.shop_image) {
    formData.append("shop_image", payload.shop_image);
  }

  for (const document of payload.shop_documents ?? []) {
    formData.append("shop_documents", document);
  }

  // The browser supplies the multipart boundary.
  const data = await postCorrectionRequest(
    "/resubmit",
    formData
  );

  if (
    !isRecord(data) ||
    typeof data.barber_id !== "string" ||
    data.approval_status !== "pending" ||
    typeof data.correction_resubmitted_at !== "string" ||
    typeof data.message !== "string"
  ) {
    throw new RegistrationCorrectionError(
      "The submission response was unexpected. Reload the correction page before retrying."
    );
  }

  return data as unknown as RegistrationCorrectionResult;
}