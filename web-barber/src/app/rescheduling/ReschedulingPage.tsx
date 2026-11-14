import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";

import {
  approveRescheduleRequest,
  createWorkerUnavailabilityRequest,
  declineRescheduleRequest,
  getEligibleRescheduleBookings,
  getRescheduleRequests,
  ReschedulingApiError,
  withdrawRescheduleRequest,
  type EligibleRescheduleBooking,
  type RecoveryOptionType,
  type RescheduleRequest,
} from "../../services/reschedulingApi";

import {
  getWorkers,
  type BarberWorker,
} from "../../services/barberApi";

type Tab = "requests" | "awaiting" | "approved" | "closed";
type ActionType = "approve" | "decline" | "withdraw";
type DateFilter = "all" | "today" | "week";

type Decision = {
  request: RescheduleRequest;
  action: ActionType;
};

type ProposalDraft = {
  bookingId: string;
  reason: string;
  otherDate: string;
  sameWorkerStart: string;
  replacementWorkerId: string;
  replacementStart: string;
};

const EMPTY_DRAFT: ProposalDraft = {
  bookingId: "",
  reason: "",
  otherDate: "",
  sameWorkerStart: "",
  replacementWorkerId: "",
  replacementStart: "",
};

const OPTION_LABELS: Record<RecoveryOptionType, string> = {
  cancel_booking: "Cancel appointment",
  same_worker_other_day: "Another day · Same worker",
  other_worker_same_day: "Same day · Another worker",
};

const TABS = [
  {
    key: "requests" as const,
    title: "Reschedule Requests",
    description: "Customer requests awaiting action",
    icon: CalendarClock,
  },
  {
    key: "awaiting" as const,
    title: "Awaiting Customer",
    description: "Your proposals awaiting a decision",
    icon: Clock3,
  },
  {
    key: "approved" as const,
    title: "Rescheduled",
    description: "Approved appointment changes",
    icon: CheckCircle2,
  },
  {
    key: "closed" as const,
    title: "Closed Requests",
    description: "Declined, withdrawn or cancelled",
    icon: XCircle,
  },
];

const CSS = `
.kr2 {
  --gold:#F59E0B;
  --bg:#070708;
  --surface:#17181A;
  --dark:#0D0D0E;
  --light:#202124;
  --text:#FFFFFF;
  --secondary:#9E9EA7;
  --muted:#71717A;
  --border:#27282C;
  --border-light:#3E3F45;
  --success:#22C55E;
  --error:#EF4444;
  width:100%;
  min-width:0;
  color:var(--text);
  background:var(--bg);
  color-scheme:dark;
  font-family:Inter,"Segoe UI",Arial,sans-serif;
  font-size:13px;
}
.kr2 *, .kr2 *::before, .kr2 *::after {box-sizing:border-box}
.kr2 button,.kr2 input,.kr2 select,.kr2 textarea {font:inherit}
.kr2 button {cursor:pointer}
.kr2 button:disabled {cursor:not-allowed;opacity:.45}
.kr2 :is(button,input,select,textarea):focus-visible {
  outline:2px solid var(--gold);outline-offset:3px;
}
.kr2-main {width:100%;max-width:1560px;margin:auto;padding:24px clamp(14px,2vw,30px) 32px}
.kr2-heading,.kr2-toolbar,.kr2-panel-head,.kr2-dialog-head {
  display:flex;align-items:center;justify-content:space-between;gap:14px;
}
.kr2-heading {margin-bottom:18px;flex-wrap:wrap}
.kr2-eyebrow {margin:0 0 6px;color:var(--gold);font-size:10px;font-weight:800;letter-spacing:1.8px}
.kr2 h1 {margin:0;font-size:clamp(23px,2.2vw,30px);letter-spacing:-.7px}
.kr2-subtitle {margin:7px 0 0;color:var(--secondary);line-height:1.6}
.kr2-toolbar {flex-wrap:wrap}
.kr2-btn {
  display:inline-flex;align-items:center;justify-content:center;gap:7px;
  min-height:36px;padding:8px 12px;border:1px solid var(--border-light);
  border-radius:9px;background:var(--light);color:var(--text);
  font-size:12px;font-weight:750;line-height:1.3;text-decoration:none;
}
.kr2-btn:hover:not(:disabled) {border-color:var(--gold)}
.kr2-btn-gold {background:var(--gold);border-color:var(--gold);color:#070708}
.kr2-btn-gold:hover:not(:disabled) {background:#FBBF24}
.kr2-btn-icon {width:34px;min-height:34px;padding:7px;flex:none}
.kr2-policy {
  display:flex;align-items:flex-start;gap:10px;padding:12px 14px;margin-bottom:18px;
  border:1px solid rgba(245,158,11,.22);border-radius:11px;
  background:rgba(245,158,11,.055);color:var(--secondary);line-height:1.65;
}
.kr2-policy svg {flex:none;color:var(--gold);margin-top:2px}
.kr2-policy strong {color:var(--text)}
.kr2-stats {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:20px}
.kr2-stat {
  min-width:0;text-align:left;padding:16px;border:1px solid var(--border);
  border-radius:13px;background:linear-gradient(145deg,#202124,#0D0D0E);
  color:var(--text);
}
.kr2-stat:hover,.kr2-stat-active {border-color:var(--gold)}
.kr2-stat-top {display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:13px}
.kr2-stat-icon {
  display:grid;place-items:center;width:36px;height:36px;color:var(--gold);
  background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);border-radius:10px;
}
.kr2-stat-count {font-size:29px;font-weight:850;line-height:1}
.kr2-stat-active .kr2-stat-count {color:var(--gold)}
.kr2-stat strong {display:block;font-size:12px}
.kr2-stat small {display:block;color:var(--secondary);font-size:10px;line-height:1.6;margin-top:6px}
.kr2-panel {
  min-width:0;border:1px solid var(--border);border-radius:15px;
  background:var(--surface);container-type:inline-size;
}
.kr2-panel-head {padding:18px;flex-wrap:wrap;border-bottom:1px solid var(--border)}
.kr2-panel-head h2 {margin:0 0 5px;font-size:18px;letter-spacing:-.4px}
.kr2-panel-head p {margin:0;color:var(--secondary);font-size:11px;line-height:1.6}
.kr2-filters {display:flex;gap:9px;flex-wrap:wrap;max-width:100%;min-width:0}
.kr2-search {position:relative;min-width:0;flex:1}
.kr2-search svg {position:absolute;left:11px;top:12px;color:var(--secondary)}
.kr2-search input {padding-left:34px!important}
.kr2-input {
  width:100%;min-width:0;max-width:100%;padding:11px 12px;border:1px solid var(--border-light);
  border-radius:9px;background:var(--dark);color:var(--text);outline:none;
}
.kr2-input:focus {border-color:var(--gold)}
.kr2-filters input {width:220px;max-width:100%}
.kr2-filters select {width:125px}
.kr2-list {padding:12px;display:grid;gap:10px;min-width:0}
.kr2-row {
  display:grid;
  grid-template-columns:minmax(0,1.15fr) minmax(0,1fr) 16px minmax(0,1fr) minmax(95px,.8fr) auto;
  align-items:center;gap:12px;min-width:0;width:100%;
  padding:15px 13px;border:1px solid var(--border);border-radius:11px;
  background:var(--dark);transition:border-color .18s,background .18s;
}
.kr2-row:hover {border-color:rgba(245,158,11,.65);background:#111112}
.kr2-row > * {min-width:0}
.kr2-person {display:flex;align-items:center;gap:10px;min-width:0}
.kr2-avatar {
  display:grid;place-items:center;width:34px;height:34px;flex:none;
  border-radius:50%;color:var(--gold);font-weight:850;
  background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.25);
}
.kr2-cell {min-width:0;overflow-wrap:anywhere}
.kr2-cell strong {display:block;font-size:12px;line-height:1.5}
.kr2-cell small {display:block;color:var(--secondary);font-size:10px;line-height:1.7;margin-top:2px}
.kr2-cell-label {color:var(--muted)!important}
.kr2-arrow {color:var(--gold)}
.kr2-requested strong {color:var(--gold)}
.kr2-actions {display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}
.kr2-actions .kr2-btn {font-size:10px;min-height:32px;padding:7px 9px}
.kr2-actions .kr2-btn-icon {width:32px}
.kr2-badge {
  display:inline-flex;align-items:center;gap:5px;max-width:100%;
  border:1px solid rgba(245,158,11,.2);border-radius:7px;
  padding:6px 8px;background:rgba(245,158,11,.08);
  color:var(--gold);font-size:10px;font-weight:750;line-height:1.5;
}
.kr2-badge-success {color:var(--success);border-color:rgba(34,197,94,.25);background:rgba(34,197,94,.07)}
.kr2-badge-closed {color:var(--secondary);border-color:var(--border-light);background:var(--light)}
.kr2-empty {padding:42px 18px;text-align:center;color:var(--secondary);line-height:1.8}
.kr2-empty strong {display:block;color:var(--text);margin-bottom:5px}
.kr2-alert {
  display:flex;gap:9px;align-items:flex-start;margin:0 0 14px;padding:12px 14px;
  border:1px solid rgba(239,68,68,.25);border-radius:10px;
  background:rgba(239,68,68,.07);color:#FCA5A5;line-height:1.65;
  overflow-wrap:anywhere;
}
.kr2-alert svg {flex:none;margin-top:2px}
.kr2-alert-success {color:#86EFAC;border-color:rgba(34,197,94,.25);background:rgba(34,197,94,.07)}
.kr2-dialog {
  width:min(760px,calc(100% - 28px));max-width:760px;
  max-height:calc(100dvh - 32px);margin:auto;padding:0;
  border:1px solid var(--border-light);border-radius:17px;
  background:var(--surface);color:var(--text);overflow-y:auto;
  box-shadow:0 24px 90px rgba(0,0,0,.55);
}
.kr2-dialog::backdrop {background:rgba(7,7,8,.82);backdrop-filter:blur(6px)}
.kr2-dialog-head {padding:19px 22px;border-bottom:1px solid var(--border)}
.kr2-dialog-head h2 {font-size:19px;margin:0;letter-spacing:-.4px}
.kr2-dialog-body {padding:20px 22px}
.kr2-dialog-foot {
  display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;
  margin-top:20px;padding-top:17px;border-top:1px solid var(--border);
}
.kr2-fieldset {border:0;padding:0;margin:0;min-width:0}
.kr2-field {display:grid;gap:7px;min-width:0}
.kr2-field > span {font-size:11px;font-weight:750;color:var(--secondary)}
.kr2-field textarea {resize:vertical;min-height:88px}
.kr2-field small {font-size:10px;color:var(--muted);line-height:1.65}
.kr2-field + .kr2-field {margin-top:15px}
.kr2-current {
  display:grid;gap:6px;padding:13px;margin:14px 0;border:1px solid rgba(245,158,11,.22);
  border-radius:10px;background:rgba(245,158,11,.05);line-height:1.6;
}
.kr2-current strong {font-size:12px}
.kr2-current span,.kr2-current small {font-size:11px;color:var(--secondary)}
.kr2-current .kr2-deadline {color:var(--gold)}
.kr2-option {padding:15px;border:1px solid var(--border-light);border-radius:11px;background:var(--dark);margin-top:12px;min-width:0}
.kr2-option-head {display:flex;gap:10px;align-items:flex-start;margin-bottom:12px}
.kr2-option-head svg {color:var(--gold);flex:none;margin-top:1px}
.kr2-option-head strong {font-size:12px}
.kr2-option-head p {margin:4px 0 0;color:var(--secondary);font-size:11px;line-height:1.6}
.kr2-option-cancel {border-color:rgba(239,68,68,.2)}
.kr2-option-cancel .kr2-option-head {margin-bottom:0}
.kr2-option-cancel svg {color:var(--error)}
.kr2-form-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
.kr2-form-grid .kr2-field + .kr2-field {margin-top:0}
.kr2-note {color:var(--secondary);font-size:11px;line-height:1.8;margin:12px 0 0}
.kr2-detail-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.kr2-detail {padding:13px;background:var(--dark);border:1px solid var(--border);border-radius:10px;min-width:0;overflow-wrap:anywhere}
.kr2-detail small {display:block;font-size:10px;color:var(--secondary);margin-bottom:7px}
.kr2-detail strong {font-size:12px;line-height:1.7;white-space:pre-wrap}
.kr2-wide {grid-column:1/-1}
.kr2-spin {animation:kr2-spin 1s linear infinite}
@keyframes kr2-spin {to {transform:rotate(360deg)}}
@container (max-width: 930px) {
  .kr2-row {grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) 16px minmax(0,1fr) minmax(90px,.8fr)}
  .kr2-actions {grid-column:1/-1;padding-top:10px;border-top:1px solid var(--border)}
}
@container (max-width: 620px) {
  .kr2-row {grid-template-columns:minmax(0,1fr) 16px minmax(0,1fr);gap:12px}
  .kr2-person {grid-column:1/-1}
  .kr2-status {grid-column:1/-1}
  .kr2-actions {justify-content:flex-start}
}
@media (max-width: 850px) {
  .kr2-stats {grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width: 520px) {
  .kr2-main {padding:18px 12px 25px}
  .kr2-panel-head {padding:15px}
  .kr2-filters {width:100%}
  .kr2-search {flex-basis:100%}
  .kr2-filters input {width:100%}
  .kr2-dialog-head,.kr2-dialog-body {padding:16px}
  .kr2-form-grid,.kr2-detail-grid {grid-template-columns:minmax(0,1fr)}
  .kr2-stat {padding:13px}
  .kr2-stat small {font-size:9px}
}
@media (prefers-reduced-motion: reduce) {
  .kr2-row {transition:none}
  .kr2-spin {animation:none}
}
`;

/* ============================================================
   DATE AND DISPLAY HELPERS
============================================================ */

function shopDate(timestamp = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));

  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value || "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(value: string, count: number): string {
  const timestamp = Date.parse(`${value}T00:00:00Z`);

  return new Date(timestamp + count * 86400000)
    .toISOString()
    .slice(0, 10);
}

function appointmentTime(day: string, start: string): number {
  return Date.parse(`${day}T${start}+05:30`);
}

function formatDate(value: string): string {
  const timestamp = Date.parse(`${value}T12:00:00+05:30`);

  if (!Number.isFinite(timestamp)) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(timestamp);
}

function formatTime(value: string): string {
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3, 5));

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return "—";
  }

  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${
    hour >= 12 ? "PM" : "AM"
  }`;
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(timestamp);
}

function endTime(start: string, duration: number): string {
  if (!start) return "";

  const total =
    Number(start.slice(0, 2)) * 60 +
    Number(start.slice(3, 5)) +
    duration;

  if (!Number.isInteger(total) || total >= 1440) return "";

  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60
  ).padStart(2, "0")}`;
}

function proposedStarts(
  worker: BarberWorker | undefined,
  duration: number,
  day: string,
  now: number
): string[] {
  if (!worker?.is_active || !day || duration <= 0) return [];

  const from =
    Number(worker.shift_start.slice(0, 2)) * 60 +
    Number(worker.shift_start.slice(3, 5));

  const until =
    Number(worker.shift_end.slice(0, 2)) * 60 +
    Number(worker.shift_end.slice(3, 5));

  const result: string[] = [];

  for (let minute = from; minute + duration <= until; minute += 60) {
    if (minute + duration >= 1440) break;

    const start = `${String(Math.floor(minute / 60)).padStart(
      2,
      "0"
    )}:${String(minute % 60).padStart(2, "0")}`;

    if (appointmentTime(day, start) > now) {
      result.push(start);
    }
  }

  return result;
}

function belongsToTab(item: RescheduleRequest, tab: Tab): boolean {
  if (tab === "requests") {
    return item.status === "pending" && item.requested_by === "customer";
  }

  if (tab === "awaiting") {
    return item.status === "pending" && item.requested_by === "barber";
  }

  if (tab === "approved") {
    return (
      item.status === "approved" &&
      item.selected_option_type !== "cancel_booking"
    );
  }

  return (
    item.status === "declined" ||
    item.status === "cancelled" ||
    item.selected_option_type === "cancel_booking"
  );
}

function statusLabel(item: RescheduleRequest): string {
  if (item.selected_option_type === "cancel_booking") {
    return "Customer cancelled";
  }

  if (item.status === "pending") {
    return item.requested_by === "barber"
      ? "Awaiting customer"
      : "New request";
  }

  if (item.status === "cancelled") return "Withdrawn";
  if (item.status === "approved") return "Approved";

  return "Declined";
}

function actionTitle(action: ActionType): string {
  if (action === "approve") return "Approve rescheduling";
  if (action === "decline") return "Decline request";
  return "Withdraw proposal";
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to complete this request.";
}

/* ============================================================
   NATIVE DIALOG WITH KEYBOARD FOCUS MANAGEMENT
============================================================ */

function Dialog({
  title,
  id,
  busy,
  onClose,
  children,
}: {
  title: string;
  id: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    dialog?.showModal();

    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="kr2-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="kr2-dialog-head">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="kr2-btn kr2-btn-icon"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>

      <div className="kr2-dialog-body">{children}</div>
    </dialog>
  );
}

function Alert({
  children,
  success = false,
}: {
  children: ReactNode;
  success?: boolean;
}) {
  return (
    <div
      className={`kr2-alert ${success ? "kr2-alert-success" : ""}`}
      role={success ? "status" : "alert"}
    >
      {success ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
      <span>{children}</span>
    </div>
  );
}

/* ============================================================
   PAGE
============================================================ */

export default function ReschedulingPage() {
  const navigate = useNavigate();

  const [requests, setRequests] = useState<RescheduleRequest[]>([]);
  const [workers, setWorkers] = useState<BarberWorker[]>([]);
  const [bookings, setBookings] = useState<EligibleRescheduleBooking[]>([]);

  const [tab, setTab] = useState<Tab>("requests");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [success, setSuccess] = useState("");
  const [reload, setReload] = useState(0);

  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalReload, setProposalReload] = useState(0);
  const [draft, setDraft] = useState<ProposalDraft>({ ...EMPTY_DRAFT });

  const [details, setDetails] = useState<RescheduleRequest | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [decisionReason, setDecisionReason] = useState("");

  const [modalError, setModalError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertainResult, setUncertainResult] = useState(false);
  const busyRef = useRef(false);

  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const update = () => setNow(Date.now() + clockOffset);

    update();
    const timer = window.setInterval(update, 15000);

    return () => window.clearInterval(timer);
  }, [clockOffset]);

  useEffect(() => {
    const token =
      sessionStorage.getItem("kshurak_barber_token") ||
      sessionStorage.getItem("barber_access_token");

    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    setPageError("");

    void getRescheduleRequests(undefined, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setRequests(response.requests);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPageError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [navigate, reload]);

  useEffect(() => {
    const controller = new AbortController();

    void getWorkers(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setWorkers(response);
      })
      .catch(() => {
        // Opening the proposal form retries this request and
        // displays any error there.
      });

    return () => controller.abort();
  }, []);

  const loadProposalData = useCallback(async (signal: AbortSignal) => {
    setProposalLoading(true);
    setModalError("");
    setUncertainResult(true);

    try {
      const started = Date.now();

      const [response, workerList] = await Promise.all([
        getEligibleRescheduleBookings(signal),
        getWorkers(signal),
      ]);

      if (signal.aborted) return;

      const received = Date.now();
      const serverTimestamp = Date.parse(response.server_time);

      if (!Number.isFinite(serverTimestamp)) {
        throw new Error("The backend returned an invalid server time.");
      }

      const offset = serverTimestamp - (started + received) / 2;

      setClockOffset(offset);
      setNow(Date.now() + offset);
      setBookings(response.bookings);
      setWorkers(workerList);
      setUncertainResult(false);

      setDraft((current) =>
        response.bookings.some((booking) => booking.id === current.bookingId)
          ? current
          : { ...EMPTY_DRAFT }
      );
    } catch (error: unknown) {
      if (!signal.aborted) setModalError(errorMessage(error));
    } finally {
      if (!signal.aborted) setProposalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!proposalOpen) return;

    const controller = new AbortController();
    void loadProposalData(controller.signal);

    return () => controller.abort();
  }, [proposalOpen, proposalReload, loadProposalData]);

  const eligibleBookings = useMemo(
    () =>
      bookings.filter(
        (booking) =>
          booking.status === "confirmed" &&
          Date.parse(booking.reschedule_deadline) > now &&
          appointmentTime(booking.booking_date, booking.start_time) > now
      ),
    [bookings, now]
  );

  const selectedBooking = eligibleBookings.find(
    (booking) => booking.id === draft.bookingId
  );

  const originalWorker = workers.find(
    (worker) => worker.id === selectedBooking?.worker_id
  );

  const replacementWorkers = workers.filter(
    (worker) =>
      worker.is_active &&
      worker.id !== selectedBooking?.worker_id &&
      worker.barber_id === selectedBooking?.barber_id
  );

  const replacementWorker = replacementWorkers.find(
    (worker) => worker.id === draft.replacementWorkerId
  );

  const sameWorkerStarts = selectedBooking
    ? proposedStarts(
        originalWorker,
        selectedBooking.service_duration_minutes,
        draft.otherDate,
        now
      )
    : [];

  const replacementStarts = selectedBooking
    ? proposedStarts(
        replacementWorker,
        selectedBooking.service_duration_minutes,
        selectedBooking.booking_date,
        now
      )
    : [];

  const counts = useMemo(
    () => ({
      requests: requests.filter((item) => belongsToTab(item, "requests")).length,
      awaiting: requests.filter((item) => belongsToTab(item, "awaiting")).length,
      approved: requests.filter((item) => belongsToTab(item, "approved")).length,
      closed: requests.filter((item) => belongsToTab(item, "closed")).length,
    }),
    [requests]
  );

  const today = shopDate(now);

  const visibleRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    const weekEnd = addDays(today, 6);

    return requests
      .filter((item) => belongsToTab(item, tab))
      .filter((item) => {
        if (!query) return true;

        return [
          item.customer_name,
          item.customer_phone,
          item.service_name,
          item.booking_id,
          item.reason,
        ].some((value) => String(value ?? "").toLowerCase().includes(query));
      })
      .filter((item) => {
        if (dateFilter === "all") return true;

        const dates = [
          item.original_date,
          item.requested_date,
          ...(item.options ?? []).flatMap((option) =>
            option.appointment_date ? [option.appointment_date] : []
          ),
        ];

        return dates.some((day) =>
          dateFilter === "today"
            ? day === today
            : day >= today && day <= weekEnd
        );
      });
  }, [requests, tab, search, dateFilter, today]);

  function workerName(id: string | null): string {
    return (
      workers.find((worker) => worker.id === id)?.full_name ||
      "Assigned worker"
    );
  }

  function openProposal() {
    setSuccess("");
    setModalError("");
    setDraft({ ...EMPTY_DRAFT });
    setUncertainResult(false);
    setProposalOpen(true);
  }

  function selectBooking(bookingId: string) {
    const booking = eligibleBookings.find((item) => item.id === bookingId);

    setModalError("");
    setDraft({
      ...EMPTY_DRAFT,
      bookingId,
      otherDate: booking ? addDays(booking.booking_date, 1) : "",
    });
  }

  function openDecision(request: RescheduleRequest, action: ActionType) {
    setDetails(null);
    setModalError("");
    setDecisionReason("");
    setUncertainResult(false);
    setDecision({ request, action });
  }

  async function submitProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busyRef.current || uncertainResult) return;

    setModalError("");

    if (!selectedBooking) {
      setModalError("Select an eligible booking. Refresh if its window expired.");
      return;
    }

    if (!originalWorker?.is_active) {
      setModalError(
        "The original worker is inactive. A same-worker recovery option cannot currently be offered."
      );
      return;
    }

    if (
      !draft.otherDate ||
      draft.otherDate === selectedBooking.booking_date ||
      draft.otherDate < today
    ) {
      setModalError("Select another day for the original worker.");
      return;
    }

    if (
      !sameWorkerStarts.includes(draft.sameWorkerStart) ||
      !replacementStarts.includes(draft.replacementStart) ||
      !replacementWorker
    ) {
      setModalError("Select a proposed start time for both appointment options.");
      return;
    }

    if (draft.reason.trim().length < 3) {
      setModalError("Enter an unavailability reason of at least 3 characters.");
      return;
    }

    busyRef.current = true;
    setBusy(true);

    try {
      await createWorkerUnavailabilityRequest({
        booking_id: selectedBooking.id,
        reason: draft.reason.trim(),
        options: [
          { option_type: "cancel_booking" },
          {
            option_type: "same_worker_other_day",
            worker_id: selectedBooking.worker_id,
            appointment_date: draft.otherDate,
            start_time: draft.sameWorkerStart,
            end_time: endTime(
              draft.sameWorkerStart,
              selectedBooking.service_duration_minutes
            ),
          },
          {
            option_type: "other_worker_same_day",
            worker_id: replacementWorker.id,
            appointment_date: selectedBooking.booking_date,
            start_time: draft.replacementStart,
            end_time: endTime(
              draft.replacementStart,
              selectedBooking.service_duration_minutes
            ),
          },
        ],
      });

      setProposalOpen(false);
      setTab("awaiting");
      setSuccess(
        "Three options submitted. The booking stays unchanged until the customer chooses."
      );
      setReload((value) => value + 1);
    } catch (error: unknown) {
      setModalError(errorMessage(error));

      if (
        error instanceof ReschedulingApiError &&
        (error.status === 0 ||
          error.status >= 500 ||
          error.code === "INVALID_RESPONSE")
      ) {
        setUncertainResult(true);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function submitDecision() {
    if (!decision || busyRef.current || uncertainResult) return;

    busyRef.current = true;
    setBusy(true);
    setModalError("");

    try {
      const id = decision.request.id;

      const response =
        decision.action === "approve"
          ? await approveRescheduleRequest(id)
          : decision.action === "decline"
          ? await declineRescheduleRequest(id, decisionReason)
          : await withdrawRescheduleRequest(id);

      setDecision(null);
      setSuccess(response.message);
      setReload((value) => value + 1);
    } catch (error: unknown) {
      setModalError(errorMessage(error));

      if (
        error instanceof ReschedulingApiError &&
        (error.status === 0 ||
          error.status >= 500 ||
          error.code === "INVALID_RESPONSE")
      ) {
        setUncertainResult(true);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const activeTitle = TABS.find((item) => item.key === tab)?.title;

  return (
    <section className="kr2">
      <style>{CSS}</style>

      <div className="kr2-main">
        <header className="kr2-heading">
          <div>
            <p className="kr2-eyebrow">APPOINTMENT MANAGEMENT</p>
            <h1>Rescheduling</h1>
          
          </div>

          <div className="kr2-toolbar">
            <button
              type="button"
              className="kr2-btn"
              disabled={loading || busy}
              onClick={() => setReload((value) => value + 1)}
            >
              <RefreshCw size={15} className={loading ? "kr2-spin" : ""} />
              Refresh
            </button>

            <button
              type="button"
              className="kr2-btn kr2-btn-gold"
              disabled={busy}
              onClick={openProposal}
            >
              <Plus size={16} />
              New Reschedule
            </button>
          </div>
        </header>

        <div className="kr2-policy">
          <ShieldCheck size={19} />
          <span>
            <strong>24-hour confirmation policy.</strong> Barber proposals can be
            initiated within 24 hours of confirmation, before the appointment
            starts. The customer chooses the final action.
          </span>
        </div>

        {success && <Alert success>{success}</Alert>}
        {pageError && <Alert>{pageError}</Alert>}

        <div className="kr2-stats">
          {TABS.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.key}
                type="button"
                className={`kr2-stat ${
                  tab === item.key ? "kr2-stat-active" : ""
                }`}
                aria-pressed={tab === item.key}
                onClick={() => setTab(item.key)}
              >
                <div className="kr2-stat-top">
                  <span className="kr2-stat-icon">
                    <Icon size={19} />
                  </span>
                  <span className="kr2-stat-count">{counts[item.key]}</span>
                </div>

                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </button>
            );
          })}
        </div>

        <section className="kr2-panel" aria-busy={loading}>
          <div className="kr2-panel-head">
            <div>
              <h2>
                {activeTitle} ({visibleRequests.length})
              </h2>
              <p>Customer, appointment details, status and actions.</p>
            </div>

            <div className="kr2-filters">
              <div className="kr2-search">
                <Search size={15} />
                <input
                  className="kr2-input"
                  aria-label="Search requests"
                  placeholder="Search customer or service"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>

              <select
                className="kr2-input"
                aria-label="Filter appointment dates"
                value={dateFilter}
                onChange={(event) =>
                  setDateFilter(event.target.value as DateFilter)
                }
              >
                <option value="all">All dates</option>
                <option value="today">Today</option>
                <option value="week">Next 7 days</option>
              </select>
            </div>
          </div>

          <div className="kr2-list">
            {loading ? (
              <div className="kr2-empty">Loading rescheduling requests…</div>
            ) : visibleRequests.length === 0 ? (
              <div className="kr2-empty">
                <strong>No matching requests</strong>
                Requests will appear here when a customer or barber proposes a
                change.
              </div>
            ) : (
              visibleRequests.map((item) => {
                const recovery =
                  item.request_kind === "worker_unavailability";

                const canApprove =
                  item.booking_status === "confirmed" &&
                  appointmentTime(
                    item.original_date,
                    item.original_start_time
                  ) > now;

                const selectedOption = (item.options ?? []).find(
                  (option) =>
                    option.option_type === item.selected_option_type
                );

                const shownDate =
                  selectedOption?.appointment_date || item.requested_date;

                const shownStart =
                  selectedOption?.start_time || item.requested_start_time;

                const shownEnd =
                  selectedOption?.end_time || item.requested_end_time;

                const customerCancelled =
                  item.selected_option_type === "cancel_booking";

                return (
                  <article className="kr2-row" key={item.id}>
                    <div className="kr2-person">
                      <span className="kr2-avatar" aria-hidden="true">
                        {item.customer_name.trim().charAt(0).toUpperCase() ||
                          "C"}
                      </span>
                      <div className="kr2-cell">
                        <strong>{item.customer_name}</strong>
                        <small>{item.customer_phone}</small>
                        <small>{item.service_name}</small>
                      </div>
                    </div>

                    <div className="kr2-cell">
                      <strong>{formatDate(item.original_date)}</strong>
                      <small>
                        {formatTime(item.original_start_time)} –{" "}
                        {formatTime(item.original_end_time)}
                      </small>
                      <small className="kr2-cell-label">
                        Original appointment
                      </small>
                    </div>

                    <ArrowRight size={16} className="kr2-arrow" />

                    <div className="kr2-cell kr2-requested">
                      {customerCancelled ? (
                        <>
                          <strong>Appointment cancelled</strong>
                          <small>Selected by customer</small>
                        </>
                      ) : recovery && item.status === "pending" ? (
                        <>
                          <strong>3 customer choices</strong>
                          <small>Cancel · Another day · Another worker</small>
                          <small className="kr2-cell-label">
                            Worker unavailable
                          </small>
                        </>
                      ) : (
                        <>
                          <strong>{formatDate(shownDate)}</strong>
                          <small>
                            {formatTime(shownStart)} – {formatTime(shownEnd)}
                          </small>
                          <small className="kr2-cell-label">
                            {item.status === "approved"
                              ? "Updated appointment"
                              : recovery
                              ? "Proposed same-worker option"
                              : "Requested appointment"}
                          </small>
                        </>
                      )}
                    </div>

                    <div className="kr2-status">
                      <span
                        className={`kr2-badge ${
                          customerCancelled ||
                          item.status === "declined" ||
                          item.status === "cancelled"
                            ? "kr2-badge-closed"
                            : item.status === "approved"
                            ? "kr2-badge-success"
                            : ""
                        }`}
                      >
                        {statusLabel(item)}
                      </span>
                    </div>

                    <div className="kr2-actions">
                      <button
                        type="button"
                        className="kr2-btn kr2-btn-icon"
                        aria-label={`View request for ${item.customer_name}`}
                        title="View details"
                        onClick={() => setDetails(item)}
                      >
                        <Eye size={14} />
                      </button>

                      {item.status === "pending" &&
                        item.requested_by === "customer" && (
                          <>
                            <button
                              type="button"
                              className="kr2-btn"
                              disabled={busy}
                              onClick={() => openDecision(item, "decline")}
                            >
                              Decline
                            </button>
                            <button
                              type="button"
                              className="kr2-btn kr2-btn-gold"
                              disabled={
                                busy ||
                                !canApprove ||
                                item.request_kind !== "appointment_change"
                              }
                              title={
                                canApprove
                                  ? "Approve if the requested slot is available"
                                  : "The original appointment is no longer upcoming"
                              }
                              onClick={() => openDecision(item, "approve")}
                            >
                              Approve
                            </button>
                          </>
                        )}

                      {item.status === "pending" &&
                        item.requested_by === "barber" && (
                          <button
                            type="button"
                            className="kr2-btn"
                            disabled={busy}
                            onClick={() => openDecision(item, "withdraw")}
                          >
                            Withdraw
                          </button>
                        )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* ====================================================
          NEW THREE-OPTION PROPOSAL
      ==================================================== */}

      {proposalOpen && (
        <Dialog
          title="New reschedule proposal"
          id="kr2-proposal-title"
          busy={busy}
          onClose={() => setProposalOpen(false)}
        >
          <form onSubmit={(event) => void submitProposal(event)}>
            {modalError && <Alert>{modalError}</Alert>}

            <div className="kr2-policy">
              <Clock3 size={18} />
              <span>
                Only upcoming confirmed bookings within the 24-hour window are
                listed. Creating a proposal does not change the booking.
              </span>
            </div>

            <div className="kr2-toolbar" style={{ marginBottom: 15 }}>
              <span className="kr2-note" style={{ margin: 0 }}>
                {proposalLoading
                  ? "Loading eligible bookings…"
                  : `${eligibleBookings.length} eligible booking(s)`}
              </span>

              <button
                type="button"
                className="kr2-btn"
                disabled={busy || proposalLoading}
                onClick={() => {
                  setProposalReload((value) => value + 1);
                  setReload((value) => value + 1);
                }}
              >
                <RefreshCw
                  size={14}
                  className={proposalLoading ? "kr2-spin" : ""}
                />
                Refresh eligibility
              </button>
            </div>

            <fieldset
              className="kr2-fieldset"
              disabled={busy || proposalLoading}
            >
              <label className="kr2-field">
                <span>Confirmed booking *</span>
                <select
                  className="kr2-input"
                  required
                  value={selectedBooking ? draft.bookingId : ""}
                  onChange={(event) => selectBooking(event.target.value)}
                >
                  <option value="">Select an eligible booking</option>
                  {eligibleBookings.map((booking) => (
                    <option key={booking.id} value={booking.id}>
                      {booking.customer_name} — {booking.service_name} —{" "}
                      {formatDate(booking.booking_date)}{" "}
                      {formatTime(booking.start_time)}
                    </option>
                  ))}
                </select>
              </label>

              {!proposalLoading &&
                !modalError &&
                eligibleBookings.length === 0 && (
                  <div className="kr2-current">
                    <strong>No eligible bookings</strong>
                    <span>
                      Bookings that have started, passed the 24-hour window,
                      lack a linked customer or worker, or already have a
                      pending request are excluded.
                    </span>
                  </div>
                )}

              {draft.bookingId && !selectedBooking && !proposalLoading && (
                <p className="kr2-note">
                  The selected booking is no longer eligible. Refresh and
                  select another booking.
                </p>
              )}

              {selectedBooking && (
                <>
                  <div className="kr2-current">
                    <strong>
                      {selectedBooking.customer_name} ·{" "}
                      {selectedBooking.service_name}
                    </strong>
                    <span>
                      {formatDate(selectedBooking.booking_date)} ·{" "}
                      {formatTime(selectedBooking.start_time)} –{" "}
                      {formatTime(selectedBooking.end_time)}
                    </span>
                    <span>
                      Worker:{" "}
                      {selectedBooking.worker_name ||
                        originalWorker?.full_name ||
                        "Assigned worker"}
                    </span>
                    <small>
                      Confirmed:{" "}
                      {formatTimestamp(selectedBooking.confirmed_at)} IST
                    </small>
                    <small className="kr2-deadline">
                      Proposal deadline:{" "}
                      {formatTimestamp(
                        selectedBooking.reschedule_deadline
                      )}{" "}
                      IST
                    </small>
                  </div>

                  <label className="kr2-field">
                    <span>Reason for worker unavailability *</span>
                    <textarea
                      className="kr2-input"
                      required
                      minLength={3}
                      maxLength={1000}
                      placeholder="Explain why the assigned worker cannot attend."
                      value={draft.reason}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          reason: event.target.value,
                        }))
                      }
                    />
                    <small>
                      The customer will see this reason.{" "}
                      {draft.reason.length}/1000
                    </small>
                  </label>

                  <div className="kr2-option kr2-option-cancel">
                    <div className="kr2-option-head">
                      <XCircle size={19} />
                      <div>
                        <strong>01 · Cancel appointment</strong>
                        <p>
                          Offered automatically. The booking is cancelled only
                          if the customer selects this option.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="kr2-option">
                    <div className="kr2-option-head">
                      <CalendarClock size={19} />
                      <div>
                        <strong>02 · Another day with the same worker</strong>
                        <p>
                          {originalWorker?.full_name ||
                            selectedBooking.worker_name ||
                            "Original worker"}
                        </p>
                      </div>
                    </div>

                    <div className="kr2-form-grid">
                      <label className="kr2-field">
                        <span>Another appointment date *</span>
                        <input
                          className="kr2-input"
                          type="date"
                          required
                          min={today}
                          value={draft.otherDate}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              otherDate: event.target.value,
                              sameWorkerStart: "",
                            }))
                          }
                        />
                      </label>

                      <label className="kr2-field">
                        <span>Proposed start time *</span>
                        <select
                          className="kr2-input"
                          required
                          value={
                            sameWorkerStarts.includes(draft.sameWorkerStart)
                              ? draft.sameWorkerStart
                              : ""
                          }
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              sameWorkerStart: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select a proposed time</option>
                          {sameWorkerStarts.map((start) => (
                            <option value={start} key={start}>
                              {formatTime(start)} –{" "}
                              {formatTime(
                                endTime(
                                  start,
                                  selectedBooking.service_duration_minutes
                                )
                              )}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {!originalWorker?.is_active && (
                      <p className="kr2-note">
                        The original worker is inactive or unavailable in the
                        worker list. This option cannot currently be submitted.
                      </p>
                    )}
                  </div>

                  <div className="kr2-option">
                    <div className="kr2-option-head">
                      <Users size={19} />
                      <div>
                        <strong>03 · Another worker on the same day</strong>
                        <p>
                          Appointment date:{" "}
                          {formatDate(selectedBooking.booking_date)}
                        </p>
                      </div>
                    </div>

                    <div className="kr2-form-grid">
                      <label className="kr2-field">
                        <span>Replacement worker *</span>
                        <select
                          className="kr2-input"
                          required
                          value={draft.replacementWorkerId}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              replacementWorkerId: event.target.value,
                              replacementStart: "",
                            }))
                          }
                        >
                          <option value="">Select another worker</option>
                          {replacementWorkers.map((worker) => (
                            <option key={worker.id} value={worker.id}>
                              {worker.full_name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="kr2-field">
                        <span>Proposed start time *</span>
                        <select
                          className="kr2-input"
                          required
                          value={
                            replacementStarts.includes(draft.replacementStart)
                              ? draft.replacementStart
                              : ""
                          }
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              replacementStart: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select a proposed time</option>
                          {replacementStarts.map((start) => (
                            <option value={start} key={start}>
                              {formatTime(start)} –{" "}
                              {formatTime(
                                endTime(
                                  start,
                                  selectedBooking.service_duration_minutes
                                )
                              )}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {replacementWorkers.length === 0 && (
                      <p className="kr2-note">
                        No other active worker is registered at this shop.
                        All three options are required to submit this proposal.
                      </p>
                    )}
                  </div>

                  <p className="kr2-note">
                    Start times are shown in one-hour intervals within worker
                    shifts. Shop hours, breaks and booking conflicts are checked
                    by the backend when submitting and again when the customer
                    selects an appointment. Proposed times are not reserved.
                  </p>
                </>
              )}
            </fieldset>

            {uncertainResult && !proposalLoading && (
              <p className="kr2-note">
                Refresh eligibility before submitting again so an existing
                request is not duplicated.
              </p>
            )}

            <div className="kr2-dialog-foot">
              <button
                type="button"
                className="kr2-btn"
                disabled={busy}
                onClick={() => setProposalOpen(false)}
              >
                Close
              </button>

              <button
                type="submit"
                className="kr2-btn kr2-btn-gold"
                disabled={
                  busy ||
                  proposalLoading ||
                  uncertainResult ||
                  !selectedBooking ||
                  !originalWorker?.is_active ||
                  !sameWorkerStarts.includes(draft.sameWorkerStart) ||
                  !replacementStarts.includes(draft.replacementStart)
                }
              >
                <Check size={15} />
                {busy ? "Submitting…" : "Send three options"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {/* ====================================================
          REQUEST DETAILS
      ==================================================== */}

      {details && (
        <Dialog
          title="Reschedule request details"
          id="kr2-details-title"
          busy={false}
          onClose={() => setDetails(null)}
        >
          <div className="kr2-detail-grid">
            <div className="kr2-detail">
              <small>Customer</small>
              <strong>{details.customer_name}</strong>
              <p className="kr2-note">{details.customer_phone}</p>
            </div>

            <div className="kr2-detail">
              <small>Service / Status</small>
              <strong>{details.service_name}</strong>
              <p className="kr2-note">{statusLabel(details)}</p>
            </div>

            <div className="kr2-detail kr2-wide">
              <small>Original appointment</small>
              <strong>
                {formatDate(details.original_date)} ·{" "}
                {formatTime(details.original_start_time)} –{" "}
                {formatTime(details.original_end_time)}
              </strong>
            </div>

            <div className="kr2-detail kr2-wide">
              <small>
                {details.requested_by === "barber"
                  ? "Barber's reason"
                  : "Customer's reason"}
              </small>
              <strong>{details.reason || "No reason provided."}</strong>
            </div>

            {details.request_kind !== "worker_unavailability" && (
              <div className="kr2-detail kr2-wide">
                <small>Requested appointment</small>
                <strong>
                  {formatDate(details.requested_date)} ·{" "}
                  {formatTime(details.requested_start_time)} –{" "}
                  {formatTime(details.requested_end_time)}
                </strong>
              </div>
            )}
          </div>

          {(details.options ?? []).map((option) => (
            <div className="kr2-option" key={option.id}>
              <strong>{OPTION_LABELS[option.option_type]}</strong>

              {option.option_type === "cancel_booking" ? (
                <p className="kr2-note">Cancel the original appointment.</p>
              ) : (
                <p className="kr2-note">
                  {workerName(option.worker_id)}
                  <br />
                  {option.appointment_date
                    ? formatDate(option.appointment_date)
                    : "—"}
                  {" · "}
                  {option.start_time ? formatTime(option.start_time) : "—"}
                  {" – "}
                  {option.end_time ? formatTime(option.end_time) : "—"}
                </p>
              )}

              {details.selected_option_type === option.option_type && (
                <span className="kr2-badge kr2-badge-success">
                  <Check size={12} /> Selected by customer
                </span>
              )}
            </div>
          ))}

          {details.decision_reason && (
            <div className="kr2-detail" style={{ marginTop: 12 }}>
              <small>Decision note</small>
              <strong>{details.decision_reason}</strong>
            </div>
          )}

          <p className="kr2-note">
            Requested: {formatTimestamp(details.created_at)} IST
            {details.decided_at && (
              <> · Decided: {formatTimestamp(details.decided_at)} IST</>
            )}
          </p>

          <div className="kr2-dialog-foot">
            <button
              type="button"
              className="kr2-btn"
              onClick={() => setDetails(null)}
            >
              Close
            </button>
          </div>
        </Dialog>
      )}

      {/* ====================================================
          APPROVE / DECLINE / WITHDRAW
      ==================================================== */}

      {decision && (
        <Dialog
          title={actionTitle(decision.action)}
          id="kr2-decision-title"
          busy={busy}
          onClose={() => setDecision(null)}
        >
          {modalError && <Alert>{modalError}</Alert>}

          <div className="kr2-current">
            <strong>{decision.request.customer_name}</strong>
            <span>{decision.request.service_name}</span>
            <span>
              Original: {formatDate(decision.request.original_date)} ·{" "}
              {formatTime(decision.request.original_start_time)}
            </span>

            {decision.request.request_kind === "worker_unavailability" ? (
              <span>Proposal contains three customer choices.</span>
            ) : (
              <span>
                Requested: {formatDate(decision.request.requested_date)} ·{" "}
                {formatTime(decision.request.requested_start_time)}
              </span>
            )}
          </div>

          <p className="kr2-note">
            {decision.action === "approve"
              ? "The booking will change only if the proposed appointment is still available."
              : decision.action === "decline"
              ? "Declining closes this request without changing the booking."
              : "Withdrawing closes your proposal without changing the booking."}
          </p>

          {decision.action === "decline" && (
            <label className="kr2-field" style={{ marginTop: 15 }}>
              <span>Optional decline reason</span>
              <textarea
                className="kr2-input"
                maxLength={1000}
                disabled={busy}
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
              />
            </label>
          )}

          {uncertainResult && (
            <p className="kr2-note">
              Close this dialog and refresh the request list before trying
              again. The previous action may already have completed.
            </p>
          )}

          <div className="kr2-dialog-foot">
            <button
              type="button"
              className="kr2-btn"
              disabled={busy}
              onClick={() => setDecision(null)}
            >
              Go back
            </button>

            <button
              type="button"
              className="kr2-btn kr2-btn-gold"
              disabled={busy || uncertainResult}
              onClick={() => void submitDecision()}
            >
              <Check size={15} />
              {busy ? "Processing…" : "Confirm"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}