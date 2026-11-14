
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || ""
).trim().replace(/\/+$/, "");

if (!API_BASE_URL) {
  throw new Error(
    "VITE_API_BASE_URL is not configured. Check the Barber frontend environment."
  );
}
export interface AuthMessageResponse {
  message: string;
}

async function postAuthRequest(
  endpoint: string,
  payload: Record<string, string>
): Promise<AuthMessageResponse> {
  let response: Response;

  try {
    response = await fetch(
      `${API_BASE_URL}${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
  } catch {
    throw new Error(
      "Unable to connect to KSHURAK. Please try again."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Unable to complete the request. Please try again."
    );
  }

  return data as AuthMessageResponse;
}

export async function requestBarberPasswordReset(
  email: string
): Promise<AuthMessageResponse> {
  return postAuthRequest(
    "/api/v1/barber/forgot-password",
    { email: email.trim().toLowerCase() }
  );
}

export async function resetBarberPassword(
  token: string,
  newPassword: string
): Promise<AuthMessageResponse> {
  return postAuthRequest(
    "/api/v1/barber/reset-password",
    {
      token,
      new_password: newPassword,
    }
  );
}

export async function activateBarberAccount(
  token: string
): Promise<AuthMessageResponse> {
  return postAuthRequest(
    "/api/v1/barber/activate",
    { token }
  );
}
