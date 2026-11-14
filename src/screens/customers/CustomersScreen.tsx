import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import {
  ArrowLeft,
  ArrowUpRight,
  CalendarCheck2,
  Heart,
  History,
  RefreshCw,
  Repeat2,
  Search,
  Sparkles,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react-native";

import { COLORS } from "../../constants/colors";

import {
  getShopCustomers,
  getShopCustomerDetails,
  type CustomerDetailResponse,
  type CustomerProfile,
  type CustomerRelationship,
  type CustomersResponse,
} from "../../services/customersApi";

type Props = { onBack: () => void };
type CustomerFilter = "all" | CustomerRelationship;

const PAGE_SIZE = 9;

const EMPTY_SUMMARY = {
  total_customers: 0,
  new_this_month: 0,
  returning_customers: 0,
  regular_customers: 0,
  inactive_customers: 0,
  retention_rate: 0,
};

const FILTERS: { value: CustomerFilter; label: string }[] = [
  { value: "all", label: "All Customers" },
  { value: "new", label: "New" },
  { value: "returning", label: "Returning" },
  { value: "regular", label: "Regular" },
  { value: "inactive", label: "Inactive" },
];

const RELATIONSHIP_LABELS: Record<CustomerRelationship, string> = {
  new: "New Customer",
  returning: "Returning",
  regular: "Regular",
  inactive: "Inactive",
};

function money(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string | null): string {
  if (!value) return "Not yet";

  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;

  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(value: string): string {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;

  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${
    hour >= 12 ? "PM" : "AM"
  }`;
}

function initials(name: string): string {
  return (
    name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase()).join("") || "C"
  );
}

function relationshipColor(value: CustomerRelationship): string {
  if (value === "returning") return COLORS.success;
  if (value === "inactive") return COLORS.textMuted;
  return COLORS.primary;
}

function bookingColor(status: string): string {
  if (status === "completed") return COLORS.success;
  if (status === "cancelled" || status === "rejected") return COLORS.error;
  if (status === "pending") return COLORS.primary;
  return COLORS.textSecondary;
}

function bookingLabel(status: string): string {
  if (status === "confirmed") return "Upcoming";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

function Avatar({
  customer,
  large = false,
}: {
  customer: CustomerProfile;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [customer.image_url]);

  const size = large ? 68 : 42;

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: large ? 20 : 12 },
      ]}
    >
      {customer.image_url && !failed ? (
        <Image
          source={{ uri: customer.image_url }}
          style={{ width: "100%", height: "100%" }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[styles.avatarText, { fontSize: large ? 23 : 15 }]}>
          {initials(customer.name)}
        </Text>
      )}
    </View>
  );
}

function RelationshipBadge({
  relationship,
}: {
  relationship: CustomerRelationship;
}) {
  const color = relationshipColor(relationship);

  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>
        {RELATIONSHIP_LABELS[relationship]}
      </Text>
    </View>
  );
}

function Button({
  title,
  onPress,
  disabled = false,
  primary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        primary && styles.primaryButton,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>
        {title}
      </Text>
    </Pressable>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text selectable style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function ErrorBox({ text }: { text: string }) {
  if (!text) return null;

  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

function CustomerDetails({
  customerKey,
  onClose,
}: {
  customerKey: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<CustomerDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    if (reload === 0) setLoading(true);
    else setRefreshing(true);

    setError("");

    getShopCustomerDetails(customerKey, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorText(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => controller.abort();
  }, [customerKey, reload]);

  const customer = data?.customer;

  const visits = useMemo(
    () => [...(data?.visits || [])].sort((a, b) =>
      `${b.booking_date}T${b.start_time}`.localeCompare(
        `${a.booking_date}T${a.start_time}`
      )
    ),
    [data]
  );

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={styles.screen}
        edges={["top", "bottom", "left", "right"]}
      >
        <View style={styles.topbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to customers"
            onPress={onClose}
            style={styles.iconButton}
          >
            <ArrowLeft size={20} color={COLORS.text} />
          </Pressable>

          <View style={styles.flex}>
            <Text style={styles.eyebrow}>KSHURAK BARBER</Text>
            <Text style={styles.topbarTitle}>Customer Profile</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh customer profile"
            disabled={loading || refreshing}
            onPress={() => setReload((value) => value + 1)}
            style={styles.iconButton}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <RefreshCw size={18} color={COLORS.primary} />
            )}
          </Pressable>
        </View>

        <FlatList
          data={visits}
          keyExtractor={(item) => item.booking_id}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={() => {
            if (!loading && !refreshing) {
              setReload((value) => value + 1);
            }
          }}
          initialNumToRender={8}
          ListHeaderComponent={
            <View>
              <ErrorBox text={error} />

              {!!error && (
                <Button
                  title="Retry"
                  disabled={loading || refreshing}
                  onPress={() => setReload((value) => value + 1)}
                />
              )}

              {loading ? (
                <View style={styles.empty}>
                  <ActivityIndicator size="large" color={COLORS.primary} />
                  <Text style={styles.secondary}>Loading customer profile…</Text>
                </View>
              ) : customer ? (
                <>
                  <View style={styles.profileHeader}>
                    <Avatar customer={customer} large />
                    <Text style={styles.profileName}>{customer.name}</Text>
                    <Text style={styles.secondary}>
                      {customer.phone || "Phone not available"}
                    </Text>
                    <RelationshipBadge relationship={customer.relationship} />
                  </View>

                  <View style={styles.profileMetrics}>
                    {[
                      ["Completed Visits", String(customer.completed_visits)],
                      ["Total Spent", money(customer.total_spent)],
                      ["Total Bookings", String(customer.total_bookings)],
                    ].map(([label, value]) => (
                      <View key={label} style={styles.profileMetric}>
                        <Text style={styles.profileMetricValue}>{value}</Text>
                        <Text style={styles.profileMetricLabel}>{label}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.panel}>
                    <View style={styles.sectionHeading}>
                      <Heart size={18} color={COLORS.primary} />
                      <Text style={styles.sectionTitle}>Relationship Insights</Text>
                    </View>
                    <InfoRow label="Customer Since" value={formatDate(customer.first_booking)} />
                    <InfoRow label="Latest Booking" value={formatDate(customer.last_booking)} />
                    <InfoRow label="Last Completed Visit" value={formatDate(customer.last_visit)} />
                    <InfoRow label="Favorite Service" value={customer.favorite_service || "Not available"} />
                    <InfoRow label="Confirmed Bookings" value={customer.confirmed_bookings} />
                    <InfoRow label="Pending Bookings" value={customer.pending_bookings} />
                    <InfoRow label="Cancelled Bookings" value={customer.cancelled_bookings} />
                    <InfoRow label="Rejected Bookings" value={customer.rejected_bookings} />
                  </View>

                  <View style={styles.historyHeading}>
                    <History size={18} color={COLORS.primary} />
                    <Text style={styles.sectionTitle}>Booking History</Text>
                    <Text style={styles.secondary}>{visits.length}</Text>
                  </View>
                </>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.visitCard}>
              <View style={styles.wrapRow}>
                <Text style={styles.visitService}>{item.service_name}</Text>
                <Text style={styles.price}>{money(item.service_price)}</Text>
              </View>

              <Text style={styles.secondary}>
                {formatDate(item.booking_date)} · {formatTime(item.start_time)}
              </Text>

              <View
                style={[
                  styles.badge,
                  { borderColor: bookingColor(item.status), marginTop: 10 },
                ]}
              >
                <Text
                  style={[styles.badgeText, { color: bookingColor(item.status) }]}
                >
                  {bookingLabel(item.status)}
                </Text>
              </View>

              {!!item.customer_notes && (
                <Text style={styles.notes}>{item.customer_notes}</Text>
              )}

              <Text selectable style={styles.bookingId}>
                Booking: {item.booking_id}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            !loading && customer ? (
              <View style={styles.empty}>
                <History size={28} color={COLORS.primary} />
                <Text style={styles.secondary}>No booking history available.</Text>
              </View>
            ) : undefined
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

export default function CustomersScreen({ onBack }: Props) {
  const { width } = useWindowDimensions();

  const [data, setData] = useState<CustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");

  const mounted = useRef(true);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const loadCustomers = useCallback(async (refresh = false) => {
    const current = ++requestId.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;

    setLoading(!refresh);
    setRefreshing(refresh);
    setError("");

    try {
      const result = await getShopCustomers(nextController.signal);

      if (
        !mounted.current ||
        nextController.signal.aborted ||
        current !== requestId.current
      ) return;

      setData(result);
      setUpdatedAt(
        new Date().toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    } catch (reason: unknown) {
      if (
        mounted.current &&
        !nextController.signal.aborted &&
        current === requestId.current
      ) {
        setError(errorText(reason));
      }
    } finally {
      if (mounted.current && current === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadCustomers();

    return () => {
      mounted.current = false;
      requestId.current += 1;
      controller.current?.abort();
    };
  }, [loadCustomers]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, filter]);

  const summary = data?.summary || EMPTY_SUMMARY;

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return (data?.customers || []).filter((customer) => {
      if (filter !== "all" && customer.relationship !== filter) {
        return false;
      }

      return !query || [
        customer.name,
        customer.phone,
        customer.favorite_service,
      ].some((value) =>
        String(value || "").toLowerCase().includes(query)
      );
    });
  }, [data, search, filter]);

  const filterCounts = useMemo(() => {
    const customers = data?.customers || [];
    return {
      all: customers.length,
      new: customers.filter((item) => item.relationship === "new").length,
      returning: customers.filter((item) => item.relationship === "returning").length,
      regular: customers.filter((item) => item.relationship === "regular").length,
      inactive: customers.filter((item) => item.relationship === "inactive").length,
    };
  }, [data]);

  const metrics = [
    {
      label: "Total Customers",
      value: String(summary.total_customers),
      note: "Unique shop customers",
      Icon: UsersRound,
    },
    {
      label: "Returning Customers",
      value: String(summary.returning_customers),
      note: "Two or more completed visits",
      Icon: Repeat2,
    },
    {
      label: "New This Month",
      value: String(summary.new_this_month),
      note: "First booking this month",
      Icon: UserRoundPlus,
    },
    {
      label: "Customer Retention",
      value: `${summary.retention_rate}%`,
      note: "Repeat visitors among visitors",
      Icon: Heart,
    },
  ];

  const refresh = () => {
    if (!loading && !refreshing) void loadCustomers(true);
  };

  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "bottom", "left", "right"]}
    >
      <View style={styles.topbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to dashboard"
          onPress={onBack}
          style={styles.iconButton}
        >
          <ArrowLeft size={20} color={COLORS.text} />
        </Pressable>

        <View style={styles.flex}>
          <Text style={styles.eyebrow}>KSHURAK BARBER</Text>
          <Text style={styles.topbarTitle}>Customers</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh customers"
          disabled={loading || refreshing}
          onPress={refresh}
          style={styles.iconButton}
        >
          {loading || refreshing ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <RefreshCw size={18} color={COLORS.primary} />
          )}
        </Pressable>
      </View>

      <FlatList
        data={filteredCustomers.slice(0, visibleCount)}
        keyExtractor={(item) => item.customer_key}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={refresh}
        initialNumToRender={9}
        ListHeaderComponent={
          <View>
            <View style={styles.hero}>
              <View style={styles.sectionHeading}>
                <Sparkles size={15} color={COLORS.primary} />
                <Text style={styles.eyebrow}>CUSTOMER INTELLIGENCE</Text>
              </View>
              <Text style={styles.heroTitle}>
                Better Relationships.{"\n"}
                <Text style={styles.gold}>Stronger Business.</Text>
              </Text>
              <Text style={styles.heroDescription}>
                Know your customers and make every visit more personal.
              </Text>
            </View>

            <ErrorBox text={error} />
            {!!error && (
              <Button title="Retry" disabled={loading || refreshing} onPress={refresh} />
            )}

            <View style={styles.metricsGrid}>
              {metrics.map((metric) => (
                <View
                  key={metric.label}
                  style={[
                    styles.metricCard,
                    {
                      width: width < 340 ? "100%" :
                        width >= 760 ? "23.5%" : "48.5%",
                    },
                  ]}
                >
                  <metric.Icon size={18} color={COLORS.primary} />
                  <Text style={styles.metricValue}>{data ? metric.value : "—"}</Text>
                  <Text style={styles.metricLabel}>{metric.label}</Text>
                  <Text style={styles.smallText}>{metric.note}</Text>
                </View>
              ))}
            </View>

            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Customer Directory</Text>
              <Text style={styles.secondary}>
                {data ? `${filteredCustomers.length} matching customers` : "Loading customers…"}
              </Text>

              <View style={styles.searchBox}>
                <Search size={17} color={COLORS.textSecondary} />
                <TextInput
                  accessibilityLabel="Search customers"
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search name, phone or service"
                  placeholderTextColor={COLORS.textMuted}
                  selectionColor={COLORS.primary}
                  autoCorrect={false}
                  style={styles.searchInput}
                />
                {!!search && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    hitSlop={8}
                    onPress={() => setSearch("")}
                  >
                    <X size={17} color={COLORS.textSecondary} />
                  </Pressable>
                )}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}
              >
                {FILTERS.map((item) => (
                  <Pressable
                    key={item.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: filter === item.value }}
                    onPress={() => setFilter(item.value)}
                    style={({ pressed }) => [
                      styles.filterChip,
                      filter === item.value && styles.selectedBorder,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        filter === item.value && styles.gold,
                      ]}
                    >
                      {item.label} · {filterCounts[item.value]}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${item.name}'s customer profile`}
            onPress={() => setSelectedKey(item.customer_key)}
            style={({ pressed }) => [
              styles.customerCard,
              pressed && styles.customerPressed,
            ]}
          >
            <View style={styles.customerTop}>
              <Avatar customer={item} />

              <View style={styles.flex}>
                <Text numberOfLines={1} style={styles.customerName}>{item.name}</Text>
                <Text numberOfLines={1} style={styles.secondary}>
                  {item.phone || "Phone not available"}
                </Text>
              </View>

              <ArrowUpRight size={17} color={COLORS.primary} />
            </View>

            <View style={styles.customerMeta}>
              <RelationshipBadge relationship={item.relationship} />
              <Text style={styles.secondary}>
                {item.completed_visits} completed visits
              </Text>
            </View>

            <View style={styles.customerFooter}>
              <View style={styles.flex}>
                <Text style={styles.smallText}>Last visit</Text>
                <Text style={styles.secondary}>{formatDate(item.last_visit)}</Text>
              </View>
              <View style={styles.spendBlock}>
                <Text style={styles.smallText}>Total spent</Text>
                <Text style={styles.price}>{money(item.total_spent)}</Text>
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading && !data ? (
              <>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.secondary}>Loading customers…</Text>
              </>
            ) : (
              <>
                <UsersRound size={32} color={COLORS.primary} />
                <Text style={styles.sectionTitle}>
                  {error && !data ? "Unable to load customers" : "No customers found"}
                </Text>
                <Text style={styles.emptyText}>
                  {error && !data
                    ? "Use Retry above to load your customer directory."
                    : search || filter !== "all"
                    ? "Try another search or relationship filter."
                    : "Customers will appear here after booking with your shop."}
                </Text>
                {(search || filter !== "all") && (
                  <Button title="Clear Filters" onPress={() => {
                    setSearch("");
                    setFilter("all");
                  }} />
                )}
              </>
            )}
          </View>
        }
        ListFooterComponent={
          <View style={styles.listFooter}>
            {visibleCount < filteredCustomers.length && (
              <Button
                title="Load More Customers"
                primary
                onPress={() => setVisibleCount((value) => value + PAGE_SIZE)}
              />
            )}
            <Text style={styles.footerText}>
              Showing {Math.min(visibleCount, filteredCustomers.length)} of{" "}
              {filteredCustomers.length} customers
            </Text>
            {!!updatedAt && (
              <Text style={styles.footerText}>Updated at {updatedAt}</Text>
            )}
          </View>
        }
      />

      {selectedKey !== null && (
        <CustomerDetails
          key={selectedKey}
          customerKey={selectedKey}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1, minWidth: 0 },
  topbar: {
    flexDirection: "row", alignItems: "center", gap: 11,
    paddingHorizontal: 18, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.borderDark,
  },
  iconButton: {
    width: 44, height: 44, borderRadius: 11,
    borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceDark,
    alignItems: "center", justifyContent: "center",
  },
  eyebrow: { color: COLORS.primary, fontSize: 9, fontWeight: "800", letterSpacing: 1.3 },
  topbarTitle: { color: COLORS.text, fontSize: 17, fontWeight: "800", marginTop: 4 },
  content: {
    width: "100%", maxWidth: 980, alignSelf: "center",
    padding: 18, paddingBottom: 28,
  },
  hero: {
    padding: 16, borderRadius: 16, borderWidth: 1,
    borderColor: COLORS.border, backgroundColor: COLORS.surface, marginBottom: 16,
  },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 11 },
  heroTitle: { color: COLORS.text, fontSize: 24, lineHeight: 33, fontWeight: "800", letterSpacing: -0.6 },
  gold: { color: COLORS.primary },
  heroDescription: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 20, marginTop: 9 },
  metricsGrid: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between",
    rowGap: 10, marginBottom: 15,
  },
  metricCard: {
    minHeight: 132, padding: 13, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  metricValue: { color: COLORS.text, fontSize: 26, lineHeight: 34, fontWeight: "800", marginTop: 8 },
  metricLabel: { color: COLORS.text, fontSize: 11, lineHeight: 18, fontWeight: "700" },
  smallText: { color: COLORS.textMuted, fontSize: 10, lineHeight: 16, marginTop: 3 },
  panel: { padding: 14, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, backgroundColor: COLORS.surface, marginBottom: 14 },
  sectionTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800", flexShrink: 1 },
  secondary: { color: COLORS.textSecondary, fontSize: 11, lineHeight: 18, marginTop: 3 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 12, paddingHorizontal: 11, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.borderLight, backgroundColor: COLORS.surfaceDark,
  },
  searchInput: { flex: 1, minWidth: 0, minHeight: 46, paddingVertical: 11, color: COLORS.text, fontSize: 12 },
  filterRow: { gap: 8, paddingTop: 12 },
  filterChip: {
    minHeight: 44, paddingHorizontal: 12, paddingVertical: 11,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    justifyContent: "center", backgroundColor: COLORS.surfaceDark,
  },
  filterText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "700" },
  selectedBorder: { borderColor: COLORS.primary },
  customerCard: {
    padding: 13, borderRadius: 14, borderWidth: 1,
    borderColor: COLORS.border, backgroundColor: COLORS.surface, marginBottom: 11,
  },
  customerPressed: {
    borderColor: COLORS.primary, backgroundColor: COLORS.surfaceLight,
    transform: [{ scale: 0.985 }],
  },
  customerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    overflow: "hidden", alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.thumbnail, borderWidth: 1, borderColor: COLORS.border,
  },
  avatarText: { color: COLORS.primary, fontWeight: "800" },
  customerName: { color: COLORS.text, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  customerMeta: {
    flexDirection: "row", flexWrap: "wrap", alignItems: "center",
    justifyContent: "space-between", gap: 8, marginTop: 12,
  },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, backgroundColor: COLORS.surfaceDark,
  },
  badgeDot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 9, fontWeight: "800" },
  customerFooter: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    marginTop: 11, paddingTop: 9, borderTopWidth: 1, borderTopColor: COLORS.borderDark,
  },
  spendBlock: { maxWidth: "50%", alignItems: "flex-end" },
  price: { color: COLORS.primary, fontSize: 14, lineHeight: 21, fontWeight: "800", flexShrink: 1 },
  button: {
    minHeight: 44, paddingHorizontal: 13, paddingVertical: 11,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceDark, alignItems: "center", justifyContent: "center",
  },
  buttonText: { color: COLORS.text, fontSize: 12, lineHeight: 18, fontWeight: "800", textAlign: "center" },
  primaryButton: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  primaryText: { color: COLORS.black },
  pressed: { borderColor: COLORS.primary, opacity: 0.87, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.4 },
  errorBox: {
    padding: 12, marginVertical: 10, borderWidth: 1,
    borderColor: COLORS.error, borderRadius: 10, backgroundColor: COLORS.surfaceDark,
  },
  errorText: { color: COLORS.error, fontSize: 12, lineHeight: 20 },
  empty: {
    minHeight: 170, padding: 22, gap: 12, alignItems: "center",
    justifyContent: "center", borderWidth: 1, borderColor: COLORS.border, borderRadius: 14,
  },
  emptyText: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 20, textAlign: "center" },
  listFooter: { gap: 8, paddingTop: 5 },
  footerText: { color: COLORS.textMuted, fontSize: 10, lineHeight: 17, textAlign: "center", marginTop: 4 },
  profileHeader: {
    padding: 19, gap: 9, alignItems: "center", marginBottom: 13,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, backgroundColor: COLORS.surface,
  },
  profileName: { color: COLORS.text, fontSize: 23, lineHeight: 30, fontWeight: "800", textAlign: "center" },
  profileMetrics: {
    flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14,
  },
  profileMetric: {
    flexGrow: 1, flexBasis: 100, minWidth: 0, padding: 12,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 12,
    backgroundColor: COLORS.surface,
  },
  profileMetricValue: { color: COLORS.primary, fontSize: 20, lineHeight: 29, fontWeight: "800" },
  profileMetricLabel: { color: COLORS.textSecondary, fontSize: 10, lineHeight: 16, marginTop: 4 },
  infoRow: { paddingVertical: 10, gap: 4, borderBottomWidth: 1, borderBottomColor: COLORS.borderDark },
  infoLabel: { color: COLORS.textMuted, fontSize: 10, lineHeight: 17 },
  infoValue: { color: COLORS.text, fontSize: 12, lineHeight: 20 },
  historyHeading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 9, marginBottom: 13 },
  visitCard: { padding: 13, marginBottom: 11, borderWidth: 1, borderColor: COLORS.border, borderRadius: 13, backgroundColor: COLORS.surface },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 8 },
  visitService: { flexGrow: 1, flexBasis: 140, color: COLORS.text, fontSize: 13, lineHeight: 20, fontWeight: "800" },
  notes: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 20, marginTop: 10 },
  bookingId: { color: COLORS.textMuted, fontSize: 9, lineHeight: 16, marginTop: 10 },
});