
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
import { LinearGradient } from "expo-linear-gradient";
import {
  AlertCircle,
  ArrowLeft,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Star,
  ThumbsUp,
  X,
} from "lucide-react-native";
import { COLORS } from "../../constants/colors";
import {
  getReviews,
  getReviewStatistics,
  saveReviewReply,
  type Review,
  type ReviewList,
  type ReviewStatistics,
  type ReviewSort,
} from "../../services/reviewsApi";

type Props = {
  onBack: () => void;
};

type RatingFilter = number | undefined;

const PAGE_SIZE = 5;

const SORT_OPTIONS: {
  value: ReviewSort;
  label: string;
}[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "highest", label: "Highest" },
  { value: "lowest", label: "Lowest" },
];

function dateLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Date unavailable";
  }
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "C"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to load review information.";
}

function Stars({
  rating,
  size = 12,
}: {
  rating: number;
  size?: number;
}) {
  return (
    <View
      style={styles.stars}
      accessibilityLabel={`${rating} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={size}
          color={
            star <= rating
              ? COLORS.primary
              : COLORS.borderLight
          }
          fill={
            star <= rating
              ? COLORS.primary
              : "transparent"
          }
        />
      ))}
    </View>
  );
}

function SmallButton({
  title,
  onPress,
  primary = false,
  disabled = false,
  icon,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.buttonPressed,
        disabled && styles.disabled,
      ]}
    >
      {icon}
      <Text
        style={[
          styles.buttonLabel,
          primary && styles.buttonLabelPrimary,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function Notice({
  message,
  success = false,
  onDismiss,
}: {
  message: string;
  success?: boolean;
  onDismiss?: () => void;
}) {
  if (!message) return null;

  const color = success
    ? COLORS.success
    : COLORS.error;

  return (
    <View
      style={[
        styles.notice,
        {
          borderColor: success
            ? "rgba(34,197,94,0.35)"
            : "rgba(239,68,68,0.35)",
        },
      ]}
    >
      {success ? (
        <CheckCircle2 size={15} color={color} />
      ) : (
        <AlertCircle size={15} color={color} />
      )}
      <Text style={[styles.noticeText, { color }]}>
        {message}
      </Text>
      {onDismiss && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          onPress={onDismiss}
        >
          <X size={15} color={color} />
        </Pressable>
      )}
    </View>
  );
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  width,
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof Star;
  width: number | `${number}%`;
}) {
  return (
    <LinearGradient
      colors={[
        COLORS.surfaceLight,
        COLORS.surface,
        COLORS.surfaceDark,
      ]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.metricCard, { width }]}
    >
      <View style={styles.metricTop}>
        <View style={styles.metricIcon}>
          <Icon size={16} color={COLORS.primary} />
        </View>
        <Text style={styles.metricTitle}>{title}</Text>
      </View>
      <Text
        style={styles.metricValue}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={styles.metricDescription}>
        {description}
      </Text>
    </LinearGradient>
  );
}

function ReviewCard({
  review,
  onReply,
  disabled,
}: {
  review: Review;
  onReply: (review: Review) => void;
  disabled: boolean;
}) {
  const hasReply = Boolean(review.reply?.trim());

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {initials(review.customer_name || "Customer")}
          </Text>
        </View>
        <View style={styles.flex}>
          <Text
            style={styles.customerName}
            numberOfLines={1}
          >
            {review.customer_name || "Customer"}
          </Text>
          <View style={styles.reviewDateRow}>
            <Clock3 size={11} color={COLORS.textMuted} />
            <Text style={styles.reviewDate}>
              {dateLabel(review.created_at)}
            </Text>
          </View>
        </View>
        <View style={styles.ratingBadge}>
          <Star
            size={12}
            color={COLORS.primary}
            fill={COLORS.primary}
          />
          <Text style={styles.ratingBadgeText}>
            {review.rating.toFixed(1)}
          </Text>
        </View>
      </View>

      <View style={styles.reviewMeta}>
        <Stars rating={review.rating} />
        <View style={styles.serviceBadge}>
          <Text
            style={styles.serviceText}
            numberOfLines={1}
          >
            {review.service_name || "Service"}
          </Text>
        </View>
      </View>

      <Text style={styles.comment}>
        {review.comment?.trim() ||
          "Customer submitted a rating without a written comment."}
      </Text>

      {hasReply && (
        <View style={styles.replyPreview}>
          <View style={styles.replyPreviewTitle}>
            <CheckCheck
              size={13}
              color={COLORS.success}
            />
            <Text style={styles.replyPreviewLabel}>
              Your Response
            </Text>
            {review.barber_replied_at && (
              <Text style={styles.replyDate}>
                {dateLabel(review.barber_replied_at)}
              </Text>
            )}
          </View>
          <Text style={styles.replyPreviewText}>
            {review.reply}
          </Text>
        </View>
      )}

      <View style={styles.reviewFooter}>
        <View
          style={[
            styles.status,
            hasReply
              ? styles.statusReplied
              : styles.statusPending,
          ]}
        >
          {hasReply ? (
            <CheckCheck
              size={12}
              color={COLORS.success}
            />
          ) : (
            <MessageCircle
              size={12}
              color={COLORS.primary}
            />
          )}
          <Text
            style={[
              styles.statusText,
              {
                color: hasReply
                  ? COLORS.success
                  : COLORS.primary,
              },
            ]}
          >
            {hasReply ? "Replied" : "Awaiting Reply"}
          </Text>
        </View>
        <SmallButton
          title={hasReply ? "Edit Reply" : "Reply"}
          disabled={disabled}
          onPress={() => onReply(review)}
          icon={
            <MessageSquareText
              size={12}
              color={COLORS.text}
            />
          }
        />
      </View>
    </View>
  );
}

export default function ReviewsScreen({
  onBack,
}: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const mounted = useRef(true);
  const listRef = useRef<FlatList<Review>>(null);

  const [list, setList] = useState<ReviewList | null>(null);
  const [statistics, setStatistics] =
    useState<ReviewStatistics | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] =
    useState("");
  const [serviceName, setServiceName] = useState("");
  const [debouncedService, setDebouncedService] =
    useState("");
  const [rating, setRating] =
    useState<RatingFilter>(undefined);
  const [sort, setSort] =
    useState<ReviewSort>("newest");
  const [page, setPage] = useState(1);

  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState("");
  const [statisticsError, setStatisticsError] =
    useState("");
  const [success, setSuccess] = useState("");

  const [replyReview, setReplyReview] =
    useState<Review | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedService(serviceName.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [serviceName]);

  const fetchReviews = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    void getReviews(
      {
        search: debouncedSearch || undefined,
        serviceName: debouncedService || undefined,
        rating,
        sort,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
      controller.signal
    )
      .then((result) => {
        if (controller.signal.aborted || !mounted.current) {
          return;
        }
        setList(result);
        if (
          page > 1 &&
          result.total <= (page - 1) * PAGE_SIZE
        ) {
          setPage(
            Math.max(
              1,
              Math.ceil(result.total / PAGE_SIZE)
            )
          );
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || !mounted.current) {
          return;
        }
        setList(null);
        setError(errorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted && mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => controller.abort();
  }, [
    debouncedSearch,
    debouncedService,
    rating,
    sort,
    page,
  ]);

  useEffect(() => {
    return fetchReviews();
  }, [fetchReviews, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setStatsLoading(true);
    setStatisticsError("");

    void getReviewStatistics(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && mounted.current) {
          setStatistics(result);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && mounted.current) {
          setStatisticsError(errorMessage(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && mounted.current) {
          setStatsLoading(false);
        }
      });

    return () => controller.abort();
  }, [refreshKey]);

  const refresh = useCallback(() => {
    if (saving) return;
    setSuccess("");
    setRefreshing(true);
    setRefreshKey((value) => value + 1);
  }, [saving]);

  const changeRating = useCallback(
    (value: RatingFilter) => {
      if (saving) return;
      setRating(value);
      setPage(1);
    },
    [saving]
  );

  const changeSort = useCallback(
    (value: ReviewSort) => {
      if (saving) return;
      setSort(value);
      setPage(1);
    },
    [saving]
  );

  const resetFilters = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setServiceName("");
    setDebouncedService("");
    setRating(undefined);
    setSort("newest");
    setPage(1);
  }, []);

  const openReply = useCallback((review: Review) => {
    setReplyReview(review);
    setReplyText(review.reply || "");
    setReplyError("");
  }, []);

  const closeReply = useCallback(() => {
    if (saving) return;
    setReplyReview(null);
    setReplyText("");
    setReplyError("");
  }, [saving]);

  const submitReply = async () => {
    if (!replyReview || saving) return;
    const cleaned = replyText.trim();

    if (!cleaned || cleaned.length > 3000) {
      setReplyError(
        "Enter a reply between 1 and 3000 characters."
      );
      return;
    }

    setSaving(true);
    setReplyError("");

    try {
      const response = await saveReviewReply(
        replyReview.id,
        cleaned
      );

      if (response.review.id !== replyReview.id) {
        throw new Error(
          "The saved reply could not be verified."
        );
      }

      if (!mounted.current) return;

      setList((previous) =>
        previous
          ? {
              ...previous,
              reviews: previous.reviews.map((item) =>
                item.id === response.review.id
                  ? response.review
                  : item
              ),
            }
          : previous
      );

      setReplyReview(null);
      setReplyText("");
      setSuccess(
        response.message ||
          "Your response has been saved successfully."
      );
      setRefreshKey((value) => value + 1);
    } catch (reason: unknown) {
      if (mounted.current) {
        setReplyError(errorMessage(reason));
      }
    } finally {
      if (mounted.current) {
        setSaving(false);
      }
    }
  };

  const metrics = useMemo(
    () => [
      {
        title: "Average Rating",
        value: statsLoading && !statistics
          ? "..."
          : statistics?.average_rating == null
            ? "—"
            : `${statistics.average_rating.toFixed(1)}/5`,
        description: "Overall satisfaction",
        icon: Star,
      },
      {
        title: "Total Reviews",
        value: statsLoading && !statistics
          ? "..."
          : String(statistics?.total_reviews ?? 0),
        description: "Customer feedback",
        icon: MessageSquareText,
      },
      {
        title: "5-Star Reviews",
        value: statsLoading && !statistics
          ? "..."
          : String(statistics?.five_star_reviews ?? 0),
        description: "Top-rated visits",
        icon: ThumbsUp,
      },
      {
        title: "Response Rate",
        value: statsLoading && !statistics
          ? "..."
          : statistics?.response_rate == null
            ? "—"
            : `${statistics.response_rate.toFixed(0)}%`,
        description: "Reviews answered",
        icon: CheckCheck,
      },
    ],
    [statistics, statsLoading]
  );

  const distribution = useMemo(
    () =>
      [5, 4, 3, 2, 1].map((value) => {
        const result = statistics?.rating_distribution.find(
          (item) => item.rating === value
        );
        return {
          rating: value,
          count: result?.count ?? 0,
          percentage: result?.percentage ?? 0,
        };
      }),
    [statistics]
  );

  const total = list?.total ?? 0;
  const pages = Math.max(
    1,
    Math.ceil(total / PAGE_SIZE)
  );
  const from =
    total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const metricWidth: `${number}%` =
    width < 340 ? "100%" : width >= 760 ? "23.5%" : "48.5%";

  const hasFilters =
    Boolean(debouncedSearch) ||
    Boolean(debouncedService) ||
    rating !== undefined;

  const header = (
    <View>
      <View style={styles.introduction}>
        <Text style={styles.eyebrow}>
          CUSTOMER EXPERIENCE
        </Text>
        <Text style={styles.pageTitle}>
          Reviews & Ratings
        </Text>
        <Text style={styles.subtitle}>
          Understand customer satisfaction and respond
          to feedback from your shop.
        </Text>
      </View>

      <Notice
        message={success}
        success
        onDismiss={() => setSuccess("")}
      />
      <Notice message={statisticsError} />

      <View style={styles.metrics}>
        {metrics.map((metric) => (
          <MetricCard
            key={metric.title}
            title={metric.title}
            value={metric.value}
            description={metric.description}
            icon={metric.icon}
            width={metricWidth}
          />
        ))}
      </View>

      <View style={styles.distributionPanel}>
        <View style={styles.panelHeader}>
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>
              Rating Distribution
            </Text>
            <Text style={styles.panelSubtitle}>
              Breakdown of customer ratings
            </Text>
          </View>
          <View style={styles.countBadge}>
            <Star
              size={11}
              color={COLORS.primary}
            />
            <Text style={styles.countBadgeText}>
              {statistics?.total_reviews ?? 0}
            </Text>
          </View>
        </View>

        {distribution.map((item) => {
          const selected = rating === item.rating;
          return (
            <Pressable
              key={item.rating}
              accessibilityRole="button"
              accessibilityLabel={`Filter ${item.rating}-star reviews`}
              disabled={saving}
              onPress={() =>
                changeRating(
                  selected ? undefined : item.rating
                )
              }
              style={({ pressed }) => [
                styles.distributionRow,
                selected && styles.distributionSelected,
                pressed && styles.buttonPressed,
              ]}
            >
              <View style={styles.distributionLabel}>
                <Text style={styles.distributionRating}>
                  {item.rating}
                </Text>
                <Star
                  size={11}
                  color={COLORS.primary}
                  fill={COLORS.primary}
                />
              </View>
              <View style={styles.track}>
                <View
                  style={[
                    styles.trackFill,
                    {
                      width: `${Math.max(
                        0,
                        Math.min(100, item.percentage)
                      )}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.distributionCount}>
                {item.count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.filterPanel}>
        <View style={styles.panelHeader}>
          <View>
            <Text style={styles.sectionTitle}>
              Customer Reviews
            </Text>
            <Text style={styles.panelSubtitle}>
              {total} matching reviews
            </Text>
          </View>
          <View style={styles.countBadge}>
            <MessageSquareText
              size={12}
              color={COLORS.primary}
            />
            <Text style={styles.countBadgeText}>
              {statistics?.total_reviews ?? 0}
            </Text>
          </View>
        </View>

        <View style={styles.searchContainer}>
          <Search
            size={15}
            color={COLORS.primary}
          />
          <TextInput
            value={search}
            onChangeText={setSearch}
            editable={!saving}
            maxLength={150}
            autoCorrect={false}
            placeholder="Search customer, review or service..."
            placeholderTextColor={COLORS.textMuted}
            style={styles.searchInput}
            accessibilityLabel="Search customer reviews"
          />
          {search.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setSearch("")}
            >
              <X size={14} color={COLORS.textMuted} />
            </Pressable>
          )}
        </View>

        <TextInput
          value={serviceName}
          onChangeText={setServiceName}
          editable={!saving}
          maxLength={150}
          placeholder="Filter by exact service name (optional)"
          placeholderTextColor={COLORS.textMuted}
          accessibilityLabel="Filter by service name"
          style={styles.serviceInput}
        />

        <Text style={styles.filterCaption}>
          Filter by rating
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          {[undefined, 5, 4, 3, 2, 1].map((value) => (
            <SmallButton
              key={value ?? "all"}
              title={
                value === undefined
                  ? "All"
                  : `${value} ★`
              }
              primary={rating === value}
              disabled={saving}
              onPress={() => changeRating(value)}
            />
          ))}
        </ScrollView>

        <Text style={styles.filterCaption}>
          Sort reviews
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          {SORT_OPTIONS.map((option) => (
            <SmallButton
              key={option.value}
              title={option.label}
              primary={sort === option.value}
              disabled={saving}
              onPress={() => changeSort(option.value)}
            />
          ))}
        </ScrollView>

        <View style={styles.filterFooter}>
          <SmallButton
            title="Reset Filters"
            disabled={saving}
            onPress={resetFilters}
            icon={
              <RotateCcw
                size={12}
                color={COLORS.text}
              />
            }
          />
        </View>
      </View>

      <Notice message={error} />
      <View style={styles.listHeading}>
        <Text style={styles.sectionTitle}>
          Customer Feedback
        </Text>
        <Text style={styles.panelSubtitle}>
          {from}–{to} of {total}
        </Text>
      </View>
    </View>
  );

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
          <ArrowLeft size={18} color={COLORS.text} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.topbarEyebrow}>
            KSHURAK BARBER
          </Text>
          <Text style={styles.topbarTitle}>
            Reviews & Ratings
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh reviews"
          disabled={saving || loading || statsLoading}
          onPress={refresh}
          style={[
            styles.iconButton,
            (saving || loading) && styles.disabled,
          ]}
        >
          {loading || refreshing || statsLoading ? (
            <ActivityIndicator
              size="small"
              color={COLORS.primary}
            />
          ) : (
            <RefreshCw
              size={17}
              color={COLORS.primary}
            />
          )}
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={loading ? [] : list?.reviews ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ReviewCard
            review={item}
            disabled={saving}
            onReply={openReply}
          />
        )}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={refresh}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading ? (
              <>
                <ActivityIndicator
                  size="large"
                  color={COLORS.primary}
                />
                <Text style={styles.emptyTitle}>
                  Loading reviews...
                </Text>
              </>
            ) : (
              <>
                <MessageSquareText
                  size={26}
                  color={COLORS.primary}
                />
                <Text style={styles.emptyTitle}>
                  {error
                    ? "Unable to Load Reviews"
                    : hasFilters
                      ? "No Matching Reviews"
                      : "No Reviews Yet"}
                </Text>
                <Text style={styles.emptyDescription}>
                  {error
                    ? "Please refresh and try again."
                    : hasFilters
                      ? "Adjust your search or filter settings."
                      : "Customer feedback will appear when completed appointments are reviewed."}
                </Text>
                {hasFilters && (
                  <SmallButton
                    title="Reset Filters"
                    onPress={resetFilters}
                  />
                )}
              </>
            )}
          </View>
        }
        ListFooterComponent={
          <View>
            <View style={styles.pagination}>
              <Text style={styles.paginationText}>
                Page {page} of {pages}
              </Text>
              <View style={styles.paginationActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous reviews page"
                  disabled={page <= 1 || loading || saving}
                  onPress={() =>
                    setPage((value) => Math.max(1, value - 1))
                  }
                  style={[
                    styles.paginationButton,
                    (page <= 1 || loading || saving) &&
                      styles.disabled,
                  ]}
                >
                  <ChevronLeft
                    size={17}
                    color={COLORS.text}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next reviews page"
                  disabled={
                    page >= pages || loading || saving
                  }
                  onPress={() =>
                    setPage((value) =>
                      Math.min(pages, value + 1)
                    )
                  }
                  style={[
                    styles.paginationButton,
                    (page >= pages || loading || saving) &&
                      styles.disabled,
                  ]}
                >
                  <ChevronRight
                    size={17}
                    color={COLORS.text}
                  />
                </Pressable>
              </View>
            </View>
            <View style={styles.securityNote}>
              <ShieldCheck
                size={14}
                color={COLORS.success}
              />
              <Text style={styles.securityText}>
                Reviews are retrieved for your authenticated shop.
              </Text>
            </View>
          </View>
        }
      />

      <Modal
        visible={replyReview !== null}
        transparent
        animationType="slide"
        onRequestClose={closeReply}
      >
        <KeyboardAvoidingView
          behavior={
            Platform.OS === "ios" ? "padding" : "height"
          }
          style={[
            styles.modalOverlay,
            {
              paddingTop: Math.max(16, insets.top),
              paddingBottom: Math.max(16, insets.bottom),
            },
          ]}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={styles.flex}>
                <Text style={styles.modalTitle}>
                  {replyReview?.reply
                    ? "Edit Your Reply"
                    : "Reply to Customer"}
                </Text>
                <Text style={styles.panelSubtitle}>
                  Respond to customer feedback
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close reply modal"
                disabled={saving}
                onPress={closeReply}
                style={styles.iconButton}
              >
                <X size={18} color={COLORS.text} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalBody}
            >
              {replyReview && (
                <>
                  <View style={styles.modalCustomer}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {initials(replyReview.customer_name)}
                      </Text>
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.customerName}>
                        {replyReview.customer_name}
                      </Text>
                      <Stars rating={replyReview.rating} />
                    </View>
                  </View>
                  <View style={styles.originalReview}>
                    <Text style={styles.originalReviewLabel}>
                      CUSTOMER REVIEW
                    </Text>
                    <Text style={styles.comment}>
                      {replyReview.comment ||
                        "No written comment."}
                    </Text>
                  </View>
                  <Text style={styles.replyFieldLabel}>
                    Your Response
                  </Text>
                  <TextInput
                    value={replyText}
                    onChangeText={setReplyText}
                    multiline
                    maxLength={3000}
                    editable={!saving}
                    textAlignVertical="top"
                    placeholder="Write your response..."
                    placeholderTextColor={COLORS.textMuted}
                    accessibilityLabel="Your response to customer review"
                    style={styles.replyInput}
                  />
                  <Text style={styles.characterCount}>
                    {replyText.length}/3000 characters
                  </Text>
                  <Notice message={replyError} />
                  <View style={styles.modalActions}>
                    <SmallButton
                      title="Cancel"
                      disabled={saving}
                      onPress={closeReply}
                    />
                    <SmallButton
                      title={saving ? "Saving..." : "Save Reply"}
                      primary
                      disabled={saving || !replyText.trim()}
                      onPress={() => void submitReply()}
                      icon={
                        saving ? (
                          <ActivityIndicator
                            size="small"
                            color={COLORS.black}
                          />
                        ) : (
                          <Send
                            size={12}
                            color={COLORS.black}
                          />
                        )
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderDark,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceDark,
    alignItems: "center",
    justifyContent: "center",
  },
  topbarEyebrow: {
    color: COLORS.primary,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  topbarTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 3,
  },
  content: {
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingTop: 15,
    paddingBottom: 25,
  },
  introduction: {
    marginBottom: 14,
  },
  eyebrow: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  pageTitle: {
    color: COLORS.text,
    fontSize: 23,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginTop: 5,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 5,
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 11,
    padding: 10,
    borderWidth: 1,
    borderRadius: 9,
    backgroundColor: COLORS.surfaceDark,
  },
  noticeText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 17,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 9,
    marginBottom: 15,
  },
  metricCard: {
    minHeight: 103,
    padding: 11,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    overflow: "hidden",
  },
  metricTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  metricIcon: {
    width: 27,
    height: 27,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
    borderRadius: 8,
    backgroundColor: "rgba(245,158,11,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  metricTitle: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 9,
    fontWeight: "700",
  },
  metricValue: {
    color: COLORS.text,
    fontSize: 23,
    fontWeight: "800",
    marginTop: 10,
    letterSpacing: -0.4,
  },
  metricDescription: {
    color: COLORS.textMuted,
    fontSize: 9,
    marginTop: 4,
  },
  distributionPanel: {
    padding: 13,
    marginBottom: 13,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 12,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "800",
  },
  panelSubtitle: {
    color: COLORS.textMuted,
    fontSize: 9,
    lineHeight: 15,
    marginTop: 4,
  },
  countBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "rgba(245,158,11,0.08)",
    borderColor: "rgba(245,158,11,0.24)",
    borderWidth: 1,
    borderRadius: 7,
  },
  countBadgeText: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
  },
  distributionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "transparent",
  },
  distributionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: "rgba(245,158,11,0.06)",
  },
  distributionLabel: {
    width: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  distributionRating: {
    color: COLORS.text,
    fontSize: 10,
    fontWeight: "800",
  },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: COLORS.thumbnail,
    borderRadius: 8,
    overflow: "hidden",
  },
  trackFill: {
    height: "100%",
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  distributionCount: {
    color: COLORS.textSecondary,
    width: 28,
    fontSize: 10,
    textAlign: "right",
  },
  filterPanel: {
    padding: 13,
    marginBottom: 13,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 37,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: COLORS.text,
    fontSize: 10,
    paddingVertical: 0,
  },
  serviceInput: {
    height: 37,
    marginTop: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 8,
    color: COLORS.text,
    fontSize: 10,
  },
  filterCaption: {
    color: COLORS.textSecondary,
    fontSize: 9,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 7,
  },
  chipRow: {
    alignItems: "center",
    gap: 6,
    paddingBottom: 2,
  },
  filterFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 11,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 7,
  },
  buttonPrimary: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  buttonLabel: {
    color: COLORS.text,
    fontSize: 10,
    fontWeight: "700",
  },
  buttonLabelPrimary: {
    color: COLORS.black,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.45,
  },
  listHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 9,
  },
  reviewCard: {
    padding: 12,
    marginBottom: 9,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 11,
  },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  avatar: {
    width: 35,
    height: 35,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245,158,11,0.1)",
    borderColor: "rgba(245,158,11,0.28)",
    borderWidth: 1,
  },
  avatarText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  customerName: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "800",
  },
  reviewDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  reviewDate: {
    color: COLORS.textMuted,
    fontSize: 9,
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
    backgroundColor: "rgba(245,158,11,0.08)",
    borderRadius: 6,
  },
  ratingBadgeText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "800",
  },
  reviewMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 10,
  },
  stars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  serviceBadge: {
    maxWidth: "55%",
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    backgroundColor: COLORS.surfaceDark,
  },
  serviceText: {
    color: COLORS.textSecondary,
    fontSize: 9,
  },
  comment: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 10,
  },
  replyPreview: {
    marginTop: 10,
    padding: 10,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.primary,
    borderRadius: 7,
    backgroundColor: COLORS.surfaceDark,
  },
  replyPreviewTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  replyPreviewLabel: {
    color: COLORS.success,
    fontSize: 9,
    fontWeight: "800",
  },
  replyDate: {
    marginLeft: "auto",
    color: COLORS.textMuted,
    fontSize: 8,
  },
  replyPreviewText: {
    color: COLORS.textSecondary,
    fontSize: 10,
    lineHeight: 17,
    marginTop: 5,
  },
  reviewFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: 6,
  },
  statusReplied: {
    borderColor: "rgba(34,197,94,0.28)",
    backgroundColor: "rgba(34,197,94,0.07)",
  },
  statusPending: {
    borderColor: "rgba(245,158,11,0.28)",
    backgroundColor: "rgba(245,158,11,0.07)",
  },
  statusText: {
    fontSize: 9,
    fontWeight: "800",
  },
  empty: {
    minHeight: 165,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 20,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 11,
    backgroundColor: COLORS.surface,
  },
  emptyTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
  },
  emptyDescription: {
    color: COLORS.textSecondary,
    fontSize: 10,
    lineHeight: 17,
    textAlign: "center",
  },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    marginTop: 3,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  paginationText: {
    color: COLORS.textMuted,
    fontSize: 10,
  },
  paginationActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  paginationButton: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 7,
    backgroundColor: COLORS.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
  },
  securityNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 9,
  },
  securityText: {
    color: COLORS.textMuted,
    fontSize: 9,
    lineHeight: 15,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 15,
    backgroundColor: COLORS.overlay,
  },
  modalSheet: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "90%",
    alignSelf: "center",
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 13,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "800",
  },
  modalBody: {
    padding: 14,
  },
  modalCustomer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 11,
  },
  originalReview: {
    backgroundColor: COLORS.surfaceDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    borderRadius: 8,
    marginBottom: 13,
  },
  originalReviewLabel: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  replyFieldLabel: {
    color: COLORS.text,
    fontSize: 10,
    fontWeight: "800",
  },
  replyInput: {
    minHeight: 115,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceDark,
    color: COLORS.text,
    borderRadius: 8,
    fontSize: 11,
    lineHeight: 18,
  },
  characterCount: {
    color: COLORS.textMuted,
    fontSize: 9,
    textAlign: "right",
    marginTop: 6,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
  },
});
