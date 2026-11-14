
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
  Alert,
  AppState,
  FlatList,
  Modal,
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

import { useIsFocused } from "@react-navigation/native";

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellRing,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Inbox,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  X,
  type LucideIcon,
} from "lucide-react-native";

import { COLORS } from "../../constants/colors";

import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type BarberNotification,
  type NotificationCategory,
  type NotificationCounts,
} from "../../services/notificationsApi";

// ============================================================
// TYPES
// ============================================================

type Destination =
  | "Bookings"
  | "Rescheduling"
  | "ShopSetup"
  | "Workers"
  | "Dashboard";

type Props = {
  onBack: () => void;
  onNavigate: (screen: Destination) => void;
};

type CardType =
  | "all"
  | "unread"
  | "booking"
  | "rescheduling";

type SummaryCard = {
  key: CardType;
  title: string;
  description: string;
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
const MUTED = C.textSecondary;
const SUCCESS = C.success;
const ERROR = C.error;

const GOLD_SOFT = "rgba(245,158,11,0.09)";
const GOLD_BORDER = "rgba(245,158,11,0.35)";
const GREEN_SOFT = "rgba(34,197,94,0.09)";

const PAGE_SIZE = 15;
const POLL_INTERVAL = 15000;

const EMPTY_COUNTS: NotificationCounts = {
  total: 0,
  unread: 0,
  booking: 0,
  rescheduling: 0,
  other: 0,
};

const SUMMARY_CARDS: SummaryCard[] = [
  {
    key: "all",
    title: "All Notifications",
    description: "Total shop activity",
    icon: Bell,
  },
  {
    key: "unread",
    title: "Unread Alerts",
    description: "Needs attention",
    icon: BellRing,
  },
  {
    key: "booking",
    title: "Booking Alerts",
    description: "Appointment updates",
    icon: CalendarDays,
  },
  {
    key: "rescheduling",
    title: "Rescheduling",
    description: "Schedule changes",
    icon: CalendarClock,
  },
];

// ============================================================
// HELPERS
// ============================================================

function getCategory(
  item: BarberNotification
): string {
  const type = String(item.notification_type);

  if (type.startsWith("reschedule_")) {
    return "Rescheduling";
  }

  if (
    type.startsWith("booking_") ||
    type === "new_booking" ||
    type === "appointment_reminder"
  ) {
    return "Booking";
  }

  if (type === "shop_update") return "Shop";
  if (type === "account_alert") return "Account";

  return "General";
}

function getCategoryIcon(
  category: string
): LucideIcon {
  switch (category) {
    case "Booking":
      return CalendarDays;
    case "Rescheduling":
      return CalendarClock;
    case "Shop":
      return Store;
    case "Account":
      return ShieldCheck;
    default:
      return Bell;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return value || "Date unavailable";
  }

  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getDestination(
  item: BarberNotification
): Destination | null {
  const pathname = item.action_url
    ?.split("?")[0]
    .split("#")[0]
    .replace(/\/+$/, "");

  switch (pathname) {
    case "/bookings":
      return "Bookings";
    case "/rescheduling":
      return "Rescheduling";
    case "/shop-setup":
      return "ShopSetup";
    case "/workers":
      return "Workers";
    case "/dashboard":
      return "Dashboard";
  }

  switch (item.reference_type) {
    case "booking":
      return "Bookings";
    case "rescheduling":
      return "Rescheduling";
    case "worker":
      return "Workers";
    case "shop":
      return "ShopSetup";
    case "account":
      return "Dashboard";
    default:
      return null;
  }
}

function getCount(
  card: CardType,
  counts: NotificationCounts
): number {
  if (card === "all") return counts.total;
  if (card === "unread") return counts.unread;
  return counts[card];
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

// ============================================================
// PREMIUM BUTTON
// ============================================================

function Button({
  title,
  onPress,
  primary = false,
  disabled = false,
  busy = false,
  icon,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{
        disabled: disabled || busy,
        busy,
      }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.primaryButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={primary ? BG : GOLD}
        />
      ) : (
        icon
      )}

      <Text
        style={[
          styles.buttonText,
          primary && styles.primaryButtonText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

// ============================================================
// NOTICES
// ============================================================

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
    <View
      style={[
        styles.notice,
        { borderColor: `${color}65` },
      ]}
    >
      {success ? (
        <CheckCircle2 size={18} color={color} />
      ) : (
        <ShieldCheck size={18} color={color} />
      )}

      <Text
        style={[
          styles.noticeText,
          { color },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

// ============================================================
// SUMMARY CARD
// ============================================================

function PremiumSummaryCard({
  item,
  count,
  active,
  disabled,
  onPress,
}: {
  item: SummaryCard;
  count: number | string;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const Icon = item.icon;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{
        selected: active,
        disabled,
      }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.summaryCard,
        active && styles.summaryCardActive,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
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
          styles.summaryValue,
          active && { color: GOLD },
        ]}
      >
        {count}
      </Text>

      <Text style={styles.summaryTitle}>
        {item.title}
      </Text>

      <Text style={styles.summaryDescription}>
        {item.description}
      </Text>
    </Pressable>
  );
}

// ============================================================
// NOTIFICATION CARD
// ============================================================

function NotificationCard({
  item,
  disabled,
  onMarkRead,
  onOpen,
}: {
  item: BarberNotification;
  disabled: boolean;
  onMarkRead: (item: BarberNotification) => void;
  onOpen: (item: BarberNotification) => void;
}) {
  const category = getCategory(item);
  const Icon = getCategoryIcon(category);
  const unread = !item.is_read;

  return (
    <View
      style={[
        styles.notificationCard,
        unread && styles.unreadCard,
      ]}
    >
      <View
        style={[
          styles.cardAccent,
          unread && styles.unreadAccent,
        ]}
      />

      <View style={styles.notificationHeader}>
        <View
          style={[
            styles.notificationIcon,
            unread && styles.unreadIcon,
          ]}
        >
          <Icon
            size={21}
            color={unread ? GOLD : MUTED}
          />
        </View>

        <View style={styles.flex}>
          <Text
            numberOfLines={2}
            style={styles.notificationTitle}
          >
            {item.title}
          </Text>

          <Text style={styles.categoryLabel}>
            {category.toUpperCase()}
          </Text>
        </View>

        {unread ? (
          <View style={styles.newBadge}>
            <View style={styles.newDot} />
            <Text style={styles.newBadgeText}>
              NEW
            </Text>
          </View>
        ) : (
          <View style={styles.readBadge}>
            <Check size={12} color={SUCCESS} />
            <Text style={styles.readBadgeText}>
              READ
            </Text>
          </View>
        )}
      </View>

      <View style={styles.cardDivider} />

      <Text style={styles.notificationMessage}>
        {item.message}
      </Text>

      <View style={styles.timeRow}>
        <Clock3
          size={13}
          color={C.textMuted}
        />

        <Text style={styles.timestamp}>
          {formatDate(item.created_at)}
        </Text>
      </View>

      <View style={styles.cardActions}>
        {unread && (
          <Button
            title="Mark Read"
            disabled={disabled}
            icon={
              <CheckCheck
                size={15}
                color={GOLD}
              />
            }
            onPress={() => onMarkRead(item)}
          />
        )}

        <Button
          title="View Details"
          primary
          disabled={disabled}
          icon={
            <ArrowRight
              size={15}
              color={BG}
            />
          }
          onPress={() => onOpen(item)}
        />
      </View>
    </View>
  );
}

// ============================================================
// MAIN SCREEN
// ============================================================

export default function NotificationsScreen({
  onBack,
  onNavigate,
}: Props) {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [card, setCard] =
    useState<CardType>("all");

  const [offset, setOffset] = useState(0);

  const [notifications, setNotifications] =
    useState<BarberNotification[]>([]);

  const [counts, setCounts] =
    useState<NotificationCounts>(EMPTY_COUNTS);

  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [reload, setReload] = useState(0);

  const [detail, setDetail] =
    useState<BarberNotification | null>(null);

  const mounted = useRef(false);
  const focusedRef = useRef(focused);
  const actionBusy = useRef(false);
  const fetching = useRef(false);
  const version = useRef(0);

  const controller =
    useRef<AbortController | null>(null);

  const list =
    useRef<FlatList<BarberNotification>>(null);

  focusedRef.current = focused;

  const queryKey = `${card}:${offset}`;
  const currentPageLoaded = loadedKey === queryKey;
  const busy = loading || refreshing || saving;

  // ==========================================================
  // LOAD NOTIFICATIONS
  // ==========================================================

  const load = useCallback(
    async (
      mode: "initial" | "refresh" | "poll" = "initial"
    ) => {
      if (
        !mounted.current ||
        !focusedRef.current ||
        actionBusy.current
      ) {
        return;
      }

      if (mode === "poll" && fetching.current) {
        return;
      }

      const current = ++version.current;

      controller.current?.abort();

      const abort = new AbortController();
      controller.current = abort;
      fetching.current = true;

      if (mode === "initial") {
        setLoading(true);
        setRefreshing(false);
      } else if (mode === "refresh") {
        setRefreshing(true);
        setLoading(false);
      }

      try {
        const category: NotificationCategory =
          card === "booking" ||
          card === "rescheduling"
            ? card
            : "all";

        const response = await getNotifications(
          {
            category,
            unreadOnly: card === "unread",
            limit: PAGE_SIZE,
            offset,
          },
          abort.signal
        );

        if (
          !mounted.current ||
          abort.signal.aborted ||
          current !== version.current
        ) {
          return;
        }

        const lastOffset =
          response.total > 0
            ? Math.floor(
                (response.total - 1) / PAGE_SIZE
              ) * PAGE_SIZE
            : 0;

        if (offset > lastOffset) {
          setOffset(lastOffset);
          return;
        }

        setNotifications(response.notifications);
        setCounts(response.counts);
        setTotal(response.total);

        setLoaded(true);
        setLoadedKey(`${card}:${offset}`);
        setError("");
      } catch (err: unknown) {
        if (
          mounted.current &&
          !abort.signal.aborted &&
          current === version.current
        ) {
          setError(messageOf(err));
        }
      } finally {
        if (
          mounted.current &&
          current === version.current
        ) {
          fetching.current = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [card, offset]
  );

  // ==========================================================
  // MOUNT / UNMOUNT
  // ==========================================================

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      version.current += 1;
      controller.current?.abort();
    };
  }, []);

  // ==========================================================
  // AUTO REFRESH
  // ==========================================================

  useEffect(() => {
    if (!focused) return;

    void load("initial");

    const interval = setInterval(() => {
      if (
        AppState.currentState === "active" &&
        !actionBusy.current
      ) {
        void load("poll");
      }
    }, POLL_INTERVAL);

    const subscription = AppState.addEventListener(
      "change",
      (state) => {
        if (
          state === "active" &&
          focusedRef.current &&
          !actionBusy.current &&
          !fetching.current
        ) {
          void load("poll");
        }
      }
    );

    return () => {
      clearInterval(interval);
      subscription.remove();
      version.current += 1;
      controller.current?.abort();
      fetching.current = false;
    };
  }, [focused, load, reload]);

  // ==========================================================
  // FILTER SEARCH
  // ==========================================================

  const visibleNotifications = useMemo(() => {
    if (!currentPageLoaded) return [];

    const query = search.trim().toLowerCase();

    if (!query) return notifications;

    return notifications.filter((item) =>
      [
        item.title,
        item.message,
        getCategory(item),
      ].some((value) =>
        String(value)
          .toLowerCase()
          .includes(query)
      )
    );
  }, [
    notifications,
    search,
    currentPageLoaded,
  ]);

  // ==========================================================
  // REFRESH
  // ==========================================================

  const refresh = () => {
    if (actionBusy.current || fetching.current) {
      return;
    }

    setSuccess("");
    void load("refresh");
  };

  // ==========================================================
  // CHANGE CATEGORY
  // ==========================================================

  const changeCard = (next: CardType) => {
    if (next === card || actionBusy.current) {
      return;
    }

    version.current += 1;
    controller.current?.abort();
    fetching.current = false;

    setLoading(true);
    setCard(next);
    setOffset(0);
    setSearch("");
    setSuccess("");
    setError("");

    list.current?.scrollToOffset({
      offset: 0,
      animated: true,
    });
  };

  // ==========================================================
  // CHANGE PAGE
  // ==========================================================

  const changePage = (next: number) => {
    if (busy || !currentPageLoaded) return;

    version.current += 1;
    controller.current?.abort();
    fetching.current = false;

    setLoading(true);
    setOffset(next);
    setSearch("");
    setSuccess("");
    setError("");

    list.current?.scrollToOffset({
      offset: 0,
      animated: true,
    });
  };

  // ==========================================================
  // CANCEL IN-FLIGHT FETCH BEFORE A MUTATION
  // ==========================================================

  const stopOldFetch = () => {
    version.current += 1;
    controller.current?.abort();
    fetching.current = false;
    setLoading(false);
    setRefreshing(false);
  };

  // ==========================================================
  // MARK SINGLE NOTIFICATION READ
  // ==========================================================

  const markOneRead = async (
    item: BarberNotification,
    showMessage = true
  ): Promise<boolean> => {
    if (actionBusy.current) return false;
    if (item.is_read) return true;

    actionBusy.current = true;

    stopOldFetch();

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const result =
        await markNotificationAsRead(item.id);

      if (!mounted.current) {
        return false;
      }

      setNotifications((previous) =>
        previous.map((notification) =>
          notification.id === result.notification.id
            ? result.notification
            : notification
        )
      );

      setDetail((previous) =>
        previous?.id === result.notification.id
          ? result.notification
          : previous
      );

      setCounts((previous) => ({
        ...previous,
        unread: Math.max(0, previous.unread - 1),
      }));

      if (card === "unread") {
        setNotifications((previous) =>
          previous.filter(
            (notification) =>
              notification.id !== item.id
          )
        );

        setTotal((previous) =>
          Math.max(0, previous - 1)
        );

        setOffset(0);
      }

      if (showMessage) {
        setSuccess(
          result.message ||
            "Notification marked as read."
        );
      }

      return true;
    } catch (err: unknown) {
      if (mounted.current) {
        setError(messageOf(err));
      }

      return false;
    } finally {
      actionBusy.current = false;

      if (mounted.current) {
        setSaving(false);
        setReload((value) => value + 1);
      }
    }
  };

  // ==========================================================
  // OPEN NOTIFICATION
  // ==========================================================

  const openNotification = async (
    item: BarberNotification
  ) => {
    if (actionBusy.current) return;

    const destination = getDestination(item);

    const updated = await markOneRead(
      item,
      false
    );

    if (
      !updated ||
      !mounted.current ||
      !focusedRef.current
    ) {
      return;
    }

    if (destination) {
      onNavigate(destination);
    } else {
      setDetail({
        ...item,
        is_read: true,
      });
    }
  };

  // ==========================================================
  // MARK ALL AS READ
  // ==========================================================

  const performMarkAll = async () => {
    if (
      actionBusy.current ||
      counts.unread <= 0
    ) {
      return;
    }

    actionBusy.current = true;

    stopOldFetch();

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const result =
        await markAllNotificationsAsRead();

      if (!mounted.current) return;

      setCounts((previous) => ({
        ...previous,
        unread: result.unread_count,
      }));

      setNotifications((previous) =>
        card === "unread"
          ? []
          : previous.map((item) => ({
              ...item,
              is_read: true,
            }))
      );

      if (card === "unread") {
        setTotal(0);
        setOffset(0);
      }

      setSuccess(
        `${result.updated_count} notification${
          result.updated_count === 1
            ? ""
            : "s"
        } marked as read.`
      );
    } catch (err: unknown) {
      if (mounted.current) {
        setError(messageOf(err));
      }
    } finally {
      actionBusy.current = false;

      if (mounted.current) {
        setSaving(false);
        setReload((value) => value + 1);
      }
    }
  };

  const confirmMarkAll = () => {
    if (
      busy ||
      counts.unread <= 0
    ) {
      return;
    }

    Alert.alert(
      "Mark All Notifications as Read?",
      "This will mark every unread notification as read, including bookings and rescheduling alerts.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Mark All Read",
          onPress: () => {
            void performMarkAll();
          },
        },
      ]
    );
  };

  // ==========================================================
  // PAGINATION
  // ==========================================================

  const page =
    Math.floor(offset / PAGE_SIZE) + 1;

  const pages = Math.max(
    1,
    Math.ceil(total / PAGE_SIZE)
  );

  const metricWidth =
    width < 340
      ? "100%"
      : width >= 760
      ? "23.5%"
      : "48.5%";

  // ==========================================================
  // MAIN UI
  // ==========================================================

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={styles.container}
    >
      {/* HEADER */}

      <View style={styles.topbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to dashboard"
          disabled={saving}
          onPress={onBack}
          style={styles.iconButton}
        >
          <ArrowLeft
            size={20}
            color={C.text}
          />
        </Pressable>

        <View style={styles.flex}>
          <Text style={styles.eyebrow}>
            KSHURAK BARBER
          </Text>

          <Text style={styles.topbarTitle}>
            Notifications
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh notifications"
          disabled={busy}
          onPress={refresh}
          style={[
            styles.iconButton,
            busy && styles.disabled,
          ]}
        >
          {loading || refreshing ? (
            <ActivityIndicator
              size="small"
              color={GOLD}
            />
          ) : (
            <RefreshCw
              size={19}
              color={GOLD}
            />
          )}
        </Pressable>
      </View>

      <FlatList
        ref={list}
        data={visibleNotifications}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={refresh}
        initialNumToRender={8}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Math.max(
              28,
              insets.bottom + 25
            ),
          },
        ]}
        renderItem={({ item }) => (
          <NotificationCard
            item={item}
            disabled={saving}
            onMarkRead={(notification) => {
              void markOneRead(notification);
            }}
            onOpen={(notification) => {
              void openNotification(notification);
            }}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={{ height: 12 }} />
        )}
        ListHeaderComponent={
          <View>
            {/* PREMIUM HERO */}

            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <View style={styles.heroIcon}>
                  <BellRing
                    size={26}
                    color={GOLD}
                  />
                </View>

                <View style={styles.heroBadge}>
                  <Sparkles
                    size={13}
                    color={GOLD}
                  />

                  <Text style={styles.heroBadgeText}>
                    ACTIVITY CENTER
                  </Text>
                </View>
              </View>

              <Text style={styles.heroTitle}>
                Stay Informed.
                {"\n"}
                <Text style={styles.heroGold}>
                  Stay Ahead.
                </Text>
              </Text>

              <Text style={styles.heroDescription}>
                Track booking confirmations,
                appointment changes and important
                shop notifications in one place.
              </Text>

              <View style={styles.heroFooter}>
                <View style={styles.heroMetric}>
                  <Text style={styles.heroMetricValue}>
                    {loaded ? counts.total : "—"}
                  </Text>

                  <Text style={styles.heroMetricLabel}>
                    TOTAL ALERTS
                  </Text>
                </View>

                <View style={styles.heroMetricDivider} />

                <View style={styles.heroMetric}>
                  <Text
                    style={[
                      styles.heroMetricValue,
                      { color: GOLD },
                    ]}
                  >
                    {loaded ? counts.unread : "—"}
                  </Text>

                  <Text style={styles.heroMetricLabel}>
                    UNREAD
                  </Text>
                </View>

                <View style={styles.heroMetricDivider} />

                <View style={styles.heroMetric}>
                  <Text style={styles.heroMetricValue}>
                    {loaded
                      ? counts.booking +
                        counts.rescheduling
                      : "—"}
                  </Text>

                  <Text style={styles.heroMetricLabel}>
                    APPOINTMENT ALERTS
                  </Text>
                </View>
              </View>
            </View>

            {/* MARK ALL READ */}

            <View style={styles.quickAction}>
              <View style={styles.quickActionIcon}>
                <CheckCheck
                  size={21}
                  color={GOLD}
                />
              </View>

              <View style={styles.flex}>
                <Text style={styles.quickActionTitle}>
                  Clear Unread Alerts
                </Text>

                <Text style={styles.quickActionSubtitle}>
                  Mark your notifications as read
                </Text>
              </View>
            </View>

            <Button
              title={
                saving
                  ? "Updating..."
                  : "Mark All as Read"
              }
              disabled={
                busy ||
                !loaded ||
                counts.unread <= 0
              }
              busy={saving}
              icon={
                <CheckCheck
                  size={16}
                  color={GOLD}
                />
              }
              onPress={confirmMarkAll}
            />

            <View style={styles.noticeArea}>
              <Notice text={error} />
              <Notice text={success} success />
            </View>

            {/* SUMMARY CARDS */}

            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionEyebrow}>
                  LIVE ACTIVITY
                </Text>

                <Text style={styles.sectionTitle}>
                  Notification Insights
                </Text>
              </View>

              <View style={styles.sectionIcon}>
                <Bell
                  size={17}
                  color={GOLD}
                />
              </View>
            </View>

            <View style={styles.summaryGrid}>
              {SUMMARY_CARDS.map((item) => (
                <View
                  key={item.key}
                  style={{
                    width: metricWidth,
                  }}
                >
                  <PremiumSummaryCard
                    item={item}
                    count={
                      loaded
                        ? getCount(item.key, counts)
                        : "—"
                    }
                    active={card === item.key}
                    disabled={saving}
                    onPress={() =>
                      changeCard(item.key)
                    }
                  />
                </View>
              ))}
            </View>

            {/* NOTIFICATION RECORDS */}

            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionEyebrow}>
                  ACTIVITY HISTORY
                </Text>

                <Text style={styles.sectionTitle}>
                  {
                    SUMMARY_CARDS.find(
                      (item) => item.key === card
                    )?.title
                  }
                </Text>
              </View>

              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>
                  {currentPageLoaded ? total : "—"}
                </Text>
              </View>
            </View>

            <View style={styles.searchBox}>
              <Search
                size={18}
                color={MUTED}
              />

              <TextInput
                accessibilityLabel="Search notifications on the current page"
                value={search}
                onChangeText={setSearch}
                placeholder="Search notifications..."
                placeholderTextColor={C.textMuted}
                selectionColor={GOLD}
                autoCorrect={false}
                style={styles.searchInput}
              />

              {!!search && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearch("")}
                >
                  <X
                    size={17}
                    color={MUTED}
                  />
                </Pressable>
              )}
            </View>

            <View style={styles.listHeading}>
              <Text style={styles.listHeadingText}>
                Recent Activity
              </Text>

              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />

                <Text style={styles.liveText}>
                  AUTO REFRESH
                </Text>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            {loading && !currentPageLoaded ? (
              <>
                <ActivityIndicator
                  size="large"
                  color={GOLD}
                />

                <Text style={styles.emptyTitle}>
                  Loading Notifications
                </Text>

                <Text style={styles.emptyDescription}>
                  Checking your latest shop activity...
                </Text>
              </>
            ) : (
              <>
                <View style={styles.emptyIcon}>
                  <Inbox
                    size={30}
                    color={GOLD}
                  />
                </View>

                <Text style={styles.emptyTitle}>
                  {error
                    ? "Unable to Load Notifications"
                    : "You're All Caught Up"}
                </Text>

                <Text style={styles.emptyDescription}>
                  {error
                    ? "Check your network connection and refresh."
                    : search
                    ? "No notifications match your search."
                    : "No notifications are available in this category."}
                </Text>

                <Button
                  title="Refresh"
                  icon={
                    <RefreshCw
                      size={15}
                      color={GOLD}
                    />
                  }
                  disabled={busy}
                  onPress={refresh}
                />
              </>
            )}
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {currentPageLoaded && total > 0 && (
              <>
                <Text style={styles.pageText}>
                  Page {page} of {pages}
                  {" · "}
                  Showing{" "}
                  {offset + 1}–
                  {Math.min(
                    offset + PAGE_SIZE,
                    total
                  )}{" "}
                  of {total}
                </Text>

                <View style={styles.pagination}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || offset === 0}
                    onPress={() =>
                      changePage(
                        Math.max(
                          0,
                          offset - PAGE_SIZE
                        )
                      )
                    }
                    style={[
                      styles.pageButton,
                      (busy || offset === 0) &&
                        styles.disabled,
                    ]}
                  >
                    <ChevronLeft
                      size={17}
                      color={GOLD}
                    />
                    <Text style={styles.pageButtonText}>
                      Previous
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    disabled={
                      busy ||
                      offset + PAGE_SIZE >= total
                    }
                    onPress={() =>
                      changePage(
                        offset + PAGE_SIZE
                      )
                    }
                    style={[
                      styles.pageButton,
                      (busy ||
                        offset + PAGE_SIZE >= total) &&
                        styles.disabled,
                    ]}
                  >
                    <Text style={styles.pageButtonText}>
                      Next
                    </Text>
                    <ChevronRight
                      size={17}
                      color={GOLD}
                    />
                  </Pressable>
                </View>
              </>
            )}

            <View style={styles.footerNoteRow}>
              <RefreshCw
                size={12}
                color={C.textMuted}
              />
              <Text style={styles.footerNote}>
                Automatically checks for new alerts
                while this screen is active.
              </Text>
            </View>
          </View>
        }
      />

      {/* NOTIFICATION DETAILS MODAL */}

      <Modal
        visible={detail !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDetail(null)}
      >
        <View
          style={[
            styles.overlay,
            {
              paddingTop: Math.max(
                16,
                insets.top
              ),
              paddingBottom: Math.max(
                16,
                insets.bottom
              ),
            },
          ]}
        >
          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <View style={styles.flex}>
                <Text style={styles.detailEyebrow}>
                  KSHURAK NOTIFICATION
                </Text>

                <Text style={styles.detailHeading}>
                  Notification Details
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close notification"
                onPress={() => setDetail(null)}
                style={styles.iconButton}
              >
                <X
                  size={20}
                  color={C.text}
                />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.detailBody}
              showsVerticalScrollIndicator={false}
            >
              {detail && (
                <>
                  <View style={styles.detailHeroIcon}>
                    <BellRing
                      size={26}
                      color={GOLD}
                    />
                  </View>

                  <Text style={styles.detailTitle}>
                    {detail.title}
                  </Text>

                  <View style={styles.detailCategory}>
                    <Text style={styles.detailCategoryText}>
                      {getCategory(
                        detail
                      ).toUpperCase()}
                    </Text>
                  </View>

                  <Text style={styles.detailMessage}>
                    {detail.message}
                  </Text>

                  <View style={styles.detailTimestamp}>
                    <Clock3
                      size={15}
                      color={MUTED}
                    />

                    <Text style={styles.timestamp}>
                      {formatDate(
                        detail.created_at
                      )}
                    </Text>
                  </View>

                  <View style={styles.detailActions}>
                    <Button
                      title="Close"
                      primary
                      onPress={() =>
                        setDetail(null)
                      }
                    />
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ============================================================
// PREMIUM STYLES
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  flex: {
    flex: 1,
    minWidth: 0,
  },

  topbar: {
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    alignItems: "center",
    justifyContent: "center",
  },

  eyebrow: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
  },

  topbarTitle: {
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
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 22,
    padding: 19,
    overflow: "hidden",
    marginBottom: 16,
  },

  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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

  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 20,
  },

  heroBadgeText: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },

  heroTitle: {
    color: C.text,
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 38,
    marginTop: 20,
    letterSpacing: -0.5,
  },

  heroGold: {
    color: GOLD,
  },

  heroDescription: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 21,
    marginTop: 11,
  },

  heroFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  heroMetric: {
    flex: 1,
    alignItems: "center",
  },

  heroMetricValue: {
    color: C.text,
    fontSize: 24,
    fontWeight: "900",
  },

  heroMetricLabel: {
    color: MUTED,
    fontSize: 8,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 7,
    letterSpacing: 0.3,
  },

  heroMetricDivider: {
    width: 1,
    height: 33,
    backgroundColor: BORDER,
  },

  quickAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 13,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    marginBottom: 9,
  },

  quickActionIcon: {
    width: 41,
    height: 41,
    borderRadius: 11,
    backgroundColor: GOLD_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  quickActionTitle: {
    color: C.text,
    fontSize: 12,
    fontWeight: "900",
  },

  quickActionSubtitle: {
    color: MUTED,
    fontSize: 10,
    marginTop: 5,
  },

  button: {
    minHeight: 44,
    flexGrow: 1,
    flexBasis: 100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 8,
    borderWidth: 1,
    borderColor: C.borderLight,
    backgroundColor: LIGHT,
    borderRadius: 11,
  },

  primaryButton: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },

  buttonText: {
    color: C.text,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
    flexShrink: 1,
  },

  primaryButtonText: {
    color: BG,
  },

  disabled: {
    opacity: 0.4,
  },

  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },

  noticeArea: {
    marginTop: 12,
  },

  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: SURFACE,
    marginBottom: 10,
  },

  noticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 19,
  },

  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 11,
    marginBottom: 13,
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

  sectionIcon: {
    width: 37,
    height: 37,
    borderRadius: 11,
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
    marginBottom: 21,
  },

  summaryCard: {
    minHeight: 150,
    padding: 14,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    overflow: "hidden",
  },

  summaryCardActive: {
    backgroundColor: "#211B11",
    borderColor: GOLD,
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
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: GOLD_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  summaryValue: {
    color: C.text,
    fontSize: 29,
    fontWeight: "900",
    marginTop: 12,
  },

  summaryTitle: {
    color: C.text,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 4,
  },

  summaryDescription: {
    color: MUTED,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },

  countBadge: {
    minWidth: 37,
    height: 37,
    borderRadius: 11,
    paddingHorizontal: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },

  countBadgeText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
  },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    gap: 10,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: C.borderLight,
    borderRadius: 12,
    paddingHorizontal: 13,
    marginBottom: 17,
  },

  searchInput: {
    flex: 1,
    minWidth: 0,
    color: C.text,
    fontSize: 12,
    paddingVertical: 10,
  },

  listHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 13,
  },

  listHeadingText: {
    color: C.text,
    fontSize: 15,
    fontWeight: "900",
  },

  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.3)",
    backgroundColor: GREEN_SOFT,
  },

  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: SUCCESS,
  },

  liveText: {
    color: SUCCESS,
    fontSize: 9,
    fontWeight: "900",
  },

  notificationCard: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 17,
    padding: 15,
    overflow: "hidden",
  },

  unreadCard: {
    borderColor: GOLD_BORDER,
    backgroundColor: "#1C1A16",
  },

  cardAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: 3,
    backgroundColor: BORDER,
  },

  unreadAccent: {
    backgroundColor: GOLD,
  },

  notificationHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  notificationIcon: {
    width: 45,
    height: 45,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
  },

  unreadIcon: {
    backgroundColor: GOLD_SOFT,
    borderColor: GOLD_BORDER,
  },

  notificationTitle: {
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "900",
  },

  categoryLabel: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
    marginTop: 5,
  },

  newBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    backgroundColor: GOLD_SOFT,
  },

  newDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GOLD,
  },

  newBadgeText: {
    color: GOLD,
    fontSize: 8,
    fontWeight: "900",
  },

  readBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 20,
    backgroundColor: GREEN_SOFT,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.3)",
  },

  readBadgeText: {
    color: SUCCESS,
    fontSize: 8,
    fontWeight: "900",
  },

  cardDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 13,
  },

  notificationMessage: {
    color: C.textSecondary,
    fontSize: 12,
    lineHeight: 21,
  },

  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
  },

  timestamp: {
    color: MUTED,
    fontSize: 10,
    lineHeight: 17,
    flexShrink: 1,
  },

  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 14,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  emptyCard: {
    minHeight: 225,
    padding: 26,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 17,
    backgroundColor: SURFACE,
  },

  emptyIcon: {
    width: 66,
    height: 66,
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
    lineHeight: 19,
    textAlign: "center",
  },

  footer: {
    marginTop: 21,
  },

  pageText: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
    textAlign: "center",
    fontWeight: "700",
  },

  pagination: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },

  pageButton: {
    flex: 1,
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 11,
  },

  pageButtonText: {
    color: C.text,
    fontSize: 11,
    fontWeight: "900",
  },

  footerNoteRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 7,
    marginTop: 18,
  },

  footerNote: {
    color: C.textMuted,
    fontSize: 10,
    lineHeight: 17,
    textAlign: "center",
    flexShrink: 1,
  },

  overlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "rgba(0,0,0,0.87)",
  },

  detailCard: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "90%",
    alignSelf: "center",
    borderRadius: 19,
    borderWidth: 1,
    borderColor: C.borderLight,
    backgroundColor: SURFACE,
    overflow: "hidden",
  },

  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  detailEyebrow: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },

  detailHeading: {
    color: C.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 5,
  },

  detailBody: {
    padding: 17,
    paddingBottom: 26,
    alignItems: "center",
  },

  detailHeroIcon: {
    width: 68,
    height: 68,
    borderRadius: 21,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },

  detailTitle: {
    color: C.text,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "900",
    textAlign: "center",
  },

  detailCategory: {
    paddingVertical: 8,
    paddingHorizontal: 13,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 20,
    marginTop: 13,
  },

  detailCategoryText: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
  },

  detailMessage: {
    color: C.textSecondary,
    fontSize: 12,
    lineHeight: 22,
    textAlign: "center",
    marginVertical: 20,
  },

  detailTimestamp: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 11,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
  },

  detailActions: {
    width: "100%",
    flexDirection: "row",
    marginTop: 23,
  },
});
