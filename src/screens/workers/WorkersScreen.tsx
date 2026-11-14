
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coffee,
  Edit3,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  UserRound,
  Users,
  X,
  XCircle,
} from "lucide-react-native";

import { COLORS } from "../../constants/colors";

import {
  WEEK_DAYS,
  createShopSetupWorker,
  fromShopSetupWorker,
  getShopSetupWorkers,
  getShopSetupWorkerSlots,
  getShopSetupWorkerWeeklySchedule,
  saveShopSetupWorkerSlots,
  saveShopSetupWorkerWeeklySchedule,
  setShopSetupWorkerActive,
  toShopSetupWorkerPayload,
  updateShopSetupWorker,
  type ShopSetupWorker,
  type WorkerFormValues,
  type WorkerBreak,
  type WorkerSlotResponse,
  type WeeklyDays,
  type WeekDay,
} from "../../services/shopSetupApi";

import {
  getBarberBookings,
  type BarberBooking,
} from "../../services/bookingApi";

// ============================================================
// TYPES
// ============================================================

type Props = {
  onBack?: () => void;
};

type Tab = "workers" | "slots" | "performance";

type WorkerFilter = "all" | "active" | "inactive";

type Period =
  | "today"
  | "7days"
  | "15days"
  | "1month"
  | "3months"
  | "6months";

type WorkerEditor = WorkerFormValues & {
  id: string;
};

type WorkerPerformance = {
  worker: ShopSetupWorker;
  total: number;
  completed: number;
  cancelled: number;
  confirmed: number;
  pending: number;
  minutes: number;
  rate: number | null;
};

const C = COLORS;
const GOLD = C.primary;
const BG = C.background;
const SURFACE = C.surface;
const DARK = C.surfaceDark;
const BORDER = C.border;
const MUTED = C.textSecondary;
const SUCCESS = C.success;
const ERROR = C.error;

const GOLD_SOFT = "rgba(245,158,11,0.09)";
const GOLD_BORDER = "rgba(245,158,11,0.35)";

const SLOT_DURATION = 60;

const EMPTY_WORKER: WorkerEditor = {
  id: "",
  fullName: "",
  phone: "",
  role: "Barber",
  experience: "0",
  specializations: "",
  startTime: "09:00",
  endTime: "21:00",
  active: true,
};

const DEFAULT_WEEK: WeeklyDays = {
  Mon: true,
  Tue: true,
  Wed: true,
  Thu: true,
  Fri: true,
  Sat: true,
  Sun: true,
};

const PERIODS: {
  key: Period;
  title: string;
}[] = [
  { key: "today", title: "Today" },
  { key: "7days", title: "7 Days" },
  { key: "15days", title: "15 Days" },
  { key: "1month", title: "1 Month" },
  { key: "3months", title: "3 Months" },
  { key: "6months", title: "6 Months" },
];

// ============================================================
// HELPERS
// ============================================================

function todayISO(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date());

  const get = (key: string) =>
    parts.find((part) => part.type === key)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dateAtNoon(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

function addDays(value: string, amount: number): string {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function subtractMonths(value: string, count: number) {
  const date = dateAtNoon(value);
  const originalDay = date.getUTCDate();

  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - count);

  const maxDay = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      0
    )
  ).getUTCDate();

  date.setUTCDate(Math.min(originalDay, maxDay));
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string): string {
  const date = dateAtNoon(value);

  if (!Number.isFinite(date.getTime())) return value;

  return date.toLocaleDateString("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function minutes(value: string): number {
  const match =
    /^([01]\d|2[0-3]):([0-5]\d)(?::\d{2})?$/.exec(
      String(value || "")
    );

  return match
    ? Number(match[1]) * 60 + Number(match[2])
    : NaN;
}

function timeString(total: number): string {
  return (
    `${String(Math.floor(total / 60)).padStart(2, "0")}:` +
    `${String(total % 60).padStart(2, "0")}`
  );
}

function formatTime(value: string): string {
  const total = minutes(value);

  if (!Number.isFinite(total)) return value || "—";

  const hour = Math.floor(total / 60);

  return (
    `${hour % 12 || 12}:` +
    `${String(total % 60).padStart(2, "0")} ` +
    `${hour >= 12 ? "PM" : "AM"}`
  );
}

function weekday(value: string): WeekDay {
  const names: WeekDay[] = [
    "Sun",
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
  ];

  return names[dateAtNoon(value).getUTCDay()];
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

function initials(value: string): string {
  return (
    value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "W"
  );
}

function validateWorker(form: WorkerEditor): string | null {
  if (form.fullName.trim().length < 2) {
    return "Enter a valid worker name.";
  }

  const phone = form.phone.replace(/\D/g, "");

  if (phone.length < 10 || phone.length > 15) {
    return "Enter a valid phone number.";
  }

  if (!form.role.trim()) {
    return "Worker role is required.";
  }

  const experience = Number(form.experience);

  if (
    !Number.isInteger(experience) ||
    experience < 0 ||
    experience > 80
  ) {
    return "Experience must be between 0 and 80 years.";
  }

  if (
    !Number.isFinite(minutes(form.startTime)) ||
    !Number.isFinite(minutes(form.endTime)) ||
    minutes(form.endTime) <= minutes(form.startTime)
  ) {
    return "Enter valid shift times in HH:MM format.";
  }

  return null;
}

function overlap(
  start: number,
  end: number,
  breaks: WorkerBreak[]
): boolean {
  return breaks.some(
    (item) =>
      start < minutes(item.end) &&
      end > minutes(item.start)
  );
}

function rangeForPeriod(period: Period) {
  const to = todayISO();

  let from = to;

  if (period === "7days") from = addDays(to, -6);
  if (period === "15days") from = addDays(to, -14);
  if (period === "1month") from = subtractMonths(to, 1);
  if (period === "3months") from = subtractMonths(to, 3);
  if (period === "6months") from = subtractMonths(to, 6);

  return { from, to };
}

// ============================================================
// SMALL COMPONENTS
// ============================================================

function Pill({
  label,
  active,
  onPress,
  disabled = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.pill,
        active && styles.pillActive,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          active && styles.pillTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Button({
  title,
  onPress,
  primary = false,
  danger = false,
  disabled = false,
  loading = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        styles.button,
        primary && styles.buttonPrimary,
        danger && styles.buttonDanger,
        (disabled || loading) && styles.disabled,
      ]}
    >
      {loading && (
        <ActivityIndicator
          size="small"
          color={primary ? BG : GOLD}
        />
      )}
      <Text
        style={[
          styles.buttonText,
          primary && styles.buttonPrimaryText,
          danger && { color: ERROR },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function Notice({
  text,
  success = false,
}: {
  text: string;
  success?: boolean;
}) {
  if (!text) return null;

  const color = success ? SUCCESS : ERROR;

  return (
    <View style={[styles.notice, { borderColor: color }]}>
      {success ? (
        <CheckCircle2 size={17} color={color} />
      ) : (
        <XCircle size={17} color={color} />
      )}
      <Text style={[styles.noticeText, { color }]}>
        {text}
      </Text>
    </View>
  );
}

function Metric({
  title,
  value,
  subtitle,
  color = GOLD,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  color?: string;
}) {
  return (
    <View style={styles.metric}>
      <View style={[styles.metricLine, { backgroundColor: color }]} />
      <View style={styles.metricTop}>
        <View style={[styles.metricDot, { backgroundColor: color }]} />
        <TrendingUp size={15} color={color} />
      </View>
      <Text style={[styles.metricValue, { color }]}>
        {value}
      </Text>
      <Text style={styles.metricTitle}>
        {title}
      </Text>
      <Text style={styles.metricSubtitle}>
        {subtitle}
      </Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "numeric" | "phone-pad";
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType || "default"}
        placeholderTextColor={C.textMuted}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[
          styles.input,
          multiline && { minHeight: 84 },
        ]}
      />
    </View>
  );
}

// ============================================================
// MAIN SCREEN
// ============================================================

export default function WorkersScreen({ onBack }: Props) {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();

  const mounted = useRef(true);
  const mutation = useRef(false);

  const [tab, setTab] = useState<Tab>("workers");

  const [workers, setWorkers] =
    useState<ShopSetupWorker[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [filter, setFilter] =
    useState<WorkerFilter>("all");

  const [editor, setEditor] =
    useState<WorkerEditor | null>(null);

  const [editorError, setEditorError] =
    useState("");

  // SLOT STATE
  const [workerId, setWorkerId] = useState("");
  const [slotDate, setSlotDate] = useState(todayISO());

  const [slotData, setSlotData] =
    useState<WorkerSlotResponse | null>(null);

  const [slots, setSlots] =
    useState<Record<string, boolean>>({});

  const [breaks, setBreaks] =
    useState<WorkerBreak[]>([]);

  const [week, setWeek] =
    useState<WeeklyDays>({ ...DEFAULT_WEEK });

  const [slotLoading, setSlotLoading] = useState(false);
  const [slotSaving, setSlotSaving] = useState(false);
  const [slotError, setSlotError] = useState("");
  const [slotRevision, setSlotRevision] = useState(0);
  const [weekRevision, setWeekRevision] = useState(0);

  const [weekLoading, setWeekLoading] = useState(false);
  const [weekSaving, setWeekSaving] = useState(false);
  const [weekError, setWeekError] = useState("");

  const [breakStart, setBreakStart] = useState("13:00");
  const [breakEnd, setBreakEnd] = useState("14:00");

  // PERFORMANCE STATE
  const [period, setPeriod] = useState<Period>("7days");

  const [performanceBookings, setPerformanceBookings] =
    useState<BarberBooking[]>([]);

  const [performanceLoading, setPerformanceLoading] =
    useState(false);

  const [performanceError, setPerformanceError] =
    useState("");

  const [performanceRevision, setPerformanceRevision] =
    useState(0);

  // ==========================================================
  // LOAD WORKERS
  // ==========================================================

  const loadWorkers = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await getShopSetupWorkers();

      if (!mounted.current) return;

      setWorkers(data);

      setWorkerId((current) =>
        data.some((item) => item.id === current)
          ? current
          : data[0]?.id || ""
      );
    } catch (err) {
      if (mounted.current) setError(message(err));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!focused) return;
    void loadWorkers();
  }, [focused, loadWorkers]);

  // ==========================================================
  // LOAD WEEKLY SCHEDULE
  // ==========================================================

  useEffect(() => {
    if (!focused || tab !== "slots" || !workerId) return;

    let active = true;
    const abort = new AbortController();

    setWeekLoading(true);
    setWeekError("");

    void getShopSetupWorkerWeeklySchedule(
      workerId,
      abort.signal
    )
      .then((result) => {
        if (active) setWeek(result.weekly_days);
      })
      .catch((err) => {
        if (active && !abort.signal.aborted) {
          setWeekError(message(err));
        }
      })
      .finally(() => {
        if (active) setWeekLoading(false);
      });

    return () => {
      active = false;
      abort.abort();
    };
  }, [focused, tab, workerId, weekRevision]);

  // ==========================================================
  // LOAD WORKER SLOTS
  // ==========================================================

  useEffect(() => {
    if (!focused || tab !== "slots" || !workerId) return;

    let active = true;
    const abort = new AbortController();

    setSlotLoading(true);
    setSlotError("");
    setSlotData(null);
    setSlots({});
    setBreaks([]);

    void getShopSetupWorkerSlots(
      workerId,
      slotDate,
      abort.signal
    )
      .then((result) => {
        if (!active) return;

        setSlotData(result);
        setSlots(result.slots);
        setBreaks(result.breaks);
      })
      .catch((err) => {
        if (active && !abort.signal.aborted) {
          setSlotError(message(err));
        }
      })
      .finally(() => {
        if (active) setSlotLoading(false);
      });

    return () => {
      active = false;
      abort.abort();
    };
  }, [
    focused,
    tab,
    workerId,
    slotDate,
    slotRevision,
  ]);

  // ==========================================================
  // PERFORMANCE DATA
  // ==========================================================

  const range = useMemo(
    () => rangeForPeriod(period),
    [period]
  );

  useEffect(() => {
    if (!focused || tab !== "performance") return;

    let active = true;
    const abort = new AbortController();

    setPerformanceLoading(true);
    setPerformanceError("");

    void getBarberBookings(
      {
        dateFrom: range.from,
        dateTo: range.to,
      },
      abort.signal
    )
      .then((result) => {
        if (active) {
          setPerformanceBookings(result.bookings);
        }
      })
      .catch((err) => {
        if (active && !abort.signal.aborted) {
          setPerformanceError(message(err));
        }
      })
      .finally(() => {
        if (active) setPerformanceLoading(false);
      });

    return () => {
      active = false;
      abort.abort();
    };
  }, [
    focused,
    tab,
    range.from,
    range.to,
    performanceRevision,
  ]);

  // ==========================================================
  // WORKER STATISTICS
  // ==========================================================

  const activeWorkers = workers.filter(
    (worker) => worker.is_active
  ).length;

  const filteredWorkers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return workers.filter((worker) => {
      if (filter === "active" && !worker.is_active) {
        return false;
      }

      if (filter === "inactive" && worker.is_active) {
        return false;
      }

      return (
        !query ||
        [
          worker.full_name,
          worker.phone,
          worker.role,
          worker.specializations,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query)
        )
      );
    });
  }, [workers, filter, search]);

  const stats = useMemo<WorkerPerformance[]>(() => {
    return workers.map((worker) => {
      const own = performanceBookings.filter(
        (booking) => booking.worker_id === worker.id
      );

      const completed = own.filter(
        (booking) => booking.status === "completed"
      );

      const cancelled = own.filter(
        (booking) => booking.status === "cancelled"
      ).length;

      const resolved = completed.length + cancelled;

      return {
        worker,
        total: own.length,
        completed: completed.length,
        cancelled,
        confirmed: own.filter(
          (booking) => booking.status === "confirmed"
        ).length,
        pending: own.filter(
          (booking) => booking.status === "pending"
        ).length,
        minutes: completed.reduce(
          (sum, booking) =>
            sum +
            (Number(booking.service_duration_minutes) || 0),
          0
        ),
        rate: resolved
          ? (completed.length / resolved) * 100
          : null,
      };
    });
  }, [workers, performanceBookings]);

  const performanceTotals = useMemo(
    () => ({
      bookings: stats.reduce((sum, item) => sum + item.total, 0),
      completed: stats.reduce(
        (sum, item) => sum + item.completed,
        0
      ),
      minutes: stats.reduce(
        (sum, item) => sum + item.minutes,
        0
      ),
    }),
    [stats]
  );

  // ==========================================================
  // WORKER ACTIONS
  // ==========================================================

  const openEditor = (worker?: ShopSetupWorker) => {
    setEditorError("");

    setEditor(
      worker
        ? { ...fromShopSetupWorker(worker), id: worker.id }
        : { ...EMPTY_WORKER }
    );
  };

  const changeEditor = (
    key: keyof WorkerFormValues,
    value: string | boolean
  ) => {
    setEditor((current) =>
      current
        ? { ...current, [key]: value }
        : null
    );
  };

  const saveWorker = async () => {
    if (!editor || mutation.current) return;

    const issue = validateWorker(editor);

    if (issue) {
      setEditorError(issue);
      return;
    }

    mutation.current = true;
    setSaving(true);
    setEditorError("");

    try {
      const payload = toShopSetupWorkerPayload(editor);

      if (editor.id) {
        await updateShopSetupWorker(editor.id, payload);
      } else {
        await createShopSetupWorker(payload);
      }

      if (!mounted.current) return;

      setEditor(null);
      setSuccess("Worker saved successfully.");
      await loadWorkers();
    } catch (err) {
      if (mounted.current) setEditorError(message(err));
    } finally {
      mutation.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const toggleWorker = (worker: ShopSetupWorker) => {
    if (mutation.current) return;

    Alert.alert(
      worker.is_active
        ? "Deactivate Worker?"
        : "Activate Worker?",
      `${worker.full_name} will be ${
        worker.is_active ? "deactivated" : "activated"
      }.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => {
            void (async () => {
              if (mutation.current) return;

              mutation.current = true;
              setSaving(true);

              try {
                await setShopSetupWorkerActive(
                  worker.id,
                  !worker.is_active
                );

                setSuccess("Worker status updated.");
                await loadWorkers();
              } catch (err) {
                setError(message(err));
              } finally {
                mutation.current = false;
                if (mounted.current) setSaving(false);
              }
            })();
          },
        },
      ]
    );
  };

  // ==========================================================
  // SLOT ACTIONS
  // ==========================================================

  const selectedWorker = workers.find(
    (worker) => worker.id === workerId
  );

  const slotEntries = useMemo(() => {
    if (!slotData) return [];

    const start = minutes(slotData.shift_start);
    const end = minutes(slotData.shift_end);
    const result: string[] = [];

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end)
    ) {
      return result;
    }

    for (
      let time = start;
      time + SLOT_DURATION <= end;
      time += SLOT_DURATION
    ) {
      if (time + SLOT_DURATION > 1440) break;
      result.push(timeString(time));
    }

    return result;
  }, [slotData]);

  const availableSlots = slotEntries.filter(
    (time) =>
      slots[time] !== false &&
      !overlap(
        minutes(time),
        minutes(time) + SLOT_DURATION,
        breaks
      )
  ).length;

  const addBreak = () => {
    const start = minutes(breakStart);
    const end = minutes(breakEnd);

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    ) {
      setSlotError("Enter valid break times.");
      return;
    }

    if (
      !slotData ||
      start < minutes(slotData.shift_start) ||
      end > minutes(slotData.shift_end)
    ) {
      setSlotError("Break must be inside the worker shift.");
      return;
    }

    if (overlap(start, end, breaks)) {
      setSlotError("Break overlaps an existing break.");
      return;
    }

    setSlotError("");

    setBreaks((current) => [
      ...current,
      {
        id: `break-${Date.now()}`,
        start: breakStart,
        end: breakEnd,
      },
    ]);
  };

  const saveSlots = async () => {
    if (!workerId || !slotData || mutation.current) return;

    if (slotData.slot_duration_minutes !== SLOT_DURATION) {
      setSlotError(
        "The backend is not configured for 60-minute slots."
      );
      return;
    }

    mutation.current = true;
    setSlotSaving(true);
    setSlotError("");

    try {
      const response = await saveShopSetupWorkerSlots(
        workerId,
        slotDate,
        { slots, breaks }
      );

      if (!mounted.current) return;

      setSlotData(response);
      setSlots(response.slots);
      setBreaks(response.breaks);
      setSuccess("Worker slots saved successfully.");
    } catch (err) {
      if (mounted.current) setSlotError(message(err));
    } finally {
      mutation.current = false;
      if (mounted.current) setSlotSaving(false);
    }
  };

  const saveWeek = async () => {
    if (!workerId || mutation.current) return;

    mutation.current = true;
    setWeekSaving(true);
    setWeekError("");

    try {
      const response =
        await saveShopSetupWorkerWeeklySchedule(
          workerId,
          week
        );

      if (!mounted.current) return;

      setWeek(response.weekly_days);
      setSuccess("Weekly schedule saved successfully.");
    } catch (err) {
      if (mounted.current) setWeekError(message(err));
    } finally {
      mutation.current = false;
      if (mounted.current) setWeekSaving(false);
    }
  };

  // ==========================================================
  // REFRESH
  // ==========================================================

  const refresh = () => {
    setError("");
    setSuccess("");

    if (tab === "workers") {
      void loadWorkers();
    } else if (tab === "slots") {
      setSlotRevision((value) => value + 1);
      setWeekRevision((value) => value + 1);
    } else {
      setPerformanceRevision((value) => value + 1);
    }
  };

  // ==========================================================
  // UI
  // ==========================================================

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={styles.screen}
    >
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <ArrowLeft size={20} color={C.text} />
        </Pressable>

        <View style={styles.flex}>
          <Text style={styles.eyebrow}>
            KSHURAK BARBER
          </Text>
          <Text style={styles.headerTitle}>
            Team Management
          </Text>
        </View>

        <Pressable
          onPress={refresh}
          disabled={saving || slotSaving || weekSaving}
          style={styles.iconButton}
        >
          <RefreshCw size={19} color={GOLD} />
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <Users size={25} color={GOLD} />
            </View>

            <View style={styles.heroBadge}>
              <Sparkles size={14} color={GOLD} />
              <Text style={styles.heroBadgeText}>
                TEAM OPERATIONS
              </Text>
            </View>
          </View>

          <Text style={styles.heroTitle}>
            Your Team.{"\n"}
            <Text style={{ color: GOLD }}>
              Your Excellence.
            </Text>
          </Text>

          <Text style={styles.heroDescription}>
            Manage professionals, plan one-hour
            appointment slots and track team performance.
          </Text>

          <View style={styles.heroMetrics}>
            <View style={styles.heroMetric}>
              <Text style={styles.heroNumber}>
                {workers.length}
              </Text>
              <Text style={styles.heroCaption}>
                TOTAL WORKERS
              </Text>
            </View>

            <View style={styles.heroDivider} />

            <View style={styles.heroMetric}>
              <Text style={styles.heroNumber}>
                {activeWorkers}
              </Text>
              <Text style={styles.heroCaption}>
                ACTIVE
              </Text>
            </View>

            <View style={styles.heroDivider} />

            <View style={styles.heroMetric}>
              <Text style={styles.heroNumber}>
                {workers.length - activeWorkers}
              </Text>
              <Text style={styles.heroCaption}>
                INACTIVE
              </Text>
            </View>
          </View>
        </View>

        <Notice text={error} />
        <Notice text={success} success />

        {/* MAIN TABS */}
        <View style={styles.tabs}>
          {(
            [
              ["workers", "Workers"],
              ["slots", "Slots"],
              ["performance", "Performance"],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[
                styles.tab,
                tab === key && styles.tabActive,
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  tab === key && styles.tabTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ================================================
            WORKERS TAB
        ================================================ */}
        {tab === "workers" && (
          <>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionEyebrow}>
                  TEAM DIRECTORY
                </Text>
                <Text style={styles.sectionTitle}>
                  Professionals
                </Text>
              </View>

              <Pressable
                disabled={saving}
                onPress={() => openEditor()}
                style={styles.addButton}
              >
                <Plus size={16} color={BG} />
                <Text style={styles.addButtonText}>
                  Add Worker
                </Text>
              </Pressable>
            </View>

            <View style={styles.search}>
              <Search size={17} color={MUTED} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
                placeholder="Search name, role or phone..."
                placeholderTextColor={C.textMuted}
              />
              {!!search && (
                <Pressable onPress={() => setSearch("")}>
                  <X size={16} color={MUTED} />
                </Pressable>
              )}
            </View>

            <View style={styles.pills}>
              {(
                ["all", "active", "inactive"] as const
              ).map((key) => (
                <Pill
                  key={key}
                  label={
                    key.charAt(0).toUpperCase() +
                    key.slice(1)
                  }
                  active={filter === key}
                  onPress={() => setFilter(key)}
                />
              ))}
            </View>

            {loading ? (
              <View style={styles.empty}>
                <ActivityIndicator color={GOLD} />
                <Text style={styles.muted}>
                  Loading professionals...
                </Text>
              </View>
            ) : filteredWorkers.length === 0 ? (
              <View style={styles.empty}>
                <Users size={30} color={GOLD} />
                <Text style={styles.emptyTitle}>
                  No Workers Found
                </Text>
                <Text style={styles.muted}>
                  Add a worker or adjust your filters.
                </Text>
              </View>
            ) : (
              <View style={styles.cardList}>
                {filteredWorkers.map((worker) => (
                  <View
                    key={worker.id}
                    style={styles.workerCard}
                  >
                    <View style={styles.workerTop}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {initials(worker.full_name)}
                        </Text>
                      </View>

                      <View style={styles.flex}>
                        <Text style={styles.workerName}>
                          {worker.full_name}
                        </Text>
                        <Text style={styles.workerRole}>
                          {worker.role}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.statusBadge,
                          worker.is_active
                            ? styles.activeBadge
                            : styles.inactiveBadge,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusText,
                            {
                              color: worker.is_active
                                ? SUCCESS
                                : MUTED,
                            },
                          ]}
                        >
                          {worker.is_active
                            ? "ACTIVE"
                            : "INACTIVE"}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.workerInfoGrid}>
                      <View style={styles.infoTile}>
                        <Text style={styles.infoLabel}>
                          EXPERIENCE
                        </Text>
                        <Text style={styles.infoValue}>
                          {worker.years_experience} years
                        </Text>
                      </View>

                      <View style={styles.infoTile}>
                        <Text style={styles.infoLabel}>
                          CONTACT
                        </Text>
                        <Text style={styles.infoValue}>
                          {worker.phone}
                        </Text>
                      </View>

                      <View style={styles.infoTileWide}>
                        <Clock3 size={16} color={GOLD} />
                        <View style={styles.flex}>
                          <Text style={styles.infoLabel}>
                            WORKING SHIFT
                          </Text>
                          <Text style={styles.infoValue}>
                            {formatTime(worker.shift_start)}
                            {" – "}
                            {formatTime(worker.shift_end)}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {!!worker.specializations && (
                      <Text style={styles.specializations}>
                        {worker.specializations}
                      </Text>
                    )}

                    <View style={styles.cardActions}>
                      <Button
                        title="Edit Profile"
                        disabled={saving}
                        onPress={() => openEditor(worker)}
                      />
                      <Button
                        title={
                          worker.is_active
                            ? "Deactivate"
                            : "Activate"
                        }
                        primary={!worker.is_active}
                        danger={worker.is_active}
                        disabled={saving}
                        onPress={() => toggleWorker(worker)}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ================================================
            SLOTS TAB
        ================================================ */}
        {tab === "slots" && (
          <>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionEyebrow}>
                  SCHEDULE CONTROL
                </Text>
                <Text style={styles.sectionTitle}>
                  Slot Management
                </Text>
              </View>
            </View>

            <Text style={styles.fieldLabel}>
              SELECT PROFESSIONAL
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalPills}
            >
              {workers.map((worker) => (
                <Pill
                  key={worker.id}
                  label={worker.full_name}
                  active={workerId === worker.id}
                  onPress={() => {
                    setWorkerId(worker.id);
                    setSlotError("");
                  }}
                />
              ))}
            </ScrollView>

            {!selectedWorker ? (
              <View style={styles.empty}>
                <UserRound size={30} color={GOLD} />
                <Text style={styles.emptyTitle}>
                  Select a Professional
                </Text>
                <Text style={styles.muted}>
                  Add a worker before managing slots.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.selectedWorker}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {initials(selectedWorker.full_name)}
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.workerName}>
                      {selectedWorker.full_name}
                    </Text>
                    <Text style={styles.muted}>
                      {selectedWorker.role} ·{" "}
                      {formatTime(selectedWorker.shift_start)}
                      {" – "}
                      {formatTime(selectedWorker.shift_end)}
                    </Text>
                  </View>
                </View>

                <View style={styles.sectionHeading}>
                  <View>
                    <Text style={styles.sectionEyebrow}>
                      WEEKLY AVAILABILITY
                    </Text>
                    <Text style={styles.sectionTitle}>
                      Working Days
                    </Text>
                  </View>
                </View>

                <Notice text={weekError} />

                {weekLoading ? (
                  <ActivityIndicator color={GOLD} />
                ) : (
                  <View style={styles.weekPanel}>
                    {WEEK_DAYS.map((day) => (
                      <View
                        key={day}
                        style={styles.weekRow}
                      >
                        <View style={styles.flex}>
                          <Text style={styles.weekDay}>
                            {day}
                          </Text>
                          <Text style={styles.muted}>
                            {week[day]
                              ? "Working day"
                              : "Weekly holiday"}
                          </Text>
                        </View>
                        <Switch
                          value={week[day]}
                          onValueChange={(value) =>
                            setWeek((current) => ({
                              ...current,
                              [day]: value,
                            }))
                          }
                          trackColor={{
                            false: C.borderLight,
                            true: GOLD,
                          }}
                          thumbColor={C.text}
                        />
                      </View>
                    ))}

                    <Button
                      title="Save Weekly Schedule"
                      primary
                      loading={weekSaving}
                      onPress={() => void saveWeek()}
                    />
                  </View>
                )}

                <View style={styles.sectionHeading}>
                  <View>
                    <Text style={styles.sectionEyebrow}>
                      DAILY APPOINTMENTS
                    </Text>
                    <Text style={styles.sectionTitle}>
                      One-Hour Slots
                    </Text>
                  </View>
                </View>

                <View style={styles.dateNavigator}>
                  <Pressable
                    onPress={() =>
                      setSlotDate((current) =>
                        addDays(current, -1)
                      )
                    }
                    style={styles.iconButton}
                  >
                    <ChevronLeft size={19} color={GOLD} />
                  </Pressable>

                  <View style={styles.flex}>
                    <Text style={styles.dateTitle}>
                      {formatDate(slotDate)}
                    </Text>
                    <Text style={styles.mutedCenter}>
                      {weekday(slotDate)}
                    </Text>
                  </View>

                  <Pressable
                    onPress={() =>
                      setSlotDate((current) =>
                        addDays(current, 1)
                      )
                    }
                    style={styles.iconButton}
                  >
                    <ChevronRight size={19} color={GOLD} />
                  </Pressable>
                </View>

                <Notice text={slotError} />

                {slotLoading ? (
                  <View style={styles.empty}>
                    <ActivityIndicator color={GOLD} />
                    <Text style={styles.muted}>
                      Loading available slots...
                    </Text>
                  </View>
                ) : slotData ? (
                  <>
                    <View style={styles.metricsGrid}>
                      <Metric
                        title="Total Slots"
                        value={slotEntries.length}
                        subtitle="One-hour blocks"
                      />
                      <Metric
                        title="Available"
                        value={availableSlots}
                        subtitle="Before booking checks"
                        color={SUCCESS}
                      />
                      <Metric
                        title="Unavailable"
                        value={
                          slotEntries.length - availableSlots
                        }
                        subtitle="Disabled or break"
                        color={ERROR}
                      />
                      <Metric
                        title="Breaks"
                        value={breaks.length}
                        subtitle="Scheduled"
                      />
                    </View>

                    {slotData.slot_duration_minutes !== 60 ? (
                      <Notice
                        text="Backend slot duration is not 60 minutes. Update backend scheduling configuration before saving."
                      />
                    ) : (
                      <View style={styles.slotGrid}>
                        {slotEntries.map((time) => {
                          const start = minutes(time);
                          const isOnBreak = overlap(
                            start,
                            start + 60,
                            breaks
                          );

                          const enabled =
                            slots[time] !== false;

                          return (
                            <Pressable
                              key={time}
                              disabled={isOnBreak}
                              onPress={() =>
                                setSlots((current) => ({
                                  ...current,
                                  [time]:
                                    current[time] === false,
                                }))
                              }
                              style={[
                                styles.slotCard,
                                enabled &&
                                  !isOnBreak &&
                                  styles.slotAvailable,
                                (!enabled || isOnBreak) &&
                                  styles.slotUnavailable,
                              ]}
                            >
                              <Clock3
                                size={16}
                                color={
                                  enabled && !isOnBreak
                                    ? SUCCESS
                                    : MUTED
                                }
                              />
                              <Text style={styles.slotTime}>
                                {formatTime(time)}
                              </Text>
                              <Text style={styles.slotSubtext}>
                                {isOnBreak
                                  ? "Break"
                                  : enabled
                                  ? "Available"
                                  : "Disabled"}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}

                    <View style={styles.sectionHeading}>
                      <View>
                        <Text style={styles.sectionEyebrow}>
                          SHIFT BREAKS
                        </Text>
                        <Text style={styles.sectionTitle}>
                          Break Management
                        </Text>
                      </View>
                    </View>

                    <View style={styles.panel}>
                      <View style={styles.breakFields}>
                        <View style={styles.flex}>
                          <Field
                            label="START (HH:MM)"
                            value={breakStart}
                            onChangeText={setBreakStart}
                          />
                        </View>
                        <View style={styles.flex}>
                          <Field
                            label="END (HH:MM)"
                            value={breakEnd}
                            onChangeText={setBreakEnd}
                          />
                        </View>
                      </View>

                      <Button
                        title="Add Break"
                        onPress={addBreak}
                        disabled={slotSaving}
                      />

                      {breaks.map((item) => (
                        <View
                          key={item.id}
                          style={styles.breakRow}
                        >
                          <Coffee size={17} color={GOLD} />
                          <Text style={styles.breakLabel}>
                            {formatTime(item.start)}
                            {" – "}
                            {formatTime(item.end)}
                          </Text>
                          <Pressable
                            onPress={() =>
                              setBreaks((current) =>
                                current.filter(
                                  (entry) =>
                                    entry.id !== item.id
                                )
                              )
                            }
                          >
                            <Trash2
                              size={18}
                              color={ERROR}
                            />
                          </Pressable>
                        </View>
                      ))}
                    </View>

                    <View style={styles.saveFooter}>
                      <Button
                        title="Save Daily Slots"
                        primary
                        loading={slotSaving}
                        disabled={
                          slotData.slot_duration_minutes !== 60
                        }
                        onPress={() => void saveSlots()}
                      />
                    </View>

                    <View style={styles.policy}>
                      <ShieldCheck
                        size={17}
                        color={GOLD}
                      />
                      <Text style={styles.policyText}>
                        These settings control slot
                        availability. Actual bookings and
                        conflicts are validated by FastAPI.
                      </Text>
                    </View>
                  </>
                ) : (
                  <View style={styles.empty}>
                    <CalendarDays
                      size={30}
                      color={GOLD}
                    />
                    <Text style={styles.muted}>
                      Unable to load slot data.
                    </Text>
                  </View>
                )}
              </>
            )}
          </>
        )}

        {/* ================================================
            PERFORMANCE TAB
        ================================================ */}
        {tab === "performance" && (
          <>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionEyebrow}>
                  PERFORMANCE ANALYTICS
                </Text>
                <Text style={styles.sectionTitle}>
                  Team Insights
                </Text>
              </View>
              <BarChart3 size={21} color={GOLD} />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalPills}
            >
              {PERIODS.map((item) => (
                <Pill
                  key={item.key}
                  label={item.title}
                  active={period === item.key}
                  onPress={() => setPeriod(item.key)}
                />
              ))}
            </ScrollView>

            <Text style={styles.periodText}>
              {formatDate(range.from)} –{" "}
              {formatDate(range.to)}
            </Text>

            <Notice text={performanceError} />

            {performanceLoading ? (
              <View style={styles.empty}>
                <ActivityIndicator color={GOLD} />
                <Text style={styles.muted}>
                  Calculating team performance...
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.metricsGrid}>
                  <Metric
                    title="Bookings"
                    value={performanceTotals.bookings}
                    subtitle="Selected period"
                  />
                  <Metric
                    title="Completed"
                    value={performanceTotals.completed}
                    subtitle="Finished services"
                    color={SUCCESS}
                  />
                  <Metric
                    title="Service Hours"
                    value={(
                      performanceTotals.minutes / 60
                    ).toFixed(1)}
                    subtitle="Completed work"
                  />
                  <Metric
                    title="Active Team"
                    value={activeWorkers}
                    subtitle="Professionals"
                  />
                </View>

                <View style={styles.sectionHeading}>
                  <View>
                    <Text style={styles.sectionEyebrow}>
                      INDIVIDUAL RESULTS
                    </Text>
                    <Text style={styles.sectionTitle}>
                      Worker Performance
                    </Text>
                  </View>
                </View>

                {stats.map((item) => (
                  <View
                    key={item.worker.id}
                    style={styles.performanceCard}
                  >
                    <View style={styles.workerTop}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {initials(item.worker.full_name)}
                        </Text>
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.workerName}>
                          {item.worker.full_name}
                        </Text>
                        <Text style={styles.workerRole}>
                          {item.worker.role}
                        </Text>
                      </View>
                      <View style={styles.rateBadge}>
                        <Text style={styles.rateText}>
                          {item.rate === null
                            ? "N/A"
                            : `${item.rate.toFixed(0)}%`}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.performanceNumbers}>
                      <View style={styles.performanceNumber}>
                        <Text style={styles.performanceValue}>
                          {item.total}
                        </Text>
                        <Text style={styles.performanceLabel}>
                          TOTAL
                        </Text>
                      </View>
                      <View style={styles.performanceNumber}>
                        <Text
                          style={[
                            styles.performanceValue,
                            { color: SUCCESS },
                          ]}
                        >
                          {item.completed}
                        </Text>
                        <Text style={styles.performanceLabel}>
                          COMPLETED
                        </Text>
                      </View>
                      <View style={styles.performanceNumber}>
                        <Text style={styles.performanceValue}>
                          {item.confirmed}
                        </Text>
                        <Text style={styles.performanceLabel}>
                          UPCOMING
                        </Text>
                      </View>
                      <View style={styles.performanceNumber}>
                        <Text
                          style={[
                            styles.performanceValue,
                            { color: ERROR },
                          ]}
                        >
                          {item.cancelled}
                        </Text>
                        <Text style={styles.performanceLabel}>
                          CANCELLED
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.progressCaption}>
                      Completion rate for resolved bookings
                    </Text>

                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${
                              item.rate === null
                                ? 0
                                : Math.min(100, item.rate)
                            }%`,
                          },
                        ]}
                      />
                    </View>

                    <Text style={styles.workerFootnote}>
                      {item.pending} pending ·{" "}
                      {(item.minutes / 60).toFixed(1)} hours
                      of completed services
                    </Text>
                  </View>
                ))}

                {stats.length === 0 && (
                  <View style={styles.empty}>
                    <BarChart3 size={28} color={GOLD} />
                    <Text style={styles.emptyTitle}>
                      No Performance Data
                    </Text>
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* ================================================
          WORKER CREATE / EDIT MODAL
      ================================================ */}
      <Modal
        visible={editor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!saving) setEditor(null);
        }}
      >
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={
            Platform.OS === "ios"
              ? "padding"
              : "height"
          }
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.flex}>
                <Text style={styles.eyebrow}>
                  TEAM MANAGEMENT
                </Text>
                <Text style={styles.modalTitle}>
                  {editor?.id
                    ? "Edit Professional"
                    : "Add Professional"}
                </Text>
              </View>

              <Pressable
                disabled={saving}
                onPress={() => setEditor(null)}
                style={styles.iconButton}
              >
                <X size={19} color={C.text} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalBody}
            >
              {editor && (
                <>
                  <Notice text={editorError} />

                  <Field
                    label="FULL NAME"
                    value={editor.fullName}
                    onChangeText={(value) =>
                      changeEditor("fullName", value)
                    }
                  />

                  <Field
                    label="PHONE NUMBER"
                    value={editor.phone}
                    keyboardType="phone-pad"
                    onChangeText={(value) =>
                      changeEditor("phone", value)
                    }
                  />

                  <Field
                    label="ROLE"
                    value={editor.role}
                    onChangeText={(value) =>
                      changeEditor("role", value)
                    }
                  />

                  <Field
                    label="EXPERIENCE (YEARS)"
                    value={editor.experience}
                    keyboardType="numeric"
                    onChangeText={(value) =>
                      changeEditor("experience", value)
                    }
                  />

                  <Field
                    label="SPECIALIZATIONS"
                    value={editor.specializations}
                    multiline
                    onChangeText={(value) =>
                      changeEditor("specializations", value)
                    }
                  />

                  <View style={styles.breakFields}>
                    <View style={styles.flex}>
                      <Field
                        label="SHIFT START"
                        value={editor.startTime}
                        onChangeText={(value) =>
                          changeEditor("startTime", value)
                        }
                      />
                    </View>

                    <View style={styles.flex}>
                      <Field
                        label="SHIFT END"
                        value={editor.endTime}
                        onChangeText={(value) =>
                          changeEditor("endTime", value)
                        }
                      />
                    </View>
                  </View>

                  <View style={styles.weekRow}>
                    <Text style={styles.workerName}>
                      Active Professional
                    </Text>
                    <Switch
                      value={editor.active}
                      onValueChange={(value) =>
                        changeEditor("active", value)
                      }
                      trackColor={{
                        false: C.borderLight,
                        true: GOLD,
                      }}
                    />
                  </View>

                  <View style={styles.modalButtons}>
                    <Button
                      title="Cancel"
                      disabled={saving}
                      onPress={() => setEditor(null)}
                    />
                    <Button
                      title={
                        saving
                          ? "Saving..."
                          : "Save Professional"
                      }
                      primary
                      loading={saving}
                      onPress={() => void saveWorker()}
                    />
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ============================================================
// PREMIUM STYLES
// ============================================================

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: DARK,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  iconButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  eyebrow: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  headerTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 5,
  },
  content: {
    width: "100%",
    maxWidth: 1000,
    alignSelf: "center",
    paddingHorizontal: 15,
    paddingTop: 16,
  },
  hero: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 21,
    padding: 19,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: GOLD_SOFT,
  },
  heroBadgeText: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
  },
  heroTitle: {
    color: C.text,
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 37,
    marginTop: 20,
  },
  heroDescription: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 21,
    marginTop: 11,
  },
  heroMetrics: {
    flexDirection: "row",
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  heroMetric: {
    flex: 1,
    alignItems: "center",
  },
  heroNumber: {
    color: C.text,
    fontSize: 24,
    fontWeight: "900",
  },
  heroCaption: {
    color: MUTED,
    fontSize: 9,
    fontWeight: "800",
    marginTop: 7,
  },
  heroDivider: {
    width: 1,
    height: 33,
    backgroundColor: BORDER,
  },
  tabs: {
    flexDirection: "row",
    gap: 5,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 13,
    padding: 5,
    marginTop: 20,
    marginBottom: 22,
  },
  tab: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },
  tabText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
  },
  tabTextActive: {
    color: GOLD,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 7,
    marginBottom: 14,
  },
  sectionEyebrow: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  sectionTitle: {
    color: C.text,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 5,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: GOLD,
    borderRadius: 10,
  },
  addButtonText: {
    color: BG,
    fontSize: 11,
    fontWeight: "900",
  },
  search: {
    minHeight: 47,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 12,
  },
  pills: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  horizontalPills: {
    gap: 8,
    paddingBottom: 16,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
  },
  pillActive: {
    backgroundColor: GOLD_SOFT,
    borderColor: GOLD,
  },
  pillText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
  },
  pillTextActive: {
    color: GOLD,
  },
  cardList: {
    gap: 12,
  },
  workerCard: {
    padding: 15,
    borderRadius: 17,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  workerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  avatar: {
    width: 45,
    height: 45,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },
  avatarText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: "900",
  },
  workerName: {
    color: C.text,
    fontSize: 14,
    fontWeight: "900",
  },
  workerRole: {
    color: MUTED,
    fontSize: 11,
    marginTop: 5,
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  activeBadge: {
    backgroundColor: "rgba(34,197,94,0.08)",
    borderColor: "rgba(34,197,94,0.35)",
  },
  inactiveBadge: {
    backgroundColor: DARK,
    borderColor: BORDER,
  },
  statusText: {
    fontSize: 9,
    fontWeight: "900",
  },
  workerInfoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 15,
  },
  infoTile: {
    flex: 1,
    minWidth: "44%",
    padding: 12,
    backgroundColor: DARK,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: BORDER,
  },
  infoTileWide: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: DARK,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: BORDER,
  },
  infoLabel: {
    color: C.textMuted,
    fontSize: 9,
    fontWeight: "900",
  },
  infoValue: {
    color: C.text,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 7,
  },
  specializations: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
    marginTop: 13,
  },
  cardActions: {
    flexDirection: "row",
    gap: 9,
    marginTop: 15,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  button: {
    flexGrow: 1,
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.surfaceLight,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  buttonPrimary: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  buttonDanger: {
    borderColor: "rgba(239,68,68,0.40)",
    backgroundColor: "rgba(239,68,68,0.07)",
  },
  buttonText: {
    color: C.text,
    fontSize: 11,
    fontWeight: "900",
  },
  buttonPrimaryText: {
    color: BG,
  },
  selectedWorker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 13,
    backgroundColor: GOLD_SOFT,
    marginBottom: 20,
  },
  weekPanel: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 13,
    gap: 8,
    marginBottom: 24,
  },
  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  weekDay: {
    color: C.text,
    fontSize: 13,
    fontWeight: "800",
  },
  dateNavigator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
  },
  dateTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  muted: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
    marginTop: 5,
  },
  mutedCenter: {
    color: MUTED,
    fontSize: 11,
    textAlign: "center",
    marginTop: 5,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 9,
    marginBottom: 19,
  },
  metric: {
    width: "48.5%",
    padding: 14,
    minHeight: 145,
    borderRadius: 15,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },
  metricLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },
  metricTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metricDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  metricValue: {
    fontSize: 27,
    fontWeight: "900",
    marginTop: 18,
  },
  metricTitle: {
    color: C.text,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 7,
  },
  metricSubtitle: {
    color: MUTED,
    fontSize: 10,
    marginTop: 5,
  },
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginBottom: 22,
  },
  slotCard: {
    width: "48.5%",
    minHeight: 94,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 13,
    borderWidth: 1,
  },
  slotAvailable: {
    backgroundColor: "rgba(34,197,94,0.07)",
    borderColor: "rgba(34,197,94,0.30)",
  },
  slotUnavailable: {
    backgroundColor: DARK,
    borderColor: BORDER,
  },
  slotTime: {
    color: C.text,
    fontSize: 13,
    fontWeight: "900",
  },
  slotSubtext: {
    color: MUTED,
    fontSize: 10,
  },
  panel: {
    backgroundColor: SURFACE,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 18,
  },
  breakFields: {
    flexDirection: "row",
    gap: 10,
  },
  breakRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 13,
    padding: 12,
    borderRadius: 10,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
  },
  breakLabel: {
    flex: 1,
    color: C.text,
    fontSize: 12,
    fontWeight: "800",
  },
  saveFooter: {
    marginBottom: 17,
  },
  policy: {
    flexDirection: "row",
    gap: 9,
    padding: 13,
    borderRadius: 12,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    marginBottom: 15,
  },
  policyText: {
    flex: 1,
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
  },
  periodText: {
    color: MUTED,
    fontSize: 11,
    marginBottom: 16,
  },
  performanceCard: {
    padding: 15,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    marginBottom: 12,
  },
  rateBadge: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },
  rateText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
  },
  performanceNumbers: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 16,
    marginTop: 14,
    backgroundColor: DARK,
    borderRadius: 11,
  },
  performanceNumber: {
    alignItems: "center",
  },
  performanceValue: {
    color: C.text,
    fontSize: 19,
    fontWeight: "900",
  },
  performanceLabel: {
    color: MUTED,
    fontSize: 8,
    marginTop: 6,
    fontWeight: "800",
  },
  progressCaption: {
    color: MUTED,
    fontSize: 10,
    marginTop: 15,
    marginBottom: 8,
  },
  progressTrack: {
    height: 6,
    backgroundColor: DARK,
    borderRadius: 6,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 6,
    backgroundColor: GOLD,
  },
  workerFootnote: {
    color: MUTED,
    fontSize: 10,
    marginTop: 12,
  },
  empty: {
    minHeight: 150,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
    gap: 10,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: "900",
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: SURFACE,
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 18,
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.87)",
    padding: 14,
  },
  modalCard: {
    width: "100%",
    maxWidth: 600,
    maxHeight: "94%",
    alignSelf: "center",
    borderRadius: 18,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: C.borderLight,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  modalTitle: {
    color: C.text,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 5,
  },
  modalBody: {
    padding: 16,
    paddingBottom: 30,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    marginBottom: 9,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: C.borderLight,
    borderRadius: 10,
    fontSize: 12,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 9,
    marginTop: 18,
  },
  disabled: {
    opacity: 0.42,
  },
});
