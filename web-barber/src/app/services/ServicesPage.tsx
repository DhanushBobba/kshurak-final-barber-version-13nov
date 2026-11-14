import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CSSProperties, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit3,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import {
  createBarberService,
  getBarberServices,
  setBarberServiceStatus,
  updateBarberService,
  type BarberService,
  type ServicePayload,
} from "../../services/servicesApi";

/* ============================================================
   EXISTING COLOR PALETTE
============================================================ */

const COLORS = {
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

type ServiceForm = {
  service_name: string;
  description: string;
  duration_minutes: string;
  price: string;
};

type CategoryFilter =
  | "all"
  | "haircut"
  | "beard"
  | "shave"
  | "facial"
  | "haircare"
  | "package"
  | "other";

type StatusFilter = "all" | "active" | "inactive";

type Notice = {
  type: "success" | "error";
  message: string;
};

const PAGE_SIZE = 8;

const EMPTY_FORM: ServiceForm = {
  service_name: "",
  description: "",
  duration_minutes: "30",
  price: "",
};

/* ============================================================
   HELPERS
============================================================ */

function getCategory(name: string): {
  key: CategoryFilter;
  label: string;
} {
  const value = name.toLowerCase();

  if (/package|combo|bundle|ritual/.test(value)) {
    return { key: "package", label: "Package" };
  }

  if (/beard|moustache/.test(value)) {
    return { key: "beard", label: "Beard" };
  }

  if (/shave|shaving/.test(value)) {
    return { key: "shave", label: "Shaving" };
  }

  if (/facial|face|skin|cleanup/.test(value)) {
    return { key: "facial", label: "Facial" };
  }

  if (/haircut|hair cut|fade|scissor/.test(value)) {
    return { key: "haircut", label: "Haircut" };
  }

  if (/hair|spa|color|colour/.test(value)) {
    return { key: "haircare", label: "Hair Care" };
  }

  return { key: "other", label: "Other" };
}

function formatPrice(value: number | string): string {
  const amount = Number(value);

  if (!Number.isFinite(amount)) return "—";

  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function getError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

function validateForm(form: ServiceForm): ServicePayload {
  const name = form.service_name.trim();
  const description = form.description.trim();
  const duration = Number(form.duration_minutes);
  const price = Number(form.price);

  if (!name || name.length > 150) {
    throw new Error(
      "Service name must contain 1 to 150 characters."
    );
  }

  if (description.length > 2000) {
    throw new Error(
      "Description cannot exceed 2000 characters."
    );
  }

  if (
    form.duration_minutes.trim() === "" ||
    !Number.isInteger(duration) ||
    duration < 5 ||
    duration > 480
  ) {
    throw new Error(
      "Duration must be between 5 and 480 minutes."
    );
  }

  if (
    !/^\d+(\.\d{1,2})?$/.test(form.price.trim()) ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 9999999999.99
  ) {
    throw new Error(
      "Enter a valid price with up to two decimal places."
    );
  }

  return {
    service_name: name,
    description: description || null,
    duration_minutes: duration,
    price,
  };
}

/* ============================================================
   EXISTING UI — OUTER SPACING FIX
============================================================ */

const styles = `
/* Outer wrapper creates space beside the sidebar and screen edge.
   Border-box keeps that padding inside the available width. */
.ks-page-spacing {
  box-sizing:border-box;
  width:100%;
  max-width:100%;
  min-width:0;
  margin:0;
  padding:28px clamp(18px,3vw,40px) 12px;
}

.ks-premium {
  --ks-gold:${COLORS.primary};
  --ks-bg:${COLORS.background};
  --ks-surface:${COLORS.surface};
  --ks-dark:${COLORS.surfaceDark};
  --ks-light:${COLORS.surfaceLight};
  --ks-border:${COLORS.border};
  --ks-border-light:${COLORS.borderLight};
  --ks-text:${COLORS.text};
  --ks-secondary:${COLORS.textSecondary};
  --ks-muted:${COLORS.textMuted};
  --ks-success:${COLORS.success};
  --ks-error:${COLORS.error};
  width:100%;
  max-width:100%;
  min-width:0;
  margin:0;
  padding:2px 0 24px;
  color:var(--ks-text);
  font-family:inherit;
  container-type:inline-size;
}
.ks-premium *,
.ks-premium *::before,
.ks-premium *::after {
  box-sizing:border-box;
  min-width:0;
}
.ks-premium button,
.ks-premium input,
.ks-premium select,
.ks-premium textarea {
  font:inherit;
}
.ks-premium button {
  cursor:pointer;
}
.ks-premium button:disabled {
  opacity:.48;
  cursor:not-allowed;
}
.ks-header {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:15px;
  flex-wrap:wrap;
  margin-bottom:15px;
}
.ks-heading {
  flex:1 1 260px;
}
.ks-eyebrow {
  display:inline-flex;
  align-items:center;
  gap:8px;
  margin-bottom:8px;
  color:var(--ks-gold);
  font-size:9px;
  font-weight:800;
  letter-spacing:1.8px;
}
.ks-eyebrow::before {
  content:"";
  height:2px;
  width:16px;
  background:var(--ks-gold);
  border-radius:4px;
}
.ks-heading h1 {
  color:#fff;
  font-size:clamp(24px,2.5vw,31px);
  font-weight:850;
  letter-spacing:-.8px;
  line-height:1.2;
  margin:0 0 6px;
}
.ks-heading p {
  margin:0;
  color:var(--ks-secondary);
  font-size:11px;
  line-height:1.6;
}
.ks-header-actions {
  display:flex;
  flex:0 0 auto;
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  margin-top:16px;
}
.ks-btn {
  min-height:38px;
  padding:0 13px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  border:1px solid var(--ks-border);
  border-radius:9px;
  background:var(--ks-surface);
  color:var(--ks-text);
  font-size:11px;
  font-weight:750;
  white-space:nowrap;
  transition:background .2s,border-color .2s,transform .2s;
}
.ks-btn:hover:not(:disabled) {
  background:var(--ks-light);
  border-color:var(--ks-gold);
  transform:translateY(-1px);
}
.ks-btn-primary {
  background:var(--ks-gold);
  color:#000;
  border-color:var(--ks-gold);
  font-weight:850;
}
.ks-btn-primary:hover:not(:disabled) {
  color:#000;
  background:#ffb52d;
}
.ks-spinner {
  animation:ks-spin .9s linear infinite;
}
@keyframes ks-spin {
  to { transform:rotate(360deg); }
}
.ks-stats {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:10px;
  margin-bottom:15px;
}
.ks-stat {
  position:relative;
  min-height:94px;
  display:flex;
  align-items:center;
  gap:10px;
  padding:11px 12px;
  border:1px solid var(--ks-border);
  border-radius:11px;
  background:
    radial-gradient(
      circle at 100% 0%,
      rgba(245,158,11,.045),
      transparent 65%
    ),
    var(--ks-dark);
  overflow:hidden;
  transition:border-color .2s,transform .2s;
}
.ks-stat:hover {
  border-color:rgba(245,158,11,.4);
  transform:translateY(-2px);
}
.ks-stat::after {
  content:"";
  position:absolute;
  left:12px;
  bottom:0;
  width:29px;
  height:2px;
  border-radius:5px;
  background:var(--stat-accent,var(--ks-gold));
  opacity:.72;
}
.ks-stat-icon {
  width:34px;
  height:34px;
  flex:0 0 34px;
  display:grid;
  place-items:center;
  border-radius:9px;
  color:var(--stat-accent,var(--ks-gold));
  background:var(--stat-bg,rgba(245,158,11,.10));
}
.ks-stat-content {
  min-width:0;
  flex:1;
}
.ks-stat-label {
  display:block;
  margin-bottom:5px;
  color:var(--ks-secondary);
  font-size:10px;
  font-weight:650;
  line-height:1.4;
}
.ks-stat-value {
  display:block;
  color:#fff;
  font-size:clamp(19px,1.7vw,23px);
  font-weight:850;
  line-height:1.1;
  letter-spacing:-.35px;
}
.ks-stat-hint {
  display:block;
  margin-top:5px;
  color:var(--ks-muted);
  font-size:9px;
  line-height:1.4;
}
.ks-toolbar {
  display:grid;
  grid-template-columns:
    minmax(0,1.5fr)
    minmax(0,1fr)
    minmax(0,1fr)
    auto;
  gap:9px;
  align-items:center;
  width:100%;
  padding:11px;
  margin-bottom:13px;
  background:var(--ks-dark);
  border:1px solid var(--ks-border);
  border-radius:11px;
}
.ks-search,
.ks-select-wrap {
  position:relative;
}
.ks-search > svg {
  position:absolute;
  top:11px;
  left:11px;
  color:var(--ks-secondary);
  pointer-events:none;
}
.ks-select-wrap > svg {
  position:absolute;
  top:12px;
  right:10px;
  color:var(--ks-secondary);
  pointer-events:none;
}
.ks-input {
  display:block;
  width:100%;
  min-width:0;
  height:38px;
  border:1px solid var(--ks-border);
  border-radius:8px;
  background:var(--ks-bg);
  color:var(--ks-text);
  padding:0 11px;
  font-size:11px;
  outline:none;
  transition:border-color .2s,box-shadow .2s;
}
.ks-input:focus {
  border-color:var(--ks-gold);
  box-shadow:0 0 0 3px rgba(245,158,11,.09);
}
.ks-input::placeholder {
  color:var(--ks-muted);
}
.ks-search .ks-input {
  padding-left:35px;
}
.ks-select {
  appearance:none;
  padding-right:28px;
  cursor:pointer;
  color-scheme:dark;
  text-overflow:ellipsis;
}
.ks-table-card {
  width:100%;
  min-width:0;
  background:var(--ks-dark);
  border:1px solid var(--ks-border);
  border-radius:12px;
  overflow:hidden;
}
.ks-table-scroll {
  width:100%;
  min-width:0;
  overflow-x:auto;
  scrollbar-width:thin;
  scrollbar-color:var(--ks-border-light) transparent;
}
.ks-table {
  width:100%;
  min-width:710px;
  border-collapse:collapse;
  text-align:left;
}
.ks-table thead {
  background:var(--ks-surface);
}
.ks-table th {
  padding:13px 12px;
  font-size:10px;
  font-weight:750;
  color:var(--ks-secondary);
  white-space:nowrap;
}
.ks-table td {
  padding:10px 12px;
  border-top:1px solid var(--ks-border);
  font-size:11px;
  color:var(--ks-text);
  vertical-align:middle;
}
.ks-table tbody tr {
  transition:background .2s;
}
.ks-table tbody tr:hover {
  background:var(--ks-surface);
}
.ks-service-cell {
  display:flex;
  align-items:center;
  gap:10px;
  min-width:175px;
}
.ks-service-icon {
  width:39px;
  height:39px;
  flex:0 0 39px;
  display:grid;
  place-items:center;
  border-radius:9px;
  background:linear-gradient(
    135deg,
    rgba(245,158,11,.15),
    var(--ks-light)
  );
  border:1px solid rgba(245,158,11,.13);
  color:var(--ks-gold);
}
.ks-service-name {
  display:block;
  color:#fff;
  font-size:11px;
  font-weight:800;
  margin-bottom:4px;
}
.ks-service-description {
  max-width:230px;
  color:var(--ks-secondary);
  font-size:10px;
  line-height:1.5;
  overflow-wrap:anywhere;
}
.ks-category {
  display:inline-flex;
  justify-content:center;
  padding:6px 10px;
  border-radius:20px;
  background:rgba(245,158,11,.10);
  color:#f6c66e;
  font-size:10px;
  font-weight:750;
  white-space:nowrap;
}
.ks-duration {
  display:inline-flex;
  align-items:center;
  gap:6px;
  color:var(--ks-secondary);
  white-space:nowrap;
}
.ks-price {
  color:#fff;
  font-size:11px;
  font-weight:850;
  white-space:nowrap;
}
.ks-status {
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:6px 10px;
  border-radius:20px;
  font-size:10px;
  font-weight:750;
  white-space:nowrap;
}
.ks-status::before {
  content:"";
  width:6px;
  height:6px;
  border-radius:50%;
  background:currentColor;
}
.ks-status.active {
  color:var(--ks-success);
  background:rgba(34,197,94,.1);
}
.ks-status.inactive {
  color:var(--ks-secondary);
  background:var(--ks-light);
}
.ks-row-actions {
  display:flex;
  align-items:center;
  gap:7px;
}
.ks-icon-button {
  display:grid;
  place-items:center;
  width:33px;
  height:33px;
  flex:0 0 33px;
  border-radius:8px;
  border:1px solid var(--ks-border);
  background:var(--ks-surface);
  color:var(--ks-secondary);
}
.ks-icon-button:hover:not(:disabled) {
  color:var(--ks-gold);
  border-color:var(--ks-gold);
}
.ks-edit-button {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  min-height:33px;
  padding:0 10px;
  border-radius:8px;
  border:1px solid rgba(245,158,11,.38);
  background:rgba(245,158,11,.07);
  color:#fff;
  font-size:10px;
  font-weight:750;
  white-space:nowrap;
}
.ks-edit-button svg {
  color:var(--ks-gold);
}
.ks-edit-button:hover:not(:disabled) {
  border-color:var(--ks-gold);
}
.ks-table-footer {
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:10px;
  padding:11px 14px;
  border-top:1px solid var(--ks-border);
  color:var(--ks-secondary);
  font-size:10px;
}
.ks-pagination {
  display:flex;
  align-items:center;
  gap:5px;
}
.ks-page {
  display:grid;
  place-items:center;
  width:30px;
  height:30px;
  border:1px solid var(--ks-border);
  border-radius:7px;
  background:var(--ks-surface);
  color:var(--ks-text);
  font-size:10px;
}
.ks-page.current {
  background:var(--ks-gold);
  color:#000;
  border-color:var(--ks-gold);
  font-weight:850;
}
.ks-notice {
  display:flex;
  align-items:flex-start;
  gap:9px;
  margin-bottom:13px;
  padding:11px 13px;
  border-radius:9px;
  font-size:11px;
  line-height:1.6;
}
.ks-notice.success {
  color:#91ecb0;
  background:rgba(34,197,94,.08);
  border:1px solid rgba(34,197,94,.30);
}
.ks-notice.error {
  color:#f8b5b5;
  background:rgba(239,68,68,.08);
  border:1px solid rgba(239,68,68,.30);
}
.ks-empty {
  min-height:250px;
  padding:32px 16px;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  text-align:center;
}
.ks-empty-icon {
  display:grid;
  place-items:center;
  width:58px;
  height:58px;
  margin-bottom:14px;
  border-radius:16px;
  background:rgba(245,158,11,.10);
  border:1px solid rgba(245,158,11,.17);
  color:var(--ks-gold);
}
.ks-empty strong {
  font-size:14px;
  font-weight:800;
  color:#fff;
  margin-bottom:7px;
}
.ks-empty p {
  max-width:400px;
  margin:0 0 14px;
  color:var(--ks-secondary);
  font-size:11px;
  line-height:1.7;
}
.ks-trust {
  display:flex;
  align-items:center;
  gap:8px;
  margin-top:13px;
  color:var(--ks-muted);
  font-size:10px;
  line-height:1.6;
}
.ks-trust svg {
  color:var(--ks-gold);
  flex-shrink:0;
}
.ks-overlay {
  position:fixed;
  inset:0;
  z-index:2000;
  padding:16px;
  background:rgba(0,0,0,.8);
  backdrop-filter:blur(7px);
  display:grid;
  place-items:center;
}
.ks-modal {
  width:min(100%,570px);
  max-height:calc(100dvh - 32px);
  overflow-y:auto;
  background:var(--ks-surface);
  border:1px solid var(--ks-border-light);
  border-radius:16px;
  padding:22px;
  box-shadow:0 24px 70px rgba(0,0,0,.68);
}
.ks-modal-header {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  padding-bottom:17px;
  border-bottom:1px solid var(--ks-border);
  margin-bottom:19px;
}
.ks-modal-kicker {
  color:var(--ks-gold);
  display:block;
  margin-bottom:8px;
  letter-spacing:1.5px;
  font-size:10px;
  font-weight:800;
  text-transform:uppercase;
}
.ks-modal-header h2 {
  color:#fff;
  font-size:20px;
  margin:0 0 7px;
  letter-spacing:-.4px;
}
.ks-modal-header p {
  color:var(--ks-secondary);
  font-size:11px;
  line-height:1.7;
  margin:0;
}
.ks-form {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:16px;
}
.ks-field {
  display:flex;
  flex-direction:column;
  gap:8px;
  color:#f3f3f5;
  font-size:11px;
  font-weight:750;
}
.ks-field.full {
  grid-column:1/-1;
}
.ks-field textarea {
  height:auto;
  min-height:94px;
  padding-top:11px;
  resize:vertical;
}
.ks-form-error {
  grid-column:1/-1;
  padding:11px;
  border-radius:9px;
  background:rgba(239,68,68,.08);
  border:1px solid rgba(239,68,68,.28);
  color:#f9a8a8;
  font-size:11px;
  line-height:1.6;
}
.ks-form-footer {
  grid-column:1/-1;
  display:flex;
  justify-content:flex-end;
  gap:9px;
  border-top:1px solid var(--ks-border);
  padding-top:15px;
}
@container (max-width:1080px) {
  .ks-stats {
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
  .ks-toolbar {
    grid-template-columns:
      minmax(0,1.3fr)
      minmax(0,1fr)
      minmax(0,1fr);
  }
  .ks-toolbar > .ks-btn {
    grid-column:1/-1;
    justify-self:end;
  }
}
@container (max-width:760px) {
  .ks-header {
    gap:12px;
  }
  .ks-header-actions {
    margin-top:5px;
  }
  .ks-toolbar {
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
  .ks-search {
    grid-column:1/-1;
  }
  .ks-toolbar > .ks-btn {
    grid-column:auto;
    justify-self:stretch;
  }
}
@container (max-width:490px) {
  .ks-header {
    flex-direction:column;
  }
  .ks-heading {
    flex:none;
    width:100%;
  }
  .ks-header-actions {
    width:100%;
    margin-top:5px;
  }
  .ks-header-actions .ks-btn {
    flex:1 1 auto;
  }
  .ks-stats {
    gap:8px;
  }
  .ks-stat {
    min-height:88px;
    gap:8px;
    padding:10px;
  }
  .ks-stat-icon {
    width:29px;
    height:29px;
    flex-basis:29px;
  }
  .ks-stat-value {
    font-size:20px;
  }
  .ks-stat-label {
    font-size:9px;
  }
  .ks-stat-hint {
    font-size:8px;
  }
  .ks-toolbar {
    grid-template-columns:1fr;
  }
  .ks-search,
  .ks-toolbar > .ks-btn {
    grid-column:auto;
  }
  .ks-form {
    grid-template-columns:1fr;
  }
  .ks-field.full,
  .ks-form-error,
  .ks-form-footer {
    grid-column:1;
  }
  .ks-modal {
    padding:17px;
  }
}
@container (max-width:345px) {
  .ks-stats {
    grid-template-columns:1fr;
  }
}
@media(max-width:560px) {
  .ks-page-spacing {
    padding:20px 15px 8px;
  }
}
@media(prefers-reduced-motion:reduce) {
  .ks-premium *,
  .ks-premium *::before,
  .ks-premium *::after {
    transition:none!important;
    animation:none!important;
  }
}
`;

/* ============================================================
   SERVICES PAGE
============================================================ */

export default function ServicesPage() {
  const navigate = useNavigate();

  const [services, setServices] =
    useState<BarberService[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] =
    useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] =
    useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] =
    useState<string | null>(null);
  const [form, setForm] = useState<ServiceForm>({
    ...EMPTY_FORM,
  });

  const [notice, setNotice] =
    useState<Notice | null>(null);
  const [formError, setFormError] = useState("");

  const loadServices = useCallback(async () => {
    setLoading(true);

    try {
      const response = await getBarberServices(false);

      if (!Array.isArray(response.services)) {
        throw new Error("Invalid services API response.");
      }

      setServices(response.services);
      setLoaded(true);
      setNotice((current) =>
        current?.type === "error" ? null : current
      );
    } catch (error) {
      setNotice({
        type: "error",
        message: getError(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const activeCount = useMemo(
    () =>
      services.filter((service) => service.is_active)
        .length,
    [services]
  );

  const inactiveCount = services.length - activeCount;

  const averageDuration = useMemo(() => {
    if (services.length === 0) return 0;

    const total = services.reduce(
      (sum, service) => sum + service.duration_minutes,
      0
    );

    return Math.round(total / services.length);
  }, [services]);

  const stats = [
    {
      label: "Total Services",
      value: services.length,
      hint: "Services in your shop",
      icon: Scissors,
      accent: COLORS.primary,
      bg: "rgba(245,158,11,.10)",
    },
    {
      label: "Active Services",
      value: activeCount,
      hint: "Currently enabled",
      icon: CheckCircle2,
      accent: COLORS.success,
      bg: "rgba(34,197,94,.10)",
    },
    {
      label: "Inactive Services",
      value: inactiveCount,
      hint: "Temporarily disabled",
      icon: Activity,
      accent: COLORS.textSecondary,
      bg: "rgba(158,158,167,.10)",
    },
    {
      label: "Average Duration",
      value: `${averageDuration} min`,
      hint: "Based on your services",
      icon: Clock3,
      accent: COLORS.primary,
      bg: "rgba(245,158,11,.10)",
    },
  ];

  const filteredServices = useMemo(() => {
    const term = search.trim().toLowerCase();

    return services.filter((service) => {
      const matchesSearch =
        !term ||
        service.service_name.toLowerCase().includes(term) ||
        (service.description || "")
          .toLowerCase()
          .includes(term);

      const matchesCategory =
        category === "all" ||
        getCategory(service.service_name).key === category;

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && service.is_active) ||
        (statusFilter === "inactive" && !service.is_active);

      return (
        matchesSearch &&
        matchesCategory &&
        matchesStatus
      );
    });
  }, [services, search, category, statusFilter]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredServices.length / PAGE_SIZE)
  );

  const currentPage = Math.min(page, totalPages);

  const visibleServices = filteredServices.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const startIndex =
    filteredServices.length === 0
      ? 0
      : (currentPage - 1) * PAGE_SIZE + 1;

  const endIndex = Math.min(
    currentPage * PAGE_SIZE,
    filteredServices.length
  );

  const resetFilters = () => {
    setSearch("");
    setCategory("all");
    setStatusFilter("all");
    setPage(1);
  };

  const openAddModal = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormError("");
    setNotice(null);
    setShowModal(true);
  };

  const openEditModal = (service: BarberService) => {
    setEditingId(service.id);
    setForm({
      service_name: service.service_name,
      description: service.description || "",
      duration_minutes: String(service.duration_minutes),
      price: String(service.price),
    });
    setFormError("");
    setNotice(null);
    setShowModal(true);
  };

  const closeModal = () => {
    if (saving) return;

    setShowModal(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormError("");
  };

  const updateField = (
    field: keyof ServiceForm,
    value: string
  ) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
    setFormError("");
  };

  const saveService = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (saving || busyId) return;

    setFormError("");

    let payload: ServicePayload;

    try {
      payload = validateForm(form);
    } catch (error) {
      setFormError(getError(error));
      return;
    }

    setSaving(true);

    try {
      const result = editingId
        ? await updateBarberService(editingId, payload)
        : await createBarberService(payload);

      setServices((current) => {
        const exists = current.some(
          (service) => service.id === result.service.id
        );

        if (exists) {
          return current.map((service) =>
            service.id === result.service.id
              ? result.service
              : service
          );
        }

        return [...current, result.service];
      });

      setLoaded(true);
      setShowModal(false);
      setEditingId(null);
      setForm({ ...EMPTY_FORM });

      setNotice({
        type: "success",
        message: result.message,
      });

      try {
        const response = await getBarberServices(false);

        if (Array.isArray(response.services)) {
          setServices(response.services);
        }
      } catch {
        // Keep the successfully saved service visible.
      }
    } catch (error) {
      setFormError(getError(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (
    service: BarberService
  ) => {
    if (saving || busyId) return;

    const nextStatus = !service.is_active;

    const confirmed = window.confirm(
      nextStatus
        ? `Activate "${service.service_name}"?`
        : `Deactivate "${service.service_name}"? Customers will not be able to select it for new bookings.`
    );

    if (!confirmed) return;

    setBusyId(service.id);
    setNotice(null);

    try {
      const result = await setBarberServiceStatus(
        service.id,
        nextStatus
      );

      setServices((current) =>
        current.map((item) =>
          item.id === result.service.id
            ? result.service
            : item
        )
      );

      setNotice({
        type: "success",
        message: result.message,
      });

      try {
        const response = await getBarberServices(false);

        if (Array.isArray(response.services)) {
          setServices(response.services);
        }
      } catch {
        // Keep the confirmed status response visible.
      }
    } catch (error) {
      setNotice({
        type: "error",
        message: getError(error),
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="ks-page-spacing">
      <div className="ks-premium">
        <style>{styles}</style>

        <header className="ks-header">
          <div className="ks-heading">
            <span className="ks-eyebrow">
              SHOP SERVICE MANAGEMENT
            </span>
            <h1>Services</h1>
            <p>
              Manage your shop services, pricing and
              availability.
            </p>
          </div>

          <div className="ks-header-actions">
            <button
              type="button"
              className="ks-btn"
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft size={15} />
              Dashboard
            </button>

            <button
              type="button"
              className="ks-btn"
              disabled={
                loading || saving || Boolean(busyId)
              }
              onClick={() => void loadServices()}
            >
              <RefreshCw
                size={15}
                className={loading ? "ks-spinner" : ""}
              />
              Refresh
            </button>

            <button
              type="button"
              className="ks-btn ks-btn-primary"
              disabled={saving || Boolean(busyId)}
              onClick={openAddModal}
            >
              <Plus size={15} />
              Add Service
            </button>
          </div>
        </header>

        {notice && (
          <div
            className={`ks-notice ${notice.type}`}
            role={
              notice.type === "error" ? "alert" : "status"
            }
          >
            {notice.type === "success" ? (
              <CheckCircle2 size={16} />
            ) : (
              <AlertCircle size={16} />
            )}
            <span>{notice.message}</span>
          </div>
        )}

        <section className="ks-stats">
          {stats.map((stat) => {
            const Icon = stat.icon;

            return (
              <article
                key={stat.label}
                className="ks-stat"
                style={
                  {
                    "--stat-accent": stat.accent,
                    "--stat-bg": stat.bg,
                  } as CSSProperties
                }
              >
                <span className="ks-stat-icon">
                  <Icon size={17} strokeWidth={1.9} />
                </span>

                <div className="ks-stat-content">
                  <span className="ks-stat-label">
                    {stat.label}
                  </span>
                  <strong className="ks-stat-value">
                    {!loaded ? "—" : stat.value}
                  </strong>
                  <span className="ks-stat-hint">
                    {stat.hint}
                  </span>
                </div>
              </article>
            );
          })}
        </section>

        <section className="ks-toolbar">
          <div className="ks-search">
            <Search size={16} />
            <input
              className="ks-input"
              type="search"
              aria-label="Search services"
              placeholder="Search services..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="ks-select-wrap">
            <select
              className="ks-input ks-select"
              aria-label="Filter by category"
              value={category}
              onChange={(event) => {
                setCategory(
                  event.target.value as CategoryFilter
                );
                setPage(1);
              }}
            >
              <option value="all">All Categories</option>
              <option value="haircut">Haircut</option>
              <option value="beard">Beard</option>
              <option value="shave">Shaving</option>
              <option value="facial">Facial</option>
              <option value="haircare">Hair Care</option>
              <option value="package">Package</option>
              <option value="other">Other</option>
            </select>
            <ChevronDown size={13} />
          </div>

          <div className="ks-select-wrap">
            <select
              className="ks-input ks-select"
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(
                  event.target.value as StatusFilter
                );
                setPage(1);
              }}
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <ChevronDown size={13} />
          </div>

          <button
            type="button"
            className="ks-btn"
            onClick={resetFilters}
          >
            <RotateCcw size={14} />
            Reset
          </button>
        </section>

        <section className="ks-table-card">
          {!loaded ? (
            <div className="ks-empty">
              <span className="ks-empty-icon">
                {loading ? (
                  <RefreshCw
                    size={26}
                    className="ks-spinner"
                  />
                ) : (
                  <AlertCircle size={26} />
                )}
              </span>

              <strong>
                {loading
                  ? "Loading your services"
                  : "Unable to load services"}
              </strong>

              <p>
                {loading
                  ? "Fetching your shop's service catalogue."
                  : "Check your backend connection and try again."}
              </p>

              {!loading && (
                <button
                  type="button"
                  className="ks-btn"
                  onClick={() => void loadServices()}
                >
                  <RefreshCw size={14} />
                  Try Again
                </button>
              )}
            </div>
          ) : filteredServices.length === 0 ? (
            <div className="ks-empty">
              <span className="ks-empty-icon">
                <Scissors size={27} />
              </span>

              <strong>
                {services.length === 0
                  ? "No services added yet"
                  : "No matching services"}
              </strong>

              <p>
                {services.length === 0
                  ? "Add the services your shop actually offers, with real pricing and duration."
                  : "Change your search or reset the filters."}
              </p>

              {services.length === 0 && (
                <button
                  type="button"
                  className="ks-btn ks-btn-primary"
                  onClick={openAddModal}
                >
                  <Plus size={15} />
                  Add First Service
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="ks-table-scroll">
                <table className="ks-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Category</th>
                      <th>Duration</th>
                      <th>Price</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleServices.map((service) => {
                      const categoryInfo = getCategory(
                        service.service_name
                      );

                      return (
                        <tr key={service.id}>
                          <td>
                            <div className="ks-service-cell">
                              <span className="ks-service-icon">
                                <Scissors size={19} />
                              </span>

                              <div>
                                <strong className="ks-service-name">
                                  {service.service_name}
                                </strong>

                                <div className="ks-service-description">
                                  {service.description ||
                                    "No description provided"}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td>
                            <span className="ks-category">
                              {categoryInfo.label}
                            </span>
                          </td>

                          <td>
                            <span className="ks-duration">
                              <Clock3 size={13} />
                              {service.duration_minutes} min
                            </span>
                          </td>

                          <td>
                            <strong className="ks-price">
                              {formatPrice(service.price)}
                            </strong>
                          </td>

                          <td>
                            <span
                              className={`ks-status ${
                                service.is_active
                                  ? "active"
                                  : "inactive"
                              }`}
                            >
                              {service.is_active
                                ? "Active"
                                : "Inactive"}
                            </span>
                          </td>

                          <td>
                            <div className="ks-row-actions">
                              <button
                                type="button"
                                className="ks-edit-button"
                                disabled={
                                  saving || Boolean(busyId)
                                }
                                onClick={() =>
                                  openEditModal(service)
                                }
                              >
                                <Edit3 size={13} />
                                Edit
                              </button>

                              <button
                                type="button"
                                className="ks-icon-button"
                                disabled={
                                  saving || Boolean(busyId)
                                }
                                onClick={() =>
                                  void toggleStatus(service)
                                }
                                aria-label={
                                  service.is_active
                                    ? `Deactivate ${service.service_name}`
                                    : `Activate ${service.service_name}`
                                }
                                title={
                                  service.is_active
                                    ? "Deactivate service"
                                    : "Activate service"
                                }
                              >
                                {busyId === service.id ? (
                                  <RefreshCw
                                    size={15}
                                    className="ks-spinner"
                                  />
                                ) : service.is_active ? (
                                  <MoreHorizontal size={17} />
                                ) : (
                                  <CheckCircle2 size={16} />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="ks-table-footer">
                <span>
                  Showing {startIndex}–{endIndex} of{" "}
                  {filteredServices.length} services
                </span>

                <div className="ks-pagination">
                  <button
                    type="button"
                    className="ks-page"
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                    onClick={() =>
                      setPage((value) =>
                        Math.max(1, value - 1)
                      )
                    }
                  >
                    <ChevronLeft size={14} />
                  </button>

                  <span className="ks-page current">
                    {currentPage}
                  </span>

                  <button
                    type="button"
                    className="ks-page"
                    disabled={currentPage >= totalPages}
                    aria-label="Next page"
                    onClick={() =>
                      setPage((value) =>
                        Math.min(totalPages, value + 1)
                      )
                    }
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        <div className="ks-trust">
          <ShieldCheck size={14} />
          Services are managed under your authenticated
          barber account.
        </div>

        {showModal && (
          <div
            className="ks-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeModal();
              }
            }}
          >
            <section
              className="ks-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ks-modal-title"
            >
              <div className="ks-modal-header">
                <div>
                  <span className="ks-modal-kicker">
                    <Sparkles
                      size={12}
                      style={{
                        display: "inline",
                        marginRight: 6,
                      }}
                    />
                    Service Configuration
                  </span>

                  <h2 id="ks-modal-title">
                    {editingId
                      ? "Edit Service"
                      : "Add New Service"}
                  </h2>

                  <p>
                    Configure the actual price and duration
                    for your shop.
                  </p>
                </div>

                <button
                  type="button"
                  className="ks-icon-button"
                  aria-label="Close modal"
                  onClick={closeModal}
                  disabled={saving}
                >
                  <X size={18} />
                </button>
              </div>

              <form
                className="ks-form"
                onSubmit={saveService}
              >
                {formError && (
                  <div
                    className="ks-form-error"
                    role="alert"
                  >
                    {formError}
                  </div>
                )}

                <label className="ks-field full">
                  Service Name *

                  <input
                    className="ks-input"
                    type="text"
                    placeholder="e.g. Classic Haircut"
                    value={form.service_name}
                    maxLength={150}
                    required
                    onChange={(event) =>
                      updateField(
                        "service_name",
                        event.target.value
                      )
                    }
                  />
                </label>

                <label className="ks-field">
                  Service Price (₹) *

                  <input
                    className="ks-input"
                    type="number"
                    placeholder="Enter actual price"
                    min={0}
                    max={9999999999.99}
                    step="0.01"
                    required
                    value={form.price}
                    onChange={(event) =>
                      updateField(
                        "price",
                        event.target.value
                      )
                    }
                  />
                </label>

                <label className="ks-field">
                  Duration (minutes) *

                  <input
                    className="ks-input"
                    type="number"
                    placeholder="Enter duration"
                    min={5}
                    max={480}
                    step={1}
                    required
                    value={form.duration_minutes}
                    onChange={(event) =>
                      updateField(
                        "duration_minutes",
                        event.target.value
                      )
                    }
                  />
                </label>

                <label className="ks-field full">
                  Service Description

                  <textarea
                    className="ks-input"
                    placeholder="Describe what the customer receives..."
                    maxLength={2000}
                    value={form.description}
                    onChange={(event) =>
                      updateField(
                        "description",
                        event.target.value
                      )
                    }
                  />
                </label>

                <div className="ks-form-footer">
                  <button
                    type="button"
                    className="ks-btn"
                    disabled={saving}
                    onClick={closeModal}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="ks-btn ks-btn-primary"
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <RefreshCw
                          size={15}
                          className="ks-spinner"
                        />
                        Saving...
                      </>
                    ) : editingId ? (
                      <>
                        <Edit3 size={15} />
                        Save Changes
                      </>
                    ) : (
                      <>
                        <Plus size={15} />
                        Add Service
                      </>
                    )}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}