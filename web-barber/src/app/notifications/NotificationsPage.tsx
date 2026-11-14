import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useNavigate } from "react-router-dom";

import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BellRing,
  CalendarClock,
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Inbox,
  Loader2,
  MailOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  X,
} from "lucide-react";

import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type BarberNotification,
  type NotificationCategory,
  type NotificationCounts,
} from "../../services/notificationsApi";

type ActiveCard = "all" | "unread" | "booking" | "rescheduling";

const PAGE_SIZE = 15;

const EMPTY_COUNTS: NotificationCounts = {
  total: 0,
  unread: 0,
  booking: 0,
  rescheduling: 0,
  other: 0,
};

const CARDS = [
  {
    id: "all" as ActiveCard,
    title: "All Notifications",
    subtitle: "All shop activity alerts",
    icon: Bell,
  },
  {
    id: "unread" as ActiveCard,
    title: "Unread",
    subtitle: "Notifications needing attention",
    icon: BellRing,
  },
  {
    id: "booking" as ActiveCard,
    title: "Booking Alerts",
    subtitle: "Appointment updates",
    icon: CalendarDays,
  },
  {
    id: "rescheduling" as ActiveCard,
    title: "Rescheduling Alerts",
    subtitle: "Appointment change requests",
    icon: CalendarClock,
  },
];

const CSS = `
.kn-page {
  --gold:#F59E0B;
  --bg:#070708;
  --surface:#17181A;
  --dark:#0D0D0E;
  --light:#202124;
  --border:#27282C;
  --border-light:#3E3F45;
  --secondary:#9E9EA7;
  --muted:#71717A;
  --green:#22C55E;
  --red:#EF4444;
  min-height:100%;
  min-width:0;
  background:var(--bg);
  color:#FFF;
  font-family:Inter,"Segoe UI",Arial,sans-serif;
  font-size:13px;
  color-scheme:dark;
}
.kn-page *,
.kn-page *::before,
.kn-page *::after {
  box-sizing:border-box;
}
.kn-page button,
.kn-page input {
  font:inherit;
}
.kn-page button {
  cursor:pointer;
}
.kn-page button:disabled {
  opacity:.45;
  cursor:not-allowed;
}
.kn-page :is(button,input):focus-visible {
  outline:2px solid var(--gold);
  outline-offset:3px;
}
.kn-main {
  width:100%;
  max-width:1550px;
  min-width:0;
  margin:auto;
  padding:28px clamp(16px,2.5vw,34px) 50px;
}
.kn-eyebrow {
  display:block;
  margin-bottom:9px;
  color:var(--gold);
  font-size:10px;
  font-weight:800;
  letter-spacing:1.5px;
}
.kn-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;
  margin-bottom:23px;
}
.kn-heading h1 {
  margin:0 0 8px;
  font-size:30px;
  font-weight:800;
  letter-spacing:-.6px;
  color:#FFF;
}
.kn-heading p {
  margin:0;
  color:var(--secondary);
  font-size:12px;
  line-height:1.65;
}
.kn-actions {
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:10px;
}
.kn-btn {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  min-height:39px;
  padding:9px 13px;
  border:1px solid var(--border-light);
  border-radius:9px;
  background:var(--light);
  color:#FFF;
  font-size:11px;
  font-weight:700;
  white-space:nowrap;
  transition:background .2s,border-color .2s,color .2s;
}
.kn-btn:hover:not(:disabled) {
  border-color:var(--gold);
  background:#292723;
}
.kn-btn.gold {
  border-color:var(--gold);
  background:var(--gold);
  color:#000;
  font-weight:800;
}
.kn-btn.gold:hover:not(:disabled) {
  background:#FBBF24;
}
.kn-btn svg {
  flex-shrink:0;
}
.kn-alert,
.kn-success {
  display:flex;
  align-items:center;
  gap:10px;
  margin:0 0 17px;
  padding:12px 14px;
  border-radius:10px;
  font-size:11px;
  line-height:1.7;
}
.kn-alert {
  background:rgba(239,68,68,.08);
  border:1px solid rgba(239,68,68,.3);
  color:#FCA5A5;
}
.kn-alert > span {
  flex:1;
}
.kn-success {
  background:rgba(34,197,94,.08);
  border:1px solid rgba(34,197,94,.3);
  color:#86EFAC;
}
.kn-alert > svg,
.kn-success > svg {
  flex-shrink:0;
}
.kn-stats {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:13px;
  margin-bottom:23px;
}
.kn-stat {
  position:relative;
  display:flex;
  flex-direction:column;
  align-items:stretch;
  min-width:0;
  min-height:151px;
  padding:18px;
  text-align:left;
  border:1px solid var(--border);
  border-radius:13px;
  background:linear-gradient(145deg,#202124,#17181A 58%,#0D0D0E);
  color:#FFF;
  transition:border-color .2s,transform .2s;
}
.kn-stat:hover:not(:disabled) {
  transform:translateY(-2px);
  border-color:rgba(245,158,11,.5);
}
.kn-stat.active {
  border-color:var(--gold);
  background:linear-gradient(135deg,rgba(245,158,11,.13),#17181A 60%);
  box-shadow:inset 0 0 0 1px rgba(245,158,11,.1);
}
.kn-stat.active::before {
  content:"";
  position:absolute;
  left:18px;
  right:18px;
  top:0;
  height:2px;
  border-radius:0 0 4px 4px;
  background:var(--gold);
}
.kn-stat-top {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-bottom:17px;
}
.kn-stat-icon {
  display:grid;
  place-items:center;
  flex-shrink:0;
  width:41px;
  height:41px;
  border-radius:10px;
  border:1px solid rgba(245,158,11,.22);
  background:rgba(245,158,11,.1);
  color:var(--gold);
}
.kn-stat-number {
  font-size:29px;
  font-weight:800;
  letter-spacing:-1px;
  font-variant-numeric:tabular-nums;
}
.kn-stat.active .kn-stat-number {
  color:var(--gold);
}
.kn-stat-title {
  margin-bottom:7px;
  font-size:12px;
  font-weight:800;
}
.kn-stat-subtitle {
  font-size:10px;
  line-height:1.55;
  color:var(--secondary);
}
.kn-panel {
  min-width:0;
  overflow:hidden;
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:14px;
}
.kn-panel-header {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  flex-wrap:wrap;
  padding:18px 20px;
  border-bottom:1px solid var(--border);
}
.kn-panel-header h2 {
  margin:0 0 5px;
  font-size:17px;
  font-weight:800;
}
.kn-panel-header p {
  margin:0;
  color:var(--secondary);
  font-size:11px;
  line-height:1.6;
}
.kn-search {
  display:flex;
  align-items:center;
  gap:9px;
  width:260px;
  min-height:38px;
  padding:0 11px;
  border:1px solid var(--border-light);
  border-radius:9px;
  background:var(--dark);
  color:var(--secondary);
}
.kn-search:focus-within {
  border-color:var(--gold);
}
.kn-search input {
  width:100%;
  min-width:0;
  flex:1;
  border:0;
  outline:0;
  background:transparent;
  color:#FFF;
  font-size:11px;
}
.kn-search input::placeholder {
  color:var(--muted);
}
.kn-search button {
  display:grid;
  place-items:center;
  padding:4px;
  border:0;
  background:transparent;
  color:var(--secondary);
}

/* COMPACT SINGLE-ROW NOTIFICATION CARDS */

.kn-list {
  display:grid;
  grid-template-columns:minmax(0,1fr);
  gap:8px;
  padding:12px;
}
.kn-item {
  position:relative;
  display:grid;
  grid-template-columns:36px minmax(0,1fr) 94px 138px 170px;
  align-items:center;
  gap:13px;
  min-width:0;
  min-height:76px;
  padding:12px 14px;
  border:1px solid #28292D;
  border-radius:11px;
  background:linear-gradient(110deg,#111214,#0D0E10);
  box-shadow:0 3px 12px rgba(0,0,0,.09);
  transition:border-color .2s,background .2s,box-shadow .2s;
}
.kn-item.unread {
  border-color:rgba(245,158,11,.25);
  background:linear-gradient(100deg,rgba(245,158,11,.065),#111214 40%,#0D0E10);
}
.kn-item.unread::before {
  content:"";
  position:absolute;
  left:-1px;
  top:15px;
  bottom:15px;
  width:3px;
  border-radius:0 3px 3px 0;
  background:var(--gold);
}
.kn-item:hover {
  border-color:rgba(245,158,11,.5);
  box-shadow:0 5px 18px rgba(0,0,0,.18);
}
.kn-item-icon {
  display:grid;
  place-items:center;
  width:36px;
  height:36px;
  border:1px solid rgba(245,158,11,.18);
  border-radius:10px;
  background:rgba(245,158,11,.07);
  color:var(--gold);
}
.kn-item.read .kn-item-icon {
  border-color:rgba(255,255,255,.07);
  background:rgba(255,255,255,.035);
  color:#8C8D96;
}
.kn-item-body {
  min-width:0;
}
.kn-item-heading {
  display:flex;
  align-items:center;
  gap:8px;
  min-width:0;
}
.kn-item-title {
  display:block;
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  color:#F4F4F5;
  font-size:12px;
  font-weight:750;
  line-height:1.5;
}
.kn-item.read .kn-item-title {
  color:#D4D4D8;
}
.kn-unread-dot {
  flex-shrink:0;
  width:6px;
  height:6px;
  border-radius:50%;
  background:var(--gold);
  box-shadow:0 0 0 3px rgba(245,158,11,.09);
}
.kn-item-message {
  display:block;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  margin:4px 0 0;
  color:#8E8F99;
  font-size:10px;
  line-height:1.6;
}
.kn-category-cell {
  display:flex;
  align-items:center;
  justify-content:center;
}
.kn-tag {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  max-width:100%;
  padding:4px 7px;
  border:1px solid rgba(245,158,11,.16);
  border-radius:6px;
  background:rgba(245,158,11,.055);
  color:#E8AC4C;
  font-size:9px;
  font-weight:650;
  white-space:nowrap;
}
.kn-item.read .kn-tag {
  border-color:rgba(255,255,255,.08);
  background:rgba(255,255,255,.025);
  color:#92939D;
}
.kn-item-meta {
  display:flex;
  min-width:0;
  flex-direction:column;
  gap:5px;
  padding-left:12px;
  border-left:1px solid rgba(255,255,255,.06);
}
.kn-item-date {
  display:flex;
  align-items:center;
  gap:5px;
  color:#8E8F99;
  font-size:9px;
  white-space:nowrap;
}
.kn-item-date svg {
  flex-shrink:0;
}
.kn-read-state {
  display:flex;
  align-items:center;
  gap:4px;
  color:#696A75;
  font-size:9px;
}
.kn-read-state.is-unread {
  color:#D89C3D;
}
.kn-item-actions {
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:6px;
}
.kn-item-actions .kn-btn {
  min-height:30px;
  padding:6px 8px;
  border-radius:7px;
  font-size:10px;
  gap:5px;
}
.kn-item-actions .kn-btn:not(.gold) {
  background:rgba(255,255,255,.025);
  border-color:#33343A;
  color:#B3B4BD;
}
.kn-item-actions .kn-btn:not(.gold):hover:not(:disabled) {
  border-color:rgba(245,158,11,.5);
  color:var(--gold);
}
.kn-read-label {
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:6px 8px;
  color:#737580;
  font-size:10px;
}
.kn-empty {
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:12px;
  grid-column:1/-1;
  min-height:190px;
  padding:30px 20px;
  color:var(--secondary);
  text-align:center;
}
.kn-empty svg {
  color:var(--gold);
}
.kn-empty strong {
  font-size:14px;
  color:#FFF;
}
.kn-empty p {
  max-width:360px;
  margin:0;
  font-size:11px;
  line-height:1.7;
}
.kn-pagination {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  flex-wrap:wrap;
  padding:14px 18px;
  border-top:1px solid var(--border);
  color:var(--secondary);
  font-size:10px;
}
.kn-pagination-actions {
  display:flex;
  align-items:center;
  gap:9px;
}
.kn-pagination-actions .kn-btn {
  min-height:32px;
  padding:6px 10px;
  font-size:10px;
}
.kn-pagination-actions span {
  color:#D4D4D8;
  font-size:10px;
  white-space:nowrap;
}
.kn-note {
  margin-top:14px;
  color:var(--muted);
  font-size:10px;
  line-height:1.8;
}
.kn-spin {
  animation:kn-spin .85s linear infinite;
}
@keyframes kn-spin {
  to { transform:rotate(360deg); }
}

@media(max-width:1200px) {
  .kn-stats {
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
  .kn-heading {
    flex-wrap:wrap;
  }
  .kn-item {
    grid-template-columns:34px minmax(0,1fr) 86px 114px 150px;
    gap:10px;
    padding:11px 12px;
  }
  .kn-item-icon {
    width:34px;
    height:34px;
  }
  .kn-item-meta {
    padding-left:9px;
  }
  .kn-item-actions .kn-btn {
    font-size:9px;
    padding:6px 7px;
  }
}
@media(max-width:900px) {
  .kn-item {
    grid-template-columns:34px minmax(0,1fr) 145px;
    gap:8px 11px;
  }
  .kn-item-icon {
    grid-column:1;
    grid-row:1/3;
    align-self:center;
  }
  .kn-item-body {
    grid-column:2;
    grid-row:1;
  }
  .kn-category-cell {
    grid-column:2;
    grid-row:2;
    justify-content:flex-start;
  }
  .kn-item-meta {
    grid-column:3;
    grid-row:1;
    border:0;
    padding:0;
    align-items:flex-end;
  }
  .kn-item-actions {
    grid-column:3;
    grid-row:2;
  }
}
@media(max-width:780px) {
  .kn-main {
    padding:22px 17px 40px;
  }
  .kn-heading {
    align-items:flex-start;
    flex-direction:column;
  }
  .kn-panel-header {
    align-items:stretch;
    flex-direction:column;
    padding:16px;
  }
  .kn-search {
    width:100%;
  }
}
@media(max-width:560px) {
  .kn-main {
    padding:18px 12px 35px;
  }
  .kn-heading h1 {
    font-size:24px;
  }
  .kn-actions {
    width:100%;
    gap:6px;
  }
  .kn-actions .kn-btn {
    flex:1;
    padding:8px;
    font-size:10px;
  }
  .kn-stats {
    gap:9px;
  }
  .kn-stat {
    padding:12px;
    min-height:135px;
  }
  .kn-stat-number {
    font-size:24px;
  }
  .kn-list {
    padding:9px;
    gap:8px;
  }
  .kn-item {
    grid-template-columns:30px minmax(0,1fr);
    gap:8px 10px;
    padding:11px;
  }
  .kn-item-icon {
    grid-column:1;
    grid-row:1;
    width:30px;
    height:30px;
    align-self:start;
  }
  .kn-item-body {
    grid-column:2;
    grid-row:1;
  }
  .kn-item-title {
    white-space:normal;
    overflow-wrap:anywhere;
    font-size:11px;
  }
  .kn-item-message {
    white-space:normal;
    overflow-wrap:anywhere;
    font-size:10px;
  }
  .kn-category-cell {
    grid-column:2;
    grid-row:2;
  }
  .kn-item-meta {
    grid-column:2;
    grid-row:3;
    align-items:flex-start;
    flex-direction:row;
    flex-wrap:wrap;
    gap:9px;
  }
  .kn-item-actions {
    grid-column:2;
    grid-row:4;
    justify-content:flex-start;
    padding-top:3px;
  }
  .kn-item-actions .kn-btn {
    min-height:30px;
    font-size:10px;
    padding:6px 9px;
  }
  .kn-pagination {
    flex-direction:column;
    align-items:stretch;
  }
  .kn-pagination-actions {
    justify-content:space-between;
  }
}
@media(prefers-reduced-motion:reduce) {
  .kn-page *,
  .kn-page *::before,
  .kn-page *::after {
    animation-duration:.01ms!important;
    transition-duration:.01ms!important;
  }
}
`;

function getCategory(item: BarberNotification): string {
  const type = item.notification_type;

  if (type.startsWith("reschedule_")) return "Rescheduling";

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

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCompactDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getDestination(item: BarberNotification): string | null {
  const path = item.action_url?.split("?")[0].split("#")[0];

  const allowed = [
    "/bookings",
    "/rescheduling",
    "/shop-setup",
    "/workers",
    "/dashboard",
    "/notifications",
    "/services",
    "/reviews",
  ];

  if (path && allowed.includes(path)) return path;

  if (item.reference_type === "booking") return "/bookings";

  if (
    item.reference_type === "rescheduling" ||
    item.reference_type === "reschedule"
  ) {
    return "/rescheduling";
  }

  if (item.reference_type === "worker") return "/workers";
  if (item.reference_type === "service") return "/services";
  if (item.reference_type === "review") return "/reviews";
  if (item.reference_type === "shop") return "/shop-setup";
  if (item.reference_type === "account") return "/dashboard";

  return null;
}

function getCount(
  card: ActiveCard,
  counts: NotificationCounts,
): number {
  if (card === "all") return counts.total;
  if (card === "unread") return counts.unread;
  if (card === "booking") return counts.booking;

  return counts.rescheduling;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to load notifications.";
}

export default function NotificationsPage() {
  const navigate = useNavigate();

  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");

  const barberId =
    sessionStorage.getItem("kshurak_barber_id") ||
    sessionStorage.getItem("barber_id");

  const [activeCard, setActiveCard] = useState<ActiveCard>("all");
  const [notifications, setNotifications] =
    useState<BarberNotification[]>([]);
  const [counts, setCounts] =
    useState<NotificationCounts>(EMPTY_COUNTS);

  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const requestSequence = useRef(0);
  const actionBusy = useRef(false);

  const loadNotifications = useCallback(
    async (
      signal?: AbortSignal,
      showRefresh = false,
    ): Promise<boolean> => {
      if (!token || !barberId) return false;

      const sequence = ++requestSequence.current;

      if (showRefresh) setRefreshing(true);

      setError("");

      try {
        const category: NotificationCategory =
          activeCard === "booking" || activeCard === "rescheduling"
            ? activeCard
            : "all";

        const response = await getNotifications(
          {
            category,
            unreadOnly: activeCard === "unread",
            limit: PAGE_SIZE,
            offset,
          },
          signal,
        );

        if (
          signal?.aborted ||
          sequence !== requestSequence.current
        ) {
          return false;
        }

        if (response.total === 0 && offset !== 0) {
          setOffset(0);
          return true;
        }

        if (response.total > 0 && offset >= response.total) {
          setOffset(
            Math.floor((response.total - 1) / PAGE_SIZE) * PAGE_SIZE,
          );
          return true;
        }

        setNotifications(response.notifications);
        setCounts(response.counts);
        setTotal(response.total);
        setLoaded(true);

        return true;
      } catch (err: unknown) {
        if (
          signal?.aborted ||
          sequence !== requestSequence.current ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return false;
        }

        setError(errorMessage(err));
        return false;
      } finally {
        if (
          !signal?.aborted &&
          sequence === requestSequence.current
        ) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [token, barberId, activeCard, offset],
  );

  useEffect(() => {
    if (!token || !barberId) {
      navigate("/login", { replace: true });
      return;
    }

    const controller = new AbortController();

    void loadNotifications(controller.signal);

    return () => {
      controller.abort();
      requestSequence.current += 1;
    };
  }, [token, barberId, loadNotifications, navigate]);

  const visibleNotifications = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return notifications;

    return notifications.filter((item) =>
      [item.title, item.message, getCategory(item)].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [notifications, search]);

  const refresh = async () => {
    if (actionBusy.current || refreshing || saving) return;

    setSuccess("");
    await loadNotifications(undefined, true);
  };

  const changeCard = (card: ActiveCard) => {
    if (actionBusy.current || card === activeCard) return;

    setActiveCard(card);
    setOffset(0);
    setSearch("");
    setError("");
    setSuccess("");
  };

  const reloadAfterAction = async () => {
    if (activeCard === "unread" && offset > 0) {
      setOffset(0);
      return;
    }

    await loadNotifications(undefined, true);
  };

  const markOneRead = async (
    item: BarberNotification,
  ): Promise<boolean> => {
    if (actionBusy.current) return false;
    if (item.is_read) return true;

    actionBusy.current = true;
    requestSequence.current += 1;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await markNotificationAsRead(item.id);

      setNotifications((current) =>
        current.map((notification) =>
          notification.id === item.id
            ? { ...notification, is_read: true }
            : notification,
        ),
      );

      setCounts((current) => ({
        ...current,
        unread: Math.max(0, current.unread - 1),
      }));

      await reloadAfterAction();
      setSuccess("Notification marked as read.");

      return true;
    } catch (err: unknown) {
      setError(errorMessage(err));
      return false;
    } finally {
      actionBusy.current = false;
      setSaving(false);
    }
  };

  // View only navigates. It does not modify read status.
  const openNotification = (item: BarberNotification) => {
    if (actionBusy.current) return;

    const destination = getDestination(item);

    if (destination && destination !== "/notifications") {
      navigate(destination);
    } else {
      setSuccess("There is no separate linked page for this alert.");
    }
  };

  const markAllRead = async () => {
    if (
      actionBusy.current ||
      saving ||
      loading ||
      counts.unread <= 0
    ) {
      return;
    }

    actionBusy.current = true;
    requestSequence.current += 1;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const result = await markAllNotificationsAsRead();

      setNotifications((current) =>
        current.map((notification) => ({
          ...notification,
          is_read: true,
        })),
      );

      setCounts((current) => ({
        ...current,
        unread: 0,
      }));

      await reloadAfterAction();

      setSuccess(
        result.updated_count > 0
          ? `${result.updated_count} notification(s) marked as read.`
          : "All notifications are already marked as read.",
      );
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      actionBusy.current = false;
      setSaving(false);
    }
  };

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!token || !barberId) return null;

  return (
    <div className="kn-page">
      <style>{CSS}</style>

      <main className="kn-main">
        <div className="kn-heading">
          <div>
            <span className="kn-eyebrow">
              KSHURAK / COMMUNICATION CENTER
            </span>

            <h1>Notifications</h1>

            <p>
              Stay updated on booking requests, appointment changes,
              and shop activity.
            </p>
          </div>

          <div className="kn-actions">
            <button
              type="button"
              className="kn-btn"
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft size={15} />
              Dashboard
            </button>

            <button
              type="button"
              className="kn-btn"
              disabled={refreshing || saving || loading}
              onClick={() => void refresh()}
            >
              <RefreshCw
                size={15}
                className={refreshing ? "kn-spin" : ""}
              />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>

            <button
              type="button"
              className="kn-btn gold"
              disabled={
                loading ||
                saving ||
                !loaded ||
                counts.unread === 0
              }
              onClick={() => void markAllRead()}
            >
              {saving ? (
                <Loader2 size={16} className="kn-spin" />
              ) : (
                <CheckCheck size={16} />
              )}
              Mark All as Read
            </button>
          </div>
        </div>

        {error && (
          <div className="kn-alert" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>

            <button
              type="button"
              className="kn-btn"
              disabled={saving || refreshing}
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </div>
        )}

        {success && (
          <div className="kn-success" role="status">
            <CheckCheck size={16} />
            <span>{success}</span>
          </div>
        )}

        <section
          className="kn-stats"
          aria-label="Notification categories"
        >
          {CARDS.map((card) => {
            const Icon = card.icon;
            const active = activeCard === card.id;

            return (
              <button
                type="button"
                key={card.id}
                className={`kn-stat ${active ? "active" : ""}`}
                aria-pressed={active}
                disabled={saving}
                onClick={() => changeCard(card.id)}
              >
                <div className="kn-stat-top">
                  <span className="kn-stat-icon">
                    <Icon size={21} />
                  </span>

                  <span className="kn-stat-number">
                    {loaded ? getCount(card.id, counts) : "—"}
                  </span>
                </div>

                <span className="kn-stat-title">
                  {card.title}
                </span>
                <span className="kn-stat-subtitle">
                  {card.subtitle}
                </span>
              </button>
            );
          })}
        </section>

        <section className="kn-panel">
          <div className="kn-panel-header">
            <div>
              <h2>
                {CARDS.find((card) => card.id === activeCard)?.title}
                {" "}({loaded ? total : "—"})
              </h2>

              <p>
                Notifications from your KSHURAK barber account.
              </p>
            </div>

            <label className="kn-search">
              <Search size={15} />

              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search this page"
                aria-label="Search loaded notifications"
              />

              {search && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                >
                  <X size={14} />
                </button>
              )}
            </label>
          </div>

          {loading && !loaded ? (
            <div className="kn-empty">
              <Loader2 size={25} className="kn-spin" />
              <span>Loading notifications...</span>
            </div>
          ) : !loaded && error ? (
            <div className="kn-empty">
              <AlertCircle size={32} />
              <strong>Notifications unavailable</strong>
              <p>
                Refresh once the Notifications API is available.
              </p>
            </div>
          ) : (
            <div
              className="kn-list"
              aria-busy={loading || saving || refreshing}
            >
              {visibleNotifications.length === 0 ? (
                <div className="kn-empty">
                  <Inbox size={32} />
                  <strong>No notifications found</strong>
                  <p>
                    {search.trim()
                      ? "No matching notifications on this page."
                      : "New booking and appointment updates will appear here."}
                  </p>
                </div>
              ) : (
                visibleNotifications.map((item) => {
                  const category = getCategory(item);

                  const Icon =
                    category === "Booking"
                      ? CalendarDays
                      : category === "Rescheduling"
                        ? CalendarClock
                        : category === "Account"
                          ? ShieldCheck
                          : category === "Shop"
                            ? Store
                            : Bell;

                  const destination = getDestination(item);

                  return (
                    <article
                      key={item.id}
                      className={`kn-item ${
                        item.is_read ? "read" : "unread"
                      }`}
                    >
                      {/* ICON */}
                      <div className="kn-item-icon" aria-hidden="true">
                        <Icon size={17} />
                      </div>

                      {/* TITLE AND MESSAGE */}
                      <div className="kn-item-body">
                        <div className="kn-item-heading">
                          <strong
                            className="kn-item-title"
                            title={item.title}
                          >
                            {item.title}
                          </strong>

                          {!item.is_read && (
                            <span
                              className="kn-unread-dot"
                              role="img"
                              aria-label="Unread notification"
                            />
                          )}
                        </div>

                        <p
                          className="kn-item-message"
                          title={item.message}
                          tabIndex={0}
                        >
                          {item.message}
                        </p>
                      </div>

                      {/* CATEGORY */}
                      <div className="kn-category-cell">
                        <span className="kn-tag">
                          {category}
                        </span>
                      </div>

                      {/* DATE AND READ STATUS */}
                      <div className="kn-item-meta">
                        <time
                          className="kn-item-date"
                          dateTime={item.created_at}
                          title={formatDate(item.created_at)}
                        >
                          <Clock3 size={11} />
                          {formatCompactDate(item.created_at)}
                        </time>

                        <span
                          className={`kn-read-state ${
                            item.is_read ? "" : "is-unread"
                          }`}
                        >
                          {item.is_read ? (
                            <>
                              <CheckCheck size={11} />
                              Read
                            </>
                          ) : (
                            <>
                              <BellRing size={10} />
                              Unread
                            </>
                          )}
                        </span>
                      </div>

                      {/* ACTIONS */}
                      <div className="kn-item-actions">
                        {!item.is_read ? (
                          <button
                            type="button"
                            className="kn-btn"
                            disabled={saving}
                            aria-label={`Mark "${item.title}" as read`}
                            onClick={() => void markOneRead(item)}
                          >
                            <MailOpen size={12} />
                            Mark Read
                          </button>
                        ) : (
                          <span className="kn-read-label">
                            <CheckCheck size={12} />
                            Read
                          </span>
                        )}

                        <button
                          type="button"
                          className="kn-btn gold"
                          disabled={saving}
                          aria-label={`View "${item.title}"`}
                          onClick={() => openNotification(item)}
                        >
                          <Eye size={12} />
                          {destination &&
                          destination !== "/notifications"
                            ? "View"
                            : "Open"}
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          )}

          <div className="kn-pagination">
            <span>
              Showing {total === 0 ? 0 : Math.min(offset + 1, total)}
              –{Math.min(offset + PAGE_SIZE, total)} of {total}
              {" "}notifications
            </span>

            <div className="kn-pagination-actions">
              <button
                type="button"
                className="kn-btn"
                disabled={
                  loading || refreshing || saving || offset === 0
                }
                onClick={() => {
                  setOffset((current) =>
                    Math.max(0, current - PAGE_SIZE),
                  );
                  setSearch("");
                }}
              >
                <ChevronLeft size={14} />
                Previous
              </button>

              <span>
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                className="kn-btn"
                disabled={
                  loading ||
                  refreshing ||
                  saving ||
                  currentPage >= totalPages
                }
                onClick={() => {
                  setOffset((current) => current + PAGE_SIZE);
                  setSearch("");
                }}
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </section>

        <p className="kn-note">
          Search applies to the current page. Viewing a notification
          does not mark it as read. Use Mark Read or Mark All as Read
          to update its status.
        </p>
      </main>
    </div>
  );
}