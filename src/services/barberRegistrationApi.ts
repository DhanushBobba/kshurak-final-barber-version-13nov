
const API_BASE_URL = String(
  process.env.EXPO_PUBLIC_API_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

export type RegistrationFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

export interface BarberRegistrationPayload {
  username: string;
  email: string;
  password: string;
  years_experience: number;
  shop_name: string;
  shop_phone: string;
  shop_address: string;
  shop_image: RegistrationFile;
  shop_documents: RegistrationFile[];
}

export interface BarberRegistrationResponse {
  id: string;
  status: "pending";
  message: string;
}

function requireBaseUrl(): string {
  if (!/^https?:\/\/[^/]+/i.test(API_BASE_URL)) {
    throw new Error(
      "EXPO_PUBLIC_API_BASE_URL is missing or invalid. " +
      "Check your Mobile Barber .env file."
    );
  }

  return API_BASE_URL;
}

function getErrorMessage(data: unknown): string {
  const fallback =
    "Registration failed. Please try again.";

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

function appendFile(
  formData: FormData,
  fieldName: string,
  file: RegistrationFile
): void {
  // React Native FormData supports local file objects.
  // The cast is required because DOM TypeScript definitions
  // don't describe React Native's {uri, name, type} format.
  formData.append(
    fieldName,
    {
      uri: file.uri,
      name: file.name,
      type: file.mimeType,
    } as unknown as Blob
  );
}

export async function registerBarber(
  payload: BarberRegistrationPayload
): Promise<BarberRegistrationResponse> {
  const baseUrl = requireBaseUrl();

  const formData = new FormData();

  formData.append(
    "username",
    payload.username.trim()
  );

  formData.append(
    "email",
    payload.email.trim().toLowerCase()
  );

  formData.append(
    "password",
    payload.password
  );

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

  appendFile(
    formData,
    "shop_image",
    payload.shop_image
  );

  for (const document of payload.shop_documents) {
    appendFile(
      formData,
      "shop_documents",
      document
    );
  }

  let response: Response;

  try {
    response = await fetch(
      `${baseUrl}/api/v1/barber/register`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
      }
    );
  } catch {
    throw new Error(
      "Unable to connect to KSHURAK FastAPI. " +
      "Check the backend URL and network connection."
    );
  }

  const data: unknown =
    await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getErrorMessage(data));
  }

  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as { id?: unknown }).id !== "string" ||
    (data as { status?: unknown }).status !== "pending" ||
    typeof (data as { message?: unknown }).message !== "string"
  ) {
    throw new Error(
      "Unexpected registration response from the backend."
    );
  }

  return data as BarberRegistrationResponse;
}
