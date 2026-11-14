
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
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
} from "lucide-react";
import {
  getReviews,
  getReviewStatistics,
  saveReviewReply,
  type Review,
  type ReviewStatistics,
  type ReviewSort,
} from "../../services/reviewsApi";
export const COLORS = {
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
type RatingFilter = "all" | "5" | "4" | "3" | "2" | "1";
const PAGE_SIZE = 5;
function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function getInitials(value: string): string {
  return (
    value
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}
function RatingStars({ rating }: { rating: number }) {
  return (
    <span
      className="prv-stars"
      role="img"
      aria-label={`${rating} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={12}
          className={star > rating ? "empty" : ""}
        />
      ))}
    </span>
  );
}
interface ReviewRowProps {
  review: Review;
  replyId: string | null;
  replyText: string;
  replySaving: boolean;
  replyError: string;
  onEdit: (review: Review) => void;
  onCancel: () => void;
  onReplyChange: (value: string) => void;
  onSubmit: (review: Review) => void;
}
function ReviewRow({
  review,
  replyId,
  replyText,
  replySaving,
  replyError,
  onEdit,
  onCancel,
  onReplyChange,
  onSubmit,
}: ReviewRowProps) {
  const editing = replyId === review.id;
  const hasReply = Boolean(review.reply?.trim());
  return (
    <article className={`prv-row ${editing ? "prv-row-open" : ""}`}>
      <div className="prv-row-main">
        <div className="prv-customer">
          <div className="prv-avatar">
            {getInitials(review.customer_name || "Customer")}
          </div>
          <div className="prv-customer-info">
            <strong>{review.customer_name || "Customer"}</strong>
            <span className="prv-date">
              <Clock3 size={11} />
              {formatDate(review.created_at)}
            </span>
          </div>
        </div>
        <div className="prv-rating-cell">
          <RatingStars rating={review.rating} />
          <span className="prv-rating-number">
            {review.rating.toFixed(1)}
          </span>
        </div>
        <div className="prv-service-cell">
          <span>{review.service_name || "Service"}</span>
        </div>
        <div className="prv-comment-cell">
          <p>
            {review.comment?.trim() ||
              "Customer submitted a rating without a written comment."}
          </p>
          {hasReply && (
            <div className="prv-inline-reply">
              <CheckCheck size={12} />
              <span>
                <strong>Your reply:</strong> {review.reply}
              </span>
            </div>
          )}
        </div>
        <div className="prv-row-end">
          <span
            className={
              hasReply
                ? "prv-status prv-status-success"
                : "prv-status prv-status-pending"
            }
          >
            {hasReply ? (
              <>
                <CheckCheck size={12} />
                Replied
              </>
            ) : (
              <>
                <MessageCircle size={12} />
                Awaiting Reply
              </>
            )}
          </span>
          <button
            type="button"
            className="prv-btn prv-reply-btn"
            disabled={replySaving}
            onClick={() => onEdit(review)}
          >
            <MessageSquareText size={13} />
            {hasReply ? "Edit Reply" : "Reply"}
          </button>
        </div>
      </div>
      {editing && (
        <div className="prv-editor">
          <div className="prv-editor-heading">
            <div>
              <strong>
                {hasReply ? "Edit Your Response" : "Reply to Customer"}
              </strong>
              <p>Write a professional response to this review.</p>
            </div>
            <button
              type="button"
              className="prv-icon-btn"
              disabled={replySaving}
              onClick={onCancel}
              aria-label="Close reply editor"
            >
              <X size={15} />
            </button>
          </div>
          <textarea
            value={replyText}
            rows={3}
            maxLength={3000}
            disabled={replySaving}
            placeholder="Thank the customer and respond to their feedback..."
            onChange={(event) => onReplyChange(event.target.value)}
            aria-label={`Reply to ${review.customer_name || "customer"}`}
          />
          {replyError && (
            <div className="prv-inline-error" role="alert">
              <AlertCircle size={13} />
              {replyError}
            </div>
          )}
          <div className="prv-editor-footer">
            <small>{replyText.length}/3000 characters</small>
            <div>
              <button
                type="button"
                className="prv-btn"
                disabled={replySaving}
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="prv-btn prv-btn-gold"
                disabled={replySaving || !replyText.trim()}
                onClick={() => onSubmit(review)}
              >
                {replySaving ? (
                  <Loader2 size={13} className="prv-spin" />
                ) : (
                  <Send size={13} />
                )}
                {replySaving ? "Saving..." : "Save Reply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
export default function ReviewsPage() {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [stats, setStats] = useState<ReviewStatistics | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [ratingFilter, setRatingFilter] =
    useState<RatingFilter>("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [sortFilter, setSortFilter] =
    useState<ReviewSort>("newest");
  const [serviceOptions, setServiceOptions] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState("");
  const [statsError, setStatsError] = useState("");
  const [notice, setNotice] = useState("");
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [replySaving, setReplySaving] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void getReviews(
      {
        search: query,
        rating:
          ratingFilter === "all"
            ? undefined
            : Number(ratingFilter),
        serviceName:
          serviceFilter === "all" ? undefined : serviceFilter,
        sort: sortFilter,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
      controller.signal
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        setReviews(response.reviews);
        setTotal(response.total);
        if (
          page > 1 &&
          response.total <= (page - 1) * PAGE_SIZE
        ) {
          setPage(
            Math.max(1, Math.ceil(response.total / PAGE_SIZE))
          );
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load customer reviews."
        );
        setReviews([]);
        setTotal(0);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    page,
    query,
    ratingFilter,
    serviceFilter,
    sortFilter,
    refreshKey,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    setStatsLoading(true);
    setStatsError("");
    void getReviewStatistics(controller.signal)
      .then((statistics) => {
        if (!controller.signal.aborted) setStats(statistics);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setStatsError(
          err instanceof Error
            ? err.message
            : "Unable to load rating statistics."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatsLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);
  useEffect(() => {
    const controller = new AbortController();
    async function loadServiceOptions() {
      const services = new Set<string>();
      let offset = 0;
      const limit = 100;
      try {
        while (!controller.signal.aborted) {
          const result = await getReviews(
            { limit, offset, sort: "newest" },
            controller.signal
          );
          if (controller.signal.aborted) return;
          result.reviews.forEach((review) => {
            if (review.service_name?.trim()) {
              services.add(review.service_name);
            }
          });
          offset += result.reviews.length;
          if (
            result.reviews.length === 0 ||
            offset >= result.total
          ) {
            break;
          }
        }
        if (!controller.signal.aborted) {
          setServiceOptions(Array.from(services).sort());
        }
      } catch {
        // Service options are supplementary. The main reviews
        // list and rating statistics report their own errors.
      }
    }
    void loadServiceOptions();
    return () => controller.abort();
  }, [refreshKey]);
  const averageRating = stats?.average_rating ?? null;
  const totalReviews = stats?.total_reviews ?? 0;
  const metrics = useMemo(
    () => [
      {
        title: "Average Rating",
        value: statsLoading
          ? "..."
          : averageRating === null
            ? "—"
            : `${averageRating.toFixed(1)}/5`,
        note: "Overall satisfaction",
        icon: Star,
      },
      {
        title: "Total Reviews",
        value: statsLoading ? "..." : String(totalReviews),
        note: "Verified customer feedback",
        icon: MessageSquareText,
      },
      {
        title: "5-Star Reviews",
        value: statsLoading
          ? "..."
          : stats?.five_star_percentage == null
            ? "—"
            : `${stats.five_star_percentage.toFixed(0)}%`,
        note: `${stats?.five_star_reviews ?? 0} five-star reviews`,
        icon: ThumbsUp,
      },
      {
        title: "Response Rate",
        value: statsLoading
          ? "..."
          : stats?.response_rate == null
            ? "—"
            : `${stats.response_rate.toFixed(0)}%`,
        note: `${stats?.replied_reviews ?? 0} replies sent`,
        icon: CheckCheck,
      },
    ],
    [averageRating, stats, statsLoading, totalReviews]
  );
  const distribution = [5, 4, 3, 2, 1].map(
    (rating) =>
      stats?.rating_distribution.find(
        (item) => item.rating === rating
      ) ?? { rating, count: 0, percentage: 0 }
  );
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startIndex =
    total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const endIndex = Math.min(page * PAGE_SIZE, total);
  const hasFilters =
    Boolean(query) ||
    ratingFilter !== "all" ||
    serviceFilter !== "all";
  const resetFilters = useCallback(() => {
    setSearch("");
    setQuery("");
    setRatingFilter("all");
    setServiceFilter("all");
    setSortFilter("newest");
    setPage(1);
  }, []);
  const refreshReviews = useCallback(() => {
    if (replySaving) return;
    setNotice("");
    setError("");
    setStatsError("");
    setRefreshKey((value) => value + 1);
  }, [replySaving]);
  function openReplyEditor(review: Review) {
    setReplyId(review.id);
    setReplyText(review.reply || "");
    setReplyError("");
  }
  function closeReplyEditor() {
    if (replySaving) return;
    setReplyId(null);
    setReplyText("");
    setReplyError("");
  }
  async function submitReply(review: Review) {
    const text = replyText.trim();
    if (!text || text.length > 3000 || replySaving) return;
    setReplySaving(true);
    setReplyError("");
    try {
      const response = await saveReviewReply(review.id, text);
      if (response.review.id !== review.id) {
        throw new Error("Could not verify the saved reply.");
      }
      setReviews((existing) =>
        existing.map((item) =>
          item.id === review.id ? response.review : item
        )
      );
      setReplyId(null);
      setReplyText("");
      setNotice(
        response.message || "Reply saved successfully."
      );
      setRefreshKey((value) => value + 1);
    } catch (err: unknown) {
      setReplyError(
        err instanceof Error
          ? err.message
          : "Unable to save reply."
      );
    } finally {
      setReplySaving(false);
    }
  }
  return (
    <main className="prv-page">
      <style>{CSS}</style>
      <div className="prv-shell">
        <header className="prv-header">
          <div className="prv-heading">
            <span className="prv-eyebrow">
              <Star size={12} />
              Customer Experience
            </span>
            <h1>
              Reviews <span>& Ratings</span>
            </h1>
            <p>
              Manage customer feedback, monitor satisfaction,
              and respond to reviews from your shop.
            </p>
          </div>
          <div className="prv-header-actions">
            <button
              type="button"
              className="prv-btn"
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft size={14} />
              Dashboard
            </button>
            <button
              type="button"
              className="prv-btn prv-btn-gold"
              disabled={loading || statsLoading || replySaving}
              onClick={refreshReviews}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </header>
        {notice && (
          <div className="prv-notice prv-notice-success" role="status">
            <CheckCircle2 size={15} />
            <span>{notice}</span>
            <button
              type="button"
              className="prv-icon-btn"
              onClick={() => setNotice("")}
              aria-label="Dismiss message"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="prv-notice prv-notice-error" role="alert">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}
        {statsError && (
          <div className="prv-notice prv-notice-error" role="alert">
            <AlertCircle size={15} />
            <span>Rating statistics: {statsError}</span>
          </div>
        )}
        <section className="prv-overview" aria-label="Reviews overview">
          <div className="prv-metrics">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <article className="prv-metric" key={metric.title}>
                  <div className="prv-metric-head">
                    <span className="prv-metric-icon">
                      <Icon size={16} />
                    </span>
                    <span>{metric.title}</span>
                  </div>
                  <strong className="prv-metric-value">
                    {metric.value}
                  </strong>
                  <small>{metric.note}</small>
                </article>
              );
            })}
          </div>
          <section
            className="prv-distribution"
            aria-label="Rating distribution"
          >
            <div className="prv-section-head">
              <div>
                <h2>Rating Distribution</h2>
                <p>Customer satisfaction breakdown</p>
              </div>
              <span className="prv-pill">
                {totalReviews} reviews
              </span>
            </div>
            <div className="prv-distribution-content">
              <div className="prv-overall-rating">
                <strong>
                  {statsLoading
                    ? "..."
                    : averageRating === null
                      ? "—"
                      : averageRating.toFixed(1)}
                </strong>
                <RatingStars rating={Math.round(averageRating ?? 0)} />
                <small>Out of 5 stars</small>
              </div>
              <div className="prv-rating-bars">
                {distribution.map((item) => (
                  <div
                    key={item.rating}
                    className="prv-rating-row"
                  >
                    <span>
                      {item.rating}
                      <Star size={11} fill="currentColor" />
                    </span>
                    <div
                      className="prv-track"
                      role="progressbar"
                      aria-label={`${item.rating}-star rating percentage`}
                      aria-valuenow={item.percentage}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="prv-fill"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(100, item.percentage)
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="prv-percent">
                      {item.percentage.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </section>
        <section
          className="prv-reviews"
          aria-label="Customer reviews"
        >
          <div className="prv-reviews-head">
            <div>
              <span className="prv-eyebrow">
                Your Shop · Customer Feedback
              </span>
              <h2>Customer Reviews</h2>
              <p>
                All customer feedback in a clean, single-row view.
              </p>
            </div>
            <span className="prv-count-pill">
              <MessageSquareText size={13} />
              {totalReviews} Reviews
            </span>
          </div>
          <div className="prv-toolbar">
            <label className="prv-search">
              <Search size={15} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search customer, review, or service..."
                aria-label="Search customer reviews"
              />
            </label>
            <label className="prv-select-wrap">
              <select
                value={ratingFilter}
                aria-label="Filter by rating"
                onChange={(event) => {
                  setRatingFilter(
                    event.target.value as RatingFilter
                  );
                  setPage(1);
                }}
              >
                <option value="all">All Ratings</option>
                {[5, 4, 3, 2, 1].map((rating) => (
                  <option key={rating} value={rating}>
                    {rating} Star{rating === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
            <label className="prv-select-wrap">
              <select
                value={serviceFilter}
                aria-label="Filter by service"
                onChange={(event) => {
                  setServiceFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All Services</option>
                {serviceOptions.map((service) => (
                  <option value={service} key={service}>
                    {service}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
            <label className="prv-select-wrap">
              <select
                value={sortFilter}
                aria-label="Sort reviews"
                onChange={(event) => {
                  setSortFilter(
                    event.target.value as ReviewSort
                  );
                  setPage(1);
                }}
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="highest">Highest Rated</option>
                <option value="lowest">Lowest Rated</option>
              </select>
              <ChevronDown size={13} />
            </label>
          </div>
          <div className="prv-table-heading">
            <span>Customer</span>
            <span>Rating</span>
            <span>Service</span>
            <span>Review & Response</span>
            <span>Action</span>
          </div>
          {loading ? (
            <div className="prv-empty" role="status">
              <Loader2 size={23} className="prv-spin" />
              <h3>Loading Reviews</h3>
              <p>Retrieving the latest customer feedback...</p>
            </div>
          ) : error ? (
            <div className="prv-empty">
              <AlertCircle size={24} />
              <h3>Unable to Load Reviews</h3>
              <p>Check the error message above and refresh.</p>
            </div>
          ) : reviews.length > 0 ? (
            <div className="prv-list">
              {reviews.map((review) => (
                <ReviewRow
                  key={review.id}
                  review={review}
                  replyId={replyId}
                  replyText={replyText}
                  replySaving={replySaving}
                  replyError={replyError}
                  onEdit={openReplyEditor}
                  onCancel={closeReplyEditor}
                  onReplyChange={setReplyText}
                  onSubmit={(item) => void submitReply(item)}
                />
              ))}
            </div>
          ) : (
            <div className="prv-empty">
              <MessageSquareText size={25} />
              <h3>
                {hasFilters ? "No Matching Reviews" : "No Reviews Yet"}
              </h3>
              <p>
                {hasFilters
                  ? "Try adjusting your search or filter settings."
                  : "Customer reviews will appear after completed appointments are rated."}
              </p>
              {hasFilters && (
                <button
                  type="button"
                  className="prv-btn"
                  onClick={resetFilters}
                >
                  <RotateCcw size={13} />
                  Reset Filters
                </button>
              )}
            </div>
          )}
          <div className="prv-footer">
            <span>
              Showing {startIndex}–{endIndex} of {total} matching reviews
            </span>
            <nav
              className="prv-pagination"
              aria-label="Review pagination"
            >
              <button
                type="button"
                className="prv-icon-btn"
                aria-label="Previous page"
                disabled={page <= 1 || loading || replySaving}
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft size={15} />
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="prv-icon-btn"
                aria-label="Next page"
                disabled={
                  page >= totalPages || loading || replySaving
                }
                onClick={() => setPage((value) => value + 1)}
              >
                <ChevronRight size={15} />
              </button>
            </nav>
          </div>
        </section>
        <div className="prv-security-note">
          <ShieldCheck size={14} />
          Only customer reviews belonging to your shop are displayed.
        </div>
      </div>
    </main>
  );
}
const CSS = `
.prv-page {
  --gold:${COLORS.primary};
  --bg:${COLORS.background};
  --surface:${COLORS.surface};
  --dark:${COLORS.surfaceDark};
  --raised:${COLORS.surfaceLight};
  --border:${COLORS.border};
  --border-light:${COLORS.borderLight};
  --text:${COLORS.text};
  --secondary:${COLORS.textSecondary};
  --muted:${COLORS.textMuted};
  --success:${COLORS.success};
  --error:${COLORS.error};
  width:100%;
  min-width:0;
  min-height:100%;
  padding:20px clamp(12px,2.4vw,30px) 28px;
  background:var(--bg);
  color:var(--text);
  font-family:Inter,"Segoe UI",Arial,sans-serif;
  font-size:12px;
  color-scheme:dark;
}
.prv-page *, .prv-page *::before, .prv-page *::after {
  box-sizing:border-box;
}
.prv-page button, .prv-page input,
.prv-page select, .prv-page textarea {
  font:inherit;
}
.prv-page button {cursor:pointer;}
.prv-page button:disabled {opacity:.45;cursor:not-allowed;}
.prv-page :is(button,input,select,textarea):focus-visible {
  outline:2px solid var(--gold);
  outline-offset:2px;
}
.prv-page svg {flex-shrink:0;}
.prv-shell {width:100%;max-width:1500px;margin:0 auto;min-width:0;}
.prv-header {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  flex-wrap:wrap;
  margin-bottom:18px;
}
.prv-heading {min-width:0;}
.prv-eyebrow {
  display:inline-flex;
  align-items:center;
  gap:6px;
  color:var(--gold);
  font-size:9px;
  font-weight:800;
  letter-spacing:1.2px;
  text-transform:uppercase;
}
.prv-header h1 {
  margin:6px 0 5px;
  font-size:26px;
  line-height:1.15;
  font-weight:850;
  letter-spacing:-.9px;
}
.prv-header h1 span {color:var(--gold);}
.prv-header p {
  margin:0;
  font-size:11px;
  line-height:1.6;
  color:var(--secondary);
}
.prv-header-actions {display:flex;align-items:center;gap:8px;}
.prv-btn {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  width:auto;
  min-height:31px;
  padding:6px 11px;
  border:1px solid var(--border-light);
  border-radius:7px;
  color:var(--text);
  background:var(--raised);
  font-size:10px!important;
  font-weight:750!important;
  white-space:nowrap;
  transition:background .18s,border-color .18s,color .18s;
}
.prv-btn:hover:not(:disabled) {
  border-color:var(--gold);
  color:var(--gold);
  background:#29251e;
}
.prv-btn-gold, .prv-btn-gold:hover:not(:disabled) {
  border-color:var(--gold);
  color:${COLORS.black};
  background:var(--gold);
}
.prv-icon-btn {
  display:grid;
  place-items:center;
  width:28px;
  height:28px;
  padding:0;
  border:1px solid var(--border-light);
  border-radius:7px;
  background:var(--raised);
  color:var(--text);
}
.prv-icon-btn:hover:not(:disabled) {
  color:var(--gold);
  border-color:var(--gold);
}
.prv-notice {
  display:flex;
  align-items:center;
  gap:9px;
  margin-bottom:12px;
  padding:10px 12px;
  border:1px solid var(--border-light);
  border-radius:8px;
  background:var(--surface);
  color:var(--secondary);
  font-size:11px;
}
.prv-notice span {flex:1;min-width:0;}
.prv-notice-success {
  color:var(--success);
  border-color:rgba(34,197,94,.32);
  background:rgba(34,197,94,.07);
}
.prv-notice-error {
  color:var(--error);
  border-color:rgba(239,68,68,.32);
  background:rgba(239,68,68,.07);
}
.prv-overview {
  display:grid;
  grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);
  gap:11px;
  margin-bottom:17px;
}
.prv-metrics {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:10px;
}
.prv-metric, .prv-distribution {
  min-width:0;
  border:1px solid var(--border);
  border-radius:11px;
  background:linear-gradient(135deg,var(--raised),var(--surface),var(--dark));
  transition:border-color .18s,box-shadow .18s,transform .18s;
}
.prv-metric:hover, .prv-distribution:hover {
  border-color:rgba(245,158,11,.55);
  box-shadow:0 5px 20px rgba(0,0,0,.2);
  transform:translateY(-1px);
}
.prv-metric {
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:13px 14px;
  min-height:91px;
}
.prv-metric-head {
  display:flex;
  align-items:center;
  gap:8px;
  color:var(--secondary);
  font-size:10px;
  font-weight:650;
}
.prv-metric-icon {
  display:grid;
  place-items:center;
  width:28px;
  height:28px;
  border:1px solid rgba(245,158,11,.23);
  background:rgba(245,158,11,.08);
  border-radius:8px;
  color:var(--gold);
}
.prv-metric-value {
  font-size:23px;
  line-height:1;
  font-weight:850;
  letter-spacing:-.6px;
}
.prv-metric small {font-size:9px;color:var(--muted);}
.prv-distribution {padding:14px 16px;}
.prv-section-head {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:8px;
}
.prv-section-head h2 {margin:0 0 4px;font-size:12px;}
.prv-section-head p {margin:0;font-size:9px;color:var(--muted);}
.prv-pill {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:5px 8px;
  border:1px solid rgba(245,158,11,.23);
  border-radius:6px;
  background:rgba(245,158,11,.07);
  color:var(--gold);
  font-size:9px;
  white-space:nowrap;
}
.prv-distribution-content {
  display:grid;
  grid-template-columns:90px minmax(0,1fr);
  gap:16px;
  align-items:center;
  margin-top:15px;
}
.prv-overall-rating {
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:6px;
  padding-right:10px;
  border-right:1px solid var(--border);
}
.prv-overall-rating>strong {font-size:32px;line-height:1;font-weight:850;}
.prv-overall-rating>small {font-size:9px;color:var(--muted);}
.prv-stars {display:inline-flex;align-items:center;gap:2px;}
.prv-stars svg {color:var(--gold);fill:var(--gold);}
.prv-stars svg.empty {color:var(--border-light);fill:none;}
.prv-rating-bars {display:grid;gap:8px;}
.prv-rating-row {
  display:grid;
  grid-template-columns:29px minmax(0,1fr) 33px;
  align-items:center;
  gap:8px;
}
.prv-rating-row>span:first-child {
  display:inline-flex;
  align-items:center;
  gap:4px;
  font-size:10px;
}
.prv-rating-row>span:first-child svg {color:var(--gold);}
.prv-track {
  height:6px;
  border-radius:8px;
  overflow:hidden;
  background:var(--raised);
}
.prv-fill {height:100%;background:var(--gold);border-radius:inherit;}
.prv-percent {font-size:9px;text-align:right;color:var(--secondary);}
.prv-reviews {
  overflow:hidden;
  border:1px solid var(--border);
  border-radius:12px;
  background:var(--surface);
}
.prv-reviews-head {
  display:flex;
  justify-content:space-between;
  align-items:center;
  flex-wrap:wrap;
  gap:10px;
  padding:15px 17px 10px;
}
.prv-reviews-head h2 {
  font-size:15px;
  font-weight:800;
  margin:5px 0 4px;
}
.prv-reviews-head p {font-size:10px;color:var(--secondary);margin:0;}
.prv-count-pill {
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:7px 10px;
  background:rgba(245,158,11,.07);
  border:1px solid rgba(245,158,11,.25);
  border-radius:7px;
  color:var(--gold);
  font-size:10px;
  font-weight:750;
  white-space:nowrap;
}
.prv-toolbar {
  display:grid;
  grid-template-columns:minmax(160px,1.5fr) repeat(3,minmax(105px,1fr));
  gap:8px;
  padding:0 17px 13px;
}
.prv-search {
  display:flex;
  align-items:center;
  gap:8px;
  height:34px;
  padding:0 10px;
  background:var(--dark);
  border:1px solid var(--border-light);
  border-radius:7px;
}
.prv-search>svg {color:var(--gold);}
.prv-search input {
  width:100%;
  min-width:0;
  border:0;
  outline:0;
  background:transparent;
  color:var(--text);
  font-size:10px;
}
.prv-search input::placeholder {color:var(--muted);}
.prv-select-wrap {position:relative;min-width:0;}
.prv-select-wrap select {
  display:block;
  width:100%;
  height:34px;
  padding:0 29px 0 10px;
  appearance:none;
  border:1px solid var(--border-light);
  border-radius:7px;
  background:var(--dark);
  color:var(--text);
  font-size:10px;
  cursor:pointer;
}
.prv-select-wrap select option {background:var(--surface);}
.prv-select-wrap>svg {
  position:absolute;
  right:10px;
  top:11px;
  color:var(--muted);
  pointer-events:none;
}
.prv-table-heading, .prv-row-main {
  display:grid;
  grid-template-columns:minmax(135px,1.1fr) 95px minmax(95px,.8fr) minmax(190px,2fr) 122px;
  gap:13px;
  align-items:center;
}
.prv-table-heading {
  padding:10px 15px;
  border-top:1px solid var(--border);
  border-bottom:1px solid var(--border);
  background:var(--dark);
  color:var(--muted);
  font-size:9px;
  font-weight:800;
  letter-spacing:.05em;
  text-transform:uppercase;
}
.prv-table-heading span:last-child {text-align:right;}
.prv-list {
  display:grid;
  gap:8px;
  padding:11px;
}
.prv-row {
  min-width:0;
  overflow:hidden;
  border:1px solid var(--border-light);
  border-radius:9px;
  background:linear-gradient(105deg,var(--raised),var(--surface));
  transition:border-color .18s,background .18s,box-shadow .18s;
}
.prv-row:hover, .prv-row-open {
  border-color:rgba(245,158,11,.56);
  box-shadow:0 4px 16px rgba(0,0,0,.18);
}
.prv-row-main {
  min-height:78px;
  padding:11px 13px;
}
.prv-customer {
  display:flex;
  align-items:center;
  gap:9px;
  min-width:0;
}
.prv-avatar {
  display:grid;
  place-items:center;
  flex:0 0 34px;
  width:34px;
  height:34px;
  border-radius:9px;
  border:1px solid rgba(245,158,11,.28);
  background:rgba(245,158,11,.08);
  color:var(--gold);
  font-size:11px;
  font-weight:850;
}
.prv-customer-info {min-width:0;}
.prv-customer-info strong {
  display:block;
  max-width:100%;
  color:var(--text);
  font-size:11px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.prv-date {
  display:inline-flex;
  align-items:center;
  gap:5px;
  margin-top:5px;
  color:var(--muted);
  font-size:9px;
}
.prv-rating-cell {display:flex;align-items:center;gap:6px;min-width:0;}
.prv-rating-cell .prv-stars {gap:1px;}
.prv-rating-cell .prv-stars svg {width:11px;height:11px;}
.prv-rating-number {font-size:10px;font-weight:850;color:var(--gold);}
.prv-service-cell {min-width:0;}
.prv-service-cell>span {
  display:inline-flex;
  max-width:100%;
  padding:5px 7px;
  border:1px solid var(--border-light);
  border-radius:6px;
  color:var(--secondary);
  background:var(--dark);
  font-size:9px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.prv-comment-cell {min-width:0;}
.prv-comment-cell>p {
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  overflow:hidden;
  margin:0;
  color:var(--text);
  font-size:10px;
  line-height:1.55;
  overflow-wrap:anywhere;
}
.prv-inline-reply {
  display:flex;
  align-items:flex-start;
  gap:5px;
  margin-top:6px;
  color:var(--secondary);
  font-size:9px;
  line-height:1.4;
}
.prv-inline-reply svg {color:var(--gold);margin-top:1px;}
.prv-inline-reply span {
  display:-webkit-box;
  -webkit-line-clamp:1;
  -webkit-box-orient:vertical;
  overflow:hidden;
  overflow-wrap:anywhere;
}
.prv-inline-reply strong {color:var(--gold);}
.prv-row-end {
  display:flex;
  flex-direction:column;
  align-items:flex-end;
  gap:8px;
}
.prv-status {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:5px;
  padding:4px 6px;
  border:1px solid;
  border-radius:6px;
  font-size:9px;
  font-weight:750;
  white-space:nowrap;
}
.prv-status-success {
  color:var(--success);
  background:rgba(34,197,94,.07);
  border-color:rgba(34,197,94,.28);
}
.prv-status-pending {
  color:var(--gold);
  background:rgba(245,158,11,.07);
  border-color:rgba(245,158,11,.28);
}
.prv-reply-btn {min-height:28px;padding:5px 9px;}
.prv-editor {
  display:grid;
  gap:10px;
  padding:12px 14px;
  border-top:1px solid var(--border-light);
  background:var(--dark);
}
.prv-editor-heading {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:10px;
}
.prv-editor-heading strong {font-size:11px;}
.prv-editor-heading p {margin:4px 0 0;color:var(--secondary);font-size:10px;}
.prv-editor textarea {
  width:100%;
  min-height:73px;
  resize:vertical;
  padding:10px;
  background:var(--surface);
  border:1px solid var(--border-light);
  border-radius:8px;
  color:var(--text);
  font-size:11px;
  line-height:1.5;
}
.prv-editor textarea:focus {outline:1px solid var(--gold);}
.prv-editor-footer {
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:9px;
}
.prv-editor-footer>small {font-size:9px;color:var(--muted);}
.prv-editor-footer>div {display:flex;gap:7px;}
.prv-inline-error {
  display:flex;
  align-items:center;
  gap:6px;
  font-size:10px;
  color:var(--error);
}
.prv-empty {
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:10px;
  min-height:175px;
  padding:25px;
  color:var(--secondary);
  text-align:center;
}
.prv-empty svg {color:var(--gold);}
.prv-empty h3 {margin:0;font-size:13px;color:var(--text);}
.prv-empty p {margin:0;max-width:380px;font-size:10px;line-height:1.6;}
.prv-footer {
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:10px;
  padding:11px 15px;
  border-top:1px solid var(--border);
  font-size:10px;
  color:var(--muted);
}
.prv-pagination {display:flex;align-items:center;gap:9px;}
.prv-pagination>span {font-size:10px;color:var(--secondary);}
.prv-security-note {
  display:flex;
  align-items:center;
  gap:7px;
  margin-top:13px;
  color:var(--muted);
  font-size:10px;
}
.prv-security-note svg {color:var(--success);}
.prv-spin {animation:prv-spin 1s linear infinite;}
@keyframes prv-spin {to {transform:rotate(360deg);}}
@media(max-width:1150px) {
  .prv-overview {grid-template-columns:1fr;}
  .prv-metrics {grid-template-columns:repeat(4,minmax(0,1fr));}
  .prv-table-heading, .prv-row-main {
    grid-template-columns:minmax(120px,1.1fr) 85px minmax(85px,.75fr) minmax(150px,2fr) 105px;
    gap:9px;
  }
}
@media(max-width:900px) {
  .prv-toolbar {grid-template-columns:repeat(2,minmax(0,1fr));}
  .prv-search {grid-column:1/-1;}
  .prv-table-heading {display:none;}
  .prv-row-main {
    grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto;
    gap:10px;
  }
  .prv-customer {grid-column:1;}
  .prv-rating-cell {grid-column:2;}
  .prv-service-cell {grid-column:3;justify-self:end;}
  .prv-comment-cell {grid-column:1/3;}
  .prv-row-end {
    grid-column:3;
    grid-row:2;
    align-self:center;
  }
}
@media(max-width:650px) {
  .prv-page {padding:14px 10px 24px;}
  .prv-header h1 {font-size:22px;}
  .prv-metrics {grid-template-columns:repeat(2,minmax(0,1fr));}
  .prv-distribution-content {grid-template-columns:75px 1fr;gap:10px;}
  .prv-reviews-head {padding:12px 11px;}
  .prv-toolbar {padding:0 11px 11px;gap:7px;}
  .prv-row-main {
    grid-template-columns:minmax(0,1fr) auto;
    gap:9px;
  }
  .prv-customer {grid-column:1;}
  .prv-rating-cell {grid-column:2;}
  .prv-service-cell {grid-column:1;}
  .prv-comment-cell {grid-column:1/-1;}
  .prv-row-end {
    grid-column:1/-1;
    grid-row:auto;
    flex-direction:row;
    justify-content:space-between;
    align-items:center;
  }
  .prv-inline-reply span {-webkit-line-clamp:2;}
}
@media(max-width:430px) {
  .prv-header-actions {width:100%;}
  .prv-header-actions .prv-btn {flex:1;}
  .prv-overall-rating>strong {font-size:26px;}
  .prv-metric {padding:11px;}
  .prv-metric-value {font-size:20px;}
  .prv-toolbar {grid-template-columns:1fr;}
  .prv-search {grid-column:auto;}
  .prv-footer {align-items:flex-start;}
}
@media(prefers-reduced-motion:reduce) {
  .prv-page * {
    animation-duration:.01ms!important;
    transition-duration:.01ms!important;
  }
}
`;
