
export interface BarberLoginPayload {
    identifier: string;
    password: string;
}

export interface BarberLoginResponse {
    access_token: string;
    token_type: "bearer";
    expires_in: number;
    barber_id: string;
    username: string;
    message: string;
}

export type LoginErrorCode =
    | "ADMIN_APPROVAL_REQUIRED"
    | "APPLICATION_REJECTED"
    | "ACCOUNT_NOT_APPROVED"
    | "EMAIL_ACTIVATION_REQUIRED"
    | "INVALID_CREDENTIALS"
    | "LOGIN_ERROR";

export class BarberLoginError extends Error {
    code: LoginErrorCode;

    constructor(code: LoginErrorCode, message: string) {
        super(message);
        this.name = "BarberLoginError";
        this.code = code;
    }
}

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || ""
).trim().replace(/\/+$/, "");

if (!API_BASE_URL) {
  throw new Error(
    "VITE_API_BASE_URL is not configured. Check the Barber frontend environment."
  );
}

export async function loginBarber(
    payload: BarberLoginPayload
): Promise<BarberLoginResponse> {
    let response: Response;

    try {
        response = await fetch(
            `${API_BASE_URL}/api/v1/barber/login`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            }
        );
    } catch {
        throw new BarberLoginError(
            "LOGIN_ERROR",
            "Unable to connect to the server."
        );
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const detail = data.detail;

        if (
            detail &&
            typeof detail === "object" &&
            typeof detail.code === "string"
        ) {
            throw new BarberLoginError(
                detail.code as LoginErrorCode,
                detail.message || "Login is not allowed."
            );
        }

        throw new BarberLoginError(
            response.status === 401
                ? "INVALID_CREDENTIALS"
                : "LOGIN_ERROR",
            typeof detail === "string"
                ? detail
                : "Unable to log in. Please try again."
        );
    }

    if (!data.access_token || !data.barber_id) {
        throw new BarberLoginError(
            "LOGIN_ERROR",
            "Invalid response from login server."
        );
    }

    return data as BarberLoginResponse;
}
