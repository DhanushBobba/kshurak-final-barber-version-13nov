
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
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit3,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react-native";

import { COLORS } from "../../constants/colors";

import {
  createBarberService,
  getBarberServices,
  setBarberServiceStatus,
  updateBarberService,
  type BarberService,
  type ServicePayload,
  type ServiceActionResponse,
} from "../../services/servicesApi";

// ============================================================
// TYPES
// ============================================================

type Props = {
  onBack: () => void;
};

type StatusFilter = "all" | "active" | "inactive";

type Category =
  | "all"
  | "haircut"
  | "beard"
  | "shave"
  | "facial"
  | "haircare"
  | "package"
  | "other";

type FormValues = {
  service_name: string;
  description: string;
  duration_minutes: string;
  price: string;
};

type Metric = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: "gold" | "green" | "muted";
};

// ============================================================
// CONSTANTS
// ============================================================

const PAGE_SIZE = 8;

const EMPTY_FORM: FormValues = {
  service_name: "",
  description: "",
  duration_minutes: "30",
  price: "",
};

const CATEGORIES: {
  key: Category;
  title: string;
}[] = [
  { key: "all", title: "All Services" },
  { key: "haircut", title: "Haircuts" },
  { key: "beard", title: "Beard" },
  { key: "shave", title: "Shaving" },
  { key: "facial", title: "Facials" },
  { key: "haircare", title: "Hair Care" },
  { key: "package", title: "Packages" },
  { key: "other", title: "Other" },
];

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
const GREEN_BORDER = "rgba(34,197,94,0.35)";

// ============================================================
// HELPERS
// ============================================================

function getCategory(name: string): Category {
  const value = String(name || "").toLowerCase();

  if (/package|combo|bundle|ritual/.test(value))
    return "package";

  if (/beard|moustache/.test(value))
    return "beard";

  if (/shave|shaving/.test(value))
    return "shave";

  if (/facial|face|skin|cleanup/.test(value))
    return "facial";

  if (/haircut|hair cut|fade|scissor/.test(value))
    return "haircut";

  if (/hair|spa|color|colour/.test(value))
    return "haircare";

  return "other";
}

function categoryLabel(category: Category): string {
  return (
    CATEGORIES.find((item) => item.key === category)?.title ||
    "Other"
  );
}

function formatPrice(value: number | string): string {
  const amount = Number(value);

  return Number.isFinite(amount)
    ? `₹${amount.toLocaleString("en-IN", {
        maximumFractionDigits: 2,
      })}`
    : "—";
}

function formatDuration(value: number): string {
  const minutes = Number(value);

  if (!Number.isFinite(minutes)) return "—";

  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60} hr`;
  }

  return `${minutes} min`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

function validateForm(values: FormValues): ServicePayload {
  const service_name = values.service_name.trim();
  const description = values.description.trim();
  const duration = Number(values.duration_minutes);
  const price = Number(values.price);

  if (!service_name || service_name.length > 150) {
    throw new Error(
      "Service name must contain 1 to 150 characters."
    );
  }

  if (description.length > 2000) {
    throw new Error(
      "Description must not exceed 2000 characters."
    );
  }

  if (
    !values.duration_minutes.trim() ||
    !Number.isInteger(duration) ||
    duration < 5 ||
    duration > 480
  ) {
    throw new Error(
      "Duration must be between 5 and 480 minutes."
    );
  }

  if (
    !/^\d+(\.\d{1,2})?$/.test(values.price.trim()) ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 9999999999.99
  ) {
    throw new Error("Enter a valid service price.");
  }

  return {
    service_name,
    description: description || null,
    duration_minutes: duration,
    price,
  };
}

// ============================================================
// REUSABLE BUTTON
// ============================================================

function ActionButton({
  title,
  onPress,
  icon: Icon,
  primary = false,
  danger = false,
  disabled = false,
  loading = false,
}: {
  title: string;
  onPress: () => void;
  icon?: LucideIcon;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  const color = primary
    ? BG
    : danger
    ? ERROR
    : GOLD;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        primary && styles.actionPrimary,
        danger && styles.actionDanger,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={color} />
      ) : Icon ? (
        <Icon size={15} color={color} />
      ) : null}

      <Text
        style={[
          styles.actionText,
          primary && styles.actionPrimaryText,
          danger && { color: ERROR },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

// ============================================================
// NOTIFICATION
// ============================================================

function Notice({
  message,
  success = false,
}: {
  message: string;
  success?: boolean;
}) {
  if (!message) return null;

  const color = success ? SUCCESS : ERROR;

  return (
    <View
      style={[
        styles.notice,
        { borderColor: `${color}70` },
      ]}
    >
      <CheckCircle2 size={18} color={color} />

      <Text style={[styles.noticeText, { color }]}>
        {message}
      </Text>
    </View>
  );
}

// ============================================================
// METRIC CARD
// ============================================================

function MetricCard({ item }: { item: Metric }) {
  const Icon = item.icon;

  const color =
    item.tone === "green"
      ? SUCCESS
      : item.tone === "muted"
      ? MUTED
      : GOLD;

  return (
    <View style={styles.metricCard}>
      <View style={styles.metricTop}>
        <View style={styles.metricIcon}>
          <Icon size={19} color={color} />
        </View>
        <View
          style={[
            styles.metricDot,
            { backgroundColor: color },
          ]}
        />
      </View>

      <Text style={[styles.metricValue, { color }]}>
        {item.value}
      </Text>

      <Text style={styles.metricLabel}>
        {item.label}
      </Text>

      <View style={styles.metricFooter}>
        <View
          style={[
            styles.metricLine,
            { backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );
}

// ============================================================
// PREMIUM SERVICE CARD
// ============================================================

function ServiceCard({
  service,
  saving,
  onEdit,
  onToggle,
}: {
  service: BarberService;
  saving: boolean;
  onEdit: (service: BarberService) => void;
  onToggle: (service: BarberService) => void;
}) {
  const active = Boolean(service.is_active);
  const category = getCategory(service.service_name);

  return (
    <View style={styles.serviceCard}>
      <View
        style={[
          styles.serviceAccent,
          !active && styles.inactiveAccent,
        ]}
      />

      <View style={styles.serviceHeader}>
        <View style={styles.serviceIcon}>
          <Scissors size={22} color={GOLD} />
        </View>

        <View style={styles.flex}>
          <Text style={styles.serviceCategory}>
            {categoryLabel(category).toUpperCase()}
          </Text>

          <Text
            numberOfLines={2}
            style={styles.serviceName}
          >
            {service.service_name}
          </Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            active
              ? styles.statusActive
              : styles.statusInactive,
          ]}
        >
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: active ? SUCCESS : MUTED,
              },
            ]}
          />
          <Text
            style={[
              styles.statusText,
              { color: active ? SUCCESS : MUTED },
            ]}
          >
            {active ? "ACTIVE" : "INACTIVE"}
          </Text>
        </View>
      </View>

      <View style={styles.serviceDivider} />

      <Text
        numberOfLines={3}
        style={styles.serviceDescription}
      >
        {service.description ||
          "A professional grooming service curated for your customers."}
      </Text>

      <View style={styles.serviceInfoRow}>
        <View style={styles.pricePanel}>
          <Text style={styles.infoLabel}>
            SERVICE PRICE
          </Text>

          <Text style={styles.priceValue}>
            {formatPrice(service.price)}
          </Text>
        </View>

        <View style={styles.durationPanel}>
          <Text style={styles.infoLabel}>
            DURATION
          </Text>

          <View style={styles.durationValueRow}>
            <Clock3 size={16} color={GOLD} />
            <Text style={styles.durationValue}>
              {formatDuration(service.duration_minutes)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.serviceFooter}>
        <ActionButton
          title="Edit Service"
          icon={Edit3}
          disabled={saving}
          onPress={() => onEdit(service)}
        />

        <ActionButton
          title={active ? "Deactivate" : "Activate"}
          icon={CheckCircle2}
          primary={!active}
          danger={active}
          disabled={saving}
          onPress={() => onToggle(service)}
        />
      </View>
    </View>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function ServicesScreen({
  onBack,
}: Props) {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const mounted = useRef(false);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mutation = useRef(false);

  const [services, setServices] =
    useState<BarberService[]>([]);

  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [status, setStatus] =
    useState<StatusFilter>("all");

  const [category, setCategory] =
    useState<Category>("all");

  const [page, setPage] = useState(0);

  const [editorVisible, setEditorVisible] =
    useState(false);

  const [editing, setEditing] =
    useState<BarberService | null>(null);

  const [form, setForm] =
    useState<FormValues>({ ...EMPTY_FORM });

  const [formSnapshot, setFormSnapshot] =
    useState("");

  const [formError, setFormError] = useState("");

  const busy = loading || refreshing || saving;

  // ==========================================================
  // LOAD DATA
  // ==========================================================

  const loadServices = useCallback(
    async (refresh = false) => {
      const currentId = ++requestId.current;

      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;

      if (mounted.current) {
        setLoading(!refresh);
        setRefreshing(refresh);
        setError("");
      }

      try {
        const response = await getBarberServices(
          false,
          abort.signal
        );

        if (
          !mounted.current ||
          abort.signal.aborted ||
          currentId !== requestId.current
        ) {
          return;
        }

        setServices(response.services);
        setLoaded(true);
      } catch (err: unknown) {
        if (
          mounted.current &&
          !abort.signal.aborted &&
          currentId === requestId.current
        ) {
          setError(errorMessage(err));
        }
      } finally {
        if (
          mounted.current &&
          currentId === requestId.current
        ) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      requestId.current++;
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!focused) return;

    void loadServices();

    return () => {
      requestId.current++;
      controller.current?.abort();
    };
  }, [focused, loadServices]);

  // ==========================================================
  // METRICS
  // ==========================================================

  const totalCount = services.length;

  const activeCount = services.filter(
    (item) => item.is_active
  ).length;

  const inactiveCount = totalCount - activeCount;

  const avgDuration = totalCount
    ? Math.round(
        services.reduce(
          (sum, item) =>
            sum + Number(item.duration_minutes || 0),
          0
        ) / totalCount
      )
    : 0;

  const metrics: Metric[] = [
    {
      label: "Total Services",
      value: loaded ? totalCount : "—",
      icon: Scissors,
      tone: "gold",
    },
    {
      label: "Active Services",
      value: loaded ? activeCount : "—",
      icon: CheckCircle2,
      tone: "green",
    },
    {
      label: "Inactive Services",
      value: loaded ? inactiveCount : "—",
      icon: ShieldCheck,
      tone: "muted",
    },
    {
      label: "Average Duration",
      value: loaded ? `${avgDuration}m` : "—",
      icon: Clock3,
      tone: "gold",
    },
  ];

  // ==========================================================
  // FILTERING
  // ==========================================================

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return services.filter((item) => {
      if (status === "active" && !item.is_active) {
        return false;
      }

      if (status === "inactive" && item.is_active) {
        return false;
      }

      if (
        category !== "all" &&
        getCategory(item.service_name) !== category
      ) {
        return false;
      }

      if (!query) return true;

      return (
        item.service_name.toLowerCase().includes(query) ||
        String(item.description || "")
          .toLowerCase()
          .includes(query)
      );
    });
  }, [services, search, status, category]);

  useEffect(() => {
    setPage(0);
  }, [search, status, category]);

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / PAGE_SIZE)
  );

  const currentPage = Math.min(page, totalPages - 1);

  const visibleServices = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  );

  const metricWidth =
    width < 340
      ? "100%"
      : width >= 760
      ? "23.5%"
      : "48.5%";

  // ==========================================================
  // REFRESH
  // ==========================================================

  const refresh = () => {
    if (mutation.current || busy) return;

    setSuccess("");
    void loadServices(true);
  };

  // ==========================================================
  // EDITOR
  // ==========================================================

  const openEditor = (service?: BarberService) => {
    if (mutation.current || busy) return;

    const values: FormValues = service
      ? {
          service_name: service.service_name,
          description: service.description || "",
          duration_minutes: String(
            service.duration_minutes
          ),
          price: String(service.price),
        }
      : { ...EMPTY_FORM };

    setEditing(service || null);
    setForm(values);
    setFormSnapshot(JSON.stringify(values));
    setFormError("");
    setEditorVisible(true);
  };

  const closeEditor = () => {
    if (mutation.current) return;

    if (JSON.stringify(form) !== formSnapshot) {
      Alert.alert(
        "Discard Changes?",
        "Your unsaved service changes will be lost.",
        [
          {
            text: "Continue Editing",
            style: "cancel",
          },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => setEditorVisible(false),
          },
        ]
      );
      return;
    }

    setEditorVisible(false);
  };

  const changeForm = (
    key: keyof FormValues,
    value: string
  ) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));

    setFormError("");
  };

  // ==========================================================
  // APPLY API RESULT
  // ==========================================================

  const applyResult = (result: ServiceActionResponse) => {
    setServices((current) => {
      const exists = current.some(
        (item) => item.id === result.service.id
      );

      if (exists) {
        return current.map((item) =>
          item.id === result.service.id
            ? result.service
            : item
        );
      }

      return [result.service, ...current];
    });

    setLoaded(true);

    setSuccess(
      result.message || "Service updated successfully."
    );
  };

  // ==========================================================
  // SAVE SERVICE
  // ==========================================================

  const saveService = async () => {
    if (mutation.current) return;

    let payload: ServicePayload;

    try {
      payload = validateForm(form);
    } catch (err: unknown) {
      setFormError(errorMessage(err));
      return;
    }

    mutation.current = true;
    setSaving(true);
    setFormError("");
    setError("");

    try {
      const result = editing
        ? await updateBarberService(editing.id, payload)
        : await createBarberService(payload);

      if (!mounted.current) return;

      applyResult(result);

      setEditorVisible(false);

      if (!editing) {
        setSearch("");
        setCategory("all");
        setStatus("all");
        setPage(0);
      }
    } catch (err: unknown) {
      if (mounted.current) {
        setFormError(errorMessage(err));
      }
    } finally {
      mutation.current = false;

      if (mounted.current) {
        setSaving(false);
      }
    }
  };

  // ==========================================================
  // TOGGLE ACTIVE STATUS
  // ==========================================================

  const toggleService = (service: BarberService) => {
    if (mutation.current || busy) return;

    Alert.alert(
      service.is_active
        ? "Deactivate Service?"
        : "Activate Service?",
      `Are you sure you want to ${
        service.is_active ? "deactivate" : "activate"
      } "${service.service_name}"?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Confirm",
          onPress: () => {
            void (async () => {
              if (mutation.current) return;

              mutation.current = true;
              setSaving(true);
              setError("");
              setSuccess("");

              try {
                const result =
                  await setBarberServiceStatus(
                    service.id,
                    !service.is_active
                  );

                if (mounted.current) {
                  applyResult(result);
                }
              } catch (err: unknown) {
                if (mounted.current) {
                  setError(errorMessage(err));
                }
              } finally {
                mutation.current = false;

                if (mounted.current) {
                  setSaving(false);
                }
              }
            })();
          },
        },
      ]
    );
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
          disabled={saving}
          style={styles.headerButton}
        >
          <ArrowLeft size={20} color={C.text} />
        </Pressable>

        <View style={styles.flex}>
          <Text style={styles.headerEyebrow}>
            KSHURAK BARBER
          </Text>
          <Text style={styles.headerTitle}>
            Service Management
          </Text>
        </View>

        <Pressable
          disabled={busy}
          onPress={refresh}
          style={styles.headerButton}
        >
          {loading || refreshing ? (
            <ActivityIndicator
              size="small"
              color={GOLD}
            />
          ) : (
            <RefreshCw size={19} color={GOLD} />
          )}
        </Pressable>
      </View>

      {/* SERVICES LIST */}
      <FlatList
        data={visibleServices}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={refresh}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Math.max(
              30,
              insets.bottom + 24
            ),
          },
        ]}
        ListHeaderComponent={
          <View>
            {/* HERO */}
            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <View style={styles.heroIcon}>
                  <Scissors size={25} color={GOLD} />
                </View>

                <View style={styles.heroBadge}>
                  <Sparkles size={13} color={GOLD} />
                  <Text style={styles.heroBadgeText}>
                    PREMIUM EXPERIENCE
                  </Text>
                </View>
              </View>

              <Text style={styles.heroTitle}>
                Your Signature{"\n"}
                <Text style={{ color: GOLD }}>
                  Service Collection
                </Text>
              </Text>

              <Text style={styles.heroDescription}>
                Curate your service menu, refine pricing
                and deliver a premium grooming experience
                to every customer.
              </Text>

              <Pressable
                disabled={busy}
                onPress={() => openEditor()}
                style={[
                  styles.heroButton,
                  busy && styles.disabled,
                ]}
              >
                <Plus size={18} color={BG} />

                <Text style={styles.heroButtonText}>
                  Create New Service
                </Text>

                <ArrowRight size={16} color={BG} />
              </Pressable>

              <View style={styles.heroDivider} />

              <View style={styles.heroFooter}>
                <ShieldCheck size={16} color={GOLD} />

                <Text style={styles.heroFooterText}>
                  Build a better customer experience
                  with a well-managed service catalogue.
                </Text>
              </View>
            </View>

            <Notice message={error} />
            <Notice message={success} success />

            {/* METRICS */}
            <View style={styles.sectionHeading}>
              <View style={styles.flex}>
                <Text style={styles.sectionEyebrow}>
                  BUSINESS OVERVIEW
                </Text>

                <Text style={styles.sectionTitle}>
                  Service Insights
                </Text>
              </View>
            </View>

            <View style={styles.metricGrid}>
              {metrics.map((item) => (
                <View
                  key={item.label}
                  style={{ width: metricWidth }}
                >
                  <MetricCard item={item} />
                </View>
              ))}
            </View>

            {/* DIRECTORY HEADER */}
            <View style={styles.sectionHeading}>
              <View style={styles.flex}>
                <Text style={styles.sectionEyebrow}>
                  YOUR CATALOGUE
                </Text>

                <Text style={styles.sectionTitle}>
                  Service Directory
                </Text>
              </View>

              <View style={styles.countBadge}>
                <Text style={styles.countText}>
                  {filtered.length}
                </Text>
              </View>
            </View>

            {/* FILTERS */}
            <View style={styles.filtersPanel}>
              <View style={styles.searchBox}>
                <Search size={17} color={MUTED} />

                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search services..."
                  placeholderTextColor={C.textMuted}
                  autoCorrect={false}
                  editable={!saving}
                />

                {!!search && (
                  <Pressable onPress={() => setSearch("")}>
                    <X size={17} color={MUTED} />
                  </Pressable>
                )}
              </View>

              <View style={styles.segment}>
                {(
                  ["all", "active", "inactive"] as const
                ).map((value) => {
                  const selected = status === value;

                  return (
                    <Pressable
                      key={value}
                      disabled={saving}
                      onPress={() => setStatus(value)}
                      style={[
                        styles.segmentButton,
                        selected && styles.segmentSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          selected &&
                            styles.segmentSelectedText,
                        ]}
                      >
                        {value.charAt(0).toUpperCase() +
                          value.slice(1)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryRow}
              >
                {CATEGORIES.map((item) => {
                  const active = category === item.key;

                  return (
                    <Pressable
                      key={item.key}
                      disabled={saving}
                      onPress={() =>
                        setCategory(item.key)
                      }
                      style={[
                        styles.categoryChip,
                        active &&
                          styles.categoryChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.categoryText,
                          active &&
                            styles.categoryTextActive,
                        ]}
                      >
                        {item.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* RESULTS */}
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsTitle}>
                Available Services
              </Text>

              <Text style={styles.resultsSubtitle}>
                {filtered.length} result
                {filtered.length === 1 ? "" : "s"}
              </Text>
            </View>
          </View>
        }
        ItemSeparatorComponent={() => (
          <View style={{ height: 12 }} />
        )}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            {loading && !loaded ? (
              <>
                <ActivityIndicator
                  size="large"
                  color={GOLD}
                />
                <Text style={styles.emptyTitle}>
                  Loading Services
                </Text>
              </>
            ) : (
              <>
                <View style={styles.emptyIcon}>
                  <Scissors size={29} color={GOLD} />
                </View>

                <Text style={styles.emptyTitle}>
                  {error
                    ? "Unable to Load Services"
                    : "No Services Found"}
                </Text>

                <Text style={styles.emptyDescription}>
                  {error
                    ? "Check your internet connection and try again."
                    : "No services match the selected filters."}
                </Text>

                <ActionButton
                  title="Refresh"
                  icon={RefreshCw}
                  onPress={refresh}
                  disabled={busy}
                />
              </>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <ServiceCard
            service={item}
            saving={busy}
            onEdit={openEditor}
            onToggle={toggleService}
          />
        )}
        ListFooterComponent={
          filtered.length > 0 ? (
            <View style={styles.pagination}>
              <View style={styles.paginationHeader}>
                <Text style={styles.paginationText}>
                  Page {currentPage + 1} of {totalPages}
                </Text>

                <Text style={styles.paginationText}>
                  {filtered.length} services
                </Text>
              </View>

              <View style={styles.paginationButtons}>
                <Pressable
                  disabled={busy || currentPage === 0}
                  onPress={() =>
                    setPage((value) =>
                      Math.max(0, value - 1)
                    )
                  }
                  style={[
                    styles.pageButton,
                    (busy || currentPage === 0) &&
                      styles.disabled,
                  ]}
                >
                  <ChevronLeft
                    size={16}
                    color={GOLD}
                  />
                  <Text style={styles.pageText}>
                    Previous
                  </Text>
                </Pressable>

                <Pressable
                  disabled={
                    busy ||
                    currentPage >= totalPages - 1
                  }
                  onPress={() =>
                    setPage((value) =>
                      Math.min(totalPages - 1, value + 1)
                    )
                  }
                  style={[
                    styles.pageButton,
                    (busy ||
                      currentPage >= totalPages - 1) &&
                      styles.disabled,
                  ]}
                >
                  <Text style={styles.pageText}>
                    Next
                  </Text>
                  <ChevronRight
                    size={16}
                    color={GOLD}
                  />
                </Pressable>
              </View>
            </View>
          ) : undefined
        }
      />

      {/* ======================================================
          CREATE / EDIT SERVICE MODAL
      ====================================================== */}
      <Modal
        visible={editorVisible}
        transparent
        animationType="slide"
        onRequestClose={closeEditor}
      >
        <KeyboardAvoidingView
          style={[
            styles.overlay,
            {
              paddingTop: Math.max(12, insets.top),
              paddingBottom: Math.max(
                12,
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
                  SERVICE MANAGEMENT
                </Text>

                <Text style={styles.modalTitle}>
                  {editing
                    ? "Edit Service"
                    : "Create New Service"}
                </Text>
              </View>

              <Pressable
                disabled={saving}
                onPress={closeEditor}
                style={styles.headerButton}
              >
                <X size={19} color={C.text} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalBody}
            >
              <View style={styles.formIntro}>
                <View style={styles.formIntroIcon}>
                  <Scissors size={23} color={GOLD} />
                </View>

                <View style={styles.flex}>
                  <Text style={styles.formIntroTitle}>
                    {editing
                      ? "Refine Your Service"
                      : "Add to Your Collection"}
                  </Text>

                  <Text style={styles.formIntroSubtitle}>
                    Keep your service details accurate
                    and attractive to customers.
                  </Text>
                </View>
              </View>

              <Notice message={formError} />

              <Text style={styles.label}>
                SERVICE NAME
              </Text>

              <TextInput
                value={form.service_name}
                onChangeText={(value) =>
                  changeForm("service_name", value)
                }
                style={styles.input}
                placeholder="e.g. Premium Haircut"
                placeholderTextColor={C.textMuted}
                editable={!saving}
                maxLength={150}
              />

              <Text style={styles.label}>
                DESCRIPTION
              </Text>

              <TextInput
                value={form.description}
                onChangeText={(value) =>
                  changeForm("description", value)
                }
                style={[
                  styles.input,
                  styles.descriptionInput,
                ]}
                placeholder="Describe your professional service..."
                placeholderTextColor={C.textMuted}
                multiline
                maxLength={2000}
                textAlignVertical="top"
                editable={!saving}
              />

              <Text style={styles.label}>
                DURATION (MINUTES)
              </Text>

              <TextInput
                value={form.duration_minutes}
                onChangeText={(value) =>
                  changeForm("duration_minutes", value)
                }
                style={styles.input}
                placeholder="30"
                placeholderTextColor={C.textMuted}
                keyboardType="number-pad"
                editable={!saving}
              />

              <Text style={styles.label}>
                SERVICE PRICE (₹)
              </Text>

              <TextInput
                value={form.price}
                onChangeText={(value) =>
                  changeForm("price", value)
                }
                style={styles.input}
                placeholder="Enter service price"
                placeholderTextColor={C.textMuted}
                keyboardType="decimal-pad"
                editable={!saving}
              />

              <View style={styles.formHint}>
                <ShieldCheck size={17} color={GOLD} />

                <Text style={styles.formHintText}>
                  Changes to your service catalogue
                  are saved using your existing
                  KSHURAK FastAPI backend.
                </Text>
              </View>

              <View style={styles.modalActions}>
                <ActionButton
                  title="Cancel"
                  disabled={saving}
                  onPress={closeEditor}
                />

                <ActionButton
                  title={
                    saving
                      ? "Saving..."
                      : editing
                      ? "Save Changes"
                      : "Create Service"
                  }
                  icon={CheckCircle2}
                  primary
                  loading={saving}
                  disabled={saving}
                  onPress={() => void saveService()}
                />
              </View>
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
    letterSpacing: 1.4,
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
    paddingTop: 15,
  },

  hero: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 21,
    padding: 19,
    marginBottom: 22,
  },

  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  heroIcon: {
    width: 52,
    height: 52,
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
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },

  heroBadgeText: {
    color: GOLD,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.6,
  },

  heroTitle: {
    color: C.text,
    fontSize: 29,
    fontWeight: "900",
    lineHeight: 37,
    marginTop: 19,
    letterSpacing: -0.6,
  },

  heroDescription: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 21,
    marginTop: 12,
  },

  heroButton: {
    minHeight: 47,
    borderRadius: 11,
    backgroundColor: GOLD,
    marginTop: 20,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  heroButtonText: {
    color: BG,
    fontSize: 12,
    fontWeight: "900",
  },

  heroDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginTop: 18,
    marginBottom: 14,
  },

  heroFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  heroFooterText: {
    flex: 1,
    color: MUTED,
    fontSize: 10,
    lineHeight: 17,
  },

  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
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

  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
    marginBottom: 25,
  },

  metricCard: {
    minHeight: 145,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 15,
    padding: 14,
    overflow: "hidden",
  },

  metricTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  metricIcon: {
    width: 37,
    height: 37,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
  },

  metricDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  metricValue: {
    fontSize: 28,
    fontWeight: "900",
    marginTop: 12,
  },

  metricLabel: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 7,
  },

  metricFooter: {
    height: 2,
    width: "100%",
    backgroundColor: BORDER,
    marginTop: 14,
    borderRadius: 2,
    overflow: "hidden",
  },

  metricLine: {
    width: "50%",
    height: "100%",
  },

  countBadge: {
    minWidth: 35,
    height: 35,
    paddingHorizontal: 9,
    borderRadius: 10,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  countText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
  },

  filtersPanel: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 15,
    padding: 12,
    marginBottom: 19,
  },

  searchBox: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: DARK,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.borderLight,
    paddingHorizontal: 12,
    marginBottom: 13,
  },

  searchInput: {
    flex: 1,
    color: C.text,
    minWidth: 0,
    fontSize: 12,
  },

  segment: {
    flexDirection: "row",
    backgroundColor: DARK,
    borderRadius: 10,
    padding: 4,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 13,
  },

  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },

  segmentSelected: {
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },

  segmentText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
  },

  segmentSelectedText: {
    color: GOLD,
  },

  categoryRow: {
    gap: 8,
    paddingVertical: 2,
  },

  categoryChip: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: DARK,
  },

  categoryChipActive: {
    borderColor: GOLD,
    backgroundColor: GOLD_SOFT,
  },

  categoryText: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "800",
  },

  categoryTextActive: {
    color: GOLD,
  },

  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 13,
  },

  resultsTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: "900",
  },

  resultsSubtitle: {
    color: MUTED,
    fontSize: 11,
  },

  serviceCard: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 17,
    padding: 15,
    overflow: "hidden",
  },

  serviceAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: GOLD,
  },

  inactiveAccent: {
    backgroundColor: C.textMuted,
  },

  serviceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  serviceIcon: {
    width: 45,
    height: 45,
    borderRadius: 13,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  serviceCategory: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },

  serviceName: {
    color: C.text,
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20,
    marginTop: 5,
  },

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },

  statusActive: {
    borderColor: GREEN_BORDER,
    backgroundColor: GREEN_SOFT,
  },

  statusInactive: {
    borderColor: BORDER,
    backgroundColor: DARK,
  },

  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  statusText: {
    fontSize: 8,
    fontWeight: "900",
  },

  serviceDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 14,
  },

  serviceDescription: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
    minHeight: 38,
  },

  serviceInfoRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },

  pricePanel: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    borderRadius: 11,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
  },

  durationPanel: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    borderRadius: 11,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
  },

  infoLabel: {
    color: C.textMuted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
  },

  priceValue: {
    color: GOLD,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 9,
  },

  durationValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 11,
  },

  durationValue: {
    color: C.text,
    fontSize: 15,
    fontWeight: "900",
  },

  serviceFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 15,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  actionButton: {
    flexGrow: 1,
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.borderLight,
    backgroundColor: LIGHT,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },

  actionPrimary: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },

  actionDanger: {
    backgroundColor: "rgba(239,68,68,0.07)",
    borderColor: "rgba(239,68,68,0.4)",
  },

  actionText: {
    color: C.text,
    fontSize: 11,
    fontWeight: "900",
  },

  actionPrimaryText: {
    color: BG,
  },

  pagination: {
    marginTop: 21,
    padding: 13,
    borderRadius: 13,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  paginationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },

  paginationText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
  },

  paginationButtons: {
    flexDirection: "row",
    gap: 10,
  },

  pageButton: {
    flex: 1,
    minHeight: 41,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
  },

  pageText: {
    color: C.text,
    fontSize: 11,
    fontWeight: "800",
  },

  emptyCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    minHeight: 210,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },

  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: GOLD_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: "900",
  },

  emptyDescription: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
    textAlign: "center",
  },

  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: SURFACE,
    padding: 12,
    marginBottom: 14,
  },

  noticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 19,
  },

  overlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.87)",
    paddingHorizontal: 14,
  },

  modalCard: {
    width: "100%",
    maxWidth: 600,
    maxHeight: "94%",
    alignSelf: "center",
    borderRadius: 19,
    overflow: "hidden",
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: C.borderLight,
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
    fontSize: 19,
    fontWeight: "900",
    marginTop: 5,
  },

  modalBody: {
    padding: 16,
    paddingBottom: 30,
  },

  formIntro: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 13,
    borderRadius: 12,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    marginBottom: 10,
  },

  formIntroIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: DARK,
    alignItems: "center",
    justifyContent: "center",
  },

  formIntroTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: "900",
  },

  formIntroSubtitle: {
    color: MUTED,
    fontSize: 10,
    lineHeight: 18,
    marginTop: 5,
  },

  label: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 9,
  },

  input: {
    minHeight: 47,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.borderLight,
    backgroundColor: DARK,
    paddingHorizontal: 13,
    paddingVertical: 11,
    color: C.text,
    fontSize: 12,
  },

  descriptionInput: {
    minHeight: 105,
    textAlignVertical: "top",
  },

  formHint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    backgroundColor: GOLD_SOFT,
    borderRadius: 11,
    marginTop: 18,
  },

  formHintText: {
    flex: 1,
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
  },

  modalActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 20,
  },

  disabled: {
    opacity: 0.44,
  },

  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
});
