
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as SecureStore from "expo-secure-store";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient as SvgGradient,
  Path,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import {
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  LogOut,
  RefreshCw,
  Scissors,
  Sparkles,
  Star,
  Store,
  Users,
  UserRound,
  Wallet,
  AlertCircle,
  CheckCircle2,
} from "lucide-react-native";
import { COLORS } from "../../constants/colors";
import {
  getBarberBookings,
  type BarberBooking,
} from "../../services/bookingApi";
import { getShopCustomers } from "../../services/customersApi";
import { getUnreadNotificationCount } from "../../services/notificationsApi";
import {
  getReviewStatistics,
  type ReviewStatistics,
} from "../../services/reviewsApi";
type Props = {
  onLogout?: () => void;
  onNavigate?: (screen: string) => void;
};
type IconType = ComponentType<{
  size?: number;
  color?: string;
}>;
type Period = "7d" | "1m" | "3m" | "6m";
type ChartPoint = {
  label: string;
  value: number;
};
type LoadMode = "initial" | "refresh";
const LOGO = require("../../../assets/images/logo.png");
const SESSION_KEYS = {
  token: "kshurak_barber_token",
  barberId: "kshurak_barber_id",
  username: "kshurak_barber_username",
} as const;
const PERIODS: { key: Period; label: string }[] = [
  { key: "7d", label: "7 Days" },
  { key: "1m", label: "1 Month" },
  { key: "3m", label: "3 Months" },
  { key: "6m", label: "6 Months" },
];
const QUICK_ACTIONS: {
  label: string;
  subtitle: string;
  target: string;
  icon: IconType;
}[] = [
  {
    label: "Shop Setup",
    subtitle: "Shop information",
    target: "Shop Setup",
    icon: Store,
  },
  {
    label: "Bookings",
    subtitle: "Appointments",
    target: "Bookings",
    icon: CalendarDays,
  },
  {
    label: "Services",
    subtitle: "Prices & services",
    target: "Services",
    icon: Scissors,
  },
  {
    label: "Customers",
    subtitle: "Customer directory",
    target: "Customers",
    icon: UserRound,
  },
  {
    label: "Notifications",
    subtitle: "Shop activity",
    target: "Notifications",
    icon: Bell,
  },
  {
    label: "Reviews",
    subtitle: "Ratings & feedback",
    target: "Reviews",
    icon: Star,
  },
  {
    label: "Rescheduling",
    subtitle: "Appointment changes",
    target: "Rescheduling",
    icon: CalendarClock,
  },
  {
    label: "Workers",
    subtitle: "Team & availability",
    target: "Workers",
    icon: Users,
  },
];
const BOTTOM_TABS: {
  label: string;
  target: string;
  icon: IconType;
}[] = [
  { label: "Customers", target: "Customers", icon: Users },
  { label: "Reschedule", target: "Rescheduling", icon: CalendarClock },
  { label: "Bookings", target: "Bookings", icon: CalendarDays },
  { label: "Services", target: "Services", icon: Scissors },
  { label: "Reviews", target: "Reviews", icon: Star },
];
function indiaDate(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function greetingNow(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date())
  );
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}
function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}
function count(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-IN");
}
function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to load this information.";
}
function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}
function validateReviewStatistics(
  value: ReviewStatistics
): ReviewStatistics {
  if (
    !value ||
    !Number.isFinite(value.total_reviews) ||
    value.total_reviews < 0 ||
    !Array.isArray(value.rating_distribution)
  ) {
    throw new Error("Invalid review statistics response.");
  }
  if (
    value.average_rating !== null &&
    (!Number.isFinite(value.average_rating) ||
      value.average_rating < 0 ||
      value.average_rating > 5)
  ) {
    throw new Error("Invalid average rating returned by server.");
  }
  return value;
}
type DashboardSnapshot = {
  username: string;
  greeting: string;
  today: string;
  period: Period;
  bookings: BarberBooking[] | null;
  bookingTotal: number | null;
  customerTotal: number | null;
  reviews: ReviewStatistics | null;
  unread: number | null;
  loading: boolean;
  refreshing: boolean;
  reviewsLoading: boolean;
  errors: Record<string, string>;
  updatedAt: string;
};
type DashboardCacheEntry = {
  initialized: boolean;
  disposed: boolean;
  snapshot: DashboardSnapshot;
  listeners: Set<() => void>;
  job: Promise<void> | null;
  reviewJob: Promise<void> | null;
  controller: AbortController | null;
  reviewController: AbortController | null;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => DashboardSnapshot;
};
function emptySnapshot(): DashboardSnapshot {
  return {
    username: "Barber",
    greeting: greetingNow(),
    today: indiaDate(),
    period: "7d",
    bookings: null,
    bookingTotal: null,
    customerTotal: null,
    reviews: null,
    unread: null,
    loading: true,
    refreshing: false,
    reviewsLoading: true,
    errors: {},
    updatedAt: "",
  };
}
const EMPTY_SNAPSHOT = emptySnapshot();
const dashboardCaches = new Map<string, DashboardCacheEntry>();
function subscribeEmpty(): () => void {
  return () => undefined;
}
function getEmptySnapshot(): DashboardSnapshot {
  return EMPTY_SNAPSHOT;
}
function getDashboardCache(
  barberId: string,
  token: string
): DashboardCacheEntry {
  const key = JSON.stringify([barberId, token]);
  const existing = dashboardCaches.get(key);
  if (existing && !existing.disposed) return existing;
  const entry: DashboardCacheEntry = {
    initialized: false,
    disposed: false,
    snapshot: emptySnapshot(),
    listeners: new Set(),
    job: null,
    reviewJob: null,
    controller: null,
    reviewController: null,
    subscribe: () => () => undefined,
    getSnapshot: () => entry.snapshot,
  };
  entry.subscribe = (listener) => {
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  };
  dashboardCaches.set(key, entry);
  return entry;
}
function updateCache(
  entry: DashboardCacheEntry,
  patch: Partial<DashboardSnapshot>
): void {
  if (entry.disposed) return;
  entry.snapshot = {
    ...entry.snapshot,
    ...patch,
  };
  entry.listeners.forEach((listener) => listener());
}
function clearDashboardCaches(): void {
  for (const entry of dashboardCaches.values()) {
    entry.disposed = true;
    entry.controller?.abort();
    entry.reviewController?.abort();
  }
  dashboardCaches.clear();
}
function refreshReviewStats(
  entry: DashboardCacheEntry
): Promise<void> {
  if (entry.disposed) return Promise.resolve();
  if (entry.reviewJob) return entry.reviewJob;
  const controller = new AbortController();
  entry.reviewController = controller;
  updateCache(entry, { reviewsLoading: true });
  const job = (async () => {
    try {
      const response = await getReviewStatistics(controller.signal);
      if (entry.disposed || controller.signal.aborted) return;
      const reviews = validateReviewStatistics(response);
      const { Reviews: _previousReviewsError, ...otherErrors } =
        entry.snapshot.errors;
      updateCache(entry, {
        reviews,
        reviewsLoading: false,
        errors: otherErrors,
      });
    } catch (error: unknown) {
      if (entry.disposed || controller.signal.aborted) return;
      updateCache(entry, {
        reviewsLoading: false,
        errors: {
          ...entry.snapshot.errors,
          Reviews: errorText(error),
        },
      });
    } finally {
      if (!entry.disposed && !controller.signal.aborted) {
        updateCache(entry, { reviewsLoading: false });
      }
    }
  })();
  entry.reviewJob = job;
  void job.finally(() => {
    if (entry.reviewJob === job) {
      entry.reviewJob = null;
      entry.reviewController = null;
    }
  });
  return job;
}
function loadDashboard(
  entry: DashboardCacheEntry,
  mode: LoadMode
): Promise<void> {
  if (entry.disposed) return Promise.resolve();
  if (entry.job) return entry.job;
  entry.initialized = true;
  const controller = new AbortController();
  entry.controller = controller;
  updateCache(entry, {
    loading: mode === "initial",
    refreshing: mode === "refresh",
    reviewsLoading: true,
    today: indiaDate(),
    greeting: greetingNow(),
  });
  const job = (async () => {
    try {
      const results = await Promise.allSettled([
        getBarberBookings({ status: "all" }, controller.signal),
        getShopCustomers(controller.signal),
        getReviewStatistics(controller.signal),
        getUnreadNotificationCount(controller.signal),
        SecureStore.getItemAsync(SESSION_KEYS.username),
      ]);
      if (entry.disposed || controller.signal.aborted) return;
      const [
        bookingResult,
        customerResult,
        reviewResult,
        notificationResult,
        usernameResult,
      ] = results;
      const nextErrors: Record<string, string> = {};
      const patch: Partial<DashboardSnapshot> = {};
      if (bookingResult.status === "fulfilled") {
        const result = bookingResult.value;
        if (
          Array.isArray(result.bookings) &&
          Number.isInteger(result.total) &&
          result.total >= 0
        ) {
          patch.bookings = result.bookings;
          patch.bookingTotal = result.total;
          patch.updatedAt = new Date().toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
          });
        } else {
          nextErrors.Bookings =
            "The backend returned an invalid booking response.";
        }
      } else {
        nextErrors.Bookings = errorText(bookingResult.reason);
      }
      if (customerResult.status === "fulfilled") {
        patch.customerTotal =
          customerResult.value.summary.total_customers;
      } else {
        nextErrors.Customers = errorText(customerResult.reason);
      }
      if (reviewResult.status === "fulfilled") {
        try {
          patch.reviews = validateReviewStatistics(reviewResult.value);
        } catch (error: unknown) {
          nextErrors.Reviews = errorText(error);
        }
      } else {
        nextErrors.Reviews = errorText(reviewResult.reason);
      }
      if (notificationResult.status === "fulfilled") {
        patch.unread = notificationResult.value.unread_count;
      } else {
        nextErrors.Notifications = errorText(
          notificationResult.reason
        );
      }
      if (
        usernameResult.status === "fulfilled" &&
        usernameResult.value?.trim()
      ) {
        patch.username = usernameResult.value.trim();
      }
      updateCache(entry, {
        ...patch,
        reviewsLoading: false,
        errors: nextErrors,
      });
    } catch (error: unknown) {
      if (!entry.disposed && !controller.signal.aborted) {
        updateCache(entry, {
          errors: {
            ...entry.snapshot.errors,
            Dashboard: errorText(error),
          },
        });
      }
    } finally {
      if (!entry.disposed && !controller.signal.aborted) {
        updateCache(entry, {
          loading: false,
          refreshing: false,
          reviewsLoading: false,
        });
      }
    }
  })();
  entry.job = job;
  void job.finally(() => {
    if (entry.job === job) {
      entry.job = null;
      entry.controller = null;
    }
  });
  return job;
}
function buildChart(
  bookings: BarberBooking[],
  period: Period,
  today: string
): ChartPoint[] {
  const end = parseDay(today);
  if (!end) return [];
  const start = new Date(end);
  const groups = new Map<string, ChartPoint>();
  if (period === "7d") {
    start.setUTCDate(start.getUTCDate() - 6);
  } else {
    const months =
      period === "1m" ? 1 : period === "3m" ? 3 : 6;
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - months + 1);
  }
  const bucket = (date: Date) => {
    if (period === "7d") {
      return {
        key: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString("en-IN", {
          timeZone: "UTC",
          weekday: "short",
        }),
      };
    }
    if (period === "6m") {
      return {
        key: date.toISOString().slice(0, 7),
        label: date.toLocaleDateString("en-IN", {
          timeZone: "UTC",
          month: "short",
        }),
      };
    }
    const days = Math.floor(
      (date.getTime() - start.getTime()) / 86400000
    );
    const week = Math.floor(days / 7);
    return { key: `week-${week}`, label: `W${week + 1}` };
  };
  for (
    const cursor = new Date(start);
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const item = bucket(cursor);
    if (!groups.has(item.key)) {
      groups.set(item.key, { label: item.label, value: 0 });
    }
  }
  for (const booking of bookings) {
    const date = parseDay(booking.booking_date);
    if (!date || date < start || date > end) continue;
    const item = groups.get(bucket(date).key);
    if (item) item.value += 1;
  }
  return [...groups.values()];
}
function AnimatedButton({
  children,
  onPress,
  style,
  disabled = false,
  label,
}: {
  children: ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  label: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (value: number) => {
    Animated.spring(scale, {
      toValue: value,
      speed: 35,
      bounciness: 3,
      useNativeDriver: true,
    }).start();
  };
  useEffect(() => () => scale.stopAnimation(), [scale]);
  return (
    <Animated.View
      style={[style, { transform: [{ scale }] }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => animate(0.96)}
        onPressOut={() => animate(1)}
        style={({ pressed }) => [
          styles.fillButton,
          pressed && styles.pressOutline,
          disabled && styles.disabled,
        ]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
function BookingChart({
  points,
}: {
  points: ChartPoint[];
}) {
  const width = 600;
  const height = 240;
  const left = 34;
  const right = 17;
  const top = 24;
  const bottom = 35;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(1, ...points.map((item) => item.value));
  const ceiling = Math.max(4, Math.ceil(maximum / 4) * 4);
  const positions = points.map((item, index) => ({
    ...item,
    x:
      points.length === 1
        ? left + plotWidth / 2
        : left + (index * plotWidth) / (points.length - 1),
    y: top + plotHeight - (item.value / ceiling) * plotHeight,
  }));
  const path = positions
    .map(
      (item, index) =>
        `${index === 0 ? "M" : "L"}${item.x},${item.y}`
    )
    .join(" ");
  const first = positions[0];
  const last = positions[positions.length - 1];
  const area =
    first && last
      ? `${path} L${last.x},${top + plotHeight} L${first.x},${
          top + plotHeight
        } Z`
      : "";
  const labelStep = Math.max(1, Math.ceil(points.length / 7));
  return (
    <View
      style={styles.chart}
      accessibilityLabel={`Booking overview: ${points
        .map((item) => `${item.label}, ${item.value} bookings`)
        .join("; ")}`}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
      >
        <Defs>
          <SvgGradient
            id="premiumBookingArea"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <Stop
              offset="0"
              stopColor={COLORS.primary}
              stopOpacity={0.32}
            />
            <Stop
              offset="1"
              stopColor={COLORS.primary}
              stopOpacity={0.01}
            />
          </SvgGradient>
        </Defs>
        {[0, 1, 2, 3, 4].map((index) => {
          const y = top + (index * plotHeight) / 4;
          return (
            <Line
              key={`grid-${index}`}
              x1={left}
              x2={width - right}
              y1={y}
              y2={y}
              stroke={COLORS.border}
              strokeDasharray="4 6"
            />
          );
        })}
        {[0, 1, 2, 3, 4].map((index) => (
          <SvgText
            key={`axis-${index}`}
            x={left - 10}
            y={top + (index * plotHeight) / 4 + 4}
            textAnchor="end"
            fontSize={11}
            fill={COLORS.textMuted}
          >
            {ceiling - (index * ceiling) / 4}
          </SvgText>
        ))}
        {!!area && (
          <Path d={area} fill="url(#premiumBookingArea)" />
        )}
        {!!path && (
          <Path
            d={path}
            fill="none"
            stroke={COLORS.primary}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {positions.map((item, index) => (
          <Circle
            key={`point-${index}`}
            cx={item.x}
            cy={item.y}
            r={4.5}
            fill={COLORS.primary}
            stroke={COLORS.surface}
            strokeWidth={2.5}
          />
        ))}
        {positions.map((item, index) =>
          index % labelStep === 0 ||
          index === positions.length - 1 ? (
            <SvgText
              key={`label-${index}`}
              x={item.x}
              y={height - 10}
              textAnchor="middle"
              fontSize={11}
              fill={COLORS.textMuted}
            >
              {item.label}
            </SvgText>
          ) : null
        )}
      </Svg>
    </View>
  );
}
function DashboardCard({
  title,
  value,
  note,
  icon: Icon,
  onPress,
  loading = false,
}: {
  title: string;
  value: string;
  note: string;
  icon: IconType;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <AnimatedButton
      label={`${title}: ${value}. Open details`}
      onPress={onPress}
      style={styles.cardContainer}
    >
      <LinearGradient
        colors={[
          COLORS.surfaceLight,
          COLORS.surface,
          COLORS.surfaceDark,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.cardGradient}
      >
        <View style={styles.cardDecoration} />
        <View style={styles.cardTop}>
          <View style={styles.cardIcon}>
            <Icon size={21} color={COLORS.primary} />
          </View>
          {loading ? (
            <ActivityIndicator
              size="small"
              color={COLORS.primary}
            />
          ) : (
            <ChevronRight
              size={14}
              color={COLORS.textMuted}
            />
          )}
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text
          style={styles.cardValue}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.65}
        >
          {value}
        </Text>
        <Text style={styles.cardNote} numberOfLines={2}>
          {note}
        </Text>
      </LinearGradient>
    </AnimatedButton>
  );
}
export default function DashboardScreen({
  onLogout,
  onNavigate,
}: Props) {
  const { width } = useWindowDimensions();
  const narrow = width < 360;
  const [entry, setEntry] =
    useState<DashboardCacheEntry | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const snapshot = useSyncExternalStore(
    entry?.subscribe || subscribeEmpty,
    entry?.getSnapshot || getEmptySnapshot,
    getEmptySnapshot
  );
  const resolveSession = useCallback(
    async (signal?: AbortSignal) => {
      setSessionLoading(true);
      setSessionError("");
      try {
        const [token, barberId] = await Promise.all([
          SecureStore.getItemAsync(SESSION_KEYS.token),
          SecureStore.getItemAsync(SESSION_KEYS.barberId),
        ]);
        if (signal?.aborted) return;
        if (!token?.trim() || !barberId?.trim()) {
          throw new Error(
            "Your barber session is missing. Please log in again."
          );
        }
        const cached = getDashboardCache(
          barberId.trim(),
          token.trim()
        );
        setEntry(cached);
        if (!cached.initialized) {
          void loadDashboard(cached, "initial");
        } else if (!cached.job) {
          // Refresh only ratings when returning to the
          // dashboard so submitted reviews appear promptly.
          void refreshReviewStats(cached);
        }
      } catch (error: unknown) {
        if (!signal?.aborted) {
          setSessionError(errorText(error));
        }
      } finally {
        if (!signal?.aborted) setSessionLoading(false);
      }
    },
    []
  );
  useEffect(() => {
    const controller = new AbortController();
    void resolveSession(controller.signal);
    return () => controller.abort();
  }, [resolveSession]);
  const {
    username,
    greeting,
    today,
    period,
    bookings,
    bookingTotal,
    customerTotal,
    reviews,
    unread,
    refreshing,
    reviewsLoading,
    updatedAt,
  } = snapshot;
  const loading =
    sessionLoading || (entry !== null && snapshot.loading);
  const errors = sessionError
    ? { ...snapshot.errors, Session: sessionError }
    : snapshot.errors;
  const navigate = (screen: string) => {
    if (onNavigate) {
      onNavigate(screen);
    } else {
      Alert.alert(
        "Navigation unavailable",
        `${screen} is not connected yet.`
      );
    }
  };
  const confirmLogout = () => {
    Alert.alert(
      "Log out?",
      "You can sign in again to manage your shop.",
      [
        { text: "Stay Here", style: "cancel" },
        {
          text: "Logout",
          style: "destructive",
          onPress: () => {
            clearDashboardCaches();
            onLogout?.();
          },
        },
      ]
    );
  };
  const refresh = () => {
    if (loading || refreshing) return;
    if (!entry) {
      void resolveSession();
      return;
    }
    void loadDashboard(entry, "refresh");
  };
  const retryReviews = () => {
    if (!entry || reviewsLoading || loading) return;
    void refreshReviewStats(entry);
  };
  const setPeriod = (value: Period) => {
    if (entry) updateCache(entry, { period: value });
  };
  const revenue = useMemo(
    () =>
      (bookings || [])
        .filter(
          (item) =>
            item.booking_date === today &&
            item.status === "completed"
        )
        .reduce(
          (sum, item) =>
            sum + (Number(item.service_price) || 0),
          0
        ),
    [bookings, today]
  );
  const points = useMemo(
    () => buildChart(bookings || [], period, today),
    [bookings, period, today]
  );
  const periodTotal = points.reduce(
    (sum, item) => sum + item.value,
    0
  );
  const average =
    reviewsLoading && !reviews
      ? "..."
      : reviews?.average_rating == null
        ? "—"
        : `${reviews.average_rating.toFixed(1)}/5`;
  const ratingNote = snapshot.errors.Reviews
    ? "Unable to refresh rating"
    : reviews
      ? `${reviews.total_reviews.toLocaleString("en-IN")} customer reviews`
      : reviewsLoading
        ? "Loading customer ratings..."
        : "No ratings available";
  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "bottom", "left", "right"]}
    >
      <View
        style={[styles.header, narrow && styles.headerNarrow]}
      >
        <Image
          source={LOGO}
          resizeMode="contain"
          style={[styles.logo, narrow && styles.logoNarrow]}
        />
        <View
          style={[
            styles.headerActions,
            narrow && styles.headerActionsNarrow,
          ]}
        >
          <AnimatedButton
            label="Refresh dashboard"
            disabled={loading || refreshing}
            onPress={refresh}
            style={styles.headerButton}
          >
            {loading || refreshing ? (
              <ActivityIndicator
                size="small"
                color={COLORS.primary}
              />
            ) : (
              <RefreshCw size={18} color={COLORS.primary} />
            )}
          </AnimatedButton>
          <View>
            <AnimatedButton
              label="Notifications"
              onPress={() => navigate("Notifications")}
              style={styles.headerButton}
            >
              <Bell size={19} color={COLORS.text} />
            </AnimatedButton>
            {!!unread && (
              <View
                pointerEvents="none"
                style={styles.unreadBadge}
              >
                <Text style={styles.unreadText}>
                  {unread > 99 ? "99+" : unread}
                </Text>
              </View>
            )}
          </View>
          <AnimatedButton
            label="Shop setup"
            onPress={() => navigate("Shop Setup")}
            style={styles.headerButton}
          >
            <Store size={19} color={COLORS.primary} />
          </AnimatedButton>
          <AnimatedButton
            label="Logout"
            disabled={!onLogout}
            onPress={confirmLogout}
            style={[styles.headerButton, styles.logoutButton]}
          >
            <LogOut size={18} color={COLORS.error} />
          </AnimatedButton>
        </View>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <LinearGradient
          colors={[
            COLORS.surfaceLight,
            COLORS.surface,
            COLORS.surfaceDark,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View
            pointerEvents="none"
            style={styles.heroGlow}
          />
          <View style={styles.heroEyebrow}>
            <Sparkles size={12} color={COLORS.primary} />
            <Text style={styles.eyebrow}>
              YOUR SHOP, YOUR SUCCESS
            </Text>
          </View>
          <View style={styles.greetingRow}>
            <View style={styles.flex}>
              <Text style={styles.greeting}>{greeting},</Text>
              <Text style={styles.username}>{username}!</Text>
              <Text style={styles.greetingNote}>
                A fresh day. A sharper business.
              </Text>
            </View>
            <AnimatedButton
              label="Manage shop"
              onPress={() => navigate("Shop Setup")}
              style={styles.manageButton}
            >
              <Store size={18} color={COLORS.primary} />
              <Text style={styles.manageText}>
                Manage Shop
              </Text>
            </AnimatedButton>
          </View>
          <View style={styles.heroFooter}>
            <View style={styles.liveDot} />
            <Text style={styles.heroFooterText}>
              {refreshing
                ? "Refreshing shop activity…"
                : "Your latest shop activity"}
            </Text>
          </View>
        </LinearGradient>
        <View style={styles.cardGrid}>
          <DashboardCard
            title="Total Bookings"
            value={count(bookingTotal)}
            note="All shop appointments"
            icon={CalendarDays}
            onPress={() => navigate("Bookings")}
          />
          <DashboardCard
            title="Today's Revenue"
            value={bookings === null ? "—" : money(revenue)}
            note="Completed booking value"
            icon={Wallet}
            onPress={() => navigate("Bookings")}
          />
          <DashboardCard
            title="Total Customers"
            value={count(customerTotal)}
            note="Your customer community"
            icon={Users}
            onPress={() => navigate("Customers")}
          />
          <DashboardCard
            title="Average Rating"
            value={average}
            note={ratingNote}
            icon={Star}
            loading={reviewsLoading}
            onPress={() => navigate("Reviews")}
          />
        </View>
        <View style={styles.quickActionsPanel}>
          <View style={styles.quickActionsHeading}>
            <View>
              <Text style={styles.chartEyebrow}>
                SHOP MANAGEMENT
              </Text>
              <Text style={styles.sectionTitle}>
                Quick Actions
              </Text>
            </View>
            <View style={styles.quickActionsCount}>
              <Text style={styles.quickActionsCountText}>
                {QUICK_ACTIONS.length} MODULES
              </Text>
            </View>
          </View>
          <View style={styles.quickActionsGrid}>
            {QUICK_ACTIONS.map((item) => (
              <AnimatedButton
                key={item.target}
                label={`Open ${item.label}`}
                onPress={() => navigate(item.target)}
                style={styles.quickActionContainer}
              >
                <View style={styles.quickActionContent}>
                  <View style={styles.quickActionTop}>
                    <View style={styles.quickActionIcon}>
                      <item.icon
                        size={17}
                        color={COLORS.primary}
                      />
                    </View>
                    <ChevronRight
                      size={13}
                      color={COLORS.textMuted}
                    />
                  </View>
                  <Text style={styles.quickActionTitle}>
                    {item.label}
                  </Text>
                  <Text style={styles.quickActionSubtitle}>
                    {item.subtitle}
                  </Text>
                </View>
              </AnimatedButton>
            ))}
          </View>
        </View>
        {Object.entries(errors).map(([source, message]) => (
          <View key={source} style={styles.errorBox}>
            <AlertCircle size={15} color={COLORS.error} />
            <Text style={styles.errorText}>
              {source}: {message}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Retry loading ${source}`}
              disabled={
                loading ||
                refreshing ||
                (source === "Reviews" && reviewsLoading)
              }
              onPress={
                source === "Reviews"
                  ? retryReviews
                  : refresh
              }
            >
              <Text style={styles.retryText}>
                Retry
              </Text>
            </Pressable>
          </View>
        ))}
        {reviews && !snapshot.errors.Reviews && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open customer reviews and ratings"
            onPress={() => navigate("Reviews")}
            style={styles.ratingBanner}
          >
            <View style={styles.ratingBannerIcon}>
              <Star
                size={18}
                color={COLORS.primary}
                fill={
                  reviews.total_reviews > 0
                    ? COLORS.primary
                    : "none"
                }
              />
            </View>
            <View style={styles.flex}>
              <Text style={styles.ratingBannerTitle}>
                Customer Satisfaction
              </Text>
              <Text style={styles.ratingBannerNote}>
                {reviews.total_reviews > 0
                  ? `${average} average from ${reviews.total_reviews} reviews`
                  : "No customer ratings received yet"}
              </Text>
            </View>
            <ChevronRight
              size={17}
              color={COLORS.primary}
            />
          </Pressable>
        )}
        <LinearGradient
          colors={[COLORS.surface, COLORS.surfaceDark]}
          style={styles.chartPanel}
        >
          <View style={styles.chartHeading}>
            <View style={styles.flex}>
              <Text style={styles.chartEyebrow}>
                PERFORMANCE
              </Text>
              <Text style={styles.sectionTitle}>
                Booking Overview
              </Text>
              <Text style={styles.secondary}>
                Appointments by scheduled date
              </Text>
            </View>
            <View style={styles.chartIcon}>
              <CalendarDays
                size={20}
                color={COLORS.primary}
              />
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.periodRow}
          >
            {PERIODS.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{
                  selected: period === item.key,
                }}
                onPress={() => setPeriod(item.key)}
                style={({ pressed }) => [
                  styles.periodChip,
                  period === item.key && styles.selectedPeriod,
                  pressed && styles.periodPressed,
                ]}
              >
                <Text
                  style={[
                    styles.periodText,
                    period === item.key && styles.gold,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {bookings === null ? (
            <View style={styles.chartEmpty}>
              {loading ? (
                <ActivityIndicator
                  size="large"
                  color={COLORS.primary}
                />
              ) : (
                <Text style={styles.secondary}>
                  Booking chart unavailable.
                </Text>
              )}
            </View>
          ) : (
            <BookingChart points={points} />
          )}
          <View style={styles.chartFooter}>
            <View>
              <Text style={styles.summaryLabel}>
                BOOKINGS IN THIS PERIOD
              </Text>
              <Text style={styles.summaryValue}>
                {bookings === null
                  ? "—"
                  : periodTotal.toLocaleString("en-IN")}
                <Text style={styles.summaryUnit}>
                  {" appointments"}
                </Text>
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigate("Bookings")}
              style={styles.viewBookings}
            >
              <Text style={styles.viewBookingsText}>
                View All
              </Text>
              <ChevronRight
                size={15}
                color={COLORS.primary}
              />
            </Pressable>
          </View>
        </LinearGradient>
        {!!updatedAt && (
          <View style={styles.updatedRow}>
            <View style={styles.updatedDot} />
            <Text style={styles.updatedText}>
              Bookings updated at {updatedAt}
            </Text>
          </View>
        )}
      </ScrollView>
      <View style={styles.bottomNavigation}>
        {BOTTOM_TABS.map((item) => {
          const central = item.target === "Bookings";
          return (
            <Pressable
              key={item.target}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => navigate(item.target)}
              style={({ pressed }) => [
                styles.bottomTab,
                pressed && styles.bottomPressed,
              ]}
            >
              {central ? (
                <LinearGradient
                  colors={[COLORS.primary, COLORS.warning]}
                  style={styles.centralIcon}
                >
                  <item.icon
                    size={23}
                    color={COLORS.black}
                  />
                </LinearGradient>
              ) : (
                <View style={styles.bottomIcon}>
                  <item.icon
                    size={21}
                    color={COLORS.textSecondary}
                  />
                </View>
              )}
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={[
                  styles.bottomLabel,
                  narrow && styles.bottomLabelSmall,
                  central && styles.gold,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: { flex: 1, minWidth: 0 },
  gold: { color: COLORS.primary },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 75,
    paddingHorizontal: 17,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderDark,
  },
  headerNarrow: {
    paddingHorizontal: 12,
    gap: 7,
  },
  logo: {
    width: 112,
    height: 47,
  },
  logoNarrow: {
    width: 86,
    height: 43,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  headerActionsNarrow: { gap: 5 },
  headerButton: {
    width: 39,
    height: 41,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceDark,
  },
  logoutButton: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  fillButton: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    overflow: "hidden",
  },
  pressOutline: {
    borderColor: COLORS.primary,
  },
  disabled: { opacity: 0.4 },
  unreadBadge: {
    position: "absolute",
    right: -4,
    top: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: {
    color: COLORS.black,
    fontSize: 9,
    fontWeight: "800",
  },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: 17,
    paddingTop: 19,
    paddingBottom: 24,
  },
  hero: {
    position: "relative",
    overflow: "hidden",
    padding: 17,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: 17,
  },
  heroGlow: {
    position: "absolute",
    width: 170,
    height: 170,
    right: -85,
    top: -85,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
    backgroundColor: "rgba(245,158,11,0.035)",
  },
  heroEyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 13,
  },
  eyebrow: {
    color: COLORS.primary,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  greeting: {
    color: COLORS.text,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  username: {
    color: COLORS.primary,
    fontSize: 28,
    lineHeight: 37,
    fontWeight: "800",
    letterSpacing: -0.7,
  },
  greetingNote: {
    color: COLORS.textSecondary,
    fontSize: 10,
    lineHeight: 18,
    marginTop: 5,
  },
  manageButton: {
    width: 91,
    height: 71,
    borderRadius: 13,
    backgroundColor: COLORS.surfaceDark,
  },
  manageText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 7,
  },
  heroFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 17,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  heroFooterText: {
    color: COLORS.textMuted,
    fontSize: 9,
    lineHeight: 16,
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 11,
    marginBottom: 17,
  },
  cardContainer: {
    width: "48.5%",
    minHeight: 154,
    borderRadius: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 2,
  },
  cardGradient: {
    flex: 1,
    width: "100%",
    minHeight: 154,
    padding: 13,
    position: "relative",
    overflow: "hidden",
  },
  cardDecoration: {
    position: "absolute",
    width: 83,
    height: 83,
    borderRadius: 50,
    right: -48,
    top: -36,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.14)",
    backgroundColor: "rgba(245,158,11,0.025)",
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  cardIcon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.18)",
    backgroundColor: "rgba(245,158,11,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "600",
  },
  cardValue: {
    color: COLORS.text,
    fontSize: 29,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: -0.7,
    marginTop: 3,
  },
  cardNote: {
    color: COLORS.textMuted,
    fontSize: 9,
    lineHeight: 15,
    marginTop: 3,
  },
  quickActionsPanel: {
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    marginBottom: 18,
  },
  quickActionsHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 12,
  },
  quickActionsCount: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceDark,
  },
  quickActionsCountText: {
    color: COLORS.textMuted,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  quickActionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
  },
  quickActionContainer: {
    width: "48.5%",
    minHeight: 90,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceDark,
  },
  quickActionContent: {
    width: "100%",
    padding: 10,
  },
  quickActionTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  quickActionIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "rgba(245,158,11,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionTitle: {
    color: COLORS.text,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "800",
  },
  quickActionSubtitle: {
    color: COLORS.textMuted,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 2,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 11,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.error,
    borderRadius: 11,
    backgroundColor: COLORS.surface,
  },
  errorText: {
    flex: 1,
    color: COLORS.error,
    fontSize: 11,
    lineHeight: 18,
  },
  retryText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  ratingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    marginBottom: 17,
  },
  ratingBannerIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245,158,11,0.09)",
    borderRadius: 10,
  },
  ratingBannerTitle: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "800",
  },
  ratingBannerNote: {
    marginTop: 4,
    color: COLORS.textSecondary,
    fontSize: 10,
    lineHeight: 15,
  },
  chartPanel: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chartHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 15,
  },
  chartEyebrow: {
    color: COLORS.primary,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 5,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  secondary: {
    color: COLORS.textSecondary,
    fontSize: 10,
    lineHeight: 18,
    marginTop: 4,
  },
  chartIcon: {
    width: 37,
    height: 37,
    borderRadius: 11,
    backgroundColor: COLORS.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
  },
  periodRow: {
    gap: 7,
    paddingBottom: 6,
  },
  periodChip: {
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceDark,
  },
  selectedPeriod: {
    borderColor: COLORS.primary,
    backgroundColor: "rgba(245,158,11,0.08)",
  },
  periodText: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: "700",
  },
  periodPressed: { opacity: 0.7 },
  chart: {
    width: "100%",
    height: 220,
    marginVertical: 8,
  },
  chartEmpty: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  chartFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderDark,
  },
  summaryLabel: {
    color: COLORS.textMuted,
    fontSize: 8,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  summaryValue: {
    color: COLORS.text,
    fontSize: 23,
    lineHeight: 31,
    fontWeight: "800",
    marginTop: 3,
  },
  summaryUnit: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: "500",
  },
  viewBookings: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewBookingsText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  updatedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 15,
  },
  updatedDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.success,
  },
  updatedText: {
    color: COLORS.textMuted,
    fontSize: 9,
    lineHeight: 17,
  },
  bottomNavigation: {
    minHeight: 79,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 7,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surfaceDark,
  },
  bottomTab: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 3,
  },
  bottomIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  centralIcon: {
    width: 48,
    height: 43,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  bottomLabel: {
    color: COLORS.textSecondary,
    fontSize: 9,
    lineHeight: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  bottomLabelSmall: { fontSize: 8 },
  bottomPressed: { opacity: 0.6 },
});
