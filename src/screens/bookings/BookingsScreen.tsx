
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Eye,
  RefreshCw,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react-native";

import { COLORS } from "../../constants/colors";

import {
  acceptBarberBooking,
  BookingApiError,
  cancelBarberBooking,
  completeBarberBooking,
  getBarberBookingById,
  getBarberBookings,
  rejectBarberBooking,
  type BarberBooking,
  type BookingActionResponse,
  type BookingHairstyleSelection,
  type BookingStatus,
} from "../../services/bookingApi";

// ============================================================
// TYPES
// ============================================================

type Props = {
  onBack: () => void;
};

type Category =
  | "total"
  | "upcoming"
  | "completed"
  | "cancelled";

type DateFilter =
  | "all"
  | "today"
  | "tomorrow"
  | "week";

type ActionType =
  | "accept"
  | "reject"
  | "complete"
  | "cancel";

type BookingAction = {
  booking: BarberBooking;
  type: ActionType;
};

type SummaryCard = {
  key: Category;
  title: string;
  subtitle: string;
  icon: LucideIcon;
};

// ============================================================
// THEME
// ============================================================

const C = COLORS;

const GOLD = C.primary;
const BG = C.background;
const SURFACE = C.surface;
const DARK = C.surfaceDark;
const LIGHT = C.surfaceLight;
const BORDER = C.border;
const SUCCESS = C.success;
const ERROR = C.error;
const MUTED = C.textSecondary;

const GOLD_SOFT = "rgba(245,158,11,0.09)";
const GOLD_BORDER = "rgba(245,158,11,0.32)";
const WHITE_SOFT = "rgba(255,255,255,0.04)";

const CUSTOMER_WEB_URL = String(
  process.env.EXPO_PUBLIC_CUSTOMER_WEB_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const SUMMARY_CARDS: SummaryCard[] = [
  {
    key: "total",
    title: "Total Bookings",
    subtitle: "All appointments",
    icon: CalendarDays,
  },
  {
    key: "upcoming",
    title: "Upcoming",
    subtitle: "Confirmed visits",
    icon: CalendarClock,
  },
  {
    key: "completed",
    title: "Completed",
    subtitle: "Finished services",
    icon: CheckCircle2,
  },
  {
    key: "cancelled",
    title: "Cancelled",
    subtitle: "Cancelled / rejected",
    icon: XCircle,
  },
];

const DATE_FILTERS: {
  key: DateFilter;
  label: string;
}[] = [
  { key: "all", label: "All Dates" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "Next 7 Days" },
];

// ============================================================
// DATE HELPERS
// ============================================================

function localDate(offset = 0): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(
    new Date(Date.now() + offset * 86400000)
  );

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function formatDate(
  value?: string | null
): string {
  if (!value) return "Date unavailable";

  const day = value.slice(0, 10);

  if (day === localDate()) return "Today";
  if (day === localDate(1)) return "Tomorrow";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return value;
  }

  const date = new Date(`${day}T12:00:00Z`);

  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(
  value?: string | null
): string {
  if (!value) return "Time unavailable";

  const match =
    /^(\d{1,2}):(\d{2})/.exec(value);

  if (!match) return value;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return value;
  }

  return (
    `${hour % 12 || 12}:` +
    `${String(minute).padStart(2, "0")} ` +
    `${hour >= 12 ? "PM" : "AM"}`
  );
}

function formatPrice(
  value: string | number
): string {
  const amount = Number(value);

  return Number.isFinite(amount)
    ? `₹${amount.toLocaleString("en-IN", {
        maximumFractionDigits: 2,
      })}`
    : "Unavailable";
}

function formatDuration(
  value: number
): string {
  if (!Number.isFinite(value)) return "—";

  if (value >= 60 && value % 60 === 0) {
    return `${value / 60} hr`;
  }

  return `${value} min`;
}

// ============================================================
// DISPLAY HELPERS
// ============================================================

function initials(
  name?: string | null
): string {
  return (
    String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "C"
  );
}

function statusLabel(
  status: BookingStatus
): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "confirmed":
      return "Confirmed";
    case "completed":
      return "Completed";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    default:
      return String(status);
  }
}

function statusColor(
  status: BookingStatus
): string {
  if (status === "pending") return GOLD;
  if (status === "completed") return SUCCESS;
  if (status === "confirmed") return "#60A5FA";
  return ERROR;
}

function matchesCategory(
  category: Category,
  status: BookingStatus
): boolean {
  if (category === "total") return true;

  if (category === "upcoming") {
    return status === "confirmed";
  }

  if (category === "completed") {
    return status === "completed";
  }

  return (
    status === "cancelled" ||
    status === "rejected"
  );
}

function matchesDate(
  value: string,
  filter: DateFilter
): boolean {
  if (filter === "all") return true;

  const date = String(value || "").slice(0, 10);

  if (filter === "today") {
    return date === localDate();
  }

  if (filter === "tomorrow") {
    return date === localDate(1);
  }

  return (
    date >= localDate() &&
    date <= localDate(6)
  );
}

function sortNewest(
  a: BarberBooking,
  b: BarberBooking
): number {
  const aTime = Date.parse(a.created_at || "");
  const bTime = Date.parse(b.created_at || "");

  if (
    Number.isFinite(aTime) &&
    Number.isFinite(bTime)
  ) {
    return bTime - aTime;
  }

  return String(b.id).localeCompare(String(a.id));
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

function actionTitle(type: ActionType): string {
  switch (type) {
    case "accept":
      return "Accept Booking";
    case "reject":
      return "Reject Booking";
    case "complete":
      return "Complete Booking";
    case "cancel":
      return "Cancel Booking";
  }
}

function hasSavedHairstyle(
  booking: BarberBooking
): boolean {
  return (
    booking.has_hairstyle_selection === true ||
    Boolean(booking.hairstyle_selection) ||
    Boolean(booking.hairstyle_name)
  );
}

// ============================================================
// HAIRSTYLE IMAGE HELPERS
// ============================================================

function resolveImage(
  value?: string | null
): string {
  const source = String(value || "").trim();

  if (!source) return "";

  if (/^https?:\/\//i.test(source)) {
    return source;
  }

  if (
    /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(
      source
    )
  ) {
    return source.replace(/\s/g, "");
  }

  const compact = source.replace(/\s/g, "");

  if (compact.startsWith("/9j/")) {
    return `data:image/jpeg;base64,${compact}`;
  }

  if (compact.startsWith("iVBORw0KGgo")) {
    return `data:image/png;base64,${compact}`;
  }

  if (compact.startsWith("UklGR")) {
    return `data:image/webp;base64,${compact}`;
  }

  try {
    const base = new URL(CUSTOMER_WEB_URL);

    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password
    ) {
      return "";
    }

    if (source.startsWith("//")) {
      return `${base.protocol}${source}`;
    }

    if (/^[a-z][a-z\d+.-]*:/i.test(source)) {
      return "";
    }

    const path = source
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "");

    return new URL(
      path,
      `${CUSTOMER_WEB_URL}/`
    ).href;
  } catch {
    return "";
  }
}

// ============================================================
// SHARED PREMIUM COMPONENTS
// ============================================================

function StatusBadge({
  status,
}: {
  status: BookingStatus;
}) {
  const color = statusColor(status);

  return (
    <View
      style={[
        styles.statusBadge,
        {
          borderColor: `${color}55`,
          backgroundColor: `${color}13`,
        },
      ]}
    >
      <View
        style={[
          styles.statusDot,
          { backgroundColor: color },
        ]}
      />

      <Text
        style={[
          styles.statusText,
          { color },
        ]}
      >
        {statusLabel(status)}
      </Text>
    </View>
  );
}

function ActionButton({
  title,
  onPress,
  primary = false,
  danger = false,
  disabled = false,
  loading = false,
  icon: Icon,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
}) {
  const color = primary
    ? BG
    : danger
    ? ERROR
    : GOLD;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{
        disabled,
        busy: loading,
      }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        primary && styles.actionPrimary,
        danger && styles.actionDanger,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={color}
        />
      ) : Icon ? (
        <Icon size={15} color={color} />
      ) : null}

      <Text
        style={[
          styles.actionButtonText,
          primary && styles.actionPrimaryText,
          danger && styles.actionDangerText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>
        {label}
      </Text>

      <Text
        selectable
        style={styles.detailValue}
      >
        {value === null ||
        value === undefined ||
        value === ""
          ? "Not provided"
          : String(value)}
      </Text>
    </View>
  );
}

function Message({
  text,
  success = false,
}: {
  text: string;
  success?: boolean;
}) {
  if (!text) return null;

  const color = success ? SUCCESS : ERROR;

  return (
    <View
      style={[
        styles.message,
        { borderColor: `${color}60` },
      ]}
    >
      {success ? (
        <CheckCircle2
          color={color}
          size={18}
        />
      ) : (
        <XCircle
          color={color}
          size={18}
        />
      )}

      <Text
        style={[
          styles.messageText,
          { color },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

// ============================================================
// PREMIUM SUMMARY CARD
// ============================================================

function PremiumSummaryCard({
  card,
  count,
  active,
  onPress,
}: {
  card: SummaryCard;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  const Icon = card.icon;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.summaryCard,
        active && styles.summaryCardActive,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.summaryAccent,
          active && styles.summaryAccentActive,
        ]}
      />

      <View style={styles.summaryTop}>
        <View style={styles.summaryIcon}>
          <Icon
            size={20}
            color={active ? GOLD : MUTED}
          />
        </View>

        <ArrowRight
          size={15}
          color={active ? GOLD : C.textMuted}
        />
      </View>

      <Text
        style={[
          styles.summaryCount,
          active && { color: GOLD },
        ]}
      >
        {count}
      </Text>

      <Text style={styles.summaryTitle}>
        {card.title}
      </Text>

      <Text style={styles.summarySubtitle}>
        {card.subtitle}
      </Text>
    </Pressable>
  );
}

// ============================================================
// PREMIUM HAIRSTYLE PREVIEW
// ============================================================

function HairstyleImage({
  uri,
  title,
}: {
  uri: string;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(uri));

  useEffect(() => {
    setFailed(false);
    setLoading(Boolean(uri));
  }, [uri]);

  return (
    <View style={styles.hairstyleImageCard}>
      <View style={styles.hairstyleImageFrame}>
        {!uri || failed ? (
          <View style={styles.imageFallback}>
            <Scissors
              size={28}
              color={C.textMuted}
            />

            <Text style={styles.imageFallbackText}>
              Image unavailable
            </Text>
          </View>
        ) : (
          <>
            <Image
              source={{ uri }}
              style={styles.hairstyleImage}
              resizeMode="contain"
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onError={() => {
                setFailed(true);
                setLoading(false);
              }}
            />

            {loading && (
              <View style={styles.imageLoading}>
                <ActivityIndicator color={GOLD} />
              </View>
            )}
          </>
        )}
      </View>

      <Text style={styles.hairstyleImageTitle}>
        {title}
      </Text>
    </View>
  );
}

function HairstyleDetails({
  selection,
}: {
  selection: BookingHairstyleSelection;
}) {
  const [angle, setAngle] = useState<
    "front" | "left" | "right"
  >("front");

  const previews = Array.isArray(selection.previews)
    ? selection.previews.filter(
        (preview) =>
          preview &&
          ["front", "left", "right"].includes(
            preview.angle
          ) &&
          Boolean(preview.image)
      )
    : [];

  const selectedPreview = previews.find(
    (preview) => preview.angle === angle
  );

  const referenceImage = resolveImage(
    selection.reference_image
  );

  return (
    <View style={styles.hairstylePanel}>
      <View style={styles.sectionTitleRow}>
        <View style={styles.hairstyleHeaderIcon}>
          <Sparkles
            size={19}
            color={GOLD}
          />
        </View>

        <View style={styles.flex}>
          <Text style={styles.panelTitle}>
            Customer's Selected Look
          </Text>

          <Text style={styles.secondary}>
            Virtual hairstyle preview
          </Text>
        </View>
      </View>

      <Text style={styles.selectedStyleName}>
        {selection.hairstyle_name ||
          "Selected hairstyle"}
      </Text>

      {!!selection.face_shape && (
        <Text style={styles.secondary}>
          Face shape: {selection.face_shape}
        </Text>
      )}

      {referenceImage ? (
        <HairstyleImage
          uri={referenceImage}
          title="Style Reference"
        />
      ) : null}

      {previews.length > 0 && (
        <>
          <Text style={styles.miniHeading}>
            CAPTURED ANGLES
          </Text>

          <View style={styles.angleTabs}>
            {(
              [
                ["front", "Front"],
                ["left", "Left"],
                ["right", "Right"],
              ] as const
            ).map(([key, label]) => {
              const available = previews.some(
                (item) => item.angle === key
              );

              return (
                <Pressable
                  key={key}
                  disabled={!available}
                  onPress={() => setAngle(key)}
                  style={[
                    styles.angleTab,
                    angle === key &&
                      styles.angleTabActive,
                    !available && styles.disabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.angleTabText,
                      angle === key &&
                        styles.angleTabTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {selectedPreview ? (
            <HairstyleImage
              uri={resolveImage(
                selectedPreview.image
              )}
              title={`${angle.toUpperCase()} VIEW`}
            />
          ) : (
            <Text style={styles.secondary}>
              Select an available angle.
            </Text>
          )}
        </>
      )}

      {!!selection.style_analysis && (
        <View style={styles.analysisBox}>
          <Text style={styles.miniHeading}>
            STYLE ANALYSIS
          </Text>

          <Text
            selectable
            style={styles.analysisText}
          >
            {selection.style_analysis}
          </Text>
        </View>
      )}
    </View>
  );
}

// ============================================================
// FETCH HAIRSTYLE DETAILS ONLY WHEN NEEDED
// ============================================================

function BookingHairstylePanel({
  booking,
}: {
  booking: BarberBooking;
}) {
  const [selection, setSelection] =
    useState<BookingHairstyleSelection | null>(
      booking.hairstyle_selection || null
    );

  const [loading, setLoading] = useState(
    !booking.hairstyle_selection &&
      booking.has_hairstyle_selection !== false
  );

  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (booking.hairstyle_selection) {
      setSelection(booking.hairstyle_selection);
      setLoading(false);
      return;
    }

    if (booking.has_hairstyle_selection === false) {
      setLoading(false);
      return;
    }

    const abort = new AbortController();
    let active = true;

    setLoading(true);
    setError("");

    void getBarberBookingById(
      booking.id,
      abort.signal
    )
      .then((result) => {
        if (!active || abort.signal.aborted) return;

        setSelection(
          result.hairstyle_selection || null
        );
      })
      .catch((err: unknown) => {
        if (!active || abort.signal.aborted) return;

        setError(messageOf(err));
      })
      .finally(() => {
        if (active && !abort.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      abort.abort();
    };
  }, [
    booking.id,
    booking.has_hairstyle_selection,
    booking.hairstyle_selection,
    revision,
  ]);

  if (loading) {
    return (
      <View style={styles.inlineLoader}>
        <ActivityIndicator
          size="small"
          color={GOLD}
        />

        <Text style={styles.secondary}>
          Loading hairstyle details...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.hairstylePanel}>
        <Message text={error} />

        <ActionButton
          title="Retry Hairstyle"
          icon={RefreshCw}
          onPress={() =>
            setRevision((value) => value + 1)
          }
        />
      </View>
    );
  }

  if (!selection) return null;

  return <HairstyleDetails selection={selection} />;
}

// ============================================================
// PREMIUM BOOKING CARD
// ============================================================

function BookingCard({
  booking,
  disabled,
  onView,
  onAction,
}: {
  booking: BarberBooking;
  disabled: boolean;
  onView: (booking: BarberBooking) => void;
  onAction: (
    booking: BarberBooking,
    type: ActionType
  ) => void;
}) {
  const status = booking.status;

  return (
    <View style={styles.bookingCard}>
      <View style={styles.bookingCardAccent} />

      <View style={styles.bookingCardHeader}>
        <View style={styles.avatar}>
          {booking.customer_image_url ? (
            <Image
              source={{
                uri: booking.customer_image_url,
              }}
              style={styles.avatarImage}
            />
          ) : (
            <Text style={styles.avatarText}>
              {initials(booking.customer_name)}
            </Text>
          )}
        </View>

        <View style={styles.flex}>
          <Text
            numberOfLines={1}
            style={styles.customerName}
          >
            {booking.customer_name || "Customer"}
          </Text>

          <Text
            numberOfLines={1}
            style={styles.customerPhone}
          >
            {booking.customer_phone ||
              "Phone unavailable"}
          </Text>
        </View>

        <StatusBadge status={status} />
      </View>

      <View style={styles.cardDivider} />

      <View style={styles.serviceRow}>
        <View style={styles.serviceIcon}>
          <Scissors
            size={19}
            color={GOLD}
          />
        </View>

        <View style={styles.flex}>
          <Text
            style={styles.serviceLabel}
          >
            SERVICE
          </Text>

          <Text
            numberOfLines={2}
            style={styles.serviceName}
          >
            {booking.service_name ||
              "Service unavailable"}
          </Text>
        </View>

        <Text style={styles.servicePrice}>
          {formatPrice(
            booking.service_price
          )}
        </Text>
      </View>

      <View style={styles.appointmentMeta}>
        <View style={styles.metaCard}>
          <CalendarDays
            size={16}
            color={GOLD}
          />

          <View style={styles.flex}>
            <Text style={styles.metaLabel}>
              DATE
            </Text>
            <Text style={styles.metaValue}>
              {formatDate(
                booking.booking_date
              )}
            </Text>
          </View>
        </View>

        <View style={styles.metaCard}>
          <Clock3
            size={16}
            color={GOLD}
          />

          <View style={styles.flex}>
            <Text style={styles.metaLabel}>
              TIME
            </Text>
            <Text style={styles.metaValue}>
              {formatTime(
                booking.start_time
              )}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.durationRow}>
        <Text style={styles.durationLabel}>
          Service duration
        </Text>

        <Text style={styles.durationValue}>
          {formatDuration(
            booking.service_duration_minutes
          )}
        </Text>
      </View>

      {hasSavedHairstyle(booking) && (
        <View style={styles.lookBadge}>
          <Sparkles
            size={15}
            color={GOLD}
          />

          <Text
            numberOfLines={2}
            style={styles.lookBadgeText}
          >
            {booking.hairstyle_name ||
              booking.hairstyle_selection
                ?.hairstyle_name ||
              "Customer selected hairstyle"}
          </Text>

          <CheckCircle2
            size={15}
            color={SUCCESS}
          />
        </View>
      )}

      <View style={styles.bookingCardFooter}>
        <ActionButton
          title="Details"
          icon={Eye}
          disabled={disabled}
          onPress={() => onView(booking)}
        />

        {status === "pending" && (
          <>
            <ActionButton
              title="Reject"
              danger
              disabled={disabled}
              onPress={() =>
                onAction(booking, "reject")
              }
            />

            <ActionButton
              title="Accept"
              primary
              disabled={disabled}
              icon={CheckCircle2}
              onPress={() =>
                onAction(booking, "accept")
              }
            />
          </>
        )}

        {status === "confirmed" && (
          <ActionButton
            title="Complete"
            primary
            disabled={disabled}
            icon={CalendarCheck}
            onPress={() =>
              onAction(booking, "complete")
            }
          />
        )}
      </View>
    </View>
  );
}

// ============================================================
// MAIN SCREEN
// ============================================================

export default function BookingsScreen({
  onBack,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [bookings, setBookings] =
    useState<BarberBooking[]>([]);

  const [category, setCategory] =
    useState<Category>("total");

  const [dateFilter, setDateFilter] =
    useState<DateFilter>("all");

  const [search, setSearch] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [hasLoaded, setHasLoaded] =
    useState(false);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  const [actionError, setActionError] =
    useState("");

  const [outcomeUnknown, setOutcomeUnknown] =
    useState(false);

  const [selected, setSelected] =
    useState<BarberBooking | null>(null);

  const [action, setAction] =
    useState<BookingAction | null>(null);

  const [reason, setReason] =
    useState("");

  const mounted = useRef(false);
  const requestId = useRef(0);
  const mutation = useRef(false);
  const controller =
    useRef<AbortController | null>(null);

  const busy =
    loading || refreshing || saving;

  const mutationDisabled =
    busy || outcomeUnknown;

  const columns =
    width >= 760
      ? 4
      : width < 340
      ? 1
      : 2;

  // ----------------------------------------------------------
  // LOAD BOOKINGS
  // ----------------------------------------------------------

  const loadBookings = useCallback(
    async (
      refresh = false
    ): Promise<boolean> => {
      const current = ++requestId.current;

      controller.current?.abort();

      const abort = new AbortController();
      controller.current = abort;

      if (mounted.current) {
        setLoading(!refresh);
        setRefreshing(refresh);
        setError("");
      }

      try {
        const result =
          await getBarberBookings(
            { status: "all" },
            abort.signal
          );

        if (
          !mounted.current ||
          abort.signal.aborted ||
          current !== requestId.current
        ) {
          return false;
        }

        setBookings(result.bookings);
        setHasLoaded(true);

        return true;
      } catch (err: unknown) {
        if (
          !mounted.current ||
          abort.signal.aborted ||
          current !== requestId.current
        ) {
          return false;
        }

        setError(messageOf(err));
        return false;
      } finally {
        if (
          mounted.current &&
          current === requestId.current
        ) {
          setLoading(false);
          setRefreshing(false);
        }

        if (controller.current === abort) {
          controller.current = null;
        }
      }
    },
    []
  );

  useEffect(() => {
    mounted.current = true;

    void loadBookings();

    return () => {
      mounted.current = false;
      requestId.current += 1;
      controller.current?.abort();
    };
  }, [loadBookings]);

  // ----------------------------------------------------------
  // DATE FILTER
  // ----------------------------------------------------------

  const dateBookings = useMemo(
    () =>
      bookings.filter((booking) =>
        matchesDate(
          booking.booking_date,
          dateFilter
        )
      ),
    [bookings, dateFilter]
  );

  // ----------------------------------------------------------
  // SUMMARY STATS
  // ----------------------------------------------------------

  const counts = useMemo(
    () => ({
      total: dateBookings.length,

      upcoming: dateBookings.filter(
        (booking) =>
          booking.status === "confirmed"
      ).length,

      completed: dateBookings.filter(
        (booking) =>
          booking.status === "completed"
      ).length,

      cancelled: dateBookings.filter(
        (booking) =>
          booking.status === "cancelled" ||
          booking.status === "rejected"
      ).length,
    }),
    [dateBookings]
  );

  const pendingCount = dateBookings.filter(
    (booking) =>
      booking.status === "pending"
  ).length;

  // ----------------------------------------------------------
  // SEARCH AND CATEGORY FILTER
  // ----------------------------------------------------------

  const visibleBookings = useMemo(() => {
    const query = search.trim().toLowerCase();

    return dateBookings
      .filter((booking) =>
        matchesCategory(
          category,
          booking.status
        )
      )
      .filter((booking) => {
        if (!query) return true;

        return [
          booking.id,
          booking.customer_name,
          booking.customer_phone,
          booking.service_name,
          booking.hairstyle_name,
          booking.hairstyle_selection
            ?.hairstyle_name,
        ].some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(query)
        );
      })
      .sort(sortNewest);
  }, [
    dateBookings,
    category,
    search,
  ]);

  // ----------------------------------------------------------
  // REFRESH
  // ----------------------------------------------------------

  const refresh = async () => {
    if (busy || mutation.current) return;

    setSuccess("");

    const refreshed =
      await loadBookings(true);

    if (
      !mounted.current ||
      !refreshed
    ) {
      return;
    }

    setOutcomeUnknown(false);
    setAction(null);
    setSelected(null);
    setReason("");
    setActionError("");
  };

  // ----------------------------------------------------------
  // OPEN ACTION
  // ----------------------------------------------------------

  const openAction = (
    booking: BarberBooking,
    type: ActionType
  ) => {
    if (
      mutation.current ||
      mutationDisabled
    ) {
      return;
    }

    setSelected(null);
    setReason("");
    setActionError("");
    setSuccess("");

    setAction({
      booking,
      type,
    });
  };

  const closeAction = () => {
    if (mutation.current) return;

    setAction(null);
    setReason("");
    setActionError("");
  };

  // ----------------------------------------------------------
  // PERFORM BOOKING ACTION
  // ----------------------------------------------------------

  const performAction = async () => {
    if (
      !action ||
      mutation.current ||
      mutationDisabled
    ) {
      return;
    }

    const currentAction = action;
    const trimmedReason = reason.trim();

    if (
      (
        currentAction.type === "reject" ||
        currentAction.type === "cancel"
      ) &&
      (
        trimmedReason.length < 3 ||
        trimmedReason.length > 500
      )
    ) {
      setActionError(
        "Enter a reason between 3 and 500 characters."
      );
      return;
    }

    mutation.current = true;

    setSaving(true);
    setActionError("");
    setError("");
    setSuccess("");

    try {
      const id = currentAction.booking.id;

      let result: BookingActionResponse;

      switch (currentAction.type) {
        case "accept":
          result = await acceptBarberBooking(id);
          break;

        case "reject":
          result = await rejectBarberBooking(
            id,
            trimmedReason
          );
          break;

        case "complete":
          result = await completeBarberBooking(
            id
          );
          break;

        case "cancel":
          result = await cancelBarberBooking(
            id,
            trimmedReason
          );
          break;
      }

      if (!mounted.current) return;

      if (
        !result.booking ||
        result.booking.id !== id
      ) {
        setOutcomeUnknown(true);

        setActionError(
          "The result could not be verified. Refresh bookings before taking another action."
        );

        return;
      }

      const updated = result.booking;

      // Avoid keeping large hairstyle previews
      // permanently in the booking list.
      const lightweight: BarberBooking = {
        ...updated,

        has_hairstyle_selection:
          updated.has_hairstyle_selection ??
          Boolean(
            updated.hairstyle_selection
          ),

        hairstyle_name:
          updated.hairstyle_name ??
          updated.hairstyle_selection
            ?.hairstyle_name ??
          null,

        hairstyle_selection: null,
        hairstyle_details_loaded: false,
      };

      setBookings((previous) =>
        previous.map((booking) =>
          booking.id === id
            ? lightweight
            : booking
        )
      );

      setAction(null);
      setSelected(null);
      setReason("");
      setActionError("");

      setSuccess(
        result.message ||
          "Booking updated successfully."
      );

      await loadBookings(true);
    } catch (err: unknown) {
      if (!mounted.current) return;

      const uncertain =
        err instanceof BookingApiError
          ? err.outcomeUnknown
          : true;

      if (uncertain) {
        setOutcomeUnknown(true);
      }

      setActionError(messageOf(err));
    } finally {
      mutation.current = false;

      if (mounted.current) {
        setSaving(false);
      }
    }
  };

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={styles.screen}
    >
      {/* HEADER */}

      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.headerButton}
          accessibilityLabel="Back to dashboard"
        >
          <ArrowLeft
            size={20}
            color={C.text}
          />
        </Pressable>

        <View style={styles.flex}>
          <Text style={styles.headerEyebrow}>
            KSHURAK BARBER
          </Text>

          <Text style={styles.headerTitle}>
            Bookings
          </Text>
        </View>

        <Pressable
          disabled={busy}
          onPress={() => void refresh()}
          style={styles.headerButton}
          accessibilityLabel="Refresh bookings"
        >
          {refreshing ? (
            <ActivityIndicator
              color={GOLD}
              size="small"
            />
          ) : (
            <RefreshCw
              size={19}
              color={GOLD}
            />
          )}
        </Pressable>
      </View>

      {/* CONTENT */}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Math.max(
              30,
              insets.bottom + 24
            ),
          },
        ]}
      >
        {/* HERO */}

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <CalendarCheck
              size={25}
              color={GOLD}
            />
          </View>

          <View style={styles.heroTopRow}>
            <View style={styles.heroBadge}>
              <View style={styles.heroBadgeDot} />

              <Text style={styles.heroBadgeText}>
                BOOKING MANAGEMENT
              </Text>
            </View>
          </View>

          <Text style={styles.heroTitle}>
            Every Appointment.
            {"\n"}
            <Text style={styles.heroGold}>
              Perfectly Managed.
            </Text>
          </Text>

          <Text style={styles.heroDescription}>
            Manage customer bookings, confirm
            appointments and keep your shop
            running smoothly.
          </Text>

          <View style={styles.heroFooter}>
            <View style={styles.heroMetric}>
              <Text style={styles.heroMetricValue}>
                {counts.total}
              </Text>

              <Text style={styles.heroMetricLabel}>
                BOOKINGS
              </Text>
            </View>

            <View style={styles.heroMetricDivider} />

            <View style={styles.heroMetric}>
              <Text style={styles.heroMetricValue}>
                {pendingCount}
              </Text>

              <Text style={styles.heroMetricLabel}>
                PENDING
              </Text>
            </View>

            <View style={styles.heroMetricDivider} />

            <View style={styles.heroMetric}>
              <Text style={styles.heroMetricValue}>
                {counts.completed}
              </Text>

              <Text style={styles.heroMetricLabel}>
                COMPLETED
              </Text>
            </View>
          </View>
        </View>

        <Message text={error} />
        <Message text={success} success />

        {outcomeUnknown && (
          <View style={styles.warningBox}>
            <ShieldCheck
              size={18}
              color={GOLD}
            />

            <View style={styles.flex}>
              <Text style={styles.warningTitle}>
                Booking status needs verification
              </Text>

              <Text style={styles.warningText}>
                A previous update may have succeeded.
                Refresh the booking list before
                submitting another action.
              </Text>
            </View>
          </View>
        )}

        {/* SUMMARY CARDS */}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionEyebrow}>
              BUSINESS OVERVIEW
            </Text>

            <Text style={styles.sectionTitle}>
              Booking Insights
            </Text>
          </View>

          <View style={styles.sectionIcon}>
            <Sparkles
              size={17}
              color={GOLD}
            />
          </View>
        </View>

        <View style={styles.summaryGrid}>
          {SUMMARY_CARDS.map((card) => (
            <View
              key={card.key}
              style={{
                width:
                  columns === 4
                    ? "23.5%"
                    : columns === 1
                    ? "100%"
                    : "48.4%",
              }}
            >
              <PremiumSummaryCard
                card={card}
                count={counts[card.key]}
                active={category === card.key}
                onPress={() =>
                  setCategory(card.key)
                }
              />
            </View>
          ))}
        </View>

        {/* SEARCH AND FILTERS */}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionEyebrow}>
              APPOINTMENTS
            </Text>

            <Text style={styles.sectionTitle}>
              Booking Records
            </Text>
          </View>

          <View style={styles.resultBadge}>
            <Text style={styles.resultText}>
              {visibleBookings.length}
            </Text>
          </View>
        </View>

        <View style={styles.searchBox}>
          <Search
            size={18}
            color={MUTED}
          />

          <TextInput
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            placeholder="Search name, phone, service..."
            placeholderTextColor={C.textMuted}
            autoCorrect={false}
          />

          {!!search && (
            <Pressable
              onPress={() => setSearch("")}
            >
              <X
                size={17}
                color={MUTED}
              />
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {DATE_FILTERS.map((filter) => {
            const active =
              dateFilter === filter.key;

            return (
              <Pressable
                key={filter.key}
                onPress={() =>
                  setDateFilter(filter.key)
                }
                style={[
                  styles.filterChip,
                  active && styles.filterChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active &&
                      styles.filterChipTextActive,
                  ]}
                >
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.listHeading}>
          <Text style={styles.listTitle}>
            {
              SUMMARY_CARDS.find(
                (item) => item.key === category
              )?.title
            }
          </Text>

          <Text style={styles.listSubtitle}>
            Newest appointments first
          </Text>
        </View>

        {/* BOOKING LIST */}

        {loading && !hasLoaded ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator
              size="large"
              color={GOLD}
            />

            <Text style={styles.emptyTitle}>
              Loading Bookings
            </Text>

            <Text style={styles.emptyDescription}>
              Retrieving your latest shop appointments...
            </Text>
          </View>
        ) : visibleBookings.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <CalendarDays
                size={29}
                color={GOLD}
              />
            </View>

            <Text style={styles.emptyTitle}>
              {error
                ? "Unable to Load Bookings"
                : "No Bookings Found"}
            </Text>

            <Text style={styles.emptyDescription}>
              {error
                ? "Check your connection and try again."
                : "There are no bookings matching the selected filters."}
            </Text>

            <ActionButton
              title="Refresh"
              icon={RefreshCw}
              onPress={() => void refresh()}
            />
          </View>
        ) : (
          <View style={styles.bookingList}>
            {visibleBookings.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                disabled={mutationDisabled}
                onView={setSelected}
                onAction={openAction}
              />
            ))}
          </View>
        )}

        <Text style={styles.footerNote}>
          Showing {visibleBookings.length} of{" "}
          {dateBookings.length} appointments
          for the selected date range.
        </Text>
      </ScrollView>

      {/* ======================================================
          BOOKING DETAILS MODAL
      ====================================================== */}

      <Modal
        visible={selected !== null}
        transparent
        animationType="slide"
        onRequestClose={() =>
          setSelected(null)
        }
      >
        <KeyboardAvoidingView
          style={[
            styles.overlay,
            {
              paddingTop: Math.max(
                14,
                insets.top
              ),
              paddingBottom: Math.max(
                14,
                insets.bottom
              ),
            },
          ]}
          behavior={
            Platform.OS === "ios"
              ? "padding"
              : "height"
          }
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.flex}>
                <Text style={styles.modalEyebrow}>
                  BOOKING DETAILS
                </Text>

                <Text style={styles.modalTitle}>
                  Appointment Overview
                </Text>
              </View>

              <Pressable
                onPress={() =>
                  setSelected(null)
                }
                style={styles.headerButton}
              >
                <X
                  size={20}
                  color={C.text}
                />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalBody}
            >
              {selected && (
                <>
                  <View style={styles.detailsHero}>
                    <View style={styles.avatarLarge}>
                      <Text style={styles.avatarTextLarge}>
                        {initials(
                          selected.customer_name
                        )}
                      </Text>
                    </View>

                    <Text style={styles.detailsCustomer}>
                      {selected.customer_name}
                    </Text>

                    <StatusBadge
                      status={selected.status}
                    />
                  </View>

                  <View style={styles.detailsSection}>
                    <Text style={styles.miniHeading}>
                      APPOINTMENT INFORMATION
                    </Text>

                    <DetailRow
                      label="Booking Reference"
                      value={selected.id}
                    />

                    <DetailRow
                      label="Customer Phone"
                      value={
                        selected.customer_phone
                      }
                    />

                    <DetailRow
                      label="Service"
                      value={
                        selected.service_name
                      }
                    />

                    <DetailRow
                      label="Booking Date"
                      value={formatDate(
                        selected.booking_date
                      )}
                    />

                    <DetailRow
                      label="Start Time"
                      value={formatTime(
                        selected.start_time
                      )}
                    />

                    <DetailRow
                      label="End Time"
                      value={formatTime(
                        selected.end_time
                      )}
                    />

                    <DetailRow
                      label="Duration"
                      value={formatDuration(
                        selected.service_duration_minutes
                      )}
                    />

                    <DetailRow
                      label="Service Price"
                      value={formatPrice(
                        selected.service_price
                      )}
                    />

                    <DetailRow
                      label="Worker ID"
                      value={
                        selected.worker_id
                      }
                    />
                  </View>

                  <BookingHairstylePanel
                    key={`hairstyle-${selected.id}`}
                    booking={selected}
                  />

                  {!!selected.customer_notes && (
                    <DetailRow
                      label="Customer Notes"
                      value={
                        selected.customer_notes
                      }
                    />
                  )}

                  {!!selected.cancellation_reason && (
                    <DetailRow
                      label="Cancellation Reason"
                      value={
                        selected.cancellation_reason
                      }
                    />
                  )}

                  <View style={styles.modalActions}>
                    {selected.status ===
                      "pending" && (
                      <>
                        <ActionButton
                          title="Reject"
                          danger
                          disabled={mutationDisabled}
                          onPress={() =>
                            openAction(
                              selected,
                              "reject"
                            )
                          }
                        />

                        <ActionButton
                          title="Accept"
                          primary
                          disabled={mutationDisabled}
                          onPress={() =>
                            openAction(
                              selected,
                              "accept"
                            )
                          }
                        />
                      </>
                    )}

                    {selected.status ===
                      "confirmed" && (
                      <>
                        <ActionButton
                          title="Cancel"
                          danger
                          disabled={mutationDisabled}
                          onPress={() =>
                            openAction(
                              selected,
                              "cancel"
                            )
                          }
                        />

                        <ActionButton
                          title="Complete"
                          primary
                          disabled={mutationDisabled}
                          onPress={() =>
                            openAction(
                              selected,
                              "complete"
                            )
                          }
                        />
                      </>
                    )}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ======================================================
          ACTION CONFIRMATION MODAL
      ====================================================== */}

      <Modal
        visible={action !== null}
        transparent
        animationType="fade"
        onRequestClose={closeAction}
      >
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={
            Platform.OS === "ios"
              ? "padding"
              : "height"
          }
        >
          <View style={styles.confirmCard}>
            <View style={styles.modalHeader}>
              <View style={styles.flex}>
                <Text style={styles.modalEyebrow}>
                  CONFIRM ACTION
                </Text>

                <Text style={styles.modalTitle}>
                  {action
                    ? actionTitle(action.type)
                    : "Booking Action"}
                </Text>
              </View>

              <Pressable
                disabled={saving}
                onPress={closeAction}
                style={styles.headerButton}
              >
                <X
                  size={19}
                  color={C.text}
                />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalBody}
              showsVerticalScrollIndicator={false}
            >
              {action && (
                <>
                  <View style={styles.confirmInfo}>
                    <Text style={styles.confirmName}>
                      {action.booking.customer_name}
                    </Text>

                    <Text style={styles.secondary}>
                      {action.booking.service_name}
                    </Text>

                    <Text style={styles.goldText}>
                      {formatDate(
                        action.booking.booking_date
                      )}
                      {" · "}
                      {formatTime(
                        action.booking.start_time
                      )}
                    </Text>
                  </View>

                  <Text style={styles.confirmQuestion}>
                    Are you sure you want to{" "}
                    {action.type} this booking?
                  </Text>

                  {action.type === "accept" && (
                    <View style={styles.confirmNotice}>
                      <ShieldCheck
                        size={17}
                        color={GOLD}
                      />

                      <Text style={styles.confirmNoticeText}>
                        Confirming the booking
                        will update its appointment status.
                      </Text>
                    </View>
                  )}

                  {(action.type === "reject" ||
                    action.type === "cancel") && (
                    <>
                      <Text style={styles.miniHeading}>
                        REASON
                      </Text>

                      <TextInput
                        value={reason}
                        onChangeText={setReason}
                        editable={!saving}
                        multiline
                        maxLength={500}
                        textAlignVertical="top"
                        style={styles.reasonInput}
                        placeholder="Explain the reason..."
                        placeholderTextColor={C.textMuted}
                      />
                    </>
                  )}

                  <Message text={actionError} />

                  {outcomeUnknown && (
                    <Text style={styles.warningText}>
                      Refresh booking status
                      before submitting again.
                    </Text>
                  )}

                  <View style={styles.modalActions}>
                    <ActionButton
                      title="Back"
                      disabled={saving}
                      onPress={closeAction}
                    />

                    <ActionButton
                      title={
                        saving
                          ? "Processing..."
                          : actionTitle(action.type)
                      }
                      primary={
                        action.type === "accept" ||
                        action.type === "complete"
                      }
                      danger={
                        action.type === "reject" ||
                        action.type === "cancel"
                      }
                      disabled={
                        saving ||
                        outcomeUnknown
                      }
                      loading={saving}
                      onPress={() =>
                        void performAction()
                      }
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: DARK,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  headerEyebrow: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },

  headerTitle: {
    color: C.text,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 4,
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
    borderRadius: 22,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    padding: 19,
    marginBottom: 23,
    overflow: "hidden",
  },

  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  heroTopRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
  },

  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },

  heroBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GOLD,
  },

  heroBadgeText: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  heroTitle: {
    color: C.text,
    fontSize: 27,
    fontWeight: "900",
    lineHeight: 36,
    letterSpacing: -0.6,
    marginTop: 13,
  },

  heroGold: {
    color: GOLD,
  },

  heroDescription: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 20,
    marginTop: 11,
  },

  heroFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginTop: 21,
    paddingTop: 17,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  heroMetric: {
    flex: 1,
    alignItems: "center",
  },

  heroMetricValue: {
    color: C.text,
    fontSize: 23,
    fontWeight: "900",
  },

  heroMetricLabel: {
    color: MUTED,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: 7,
  },

  heroMetricDivider: {
    height: 30,
    width: 1,
    backgroundColor: BORDER,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },

  sectionEyebrow: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  sectionTitle: {
    color: C.text,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 5,
  },

  sectionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    backgroundColor: GOLD_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
    marginBottom: 25,
  },

  summaryCard: {
    minHeight: 151,
    borderRadius: 16,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    overflow: "hidden",
  },

  summaryCardActive: {
    borderColor: GOLD,
    backgroundColor: "#211B11",
  },

  summaryAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: C.borderLight,
  },

  summaryAccentActive: {
    backgroundColor: GOLD,
  },

  summaryTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  summaryIcon: {
    width: 35,
    height: 35,
    borderRadius: 10,
    backgroundColor: GOLD_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  summaryCount: {
    color: C.text,
    fontSize: 29,
    fontWeight: "900",
    marginTop: 12,
  },

  summaryTitle: {
    color: C.text,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },

  summarySubtitle: {
    color: MUTED,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },

  resultBadge: {
    minWidth: 34,
    height: 34,
    borderRadius: 10,
    paddingHorizontal: 10,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  resultText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
  },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: C.borderLight,
    marginBottom: 12,
  },

  searchInput: {
    flex: 1,
    minWidth: 0,
    color: C.text,
    fontSize: 12,
  },

  filterRow: {
    gap: 8,
    paddingBottom: 3,
  },

  filterChip: {
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
  },

  filterChipActive: {
    backgroundColor: GOLD_SOFT,
    borderColor: GOLD,
  },

  filterChipText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
  },

  filterChipTextActive: {
    color: GOLD,
  },

  listHeading: {
    marginTop: 20,
    marginBottom: 13,
  },

  listTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: "900",
  },

  listSubtitle: {
    color: MUTED,
    fontSize: 11,
    marginTop: 5,
  },

  bookingList: {
    gap: 12,
  },

  bookingCard: {
    borderRadius: 17,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 15,
    overflow: "hidden",
  },

  bookingCardAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 3,
    bottom: 0,
    backgroundColor: GOLD,
  },

  bookingCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  avatar: {
    width: 43,
    height: 43,
    borderRadius: 13,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  avatarImage: {
    width: "100%",
    height: "100%",
  },

  avatarText: {
    color: GOLD,
    fontSize: 14,
    fontWeight: "900",
  },

  customerName: {
    color: C.text,
    fontSize: 14,
    fontWeight: "900",
  },

  customerPhone: {
    color: MUTED,
    fontSize: 11,
    marginTop: 5,
  },

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },

  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  statusText: {
    fontSize: 9,
    fontWeight: "900",
  },

  cardDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 14,
  },

  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  serviceIcon: {
    width: 41,
    height: 41,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
  },

  serviceLabel: {
    color: C.textMuted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },

  serviceName: {
    color: C.text,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    marginTop: 4,
  },

  servicePrice: {
    color: GOLD,
    fontSize: 16,
    fontWeight: "900",
  },

  appointmentMeta: {
    flexDirection: "row",
    gap: 9,
    marginTop: 15,
  },

  metaCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: DARK,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },

  metaLabel: {
    color: C.textMuted,
    fontSize: 9,
    fontWeight: "800",
  },

  metaValue: {
    color: C.text,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 5,
  },

  durationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
  },

  durationLabel: {
    color: MUTED,
    fontSize: 11,
  },

  durationValue: {
    color: C.text,
    fontSize: 11,
    fontWeight: "800",
  },

  lookBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 11,
    borderRadius: 10,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    marginBottom: 12,
  },

  lookBadgeText: {
    flex: 1,
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
  },

  bookingCardFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  actionButton: {
    flexGrow: 1,
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 7,
    backgroundColor: LIGHT,
    borderWidth: 1,
    borderColor: C.borderLight,
    borderRadius: 10,
  },

  actionPrimary: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },

  actionDanger: {
    backgroundColor: "rgba(239,68,68,0.07)",
    borderColor: "rgba(239,68,68,0.40)",
  },

  actionButtonText: {
    color: C.text,
    fontSize: 11,
    fontWeight: "900",
  },

  actionPrimaryText: {
    color: BG,
  },

  actionDangerText: {
    color: ERROR,
  },

  emptyCard: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 17,
    padding: 28,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 225,
    gap: 12,
  },

  emptyIcon: {
    width: 65,
    height: 65,
    borderRadius: 20,
    backgroundColor: GOLD_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },

  emptyDescription: {
    color: MUTED,
    fontSize: 11,
    textAlign: "center",
    lineHeight: 19,
  },

  footerNote: {
    color: C.textMuted,
    fontSize: 10,
    textAlign: "center",
    marginTop: 20,
  },

  message: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 13,
    borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1,
    marginBottom: 14,
  },

  messageText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 18,
  },

  warningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 13,
    borderRadius: 12,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    marginBottom: 15,
  },

  warningTitle: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
  },

  warningText: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
    marginTop: 5,
  },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.87)",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 18,
  },

  modalCard: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "94%",
    alignSelf: "center",
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: C.borderLight,
    borderRadius: 19,
    overflow: "hidden",
  },

  confirmCard: {
    width: "100%",
    maxWidth: 500,
    maxHeight: "90%",
    alignSelf: "center",
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: C.borderLight,
    borderRadius: 19,
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

  modalEyebrow: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  modalTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 6,
  },

  modalBody: {
    padding: 16,
    paddingBottom: 32,
  },

  detailsHero: {
    alignItems: "center",
    padding: 17,
    borderRadius: 13,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
    marginBottom: 16,
  },

  avatarLarge: {
    width: 63,
    height: 63,
    borderRadius: 19,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    justifyContent: "center",
    alignItems: "center",
  },

  avatarTextLarge: {
    color: GOLD,
    fontSize: 22,
    fontWeight: "900",
  },

  detailsCustomer: {
    color: C.text,
    fontSize: 18,
    fontWeight: "900",
  },

  detailsSection: {
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingBottom: 8,
  },

  detailRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  detailLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "800",
  },

  detailValue: {
    color: C.text,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: 6,
  },

  modalActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 17,
  },

  confirmInfo: {
    padding: 15,
    backgroundColor: DARK,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },

  confirmName: {
    color: C.text,
    fontSize: 15,
    fontWeight: "900",
  },

  confirmQuestion: {
    color: C.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 21,
    marginTop: 17,
    marginBottom: 8,
  },

  secondary: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 5,
  },

  goldText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
  },

  miniHeading: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    marginVertical: 12,
  },

  confirmNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    backgroundColor: GOLD_SOFT,
    padding: 12,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 11,
    marginTop: 11,
  },

  confirmNoticeText: {
    flex: 1,
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
  },

  reasonInput: {
    minHeight: 100,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: C.borderLight,
    borderRadius: 11,
    padding: 12,
    color: C.text,
    fontSize: 12,
    textAlignVertical: "top",
  },

  hairstylePanel: {
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 14,
    padding: 14,
    marginTop: 15,
  },

  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  hairstyleHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: GOLD_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  panelTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: "900",
  },

  selectedStyleName: {
    color: GOLD,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 15,
  },

  hairstyleImageCard: {
    marginTop: 14,
  },

  hairstyleImageFrame: {
    height: 245,
    borderRadius: 12,
    backgroundColor: "#09090A",
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },

  hairstyleImage: {
    width: "100%",
    height: "100%",
  },

  hairstyleImageTitle: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 9,
    letterSpacing: 0.7,
  },

  imageFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },

  imageFallbackText: {
    color: MUTED,
    fontSize: 11,
  },

  imageLoading: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },

  angleTabs: {
    flexDirection: "row",
    gap: 8,
  },

  angleTab: {
    flex: 1,
    padding: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    alignItems: "center",
  },

  angleTabActive: {
    borderColor: GOLD,
    backgroundColor: GOLD_SOFT,
  },

  angleTabText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
  },

  angleTabTextActive: {
    color: GOLD,
  },

  analysisBox: {
    padding: 12,
    marginTop: 14,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
  },

  analysisText: {
    color: C.textSecondary,
    fontSize: 11,
    lineHeight: 19,
  },

  inlineLoader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
  },

  disabled: {
    opacity: 0.45,
  },

  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
});
