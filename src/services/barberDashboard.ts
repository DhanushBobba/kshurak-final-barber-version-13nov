
import * as SecureStore from "expo-secure-store";
const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || "").trim().replace(/\/+$/, "");
const TOKEN_KEY = "kshurak_barber_token";
export type DashboardStats = {
  todays_bookings?: number | null;
  todays_revenue?: number | null;
  total_customers?: number | null;
  average_rating?: number | null;
};
export type DashboardSetup = {
  shop_profile?: boolean;
  shop_details?: boolean;
  workers?: boolean;
  documents?: boolean;
  capacity?: boolean;
  available_slots?: boolean;
};
export type DashboardAppointment = {
  id: string;
  customer_name: string;
  service_name: string;
  start_time: string;
  status?: string;
};
export type BarberDashboardData = {
  username?: string;
  stats?: DashboardStats;
  setup?: DashboardSetup;
  today_schedule?: DashboardAppointment[];
  weekly_bookings?: number[];
};
export class DashboardApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
  }
}
function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "TRUE" || value === 1) return true;
  if (value === "false" || value === "FALSE" || value === 0) return false;
  return undefined;
}
function readObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
function normalizeDashboard(response: unknown): BarberDashboardData {
  const root = readObject(response);
  const source = readObject(root.data);
  const raw = Object.keys(source).length ? source : root;
  const barber = readObject(raw.barber);
  const stats = readObject(raw.stats || raw.statistics);
  const setup = readObject(raw.setup || raw.shop_setup);
  const appointments = raw.today_schedule ?? raw.todays_schedule ?? raw.today_appointments;
  const weekly = raw.weekly_bookings ?? raw.booking_overview;
  const normalizedStats: DashboardStats = {
    todays_bookings: optionalNumber(stats.todays_bookings ?? stats.today_bookings ?? raw.todays_bookings),
    todays_revenue: optionalNumber(stats.todays_revenue ?? stats.today_revenue ?? raw.todays_revenue),
    total_customers: optionalNumber(stats.total_customers ?? raw.total_customers),
    average_rating: optionalNumber(stats.average_rating ?? raw.average_rating),
  };
  const normalizedSetup: DashboardSetup = {
    shop_profile: optionalBoolean(setup.shop_profile),
    shop_details: optionalBoolean(setup.shop_details),
    workers: optionalBoolean(setup.workers),
    documents: optionalBoolean(setup.documents),
    capacity: optionalBoolean(setup.capacity),
    available_slots: optionalBoolean(setup.available_slots),
  };
  const normalizedAppointments = Array.isArray(appointments) ? appointments.map((item: any, index: number) => ({
    id: String(item?.id ?? index),
    customer_name: String(item?.customer_name ?? item?.customer ?? "Customer"),
    service_name: String(item?.service_name ?? item?.service ?? "Service"),
    start_time: String(item?.start_time ?? item?.time ?? ""),
    status: typeof item?.status === "string" ? item.status : undefined,
  })) : undefined;
  const normalizedWeekly = Array.isArray(weekly) ? weekly.map(optionalNumber).filter((value): value is number => value !== undefined) : undefined;
  return {
    username: typeof raw.username === "string" ? raw.username : typeof barber.username === "string" ? barber.username : undefined,
    stats: Object.values(normalizedStats).some((value) => value !== undefined) ? normalizedStats : undefined,
    setup: Object.values(normalizedSetup).some((value) => value !== undefined) ? normalizedSetup : undefined,
    today_schedule: normalizedAppointments,
    weekly_bookings: normalizedWeekly,
  };
}
export async function fetchBarberDashboard(): Promise<BarberDashboardData> {
  if (!API_BASE_URL) throw new DashboardApiError("EXPO_PUBLIC_API_BASE_URL is missing.");
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) throw new DashboardApiError("Please log in again.", 401);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/barber/dashboard`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new DashboardApiError("Cannot connect to KSHURAK backend. Check your network connection.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    const message = typeof detail === "string" ? detail : typeof detail?.message === "string" ? detail.message : response.status === 401 ? "Your session has expired. Please log in again." : `Dashboard request failed (${response.status}).`;
    throw new DashboardApiError(message, response.status);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new DashboardApiError("Invalid dashboard response received.");
  return normalizeDashboard(data);
}
