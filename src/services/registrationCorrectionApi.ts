const API_BASE_URL = String(
  process.env.EXPO_PUBLIC_API_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const CORRECTION_PATH =
  "/api/v1/barber/registration-correction";

const REQUEST_TIMEOUT_MS = Number(
  process.env.EXPO_PUBLIC_CORRECTION_REQUEST_TIMEOUT_MS ||
    "30000"
);

const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const DOCUMENT_TYPES = [
  ...IMAGE_TYPES,
  "application/pdf",
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENTS = 5;

export interface CorrectionFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

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

  shop_image?: CorrectionFile | null;

  // A non-empty set replaces all saved verification documents.
  // An empty set retains the existing documents.
  shop_documents?: CorrectionFile[];
}

export interface RegistrationCorrectionResult {
  barber_id: string;
  approval_status: "pending";
  correction_resubmitted_at: string;
  message: string;
}

export class RegistrationCorrectionError extends Error {
  readonly status: number;
  readonly outcomeUnknown: boolean;

  constructor(
    message: string,
    status = 0,
    outcomeUnknown = false
  ) {
    super(message);
    this.name = "RegistrationCorrectionError";
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
  }
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

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isTimestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

function requireBaseUrl(): string {
  try {
    const url = new URL(API_BASE_URL);

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid API address.");
    }

    return API_BASE_URL;
  } catch {
    throw new RegistrationCorrectionError(
      "EXPO_PUBLIC_API_BASE_URL is missing or invalid.",
      422
    );
  }
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

function getErrorMessage(
  data: unknown,
  responseStatus: number
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
      const messages = detail.flatMap(
        (item: unknown) => {
          if (
            !isRecord(item) ||
            typeof item.msg !== "string"
          ) {
            return [];
          }

          const field = Array.isArray(item.loc)
            ? item.loc
                .filter((part) => part !== "body")
                .map(String)
                .join(".")
            : "";

          return [
            field
              ? `${field}: ${item.msg}`
              : item.msg,
          ];
        }
      );

      if (messages.length) {
        return messages.join("\n");
      }
    }
  }

  switch (responseStatus) {
    case 401:
      return (
        "This correction link is invalid, expired or already used. " +
        "Please request a new link from Admin."
      );

    case 409:
      return (
        "This registration is no longer awaiting corrections. " +
        "Reload the application status."
      );

    case 413:
      return "An uploaded file exceeds the allowed size.";

    case 429:
      return "Too many requests. Please wait before trying again.";

    case 503:
      return "The correction service is temporarily unavailable.";

    default:
      return "Unable to complete the request. Please try again.";
  }
}

async function postCorrectionRequest(
  endpoint: "/validate" | "/resubmit",
  body: string | FormData,
  isJson: boolean,
  externalSignal?: AbortSignal
): Promise<unknown> {
  const baseUrl = requireBaseUrl();

  if (
    !Number.isFinite(REQUEST_TIMEOUT_MS) ||
    REQUEST_TIMEOUT_MS <= 0
  ) {
    throw new RegistrationCorrectionError(
      "EXPO_PUBLIC_CORRECTION_REQUEST_TIMEOUT_MS must be a positive number.",
      422
    );
  }

  const controller = new AbortController();
  const isSubmission = endpoint === "/resubmit";

  let timedOut = false;

  const abortFromCaller = () => {
    controller.abort();
  };

  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener(
      "abort",
      abortFromCaller,
      { once: true }
    );
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${baseUrl}${CORRECTION_PATH}${endpoint}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(isJson
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body,
        signal: controller.signal,
      }
    );

    // Keep the timeout active while reading the response body.
    const data: unknown = await response
      .json()
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          throw error;
        }

        return null;
      });

    if (!response.ok) {
      throw new RegistrationCorrectionError(
        getErrorMessage(data, response.status),
        response.status,
        isSubmission && response.status >= 500
      );
    }

    if (data === null) {
      throw new RegistrationCorrectionError(
        isSubmission
          ? "The submission response could not be verified. Reload the application status before retrying."
          : "The correction service returned an invalid response.",
        0,
        isSubmission
      );
    }

    return data;
  } catch (error: unknown) {
    if (externalSignal?.aborted) {
      throw error;
    }

    if (error instanceof RegistrationCorrectionError) {
      throw error;
    }

    throw new RegistrationCorrectionError(
      isSubmission
        ? (
            timedOut
              ? "The submission timed out. "
              : "The connection was interrupted. "
          ) +
            "Your submission outcome is unknown. Reload the application status before retrying."
        : timedOut
          ? "Loading your application timed out. Check your connection and retry validation."
          : "Unable to connect to KSHURAK. Check your connection and backend address.",
      0,
      isSubmission
    );
  } finally {
    clearTimeout(timer);

    externalSignal?.removeEventListener(
      "abort",
      abortFromCaller
    );
  }
}

function appendFile(
  form: FormData,
  field: string,
  file: CorrectionFile,
  imageOnly: boolean
): void {
  const allowed = imageOnly
    ? IMAGE_TYPES
    : DOCUMENT_TYPES;

  const maximum = imageOnly
    ? MAX_IMAGE_BYTES
    : MAX_DOCUMENT_BYTES;

  if (
    !file.uri ||
    !file.name ||
    !allowed.includes(file.mimeType) ||
    !Number.isFinite(file.size) ||
    file.size <= 0 ||
    file.size > maximum
  ) {
    throw new RegistrationCorrectionError(
      imageOnly
        ? "Select a valid JPEG, PNG or WebP shop image up to 8 MB."
        : "Select valid PDF, JPEG, PNG or WebP documents up to 5 MB each.",
      422
    );
  }

  // React Native accepts local file descriptors in FormData.
  form.append(
    field,
    {
      uri: file.uri,
      name: file.name,
      type: file.mimeType,
    } as unknown as Blob
  );
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
    true,
    signal
  );

  if (
    !isRecord(data) ||
    typeof data.barber_id !== "string" ||
    typeof data.username !== "string" ||
    typeof data.email !== "string" ||
    data.approval_status !== "needs_correction" ||
    !isNullableString(data.shop_name) ||
    !isNullableString(data.shop_phone) ||
    typeof data.shop_address !== "string" ||
    typeof data.years_experience !== "number" ||
    !Number.isInteger(data.years_experience) ||
    data.years_experience < 0 ||
    data.years_experience > 50 ||
    typeof data.correction_reason !== "string" ||
    !isTimestamp(data.correction_requested_at) ||
    !isTimestamp(data.token_expires_at) ||
    !isNullableString(data.shop_image_url) ||
    typeof data.signed_url_expires_in !== "number" ||
    !Number.isFinite(data.signed_url_expires_in) ||
    !Array.isArray(data.documents) ||
    !data.documents.every(
      (document: unknown) =>
        isRecord(document) &&
        typeof document.path === "string" &&
        (
          document.original_name === undefined ||
          typeof document.original_name === "string"
        ) &&
        (
          document.signed_url === undefined ||
          isNullableString(document.signed_url)
        )
    )
  ) {
    throw new RegistrationCorrectionError(
      "The backend returned an unexpected correction response. Please contact support."
    );
  }

  return data as unknown as RegistrationCorrectionDetails;
}

export async function resubmitRegistrationCorrection(
  payload: RegistrationCorrectionPayload
): Promise<RegistrationCorrectionResult> {
  const documents = payload.shop_documents ?? [];

  if (documents.length > MAX_DOCUMENTS) {
    throw new RegistrationCorrectionError(
      "Select a maximum of 5 verification documents.",
      422
    );
  }

  const form = new FormData();

  form.append("token", requireToken(payload.token));
  form.append("shop_name", payload.shop_name.trim());
  form.append("shop_phone", payload.shop_phone.trim());
  form.append("shop_address", payload.shop_address.trim());
  form.append(
    "years_experience",
    String(payload.years_experience)
  );

  if (payload.shop_image) {
    appendFile(
      form,
      "shop_image",
      payload.shop_image,
      true
    );
  }

  for (const document of documents) {
    appendFile(
      form,
      "shop_documents",
      document,
      false
    );
  }

  // Do not set Content-Type manually.
  // React Native supplies the multipart boundary.
  const data = await postCorrectionRequest(
    "/resubmit",
    form,
    false
  );

  if (
    !isRecord(data) ||
    typeof data.barber_id !== "string" ||
    data.approval_status !== "pending" ||
    !isTimestamp(data.correction_resubmitted_at) ||
    typeof data.message !== "string"
  ) {
    throw new RegistrationCorrectionError(
      "The submission response was unexpected. Reload the application status before retrying.",
      0,
      true
    );
  }

  return data as unknown as RegistrationCorrectionResult;
}