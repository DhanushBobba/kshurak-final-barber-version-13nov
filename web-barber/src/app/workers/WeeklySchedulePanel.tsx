
import { useEffect, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";

type Day =
  | "Mon" | "Tue" | "Wed" | "Thu"
  | "Fri" | "Sat" | "Sun";

type Schedule = Record<Day, boolean>;

type Props = {
  workerId: string;
};

const DAYS: { key: Day; label: string }[] = [
  { key: "Mon", label: "Monday" },
  { key: "Tue", label: "Tuesday" },
  { key: "Wed", label: "Wednesday" },
  { key: "Thu", label: "Thursday" },
  { key: "Fri", label: "Friday" },
  { key: "Sat", label: "Saturday" },
  { key: "Sun", label: "Sunday" },
];

const EMPTY: Schedule = {
  Mon: true,
  Tue: true,
  Wed: true,
  Thu: true,
  Fri: true,
  Sat: true,
  Sun: true,
};

const BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || ""
).trim().replace(/\/+$/, "");

function token(): string {
  const result =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token") ||
    localStorage.getItem("kshurak_barber_token") ||
    localStorage.getItem("barber_access_token");

  if (!result) {
    throw new Error("Please log in as a barber.");
  }

  return result;
}

async function request(
  workerId: string,
  options: RequestInit = {},
) {
  if (!BASE_URL) {
    throw new Error(
      "VITE_API_BASE_URL is not configured."
    );
  }

  const response = await fetch(
    `${BASE_URL}/api/v1/barber/workers/` +
    `${encodeURIComponent(workerId)}/weekly-schedule`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : `Schedule request failed (${response.status}).`
    );
  }

  return data as {
    worker_id: string;
    weekly_days: Schedule;
  };
}

export default function WeeklySchedulePanel({
  workerId,
}: Props) {
  const [schedule, setSchedule] =
    useState<Schedule>(EMPTY);

  const [saved, setSaved] = useState<Schedule>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [loadedWorkerId, setLoadedWorkerId] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setLoadedWorkerId("");
    setError("");
    setMessage("");

    request(workerId, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;

        setSchedule(data.weekly_days);
        setSaved(data.weekly_days);
        setLoadedWorkerId(workerId);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load weekly schedule."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [workerId, reload]);

  const dirty =
    JSON.stringify(schedule) !== JSON.stringify(saved);

  const ready = loadedWorkerId === workerId && !loading;

  const save = async () => {
    if (!ready || saving || !dirty) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const data = await request(workerId, {
        method: "PUT",
        body: JSON.stringify({
          weekly_days: schedule,
        }),
      });

      setSchedule(data.weekly_days);
      setSaved(data.weekly_days);
      setMessage("Weekly schedule saved successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save schedule."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="w-full rounded-2xl border border-[#27282C] bg-[#17181A] p-4 text-white sm:p-6"
      aria-label="Worker weekly schedule"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#F59E0B]">
            Weekly Availability
          </p>

          <h3 className="mt-2 flex items-center gap-2 text-lg font-black">
            <CalendarDays size={19} color="#F59E0B" />
            Working Days & Holidays
          </h3>

          <p className="mt-2 text-xs leading-5 text-[#9E9EA7]">
            Set this worker's recurring weekly holidays.
            Changes apply to future appointment availability.
          </p>
        </div>

        <button
          type="button"
          disabled={loading || saving || dirty}
          onClick={() => setReload((n) => n + 1)}
          className="flex items-center gap-2 rounded-lg border border-[#3E3F45] px-3 py-2 text-xs disabled:opacity-40"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </p>
      )}

      {message && (
        <p role="status" className="mb-4 flex items-center gap-2 text-xs text-green-400">
          <CheckCircle2 size={15} />
          {message}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-[#9E9EA7]">
          <Loader2 size={17} className="animate-spin" />
          Loading weekly schedule...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {DAYS.map(({ key, label }) => {
            const working = schedule[key];

            return (
              <button
                key={key}
                type="button"
                disabled={!ready || saving}
                aria-pressed={working}
                onClick={() => {
                  setSchedule((current) => ({
                    ...current,
                    [key]: !current[key],
                  }));
                  setMessage("");
                }}
                className={`rounded-xl border p-4 text-left transition disabled:opacity-50 ${
                  working
                    ? "border-green-500/30 bg-green-500/5"
                    : "border-[#F59E0B]/40 bg-[#F59E0B]/10"
                }`}
              >
                <p className="text-sm font-bold">{label}</p>
                <p className={`mt-2 text-xs ${
                  working ? "text-green-400" : "text-[#F59E0B]"
                }`}>
                  {working ? "Working Day" : "Weekly Holiday"}
                </p>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#27282C] pt-4">
        <p className="text-xs text-[#9E9EA7]">
          {DAYS.filter(({ key }) => schedule[key]).length}
          {" working days • "}
          {DAYS.filter(({ key }) => !schedule[key]).length}
          {" weekly holidays"}
        </p>

        <button
          type="button"
          disabled={!ready || saving || !dirty}
          onClick={() => void save()}
          className="flex items-center gap-2 rounded-xl bg-[#F59E0B] px-5 py-3 text-xs font-black text-black disabled:opacity-40"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Save Weekly Schedule
        </button>
      </div>
    </section>
  );
}
