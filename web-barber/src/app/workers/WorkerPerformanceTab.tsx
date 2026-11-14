
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  Activity,
  AlertCircle,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  Clock3,
  Coffee,
  Download,
  Eye,
  RefreshCw,
  Star,
  TrendingUp,
  Users,
  X,
  ClipboardList,
  Ban,
  CalendarOff,
  HelpCircle,
} from "lucide-react";

import type { WorkerRecord } from "./WorkersTab";

import {
  getWorkerSlots,
  type WorkerBreak,
} from "../../services/barberApi";

import {
  getBarberBookings,
  type BarberBooking,
} from "../../services/bookingApi";

// ============================================================
// TYPES
// ============================================================

type Period =
  | "today"
  | "7days"
  | "15days"
  | "1month"
  | "3months"
  | "6months";

type Day =
  | "Mon"
  | "Tue"
  | "Wed"
  | "Thu"
  | "Fri"
  | "Sat"
  | "Sun";

type WeeklyDays = Record<Day, boolean>;

type Props = {
  workers: WorkerRecord[];
  onManageSlots: (workerId: string) => void;
};

type Stats = {
  worker: WorkerRecord;
  total: number;
  completed: number;
  cancelled: number;
  confirmed: number;
  pending: number;
  minutes: number;
  rate: number | null;
};

type DailySlots = {
  slots: Record<string, boolean>;
  breaks: WorkerBreak[];
  duration: number;
};

type DailyResult = {
  data: DailySlots | null;
  error: string | null;
};

type SlotStatus =
  | "shift"
  | "booked"
  | "completed"
  | "holiday"
  | "break"
  | "disabled"
  | "unavailable"
  | "unknown";

type ScheduleCellData = {
  status: SlotStatus;
  title: string;
};

type TrendPoint = {
  label: string;
  hours: number;
};

type ScheduleState = {
  workerId: string;
  weekKey: string;
  weeklyDays: WeeklyDays | null;
  daily: Record<string, DailyResult>;
  bookings: BarberBooking[] | null;
  bookingError: string | null;
  weeklyError: string | null;
};

const SLOT_DURATION = 60;

const API_BASE = String(
  import.meta.env.VITE_API_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const DAYS: Day[] = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

const PERIODS: {
  value: Period;
  label: string;
}[] = [
  { value: "today", label: "Today" },
  { value: "7days", label: "Last 7 Days" },
  { value: "15days", label: "Last 15 Days" },
  { value: "1month", label: "Last 1 Month" },
  { value: "3months", label: "Last 3 Months" },
  { value: "6months", label: "Last 6 Months" },
];

const COLORS = {
  amber: "#F59E0B",
  green: "#22C55E",
  blue: "#38BDF8",
  red: "#EF4444",
  purple: "#A78BFA",
  gray: "#85858F",
};

// ============================================================
// AUTHENTICATION
// ============================================================

function getToken(): string {
  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token") ||
    localStorage.getItem("kshurak_barber_token") ||
    localStorage.getItem("barber_access_token");

  if (!token) {
    throw new Error("Please log in to your barber account.");
  }

  return token;
}

// ============================================================
// DATE UTILITIES
// Use the same Asia/Kolkata date basis as Slot Management.
// ============================================================

function todayISO(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = (key: string) =>
    parts.find((part) => part.type === key)?.value || "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

function fromISO(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);

  result.setUTCDate(
    result.getUTCDate() + days
  );

  return result;
}

function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);

  const lastDay = new Date(
    Date.UTC(
      result.getUTCFullYear(),
      result.getUTCMonth() + 1,
      0
    )
  ).getUTCDate();

  result.setUTCDate(Math.min(originalDay, lastDay));

  return result;
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
}

function weekday(date: Date): Day {
  const index = (date.getUTCDay() + 6) % 7;
  return DAYS[index];
}

function rangeFor(period: Period, today: string) {
  const end = fromISO(today);
  let start = new Date(end);

  switch (period) {
    case "today":
      break;

    case "7days":
      start = addDays(end, -6);
      break;

    case "15days":
      start = addDays(end, -14);
      break;

    case "1month":
      start = subtractMonths(end, 1);
      break;

    case "3months":
      start = subtractMonths(end, 3);
      break;

    case "6months":
      start = subtractMonths(end, 6);
      break;
  }

  return {
    start,
    end,
    from: dateKey(start),
    to: dateKey(end),
  };
}

function weekFor(today: string, offset: number): Date[] {
  const date = fromISO(today);
  const currentDay = (date.getUTCDay() + 6) % 7;

  const monday = addDays(
    date,
    -currentDay + offset * 7
  );

  return Array.from(
    { length: 7 },
    (_, index) => addDays(monday, index)
  );
}

function dayCount(start: Date, end: Date): number {
  return (
    Math.round(
      (end.getTime() - start.getTime()) / 86400000
    ) + 1
  );
}

// ============================================================
// TIME UTILITIES
// ============================================================

function toMinutes(value?: string | null): number {
  if (!value) return NaN;

  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(
    value
  );

  if (!match) return NaN;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return NaN;
  }

  return hour * 60 + minute;
}

function fromMinutes(minutes: number): string {
  return (
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:` +
    `${String(minutes % 60).padStart(2, "0")}`
  );
}

function timeLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  const displayHour = hour % 12 || 12;

  return (
    `${String(displayHour).padStart(2, "0")}:` +
    `${String(minute).padStart(2, "0")} ` +
    `${hour < 12 ? "AM" : "PM"}`
  );
}

function getWorkerTimes(worker: WorkerRecord): number[] {
  const start = toMinutes(worker.startTime);
  const end = toMinutes(worker.endTime);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    return [];
  }

  const result: number[] = [];

  for (
    let minute = start;
    minute + SLOT_DURATION <= end;
    minute += SLOT_DURATION
  ) {
    result.push(minute);
  }

  return result;
}

function bookingDuration(booking: BarberBooking): number {
  const value = Number(
    booking.service_duration_minutes
  );

  return Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} hrs`;
}

function completionRate(
  completed: number,
  cancelled: number
): number | null {
  const resolved = completed + cancelled;

  return resolved
    ? (completed / resolved) * 100
    : null;
}

function showRate(value: number | null): string {
  return value === null
    ? "—"
    : `${value.toFixed(0)}%`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

// ============================================================
// WEEKLY SCHEDULE API
// Same endpoint used by WeeklySchedulePanel and SlotManagement.
// ============================================================

async function getWeeklySchedule(
  workerId: string,
  signal: AbortSignal
): Promise<WeeklyDays> {
  if (!API_BASE) {
    throw new Error(
      "VITE_API_BASE_URL is not configured."
    );
  }

  const response = await fetch(
    `${API_BASE}/api/v1/barber/workers/` +
      `${encodeURIComponent(workerId)}/weekly-schedule`,
    {
      method: "GET",
      signal,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        Accept: "application/json",
      },
    }
  );

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof result?.detail === "string"
        ? result.detail
        : `Weekly schedule request failed (${response.status}).`
    );
  }

  if (
    !result ||
    result.worker_id !== workerId ||
    !result.weekly_days ||
    DAYS.some(
      (day) =>
        typeof result.weekly_days[day] !== "boolean"
    )
  ) {
    throw new Error("Invalid weekly schedule response.");
  }

  return result.weekly_days as WeeklyDays;
}

// ============================================================
// DATE-SPECIFIC SLOTS API
// Reuse the existing barberApi service.
// ============================================================

async function loadDailySlots(
  workerId: string,
  date: string,
  signal: AbortSignal
): Promise<DailySlots> {
  const response = await getWorkerSlots(
    workerId,
    date,
    signal
  );

  if (response.slot_duration_minutes !== SLOT_DURATION) {
    throw new Error(
      `Invalid slot duration for ${date}. ` +
      "Expected 60-minute slots."
    );
  }

  if (
    !response.slots ||
    !Array.isArray(response.breaks)
  ) {
    throw new Error(
      `Invalid slot data received for ${date}.`
    );
  }

  return {
    slots: response.slots,
    breaks: response.breaks,
    duration: response.slot_duration_minutes,
  };
}

// ============================================================
// SLOT STATUS CALCULATION
// ============================================================

function overlapsBreak(
  start: number,
  breaks: WorkerBreak[]
): boolean {
  const end = start + SLOT_DURATION;

  return breaks.some((item) => {
    const breakStart = toMinutes(item.start);
    const breakEnd = toMinutes(item.end);

    return (
      Number.isFinite(breakStart) &&
      Number.isFinite(breakEnd) &&
      start < breakEnd &&
      end > breakStart
    );
  });
}

function bookingsForSlot(
  bookings: BarberBooking[],
  workerId: string,
  date: string,
  start: number
): BarberBooking[] {
  const end = start + SLOT_DURATION;

  return bookings.filter((booking) => {
    if (
      booking.worker_id !== workerId ||
      booking.booking_date.slice(0, 10) !== date ||
      booking.status === "cancelled" ||
      booking.status === "rejected"
    ) {
      return false;
    }

    const bookingStart = toMinutes(
      booking.start_time
    );

    const bookingEnd = toMinutes(
      booking.end_time
    );

    if (
      !Number.isFinite(bookingStart) ||
      !Number.isFinite(bookingEnd)
    ) {
      return false;
    }

    return bookingStart < end && bookingEnd > start;
  });
}

function resolveSlot(
  worker: WorkerRecord,
  date: Date,
  minute: number,
  schedule: ScheduleState
): ScheduleCellData {
  const dateString = dateKey(date);
  const day = weekday(date);
  const slotKey = fromMinutes(minute);

  const daily = schedule.daily[dateString];

  const holiday =
    schedule.weeklyDays?.[day] === false;

  const booked =
    schedule.bookings === null
      ? []
      : bookingsForSlot(
          schedule.bookings,
          worker.id,
          dateString,
          minute
        );

  // Existing appointments are shown even if a worker's
  // schedule was subsequently changed.
  const pendingBooking = booked.find(
    (item) =>
      item.status === "confirmed" ||
      item.status === "pending"
  );

  if (pendingBooking) {
    return {
      status: "booked",
      title:
        `${pendingBooking.service_name} · ` +
        `${pendingBooking.status} · ` +
        `${pendingBooking.start_time.slice(0, 5)}–` +
        `${pendingBooking.end_time.slice(0, 5)}` +
        (holiday ? " · Conflicts with weekly holiday" : ""),
    };
  }

  const completedBooking = booked.find(
    (item) => item.status === "completed"
  );

  if (completedBooking) {
    return {
      status: "completed",
      title:
        `${completedBooking.service_name} · Completed · ` +
        `${completedBooking.start_time.slice(0, 5)}–` +
        `${completedBooking.end_time.slice(0, 5)}`,
    };
  }

  // No booking records: don't claim available if booking
  // retrieval failed. Weekly holidays and explicit
  // unavailable settings can still be displayed.
  if (holiday) {
    return {
      status: "holiday",
      title: `${day}: Saved weekly holiday`,
    };
  }

  if (!worker.active) {
    return {
      status: "unavailable",
      title: "Worker is inactive",
    };
  }

  if (!schedule.weeklyDays) {
    return {
      status: "unknown",
      title:
        schedule.weeklyError ||
        "Weekly working days have not loaded",
    };
  }

  if (!daily || !daily.data) {
    return {
      status: "unknown",
      title:
        daily?.error ||
        "Date-specific availability has not loaded",
    };
  }

  if (overlapsBreak(minute, daily.data.breaks)) {
    return {
      status: "break",
      title: `${slotKey}: Custom break`,
    };
  }

  if (daily.data.slots[slotKey] === false) {
    return {
      status: "disabled",
      title: `${slotKey}: Manually disabled in Slot Management`,
    };
  }

  if (schedule.bookings === null) {
    return {
      status: "unknown",
      title:
        schedule.bookingError ||
        "Unable to verify bookings",
    };
  }

  return {
    status: "shift",
    title:
      `${slotKey}: Enabled slot, no matching booking. ` +
      "Within the configured worker shift.",
  };
}

// ============================================================
// CSV EXPORT
// ============================================================

function saveCsv(
  filename: string,
  rows: Array<Array<string | number>>
) {
  const content =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map(
            (value) =>
              `"${String(value).replace(/"/g, '""')}"`
          )
          .join(",")
      )
      .join("\r\n");

  const url = URL.createObjectURL(
    new Blob([content], {
      type: "text/csv;charset=utf-8",
    })
  );

  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(
    () => URL.revokeObjectURL(url),
    1000
  );
}

// ============================================================
// EMBEDDED CSS - PREMIUM COMPACT DASHBOARD
// ============================================================

const styles = `
.kpa {
  --amber:#F59E0B;
  --green:#22C55E;
  --blue:#38BDF8;
  --red:#EF4444;
  --purple:#A78BFA;
  --border:#303136;

  width:100%;
  max-width:1320px;
  min-width:0;
  margin:0 auto;
  color:#FFFFFF;
  font:12px Inter,"Segoe UI",Arial,sans-serif;
  color-scheme:dark;
  container-type:inline-size;
}

.kpa *,
.kpa *::before,
.kpa *::after {
  box-sizing:border-box;
}

.kpa button,
.kpa select {
  font:inherit;
}

.kpa button {
  cursor:pointer;
}

.kpa button:disabled {
  opacity:.5;
  cursor:not-allowed;
}

.kpa :is(button,select):focus-visible {
  outline:2px solid #F59E0B;
  outline-offset:2px;
}

/* HEADER */

.kpa-header {
  display:flex;
  justify-content:space-between;
  align-items:center;
  flex-wrap:wrap;
  gap:12px;
  margin-bottom:10px;
}

.kpa-heading h2 {
  margin:0 0 5px;
  font-size:20px;
  font-weight:800;
}

.kpa-heading h2 span {
  color:#F59E0B;
}

.kpa-heading p {
  margin:0;
  color:#9E9EA7;
  font-size:11px;
}

.kpa-toolbar {
  display:flex;
  flex-wrap:wrap;
  gap:7px;
}

.kpa-button,
.kpa-dropdown {
  height:33px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  padding:0 11px;
  color:#EDEDF0;
  background:#191A1D;
  border:1px solid #37383C;
  border-radius:8px;
  font-size:10px;
  font-weight:700;
}

.kpa-button:hover:not(:disabled),
.kpa-dropdown:hover {
  border-color:#F59E0B;
}

.kpa-button.primary {
  background:linear-gradient(135deg,#FFC04D,#F59E0B);
  border-color:#F59E0B;
  color:#17110B;
}

.kpa-dropdown select {
  background:transparent;
  color:inherit;
  border:0;
  outline:none;
  cursor:pointer;
}

.kpa-dropdown option {
  background:#17181A;
  color:white;
}

.kpa-period {
  color:#8D8D96;
  font-size:10px;
  margin-bottom:13px;
}

.kpa-error {
  display:flex;
  align-items:center;
  gap:8px;
  margin-bottom:10px;
  padding:10px;
  border-radius:8px;
  background:rgba(239,68,68,.09);
  border:1px solid rgba(239,68,68,.3);
  color:#FCA5A5;
  font-size:11px;
}

.kpa-loading {
  color:#FBBF24;
  font-size:11px;
  margin-bottom:9px;
}

/* KPI CARDS */

.kpa-kpis {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:9px;
  margin-bottom:12px;
}

.kpa-kpi {
  --accent:#F59E0B;

  display:flex;
  align-items:center;
  gap:10px;
  height:74px;
  min-width:0;
  padding:11px 13px;

  border:1px solid var(--border);
  border-radius:10px;
  background:
    radial-gradient(
      ellipse at 100% 110%,
      color-mix(in srgb,var(--accent) 12%,transparent),
      transparent 60%
    ),
    linear-gradient(140deg,#202124,#111214);
  transition:border-color .2s;
}

.kpa-kpi:hover {
  border-color:var(--accent);
}

.kpa-kpi.green {
  --accent:#22C55E;
}

.kpa-kpi.blue {
  --accent:#38BDF8;
}

.kpa-kpi.purple {
  --accent:#CE7CFF;
}

.kpa-kpi-icon {
  width:34px;
  height:34px;
  flex-shrink:0;
  display:grid;
  place-items:center;
  color:var(--accent);
  border-radius:9px;
  background:color-mix(
    in srgb,var(--accent) 12%,transparent
  );
}

.kpa-kpi-icon svg {
  width:20px;
  height:20px;
}

.kpa-kpi-info {
  min-width:0;
}

.kpa-kpi-info span {
  display:block;
  color:#B6B6BE;
  font-size:10px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.kpa-kpi-info strong {
  display:block;
  margin-top:4px;
  font-size:23px;
  font-weight:800;
}

.kpa-kpi-info small {
  display:block;
  margin-top:4px;
  color:#898992;
  font-size:9px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

/* THREE GRAPHICAL CARDS */

.kpa-analytics {
  display:grid;
  grid-template-columns:
    minmax(0,1.55fr)
    minmax(0,.94fr)
    minmax(0,1.14fr);
  gap:10px;
  margin-bottom:12px;
}

.kpa-card {
  display:flex;
  flex-direction:column;
  min-width:0;
  height:252px;
  padding:13px;
  background:linear-gradient(145deg,#1A1B1D,#111214);
  border:1px solid var(--border);
  border-radius:11px;
  overflow:hidden;
  transition:border-color .2s;
}

.kpa-card:hover {
  border-color:rgba(245,158,11,.45);
}

.kpa-card-header {
  min-height:28px;
  display:flex;
  justify-content:space-between;
  align-items:center;
  flex-wrap:wrap;
  gap:8px;
  margin-bottom:9px;
}

.kpa-card-header h3 {
  margin:0;
  font-size:12px;
  font-weight:800;
}

.kpa-card-header small {
  color:#8D8D96;
  font-size:9px;
}

.kpa-chart-body {
  flex:1;
  min-height:0;
}

/* PERFORMANCE BARS */

.kpa-bars {
  display:flex;
  align-items:flex-end;
  gap:7px;
  height:100%;
  min-width:235px;
  padding:7px 4px 0;
  overflow-x:auto;
  border-bottom:1px solid #45464A;
  background:repeating-linear-gradient(
    to top,
    transparent 0,
    transparent calc(25% - 1px),
    #303136 calc(25% - 1px),
    #303136 25%
  );
}

.kpa-bar {
  flex:1;
  min-width:42px;
  height:100%;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:flex-end;
  gap:5px;
  padding:0;
  color:white;
  background:transparent;
  border:0;
}

.kpa-bar-value {
  font-size:10px;
  font-weight:800;
}

.kpa-bar-track {
  display:flex;
  align-items:flex-end;
  width:min(49px,80%);
  height:130px;
}

.kpa-bar-fill {
  display:block;
  width:100%;
  border-radius:6px 6px 0 0;
  background:linear-gradient(
    #FFBB35,
    #D58C12 55%,
    rgba(117,70,7,.22)
  );
  border:1px solid rgba(255,191,55,.5);
  border-bottom:0;
}

.kpa-bar.selected .kpa-bar-fill {
  filter:brightness(1.2);
  box-shadow:0 0 12px rgba(245,158,11,.3);
}

.kpa-bar-label {
  width:100%;
  min-height:29px;
  font-size:9px;
  color:#BDBDC5;
  text-align:center;
  overflow-wrap:anywhere;
}

/* AVAILABILITY */

.kpa-donut-wrap {
  display:flex;
  align-items:center;
  justify-content:center;
  gap:14px;
  width:100%;
  height:100%;
  min-height:0;
}

.kpa-donut {
  flex-shrink:0;
  width:115px;
  height:115px;
  padding:11px;
  display:grid;
  place-items:center;
  border-radius:50%;
}

.kpa-donut-center {
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  width:100%;
  height:100%;
  background:#141517;
  border-radius:50%;
  text-align:center;
}

.kpa-donut-center strong {
  font-size:23px;
}

.kpa-donut-center span {
  color:#A3A3AD;
  font-size:9px;
}

.kpa-donut-legend {
  flex:0 0 auto;
  display:grid;
  gap:12px;
}

.kpa-legend-row {
  display:flex;
  align-items:flex-start;
  gap:7px;
}

.kpa-legend-dot {
  flex-shrink:0;
  width:8px;
  height:8px;
  margin-top:3px;
  border-radius:50%;
}

.kpa-legend-row span {
  display:block;
  color:#B9B9C0;
  font-size:9px;
}

.kpa-legend-row strong {
  display:block;
  margin-top:3px;
  font-size:12px;
}

/* WORKING HOURS TREND */

.kpa-trend {
  width:100%;
  height:100%;
  min-width:0;
}

.kpa-trend svg {
  display:block;
  width:100%;
  height:100%;
}

/* BOTTOM SECTION */

.kpa-bottom {
  display:grid;
  grid-template-columns:
    minmax(0,1.02fr)
    minmax(0,1.72fr)
    minmax(0,.72fr);
  align-items:start;
  gap:10px;
  padding:10px;
  border:1px solid rgba(245,158,11,.3);
  border-radius:12px;
  background:linear-gradient(145deg,#1C1916,#111214);
}

/* WORKER DETAILS */

.kpa-worker {
  min-width:0;
  padding:3px;
}

.kpa-worker h3,
.kpa-actions h3 {
  margin:0 0 11px;
  font-size:12px;
  font-weight:800;
}

.kpa-worker-select select {
  width:100%;
  max-width:210px;
  height:31px;
  padding:0 10px;
  margin-bottom:10px;
  background:#242426;
  color:white;
  border:1px solid #484039;
  border-radius:7px;
  font-size:10px;
}

.kpa-worker-info {
  display:flex;
  align-items:center;
  gap:10px;
}

.kpa-initials {
  display:grid;
  place-items:center;
  flex-shrink:0;
  width:48px;
  height:48px;
  color:#F5B54D;
  font-size:17px;
  font-weight:800;
  background:linear-gradient(135deg,#46321B,#17181A);
  border:1px solid rgba(245,158,11,.25);
  border-radius:9px;
}

.kpa-worker-name {
  min-width:0;
}

.kpa-worker-name h4 {
  margin:0 0 3px;
  font-size:15px;
  overflow-wrap:anywhere;
}

.kpa-worker-name p {
  margin:0 0 5px;
  color:#B5B5BE;
  font-size:10px;
}

.kpa-badge {
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:4px 7px;
  font-size:9px;
  font-weight:800;
  border-radius:6px;
}

.kpa-badge.active {
  color:#42F5A3;
  background:rgba(34,197,94,.12);
}

.kpa-badge.inactive {
  color:#BDBDC5;
  background:#303136;
}

.kpa-speciality {
  color:#94949D;
  font-size:10px;
  line-height:1.5;
  margin-top:9px;
}

.kpa-worker-stats {
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:6px;
  margin-top:12px;
}

.kpa-worker-stat {
  min-width:0;
  padding:8px 6px;
  background:rgba(255,255,255,.025);
  border:1px solid #35322E;
  border-radius:8px;
}

.kpa-worker-stat svg {
  color:#F59E0B;
  width:15px;
  height:15px;
}

.kpa-worker-stat span {
  display:block;
  margin-top:5px;
  color:#A9A9B2;
  font-size:9px;
}

.kpa-worker-stat strong {
  display:block;
  margin-top:4px;
  font-size:14px;
  overflow-wrap:anywhere;
}

.kpa-profile-more {
  margin-top:10px;
  padding:10px;
  color:#C4C4CC;
  background:#202124;
  border:1px solid #36373B;
  border-radius:8px;
  font-size:10px;
  line-height:1.8;
}

/* WEEKLY SCHEDULE */

.kpa-schedule {
  min-width:0;
  height:300px;
  padding:10px;
  display:flex;
  flex-direction:column;
  overflow:hidden;
  border:1px solid #35363A;
  border-radius:10px;
  background:rgba(9,10,11,.62);
}

.kpa-schedule-header {
  flex-shrink:0;
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:8px;
  margin-bottom:7px;
}

.kpa-schedule-header h3 {
  margin:0;
  font-size:12px;
}

.kpa-week-controls {
  display:flex;
  align-items:center;
  gap:5px;
}

.kpa-week-controls button {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  height:26px;
  padding:0 8px;
  background:#202124;
  color:#D6D6DC;
  border:1px solid #38393E;
  border-radius:6px;
  font-size:9px;
}

.kpa-week-controls button:hover:not(:disabled) {
  border-color:#F59E0B;
  color:#F59E0B;
}

.kpa-week-label {
  flex-shrink:0;
  margin-bottom:8px;
  color:#F5B53F;
  font-size:9px;
  font-weight:700;
}

.kpa-slot-legend {
  flex-shrink:0;
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:9px;
  margin-bottom:8px;
}

.kpa-slot-legend span {
  display:inline-flex;
  align-items:center;
  gap:4px;
  color:#B9B9C1;
  font-size:9px;
}

.kpa-slot-legend svg {
  width:11px;
  height:11px;
}

/* SCROLL ONLY THE TIME SLOTS */

.kpa-slot-table-wrap {
  position:relative;
  flex:1;
  min-height:0;
  width:100%;
  overflow:auto;
  overscroll-behavior:contain;
  scrollbar-width:thin;
  scrollbar-color:#55565C #18191C;
}

.kpa-slot-table {
  width:100%;
  min-width:455px;
  table-layout:fixed;
  border-collapse:separate;
  border-spacing:3px 4px;
}

.kpa-slot-table th:first-child,
.kpa-slot-table td:first-child {
  width:67px;
}

/* FROZEN DAYS AND DATES */

.kpa-slot-table thead th {
  position:sticky;
  top:0;
  z-index:5;
  height:42px;
  padding:4px 2px 7px;
  background:#151619;
  border-bottom:1px solid #3D3E43;
  box-shadow:0 3px 5px rgba(0,0,0,.32);
  color:#E4E4E9;
  font-size:9px;
  font-weight:750;
  text-align:center;
}

.kpa-slot-table thead th small {
  display:block;
  margin-top:3px;
  color:#92929C;
  font-size:8px;
  font-weight:500;
  white-space:nowrap;
}

/* FROZEN TIME COLUMN */

.kpa-slot-table tbody td:first-child {
  position:sticky;
  left:0;
  z-index:4;
  background:#151619;
  box-shadow:3px 0 4px rgba(0,0,0,.25);
  color:#D2D2D9;
  font-size:9px;
  font-weight:700;
  text-align:left;
  white-space:nowrap;
}

.kpa-slot-table thead th:first-child {
  left:0;
  z-index:8;
  background:#191A1D;
  text-align:left;
}

.kpa-slot-table tbody td {
  height:26px;
  padding:0;
  text-align:center;
}

/* STATUS CELLS */

.kpa-slot {
  display:flex;
  align-items:center;
  justify-content:center;
  width:100%;
  height:24px;
  border:1px solid transparent;
  border-radius:6px;
}

.kpa-slot.shift {
  color:#5CFFAF;
  background:linear-gradient(135deg,#08683F,#06462F);
  border-color:rgba(34,197,94,.2);
}

.kpa-slot.booked {
  color:#FFD16C;
  background:linear-gradient(135deg,#A36D10,#5D3D08);
  border-color:rgba(245,158,11,.4);
}

.kpa-slot.completed {
  color:#96C6FF;
  background:#1F4565;
  border-color:rgba(56,189,248,.25);
}

.kpa-slot.holiday {
  color:#FF9696;
  background:linear-gradient(135deg,#742C31,#451B20);
  border-color:rgba(239,68,68,.3);
}

.kpa-slot.break {
  color:#D6C5FF;
  background:#453267;
  border-color:rgba(167,139,250,.3);
}

.kpa-slot.disabled {
  color:#C1C1CB;
  background:#38393D;
  border-color:#505158;
}

.kpa-slot.unavailable {
  color:#B5B5BF;
  background:#34353A;
  border-color:#44454B;
}

.kpa-slot.unknown {
  color:#888891;
  background:#24252A;
  border-color:#34353B;
}

.kpa-schedule-message {
  margin:6px 0;
  padding:6px 8px;
  color:#FBBF24;
  background:rgba(245,158,11,.07);
  border:1px solid rgba(245,158,11,.2);
  border-radius:6px;
  font-size:9px;
  line-height:1.5;
}

.kpa-schedule-message.error {
  color:#FCA5A5;
  border-color:rgba(239,68,68,.25);
  background:rgba(239,68,68,.07);
}

/* QUICK ACTIONS */

.kpa-actions {
  min-width:0;
  padding:3px 0;
}

.kpa-action-list {
  display:grid;
  gap:7px;
}

.kpa-action {
  display:flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  width:100%;
  height:34px;
  padding:0 8px;
  border:1px solid #C68A1D;
  border-radius:7px;
  color:#FBBF24;
  background:rgba(245,158,11,.08);
  font-size:10px;
  font-weight:800;
}

.kpa-action:hover:not(:disabled) {
  background:rgba(245,158,11,.2);
}

.kpa-recent {
  margin-top:12px;
  padding-top:10px;
  border-top:1px solid #373431;
}

.kpa-recent h4 {
  margin:0 0 9px;
  font-size:10px;
}

.kpa-recent-item {
  display:flex;
  align-items:flex-start;
  gap:7px;
  margin-bottom:8px;
}

.kpa-recent-dot {
  width:7px;
  height:7px;
  flex-shrink:0;
  margin-top:4px;
  border-radius:50%;
}

.kpa-recent-item strong {
  display:block;
  color:#E5E5E8;
  font-size:9px;
  line-height:1.4;
}

.kpa-recent-item span {
  display:block;
  margin-top:3px;
  color:#8E8E99;
  font-size:9px;
}

.kpa-empty {
  padding:20px 8px;
  color:#888892;
  font-size:10px;
  line-height:1.6;
  text-align:center;
}

.kpa-note {
  display:flex;
  gap:8px;
  margin-top:11px;
  color:#8F8F99;
  font-size:10px;
  line-height:1.6;
}

.kpa-note svg {
  flex-shrink:0;
  color:#F59E0B;
}

/* RESPONSIVE */

@container (max-width:1050px) {
  .kpa-analytics {
    grid-template-columns:
      minmax(0,1.3fr)
      minmax(0,.92fr)
      minmax(0,1.08fr);
    gap:8px;
  }

  .kpa-card {
    padding:10px;
  }

  .kpa-donut {
    width:95px;
    height:95px;
    padding:9px;
  }

  .kpa-donut-wrap {
    gap:9px;
  }

  .kpa-bottom {
    grid-template-columns:
      minmax(0,1fr)
      minmax(0,1.5fr);
  }

  .kpa-actions {
    grid-column:1/-1;
  }

  .kpa-action-list {
    grid-template-columns:repeat(3,minmax(0,1fr));
  }
}

@container (max-width:780px) {
  .kpa-kpis {
    grid-template-columns:repeat(2,minmax(0,1fr));
  }

  .kpa-analytics {
    grid-template-columns:repeat(3,minmax(0,1fr));
  }

  .kpa-card {
    height:225px;
    padding:8px;
  }

  .kpa-card-header h3 {
    font-size:10px;
  }

  .kpa-donut-wrap {
    flex-direction:column;
    gap:7px;
  }

  .kpa-donut {
    width:82px;
    height:82px;
    padding:7px;
  }

  .kpa-donut-legend {
    display:flex;
    flex-wrap:wrap;
    justify-content:center;
    gap:7px;
  }

  .kpa-bottom {
    grid-template-columns:1fr;
  }

  .kpa-actions {
    grid-column:auto;
  }
}

@container (max-width:590px) {
  .kpa-analytics {
    grid-template-columns:1fr;
  }

  .kpa-card {
    height:235px;
    padding:11px;
  }

  .kpa-donut-wrap {
    flex-direction:row;
  }

  .kpa-donut {
    width:115px;
    height:115px;
  }

  .kpa-donut-legend {
    display:grid;
  }

  .kpa-action-list {
    grid-template-columns:1fr;
  }
}

@container (max-width:420px) {
  .kpa-toolbar {
    width:100%;
  }

  .kpa-kpi {
    height:70px;
    padding:8px;
    gap:7px;
  }

  .kpa-kpi-icon {
    width:30px;
    height:30px;
  }

  .kpa-kpi-info strong {
    font-size:19px;
  }
}

@media (prefers-reduced-motion:reduce) {
  .kpa * {
    transition-duration:.01ms!important;
  }
}
`;

// ============================================================
// KPI CARD
// ============================================================

function Kpi({
  title,
  value,
  note,
  tone,
  icon,
}: {
  title: string;
  value: string | number;
  note: string;
  tone: string;
  icon: ReactNode;
}) {
  return (
    <article className={`kpa-kpi ${tone}`}>
      <div className="kpa-kpi-icon">
        {icon}
      </div>

      <div className="kpa-kpi-info">
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

// ============================================================
// HOURS TREND
// ============================================================

function HoursChart({
  data,
}: {
  data: TrendPoint[];
}) {
  const max = Math.max(
    5,
    ...data.map((point) => point.hours)
  );

  const upper = Math.ceil(max / 5) * 5;

  const points = data.map((item, index) => ({
    x:
      36 +
      (data.length > 1
        ? (index / (data.length - 1)) * 276
        : 138),
    y: 155 - (item.hours / upper) * 131,
  }));

  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
    )
    .join(" ");

  const area = points.length
    ? `${line} L ${
        points[points.length - 1].x
      } 155 L ${points[0].x} 155 Z`
    : "";

  return (
    <div className="kpa-trend">
      <svg
        viewBox="0 0 340 190"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Completed service hours"
      >
        <defs>
          <linearGradient
            id="kpaHoursFill"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="0%"
              stopColor="#F59E0B"
              stopOpacity=".35"
            />

            <stop
              offset="100%"
              stopColor="#F59E0B"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>

        {Array.from({ length: 5 }, (_, index) => {
          const y = 24 + index * 32.75;

          return (
            <g key={index}>
              <line
                x1="36"
                x2="312"
                y1={y}
                y2={y}
                stroke="#34353A"
                strokeWidth=".7"
              />

              <text
                x="29"
                y={y + 4}
                textAnchor="end"
                fill="#A5A5AE"
                fontSize="10"
              >
                {(upper * (1 - index / 4)).toFixed(0)}h
              </text>
            </g>
          );
        })}

        {area && (
          <path
            d={area}
            fill="url(#kpaHoursFill)"
          />
        )}

        {line && (
          <path
            d={line}
            fill="none"
            stroke="#F59E0B"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {points.map((point, index) => (
          <g key={index}>
            <circle
              cx={point.x}
              cy={point.y}
              r="3.8"
              fill="#17181A"
              stroke="#FFC04D"
              strokeWidth="2.2"
            >
              <title>
                {data[index].label}:{" "}
                {data[index].hours.toFixed(1)} hrs
              </title>
            </circle>

            <text
              x={point.x}
              y="175"
              textAnchor="middle"
              fontSize="10"
              fill="#A5A5AE"
            >
              {data[index].label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ============================================================
// SCHEDULE CELL
// ============================================================

function ScheduleCell({
  data,
}: {
  data: ScheduleCellData;
}) {
  const icons: Record<SlotStatus, ReactNode> = {
    shift: <Check size={13} />,
    booked: <CalendarCheck2 size={12} />,
    completed: <CheckCheck size={13} />,
    holiday: <CalendarOff size={12} />,
    break: <Coffee size={12} />,
    disabled: <Ban size={12} />,
    unavailable: <X size={11} />,
    unknown: <HelpCircle size={12} />,
  };

  return (
    <div
      className={`kpa-slot ${data.status}`}
      title={data.title}
      aria-label={data.title}
    >
      {icons[data.status]}
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function WorkerPerformanceTab({
  workers,
  onManageSlots,
}: Props) {
  const [today] = useState(todayISO);

  const [period, setPeriod] =
    useState<Period>("7days");

  const [selectedId, setSelectedId] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);

  const [bookings, setBookings] =
    useState<BarberBooking[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [schedule, setSchedule] =
    useState<ScheduleState | null>(null);

  const [scheduleLoading, setScheduleLoading] =
    useState(false);

  const [refresh, setRefresh] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);

  // ==========================================================
  // SELECTED WORKER
  // ==========================================================

  const currentId = workers.some(
    (worker) => worker.id === selectedId
  )
    ? selectedId
    : workers[0]?.id ?? "";

  const selected =
    workers.find((worker) => worker.id === currentId) ??
    null;

  const range = useMemo(
    () => rangeFor(period, today),
    [period, today]
  );

  const weekDates = useMemo(
    () => weekFor(today, weekOffset),
    [today, weekOffset]
  );

  const weekFrom = dateKey(weekDates[0]);
  const weekTo = dateKey(weekDates[6]);
  const weekKey = `${weekFrom}_${weekTo}`;

  // ==========================================================
  // PERFORMANCE ANALYTICS
  // ==========================================================

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError("");
      setBookings([]);

      try {
        const response = await getBarberBookings(
          {
            dateFrom: range.from,
            dateTo: range.to,
          },
          controller.signal
        );

        if (!controller.signal.aborted) {
          setBookings(response.bookings);
        }
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          setError(errorMessage(err));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => controller.abort();
  }, [range.from, range.to, refresh]);

  // ==========================================================
  // LOAD CORRECT WEEKLY SCHEDULE
  //
  // 1. Saved weekly working days
  // 2. Each working date's slot settings
  // 3. Each date's custom breaks
  // 4. Real booking records
  // ==========================================================

  const loadSchedule = useCallback(
    async (signal: AbortSignal) => {
      if (!selected) {
        setSchedule(null);
        setScheduleLoading(false);
        return;
      }

      setScheduleLoading(true);
      setSchedule(null);

      const workerId = selected.id;

      const state: ScheduleState = {
        workerId,
        weekKey,
        weeklyDays: null,
        daily: {},
        bookings: null,
        bookingError: null,
        weeklyError: null,
      };

      try {
        const weeklyResult = await Promise.allSettled([
          getWeeklySchedule(workerId, signal),

          getBarberBookings(
            {
              dateFrom: weekFrom,
              dateTo: weekTo,
            },
            signal
          ),
        ]);

        if (signal.aborted) return;

        if (weeklyResult[0].status === "fulfilled") {
          state.weeklyDays = weeklyResult[0].value;
        } else {
          state.weeklyError = errorMessage(
            weeklyResult[0].reason
          );
        }

        if (weeklyResult[1].status === "fulfilled") {
          state.bookings = weeklyResult[1].value.bookings;
        } else {
          state.bookingError = errorMessage(
            weeklyResult[1].reason
          );
        }

        // Only fetch enabled working days. Weekly holidays
        // already have a saved unavailable status.
        const datesToFetch = weekDates.filter((date) => {
          const day = weekday(date);

          return (
            state.weeklyDays !== null &&
            state.weeklyDays[day] === true
          );
        });

        const dailyResponses = await Promise.allSettled(
          datesToFetch.map((date) =>
            loadDailySlots(
              workerId,
              dateKey(date),
              signal
            )
          )
        );

        if (signal.aborted) return;

        dailyResponses.forEach((response, index) => {
          const day = dateKey(datesToFetch[index]);

          if (response.status === "fulfilled") {
            state.daily[day] = {
              data: response.value,
              error: null,
            };
          } else {
            state.daily[day] = {
              data: null,
              error: errorMessage(response.reason),
            };
          }
        });

        setSchedule(state);
      } finally {
        if (!signal.aborted) {
          setScheduleLoading(false);
        }
      }
    },
    [
      selected,
      weekKey,
      weekFrom,
      weekTo,
      weekDates,
    ]
  );

  useEffect(() => {
    const controller = new AbortController();

    void loadSchedule(controller.signal);

    return () => controller.abort();
  }, [loadSchedule, refresh]);

  const activeSchedule =
    schedule?.workerId === currentId &&
    schedule.weekKey === weekKey
      ? schedule
      : null;

  // ==========================================================
  // WORKER PERFORMANCE STATISTICS
  // ==========================================================

  const stats = useMemo<Stats[]>(
    () =>
      workers.map((worker) => {
        const own = bookings.filter(
          (booking) =>
            booking.worker_id === worker.id
        );

        const completed = own.filter(
          (booking) =>
            booking.status === "completed"
        );

        const cancelled = own.filter(
          (booking) =>
            booking.status === "cancelled" ||
            booking.status === "rejected"
        );

        return {
          worker,
          total: own.length,
          completed: completed.length,
          cancelled: cancelled.length,
          confirmed: own.filter(
            (booking) =>
              booking.status === "confirmed"
          ).length,
          pending: own.filter(
            (booking) =>
              booking.status === "pending"
          ).length,
          minutes: completed.reduce(
            (sum, booking) =>
              sum + bookingDuration(booking),
            0
          ),
          rate: completionRate(
            completed.length,
            cancelled.length
          ),
        };
      }),
    [workers, bookings]
  );

  const selectedStats =
    stats.find(
      (item) => item.worker.id === currentId
    ) ?? null;

  const active = workers.filter(
    (worker) => worker.active
  ).length;

  const inactive = workers.length - active;

  const completed = stats.reduce(
    (sum, item) => sum + item.completed,
    0
  );

  const cancelled = stats.reduce(
    (sum, item) => sum + item.cancelled,
    0
  );

  const totalMinutes = stats.reduce(
    (sum, item) => sum + item.minutes,
    0
  );

  const averageWeekly = workers.length
    ? (totalMinutes * 7) /
      dayCount(range.start, range.end) /
      workers.length
    : 0;

  const activePercent = workers.length
    ? (active / workers.length) * 100
    : 0;

  // ==========================================================
  // TREND DATA
  // ==========================================================

  const trend = useMemo<TrendPoint[]>(() => {
    const count = dayCount(
      range.start,
      range.end
    );

    const groupSize =
      count <= 7 ? 1 : Math.ceil(count / 7);

    const result: TrendPoint[] = [];

    for (
      let offset = 0;
      offset < count;
      offset += groupSize
    ) {
      const first = addDays(range.start, offset);

      const last = addDays(
        range.start,
        Math.min(
          offset + groupSize - 1,
          count - 1
        )
      );

      const minutes = bookings
        .filter(
          (booking) =>
            booking.status === "completed" &&
            workers.some(
              (worker) =>
                worker.id === booking.worker_id
            ) &&
            booking.booking_date.slice(0, 10) >=
              dateKey(first) &&
            booking.booking_date.slice(0, 10) <=
              dateKey(last)
        )
        .reduce(
          (sum, booking) =>
            sum + bookingDuration(booking),
          0
        );

      result.push({
        label:
          period === "today"
            ? "Today"
            : count <= 7
            ? weekday(first)
            : dateLabel(first),
        hours: minutes / 60,
      });
    }

    return result;
  }, [
    period,
    range.start,
    range.end,
    bookings,
    workers,
  ]);

  // ==========================================================
  // SCHEDULE ROWS
  // ==========================================================

  const scheduleTimes = useMemo(
    () => (selected ? getWorkerTimes(selected) : []),
    [selected]
  );

  const activity = useMemo(() => {
    if (!activeSchedule?.bookings) return [];

    return activeSchedule.bookings
      .filter(
        (booking) =>
          booking.worker_id === currentId
      )
      .slice()
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() -
          new Date(a.updated_at).getTime()
      )
      .slice(0, 3);
  }, [activeSchedule, currentId]);

  const initials =
    selected?.fullName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((value) => value[0] || "")
      .join("")
      .toUpperCase() ?? "";

  const failedDates = activeSchedule
    ? Object.values(activeSchedule.daily).filter(
        (item) => item.error !== null
      ).length
    : 0;

  // ==========================================================
  // EXPORT REPORT
  // ==========================================================

  function exportReport(workerId?: string) {
    const filtered = stats.filter(
      (item) =>
        !workerId || item.worker.id === workerId
    );

    const rows: Array<Array<string | number>> = [
      ["KSHURAK WORKER PERFORMANCE"],
      ["From", range.from, "To", range.to],
      [],
      [
        "Worker",
        "Role",
        "Active",
        "Total Bookings",
        "Completed",
        "Cancelled",
        "Confirmed",
        "Pending",
        "Completed Service Hours",
        "Completion Rate",
      ],
      ...filtered.map((item) => [
        item.worker.fullName,
        item.worker.role,
        item.worker.active ? "Yes" : "No",
        item.total,
        item.completed,
        item.cancelled,
        item.confirmed,
        item.pending,
        (item.minutes / 60).toFixed(2),
        item.rate === null
          ? "N/A"
          : `${item.rate.toFixed(1)}%`,
      ]),
    ];

    saveCsv(
      `worker-performance-${range.from}-${range.to}.csv`,
      rows
    );
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="kpa">
      <style>{styles}</style>

      {/* HEADER */}

      <header className="kpa-header">
        <div className="kpa-heading">
          <h2>
            Workers <span>Performance Analysis</span>
          </h2>

          <p>
            Worker productivity, bookings,
            availability and completed service hours.
          </p>
        </div>

        <div className="kpa-toolbar">
          <label className="kpa-dropdown">
            <CalendarDays size={14} />

            <select
              value={period}
              aria-label="Analysis period"
              onChange={(event) =>
                setPeriod(event.target.value as Period)
              }
            >
              {PERIODS.map((item) => (
                <option
                  key={item.value}
                  value={item.value}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="kpa-button"
            disabled={loading || scheduleLoading}
            onClick={() =>
              setRefresh((value) => value + 1)
            }
          >
            <RefreshCw size={14} />
            Refresh
          </button>

          <button
            type="button"
            className="kpa-button primary"
            disabled={loading || Boolean(error)}
            onClick={() => exportReport()}
          >
            <Download size={14} />
            Export Report
          </button>
        </div>
      </header>

      <div className="kpa-period">
        Reporting Period: {dateLabel(range.start)}
        {" – "}
        {dateLabel(range.end)}
      </div>

      {error && (
        <div className="kpa-error" role="alert">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {loading && (
        <p className="kpa-loading" role="status">
          Loading analytics...
        </p>
      )}

      {/* FOUR KPI CARDS */}

      <div className="kpa-kpis">
        <Kpi
          title="Total Workers"
          value={workers.length}
          note="Registered team members"
          tone="amber"
          icon={<Users />}
        />

        <Kpi
          title="Active Workers"
          value={active}
          note={`${inactive} inactive`}
          tone="green"
          icon={<CircleCheck />}
        />

        <Kpi
          title="Avg. Weekly Hours"
          value={hours(averageWeekly)}
          note="Completed service hours / worker"
          tone="blue"
          icon={<Clock3 />}
        />

        <Kpi
          title="Avg. Performance"
          value={showRate(
            completionRate(completed, cancelled)
          )}
          note="Booking completion rate"
          tone="purple"
          icon={<Star />}
        />
      </div>

      {/* THREE ANALYTICS CARDS */}

      <div className="kpa-analytics">
        <section className="kpa-card">
          <div className="kpa-card-header">
            <h3>Overall Performance Overview</h3>
            <small>Completion rate</small>
          </div>

          <div className="kpa-chart-body">
            <div className="kpa-bars">
              {stats.map((item) => (
                <button
                  key={item.worker.id}
                  type="button"
                  className={`kpa-bar ${
                    currentId === item.worker.id
                      ? "selected"
                      : ""
                  }`}
                  onClick={() =>
                    setSelectedId(item.worker.id)
                  }
                >
                  <span className="kpa-bar-value">
                    {showRate(item.rate)}
                  </span>

                  <span className="kpa-bar-track">
                    <span
                      className="kpa-bar-fill"
                      style={{
                        height: `${item.rate ?? 0}%`,
                      }}
                    />
                  </span>

                  <span className="kpa-bar-label">
                    {item.worker.fullName}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* WORKER AVAILABILITY */}

        <section className="kpa-card">
          <div className="kpa-card-header">
            <h3>Worker Availability</h3>
            <small>Active workforce</small>
          </div>

          <div className="kpa-chart-body">
            <div className="kpa-donut-wrap">
              <div
                className="kpa-donut"
                style={{
                  background: workers.length
                    ? `conic-gradient(
                        #22C55E 0 ${activePercent}%,
                        #505158 ${activePercent}% 100%
                      )`
                    : "#45464B",
                }}
              >
                <div className="kpa-donut-center">
                  <strong>
                    {workers.length
                      ? `${activePercent.toFixed(0)}%`
                      : "—"}
                  </strong>

                  <span>Active Workers</span>
                </div>
              </div>

              <div className="kpa-donut-legend">
                {[
                  {
                    name: "Active",
                    value: active,
                    color: COLORS.green,
                  },
                  {
                    name: "Inactive",
                    value: inactive,
                    color: COLORS.gray,
                  },
                  {
                    name: "Confirmed",
                    value: stats.reduce(
                      (sum, item) =>
                        sum + item.confirmed,
                      0
                    ),
                    color: COLORS.amber,
                  },
                ].map((item) => (
                  <div
                    className="kpa-legend-row"
                    key={item.name}
                  >
                    <i
                      className="kpa-legend-dot"
                      style={{
                        background: item.color,
                      }}
                    />

                    <div>
                      <span>{item.name}</span>
                      <strong>{item.value}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* WORKING HOURS TREND */}

        <section className="kpa-card">
          <div className="kpa-card-header">
            <h3>Working Hours Trend</h3>

            <small>
              {trend
                .reduce(
                  (sum, item) => sum + item.hours,
                  0
                )
                .toFixed(1)}
              h total
            </small>
          </div>

          <div className="kpa-chart-body">
            <HoursChart data={trend} />
          </div>
        </section>
      </div>

      {/* LOWER SECTION */}

      <section className="kpa-bottom">
        {/* WORKER DETAILS */}

        <div className="kpa-worker">
          <h3>Worker Details & Schedule</h3>

          <div className="kpa-worker-select">
            <select
              aria-label="Select worker"
              value={currentId}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setProfileOpen(false);
              }}
            >
              {workers.map((worker) => (
                <option
                  key={worker.id}
                  value={worker.id}
                >
                  {worker.fullName}
                </option>
              ))}
            </select>
          </div>

          {selected && selectedStats ? (
            <>
              <div className="kpa-worker-info">
                <div className="kpa-initials">
                  {initials}
                </div>

                <div className="kpa-worker-name">
                  <h4>{selected.fullName}</h4>
                  <p>{selected.role}</p>

                  <span
                    className={`kpa-badge ${
                      selected.active
                        ? "active"
                        : "inactive"
                    }`}
                  >
                    <CircleCheck size={11} />
                    {selected.active
                      ? "Active"
                      : "Inactive"}
                  </span>
                </div>
              </div>

              <div className="kpa-speciality">
                {selected.specializations ||
                  "No specializations provided"}
              </div>

              <div className="kpa-worker-stats">
                <div className="kpa-worker-stat">
                  <Clock3 />
                  <span>Service Hours</span>
                  <strong>
                    {hours(selectedStats.minutes)}
                  </strong>
                </div>

                <div className="kpa-worker-stat">
                  <CalendarCheck2 />
                  <span>Appointments</span>
                  <strong>
                    {selectedStats.total}
                  </strong>
                </div>

                <div className="kpa-worker-stat">
                  <TrendingUp />
                  <span>Performance</span>
                  <strong>
                    {showRate(selectedStats.rate)}
                  </strong>
                </div>
              </div>

              {profileOpen && (
                <div className="kpa-profile-more">
                  <div>
                    Phone: {selected.phone || "Not provided"}
                  </div>

                  <div>
                    Experience:{" "}
                    {selected.experience || "Not provided"}
                  </div>

                  <div>
                    Shift: {selected.startTime}
                    {" – "}
                    {selected.endTime}
                  </div>

                  <div>
                    Completed: {selectedStats.completed}
                  </div>

                  <div>
                    Cancelled: {selectedStats.cancelled}
                  </div>

                  <div>
                    Confirmed: {selectedStats.confirmed}
                  </div>

                  <div>
                    Pending: {selectedStats.pending}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="kpa-empty">
              No worker selected.
            </div>
          )}
        </div>

        {/* VERIFIED WEEKLY SCHEDULE */}

        <div className="kpa-schedule">
          <div className="kpa-schedule-header">
            <h3>Weekly Schedule</h3>

            <div className="kpa-week-controls">
              <button
                type="button"
                disabled={weekOffset === 0}
                onClick={() => setWeekOffset(0)}
              >
                This Week
              </button>

              <button
                type="button"
                title="Next week"
                aria-label="Next week"
                onClick={() =>
                  setWeekOffset((value) => value + 1)
                }
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          <div className="kpa-week-label">
            {dateLabel(weekDates[0])}
            {" – "}
            {dateLabel(weekDates[6])}

            {scheduleLoading && " · Loading..."}
          </div>

          {/* SCHEDULE LEGEND */}

          <div className="kpa-slot-legend">
            <span title="Enabled slot in working shift">
              <Check color={COLORS.green} />
              Shift
            </span>

            <span>
              <CalendarCheck2 color={COLORS.amber} />
              Booked
            </span>

            <span>
              <CheckCheck color={COLORS.blue} />
              Completed
            </span>

            <span>
              <CalendarOff color={COLORS.red} />
              Holiday
            </span>

            <span>
              <Coffee color={COLORS.purple} />
              Break
            </span>

            <span>
              <Ban color={COLORS.gray} />
              Disabled
            </span>
          </div>

          {activeSchedule?.weeklyError && (
            <div
              className="kpa-schedule-message error"
              role="alert"
            >
              Weekly working days:{" "}
              {activeSchedule.weeklyError}
            </div>
          )}

          {activeSchedule?.bookingError && (
            <div
              className="kpa-schedule-message error"
              role="alert"
            >
              Booking data:{" "}
              {activeSchedule.bookingError}
            </div>
          )}

          {failedDates > 0 && (
            <div
              className="kpa-schedule-message"
              role="status"
            >
              Availability could not be verified for{" "}
              {failedDates} date(s). Affected cells
              are marked as unknown.
            </div>
          )}

          {selected && scheduleTimes.length ? (
            <div
              className="kpa-slot-table-wrap"
              tabIndex={0}
              aria-label="Scrollable weekly worker schedule"
            >
              <table className="kpa-slot-table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>

                    {weekDates.map((date) => (
                      <th
                        scope="col"
                        key={dateKey(date)}
                      >
                        {weekday(date)}

                        <small>
                          {dateLabel(date)}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {scheduleTimes.map((minute) => (
                    <tr key={minute}>
                      <td>
                        {timeLabel(minute)}
                      </td>

                      {weekDates.map((date) => {
                        const result: ScheduleCellData =
                          scheduleLoading ||
                          !activeSchedule
                            ? {
                                status: "unknown",
                                title: "Loading availability...",
                              }
                            : resolveSlot(
                                selected,
                                date,
                                minute,
                                activeSchedule
                              );

                        return (
                          <td
                            key={`${dateKey(date)}-${minute}`}
                          >
                            <ScheduleCell data={result} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="kpa-empty">
              No valid one-hour slots configured.
            </div>
          )}
        </div>

        {/* QUICK ACTIONS */}

        <aside className="kpa-actions">
          <h3>Quick Actions</h3>

          <div className="kpa-action-list">
            <button
              type="button"
              className="kpa-action"
              disabled={!selected}
              onClick={() =>
                setProfileOpen((value) => !value)
              }
            >
              <Eye size={14} />
              {profileOpen
                ? "Hide Profile"
                : "View Full Profile"}
            </button>

            <button
              type="button"
              className="kpa-action"
              disabled={!selected}
              onClick={() => {
                if (selected) {
                  onManageSlots(selected.id);
                }
              }}
            >
              <CalendarClock size={14} />
              Manage Slots
            </button>

            <button
              type="button"
              className="kpa-action"
              disabled={
                !selected ||
                loading ||
                Boolean(error)
              }
              onClick={() => {
                if (selected) {
                  exportReport(selected.id);
                }
              }}
            >
              <ClipboardList size={14} />
              View Reports
            </button>
          </div>

          {/* RECENT ACTIVITY */}

          <div className="kpa-recent">
            <h4>Recent Activity</h4>

            {activity.length ? (
              activity.map((booking) => (
                <div
                  key={booking.id}
                  className="kpa-recent-item"
                >
                  <i
                    className="kpa-recent-dot"
                    style={{
                      background:
                        booking.status === "completed"
                          ? COLORS.green
                          : booking.status === "cancelled" ||
                            booking.status === "rejected"
                          ? COLORS.red
                          : COLORS.amber,
                    }}
                  />

                  <div>
                    <strong>
                      {booking.status}
                      {" · "}
                      {booking.service_name}
                    </strong>

                    <span>
                      {booking.booking_date.slice(0, 10)}
                      {" · "}
                      {booking.start_time.slice(0, 5)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="kpa-empty">
                No activity for this week.
              </div>
            )}
          </div>
        </aside>
      </section>

      <div className="kpa-note">
        <Activity size={14} />

        <span>
          Weekly schedule combines saved working days,
          date-specific slots, custom breaks and booking
          records. Green indicates an enabled slot with no
          matching booking, not verified attendance.
          Weekly holidays are recurring settings rather
          than date-specific leave. A dedicated leave API
          is still required for individual leave dates.
        </span>
      </div>
    </div>
  );
}
