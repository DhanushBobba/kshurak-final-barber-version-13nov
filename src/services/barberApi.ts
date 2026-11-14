
export interface BarberRegistrationPayload {
    username: string;
    email: string;
    password: string;
    shop_address: string;
    years_experience: number;
}
export interface BarberRegistrationResponse {
    id: string;
    status: "pending";
    message: string;
}
type ApiErrorDetail = string | { msg?: string; message?: string }[] | { message?: string } | undefined;
const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || "").trim().replace(/\/+$/, "");
function getApiBaseUrl(): string {
    if (!API_BASE_URL) {
        throw new Error("API URL is not configured. Set EXPO_PUBLIC_API_BASE_URL in the mobile-barber .env file.");
    }
    if (!/^https?:\/\/[^/]+/i.test(API_BASE_URL)) {
        throw new Error("Invalid backend URL. Use http:// or https://.");
    }
    return API_BASE_URL;
}
function getErrorMessage(detail: ApiErrorDetail): string {
    if (typeof detail === "string" && detail.trim()) {
        return detail;
    }
    if (Array.isArray(detail)) {
        return detail.map((item) => item.msg || item.message || "Invalid field").join(", ");
    }
    if (detail && typeof detail === "object" && typeof detail.message === "string") {
        return detail.message;
    }
    return "Registration failed. Please try again.";
}
export async function registerBarber(payload: BarberRegistrationPayload): Promise<BarberRegistrationResponse> {
    const baseUrl = getApiBaseUrl();
    let response: Response;
    try {
        response = await fetch(`${baseUrl}/api/v1/barber/register`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                username: payload.username.trim(),
                email: payload.email.trim().toLowerCase(),
                password: payload.password,
                shop_address: payload.shop_address.trim(),
                years_experience: payload.years_experience,
            }),
        });
    } catch {
        throw new Error("Cannot connect to KSHURAK backend. Check your server and network connection.");
    }
    const data: any = await response.json().catch(() => null);
    if (!response.ok) {
        if (response.status === 409) {
            throw new Error(getErrorMessage(data?.detail) || "Username or email already registered.");
        }
        if (response.status === 503) {
            throw new Error("KSHURAK registration service is temporarily unavailable.");
        }
        throw new Error(getErrorMessage(data?.detail));
    }
    if (!data || typeof data.id !== "string" || typeof data.status !== "string") {
        throw new Error("Invalid registration response from KSHURAK server.");
    }
    return data as BarberRegistrationResponse;
}
