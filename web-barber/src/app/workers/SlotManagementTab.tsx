import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import {
  getWorkerSlots,
  saveWorkerSlots,
  type WorkerBreak,
} from "../../services/barberApi";

import type { WorkerRecord } from "./WorkersTab";

const COLORS = {
  primary: "#F59E0B",
  black: "#000000",
  background: "#070708",
  surface: "#17181A",
  surfaceDark: "#0D0D0E",
  surfaceLight: "#202124",
  thumbnail: "#222326",
  text: "#FFFFFF",
  textSecondary: "#9E9EA7",
  textMuted: "#71717A",
  border: "#27282C",
  borderDark: "#1F2023",
  borderLight: "#3E3F45",
  overlay: "rgba(18,18,20,0.75)",
  glass: "rgba(23,24,26,0.85)",
  glassBorder: "rgba(255,255,255,0.12)",
  heroFade: "rgba(23,24,26,0.4)",
  success: "#22C55E",
  error: "#EF4444",
  warning: "#F59E0B",
} as const;

export type ColorName = keyof typeof COLORS;

type Props = {
  workers: WorkerRecord[];
  barberId: string;
  initialWorkerId?: string;
};

type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
type WeeklyDays = Record<Day, boolean>;

const SLOT_DURATION = 60;

const DAYS: { id: Day; name: string }[] = [
  { id: "Mon", name: "Monday" },
  { id: "Tue", name: "Tuesday" },
  { id: "Wed", name: "Wednesday" },
  { id: "Thu", name: "Thursday" },
  { id: "Fri", name: "Friday" },
  { id: "Sat", name: "Saturday" },
  { id: "Sun", name: "Sunday" },
];

const DEFAULT_WEEK: WeeklyDays = {
  Mon: true,
  Tue: true,
  Wed: true,
  Thu: true,
  Fri: true,
  Sat: true,
  Sun: true,
};

const API_BASE = String(
  import.meta.env.VITE_API_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

function todayISO(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (key: string) =>
    parts.find((part) => part.type === key)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function validISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T12:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function toMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);

  if (!match) return NaN;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return NaN;

  return hours * 60 + minutes;
}

function fromMinutes(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(
    value % 60
  ).padStart(2, "0")}`;
}

function formatTime(value: string): string {
  const total = toMinutes(value);

  if (!Number.isFinite(total)) return value;

  const hours = Math.floor(total / 60);

  return `${hours % 12 || 12}:${String(total % 60).padStart(2, "0")} ${
    hours >= 12 ? "PM" : "AM"
  }`;
}

function slotsForWorker(worker: WorkerRecord): string[] {
  const start = toMinutes(worker.startTime);
  const end = toMinutes(worker.endTime);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end
  ) {
    return [];
  }

  const result: string[] = [];

  for (
    let minute = start;
    minute + SLOT_DURATION <= end;
    minute += SLOT_DURATION
  ) {
    result.push(fromMinutes(minute));
  }

  return result;
}

function breaksOverlap(slot: string, breaks: WorkerBreak[]): boolean {
  const start = toMinutes(slot);
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

function createId(): string {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

function weekSignature(value: WeeklyDays): string {
  return DAYS.map((day) => `${day.id}:${value[day.id]}`).join("|");
}

function slotSignature(
  slots: Record<string, boolean>,
  breaks: WorkerBreak[]
): string {
  return JSON.stringify({
    slots: Object.entries(slots).sort(([a], [b]) => a.localeCompare(b)),
    breaks: [...breaks].sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function getBarberToken(): string {
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

async function weeklyRequest(
  workerId: string,
  options: RequestInit = {}
): Promise<{
  worker_id: string;
  weekly_days: WeeklyDays;
}> {
  if (!API_BASE) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${getBarberToken()}`);
  headers.set("Accept", "application/json");

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(
    `${API_BASE}/api/v1/barber/workers/${encodeURIComponent(
      workerId
    )}/weekly-schedule`,
    { ...options, headers }
  );

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof result?.detail === "string"
        ? result.detail
        : `Weekly schedule error (${response.status}).`
    );
  }

  if (
    !result ||
    result.worker_id !== workerId ||
    !result.weekly_days ||
    DAYS.some(
      (day) => typeof result.weekly_days[day.id] !== "boolean"
    )
  ) {
    throw new Error("Invalid weekly schedule response.");
  }

  return result;
}

const CSS = `
.ksm30 {
  --gold:${COLORS.primary};
  --gold-dark:${COLORS.primary};
  --background:${COLORS.background};
  --surface:${COLORS.surface};
  --surface-dark:${COLORS.surfaceDark};
  --surface-alt:${COLORS.surfaceLight};
  --border:${COLORS.border};
  --border-dark:${COLORS.borderDark};
  --border-light:${COLORS.borderLight};
  --muted:${COLORS.textSecondary};
  --text-muted:${COLORS.textMuted};
  --green:${COLORS.success};
  --red:${COLORS.error};
  --warning:${COLORS.warning};
  width:100%;
  min-width:0;
  color:${COLORS.text};
  background:${COLORS.background};
  font-family:Inter,"Segoe UI",Arial,sans-serif;
  font-size:13px;
  color-scheme:dark;
}
.ksm30 * { box-sizing:border-box; }
.ksm30 button,
.ksm30 input,
.ksm30 select { font:inherit; }
.ksm30 button { cursor:pointer; }
.ksm30 button:disabled {
  cursor:not-allowed;
  opacity:.45;
}
.ksm30-header,
.ksm30-row,
.ksm30-actions {
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:12px;
}
.ksm30-header { margin-bottom:18px; }
.ksm30-eyebrow {
  font-size:10px;
  letter-spacing:1.6px;
  font-weight:800;
  color:var(--gold);
}
.ksm30 h2 {
  margin:6px 0;
  font-size:21px;
  font-weight:850;
}
.ksm30 h3 {
  margin:0;
  font-size:14px;
  font-weight:800;
}
.ksm30-subtitle {
  color:var(--muted);
  font-size:11px;
  line-height:1.6;
}
.ksm30-panel {
  padding:16px;
  border:1px solid var(--border);
  border-radius:14px;
  background:var(--surface);
  margin-bottom:15px;
}
.ksm30-filters {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
}
.ksm30-field {
  display:flex;
  flex-direction:column;
  gap:7px;
  font-size:11px;
  font-weight:700;
}
.ksm30-field input,
.ksm30-field select {
  width:100%;
  min-height:40px;
  background:var(--surface-alt);
  border:1px solid var(--border-light);
  border-radius:9px;
  padding:9px 12px;
  color:white;
}
.ksm30-btn {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  border:1px solid var(--border-light);
  background:var(--surface-alt);
  color:white;
  padding:9px 13px;
  min-height:38px;
  border-radius:9px;
  font-size:12px;
  font-weight:750;
  transition:all .2s;
}
.ksm30-btn:hover:not(:disabled) { border-color:var(--gold); }
.ksm30-btn.gold {
  background:var(--gold);
  border-color:var(--gold);
  color:#111;
  font-weight:900;
}
.ksm30-btn.danger {
  border-color:rgba(239,68,68,0.27);
  color:var(--red);
  background:rgba(239,68,68,0.08);
}
.ksm30-week {
  margin-top:13px;
  display:grid;
  grid-template-columns:repeat(7,minmax(0,1fr));
  gap:7px;
}
.ksm30-day {
  min-width:0;
  min-height:75px;
  border:1px solid var(--border);
  border-radius:11px;
  background:var(--surface-alt);
  color:white;
  text-align:center;
  padding:10px 5px;
  transition:all .2s;
}
.ksm30-day:hover:not(:disabled) {
  transform:translateY(-2px);
  border-color:var(--gold);
}
.ksm30-day.working {
  border-color:rgba(34,197,94,0.35);
  background:rgba(34,197,94,0.04);
}
.ksm30-day.holiday {
  border-color:rgba(245,158,11,0.4);
  background:rgba(245,158,11,0.08);
}
.ksm30-day strong { display:block; font-size:11px; }
.ksm30-day small {
  display:block;
  margin-top:7px;
  font-size:10px;
  color:var(--muted);
}
.ksm30-day.working small { color:var(--green); }
.ksm30-day.holiday small { color:var(--gold); }
.ksm30-slots {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:9px;
  margin-top:13px;
}
.ksm30-slot {
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:8px;
  min-height:58px;
  padding:10px 11px;
  background:var(--surface-alt);
  border:1px solid var(--border);
  border-radius:10px;
  color:white;
  text-align:left;
  transition:all .2s;
}
.ksm30-slot:hover:not(:disabled) {
  border-color:var(--gold);
  transform:translateY(-1px);
}
.ksm30-slot.available { border-color:rgba(34,197,94,0.32); }
.ksm30-slot strong { font-size:12px; }
.ksm30-slot small {
  display:block;
  margin-top:4px;
  font-size:10px;
  color:var(--muted);
}
.ksm30-switch {
  width:34px;
  height:19px;
  border-radius:20px;
  background:#404046;
  flex-shrink:0;
  position:relative;
}
.ksm30-switch::after {
  content:"";
  position:absolute;
  top:3px;
  left:3px;
  height:13px;
  width:13px;
  border-radius:50%;
  background:white;
  transition:transform .2s;
}
.ksm30-switch.on { background:var(--gold); }
.ksm30-switch.on::after { transform:translateX(15px); }
.ksm30-breaks { display:grid; gap:9px; margin-top:12px; }
.ksm30-break {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:11px 12px;
  border:1px solid var(--border);
  border-radius:10px;
}
.ksm30-error,
.ksm30-success,
.ksm30-warning {
  padding:11px;
  border-radius:9px;
  margin:11px 0;
  font-size:12px;
  line-height:1.6;
}
.ksm30-error {
  color:${COLORS.error};
  background:rgba(239,68,68,0.08);
  border:1px solid rgba(239,68,68,0.27);
}
.ksm30-success {
  color:${COLORS.success};
  background:rgba(34,197,94,0.08);
  border:1px solid rgba(34,197,94,0.27);
}
.ksm30-warning {
  color:var(--gold);
  background:rgba(245,158,11,0.08);
  border:1px solid rgba(245,158,11,0.27);
}
.ksm30-empty {
  padding:25px;
  border:1px dashed var(--border);
  border-radius:12px;
  text-align:center;
  color:var(--muted);
}
.ksm30-break-fields {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:11px;
  margin-top:12px;
}
.ksm30-icon {
  color:var(--gold);
  vertical-align:middle;
}
.ksm30-spin { animation:ksm30-spin 1s linear infinite; }
@keyframes ksm30-spin { to { transform:rotate(360deg); } }
@media(max-width:900px) {
  .ksm30-week { grid-template-columns:repeat(4,minmax(0,1fr)); }
  .ksm30-slots { grid-template-columns:repeat(3,minmax(0,1fr)); }
}
@media(max-width:580px) {
  .ksm30-filters,
  .ksm30-break-fields { grid-template-columns:1fr; }
  .ksm30-week { grid-template-columns:repeat(4,minmax(0,1fr)); }
  .ksm30-slots { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
@media(prefers-reduced-motion:reduce) {
  .ksm30 * { transition:none !important; }
  .ksm30-day:hover,
  .ksm30-slot:hover { transform:none !important; }
}
`;

export default function SlotManagementTab({
  workers,
  initialWorkerId = "",
}: Props) {
  const [selectedWorkerId, setSelectedWorkerId] =
    useState(initialWorkerId);
  const [selectedDate, setSelectedDate] = useState(todayISO);

  const [slotsData, setSlotsData] =
    useState<Record<string, boolean>>({});
  const [breaks, setBreaks] = useState<WorkerBreak[]>([]);
  const [snapshot, setSnapshot] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  const [showBreakForm, setShowBreakForm] = useState(false);
  const [breakStart, setBreakStart] = useState("13:00");
  const [breakEnd, setBreakEnd] = useState("14:00");

  const [weeklyDays, setWeeklyDays] =
    useState<WeeklyDays>({ ...DEFAULT_WEEK });
  const [weeklySnapshot, setWeeklySnapshot] =
    useState<WeeklyDays>({ ...DEFAULT_WEEK });
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklySaving, setWeeklySaving] = useState(false);
  const [weeklyLoadedWorkerId, setWeeklyLoadedWorkerId] = useState("");
  const [weeklyError, setWeeklyError] = useState("");
  const [weeklyMessage, setWeeklyMessage] = useState("");
  const [weeklyReload, setWeeklyReload] = useState(0);

  const mounted = useRef(true);
  const mutation = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (
      initialWorkerId &&
      workers.some((worker) => worker.id === initialWorkerId)
    ) {
      setSelectedWorkerId(initialWorkerId);
    }
  }, [initialWorkerId, workers]);

  const selectedWorker =
    workers.find((worker) => worker.id === selectedWorkerId) ||
    workers[0] ||
    null;

  const workerId = selectedWorker?.id || "";
  const workerKey = `${workerId}_${selectedDate}`;

  const slotTimes = useMemo(
    () => selectedWorker ? slotsForWorker(selectedWorker) : [],
    [selectedWorker]
  );

  useEffect(() => {
    const controller = new AbortController();

    setWeeklyLoadedWorkerId("");
    setWeeklyError("");
    setWeeklyMessage("");
    setWeeklyDays({ ...DEFAULT_WEEK });
    setWeeklySnapshot({ ...DEFAULT_WEEK });

    if (!workerId) {
      setWeeklyLoading(false);
      return () => controller.abort();
    }

    setWeeklyLoading(true);

    weeklyRequest(workerId, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;

        setWeeklyDays(data.weekly_days);
        setWeeklySnapshot(data.weekly_days);
        setWeeklyLoadedWorkerId(workerId);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setWeeklyError(getError(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setWeeklyLoading(false);
        }
      });

    return () => controller.abort();
  }, [workerId, weeklyReload]);

  const loadSlots = useCallback(
    async (signal: AbortSignal) => {
      setLoadedKey("");
      setError("");
      setMessage("");
      setShowBreakForm(false);
      setSlotsData({});
      setBreaks([]);
      setSnapshot("");

      if (!workerId || !validISODate(selectedDate)) {
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const result = await getWorkerSlots(
          workerId,
          selectedDate,
          signal
        );

        if (signal.aborted) return;

        if (result.slot_duration_minutes !== SLOT_DURATION) {
          throw new Error(
            `The backend returned ${result.slot_duration_minutes}-minute slots. ` +
            "Configure the backend for 60-minute slots before editing availability."
          );
        }

        setSlotsData(result.slots);
        setBreaks(result.breaks);
        setSnapshot(slotSignature(result.slots, result.breaks));
        setLoadedKey(workerKey);
      } catch (err: unknown) {
        if (!signal.aborted) setError(getError(err));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [workerId, selectedDate, workerKey]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadSlots(controller.signal);
    return () => controller.abort();
  }, [
    loadSlots,
    selectedWorker?.startTime,
    selectedWorker?.endTime,
    selectedWorker?.active,
    reload,
  ]);

  const weeklyLoaded =
    !!workerId &&
    weeklyLoadedWorkerId === workerId &&
    !weeklyLoading;

  const weeklyDirty =
    weeklyLoaded &&
    weekSignature(weeklyDays) !== weekSignature(weeklySnapshot);

  const dailyLoaded =
    !!workerId && loadedKey === workerKey && !loading;

  const dirty =
    dailyLoaded &&
    slotSignature(slotsData, breaks) !== snapshot;

  const busy = saving || weeklySaving;

  const weeklyReady =
    !!selectedWorker?.active &&
    weeklyLoaded &&
    !busy &&
    !dirty;

  const validDate = validISODate(selectedDate);
  const isPast = selectedDate < todayISO();

  const dateDayIndex = validDate
    ? new Date(`${selectedDate}T12:00:00Z`).getUTCDay()
    : -1;

  const selectedWeekday =
    dateDayIndex >= 0
      ? DAYS[dateDayIndex === 0 ? 6 : dateDayIndex - 1]?.id
      : undefined;

  // Daily availability follows the saved weekly schedule.
  const isWeeklyHoliday =
    weeklyLoaded &&
    !!selectedWeekday &&
    weeklySnapshot[selectedWeekday] === false;

  const canEdit =
    !!selectedWorker?.active &&
    validDate &&
    !isPast &&
    dailyLoaded &&
    weeklyLoaded &&
    !weeklyDirty &&
    !isWeeklyHoliday &&
    !busy;

  function available(slot: string): boolean {
    return (
      dailyLoaded &&
      weeklyLoaded &&
      !!selectedWorker?.active &&
      !isWeeklyHoliday &&
      !breaksOverlap(slot, breaks) &&
      slotsData[slot] !== false
    );
  }

  const availableCount = slotTimes.filter(available).length;
  const unavailableCount = slotTimes.length - availableCount;

  async function saveWeekly() {
    if (!weeklyReady || !weeklyDirty || mutation.current) return;

    mutation.current = true;
    setWeeklySaving(true);
    setWeeklyError("");
    setWeeklyMessage("");

    try {
      const result = await weeklyRequest(workerId, {
        method: "PUT",
        body: JSON.stringify({ weekly_days: weeklyDays }),
      });

      if (!mounted.current) return;

      setWeeklyDays(result.weekly_days);
      setWeeklySnapshot(result.weekly_days);
      setWeeklyMessage("Weekly schedule saved successfully.");
      setReload((value) => value + 1);
    } catch (err: unknown) {
      if (mounted.current) setWeeklyError(getError(err));
    } finally {
      mutation.current = false;
      if (mounted.current) setWeeklySaving(false);
    }
  }

  function toggleSlot(slot: string) {
    if (!canEdit || breaksOverlap(slot, breaks)) return;

    setSlotsData((current) => ({
      ...current,
      [slot]: current[slot] === false,
    }));
    setMessage("");
  }

  function addBreak() {
    if (!canEdit || !selectedWorker) return;

    const start = toMinutes(breakStart);
    const end = toMinutes(breakEnd);
    const shiftStart = toMinutes(selectedWorker.startTime);
    const shiftEnd = toMinutes(selectedWorker.endTime);

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start >= end
    ) {
      setError("Break end time must be later than start time.");
      return;
    }

    if (start < shiftStart || end > shiftEnd) {
      setError("Break must be inside the worker shift.");
      return;
    }

    if (
      breaks.some(
        (item) =>
          start < toMinutes(item.end) &&
          end > toMinutes(item.start)
      )
    ) {
      setError("The break overlaps an existing break.");
      return;
    }

    setBreaks((current) =>
      [
        ...current,
        { id: createId(), start: breakStart, end: breakEnd },
      ].sort((a, b) => a.start.localeCompare(b.start))
    );

    setShowBreakForm(false);
    setError("");
    setMessage("");
  }

  function removeBreak(id: string) {
    if (!canEdit) return;
    setBreaks((current) => current.filter((item) => item.id !== id));
    setMessage("");
  }

  async function saveSlots() {
    if (!canEdit || !dirty || mutation.current) return;

    mutation.current = true;
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const result = await saveWorkerSlots(
        workerId,
        selectedDate,
        { slots: slotsData, breaks }
      );

      if (!mounted.current) return;

      setSlotsData(result.slots);
      setBreaks(result.breaks);
      setSnapshot(slotSignature(result.slots, result.breaks));
      setMessage("1-hour slot settings saved successfully.");
    } catch (err: unknown) {
      if (mounted.current) setError(getError(err));
    } finally {
      mutation.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function discardDailyChanges() {
    if (busy || !dirty) return;

    if (window.confirm("Discard unsaved slot and break changes?")) {
      setReload((value) => value + 1);
    }
  }

  function discardWeeklyChanges() {
    if (busy || !weeklyDirty) return;

    if (window.confirm("Discard unsaved weekly schedule changes?")) {
      setWeeklyDays({ ...weeklySnapshot });
      setWeeklyError("");
      setWeeklyMessage("");
    }
  }

  return (
    <div className="ksm30">
      <style>{CSS}</style>

      <div className="ksm30-header">
        <div>
          <span className="ksm30-eyebrow">WORKER AVAILABILITY</span>
          <h2>Manage Worker Schedules</h2>
          <p className="ksm30-subtitle">
            1-hour slots · Weekly holidays · Custom breaks
          </p>
        </div>

        <button
          type="button"
          className="ksm30-btn"
          disabled={
            loading || weeklyLoading || busy || dirty || weeklyDirty
          }
          onClick={() => {
            setReload((value) => value + 1);
            setWeeklyReload((value) => value + 1);
          }}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      {workers.length === 0 ? (
        <div className="ksm30-empty">
          <UserRound size={28} />
          <h3>No Workers Available</h3>
          <p>Add a worker to configure availability.</p>
        </div>
      ) : (
        <>
          <div className="ksm30-panel ksm30-filters">
            <label className="ksm30-field">
              Select Worker
              <select
                value={workerId}
                disabled={
                  loading ||
                  weeklyLoading ||
                  busy ||
                  dirty ||
                  weeklyDirty
                }
                onChange={(event) => {
                  setSelectedWorkerId(event.target.value);
                  setMessage("");
                }}
              >
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.fullName}
                    {!worker.active ? " (Inactive)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="ksm30-field">
              Select Date
              <input
                type="date"
                value={selectedDate}
                min={todayISO()}
                disabled={
                  loading || busy || dirty || weeklyDirty
                }
                onChange={(event) => {
                  setSelectedDate(event.target.value);
                  setMessage("");
                }}
              />
            </label>
          </div>

          {selectedWorker && (
            <p
              className="ksm30-subtitle"
              style={{ marginBottom: 14 }}
            >
              <Clock3 size={14} className="ksm30-icon" />{" "}
              Shift: {formatTime(selectedWorker.startTime)}
              {" – "}
              {formatTime(selectedWorker.endTime)}
              {" · "}
              1-hour intervals
            </p>
          )}

          <section className="ksm30-panel">
            <div className="ksm30-row">
              <h3>
                <CalendarDays size={17} className="ksm30-icon" />{" "}
                Weekly Working Days
              </h3>
              <span className="ksm30-subtitle">
                Individual worker schedule
              </span>
            </div>

            {weeklyLoading ? (
              <div
                className="ksm30-empty"
                style={{ marginTop: 12 }}
              >
                <Loader2 size={18} className="ksm30-spin" />{" "}
                Loading...
              </div>
            ) : (
              <div className="ksm30-week">
                {DAYS.map((day) => {
                  const working = weeklyDays[day.id];

                  return (
                    <button
                      key={day.id}
                      type="button"
                      disabled={!weeklyReady}
                      aria-pressed={working}
                      className={`ksm30-day ${
                        weeklyLoaded
                          ? working ? "working" : "holiday"
                          : ""
                      }`}
                      onClick={() => {
                        setWeeklyDays((current) => ({
                          ...current,
                          [day.id]: !current[day.id],
                        }));
                        setWeeklyMessage("");
                      }}
                    >
                      <strong>{day.name}</strong>
                      <small>
                        {!weeklyLoaded
                          ? "Unavailable"
                          : working
                          ? "Working"
                          : "Holiday"}
                      </small>
                    </button>
                  );
                })}
              </div>
            )}

            {weeklyError && (
              <div role="alert" className="ksm30-error">
                {weeklyError}
              </div>
            )}

            {weeklyMessage && (
              <div role="status" className="ksm30-success">
                {weeklyMessage}
              </div>
            )}

            {dirty && (
              <div className="ksm30-warning">
                Save or discard daily changes before editing weekly days.
              </div>
            )}

            <div className="ksm30-row" style={{ marginTop: 13 }}>
              <p className="ksm30-subtitle">
                {weeklyLoaded
                  ? `${DAYS.filter((day) => weeklyDays[day.id]).length} working days · ${
                      DAYS.filter((day) => !weeklyDays[day.id]).length
                    } holidays`
                  : "Weekly schedule not loaded"}
                {weeklyDirty && " · Unsaved changes"}
              </p>

              <div className="ksm30-actions">
                {weeklyDirty && (
                  <button
                    type="button"
                    className="ksm30-btn"
                    disabled={busy}
                    onClick={discardWeeklyChanges}
                  >
                    Discard Changes
                  </button>
                )}

                <button
                  type="button"
                  className="ksm30-btn gold"
                  disabled={!weeklyReady || !weeklyDirty}
                  onClick={() => void saveWeekly()}
                >
                  {weeklySaving ? (
                    <Loader2 size={15} className="ksm30-spin" />
                  ) : (
                    <Save size={15} />
                  )}
                  Save Weekly Schedule
                </button>
              </div>
            </div>
          </section>

          {isWeeklyHoliday && (
            <div className="ksm30-warning">
              The selected date is this worker&apos;s weekly holiday.
              Daily slots and breaks cannot be edited for this date.
            </div>
          )}

          {weeklyDirty && (
            <div className="ksm30-warning">
              Save or discard weekly schedule changes before editing daily slots.
            </div>
          )}

          {!selectedWorker?.active && (
            <div className="ksm30-warning">
              This worker is inactive. Activate the worker to edit availability.
            </div>
          )}

          {isPast && (
            <div className="ksm30-warning">
              Past dates are read-only.
            </div>
          )}

          {error && (
            <div role="alert" className="ksm30-error">
              {error}
            </div>
          )}

          {message && (
            <div role="status" className="ksm30-success">
              {message}
            </div>
          )}

          <section className="ksm30-panel">
            <div className="ksm30-row">
              <h3>
                <CalendarDays size={17} className="ksm30-icon" />{" "}
                Daily Time Slots
              </h3>
              <span className="ksm30-subtitle">
                1-hour intervals
              </span>
            </div>

            {loading ? (
              <div className="ksm30-empty" style={{ marginTop: 12 }}>
                <Loader2 size={18} className="ksm30-spin" />{" "}
                Loading worker slots...
              </div>
            ) : !dailyLoaded ? (
              <div className="ksm30-empty" style={{ marginTop: 12 }}>
                {validDate
                  ? "Slot data is unavailable. Refresh to try again."
                  : "Select a valid date."}
              </div>
            ) : slotTimes.length === 0 ? (
              <div className="ksm30-empty" style={{ marginTop: 12 }}>
                No complete 1-hour slots fit inside this shift.
              </div>
            ) : (
              <div className="ksm30-slots">
                {slotTimes.map((slot) => {
                  const enabled = available(slot);
                  const blocked = breaksOverlap(slot, breaks);

                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={!canEdit || blocked}
                      aria-pressed={enabled}
                      className={`ksm30-slot ${
                        enabled ? "available" : ""
                      }`}
                      onClick={() => toggleSlot(slot)}
                    >
                      <span>
                        <strong>{formatTime(slot)}</strong>
                        <small>
                          Until{" "}
                          {formatTime(
                            fromMinutes(toMinutes(slot) + SLOT_DURATION)
                          )}
                        </small>
                        <small>
                          {!weeklyLoaded
                            ? "Schedule unavailable"
                            : !selectedWorker?.active
                            ? "Worker inactive"
                            : isWeeklyHoliday
                            ? "Weekly Holiday"
                            : blocked
                            ? "Custom Break"
                            : enabled
                            ? "Available"
                            : "Unavailable"}
                        </small>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`ksm30-switch ${enabled ? "on" : ""}`}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="ksm30-panel">
            <div className="ksm30-row">
              <h3>
                <Clock3 size={17} className="ksm30-icon" />{" "}
                Custom Breaks
              </h3>
              <button
                type="button"
                className="ksm30-btn"
                disabled={!canEdit}
                onClick={() => setShowBreakForm(true)}
              >
                <Plus size={15} />
                Add Break
              </button>
            </div>

            {showBreakForm && (
              <div style={{ marginTop: 13 }}>
                <div className="ksm30-break-fields">
                  <label className="ksm30-field">
                    Start Time
                    <input
                      type="time"
                      step={60}
                      value={breakStart}
                      disabled={!canEdit}
                      onChange={(event) =>
                        setBreakStart(event.target.value)
                      }
                    />
                  </label>

                  <label className="ksm30-field">
                    End Time
                    <input
                      type="time"
                      step={60}
                      value={breakEnd}
                      disabled={!canEdit}
                      onChange={(event) =>
                        setBreakEnd(event.target.value)
                      }
                    />
                  </label>
                </div>

                <div
                  className="ksm30-actions"
                  style={{ marginTop: 11 }}
                >
                  <button
                    type="button"
                    className="ksm30-btn"
                    disabled={busy}
                    onClick={() => setShowBreakForm(false)}
                  >
                    <X size={15} />
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="ksm30-btn gold"
                    disabled={!canEdit}
                    onClick={addBreak}
                  >
                    <Plus size={15} />
                    Add Break
                  </button>
                </div>
              </div>
            )}

            {breaks.length === 0 ? (
              <p className="ksm30-subtitle" style={{ marginTop: 12 }}>
                No custom breaks for this date.
              </p>
            ) : (
              <div className="ksm30-breaks">
                {breaks.map((item) => (
                  <div key={item.id} className="ksm30-break">
                    <div>
                      <strong>
                        {formatTime(item.start)}
                        {" – "}
                        {formatTime(item.end)}
                      </strong>
                      <p className="ksm30-subtitle">
                        Unavailable period
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ksm30-btn danger"
                      disabled={!canEdit}
                      title="Remove break"
                      aria-label="Remove break"
                      onClick={() => removeBreak(item.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <footer className="ksm30-panel">
            <div className="ksm30-row">
              <p className="ksm30-subtitle">
                <CheckCircle2
                  size={14}
                  style={{ color: COLORS.success, verticalAlign: "middle" }}
                />{" "}
                Available:{" "}
                <strong style={{ color: COLORS.success }}>
                  {dailyLoaded && weeklyLoaded ? availableCount : "—"}
                </strong>
                {" · "}
                Unavailable:{" "}
                <strong style={{ color: COLORS.warning }}>
                  {dailyLoaded && weeklyLoaded ? unavailableCount : "—"}
                </strong>
                {dirty && " · Unsaved changes"}
              </p>

              <div className="ksm30-actions">
                {dirty && (
                  <button
                    type="button"
                    className="ksm30-btn"
                    disabled={busy}
                    onClick={discardDailyChanges}
                  >
                    Discard Changes
                  </button>
                )}

                <button
                  type="button"
                  className="ksm30-btn gold"
                  disabled={!canEdit || !dirty}
                  onClick={() => void saveSlots()}
                >
                  {saving ? (
                    <Loader2 size={15} className="ksm30-spin" />
                  ) : (
                    <Save size={15} />
                  )}
                  {saving ? "Saving..." : "Save 1-Hour Slots"}
                </button>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}