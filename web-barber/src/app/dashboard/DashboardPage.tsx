
import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useSyncExternalStore,
} from "react";
import type { ReactNode, ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Search,
  Store,
  CalendarDays,
  CalendarClock,
  Users,
  UserRound,
  ChartNoAxesCombined,
  Bell,
  Scissors,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Wallet,
  Star,
  Clock3,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  CalendarCheck,
  XCircle,
} from "lucide-react";
import {
  getBarberBookings,
  type BarberBooking,
} from "../../services/bookingApi";
import {
  getRescheduleRequests,
  type RescheduleRequest,
} from "../../services/reschedulingApi";
import {
  getUnreadNotificationCount,
} from "../../services/notificationsApi";
import {
  getReviewStatistics,
  type ReviewStatistics,
} from "../../services/reviewsApi";
import "../../styles/dashboard.css";

type ChartPeriod = "7d" | "1m" | "2m" | "3m" | "6m";

type NavigationItem = {
  label: string;
  icon: ComponentType<{ size?: number }>;
};

const navigationItems: NavigationItem[] = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Shop Setup", icon: Store },
  { label: "Bookings", icon: CalendarDays },
  { label: "Rescheduling", icon: CalendarClock },
  { label: "Workers", icon: Users },
  { label: "Customers", icon: UserRound },
  { label: "Reviews", icon: Star },
  { label: "Notifications", icon: Bell },
  { label: "Services", icon: Scissors },
];

type DashboardSnapshot = {
  bookings: BarberBooking[];
  totalBookings: number;
  bookingLoading: boolean;
  bookingError: string;
  bookingLoaded: boolean;
  lastUpdated: string;
  reschedules: RescheduleRequest[];
  rescheduleLoading: boolean;
  rescheduleError: string;
  rescheduleLoaded: boolean;
  unreadCount: number;
  notificationError: string;
  notificationLoading: boolean;
  notificationLoaded: boolean;
  reviewStats: ReviewStatistics | null;
  reviewsLoading: boolean;
  reviewsError: string;
  reviewsLoaded: boolean;
};

type DashboardSection =
  | "bookings"
  | "reschedules"
  | "notifications"
  | "reviews";

type DashboardCacheEntry = {
  initialized: boolean;
  snapshot: DashboardSnapshot;
  listeners: Set<() => void>;
  jobs: Partial<Record<DashboardSection, Promise<void>>>;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => DashboardSnapshot;
};

const dashboardCaches = new Map<string, DashboardCacheEntry>();

function getDashboardCache(
  barberId: string,
  token: string
): DashboardCacheEntry {
  const key = JSON.stringify([barberId, token]);
  const existing = dashboardCaches.get(key);
  if (existing) return existing;

  const entry: DashboardCacheEntry = {
    initialized: false,
    snapshot: {
      bookings: [],
      totalBookings: 0,
      bookingLoading: true,
      bookingError: "",
      bookingLoaded: false,
      lastUpdated: "",
      reschedules: [],
      rescheduleLoading: true,
      rescheduleError: "",
      rescheduleLoaded: false,
      unreadCount: 0,
      notificationError: "",
      notificationLoading: true,
      notificationLoaded: false,
      reviewStats: null,
      reviewsLoading: true,
      reviewsError: "",
      reviewsLoaded: false,
    },
    listeners: new Set(),
    jobs: {},
    subscribe: () => () => undefined,
    getSnapshot: () => entry.snapshot,
  };

  entry.subscribe = (listener) => {
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  };

  dashboardCaches.set(key, entry);
  return entry;
}

function updateDashboardCache(
  entry: DashboardCacheEntry,
  patch: Partial<DashboardSnapshot>
): void {
  entry.snapshot = {
    ...entry.snapshot,
    ...patch,
  };
  entry.listeners.forEach((listener) => listener());
}

function dashboardError(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error ? error.message : fallback;
}

function loadDashboardSection(
  entry: DashboardCacheEntry,
  section: DashboardSection
): Promise<void> {
  const existingJob = entry.jobs[section];
  if (existingJob) return existingJob;

  if (section === "bookings") {
    updateDashboardCache(entry, {
      bookingLoading: true,
      bookingError: "",
    });
  } else if (section === "reschedules") {
    updateDashboardCache(entry, {
      rescheduleLoading: true,
      rescheduleError: "",
    });
  } else if (section === "reviews") {
    updateDashboardCache(entry, {
      reviewsLoading: true,
      reviewsError: "",
    });
  } else {
    updateDashboardCache(entry, {
      notificationLoading: true,
      notificationError: "",
    });
  }

  const job = (async () => {
    try {
      if (section === "bookings") {
        const response = await getBarberBookings({});
        if (
          !Array.isArray(response.bookings) ||
          !Number.isInteger(response.total) ||
          response.total < 0
        ) {
          throw new Error("Invalid booking response.");
        }
        updateDashboardCache(entry, {
          bookings: response.bookings,
          totalBookings: response.total,
          bookingLoaded: true,
          lastUpdated: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        });
      } else if (section === "reschedules") {
        const response = await getRescheduleRequests();
        updateDashboardCache(entry, {
          reschedules: response.requests,
          rescheduleLoaded: true,
        });
      } else if (section === "reviews") {
        const reviewStats = await getReviewStatistics();
        updateDashboardCache(entry, {
          reviewStats,
          reviewsLoaded: true,
        });
      } else {
        const response = await getUnreadNotificationCount();
        updateDashboardCache(entry, {
          unreadCount: response.unread_count,
          notificationLoaded: true,
        });
      }
    } catch (error: unknown) {
      if (section === "bookings") {
        updateDashboardCache(entry, {
          bookingError: dashboardError(
            error,
            "Unable to load booking information."
          ),
        });
      } else if (section === "reschedules") {
        updateDashboardCache(entry, {
          rescheduleError: dashboardError(
            error,
            "Unable to load rescheduling requests."
          ),
        });
      } else if (section === "reviews") {
        updateDashboardCache(entry, {
          reviewsError: dashboardError(
            error,
            "Unable to retrieve review statistics."
          ),
        });
      } else {
        updateDashboardCache(entry, {
          notificationError: dashboardError(
            error,
            "Unable to retrieve notification count."
          ),
        });
      }
    } finally {
      if (section === "bookings") {
        updateDashboardCache(entry, {
          bookingLoading: false,
        });
      } else if (section === "reschedules") {
        updateDashboardCache(entry, {
          rescheduleLoading: false,
        });
      } else if (section === "reviews") {
        updateDashboardCache(entry, {
          reviewsLoading: false,
        });
      } else {
        updateDashboardCache(entry, {
          notificationLoading: false,
        });
      }
    }
  })();

  entry.jobs[section] = job;

  void job.then(() => {
    if (entry.jobs[section] === job) {
      delete entry.jobs[section];
    }
  });

  return job;
}

const dashboardStyles = `
.kp-rating-shortcut {
  display:flex;
  align-items:center;
  gap:10px;
  width:100%;
  text-align:left;
  background:transparent;
  color:inherit;
  border:1px solid transparent;
  border-radius:10px;
  padding:6px;
  cursor:pointer;
  font:inherit;
}
.kp-rating-shortcut:hover,
.kp-rating-shortcut:focus-visible {
  border-color:#F59E0B;
  background:rgba(245,158,11,.06);
  outline:2px solid #F59E0B;
  outline-offset:2px;
}
.kp-rating-shortcut p {
  flex:1;
  min-width:0;
}
.kp-rating-shortcut > svg:last-child {
  color:#F59E0B;
  flex-shrink:0;
}
.kp-topbar-refresh {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:39px;
  height:39px;
  flex-shrink:0;
  border:1px solid #38332a;
  border-radius:10px;
  background:#1b1c1f;
  color:#f59e0b;
  cursor:pointer;
}
.kp-topbar-refresh:hover:not(:disabled) {
  background:#292113;
  border-color:#f59e0b;
}
.kp-topbar-refresh:disabled {
  opacity:.6;
  cursor:not-allowed;
}
.kp-refresh-spinning {
  animation:kp-spin 1.2s linear infinite;
}
@keyframes kp-spin {
  to {transform:rotate(360deg);}
}
.kp-period-selector {
  display:inline-flex;
  align-items:center;
  gap:8px;
  min-height:36px;
  padding:0 10px;
  background:#161719;
  border:1px solid #34343a;
  border-radius:9px;
  color:#f59e0b;
}
.kd-layout .kp-period-selector select {
  width:auto;
  min-width:105px;
  border:0;
  padding:7px 0;
  background:transparent;
  color:#f8f8fa;
  font-size:11px;
  font-weight:600;
  cursor:pointer;
  outline:0;
}
.kp-period-selector select option {
  color:#fff;
  background:#191919;
}
@media(max-width:600px) {
  .kd-layout .kp-period-selector select {
    min-width:85px;
    font-size:10px;
  }
  .kp-topbar-refresh {
    width:35px;
    height:35px;
  }
}
@media(prefers-reduced-motion:reduce) {
  .kp-refresh-spinning {animation:none;}
}
.kd-booking-refresh {
  display:inline-flex;
  align-items:center;
  gap:7px;
  background:#292014;
  border:1px solid #785521;
  border-radius:8px;
  color:#f8bc55;
  padding:9px 12px;
  cursor:pointer;
  font-size:12px;
}
.kd-booking-refresh:disabled {
  opacity:.5;
  cursor:not-allowed;
}
.kd-booking-alert {
  display:flex;
  align-items:flex-start;
  gap:9px;
  background:#351b1c;
  border:1px solid #90484c;
  border-radius:10px;
  padding:13px;
  color:#ffb3b3;
  font-size:12px;
  line-height:1.6;
  margin-bottom:17px;
}
.kd-booking-summary {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:12px;
  margin-bottom:22px;
}
.kd-booking-mini {
  border:1px solid #3d352b;
  background:linear-gradient(145deg,#1b1b1e,#111214);
  border-radius:12px;
  padding:15px;
  text-align:left;
  cursor:pointer;
  color:#f4f4f5;
}
.kd-booking-mini:hover {
  border-color:#f59e0b;
  background:#251d12;
}
.kd-booking-mini span {
  display:block;
  color:#a7a6ad;
  font-size:11px;
  margin-bottom:8px;
}
.kd-booking-mini strong {
  font-size:26px;
  color:#f5ad32;
}
.kd-schedule-list {
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:15px;
}
.kd-schedule-row {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  background:#111315;
  border:1px solid #353331;
  border-radius:10px;
  padding:13px;
}
.kd-schedule-time {
  font-size:12px;
  font-weight:800;
  color:#f6b94e;
  white-space:nowrap;
}
.kd-schedule-details {flex:1;min-width:0;}
.kd-schedule-details strong {
  display:block;
  font-size:12px;
  color:#f5f5f5;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.kd-schedule-details span {
  display:block;
  color:#a5a5ad;
  font-size:11px;
  margin-top:5px;
  line-height:1.4;
}
.kd-schedule-price {
  font-size:12px;
  font-weight:800;
  color:#f1f1f2;
}
.kd-booking-chart {
  display:flex;
  align-items:flex-end;
  gap:12px;
  min-height:185px;
  padding:25px 15px 12px;
}
.kd-chart-column {
  display:flex;
  align-items:center;
  flex-direction:column;
  justify-content:flex-end;
  gap:8px;
  flex:1;
  min-width:0;
  height:160px;
}
.kd-chart-column strong {
  font-size:11px;
  color:#d6d6dc;
}
.kd-chart-bar-track {
  display:flex;
  align-items:flex-end;
  width:100%;
  max-width:35px;
  height:115px;
  background:#25211b;
  border-radius:7px 7px 0 0;
  overflow:hidden;
}
.kd-chart-bar-fill {
  width:100%;
  background:linear-gradient(180deg,#f8b83e,#a7650e);
  border-radius:7px 7px 0 0;
  min-height:0;
}
.kd-chart-column span {
  font-size:10px;
  color:#9fa0a8;
}
.kd-live-note {
  font-size:11px;
  color:#aaa4a0;
  line-height:1.6;
  padding:0 16px 13px;
}
.kd-live-loading {
  padding:35px 16px;
  color:#a7a9b1;
  text-align:center;
  font-size:13px;
}
.kd-reschedule-section {
  margin-bottom:24px;
  background:#171719;
  border:1px solid #38322c;
  border-radius:15px;
  padding:22px;
}
.kd-reschedule-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  margin-bottom:19px;
}
.kd-reschedule-heading h2 {
  margin:0 0 6px;
  font-size:19px;
  color:#fff;
}
.kd-reschedule-heading p {
  margin:0;
  color:#a6a6ae;
  font-size:12px;
}
.kd-reschedule-cards {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:12px;
}
.kd-reschedule-card {
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:11px;
  padding:18px;
  min-width:0;
  text-align:left;
  cursor:pointer;
  border:1px solid #3f382d;
  border-radius:12px;
  background:linear-gradient(145deg,#222124,#141517);
  color:#fff;
  transition:border-color .2s,transform .2s;
}
.kd-reschedule-card:hover {
  border-color:#f59e0b;
  transform:translateY(-2px);
}
.kd-reschedule-icon {
  display:grid;
  place-items:center;
  width:42px;
  height:42px;
  border-radius:10px;
  background:#392913;
  color:#f59e0b;
}
.kd-reschedule-count {
  color:#f5af37;
  font-size:29px;
  font-weight:800;
}
.kd-reschedule-card strong {
  color:#f4f4f5;
  font-size:13px;
}
.kd-reschedule-card small {
  color:#a7a7af;
  font-size:11px;
  line-height:1.5;
}
.kd-reschedule-footer {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-top:18px;
}
.kd-reschedule-footer span {
  font-size:11px;
  color:#a6a1a0;
}
.kd-reschedule-open {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  padding:11px 14px;
  border:1px solid #f59e0b;
  border-radius:9px;
  background:#f59e0b;
  color:#181008;
  font-size:12px;
  font-weight:800;
  cursor:pointer;
}
.kd-reschedule-open:hover {background:#ffb52d;}
.kd-notification-button {
  position:relative;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:40px;
  height:40px;
  border:1px solid #40392c;
  border-radius:10px;
  background:#1c1d20;
  color:#f6b346;
  cursor:pointer;
}
.kd-notification-button:hover {
  background:#292114;
  border-color:#f59e0b;
}
.kd-notification-badge {
  position:absolute;
  top:-7px;
  right:-7px;
  min-width:19px;
  height:19px;
  padding:0 4px;
  border-radius:20px;
  border:2px solid #0d0e10;
  display:flex;
  align-items:center;
  justify-content:center;
  background:#f59e0b;
  color:#161009;
  font-size:10px;
  font-weight:900;
}
.kd-sidebar-notification-count {
  margin-left:auto;
  min-width:22px;
  height:21px;
  border-radius:20px;
  padding:0 5px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  background:#f59e0b;
  color:#1c1205;
  font-size:10px;
  font-weight:800;
}
.kd-notification-note {
  display:flex;
  align-items:center;
  gap:8px;
  color:#b9b0a1;
  font-size:12px;
  margin-bottom:18px;
}
.kd-notification-note strong {color:#f59e0b;}
.kp-appointment-panel .kp-heading-icon {
  display:flex;
  align-items:flex-start;
  gap:12px;
}
.kp-appointment-panel .kp-heading-icon > svg {
  flex-shrink:0;
  width:20px;
  height:20px;
  margin-top:0;
  color:#f59e0b;
}
.kp-appointment-panel .kp-heading-icon > div {
  display:flex;
  flex-direction:column;
  gap:5px;
}
.kp-appointment-panel .kp-heading-icon h3 {
  margin:0;
  line-height:20px;
}
.kp-appointment-panel .kp-heading-icon p {
  margin:0;
  line-height:1.5;
}
@media(max-width:1100px) {
  .kd-booking-summary,
  .kd-reschedule-cards {
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
}
@media(max-width:520px) {
  .kd-booking-summary,.kd-reschedule-cards {gap:8px;}
  .kd-booking-mini,.kd-reschedule-card {padding:12px;}
  .kd-booking-mini strong,.kd-reschedule-count {font-size:23px;}
  .kd-booking-chart {gap:6px;padding:12px 8px;}
  .kd-schedule-row {gap:8px;padding:10px;}
  .kd-schedule-price {font-size:11px;}
  .kd-reschedule-section {padding:14px;}
  .kd-reschedule-heading,
  .kd-reschedule-footer {
    align-items:flex-start;
    flex-direction:column;
  }
}
`;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

function localDate(offset = 0): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return value;
  }
  return `${String(hour % 12 || 12).padStart(2, "0")}:${String(
    minute
  ).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function formatMoney(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function chartStart(period: ChartPeriod, now: Date): Date {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  if (period === "7d") {
    start.setDate(start.getDate() - 6);
  } else {
    const months = Number(period[0]);
    start.setMonth(start.getMonth() - months);
    start.setDate(start.getDate() + 1);
  }
  return start;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [greeting, setGreeting] = useState(getGreeting);
  const [chartPeriod, setChartPeriod] =
    useState<ChartPeriod>("7d");

  const username =
    sessionStorage.getItem("kshurak_barber_username") ||
    sessionStorage.getItem("barber_username") ||
    "Barber";
  const barberId =
    sessionStorage.getItem("kshurak_barber_id") ||
    sessionStorage.getItem("barber_id") ||
    "";
  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token") ||
    "";

  const cacheEntry = useMemo(
    () => getDashboardCache(barberId, token),
    [barberId, token]
  );

  const {
    bookings,
    totalBookings,
    bookingLoading,
    bookingError,
    bookingLoaded,
    lastUpdated,
    reschedules,
    rescheduleLoading,
    rescheduleError,
    rescheduleLoaded,
    unreadCount,
    notificationError,
    notificationLoading,
    notificationLoaded,
    reviewStats,
    reviewsLoading,
    reviewsError,
    reviewsLoaded,
  } = useSyncExternalStore(
    cacheEntry.subscribe,
    cacheEntry.getSnapshot,
    cacheEntry.getSnapshot
  );

  const today = localDate();
  const loadBookings = useCallback(
    () => loadDashboardSection(cacheEntry, "bookings"),
    [cacheEntry]
  );
  const loadReschedules = useCallback(
    () => loadDashboardSection(cacheEntry, "reschedules"),
    [cacheEntry]
  );
  const loadNotifications = useCallback(
    () => loadDashboardSection(cacheEntry, "notifications"),
    [cacheEntry]
  );
  const loadReviews = useCallback(
    () => loadDashboardSection(cacheEntry, "reviews"),
    [cacheEntry]
  );

  const ratingValue =
    reviewsLoading && !reviewsLoaded
      ? "..."
      : reviewsError && !reviewsLoaded
        ? "—"
        : reviewStats?.average_rating == null
          ? "—"
          : `${reviewStats.average_rating.toFixed(1)}/5`;

  const openReviews = () => {
    setSidebarOpen(false);
    navigate("/reviews");
  };

  const refreshDashboard = async () => {
    if (!token || !barberId) return;
    if (
      cacheEntry.jobs.bookings ||
      cacheEntry.jobs.reschedules ||
      cacheEntry.jobs.notifications ||
      cacheEntry.jobs.reviews
    ) {
      return;
    }
    await Promise.all([
      loadBookings(),
      loadReschedules(),
      loadNotifications(),
      loadReviews(),
    ]);
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      setGreeting(getGreeting());
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!token || !barberId || cacheEntry.initialized) return;
    cacheEntry.initialized = true;
    void Promise.all([
      loadBookings(),
      loadReschedules(),
      loadNotifications(),
      loadReviews(),
    ]);
  }, [
    token,
    barberId,
    cacheEntry,
    loadBookings,
    loadReschedules,
    loadNotifications,
    loadReviews,
  ]);

  const todayBookings = useMemo(
    () =>
      bookings.filter(
        (booking) => booking.booking_date === today
      ),
    [bookings, today]
  );

  const bookingCounts = useMemo(
    () => ({
      pending: bookings.filter(
        (booking) => booking.status === "pending"
      ).length,
      confirmed: bookings.filter(
        (booking) => booking.status === "confirmed"
      ).length,
      completed: bookings.filter(
        (booking) => booking.status === "completed"
      ).length,
      cancelled: bookings.filter(
        (booking) =>
          booking.status === "cancelled" ||
          booking.status === "rejected"
      ).length,
    }),
    [bookings]
  );

  const rescheduleCounts = useMemo(
    () => ({
      customerRequests: reschedules.filter(
        (request) =>
          request.status === "pending" &&
          request.requested_by === "customer"
      ).length,
      awaitingCustomer: reschedules.filter(
        (request) =>
          request.status === "pending" &&
          request.requested_by === "barber"
      ).length,
      approved: reschedules.filter(
        (request) => request.status === "approved"
      ).length,
      declined: reschedules.filter(
        (request) =>
          request.status === "declined" ||
          request.status === "cancelled"
      ).length,
    }),
    [reschedules]
  );

  const todayRevenue = useMemo(
    () =>
      todayBookings
        .filter((booking) => booking.status === "completed")
        .reduce(
          (sum, booking) =>
            sum + (Number(booking.service_price) || 0),
          0
        ),
    [todayBookings]
  );

  const observedCustomerCount = useMemo(() => {
    const identifiers = new Set<string>();
    for (const booking of bookings) {
      identifiers.add(
        booking.customer_id ||
          booking.customer_phone ||
          booking.id
      );
    }
    return identifiers.size;
  }, [bookings]);

  const todaySchedule = useMemo(
    () =>
      todayBookings
        .filter((booking) => booking.status === "confirmed")
        .sort((a, b) =>
          a.start_time.localeCompare(b.start_time)
        ),
    [todayBookings]
  );

  const chartData = useMemo(() => {
    const now = new Date();
    const start = chartStart(chartPeriod, now);
    const grouped = new Map<
      string,
      { date: string; day: string; count: number }
    >();

    const bucketFor = (date: Date) => {
      if (chartPeriod === "7d") {
        return {
          key: dateKey(date),
          label: date.toLocaleDateString("en-IN", {
            weekday: "short",
          }),
        };
      }
      if (chartPeriod === "6m") {
        return {
          key: `${date.getFullYear()}-${String(
            date.getMonth() + 1
          ).padStart(2, "0")}`,
          label: date.toLocaleDateString("en-IN", {
            month: "short",
            year: "2-digit",
          }),
        };
      }
      const days = Math.floor(
        (Date.UTC(
          date.getFullYear(),
          date.getMonth(),
          date.getDate()
        ) -
          Date.UTC(
            start.getFullYear(),
            start.getMonth(),
            start.getDate()
          )) /
          86400000
      );
      const week = Math.floor(days / 7) + 1;
      return {
        key: String(week).padStart(2, "0"),
        label: `W${week}`,
      };
    };

    for (
      const cursor = new Date(start);
      cursor <= now;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const bucket = bucketFor(cursor);
      if (!grouped.has(bucket.key)) {
        grouped.set(bucket.key, {
          date: bucket.key,
          day: bucket.label,
          count: 0,
        });
      }
    }

    for (const booking of bookings) {
      const value = booking.booking_date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day ||
        date < start ||
        date > now
      ) {
        continue;
      }
      const item = grouped.get(bucketFor(date).key);
      if (item) item.count += 1;
    }
    return Array.from(grouped.values());
  }, [bookings, chartPeriod]);

  const bookingValue = (count: number): string => {
    if (bookingLoading && !bookingLoaded) return "...";
    if (bookingError && !bookingLoaded) return "—";
    return String(count);
  };

  const rescheduleValue = (count: number): string => {
    if (rescheduleLoading && !rescheduleLoaded) return "...";
    if (rescheduleError && !rescheduleLoaded) return "—";
    return String(count);
  };

  const notificationLabel =
    notificationError && !notificationLoaded
      ? "Notifications unavailable"
      : notificationLoading && !notificationLoaded
        ? "Loading notifications"
        : unreadCount > 0
          ? `${unreadCount} unread notifications`
          : "View shop notifications";

  const openShopSetup = (
    step?:
      | "profile"
      | "shop"
      | "workers"
      | "documents"
      | "capacity"
      | "review"
  ) => {
    setSidebarOpen(false);
    navigate(
      step ? `/shop-setup?step=${step}` : "/shop-setup"
    );
  };
  const openWorkersModule = () => {
    setSidebarOpen(false);
    navigate("/workers");
  };
  const openBookings = () => {
    setSidebarOpen(false);
    navigate("/bookings");
  };
  const openRescheduling = () => {
    setSidebarOpen(false);
    navigate("/rescheduling");
  };
  const openNotifications = () => {
    setSidebarOpen(false);
    navigate("/notifications");
  };
  const openCustomers = () => {
    setSidebarOpen(false);
    navigate("/customers");
  };

  const handleLogout = () => {
    dashboardCaches.clear();
    [
      "kshurak_barber_token",
      "kshurak_barber_id",
      "kshurak_barber_username",
      "barber_access_token",
      "barber_id",
      "barber_username",
    ].forEach((key) => sessionStorage.removeItem(key));
    navigate("/login", { replace: true });
  };

  const handleNavigation = (label: string) => {
    setSidebarOpen(false);
    if (label === "Dashboard") {
      navigate("/dashboard");
    } else if (label === "Shop Setup") {
      openShopSetup();
    } else if (label === "Workers") {
      openWorkersModule();
    } else if (label === "Bookings") {
      openBookings();
    } else if (label === "Rescheduling") {
      openRescheduling();
    } else if (label === "Customers") {
      openCustomers();
    } else if (label === "Notifications") {
      openNotifications();
    } else if (label === "Services") {
      navigate("/services");
    } else if (label === "Reviews") {
      openReviews();
    }
  };

  return (
    <div className="kd-layout">
      <style>{dashboardStyles}</style>
      {sidebarOpen && (
        <div
          className="kd-mobile-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`kd-sidebar ${
          sidebarOpen ? "kd-sidebar-open" : ""
        }`}
      >
        <div className="kd-brand">
          <img
            src="/assets/logo.png"
            alt="KSHURAK"
            className="kd-logo"
          />
          <button
            type="button"
            className="kd-close-sidebar"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={22} />
          </button>
        </div>
        <div className="kd-sidebar-label">MAIN MENU</div>
        <nav className="kd-navigation">
          {navigationItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className={`kd-nav-item ${
                label === "Dashboard" ? "kd-nav-active" : ""
              }`}
              onClick={() => handleNavigation(label)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "Notifications" && unreadCount > 0 && (
                <span className="kd-sidebar-notification-count">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
              {label === "Dashboard" && (
                <ChevronRight size={16} />
              )}
            </button>
          ))}
        </nav>
        <div className="kd-sidebar-bottom">
          <button
            type="button"
            className="kd-nav-item kd-logout"
            onClick={handleLogout}
          >
            <LogOut size={19} />
            <span>Logout</span>
          </button>
          <div className="kd-sidebar-footer">
            © 2026 KSHURAK
          </div>
        </div>
      </aside>

      <div className="kd-main">
        <header className="kd-topbar">
          <div className="kd-topbar-left">
            <button
              type="button"
              className="kd-mobile-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <Menu size={24} />
            </button>
            <form
              className="kp-top-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                const query = searchTerm.trim().toLowerCase();
                const match = navigationItems.find((item) =>
                  item.label.toLowerCase().includes(query)
                );
                if (query && match) {
                  handleNavigation(match.label);
                } else if (query) {
                  setSearchTerm("");
                }
              }}
            >
              <Search size={18} />
              <input
                aria-label="Search dashboard sections"
                value={searchTerm}
                onChange={(event) =>
                  setSearchTerm(event.target.value)
                }
                placeholder="Search dashboard sections..."
                list="kp-search-options"
              />
              <datalist id="kp-search-options">
                {navigationItems.map((item) => (
                  <option
                    key={item.label}
                    value={item.label}
                  />
                ))}
              </datalist>
              <span className="kp-search-hint">Enter ↵</span>
            </form>
          </div>
          <div className="kd-topbar-right">
            <span className="kd-date">
              {new Date().toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <button
              type="button"
              className="kp-topbar-refresh"
              onClick={() => void refreshDashboard()}
              disabled={
                bookingLoading ||
                rescheduleLoading ||
                notificationLoading ||
                reviewsLoading
              }
              title="Refresh Dashboard"
              aria-label="Refresh Dashboard"
            >
              <RefreshCw
                size={19}
                className={
                  bookingLoading ||
                  rescheduleLoading ||
                  notificationLoading ||
                  reviewsLoading
                    ? "kp-refresh-spinning"
                    : ""
                }
              />
            </button>
            <button
              type="button"
              className="kd-notification-button"
              onClick={openNotifications}
              aria-label={
                unreadCount > 0
                  ? `Notifications, ${unreadCount} unread`
                  : "Notifications"
              }
              title={notificationLabel}
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="kd-notification-badge">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
            <div className="kd-avatar">
              {username.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        <main className="kd-content kd-premium-content">
          <section
            className="kp-hero"
            aria-label="Dashboard welcome"
          >
            <div className="kp-hero-greeting">
              <span className="kp-hero-accent" />
              <div>
                <h1>
                  {greeting},
                  <br />
                  <span>{username}!</span>
                </h1>
                <p>
                  Here's what's happening at your shop today.
                </p>
              </div>
            </div>
            <div
              className="kp-hero-brand"
              aria-hidden="true"
            />
            <button
              type="button"
              className="kp-manage"
              onClick={() => openShopSetup()}
            >
              <Store size={15} />
              Manage Shop
              <ChevronRight size={15} />
            </button>
          </section>

          {bookingError && (
            <div className="kd-booking-alert" role="alert">
              <AlertCircle size={18} />
              <span>
                Booking information could not be refreshed:{" "}
                {bookingError}
              </span>
              <button
                type="button"
                className="kd-booking-refresh"
                disabled={bookingLoading}
                onClick={() => void loadBookings()}
              >
                Retry
              </button>
            </div>
          )}
          {rescheduleError && (
            <div className="kd-booking-alert" role="alert">
              <AlertCircle size={18} />
              <span>
                Rescheduling information could not be refreshed:{" "}
                {rescheduleError}
              </span>
              <button
                type="button"
                className="kd-booking-refresh"
                disabled={rescheduleLoading}
                onClick={() => void loadReschedules()}
              >
                Retry
              </button>
            </div>
          )}
          {reviewsError && (
            <div className="kd-booking-alert" role="alert">
              <AlertCircle size={18} />
              <span>
                Rating information could not be refreshed:{" "}
                {reviewsError}
              </span>
              <button
                type="button"
                className="kd-booking-refresh"
                disabled={reviewsLoading}
                onClick={() => void loadReviews()}
              >
                Retry
              </button>
            </div>
          )}
          {notificationError && (
            <div className="kd-booking-alert" role="alert">
              <AlertCircle size={18} />
              <span>
                Notifications could not be refreshed:{" "}
                {notificationError}
              </span>
              <button
                type="button"
                className="kd-booking-refresh"
                disabled={notificationLoading}
                onClick={() => void loadNotifications()}
              >
                Retry
              </button>
            </div>
          )}

          <section
            className="kp-primary-stats"
            aria-label="Shop performance"
          >
            <PremiumStat
              title="Total Bookings"
              value={bookingValue(totalBookings)}
              description="All booking statuses"
              icon={<CalendarDays size={25} />}
              tone="gold"
              onClick={openBookings}
            />
            <PremiumStat
              title="Today's Revenue"
              value={
                bookingLoading && !bookingLoaded
                  ? "..."
                  : bookingError && !bookingLoaded
                    ? "—"
                    : formatMoney(todayRevenue)
              }
              description="Completed booking value"
              icon={<Wallet size={25} />}
              tone="gold"
            />
            <PremiumStat
              title="Booking Customers"
              value={bookingValue(observedCustomerCount)}
              description="Customers in loaded bookings"
              icon={<Users size={25} />}
              tone="gold"
              onClick={openCustomers}
            />
            <PremiumStat
              title="Average Rating"
              value={ratingValue}
              description={
                reviewsError && !reviewsLoaded
                  ? "Rating information unavailable"
                  : `${reviewStats?.total_reviews ?? 0} customer reviews`
              }
              icon={<Star size={25} />}
              tone="gold"
              onClick={openReviews}
            />
          </section>

          <section
            className="kp-status-stats"
            aria-label="Booking status overview"
          >
            <PremiumStat
              title="New Bookings"
              value={bookingValue(bookingCounts.pending)}
              description="Awaiting confirmation"
              icon={<CalendarDays size={22} />}
              tone="blue"
              onClick={openBookings}
            />
            <PremiumStat
              title="Upcoming"
              value={bookingValue(bookingCounts.confirmed)}
              description="Confirmed appointments"
              icon={<Clock3 size={22} />}
              tone="amber"
              onClick={openBookings}
            />
            <PremiumStat
              title="Completed"
              value={bookingValue(bookingCounts.completed)}
              description="Finished appointments"
              icon={<CheckCircle2 size={22} />}
              tone="green"
              onClick={openBookings}
            />
            <PremiumStat
              title="Cancelled / Rejected"
              value={bookingValue(bookingCounts.cancelled)}
              description="Closed without service"
              icon={<XCircle size={22} />}
              tone="red"
              onClick={openBookings}
            />
          </section>

          <div className="kp-section-grid">
            <section className="kp-panel kp-booking-panel">
              <div className="kp-panel-heading">
                <div>
                  <h2>Booking Overview</h2>
                  <p>
                    Track daily appointments and customer activity
                  </p>
                </div>
                <label className="kp-range kp-period-selector">
                  <CalendarDays size={15} />
                  <select
                    aria-label="Booking chart date range"
                    value={chartPeriod}
                    onChange={(event) =>
                      setChartPeriod(
                        event.target.value as ChartPeriod
                      )
                    }
                  >
                    <option value="7d">Last 7 days</option>
                    <option value="1m">Last month</option>
                    <option value="2m">Last 2 months</option>
                    <option value="3m">Last 3 months</option>
                    <option value="6m">Last 6 months</option>
                  </select>
                </label>
              </div>
              <div className="kp-chart-grid">
                <div className="kp-chart-area">
                  {bookingLoading && !bookingLoaded ? (
                    <div className="kp-chart-message">
                      Loading booking activity...
                    </div>
                  ) : bookingError && !bookingLoaded ? (
                    <div className="kp-chart-message">
                      Booking activity unavailable.
                    </div>
                  ) : (
                    <BookingLineChart items={chartData} />
                  )}
                </div>
                <div className="kp-chart-summary">
                  <div>
                    <span className="kp-summary-icon">
                      <CalendarDays size={19} />
                    </span>
                    <p>
                      Total Bookings
                      <strong>
                        {bookingValue(totalBookings)}
                      </strong>
                    </p>
                  </div>
                  <div>
                    <span className="kp-summary-icon">
                      <Wallet size={19} />
                    </span>
                    <p>
                      Today's Revenue
                      <strong>
                        {bookingLoading && !bookingLoaded
                          ? "..."
                          : formatMoney(todayRevenue)}
                      </strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    className="kp-rating-shortcut"
                    onClick={openReviews}
                    aria-label="Open Reviews and Ratings"
                  >
                    <span className="kp-summary-icon">
                      <Star size={19} />
                    </span>
                    <p>
                      Avg. Rating
                      <strong>{ratingValue}</strong>
                    </p>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <p className="kp-data-note"></p>
            </section>

            <section className="kp-panel kp-action-panel">
              <div className="kp-panel-heading">
                <div>
                  <h2>Quick Actions</h2>
                  <p>Manage your shop with ease</p>
                </div>
              </div>
              <div className="kp-action-grid">
                <PremiumAction
                  icon={<CalendarDays size={20} />}
                  title="Manage Bookings"
                  onClick={openBookings}
                />
                <PremiumAction
                  icon={<Clock3 size={20} />}
                  title="Manage Rescheduling"
                  onClick={openRescheduling}
                />
                <PremiumAction
                  icon={<Bell size={20} />}
                  title="Notifications"
                  onClick={openNotifications}
                />
                <PremiumAction
                  icon={<Users size={20} />}
                  title="Add Worker"
                  onClick={() => openShopSetup("workers")}
                />
                <PremiumAction
                  icon={<Store size={20} />}
                  title="Shop Setup"
                  onClick={() => openShopSetup()}
                />
                <PremiumAction
                  icon={<Star size={20} />}
                  title="View Reviews"
                  onClick={openReviews}
                />
              </div>
            </section>
          </div>

          <div className="kp-section-grid kp-bottom-grid">
            <section className="kp-panel kp-reschedule-panel">
              <div className="kp-panel-heading">
                <div className="kp-heading-icon">
                  <RefreshCw size={22} />
                  <div>
                    <h2>Rescheduling Overview</h2>
                    <p>
                      Monitor customer requests and appointment changes
                    </p>
                  </div>
                </div>
                <button
                  className="kp-view-link"
                  type="button"
                  onClick={openRescheduling}
                >
                  View All
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="kp-reschedule-grid">
                <PremiumReschedule
                  icon={<CalendarClock size={20} />}
                  title="Customer Requests"
                  value={rescheduleValue(
                    rescheduleCounts.customerRequests
                  )}
                  description="Waiting for barber approval"
                  tone="blue"
                  onClick={openRescheduling}
                />
                <PremiumReschedule
                  icon={<Clock3 size={20} />}
                  title="Awaiting Customer"
                  value={rescheduleValue(
                    rescheduleCounts.awaitingCustomer
                  )}
                  description="Proposals pending approval"
                  tone="amber"
                  onClick={openRescheduling}
                />
                <PremiumReschedule
                  icon={<CalendarCheck size={20} />}
                  title="Rescheduled"
                  value={rescheduleValue(
                    rescheduleCounts.approved
                  )}
                  description="Approved appointment changes"
                  tone="green"
                  onClick={openRescheduling}
                />
                <PremiumReschedule
                  icon={<XCircle size={20} />}
                  title="Declined / Withdrawn"
                  value={rescheduleValue(
                    rescheduleCounts.declined
                  )}
                  description="Declined and withdrawn"
                  tone="red"
                  onClick={openRescheduling}
                />
              </div>
            </section>

            <section className="kp-panel kp-appointment-panel">
              <div className="kp-panel-heading">
                <div className="kp-heading-icon">
                  <CalendarDays size={20} />
                  <div>
                    <h3>Today's Appointments</h3>
                    <p>Confirmed bookings for today</p>
                  </div>
                </div>
                <button
                  className="kp-view-link"
                  type="button"
                  onClick={openBookings}
                >
                  View All
                  <ChevronRight size={16} />
                </button>
              </div>
              {bookingLoading && !bookingLoaded ? (
                <div className="kp-empty-appointments">
                  Loading today's appointments...
                </div>
              ) : bookingError && !bookingLoaded ? (
                <div className="kp-empty-appointments">
                  Schedule unavailable.
                </div>
              ) : todaySchedule.length === 0 ? (
                <div className="kp-empty-appointments">
                  <CalendarDays size={37} />
                  <strong>No appointments scheduled</strong>
                  <span>
                    Today's confirmed bookings will appear here.
                  </span>
                </div>
              ) : (
                <div className="kp-schedule-list">
                  {todaySchedule.slice(0, 5).map((booking) => (
                    <div
                      className="kp-schedule-item"
                      key={booking.id}
                    >
                      <time>{formatTime(booking.start_time)}</time>
                      <div>
                        <strong>{booking.customer_name}</strong>
                        <span>
                          {booking.service_name} ·{" "}
                          {booking.service_duration_minutes} min
                        </span>
                      </div>
                      <b>
                        {formatMoney(
                          Number(booking.service_price) || 0
                        )}
                      </b>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <div className="kp-dashboard-footer">
            <span>
              {lastUpdated
                ? `Bookings refreshed at ${lastUpdated}`
                : "Live dashboard data"}
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}

type PremiumTone = "gold" | "blue" | "amber" | "green" | "red";

function PremiumStat({
  title,
  value,
  description,
  icon,
  tone,
  onClick,
}: {
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
  tone: PremiumTone;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="kp-stat-top">
        <span className="kp-stat-icon">{icon}</span>
        <span className="kp-stat-heading">{title}</span>
        {onClick && (
          <ChevronRight
            size={17}
            className="kp-stat-arrow"
          />
        )}
      </div>
      <strong className="kp-stat-value">{value}</strong>
      <span className="kp-stat-description">{description}</span>
      <span
        className="kp-stat-flourish"
        aria-hidden="true"
      />
    </>
  );

  return onClick ? (
    <button
      type="button"
      className={`kp-stat kp-${tone}`}
      onClick={onClick}
    >
      {inner}
    </button>
  ) : (
    <div className={`kp-stat kp-${tone}`}>{inner}</div>
  );
}

function PremiumAction({
  icon,
  title,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="kp-action"
      onClick={onClick}
    >
      <span className="kp-action-icon">{icon}</span>
      <strong>{title}</strong>
      <ChevronRight size={16} />
    </button>
  );
}

function PremiumReschedule({
  icon,
  title,
  value,
  description,
  tone,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  description: string;
  tone: PremiumTone;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`kp-reschedule kp-${tone}`}
      onClick={onClick}
    >
      <span className="kp-reschedule-icon">{icon}</span>
      <strong className="kp-reschedule-value">{value}</strong>
      <span className="kp-reschedule-title">{title}</span>
      <small>{description}</small>
    </button>
  );
}

function BookingLineChart({
  items,
}: {
  items: {
    date: string;
    day: string;
    count: number;
  }[];
}) {
  if (
    items.length === 0 ||
    items.every((item) => item.count === 0)
  ) {
    return (
      <div className="kp-chart-empty">
        <ChartNoAxesCombined size={33} />
        <strong>No booking activity yet</strong>
        <span>
          Booking trends will appear when appointments are recorded.
        </span>
        <div
          className="kp-zero-line"
          aria-hidden="true"
        />
      </div>
    );
  }

  const width = 680;
  const height = 240;
  const left = 40;
  const right = 15;
  const top = 24;
  const bottom = 40;
  const max = Math.max(
    1,
    ...items.map((item) => item.count)
  );
  const ceiling = Math.max(4, Math.ceil(max / 4) * 4);
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const xy = items.map((item, index) => ({
    x:
      left +
      (index * chartWidth) /
        Math.max(1, items.length - 1),
    y: top + (1 - item.count / ceiling) * chartHeight,
    ...item,
  }));

  const path = xy
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(
          2
        )},${point.y.toFixed(2)}`
    )
    .join(" ");

  const firstPoint = xy[0];
  const lastPoint = xy[xy.length - 1];
  const area = `${path} L${lastPoint.x},${
    top + chartHeight
  } L${firstPoint.x},${top + chartHeight} Z`;

  return (
    <svg
      className="kp-line-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Booking activity: ${items
        .map((item) => `${item.day}: ${item.count}`)
        .join(", ")}`}
    >
      <defs>
        <linearGradient
          id="kp-chart-gradient"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0%"
            stopColor="#f59e0b"
            stopOpacity="0.23"
          />
          <stop
            offset="100%"
            stopColor="#f59e0b"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      {Array.from({ length: 5 }, (_, index) => {
        const value = ceiling - (index * ceiling) / 4;
        const y = top + (index * chartHeight) / 4;
        return (
          <g key={index}>
            <line
              x1={left}
              y1={y}
              x2={width - right}
              y2={y}
              stroke="#34343a"
              strokeDasharray="4 5"
            />
            <text
              x={left - 14}
              y={y + 4}
              textAnchor="end"
              fill="#a2a2ab"
              fontSize="12"
            >
              {Number.isInteger(value)
                ? value
                : value.toFixed(1)}
            </text>
          </g>
        );
      })}
      <path
        d={area}
        fill="url(#kp-chart-gradient)"
      />
      <path
        d={path}
        fill="none"
        stroke="#ffb11b"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {xy.map((point) => (
        <g key={point.date}>
          <circle
            cx={point.x}
            cy={point.y}
            r="4"
            fill="#f59e0b"
            stroke="#191715"
            strokeWidth="2"
          />
          <text
            x={point.x}
            y={height - 11}
            textAnchor="middle"
            fill="#b9b8c0"
            fontSize="12"
          >
            {point.day}
          </text>
          <title>
            {point.date}: {point.count} bookings
          </title>
        </g>
      ))}
    </svg>
  );
}
