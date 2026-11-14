
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Eye,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Users,
  X,
  XCircle,
} from "lucide-react-native";

import { COLORS } from "../../constants/colors";
import {
  approveRescheduleRequest,
  createWorkerUnavailabilityRequest,
  declineRescheduleRequest,
  getEligibleRescheduleBookings,
  getRescheduleRequests,
  ReschedulingApiError,
  withdrawRescheduleRequest,
  type EligibleRescheduleBooking,
  type RescheduleRequest,
} from "../../services/reschedulingApi";
import {
  getShopSetupWorkers,
  getShopSetupWorkerSlots,
  getShopSetupWorkerWeeklySchedule,
  type ShopSetupWorker,
  type WeekDay,
} from "../../services/shopSetupApi";
import {
  getBarberBookings,
} from "../../services/bookingApi";

// ============================================================
// TYPES
// ============================================================

type Props = {
  onBack: () => void;
};

type Tab =
  | "requests"
  | "awaiting"
  | "approved"
  | "closed";

type DateFilter = "all" | "today" | "week";
type DecisionAction = "approve" | "decline" | "withdraw";

type ProposalDraft = {
  bookingId: string;
  reason: string;
  otherDate: string;
  sameWorkerStart: string;
  replacementWorkerId: string;
  replacementStart: string;
};

type SlotOption = {
  start: string;
  end: string;
};

type Availability = {
  key: string;
  loading: boolean;
  error: string;
  closed: boolean;
  options: SlotOption[];
};

type Decision = {
  request: RescheduleRequest;
  action: DecisionAction;
};

const EMPTY_DRAFT: ProposalDraft = {
  bookingId: "",
  reason: "",
  otherDate: "",
  sameWorkerStart: "",
  replacementWorkerId: "",
  replacementStart: "",
};

const TABS: {
  key: Tab;
  label: string;
  description: string;
}[] = [
  {
    key: "requests",
    label: "Requests",
    description: "Customer requests awaiting action",
  },
  {
    key: "awaiting",
    label: "Awaiting",
    description: "Proposals awaiting customers",
  },
  {
    key: "approved",
    label: "Rescheduled",
    description: "Approved appointment changes",
  },
  {
    key: "closed",
    label: "Closed",
    description: "Declined or withdrawn requests",
  },
];

const GOLD = COLORS.primary;
const BG = COLORS.background;
const SURFACE = COLORS.surface;
const DARK = COLORS.surfaceDark;
const LIGHT = COLORS.surfaceLight;
const BORDER = COLORS.border;
const MUTED = COLORS.textSecondary;
const SUCCESS = COLORS.success;
const ERROR = COLORS.error;

const GOLD_SOFT = "rgba(245,158,11,0.08)";
const GOLD_BORDER = "rgba(245,158,11,0.30)";

// ============================================================
// DATE HELPERS
// ============================================================

function indiaDate(timestamp = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));

  const get = (type: string) =>
    parts.find((item) => item.type === type)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T12:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function addDays(value: string, count: number): string {
  if (!validDate(value)) return "";

  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function formatDate(value?: string | null): string {
  if (!value || !validDate(value)) return "—";

  return new Date(`${value}T12:00:00Z`)
    .toLocaleDateString("en-IN", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "—";

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) return "—";

  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function timeMinutes(value?: string | null): number {
  if (!value) return NaN;

  const match =
    /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(value);

  return match
    ? Number(match[1]) * 60 + Number(match[2])
    : NaN;
}

function toTime(total: number): string {
  return (
    `${String(Math.floor(total / 60)).padStart(2, "0")}:` +
    `${String(total % 60).padStart(2, "0")}`
  );
}

function formatTime(value?: string | null): string {
  const total = timeMinutes(value);

  if (!Number.isFinite(total)) return "—";

  const hour = Math.floor(total / 60);

  return (
    `${hour % 12 || 12}:` +
    `${String(total % 60).padStart(2, "0")} ` +
    `${hour >= 12 ? "PM" : "AM"}`
  );
}

function appointmentTimestamp(
  date: string,
  time: string
): number {
  if (!validDate(date) || !Number.isFinite(timeMinutes(time))) {
    return NaN;
  }

  return Date.parse(`${date}T${toTime(timeMinutes(time))}:00+05:30`);
}

function isEligible(
  booking: EligibleRescheduleBooking,
  now: number
): boolean {
  return (
    booking.status === "confirmed" &&
    Date.parse(booking.reschedule_deadline) > now &&
    appointmentTimestamp(
      booking.booking_date,
      booking.start_time
    ) > now
  );
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to complete this request.";
}

// ============================================================
// REQUEST HELPERS
// ============================================================

function belongsToTab(
  item: RescheduleRequest,
  tab: Tab
): boolean {
  if (tab === "requests") {
    return (
      item.status === "pending" &&
      item.requested_by === "customer"
    );
  }

  if (tab === "awaiting") {
    return (
      item.status === "pending" &&
      item.requested_by === "barber"
    );
  }

  if (tab === "approved") {
    return (
      item.status === "approved" &&
      item.selected_option_type !== "cancel_booking"
    );
  }

  return (
    item.status === "declined" ||
    item.status === "cancelled" ||
    item.selected_option_type === "cancel_booking"
  );
}

function statusLabel(item: RescheduleRequest): string {
  if (item.selected_option_type === "cancel_booking") {
    return "Customer cancelled";
  }

  if (item.status === "pending") {
    return item.requested_by === "barber"
      ? "Awaiting customer"
      : "New request";
  }

  if (item.status === "approved") return "Approved";
  if (item.status === "cancelled") return "Withdrawn";
  if (item.status === "declined") return "Declined";

  return item.status;
}

function statusColor(item: RescheduleRequest): string {
  if (
    item.selected_option_type === "cancel_booking" ||
    item.status === "declined"
  ) {
    return ERROR;
  }

  if (item.status === "approved") return SUCCESS;

  if (item.status === "cancelled") return MUTED;

  return GOLD;
}

// ============================================================
// SHARED COMPONENTS
// ============================================================

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
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        danger && styles.buttonDanger,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {loading && (
        <ActivityIndicator
          color={primary ? BG : GOLD}
          size="small"
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
        <CheckCircle2 size={18} color={color} />
      ) : (
        <AlertCircle size={18} color={color} />
      )}

      <Text style={[styles.noticeText, { color }]}>
        {text}
      </Text>
    </View>
  );
}

function Chip({
  title,
  selected,
  onPress,
  disabled = false,
}: {
  title: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        selected && styles.chipActive,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          selected && styles.chipTextActive,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>
        {value || "Not available"}
      </Text>
    </View>
  );
}

function Sheet({
  title,
  children,
  locked = false,
  onClose,
}: {
  title: string;
  children: ReactNode;
  locked?: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!locked) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[
          styles.overlay,
          {
            paddingTop: Math.max(12, insets.top),
            paddingBottom: Math.max(12, insets.bottom),
          },
        ]}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.flex}>
              <Text style={styles.sheetEyebrow}>
                KSHURAK · APPOINTMENTS
              </Text>
              <Text style={styles.sheetTitle}>{title}</Text>
            </View>

            <Pressable
              onPress={onClose}
              disabled={locked}
              style={styles.iconButton}
            >
              <X size={19} color={COLORS.text} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetBody}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TimeChoices({
  title,
  availability,
  selected,
  onSelect,
  disabled = false,
}: {
  title: string;
  availability: Availability;
  selected: string;
  onSelect: (time: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{title}</Text>

      {availability.loading ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator size="small" color={GOLD} />
          <Text style={styles.muted}>
            Checking available times...
          </Text>
        </View>
      ) : availability.error ? (
        <Notice text={availability.error} />
      ) : availability.closed ? (
        <Text style={styles.muted}>
          This professional has a weekly holiday on the
          selected date.
        </Text>
      ) : availability.options.length === 0 ? (
        <Text style={styles.muted}>
          No available times. Choose another date or worker.
        </Text>
      ) : (
        <View style={styles.chips}>
          {availability.options.map((option) => (
            <Chip
              key={option.start}
              title={`${formatTime(option.start)} – ${formatTime(
                option.end
              )}`}
              selected={selected === option.start}
              disabled={disabled}
              onPress={() => onSelect(option.start)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ============================================================
// AVAILABILITY
// ============================================================

function useAvailability(
  enabled: boolean,
  booking: EligibleRescheduleBooking | null,
  workerId: string,
  date: string,
  revision: number
): Availability {
  const key =
    enabled &&
    booking?.id &&
    workerId &&
    validDate(date)
      ? [
          booking.id,
          workerId,
          date,
          revision,
        ].join("|")
      : "";

  const [state, setState] = useState<Availability>({
    key: "",
    loading: false,
    error: "",
    closed: false,
    options: [],
  });

  useEffect(() => {
    if (!key || !booking) return;

    const abort = new AbortController();

    setState({
      key,
      loading: true,
      error: "",
      closed: false,
      options: [],
    });

    void Promise.all([
      getShopSetupWorkerSlots(
        workerId,
        date,
        abort.signal
      ),
      getShopSetupWorkerWeeklySchedule(
        workerId,
        abort.signal
      ),
      getBarberBookings(
        {
          dateFrom: date,
          dateTo: date,
        },
        abort.signal
      ),
    ])
      .then(([slotData, schedule, result]) => {
        if (abort.signal.aborted) return;

        const weekdays: WeekDay[] = [
          "Sun",
          "Mon",
          "Tue",
          "Wed",
          "Thu",
          "Fri",
          "Sat",
        ];

        const day = weekdays[
          new Date(`${date}T12:00:00Z`).getUTCDay()
        ];

        const closed = schedule.weekly_days[day] !== true;
        const options: SlotOption[] = [];

        const shiftStart = timeMinutes(
          slotData.shift_start
        );

        const shiftEnd = timeMinutes(
          slotData.shift_end
        );

        const duration = booking.service_duration_minutes;

        if (
          !closed &&
          Number.isFinite(shiftStart) &&
          Number.isFinite(shiftEnd) &&
          Number.isInteger(duration) &&
          duration > 0 &&
          slotData.slot_duration_minutes === 60
        ) {
          const blocked = Object.entries(
            slotData.slots
          )
            .filter(([, allowed]) => allowed === false)
            .map(([time]) => timeMinutes(time));

          const breaks = slotData.breaks.map(
            (item) => ({
              start: timeMinutes(item.start),
              end: timeMinutes(item.end),
            })
          );

          const conflicts = result.bookings.filter(
            (item) =>
              item.id !== booking.id &&
              item.worker_id === workerId &&
              item.barber_id === booking.barber_id &&
              item.booking_date === date &&
              (
                item.status === "confirmed" ||
                item.status === "pending"
              )
          );

          const validData =
            blocked.every(Number.isFinite) &&
            breaks.every(
              (item) =>
                Number.isFinite(item.start) &&
                Number.isFinite(item.end) &&
                item.end > item.start
            ) &&
            conflicts.every(
              (item) =>
                Number.isFinite(
                  timeMinutes(item.start_time)
                ) &&
                Number.isFinite(
                  timeMinutes(item.end_time)
                )
            );

          if (!validData) {
            throw new Error(
              "Worker availability contains invalid time data."
            );
          }

          for (
            let start = shiftStart;
            start + duration <= shiftEnd;
            start += 60
          ) {
            const end = start + duration;

            if (end >= 1440) continue;

            const startText = toTime(start);

            if (
              appointmentTimestamp(
                date,
                startText
              ) <= Date.now()
            ) {
              continue;
            }

            const disabledSlot = blocked.some(
              (time) =>
                start < time + 60 &&
                end > time
            );

            const onBreak = breaks.some(
              (item) =>
                start < item.end &&
                end > item.start
            );

            const alreadyBooked = conflicts.some(
              (item) =>
                start <
                  timeMinutes(item.end_time) &&
                end >
                  timeMinutes(item.start_time)
            );

            if (
              !disabledSlot &&
              !onBreak &&
              !alreadyBooked
            ) {
              options.push({
                start: startText,
                end: toTime(end),
              });
            }
          }
        }

        setState({
          key,
          loading: false,
          error: "",
          closed,
          options,
        });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;

        setState({
          key,
          loading: false,
          error: errorText(error),
          closed: false,
          options: [],
        });
      });

    return () => abort.abort();
  }, [
    key,
    booking?.id,
    workerId,
    date,
  ]);

  if (!key) {
    return {
      key: "",
      loading: false,
      error: "",
      closed: false,
      options: [],
    };
  }

  if (state.key !== key) {
    return {
      key,
      loading: true,
      error: "",
      closed: false,
      options: [],
    };
  }

  return state;
}

// ============================================================
// MAIN SCREEN
// ============================================================

export default function ReschedulingScreen({
  onBack,
}: Props) {
  const insets = useSafeAreaInsets();

  const mounted = useRef(true);
  const mutation = useRef(false);

  const [requests, setRequests] =
    useState<RescheduleRequest[]>([]);

  const [workers, setWorkers] =
    useState<ShopSetupWorker[]>([]);

  const [bookings, setBookings] =
    useState<EligibleRescheduleBooking[]>([]);

  const [tab, setTab] = useState<Tab>("requests");
  const [dateFilter, setDateFilter] =
    useState<DateFilter>("all");
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [proposalOpen, setProposalOpen] =
    useState(false);
  const [proposalLoading, setProposalLoading] =
    useState(false);
  const [proposalReload, setProposalReload] =
    useState(0);

  const [availabilityReload, setAvailabilityReload] =
    useState(0);

  const [draft, setDraft] =
    useState<ProposalDraft>({
      ...EMPTY_DRAFT,
    });

  const [bookingSearch, setBookingSearch] = useState("");
  const [modalError, setModalError] = useState("");

  const [details, setDetails] =
    useState<RescheduleRequest | null>(null);

  const [decision, setDecision] =
    useState<Decision | null>(null);

  const [decisionReason, setDecisionReason] =
    useState("");

  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(Date.now);

  // ----------------------------------------------------------
  // LIFECYCLE
  // ----------------------------------------------------------

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const update = () =>
      setNow(Date.now() + clockOffset);

    update();

    const timer = setInterval(update, 15000);

    return () => clearInterval(timer);
  }, [clockOffset]);

  // ----------------------------------------------------------
  // LOAD REQUESTS
  // ----------------------------------------------------------

  useEffect(() => {
    const abort = new AbortController();

    setLoading(true);
    setError("");

    void getRescheduleRequests(
      undefined,
      abort.signal
    )
      .then((response) => {
        if (!abort.signal.aborted) {
          setRequests(response.requests);
        }
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          setError(errorText(error));
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          setLoading(false);
        }
      });

    return () => abort.abort();
  }, [reload]);

  // ----------------------------------------------------------
  // LOAD WORKERS
  // ----------------------------------------------------------

  useEffect(() => {
    const abort = new AbortController();

    void getShopSetupWorkers(abort.signal)
      .then((response) => {
        if (!abort.signal.aborted) {
          setWorkers(response);
        }
      })
      .catch(() => {
        // Proposal reload displays any worker error.
      });

    return () => abort.abort();
  }, []);

  // ----------------------------------------------------------
  // LOAD ELIGIBLE BOOKINGS
  // ----------------------------------------------------------

  useEffect(() => {
    if (!proposalOpen) return;

    const abort = new AbortController();

    setProposalLoading(true);
    setModalError("");

    const started = Date.now();

    void Promise.all([
      getEligibleRescheduleBookings(abort.signal),
      getShopSetupWorkers(abort.signal),
    ])
      .then(([result, workerList]) => {
        if (abort.signal.aborted) return;

        const received = Date.now();
        const serverTimestamp =
          Date.parse(result.server_time);

        if (!Number.isFinite(serverTimestamp)) {
          throw new Error(
            "The backend returned invalid server time."
          );
        }

        const offset =
          serverTimestamp - (started + received) / 2;

        setClockOffset(offset);
        setNow(Date.now() + offset);
        setBookings(result.bookings);
        setWorkers(workerList);

        setDraft((current) =>
          result.bookings.some(
            (item) => item.id === current.bookingId
          )
            ? current
            : { ...EMPTY_DRAFT }
        );
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          setModalError(errorText(error));
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          setProposalLoading(false);
        }
      });

    return () => abort.abort();
  }, [proposalOpen, proposalReload]);

  // ----------------------------------------------------------
  // ELIGIBILITY & WORKERS
  // ----------------------------------------------------------

  const eligibleBookings = useMemo(
    () =>
      bookings.filter((item) => isEligible(item, now)),
    [bookings, now]
  );

  const booking =
    eligibleBookings.find(
      (item) => item.id === draft.bookingId
    ) || null;

  const originalWorker = workers.find(
    (item) => item.id === booking?.worker_id
  );

  const replacementWorkers = workers.filter(
    (item) =>
      item.is_active &&
      item.id !== booking?.worker_id &&
      item.barber_id === booking?.barber_id
  );

  const replacementWorker = replacementWorkers.find(
    (item) => item.id === draft.replacementWorkerId
  );

  const sameAvailability = useAvailability(
    proposalOpen &&
      !proposalLoading &&
      Boolean(booking) &&
      Boolean(originalWorker?.is_active) &&
      validDate(draft.otherDate),
    booking,
    booking?.worker_id || "",
    draft.otherDate,
    availabilityReload
  );

  const replacementAvailability = useAvailability(
    proposalOpen &&
      !proposalLoading &&
      Boolean(booking) &&
      Boolean(replacementWorker),
    booking,
    draft.replacementWorkerId,
    booking?.booking_date || "",
    availabilityReload
  );

  const sameTime = sameAvailability.options.find(
    (item) => item.start === draft.sameWorkerStart
  );

  const replacementTime =
    replacementAvailability.options.find(
      (item) => item.start === draft.replacementStart
    );

  const today = indiaDate(now);
  const weekEnd = addDays(today, 6);

  const counts = useMemo(
    () => ({
      requests: requests.filter(
        (item) => belongsToTab(item, "requests")
      ).length,
      awaiting: requests.filter(
        (item) => belongsToTab(item, "awaiting")
      ).length,
      approved: requests.filter(
        (item) => belongsToTab(item, "approved")
      ).length,
      closed: requests.filter(
        (item) => belongsToTab(item, "closed")
      ).length,
    }),
    [requests]
  );

  const visibleRequests = useMemo(() => {
    const query = search.trim().toLowerCase();

    return requests
      .filter((item) => belongsToTab(item, tab))
      .filter((item) => {
        if (!query) return true;

        return [
          item.customer_name,
          item.customer_phone,
          item.service_name,
          item.booking_id,
          item.reason,
        ].some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(query)
        );
      })
      .filter((item) => {
        if (dateFilter === "all") return true;

        const dates = [
          item.original_date,
          item.requested_date,
          ...(item.options ?? []).flatMap((option) =>
            option.appointment_date
              ? [option.appointment_date]
              : []
          ),
        ];

        return dates.some((date) =>
          dateFilter === "today"
            ? date === today
            : date >= today && date <= weekEnd
        );
      })
      .sort((a, b) =>
        String(b.created_at).localeCompare(
          String(a.created_at)
        )
      );
  }, [
    requests,
    tab,
    search,
    dateFilter,
    today,
    weekEnd,
  ]);

  const matchingBookings = eligibleBookings.filter(
    (item) =>
      [
        item.customer_name,
        item.service_name,
        item.worker_name,
        item.booking_date,
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(bookingSearch.trim().toLowerCase())
      )
  );

  // ----------------------------------------------------------
  // OPEN PROPOSAL
  // ----------------------------------------------------------

  const openProposal = () => {
    if (busy) return;

    setSuccess("");
    setModalError("");
    setBookings([]);
    setDraft({ ...EMPTY_DRAFT });
    setBookingSearch("");
    setUncertain(false);
    setProposalOpen(true);
  };

  const selectBooking = (
    selected: EligibleRescheduleBooking
  ) => {
    setDraft({
      ...EMPTY_DRAFT,
      bookingId: selected.id,
      otherDate: addDays(
        selected.booking_date,
        1
      ),
    });

    setModalError("");
  };

  const refreshProposal = () => {
    if (busy) return;

    // Keep uncertain submissions blocked until
    // the operator checks request status.
    if (uncertain) {
      setProposalOpen(false);
      setReload((value) => value + 1);
      return;
    }

    setModalError("");
    setProposalReload((value) => value + 1);
    setAvailabilityReload((value) => value + 1);
  };

  // ----------------------------------------------------------
  // SUBMIT THREE RECOVERY OPTIONS
  // ----------------------------------------------------------

  const submitProposal = async () => {
    if (busy || uncertain) return;

    setModalError("");

    if (!booking) {
      setModalError(
        "Select an eligible booking first."
      );
      return;
    }

    if (!isEligible(booking, now)) {
      setModalError(
        "This booking is no longer eligible."
      );
      return;
    }

    if (!originalWorker?.is_active) {
      setModalError(
        "The original worker must be active for the same-worker recovery option."
      );
      return;
    }

    if (!replacementWorker || !sameTime || !replacementTime) {
      setModalError(
        "Choose valid times for both appointment alternatives."
      );
      return;
    }

    if (
      !validDate(draft.otherDate) ||
      draft.otherDate === booking.booking_date ||
      draft.otherDate < today
    ) {
      setModalError(
        "Select a different future date for the original worker."
      );
      return;
    }

    const reason = draft.reason.trim();

    if (reason.length < 3 || reason.length > 1000) {
      setModalError(
        "Enter a reason between 3 and 1000 characters."
      );
      return;
    }

    mutation.current = true;
    setBusy(true);

    try {
      const response =
        await createWorkerUnavailabilityRequest({
          booking_id: booking.id,
          reason,
          options: [
            {
              option_type: "cancel_booking",
            },
            {
              option_type: "same_worker_other_day",
              worker_id: booking.worker_id,
              appointment_date: draft.otherDate,
              start_time: sameTime.start,
              end_time: sameTime.end,
            },
            {
              option_type: "other_worker_same_day",
              worker_id: replacementWorker.id,
              appointment_date: booking.booking_date,
              start_time: replacementTime.start,
              end_time: replacementTime.end,
            },
          ],
        });

      if (!mounted.current) return;

      setProposalOpen(false);
      setTab("awaiting");
      setSuccess(
        response.message ||
          "Three recovery options sent to the customer."
      );

      setReload((value) => value + 1);
    } catch (error: unknown) {
      if (!mounted.current) return;

      setModalError(errorText(error));

      if (
        error instanceof ReschedulingApiError &&
        error.outcomeUnknown
      ) {
        setUncertain(true);
      }
    } finally {
      mutation.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  // ----------------------------------------------------------
  // APPROVE / DECLINE / WITHDRAW
  // ----------------------------------------------------------

  const openDecision = (
    request: RescheduleRequest,
    action: DecisionAction
  ) => {
    setDetails(null);
    setDecision({ request, action });
    setDecisionReason("");
    setModalError("");
    setUncertain(false);
  };

  const submitDecision = async () => {
    if (!decision || busy || uncertain) return;

    mutation.current = true;
    setBusy(true);
    setModalError("");

    try {
      let response;

      if (decision.action === "approve") {
        response = await approveRescheduleRequest(
          decision.request.id
        );
      } else if (decision.action === "decline") {
        response = await declineRescheduleRequest(
          decision.request.id,
          decisionReason
        );
      } else {
        response = await withdrawRescheduleRequest(
          decision.request.id
        );
      }

      if (!mounted.current) return;

      setDecision(null);
      setSuccess(response.message);
      setReload((value) => value + 1);
    } catch (error: unknown) {
      if (!mounted.current) return;

      setModalError(errorText(error));

      if (
        error instanceof ReschedulingApiError &&
        error.outcomeUnknown
      ) {
        setUncertain(true);
      }
    } finally {
      mutation.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  const activeTab = TABS.find(
    (item) => item.key === tab
  )!;

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "left", "right"]}
    >
      {/* HEADER */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          disabled={busy}
          style={styles.iconButton}
        >
          <ArrowLeft
            size={20}
            color={COLORS.text}
          />
        </Pressable>

        <View style={styles.flex}>
          <Text style={styles.eyebrow}>
            APPOINTMENTS
          </Text>
          <Text style={styles.headerTitle}>
            Rescheduling
          </Text>
        </View>

        <Pressable
          disabled={busy || loading}
          onPress={() =>
            setReload((value) => value + 1)
          }
          style={styles.iconButton}
        >
          {loading ? (
            <ActivityIndicator color={GOLD} />
          ) : (
            <RefreshCw
              size={19}
              color={GOLD}
            />
          )}
        </Pressable>
      </View>

      <FlatList
        data={visibleRequests}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshing={loading}
        onRefresh={() => {
          if (!busy) {
            setReload((value) => value + 1);
          }
        }}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Math.max(
              28,
              insets.bottom + 20
            ),
          },
        ]}
        ListHeaderComponent={
          <View>
            {/* HERO */}
            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <View style={styles.heroIcon}>
                  <CalendarClock
                    size={25}
                    color={GOLD}
                  />
                </View>

                <View style={styles.heroBadge}>
                  <ShieldCheck
                    size={13}
                    color={GOLD}
                  />
                  <Text style={styles.heroBadgeText}>
                    APPOINTMENT CONTROL
                  </Text>
                </View>
              </View>

              <Text style={styles.heroTitle}>
                Rescheduling
                {"\n"}
                <Text style={{ color: GOLD }}>
                  Made Simple.
                </Text>
              </Text>

              <Text style={styles.heroDescription}>
                Review customer requests and manage
                professional unavailability with
                customer-friendly recovery options.
              </Text>
            </View>

            <Notice text={error} />
            <Notice text={success} success />

            {/* POLICY */}
            <View style={styles.policy}>
              <Clock3 size={18} color={GOLD} />
              <Text style={styles.policyText}>
                Appointment changes follow the backend's
                24-hour eligibility policy. Existing
                bookings remain unchanged while a
                rescheduling request is pending.
              </Text>
            </View>

            {/* NEW PROPOSAL ACTION */}
            <Pressable
              disabled={busy}
              onPress={openProposal}
              style={({ pressed }) => [
                styles.proposalCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.proposalIcon}>
                <ShieldAlert
                  size={24}
                  color={GOLD}
                />
              </View>

              <View style={styles.flex}>
                <Text style={styles.proposalTitle}>
                  Worker Unavailable?
                </Text>
                <Text style={styles.proposalDescription}>
                  Send three recovery options to the customer.
                </Text>
              </View>

              <View style={styles.proposalArrow}>
                <Plus size={19} color={BG} />
              </View>
            </Pressable>

            {/* STATS */}
            <View style={styles.stats}>
              {TABS.map((item) => {
                const count = counts[item.key];
                const active = tab === item.key;

                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setTab(item.key)}
                    style={[
                      styles.stat,
                      active && styles.statActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statValue,
                        active && { color: GOLD },
                      ]}
                    >
                      {count}
                    </Text>

                    <Text
                      style={[
                        styles.statLabel,
                        active && { color: GOLD },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* SECTION */}
            <View style={styles.sectionHeader}>
              <View style={styles.flex}>
                <Text style={styles.sectionEyebrow}>
                  REQUEST MANAGEMENT
                </Text>
                <Text style={styles.sectionTitle}>
                  {activeTab.label}
                </Text>
                <Text style={styles.sectionDescription}>
                  {activeTab.description}
                </Text>
              </View>

              <View style={styles.countBadge}>
                <Text style={styles.countText}>
                  {visibleRequests.length}
                </Text>
              </View>
            </View>

            {/* SEARCH */}
            <View style={styles.search}>
              <Search size={17} color={MUTED} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
                placeholder="Search customer, service or booking..."
                placeholderTextColor={COLORS.textMuted}
              />
              {!!search && (
                <Pressable onPress={() => setSearch("")}>
                  <X size={17} color={MUTED} />
                </Pressable>
              )}
            </View>

            {/* DATE FILTER */}
            <View style={styles.dateFilters}>
              {(
                [
                  ["all", "All Dates"],
                  ["today", "Today"],
                  ["week", "This Week"],
                ] as const
              ).map(([key, label]) => (
                <Chip
                  key={key}
                  title={label}
                  selected={dateFilter === key}
                  onPress={() => setDateFilter(key)}
                />
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading ? (
              <ActivityIndicator
                size="large"
                color={GOLD}
              />
            ) : error ? (
              <>
                <AlertCircle
                  size={30}
                  color={ERROR}
                />
                <Text style={styles.emptyTitle}>
                  Unable to Load Requests
                </Text>
                <Button
                  title="Retry"
                  primary
                  onPress={() =>
                    setReload((value) => value + 1)
                  }
                />
              </>
            ) : (
              <>
                <CalendarClock
                  size={29}
                  color={GOLD}
                />
                <Text style={styles.emptyTitle}>
                  No Matching Requests
                </Text>
                <Text style={styles.mutedCenter}>
                  There are no requests matching your
                  selected category, dates and search.
                </Text>
              </>
            )}
          </View>
        }
        ItemSeparatorComponent={() => (
          <View style={{ height: 10 }} />
        )}
        renderItem={({ item }) => {
          const canApprove =
            item.status === "pending" &&
            item.requested_by === "customer" &&
            item.request_kind === "appointment_change" &&
            item.booking_status === "confirmed" &&
            appointmentTimestamp(
              item.original_date,
              item.original_start_time
            ) > now;

          const canDecline =
            item.status === "pending" &&
            item.requested_by === "customer";

          const canWithdraw =
            item.status === "pending" &&
            item.requested_by === "barber";

          const color = statusColor(item);

          return (
            <View style={styles.requestCard}>
              <View style={styles.requestTop}>
                <View style={styles.avatar}>
                  <UserRound
                    size={20}
                    color={GOLD}
                  />
                </View>

                <View style={styles.flex}>
                  <Text style={styles.customerName}>
                    {item.customer_name}
                  </Text>

                  <Text style={styles.muted}>
                    {item.service_name}
                  </Text>
                </View>

                <View
                  style={[
                    styles.statusBadge,
                    { borderColor: color },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      { color },
                    ]}
                  >
                    {statusLabel(item)}
                  </Text>
                </View>
              </View>

              <View style={styles.appointmentBox}>
                <Detail
                  label="CURRENT APPOINTMENT"
                  value={
                    `${formatDate(item.original_date)} · ` +
                    formatTime(item.original_start_time)
                  }
                />

                <View style={styles.changeArrow}>
                  <ArrowRight
                    size={18}
                    color={GOLD}
                  />
                </View>

                <Detail
                  label={
                    item.request_kind === "worker_unavailability"
                      ? "RECOVERY PROPOSAL"
                      : "REQUESTED APPOINTMENT"
                  }
                  value={
                    item.request_kind === "worker_unavailability"
                      ? "Three customer recovery options"
                      : `${formatDate(
                          item.requested_date
                        )} · ${formatTime(
                          item.requested_start_time
                        )}`
                  }
                />
              </View>

              {!!item.reason && (
                <Text
                  numberOfLines={2}
                  style={styles.reasonText}
                >
                  {item.reason}
                </Text>
              )}

              <View style={styles.buttonRow}>
                <Button
                  title="Details"
                  onPress={() => setDetails(item)}
                />

                {canDecline && (
                  <Button
                    title="Decline"
                    danger
                    disabled={busy}
                    onPress={() =>
                      openDecision(item, "decline")
                    }
                  />
                )}

                {canApprove && (
                  <Button
                    title="Approve"
                    primary
                    disabled={busy}
                    onPress={() =>
                      openDecision(item, "approve")
                    }
                  />
                )}

                {canWithdraw && (
                  <Button
                    title="Withdraw"
                    danger
                    disabled={busy}
                    onPress={() =>
                      openDecision(item, "withdraw")
                    }
                  />
                )}
              </View>
            </View>
          );
        }}
      />

      {/* ======================================================
          PROPOSAL MODAL
      ====================================================== */}
      {proposalOpen && (
        <Sheet
          title="Worker Unavailable"
          locked={busy}
          onClose={() => setProposalOpen(false)}
        >
          <View style={styles.modalIntro}>
            <ShieldAlert size={22} color={GOLD} />
            <Text style={styles.modalIntroText}>
              Offer cancellation, the same professional on
              another day, or a replacement professional
              on the original day.
            </Text>
          </View>

          <Notice text={modalError} />

          {uncertain && (
            <Notice
              text="The previous submission may have succeeded. Close this form and check the request list before trying again."
            />
          )}

          <Button
            title="Refresh Eligibility"
            disabled={busy || proposalLoading}
            loading={proposalLoading}
            onPress={refreshProposal}
          />

          <Text style={styles.label}>
            SELECT ELIGIBLE BOOKING
          </Text>

          <View style={styles.search}>
            <Search size={16} color={MUTED} />
            <TextInput
              value={bookingSearch}
              onChangeText={setBookingSearch}
              style={styles.searchInput}
              placeholder="Search eligible bookings..."
              placeholderTextColor={COLORS.textMuted}
            />
          </View>

          {proposalLoading ? (
            <ActivityIndicator
              color={GOLD}
              style={styles.loader}
            />
          ) : matchingBookings.length === 0 ? (
            <View style={styles.inlineEmpty}>
              <Text style={styles.mutedCenter}>
                No eligible bookings are available.
                Check the confirmation window,
                appointment status and pending requests.
              </Text>
            </View>
          ) : (
            <View style={styles.bookingList}>
              {matchingBookings.map((item) => {
                const selected =
                  draft.bookingId === item.id;

                return (
                  <Pressable
                    key={item.id}
                    disabled={busy}
                    onPress={() => selectBooking(item)}
                    style={[
                      styles.bookingOption,
                      selected && styles.bookingOptionActive,
                    ]}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.customerName}>
                        {item.customer_name}
                      </Text>
                      <Text style={styles.muted}>
                        {item.service_name}
                      </Text>
                      <Text style={styles.goldText}>
                        {formatDate(item.booking_date)}
                        {" · "}
                        {formatTime(item.start_time)}
                      </Text>
                    </View>

                    {selected && (
                      <CheckCircle2
                        size={20}
                        color={GOLD}
                      />
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {booking && (
            <>
              <View style={styles.selectionSummary}>
                <Text style={styles.label}>
                  SELECTED APPOINTMENT
                </Text>

                <Detail
                  label="Customer"
                  value={booking.customer_name}
                />
                <Detail
                  label="Service"
                  value={booking.service_name}
                />
                <Detail
                  label="Professional"
                  value={booking.worker_name}
                />
                <Detail
                  label="Current Date & Time"
                  value={
                    `${formatDate(booking.booking_date)} · ` +
                    formatTime(booking.start_time)
                  }
                />
                <Detail
                  label="Eligibility Deadline"
                  value={formatTimestamp(
                    booking.reschedule_deadline
                  )}
                />
              </View>

              <Text style={styles.label}>
                REASON FOR UNAVAILABILITY
              </Text>

              <TextInput
                value={draft.reason}
                onChangeText={(reason) =>
                  setDraft((current) => ({
                    ...current,
                    reason,
                  }))
                }
                maxLength={1000}
                editable={!busy}
                multiline
                textAlignVertical="top"
                placeholder="Explain why the professional is unavailable..."
                placeholderTextColor={COLORS.textMuted}
                style={[styles.input, styles.textarea]}
              />

              {/* OPTION 1 */}
              <View style={styles.optionPanel}>
                <View style={styles.optionHeader}>
                  <View style={styles.optionNumber}>
                    <Text style={styles.optionNumberText}>
                      01
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.optionTitle}>
                      Cancel Appointment
                    </Text>
                    <Text style={styles.muted}>
                      Customer can choose cancellation.
                      The booking is not cancelled by
                      simply sending this proposal.
                    </Text>
                  </View>
                </View>
              </View>

              {/* OPTION 2 */}
              <View style={styles.optionPanel}>
                <View style={styles.optionHeader}>
                  <View style={styles.optionNumber}>
                    <Text style={styles.optionNumberText}>
                      02
                    </Text>
                  </View>

                  <View style={styles.flex}>
                    <Text style={styles.optionTitle}>
                      Another Day · Same Worker
                    </Text>
                    <Text style={styles.muted}>
                      {originalWorker?.full_name ||
                        booking.worker_name ||
                        "Assigned professional"}
                    </Text>
                  </View>
                </View>

                <Text style={styles.label}>
                  SELECT ANOTHER DATE
                </Text>

                <View style={styles.chips}>
                  {Array.from(
                    { length: 7 },
                    (_, index) =>
                      addDays(indiaDate(now), index)
                  )
                    .filter(
                      (day) =>
                        day !== booking.booking_date
                    )
                    .map((day) => (
                      <Chip
                        key={day}
                        title={formatDate(day)}
                        selected={
                          draft.otherDate === day
                        }
                        disabled={busy}
                        onPress={() =>
                          setDraft((current) => ({
                            ...current,
                            otherDate: day,
                            sameWorkerStart: "",
                          }))
                        }
                      />
                    ))}
                </View>

                {!originalWorker?.is_active ? (
                  <Notice
                    text="The original worker is inactive. A valid same-worker alternative is required."
                  />
                ) : (
                  <TimeChoices
                    title="AVAILABLE TIMES"
                    availability={sameAvailability}
                    selected={draft.sameWorkerStart}
                    disabled={busy}
                    onSelect={(sameWorkerStart) =>
                      setDraft((current) => ({
                        ...current,
                        sameWorkerStart,
                      }))
                    }
                  />
                )}
              </View>

              {/* OPTION 3 */}
              <View style={styles.optionPanel}>
                <View style={styles.optionHeader}>
                  <View style={styles.optionNumber}>
                    <Text style={styles.optionNumberText}>
                      03
                    </Text>
                  </View>

                  <View style={styles.flex}>
                    <Text style={styles.optionTitle}>
                      Same Day · Another Worker
                    </Text>
                    <Text style={styles.muted}>
                      {formatDate(booking.booking_date)}
                    </Text>
                  </View>
                </View>

                <Text style={styles.label}>
                  REPLACEMENT PROFESSIONAL
                </Text>

                <View style={styles.chips}>
                  {replacementWorkers.map((worker) => (
                    <Chip
                      key={worker.id}
                      title={worker.full_name}
                      selected={
                        draft.replacementWorkerId ===
                        worker.id
                      }
                      disabled={busy}
                      onPress={() =>
                        setDraft((current) => ({
                          ...current,
                          replacementWorkerId: worker.id,
                          replacementStart: "",
                        }))
                      }
                    />
                  ))}
                </View>

                {replacementWorkers.length === 0 && (
                  <Notice
                    text="No other active worker is available. The current three-option API requires a replacement-worker alternative."
                  />
                )}

                <TimeChoices
                  title="AVAILABLE TIMES"
                  availability={replacementAvailability}
                  selected={draft.replacementStart}
                  disabled={busy}
                  onSelect={(replacementStart) =>
                    setDraft((current) => ({
                      ...current,
                      replacementStart,
                    }))
                  }
                />
              </View>

              <View style={styles.policy}>
                <ShieldCheck size={17} color={GOLD} />
                <Text style={styles.policyText}>
                  The backend performs final eligibility
                  and availability validation before
                  accepting this request.
                </Text>
              </View>

              <View style={styles.buttonRow}>
                <Button
                  title="Close"
                  disabled={busy}
                  onPress={() => setProposalOpen(false)}
                />

                <Button
                  title={
                    busy
                      ? "Submitting..."
                      : "Send Three Options"
                  }
                  primary
                  loading={busy}
                  disabled={
                    busy ||
                    uncertain ||
                    proposalLoading ||
                    Boolean(modalError) ||
                    !booking ||
                    !sameTime ||
                    !replacementTime ||
                    !replacementWorker ||
                    !originalWorker?.is_active
                  }
                  onPress={() => void submitProposal()}
                />
              </View>
            </>
          )}
        </Sheet>
      )}

      {/* ======================================================
          REQUEST DETAILS
      ====================================================== */}
      {details && (
        <Sheet
          title="Request Details"
          onClose={() => setDetails(null)}
        >
          <Detail
            label="Customer"
            value={details.customer_name}
          />
          <Detail
            label="Phone"
            value={details.customer_phone}
          />
          <Detail
            label="Service"
            value={details.service_name}
          />
          <Detail
            label="Status"
            value={statusLabel(details)}
          />
          <Detail
            label="Requested By"
            value={details.requested_by}
          />
          <Detail
            label="Booking Reference"
            value={details.booking_id}
          />
          <Detail
            label="Original Appointment"
            value={
              `${formatDate(details.original_date)} · ` +
              formatTime(details.original_start_time)
            }
          />

          {details.request_kind === "appointment_change" ? (
            <Detail
              label="Requested Appointment"
              value={
                `${formatDate(details.requested_date)} · ` +
                formatTime(details.requested_start_time)
              }
            />
          ) : (
            <>
              <Text style={styles.sectionTitle}>
                Customer Recovery Options
              </Text>

              {(details.options || []).map(
                (option, index) => (
                  <View
                    key={option.id}
                    style={styles.optionPanel}
                  >
                    <Text style={styles.optionTitle}>
                      {index + 1}.{" "}
                      {option.option_type === "cancel_booking"
                        ? "Cancel Appointment"
                        : option.option_type ===
                          "same_worker_other_day"
                        ? "Another Day · Same Worker"
                        : "Same Day · Another Worker"}
                    </Text>

                    {!!option.appointment_date && (
                      <Text style={styles.muted}>
                        {formatDate(
                          option.appointment_date
                        )}
                        {" · "}
                        {formatTime(
                          option.start_time
                        )}
                      </Text>
                    )}
                  </View>
                )
              )}
            </>
          )}

          {!!details.reason && (
            <Detail
              label="Reason"
              value={details.reason}
            />
          )}

          <Detail
            label="Created"
            value={formatTimestamp(
              details.created_at
            )}
          />

          <Button
            title="Close Details"
            primary
            onPress={() => setDetails(null)}
          />
        </Sheet>
      )}

      {/* ======================================================
          DECISION
      ====================================================== */}
      {decision && (
        <Sheet
          title={
            decision.action === "approve"
              ? "Approve Rescheduling"
              : decision.action === "decline"
              ? "Decline Request"
              : "Withdraw Proposal"
          }
          locked={busy}
          onClose={() => setDecision(null)}
        >
          <Notice text={modalError} />

          {uncertain && (
            <Notice
              text="The outcome is uncertain. Close this dialog and refresh the request list before retrying."
            />
          )}

          <Detail
            label="Customer"
            value={decision.request.customer_name}
          />

          <Detail
            label="Service"
            value={decision.request.service_name}
          />

          <Detail
            label="Current Appointment"
            value={
              `${formatDate(
                decision.request.original_date
              )} · ${formatTime(
                decision.request.original_start_time
              )}`
            }
          />

          {decision.action === "decline" && (
            <>
              <Text style={styles.label}>
                DECLINE REASON (OPTIONAL)
              </Text>

              <TextInput
                value={decisionReason}
                onChangeText={setDecisionReason}
                editable={!busy}
                multiline
                maxLength={1000}
                textAlignVertical="top"
                placeholder="Explain the reason for declining..."
                placeholderTextColor={COLORS.textMuted}
                style={[styles.input, styles.textarea]}
              />
            </>
          )}

          <View style={styles.buttonRow}>
            <Button
              title="Cancel"
              disabled={busy}
              onPress={() => setDecision(null)}
            />

            <Button
              title={
                busy
                  ? "Processing..."
                  : decision.action === "approve"
                  ? "Approve"
                  : decision.action === "decline"
                  ? "Decline"
                  : "Withdraw"
              }
              primary={decision.action === "approve"}
              danger={decision.action !== "approve"}
              disabled={busy || uncertain}
              loading={busy}
              onPress={() => void submitDecision()}
            />
          </View>
        </Sheet>
      )}
    </SafeAreaView>
  );
}

// ============================================================
// STYLES
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
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  iconButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
  },
  eyebrow: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 4,
  },
  content: {
    paddingHorizontal: 15,
    paddingTop: 15,
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
  },
  hero: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 21,
    padding: 19,
    marginBottom: 14,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  heroIcon: {
    width: 49,
    height: 49,
    borderRadius: 15,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: GOLD_SOFT,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },
  heroBadgeText: {
    color: GOLD,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  heroTitle: {
    color: COLORS.text,
    fontSize: 29,
    fontWeight: "900",
    lineHeight: 38,
    marginTop: 22,
    letterSpacing: -0.7,
  },
  heroDescription: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 21,
    marginTop: 10,
  },
  policy: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    backgroundColor: GOLD_SOFT,
    borderRadius: 12,
    padding: 13,
    marginBottom: 14,
  },
  policyText: {
    flex: 1,
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
  },
  proposalCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 15,
    padding: 13,
    minHeight: 92,
    marginBottom: 15,
  },
  proposalIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: GOLD_SOFT,
  },
  proposalTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "900",
  },
  proposalDescription: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
  },
  proposalArrow: {
    width: 33,
    height: 33,
    borderRadius: 10,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 23,
  },
  stat: {
    width: "48.5%",
    minHeight: 88,
    padding: 14,
    backgroundColor: SURFACE,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: BORDER,
    justifyContent: "center",
  },
  statActive: {
    borderColor: GOLD,
    backgroundColor: GOLD_SOFT,
  },
  statValue: {
    color: COLORS.text,
    fontSize: 25,
    fontWeight: "900",
  },
  statLabel: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  sectionEyebrow: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 5,
  },
  sectionDescription: {
    color: MUTED,
    fontSize: 11,
    marginTop: 6,
  },
  countBadge: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: LIGHT,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  countText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
  },
  search: {
    minHeight: 47,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    backgroundColor: SURFACE,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 12,
    minWidth: 0,
  },
  dateFilters: {
    flexDirection: "row",
    gap: 7,
    flexWrap: "wrap",
    marginBottom: 16,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: DARK,
  },
  chipActive: {
    borderColor: GOLD,
    backgroundColor: GOLD_SOFT,
  },
  chipText: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "800",
  },
  chipTextActive: {
    color: GOLD,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  requestCard: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 14,
  },
  requestTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 13,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },
  customerName: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "900",
  },
  muted: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
    marginTop: 3,
  },
  mutedCenter: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
    textAlign: "center",
  },
  goldText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: DARK,
    borderWidth: 1,
    maxWidth: 115,
  },
  statusText: {
    fontSize: 9,
    fontWeight: "900",
    textAlign: "center",
  },
  appointmentBox: {
    backgroundColor: DARK,
    padding: 11,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: BORDER,
  },
  detail: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  detailLabel: {
    color: MUTED,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  detailValue: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 19,
  },
  changeArrow: {
    alignItems: "center",
    paddingVertical: 6,
  },
  reasonText: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 12,
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 13,
  },
  button: {
    flexGrow: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: LIGHT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 11,
    paddingVertical: 11,
    flexDirection: "row",
    gap: 7,
  },
  buttonPrimary: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  buttonDanger: {
    borderColor: "rgba(239,68,68,0.50)",
    backgroundColor: "rgba(239,68,68,0.07)",
  },
  buttonText: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  buttonPrimaryText: {
    color: BG,
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderWidth: 1,
    borderRadius: 11,
    padding: 12,
    backgroundColor: DARK,
    marginBottom: 12,
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 19,
  },
  empty: {
    padding: 25,
    minHeight: 200,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.86)",
    paddingHorizontal: 14,
  },
  sheet: {
    maxHeight: "94%",
    width: "100%",
    maxWidth: 650,
    alignSelf: "center",
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 19,
    overflow: "hidden",
  },
  sheetHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sheetEyebrow: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  sheetTitle: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 5,
  },
  sheetBody: {
    padding: 16,
    paddingBottom: 35,
  },
  modalIntro: {
    flexDirection: "row",
    gap: 11,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  modalIntroText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 19,
    color: MUTED,
  },
  label: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 9,
  },
  field: {
    marginBottom: 13,
  },
  input: {
    color: COLORS.text,
    fontSize: 12,
    minHeight: 46,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  textarea: {
    minHeight: 95,
    textAlignVertical: "top",
  },
  loader: {
    marginVertical: 24,
  },
  inlineLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 13,
  },
  inlineEmpty: {
    padding: 17,
    borderRadius: 11,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
    marginVertical: 10,
  },
  bookingList: {
    gap: 9,
    marginTop: 5,
  },
  bookingOption: {
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: DARK,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  bookingOptionActive: {
    borderColor: GOLD,
    backgroundColor: GOLD_SOFT,
  },
  selectionSummary: {
    padding: 13,
    borderRadius: 12,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    marginTop: 15,
  },
  optionPanel: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 13,
    padding: 14,
    marginTop: 13,
    backgroundColor: DARK,
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  optionNumber: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
  },
  optionNumberText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
  },
  optionTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 6,
  },
  disabled: {
    opacity: 0.42,
  },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
});
