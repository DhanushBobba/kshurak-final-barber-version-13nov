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
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Eye,
  Loader2,
  RefreshCw,
  Scissors,
  Search,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";

import {
  acceptBarberBooking,
  BookingApiError,
  cancelBarberBooking,
  completeBarberBooking,
  getBarberBookingById,
  getBarberBookings,
  rejectBarberBooking,
  type BarberBooking,
  type BookingHairstyleSelection,
  type BookingStatus,
} from "../../services/bookingApi";

type BookingCard = "total" | "upcoming" | "completed" | "cancelled";
type DateFilter = "today" | "tomorrow" | "week" | "all";
type ActionType = "accept" | "reject" | "complete" | "cancel";

type BookingAction = {
  booking: BarberBooking;
  type: ActionType;
};

const CUSTOMER_WEB_URL = String(
  import.meta.env.VITE_CUSTOMER_WEB_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const STATUS_CARDS = [
  {
    id: "total" as BookingCard,
    title: "Total Bookings",
    subtitle: "All appointments for your shop",
    icon: CalendarDays,
  },
  {
    id: "upcoming" as BookingCard,
    title: "Upcoming",
    subtitle: "Confirmed appointments",
    icon: CalendarClock,
  },
  {
    id: "completed" as BookingCard,
    title: "Completed",
    subtitle: "Finished appointments",
    icon: CheckCircle2,
  },
  {
    id: "cancelled" as BookingCard,
    title: "Cancelled",
    subtitle: "Cancelled or rejected",
    icon: XCircle,
  },
];

const CSS = `
.kbook-page {
  --gold:#F59E0B;--bg:#070708;--surface:#17181A;
  --dark:#0D0D0E;--light:#202124;--text:#FFFFFF;
  --secondary:#9E9EA7;--muted:#71717A;
  --border:#27282C;--border-light:#3E3F45;
  width:100%;min-width:0;min-height:100%;
  background:var(--bg);color:var(--text);
  font-family:Inter,"Segoe UI",Arial,sans-serif;
  font-size:13px;line-height:1.5;color-scheme:dark;
}
.kbook-page *,.kbook-page *::before,.kbook-page *::after {
  box-sizing:border-box;
}
.kbook-page button,.kbook-page input,.kbook-page select,
.kbook-page textarea {font:inherit}
.kbook-page button {cursor:pointer}
.kbook-page button:disabled {opacity:.5;cursor:not-allowed}
.kbook-page :is(button,input,select,textarea,summary):focus-visible {
  outline:2px solid var(--gold);outline-offset:3px;
}
.kbook-container {
  width:100%;max-width:1550px;margin:0 auto;
  padding:28px clamp(16px,2.5vw,34px) 50px;
}
.kbook-heading {
  display:flex;align-items:center;justify-content:space-between;
  gap:18px;margin-bottom:23px;
}
.kbook-heading h1 {
  margin:0 0 8px;font-size:clamp(24px,2.5vw,31px);
  font-weight:750;letter-spacing:-.6px;line-height:1.25;
}
.kbook-heading p {margin:0;color:var(--secondary);font-size:12px}
.kbook-heading-actions {
  display:flex;align-items:center;justify-content:flex-end;
  flex-wrap:wrap;gap:10px;
}
.kbook-top-button {
  display:inline-flex;align-items:center;justify-content:center;
  gap:9px;min-height:41px;padding:10px 15px;
  border:1px solid var(--border-light);border-radius:9px;
  background:var(--light);color:var(--text);
  font-size:11px;font-weight:750;white-space:nowrap;
}
.kbook-top-button:hover:not(:disabled) {
  border-color:var(--gold);color:var(--gold);
}
.kbook-stats {
  display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
  gap:13px;margin-bottom:22px;
}
.kbook-stat {
  position:relative;display:flex;flex-direction:column;
  min-width:0;min-height:148px;padding:18px;
  border:1px solid var(--border);border-radius:12px;
  background:linear-gradient(145deg,#202124,#17181A 55%,#0D0D0E);
  color:var(--text);text-align:left;
  transition:transform .18s,border-color .18s;
}
.kbook-stat:hover {
  border-color:rgba(245,158,11,.55);transform:translateY(-2px);
}
.kbook-stat.active {
  border-color:var(--gold);
  background:linear-gradient(135deg,rgba(245,158,11,.13),#17181A 60%);
  box-shadow:inset 0 0 0 1px rgba(245,158,11,.12);
}
.kbook-stat-top {
  display:flex;align-items:center;justify-content:space-between;
  gap:10px;margin-bottom:15px;
}
.kbook-stat-icon {
  display:grid;place-items:center;width:40px;height:40px;
  border:1px solid rgba(245,158,11,.2);border-radius:10px;
  background:rgba(245,158,11,.09);color:var(--gold);
}
.kbook-stat-count {font-size:29px;font-weight:800;letter-spacing:-1px}
.kbook-stat.active .kbook-stat-count {color:var(--gold)}
.kbook-stat-title {margin-bottom:5px;font-size:12px;font-weight:750}
.kbook-stat-subtitle {color:var(--secondary);font-size:10px}
.kbook-panel {
  min-width:0;overflow:hidden;border:1px solid var(--border);
  border-radius:14px;background:var(--surface);
}
.kbook-panel-head {
  display:flex;align-items:center;justify-content:space-between;
  flex-wrap:wrap;gap:16px;padding:21px;
  border-bottom:1px solid var(--border);
}
.kbook-panel-title h2 {margin:0 0 6px;font-size:18px;font-weight:750}
.kbook-panel-title p {margin:0;color:var(--secondary);font-size:11px}
.kbook-tools {display:flex;align-items:center;flex-wrap:wrap;gap:9px}
.kbook-search {
  display:flex;align-items:center;gap:9px;width:225px;
  min-height:41px;padding:0 12px;
  border:1px solid var(--border-light);border-radius:9px;
  background:var(--dark);color:var(--secondary);
}
.kbook-search input {
  flex:1;min-width:0;width:100%;border:0;outline:none;
  background:transparent;color:var(--text);font-size:11px;
}
.kbook-filter {
  position:relative;display:flex;align-items:center;min-height:41px;
  border:1px solid var(--border-light);border-radius:9px;
  background:var(--dark);
}
.kbook-filter select {
  appearance:none;min-width:140px;height:40px;
  padding:0 35px 0 13px;border:0;outline:none;
  background:transparent;color:var(--text);font-size:11px;
}
.kbook-filter option {background:var(--surface)}
.kbook-filter svg {
  position:absolute;right:11px;pointer-events:none;color:var(--secondary);
}
.kbook-list {padding:13px}
.kbook-row-scroll {
  width:100%;margin-bottom:10px;overflow-x:auto;
  border-radius:10px;scrollbar-width:thin;
}
.kbook-row-scroll:last-child {margin-bottom:0}
.kbook-booking-row {
  display:grid;
  grid-template-columns:110px minmax(175px,1.2fr)
    minmax(165px,1.2fr) 90px 115px minmax(150px,180px);
  align-items:center;gap:13px;min-width:895px;padding:17px;
  border:1px solid var(--border);border-radius:10px;
  background:var(--dark);
}
.kbook-booking-row:hover {
  border-color:rgba(245,158,11,.4);background:var(--light);
}
.kbook-time strong {
  display:block;font-size:14px;font-weight:800;white-space:nowrap;
}
.kbook-time span {
  display:block;margin-top:6px;color:var(--secondary);font-size:10px;
}
.kbook-customer {display:flex;align-items:center;gap:11px;min-width:0}
.kbook-customer-avatar {
  display:grid;place-items:center;flex-shrink:0;
  width:42px;height:42px;overflow:hidden;
  border:1px solid rgba(245,158,11,.25);border-radius:50%;
  background:rgba(245,158,11,.1);color:var(--gold);font-weight:800;
}
.kbook-customer-avatar img {width:100%;height:100%;object-fit:cover}
.kbook-customer-info {min-width:0}
.kbook-customer-info strong {
  display:block;overflow:hidden;font-size:12px;font-weight:750;
  text-overflow:ellipsis;white-space:nowrap;
}
.kbook-customer-info span,.kbook-service span {
  display:block;margin-top:5px;color:var(--secondary);font-size:10px;
}
.kbook-service strong {display:block;font-size:12px;font-weight:700}
.kbook-price {font-size:14px;font-weight:800;white-space:nowrap}
.kbook-status {
  display:inline-flex;align-items:center;justify-content:center;
  gap:6px;padding:7px 10px;border:1px solid var(--border-light);
  border-radius:7px;font-size:10px;font-weight:750;white-space:nowrap;
}
.kbook-status.pending {
  border-color:rgba(245,158,11,.3);
  background:rgba(245,158,11,.1);color:#F59E0B;
}
.kbook-status.confirmed {
  border-color:rgba(96,165,250,.3);
  background:rgba(96,165,250,.1);color:#93C5FD;
}
.kbook-status.completed {
  border-color:rgba(34,197,94,.3);
  background:rgba(34,197,94,.1);color:#4ADE80;
}
.kbook-status.cancelled,.kbook-status.rejected {
  border-color:rgba(239,68,68,.3);
  background:rgba(239,68,68,.1);color:#FCA5A5;
}
.kbook-row-actions {
  display:flex;align-items:center;justify-content:flex-end;gap:7px;
}
.kbook-btn {
  display:inline-flex;align-items:center;justify-content:center;
  gap:7px;min-height:36px;padding:8px 11px;
  border:1px solid transparent;border-radius:8px;
  font-size:11px;font-weight:750;white-space:nowrap;
}
.kbook-btn-gold {
  border-color:var(--gold);background:var(--gold);color:#000;
}
.kbook-btn-outline,.kbook-btn-muted {
  border-color:var(--border-light);background:var(--light);color:var(--text);
}
.kbook-btn-muted {color:var(--secondary)}
.kbook-btn-outline:hover:not(:disabled) {
  border-color:var(--gold);color:var(--gold);
}
.kbook-empty,.kbook-loading {
  display:flex;align-items:center;justify-content:center;
  min-height:240px;padding:40px 20px;
  color:var(--secondary);text-align:center;font-size:11px;
}
.kbook-empty {flex-direction:column}
.kbook-empty svg {margin-bottom:13px;color:var(--gold)}
.kbook-empty strong {margin-bottom:7px;color:var(--text);font-size:14px}
.kbook-loading {gap:11px}
.kbook-spin {animation:kbook-spin .9s linear infinite;color:var(--gold)}
@keyframes kbook-spin {to{transform:rotate(360deg)}}
.kbook-alert,.kbook-success {
  display:flex;align-items:flex-start;gap:10px;margin-bottom:16px;
  padding:13px 15px;border-radius:9px;font-size:11px;line-height:1.65;
}
.kbook-alert {
  border:1px solid rgba(239,68,68,.35);
  background:rgba(239,68,68,.08);color:#FCA5A5;
}
.kbook-success {
  border:1px solid rgba(34,197,94,.35);
  background:rgba(34,197,94,.08);color:#86EFAC;
}
.kbook-footnote {
  margin-top:17px;color:var(--muted);font-size:10px;line-height:1.75;
}
.kbook-overlay {
  position:fixed;inset:0;z-index:120;display:grid;place-items:center;
  padding:18px;background:rgba(18,18,20,.82);backdrop-filter:blur(7px);
}
.kbook-modal {
  width:100%;max-width:590px;max-height:90dvh;overflow-y:auto;
  padding:24px;border:1px solid var(--border-light);border-radius:14px;
  background:var(--surface);box-shadow:0 25px 80px rgba(0,0,0,.55);
}
.kbook-modal-header {
  display:flex;align-items:center;justify-content:space-between;
  gap:14px;margin-bottom:20px;padding-bottom:16px;
  border-bottom:1px solid var(--border);
}
.kbook-modal-header h3 {margin:0;font-size:20px}
.kbook-modal-close {
  display:grid;place-items:center;width:35px;height:35px;
  border:1px solid var(--border-light);border-radius:8px;
  background:var(--light);color:var(--text);
}
.kbook-modal-grid {
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
  gap:16px;margin:20px 0;
}
.kbook-modal-field {min-width:0}
.kbook-modal-field span {
  display:block;margin-bottom:6px;color:var(--muted);font-size:10px;
}
.kbook-modal-field strong {
  display:block;font-size:12px;line-height:1.6;overflow-wrap:anywhere;
}
.kbook-modal-note {
  margin-top:15px;padding:13px;border:1px solid var(--border);
  border-radius:9px;background:var(--dark);
  color:var(--secondary);font-size:11px;line-height:1.7;
}
.kbook-modal-note strong {color:var(--text)}
.kbook-modal-reason {
  width:100%;min-height:105px;margin-top:16px;padding:12px 13px;
  resize:vertical;border:1px solid var(--border-light);
  border-radius:9px;background:var(--dark);color:var(--text);
}
.kbook-modal-actions {
  display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;
  margin-top:23px;padding-top:17px;border-top:1px solid var(--border);
}
.kbook-look-badge {
  display:inline-flex!important;align-items:center;gap:5px;
  max-width:100%;margin-top:7px!important;padding:3px 7px;
  border:1px solid rgba(245,158,11,.3);border-radius:6px;
  background:rgba(245,158,11,.07);
  color:var(--gold)!important;font-size:9px!important;
}
.kbook-look {
  margin-top:20px;overflow:hidden;
  border:1px solid rgba(245,158,11,.35);
  border-radius:12px;background:var(--dark);
}
.kbook-look summary {
  display:flex;align-items:center;justify-content:space-between;
  gap:12px;padding:15px;cursor:pointer;list-style:none;
  color:var(--gold);font-size:12px;font-weight:800;
}
.kbook-look summary::-webkit-details-marker {display:none}
.kbook-look summary>span {display:flex;align-items:center;gap:8px}
.kbook-look[open] summary {border-bottom:1px solid var(--border)}
.kbook-look[open] summary>svg {transform:rotate(180deg)}
.kbook-look-body {padding:15px}
.kbook-look-heading {display:flex;align-items:flex-start;gap:13px}
.kbook-look-heading>div:last-child {min-width:0}
.kbook-look-reference {
  width:85px;height:100px;flex-shrink:0;overflow:hidden;
  border:1px solid var(--border-light);border-radius:9px;background:#000;
}
.kbook-look-reference img {
  display:block;width:100%;height:100%;object-fit:cover;
}
.kbook-image-fallback {
  display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:7px;width:100%;height:100%;
  padding:8px;text-align:center;color:var(--muted);font-size:9px;
}
.kbook-look-heading h4 {
  margin:4px 0 7px;font-size:16px;overflow-wrap:anywhere;
}
.kbook-look-eyebrow {
  margin:0;color:var(--gold);font-size:9px;font-weight:800;
  text-transform:uppercase;letter-spacing:1px;
}
.kbook-look-meta {margin:0;color:var(--secondary);font-size:10px}
.kbook-look-analysis {
  margin-top:15px;padding:13px;border:1px solid var(--border);
  border-radius:9px;background:var(--surface);
}
.kbook-analysis-title {font-size:11px;font-weight:800;color:var(--gold)}
.kbook-analysis-content {
  margin-top:10px;color:var(--secondary);font-size:11px;
  line-height:1.85;overflow-wrap:anywhere;
}
.kbook-analysis-content p {margin:6px 0}
.kbook-analysis-content h5 {
  margin:12px 0 7px;font-size:12px;line-height:1.7;
  font-weight:800;color:var(--text);
}
.kbook-analysis-content strong {color:var(--text);font-weight:750}
.kbook-analysis-line {
  display:flex;align-items:flex-start;gap:8px;margin:5px 0;
}
.kbook-analysis-marker {color:var(--gold);min-width:14px;flex-shrink:0}
.kbook-analysis-line>div {min-width:0;flex:1}
.kbook-analysis-space {height:5px}
.kbook-analysis-rule {border:0;border-top:1px solid var(--border);margin:12px 0}
.kbook-look-previews {
  display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:9px;margin-top:15px;
}
.kbook-look-preview {
  margin:0;overflow:hidden;border:1px solid var(--border);border-radius:8px;
}
.kbook-preview-image {width:100%;aspect-ratio:4/3;background:#000}
.kbook-preview-image img {
  display:block;width:100%;height:100%;object-fit:contain;
}
.kbook-look-preview figcaption {
  padding:8px 4px;text-align:center;color:var(--gold);
  font-size:9px;font-weight:800;text-transform:uppercase;
  border-top:1px solid var(--border);
}
.kbook-look-note {
  margin:12px 0 0;color:var(--muted);font-size:10px;line-height:1.7;
}
.kbook-image-config {
  margin:12px 0 0;color:var(--gold);font-size:10px;line-height:1.7;
}
.kbook-details-loading {
  display:flex;align-items:center;gap:10px;
  margin-top:18px;padding:16px;border:1px solid var(--border);
  border-radius:10px;background:var(--dark);
  color:var(--secondary);font-size:11px;
}
.kbook-details-error {margin-top:18px}
.kbook-details-error p {margin:0 0 12px}
.kbook-inline-error {margin-top:16px}
@media(max-width:1100px) {
  .kbook-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:780px) {
  .kbook-panel-head{flex-direction:column;align-items:stretch}
}
@media(max-width:560px) {
  .kbook-container{padding:18px 13px 35px}
  .kbook-heading{align-items:flex-start;flex-direction:column}
  .kbook-heading-actions{width:100%}
  .kbook-top-button{flex:1;padding:10px 9px;font-size:10px}
  .kbook-stats{gap:9px}
  .kbook-stat{min-height:130px;padding:12px}
  .kbook-stat-count{font-size:25px}
  .kbook-panel-head{padding:15px}
  .kbook-search{width:100%}
  .kbook-modal{padding:17px}
  .kbook-list{padding:9px}
  .kbook-look-previews{grid-template-columns:1fr}
}
@media(prefers-reduced-motion:reduce) {
  .kbook-page *,.kbook-page *::before,.kbook-page *::after {
    animation-duration:.01ms!important;transition-duration:.01ms!important;
  }
}
`;

function localDate(offset = 0): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
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

function formatDate(value: string): string {
  if (value === localDate()) return "Today";
  if (value === localDate(1)) return "Tomorrow";

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) return value;

  return new Date(year, month - 1, day).toLocaleDateString(
    "en-IN",
    { day: "numeric", month: "short", year: "numeric" }
  );
}

function formatMoney(value: number | string): string {
  const amount = Number(value);

  return Number.isFinite(amount)
    ? `₹${amount.toLocaleString("en-IN")}`
    : "Unavailable";
}

function getInitials(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

function statusLabel(status: BookingStatus): string {
  if (status === "pending") return "Pending";
  if (status === "confirmed") return "Upcoming";
  if (status === "completed") return "Completed";
  if (status === "rejected") return "Rejected";
  return "Cancelled";
}

function cardMatchesStatus(
  card: BookingCard,
  status: BookingStatus
): boolean {
  if (card === "total") return true;
  if (card === "upcoming") return status === "confirmed";
  if (card === "completed") return status === "completed";

  return status === "cancelled" || status === "rejected";
}

function matchesDateFilter(
  date: string,
  filter: DateFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "today") return date === localDate();
  if (filter === "tomorrow") return date === localDate(1);

  return date >= localDate() && date <= localDate(6);
}

function compareNewestBookings(
  a: BarberBooking,
  b: BarberBooking
): number {
  const aTime = Date.parse(a.created_at || "");
  const bTime = Date.parse(b.created_at || "");
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);

  if (aValid && bValid) {
    return bTime - aTime || a.id.localeCompare(b.id);
  }

  if (aValid) return -1;
  if (bValid) return 1;

  return a.id.localeCompare(b.id);
}

function actionTitle(action: ActionType): string {
  if (action === "accept") return "Accept Booking";
  if (action === "reject") return "Reject Booking";
  if (action === "complete") return "Complete Booking";

  return "Cancel Booking";
}

function hasSavedHairstyle(booking: BarberBooking): boolean {
  return (
    booking.has_hairstyle_selection === true ||
    !!booking.hairstyle_selection
  );
}

function resolveHairstyleImage(
  value: string | null | undefined
): string {
  const source = String(value || "").trim();

  if (!source) return "";

  if (/^https?:\/\/[^/]+/i.test(source)) {
    return source;
  }

  if (/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(source)) {
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

    return new URL(path, `${CUSTOMER_WEB_URL}/`).href;
  } catch {
    return "";
  }
}

function HairstyleImage({
  source,
  alt,
  reference = false,
}: {
  source: string;
  alt: string;
  reference?: boolean;
}) {
  const uri = resolveHairstyleImage(source);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  return (
    <div
      className={
        reference
          ? "kbook-look-reference"
          : "kbook-preview-image"
      }
    >
      {!uri || failed ? (
        <div
          className="kbook-image-fallback"
          role="img"
          aria-label={alt}
        >
          <Scissors size={21} />
          <span>
            {uri ? "Image unavailable" : "Image not configured"}
          </span>
        </div>
      ) : (
        <img
          src={uri}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function InlineAnalysis({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}

function AnalysisText({ text }: { text: string }) {
  return (
    <div className="kbook-analysis-content">
      {text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line, index) => {
          const value = line.trim();

          if (!value) {
            return (
              <div
                key={index}
                className="kbook-analysis-space"
              />
            );
          }

          if (/^#{1,6}\s+/.test(value)) {
            return (
              <h5 key={index}>
                <InlineAnalysis
                  text={value.replace(/^#{1,6}\s+/, "")}
                />
              </h5>
            );
          }

          if (/^([-*_])(?:\s*\1){2,}$/.test(value)) {
            return (
              <hr
                key={index}
                className="kbook-analysis-rule"
              />
            );
          }

          const bullet = value.match(/^[-*•]\s+(.+)$/);
          const numbered = value.match(/^(\d+)[.)]\s+(.+)$/);

          if (bullet || numbered) {
            return (
              <div
                key={index}
                className="kbook-analysis-line"
              >
                <span className="kbook-analysis-marker">
                  {numbered ? `${numbered[1]}.` : "•"}
                </span>
                <div>
                  <InlineAnalysis
                    text={numbered ? numbered[2] : bullet![1]}
                  />
                </div>
              </div>
            );
          }

          return (
            <p key={index}>
              <InlineAnalysis text={value} />
            </p>
          );
        })}
    </div>
  );
}

function HairstyleDetails({
  selection,
}: {
  selection: BookingHairstyleSelection;
}) {
  const previews = Array.isArray(selection.previews)
    ? selection.previews.filter(
        (preview) =>
          preview &&
          ["front", "left", "right"].includes(preview.angle) &&
          typeof preview.image === "string" &&
          !!preview.image.trim()
      )
    : [];

  const referenceUri = resolveHairstyleImage(
    selection.reference_image
  );

  return (
    <details className="kbook-look" open>
      <summary>
        <span>
          <Sparkles size={16} />
          Selected Hairstyle Analysis
        </span>
        <ChevronDown size={16} />
      </summary>

      <div className="kbook-look-body">
        <div className="kbook-look-heading">
          <HairstyleImage
            source={selection.reference_image}
            alt={`${selection.hairstyle_name} reference`}
            reference
          />

          <div>
            <p className="kbook-look-eyebrow">
              Customer’s Selected Look
            </p>
            <h4>{selection.hairstyle_name}</h4>
            <p className="kbook-look-meta">
              {selection.face_shape
                ? `Face shape: ${selection.face_shape.replace(/_/g, " ")}`
                : "Selected through Virtual Try-On"}
            </p>
          </div>
        </div>

        {!referenceUri && !!selection.reference_image && (
          <p className="kbook-image-config">
            Configure VITE_CUSTOMER_WEB_URL with your customer
            website address to load relative reference images.
          </p>
        )}

        <div className="kbook-look-analysis">
          <div className="kbook-analysis-title">
            Hairstyle Analysis
          </div>

          <AnalysisText
            text={
              selection.style_analysis?.trim() ||
              "No hairstyle analysis was attached."
            }
          />
        </div>

        {previews.length > 0 && (
          <div className="kbook-look-previews">
            {(["front", "left", "right"] as const).map((angle) => {
              const preview = previews.find(
                (item) => item.angle === angle
              );

              if (!preview) return null;

              return (
                <figure
                  key={angle}
                  className="kbook-look-preview"
                >
                  <HairstyleImage
                    source={preview.image}
                    alt={`${selection.hairstyle_name} ${angle} preview`}
                  />
                  <figcaption>{angle} View</figcaption>
                </figure>
              );
            })}
          </div>
        )}

        <p className="kbook-look-note">
          These AI previews show the customer’s requested look.
          Discuss suitability and the final haircut with the
          customer before starting.
        </p>
      </div>
    </details>
  );
}

/**
 * Mounted only inside an open details/action dialog.
 * Keeps large image data outside the main bookings list.
 * Closing the dialog cancels the request.
 */
function BookingHairstylePanel({
  booking,
}: {
  booking: BarberBooking;
}) {
  const initialSelection = booking.hairstyle_selection || null;

  const needsRequest =
    !initialSelection &&
    booking.has_hairstyle_selection !== false;

  const [selection, setSelection] =
    useState<BookingHairstyleSelection | null>(
      initialSelection
    );

  const [loading, setLoading] = useState(needsRequest);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const bookingId = booking.id;

  useEffect(() => {
    if (!needsRequest) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError("");

    async function loadDetails() {
      try {
        const details = await getBarberBookingById(
          bookingId,
          controller.signal
        );

        if (!active || controller.signal.aborted) return;

        setSelection(details.hairstyle_selection || null);
      } catch (err: unknown) {
        if (!active || controller.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load saved hairstyle details."
        );
      } finally {
        if (active && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadDetails();

    return () => {
      active = false;
      controller.abort();
    };
  }, [bookingId, needsRequest, attempt]);

  if (loading) {
    return (
      <div
        className="kbook-details-loading"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={17} className="kbook-spin" />
        Loading saved hairstyle details...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="kbook-modal-note kbook-details-error"
        role="alert"
      >
        <p>
          <strong>Saved hairstyle details could not be loaded.</strong>
        </p>
        <p>{error}</p>
        <p>
          Your booking details remain available. Retrying here
          only reloads the saved hairstyle.
        </p>
        <button
          type="button"
          className="kbook-btn kbook-btn-outline"
          onClick={() => setAttempt((current) => current + 1)}
        >
          <RefreshCw size={14} />
          Retry Hairstyle
        </button>
      </div>
    );
  }

  if (!selection) return null;

  return <HairstyleDetails selection={selection} />;
}

export default function BookingsPage() {
  const navigate = useNavigate();

  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");

  const barberId =
    sessionStorage.getItem("kshurak_barber_id") ||
    sessionStorage.getItem("barber_id");

  const [bookings, setBookings] = useState<BarberBooking[]>([]);
  const [activeStatus, setActiveStatus] =
    useState<BookingCard>("total");
  const [dateFilter, setDateFilter] =
    useState<DateFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);

  const [selectedBooking, setSelectedBooking] =
    useState<BarberBooking | null>(null);

  const [actionBooking, setActionBooking] =
    useState<BookingAction | null>(null);

  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);

  const requestId = useRef(0);
  const savingRef = useRef(false);
  const mountedRef = useRef(false);
  const listControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      listControllerRef.current?.abort();
      requestId.current += 1;
    };
  }, []);

  const loadBookings = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      listControllerRef.current?.abort();

      const controller = new AbortController();
      listControllerRef.current = controller;

      const abortFromCaller = () => controller.abort();

      if (signal?.aborted) {
        controller.abort();
      } else {
        signal?.addEventListener("abort", abortFromCaller, {
          once: true,
        });
      }

      const id = ++requestId.current;

      if (mountedRef.current) {
        setLoading(true);
        setError("");
      }

      try {
        const response = await getBarberBookings(
          {},
          controller.signal
        );

        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          requestId.current !== id
        ) {
          return false;
        }

        setBookings(response.bookings);
        setHasLoaded(true);

        return true;
      } catch (err: unknown) {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          requestId.current !== id
        ) {
          return false;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load bookings."
        );

        return false;
      } finally {
        signal?.removeEventListener("abort", abortFromCaller);

        if (
          mountedRef.current &&
          !controller.signal.aborted &&
          requestId.current === id
        ) {
          setLoading(false);
        }

        if (listControllerRef.current === controller) {
          listControllerRef.current = null;
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!token || !barberId) {
      navigate("/login", { replace: true });
      return;
    }

    const controller = new AbortController();
    void loadBookings(controller.signal);

    return () => controller.abort();
  }, [token, barberId, navigate, loadBookings]);

  useEffect(() => {
    if (!selectedBooking && !actionBooking) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) {
        setSelectedBooking(null);
        setActionBooking(null);
        setActionError("");
        setReason("");
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedBooking, actionBooking]);

  const dateBookings = useMemo(
    () =>
      bookings.filter((booking) =>
        matchesDateFilter(booking.booking_date, dateFilter)
      ),
    [bookings, dateFilter]
  );

  const counts = useMemo(
    () => ({
      total: dateBookings.length,
      upcoming: dateBookings.filter(
        (booking) => booking.status === "confirmed"
      ).length,
      completed: dateBookings.filter(
        (booking) => booking.status === "completed"
      ).length,
      cancelled: dateBookings.filter(
        (booking) =>
          booking.status === "cancelled" ||
          booking.status === "rejected"
      ).length,
    }),
    [dateBookings]
  );

  const visibleBookings = useMemo(() => {
    const query = search.trim().toLowerCase();

    return dateBookings
      .filter((booking) =>
        cardMatchesStatus(activeStatus, booking.status)
      )
      .filter((booking) => {
        if (!query) return true;

        return [
          booking.id,
          booking.customer_name,
          booking.customer_phone,
          booking.service_name,
          booking.hairstyle_name,
          booking.hairstyle_selection?.hairstyle_name,
        ].some((value) =>
          String(value ?? "").toLowerCase().includes(query)
        );
      })
      .sort(compareNewestBookings);
  }, [dateBookings, activeStatus, search]);

  const activeTitle =
    STATUS_CARDS.find((card) => card.id === activeStatus)?.title ||
    "Total Bookings";

  async function refreshBookings() {
    if (savingRef.current) return;

    setSuccess("");

    const refreshed = await loadBookings();

    if (!mountedRef.current || !refreshed) return;

    // Close the old action dialog so an uncertain operation
    // cannot be repeated from stale booking information.
    setOutcomeUnknown(false);
    setActionBooking(null);
    setSelectedBooking(null);
    setActionError("");
    setReason("");
  }

  function openAction(
    booking: BarberBooking,
    type: ActionType
  ) {
    if (savingRef.current || outcomeUnknown) return;

    setSelectedBooking(null);
    setReason("");
    setError("");
    setActionError("");
    setActionBooking({ booking, type });
  }

  function closeAction() {
    if (savingRef.current) return;

    setActionBooking(null);
    setActionError("");
    setReason("");
  }

  async function performAction() {
    if (
      !actionBooking ||
      savingRef.current ||
      outcomeUnknown
    ) {
      return;
    }

    const { booking, type } = actionBooking;
    const trimmedReason = reason.trim();

    if (
      (type === "reject" || type === "cancel") &&
      (trimmedReason.length < 3 || trimmedReason.length > 500)
    ) {
      setActionError(
        "Please enter a reason between 3 and 500 characters."
      );
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setActionError("");
    setError("");
    setSuccess("");

    try {
      let result;

      if (type === "accept") {
        result = await acceptBarberBooking(booking.id);
      } else if (type === "reject") {
        result = await rejectBarberBooking(
          booking.id,
          trimmedReason
        );
      } else if (type === "complete") {
        result = await completeBarberBooking(booking.id);
      } else {
        result = await cancelBarberBooking(
          booking.id,
          trimmedReason
        );
      }

      if (!mountedRef.current) return;

      if (!result.booking || result.booking.id !== booking.id) {
        setOutcomeUnknown(true);
        setActionError(
          "The update result could not be verified. Refresh bookings before taking another action."
        );
        return;
      }

      // Keep the list lightweight even when an older action
      // endpoint returns a full saved hairstyle document.
      const selection = result.booking.hairstyle_selection;

      const lightweightBooking: BarberBooking = {
        ...result.booking,
        has_hairstyle_selection:
          result.booking.has_hairstyle_selection ??
          !!selection,
        hairstyle_name:
          result.booking.hairstyle_name ??
          selection?.hairstyle_name ??
          null,
        hairstyle_selection: null,
        hairstyle_details_loaded: false,
      };

      setBookings((current) =>
        current.map((item) =>
          item.id === booking.id ? lightweightBooking : item
        )
      );

      setActionBooking(null);
      setSelectedBooking(null);
      setReason("");
      setActionError("");

      await loadBookings();

      if (!mountedRef.current) return;

      setSuccess(
        `${booking.customer_name}'s booking updated successfully.`
      );
    } catch (err: unknown) {
      if (!mountedRef.current) return;

      const uncertain =
        err instanceof BookingApiError
          ? err.outcomeUnknown
          : true;

      if (uncertain) {
        setOutcomeUnknown(true);
      }

      setActionError(
        err instanceof Error
          ? err.message
          : "Unable to verify the booking update. Refresh bookings before trying again."
      );
    } finally {
      savingRef.current = false;

      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }

  if (!token || !barberId) return null;

  return (
    <div className="kbook-page">
      <style>{CSS}</style>

      <div className="kbook-container">
        <div className="kbook-heading">
          <div>
            <h1>Booking Management</h1>
            <p>View and manage all appointments for your shop.</p>
          </div>

          <div className="kbook-heading-actions">
            <button
              type="button"
              className="kbook-top-button"
              disabled={saving}
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft size={17} />
              Dashboard
            </button>

            <button
              type="button"
              className="kbook-top-button"
              disabled={loading || saving}
              onClick={() => void refreshBookings()}
            >
              <RefreshCw
                size={16}
                className={loading ? "kbook-spin" : ""}
              />
              {loading ? "Loading..." : "Refresh Bookings"}
            </button>
          </div>
        </div>

        {error && (
          <div className="kbook-alert" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {outcomeUnknown && (
          <div className="kbook-alert" role="alert">
            <AlertCircle size={18} />
            <span>
              A booking update has an unverified result.
              Refresh Bookings and check its current status
              before taking another action.
            </span>
          </div>
        )}

        {success && (
          <div className="kbook-success" role="status">
            <Check size={17} />
            <span>{success}</span>
          </div>
        )}

        <section
          className="kbook-stats"
          aria-label="Booking status filters"
        >
          {STATUS_CARDS.map((card) => {
            const Icon = card.icon;

            return (
              <button
                type="button"
                key={card.id}
                className={`kbook-stat ${
                  activeStatus === card.id ? "active" : ""
                }`}
                aria-pressed={activeStatus === card.id}
                onClick={() => setActiveStatus(card.id)}
              >
                <div className="kbook-stat-top">
                  <span className="kbook-stat-icon">
                    <Icon size={21} />
                  </span>
                  <span className="kbook-stat-count">
                    {hasLoaded ? counts[card.id] : "—"}
                  </span>
                </div>
                <div className="kbook-stat-title">
                  {card.title}
                </div>
                <div className="kbook-stat-subtitle">
                  {card.subtitle}
                </div>
              </button>
            );
          })}
        </section>

        <section
          className="kbook-panel"
          aria-busy={loading}
        >
          <div className="kbook-panel-head">
            <div className="kbook-panel-title">
              <h2>
                {activeTitle} (
                {hasLoaded ? visibleBookings.length : "—"})
              </h2>
              <p>
                Customer details, services, appointment dates,
                amounts and booking status.
              </p>
            </div>

            <div className="kbook-tools">
              <label className="kbook-search">
                <Search size={16} />
                <input
                  type="search"
                  placeholder="Search customer or service"
                  aria-label="Search bookings"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                />
              </label>

              <label className="kbook-filter">
                <select
                  aria-label="Filter booking date"
                  value={dateFilter}
                  onChange={(event) =>
                    setDateFilter(
                      event.target.value as DateFilter
                    )
                  }
                >
                  <option value="all">All Dates</option>
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="week">Next 7 Days</option>
                </select>
                <ChevronDown size={16} />
              </label>
            </div>
          </div>

          <div className="kbook-list">
            {!hasLoaded && loading ? (
              <div className="kbook-loading" role="status">
                <Loader2 size={21} className="kbook-spin" />
                Loading your shop bookings...
              </div>
            ) : !hasLoaded && error ? (
              <div className="kbook-empty">
                <AlertCircle size={36} />
                <strong>Bookings could not be loaded</strong>
                <span>
                  Use Refresh Bookings to try again.
                </span>
              </div>
            ) : visibleBookings.length === 0 ? (
              <div className="kbook-empty">
                <CalendarCheck size={36} />
                <strong>No bookings found</strong>
                <span>
                  No bookings match the selected status,
                  date and search.
                </span>
              </div>
            ) : (
              visibleBookings.map((booking) => (
                <div
                  className="kbook-row-scroll"
                  key={booking.id}
                >
                  <div className="kbook-booking-row">
                    <div className="kbook-time">
                      <strong>
                        {formatTime(booking.start_time)}
                      </strong>
                      <span>
                        {formatDate(booking.booking_date)}
                      </span>
                    </div>

                    <div className="kbook-customer">
                      <div className="kbook-customer-avatar">
                        {booking.customer_image_url ? (
                          <img
                            src={booking.customer_image_url}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          getInitials(booking.customer_name)
                        )}
                      </div>

                      <div className="kbook-customer-info">
                        <strong>
                          {booking.customer_name}
                        </strong>
                        <span>
                          {booking.customer_phone || "—"}
                        </span>
                      </div>
                    </div>

                    <div className="kbook-service">
                      <strong>{booking.service_name}</strong>
                      <span>
                        {booking.service_duration_minutes} mins
                      </span>

                      {hasSavedHairstyle(booking) && (
                        <span
                          className="kbook-look-badge"
                          title={
                            booking.hairstyle_name ||
                            booking.hairstyle_selection
                              ?.hairstyle_name ||
                            "Open this booking to view the selected hairstyle"
                          }
                        >
                          <Scissors size={11} />
                          Selected Hairstyle
                        </span>
                      )}
                    </div>

                    <div className="kbook-price">
                      {formatMoney(booking.service_price)}
                    </div>

                    <div>
                      <span
                        className={`kbook-status ${booking.status}`}
                      >
                        <Clock3 size={14} />
                        {statusLabel(booking.status)}
                      </span>
                    </div>

                    <div className="kbook-row-actions">
                      {booking.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            className="kbook-btn kbook-btn-outline"
                            disabled={
                              saving || loading || outcomeUnknown
                            }
                            onClick={() =>
                              openAction(booking, "reject")
                            }
                          >
                            Reject
                          </button>

                          <button
                            type="button"
                            className="kbook-btn kbook-btn-gold"
                            disabled={
                              saving || loading || outcomeUnknown
                            }
                            onClick={() =>
                              openAction(booking, "accept")
                            }
                          >
                            Accept
                          </button>
                        </>
                      ) : booking.status === "confirmed" ? (
                        <>
                          <button
                            type="button"
                            className="kbook-btn kbook-btn-outline"
                            disabled={saving}
                            onClick={() =>
                              setSelectedBooking(booking)
                            }
                          >
                            <Eye size={15} />
                            View
                          </button>

                          <button
                            type="button"
                            className="kbook-btn kbook-btn-gold"
                            disabled={
                              saving || loading || outcomeUnknown
                            }
                            onClick={() =>
                              openAction(booking, "complete")
                            }
                          >
                            Complete
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="kbook-btn kbook-btn-outline"
                          disabled={saving}
                          onClick={() =>
                            setSelectedBooking(booking)
                          }
                        >
                          <Eye size={15} />
                          View
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <p className="kbook-footnote">
          Total Bookings includes pending, upcoming, completed,
          cancelled and rejected appointments. Card counts follow
          the date filter; search filters the list below.
          Newest bookings appear first. Saved hairstyle previews
          load only when a booking dialog is opened.
        </p>
      </div>

      {selectedBooking && (
        <div
          className="kbook-overlay"
          role="presentation"
          onClick={() => setSelectedBooking(null)}
        >
          <div
            className="kbook-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Booking details"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="kbook-modal-header">
              <h3>Booking Details</h3>

              <button
                type="button"
                className="kbook-modal-close"
                aria-label="Close booking details"
                onClick={() => setSelectedBooking(null)}
              >
                <X size={18} />
              </button>
            </div>

            <span
              className={`kbook-status ${selectedBooking.status}`}
            >
              <Clock3 size={14} />
              {statusLabel(selectedBooking.status)}
            </span>

            <div className="kbook-modal-grid">
              {[
                ["Booking ID", selectedBooking.id],
                ["Customer", selectedBooking.customer_name],
                [
                  "Phone",
                  selectedBooking.customer_phone || "—",
                ],
                ["Service", selectedBooking.service_name],
                [
                  "Date",
                  formatDate(selectedBooking.booking_date),
                ],
                [
                  "Time",
                  formatTime(selectedBooking.start_time),
                ],
                [
                  "Duration",
                  `${selectedBooking.service_duration_minutes} minutes`,
                ],
                [
                  "Amount",
                  formatMoney(selectedBooking.service_price),
                ],
                [
                  "Worker ID",
                  selectedBooking.worker_id || "Not assigned",
                ],
              ].map(([label, value]) => (
                <div
                  className="kbook-modal-field"
                  key={label}
                >
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            <BookingHairstylePanel
              key={`details-${selectedBooking.id}`}
              booking={selectedBooking}
            />

            {selectedBooking.customer_notes && (
              <div className="kbook-modal-note">
                <strong>Customer Notes:</strong>{" "}
                {selectedBooking.customer_notes}
              </div>
            )}

            {selectedBooking.cancellation_reason && (
              <div className="kbook-modal-note">
                <strong>Cancellation Reason:</strong>{" "}
                {selectedBooking.cancellation_reason}
              </div>
            )}

            <div className="kbook-modal-actions">
              {selectedBooking.status === "confirmed" && (
                <button
                  type="button"
                  className="kbook-btn kbook-btn-outline"
                  disabled={
                    saving || loading || outcomeUnknown
                  }
                  onClick={() =>
                    openAction(selectedBooking, "cancel")
                  }
                >
                  Cancel Booking
                </button>
              )}

              <button
                type="button"
                className="kbook-btn kbook-btn-muted"
                onClick={() => setSelectedBooking(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {actionBooking && (
        <div
          className="kbook-overlay"
          role="presentation"
          onClick={closeAction}
        >
          <div
            className="kbook-modal"
            role="alertdialog"
            aria-modal="true"
            aria-label={actionTitle(actionBooking.type)}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="kbook-modal-header">
              <h3>{actionTitle(actionBooking.type)}</h3>

              <button
                type="button"
                className="kbook-modal-close"
                disabled={saving}
                aria-label="Close booking action"
                onClick={closeAction}
              >
                <X size={18} />
              </button>
            </div>

            {actionError && (
              <div className="kbook-alert" role="alert">
                <AlertCircle size={18} />
                <span>{actionError}</span>
              </div>
            )}

            <div className="kbook-modal-note">
              <strong>
                {actionBooking.booking.customer_name}
              </strong>

              <div style={{ marginTop: 6 }}>
                {actionBooking.booking.service_name}
                {" · "}
                {formatDate(
                  actionBooking.booking.booking_date
                )}
                {" · "}
                {formatTime(
                  actionBooking.booking.start_time
                )}
              </div>

              <div style={{ marginTop: 9 }}>
                Are you sure you want to{" "}
                {actionBooking.type} this booking?
              </div>

              {actionBooking.type === "accept" && (
                <div style={{ marginTop: 8 }}>
                  Availability will be checked by the backend
                  before accepting this appointment.
                </div>
              )}
            </div>

            <BookingHairstylePanel
              key={`action-${actionBooking.booking.id}`}
              booking={actionBooking.booking}
            />

            {(actionBooking.type === "reject" ||
              actionBooking.type === "cancel") && (
              <textarea
                className="kbook-modal-reason"
                value={reason}
                disabled={saving || outcomeUnknown}
                onChange={(event) =>
                  setReason(event.target.value)
                }
                placeholder={
                  actionBooking.type === "reject"
                    ? "Enter reason for rejection..."
                    : "Enter reason for cancellation..."
                }
                maxLength={500}
                aria-label="Reason"
              />
            )}

            {outcomeUnknown && error && (
              <div
                className="kbook-alert kbook-inline-error"
                role="alert"
              >
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <div className="kbook-modal-actions">
              <button
                type="button"
                className="kbook-btn kbook-btn-muted"
                disabled={saving}
                onClick={closeAction}
              >
                Go Back
              </button>

              {outcomeUnknown ? (
                <button
                  type="button"
                  className="kbook-btn kbook-btn-gold"
                  disabled={loading || saving}
                  onClick={() => void refreshBookings()}
                >
                  <RefreshCw
                    size={15}
                    className={loading ? "kbook-spin" : ""}
                  />
                  {loading
                    ? "Checking..."
                    : "Refresh Booking Status"}
                </button>
              ) : (
                <button
                  type="button"
                  className="kbook-btn kbook-btn-gold"
                  disabled={
                    saving ||
                    loading ||
                    ((actionBooking.type === "reject" ||
                      actionBooking.type === "cancel") &&
                      (reason.trim().length < 3 ||
                        reason.trim().length > 500))
                  }
                  onClick={() => void performAction()}
                >
                  {saving ? (
                    <>
                      <Loader2
                        size={15}
                        className="kbook-spin"
                      />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Check size={15} />
                      Confirm {actionBooking.type}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}