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
  ArrowRight,
  ArrowUpRight,
  CalendarCheck2,
  CalendarDays,
  ChevronLeft,
  Clock3,
  Heart,
  History,
  IndianRupee,
  Phone,
  RefreshCw,
  Repeat2,
  Search,
  Scissors,
  ShieldCheck,
  UsersRound,
  UserRoundPlus,
  X,
} from "lucide-react";

import {
  getShopCustomers,
  getShopCustomerDetails,
  type CustomerDetailResponse,
  type CustomerProfile,
  type CustomerRelationship,
  type CustomersResponse,
} from "../../services/customersApi";

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

type CustomerFilter = "all" | CustomerRelationship;

const EMPTY_SUMMARY = {
  total_customers: 0,
  returning_customers: 0,
  new_this_month: 0,
  regular_customers: 0,
  inactive_customers: 0,
  retention_rate: 0,
};

const FILTERS: {
  value: CustomerFilter;
  label: string;
}[] = [
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

const CSS = `
.pcust-page {
  --pc-gold:${COLORS.primary};
  --pc-bg:${COLORS.background};
  --pc-surface:${COLORS.surface};
  --pc-raised:${COLORS.surfaceLight};
  --pc-dark:${COLORS.surfaceDark};
  --pc-thumbnail:${COLORS.thumbnail};
  --pc-border:${COLORS.border};
  --pc-border-light:${COLORS.borderLight};
  --pc-text:${COLORS.text};
  --pc-secondary:${COLORS.textSecondary};
  --pc-muted:${COLORS.textMuted};
  --pc-success:${COLORS.success};
  --pc-error:${COLORS.error};
  width:100%;
  max-width:100%;
  min-width:0;
  min-height:100%;
  margin:0;
  padding:28px clamp(18px,3vw,40px) 36px;
  background:var(--pc-bg);
  color:var(--pc-text);
  font-family:Inter,"Segoe UI",Arial,sans-serif;
  font-size:13px;
  line-height:1.5;
  color-scheme:dark;
}
.pcust-page *,
.pcust-page *::before,
.pcust-page *::after {
  box-sizing:border-box;
}
.pcust-page :is(button,input) { font:inherit; }
.pcust-page button { cursor:pointer; }
.pcust-page button:disabled { opacity:.55; cursor:not-allowed; }
.pcust-page :is(button,input,a):focus-visible {
  outline:2px solid var(--pc-gold);
  outline-offset:4px;
}
.pcust-page svg { flex-shrink:0; }
.pcust-shell {
  width:100%;
  max-width:1440px;
  min-width:0;
  margin:0 auto;
}
.pcust-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:20px;
  margin-bottom:23px;
}
.pcust-eyebrow {
  display:flex;
  align-items:center;
  gap:8px;
  margin-bottom:9px;
  color:var(--pc-gold);
  font-size:10px;
  font-weight:750;
  letter-spacing:1.6px;
  text-transform:uppercase;
}
.pcust-eyebrow::before {
  content:"";
  width:20px;
  height:2px;
  border-radius:2px;
  background:var(--pc-gold);
}
.pcust-heading h1 {
  margin:0 0 7px;
  font-size:clamp(25px,2.5vw,33px);
  font-weight:750;
  letter-spacing:-.9px;
  line-height:1.2;
}
.pcust-heading p {
  margin:0;
  color:var(--pc-secondary);
  font-size:12px;
}
.pcust-actions { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
.pcust-page .pcust-button {
  position:static;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  width:auto;
  min-height:39px;
  margin:0;
  padding:9px 13px;
  border:1px solid var(--pc-border-light);
  border-radius:9px;
  background:var(--pc-raised);
  color:var(--pc-text);
  font-size:11px;
  font-weight:650;
  line-height:1.3;
  white-space:nowrap;
  text-decoration:none;
  transition:border-color .2s,background .2s;
}
.pcust-page .pcust-button:hover:not(:disabled) {
  border-color:var(--pc-gold);
  background:var(--pc-thumbnail);
}
.pcust-page .pcust-button-gold,
.pcust-page .pcust-button-gold:hover:not(:disabled) {
  border-color:var(--pc-gold);
  background:var(--pc-gold);
  color:${COLORS.black};
}

/* Compact summary cards with Notifications-style hover. */
.pcust-stats {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:13px;
  margin-bottom:22px;
}
.pcust-stat {
  position:relative;
  min-width:0;
  min-height:138px;
  overflow:hidden;
  padding:16px;
  border:1px solid var(--pc-border);
  border-radius:13px;
  background:linear-gradient(
    140deg,
    var(--pc-raised),
    var(--pc-surface),
    var(--pc-dark)
  );
  box-shadow:0 8px 22px rgba(0,0,0,.12);
  transition:border-color .2s,transform .2s,box-shadow .2s;
}
.pcust-stat:hover {
  transform:translateY(-2px);
  border-color:rgba(245,158,11,.5);
  box-shadow:0 5px 18px rgba(0,0,0,.18);
}
.pcust-stat::after {
  content:"";
  position:absolute;
  left:16px;
  bottom:0;
  width:32px;
  height:2px;
  border-radius:2px;
  background:var(--pc-gold);
  opacity:.7;
}
.pcust-stat-top {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-bottom:12px;
}
.pcust-stat-overline {
  color:var(--pc-muted);
  font-size:8px;
  font-weight:700;
  letter-spacing:.9px;
}
.pcust-stat-icon {
  display:grid;
  place-items:center;
  flex-shrink:0;
  width:32px;
  height:32px;
  border:1px solid rgba(245,158,11,.22);
  border-radius:9px;
  background:rgba(245,158,11,.08);
  color:var(--pc-gold);
}
.pcust-stat-value {
  display:block;
  margin-bottom:7px;
  font-size:27px;
  font-weight:750;
  line-height:1.1;
  letter-spacing:-.8px;
}
.pcust-stat h3 { margin:0 0 4px; font-size:11px; font-weight:650; }
.pcust-stat p { margin:0; color:var(--pc-muted); font-size:9px; line-height:1.5; }
.pcust-directory {
  min-width:0;
  overflow:hidden;
  border:1px solid var(--pc-border);
  border-radius:16px;
  background:var(--pc-surface);
  box-shadow:0 14px 36px rgba(0,0,0,.15);
}
.pcust-directory-head {
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:16px;
  padding:21px 22px;
  border-bottom:1px solid var(--pc-border);
  background:var(--pc-surface);
}
.pcust-directory-head h2 {
  margin:0 0 6px;
  font-size:20px;
  font-weight:700;
  letter-spacing:-.5px;
}
.pcust-directory-head p { margin:0; color:var(--pc-secondary); font-size:11px; }
.pcust-count {
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:9px 12px;
  border:1px solid rgba(245,158,11,.22);
  border-radius:9px;
  background:rgba(245,158,11,.08);
  color:var(--pc-gold);
  font-size:11px;
}
.pcust-count strong { font-size:14px; }
.pcust-toolbar {
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:14px;
  padding:18px 22px 14px;
}
.pcust-search {
  display:flex;
  align-items:center;
  gap:10px;
  width:min(100%,460px);
  min-height:41px;
  padding:0 12px;
  border:1px solid var(--pc-border-light);
  border-radius:9px;
  background:var(--pc-dark);
  color:var(--pc-gold);
}
.pcust-search:focus-within {
  border-color:var(--pc-gold);
  box-shadow:0 0 0 3px rgba(245,158,11,.08);
}
.pcust-search input {
  flex:1;
  width:100%;
  min-width:0;
  height:39px;
  padding:0;
  border:0;
  outline:none;
  background:transparent;
  color:var(--pc-text);
  font-size:11px;
}
.pcust-search input::placeholder { color:var(--pc-muted); }
.pcust-page .pcust-clear {
  display:grid;
  place-items:center;
  flex-shrink:0;
  width:25px;
  height:25px;
  margin:0;
  padding:0;
  border:0;
  border-radius:6px;
  background:transparent;
  color:var(--pc-secondary);
}
.pcust-security { display:flex; align-items:center; gap:7px; color:var(--pc-muted); font-size:10px; }
.pcust-security svg { color:var(--pc-success); }
.pcust-filter-row {
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:14px;
  padding:0 22px 18px;
}
.pcust-filters { display:flex; flex-wrap:wrap; gap:7px; }
.pcust-page .pcust-filter {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  min-height:32px;
  margin:0;
  padding:6px 11px;
  border:1px solid var(--pc-border-light);
  border-radius:9px;
  background:var(--pc-raised);
  color:var(--pc-secondary);
  font-size:10px;
  font-weight:600;
}
.pcust-page .pcust-filter.active {
  border-color:var(--pc-gold);
  background:var(--pc-gold);
  color:${COLORS.black};
}
.pcust-filter span {
  display:grid;
  place-items:center;
  min-width:19px;
  height:19px;
  padding:0 4px;
  border-radius:5px;
  background:rgba(0,0,0,.12);
  font-size:9px;
}
.pcust-results { color:var(--pc-muted); font-size:10px; }
.pcust-list { display:flex; flex-direction:column; gap:10px; padding:0 22px 21px; }

/* Compact customer rows; only the outline/shadow changes on hover. */
.pcust-page .pcust-row {
  display:grid;
  grid-template-columns:
    minmax(180px,1.5fr)
    minmax(90px,.8fr)
    minmax(95px,.8fr)
    minmax(108px,.9fr)
    minmax(105px,1fr)
    30px;
  align-items:center;
  gap:14px;
  width:100%;
  min-width:0;
  min-height:88px;
  margin:0;
  padding:14px 16px;
  border:1px solid var(--pc-border-light);
  border-radius:11px;
  background:linear-gradient(115deg,var(--pc-raised),var(--pc-surface));
  color:var(--pc-text);
  font:inherit;
  text-align:left;
  transition:border-color .2s,box-shadow .2s;
}
.pcust-page .pcust-row:hover,
.pcust-page .pcust-row:focus-visible {
  border-color:rgba(245,158,11,.5);
  box-shadow:0 5px 18px rgba(0,0,0,.18);
}
.pcust-person { display:flex; align-items:center; gap:10px; min-width:0; }
.pcust-avatar {
  display:grid;
  place-items:center;
  flex:0 0 41px;
  width:41px;
  height:41px;
  overflow:hidden;
  border:1px solid rgba(245,158,11,.3);
  border-radius:11px;
  background:linear-gradient(145deg,var(--pc-raised),var(--pc-dark));
  color:var(--pc-gold);
  font-size:13px;
  font-weight:700;
}
.pcust-avatar img { display:block; width:100%; height:100%; object-fit:cover; }
.pcust-avatar-large { flex-basis:76px; width:76px; height:76px; border-radius:22px; font-size:25px; }
.pcust-person-info { min-width:0; }
.pcust-name {
  display:block;
  overflow:hidden;
  margin-bottom:4px;
  font-size:12px;
  font-weight:700;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.pcust-phone { display:flex; align-items:center; gap:5px; margin-bottom:5px; color:var(--pc-secondary); font-size:10px; }
.pcust-phone span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pcust-badge {
  display:inline-flex;
  align-items:center;
  gap:5px;
  width:fit-content;
  padding:2px 6px;
  border:1px solid var(--pc-border-light);
  border-radius:6px;
  background:var(--pc-raised);
  color:var(--pc-secondary);
  font-size:9px;
  font-weight:600;
  line-height:1.4;
  white-space:nowrap;
}
.pcust-badge::before { content:""; width:4px; height:4px; border-radius:50%; background:currentColor; }
.pcust-badge.new,
.pcust-badge.regular { border-color:rgba(245,158,11,.3); background:rgba(245,158,11,.08); color:var(--pc-gold); }
.pcust-badge.returning { border-color:rgba(34,197,94,.3); background:rgba(34,197,94,.08); color:var(--pc-success); }
.pcust-badge.inactive { color:var(--pc-muted); }
.pcust-cell { display:flex; flex-direction:column; gap:6px; min-width:0; }
.pcust-cell-label { display:flex; align-items:center; gap:5px; color:var(--pc-muted); font-size:9px; white-space:nowrap; }
.pcust-cell-label svg { color:var(--pc-gold); }
.pcust-cell-value { overflow:hidden; color:var(--pc-text); font-size:11px; font-weight:650; text-overflow:ellipsis; white-space:nowrap; }
.pcust-money { color:var(--pc-gold); }
.pcust-open {
  display:grid;
  place-items:center;
  width:29px;
  height:29px;
  border:1px solid rgba(245,158,11,.22);
  border-radius:8px;
  background:rgba(245,158,11,.08);
  color:var(--pc-gold);
}
.pcust-empty { display:flex; align-items:center; justify-content:center; flex-direction:column; gap:12px; min-height:240px; padding:30px 22px; color:var(--pc-muted); text-align:center; }
.pcust-empty > svg { color:var(--pc-gold); }
.pcust-empty strong { color:var(--pc-text); font-size:15px; }
.pcust-empty span { max-width:390px; font-size:12px; }
.pcust-load-more { display:flex; justify-content:center; padding:0 22px 21px; }
.pcust-footer { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:18px 3px 0; color:var(--pc-muted); font-size:10px; }
.pcust-footer > span { display:flex; align-items:center; gap:7px; }
.pcust-error { display:flex; align-items:center; gap:10px; margin-bottom:20px; padding:14px; border:1px solid rgba(239,68,68,.3); border-radius:11px; background:rgba(239,68,68,.08); color:var(--pc-error); font-size:12px; }
.pcust-error span { flex:1; min-width:0; overflow-wrap:anywhere; }
.pcust-spin { animation:pcust-spin .9s linear infinite; }
@keyframes pcust-spin { to { transform:rotate(360deg); } }

/* Customer profile panel */
.pcust-overlay { position:fixed; inset:0; z-index:160; display:flex; justify-content:flex-end; padding:16px; background:${COLORS.overlay}; backdrop-filter:blur(7px); }
.pcust-panel { width:min(100%,570px); max-height:100%; overflow-y:auto; border:1px solid var(--pc-border-light); border-radius:20px; background:var(--pc-surface); color:var(--pc-text); box-shadow:0 20px 70px rgba(0,0,0,.45); scrollbar-width:thin; }
.pcust-panel-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:18px 21px; border-bottom:1px solid var(--pc-border); }
.pcust-page .pcust-close { display:grid; place-items:center; flex-shrink:0; width:33px; height:33px; margin:0; padding:0; border:1px solid var(--pc-border-light); border-radius:9px; background:var(--pc-raised); color:var(--pc-secondary); }
.pcust-panel-body { padding:24px; }
.pcust-profile { display:flex; align-items:center; flex-direction:column; padding:5px 0 23px; text-align:center; }
.pcust-profile-overline { margin-top:16px; color:var(--pc-muted); font-size:9px; letter-spacing:1.2px; }
.pcust-profile h2 { margin:8px 0 6px; font-size:25px; letter-spacing:-.5px; overflow-wrap:anywhere; }
.pcust-profile p { display:flex; align-items:center; gap:6px; margin:0 0 12px; color:var(--pc-secondary); font-size:12px; }
.pcust-profile-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-bottom:23px; }
.pcust-profile-metrics > div { display:flex; align-items:center; flex-direction:column; gap:8px; min-width:0; padding:15px 7px; border:1px solid var(--pc-border); border-radius:12px; background:var(--pc-dark); text-align:center; }
.pcust-profile-metrics svg { color:var(--pc-gold); }
.pcust-profile-metrics strong { max-width:100%; font-size:16px; overflow-wrap:anywhere; }
.pcust-profile-metrics span { color:var(--pc-muted); font-size:9px; }
.pcust-detail-section { margin-top:20px; padding:18px; border:1px solid var(--pc-border); border-radius:14px; background:var(--pc-dark); }
.pcust-section-heading { display:flex; align-items:center; gap:11px; margin-bottom:17px; }
.pcust-section-heading > svg { color:var(--pc-gold); }
.pcust-section-heading h3 { margin:0 0 3px; font-size:13px; }
.pcust-section-heading p { margin:0; color:var(--pc-muted); font-size:10px; }
.pcust-fact { display:flex; align-items:flex-start; justify-content:space-between; gap:15px; padding:11px 0; border-bottom:1px solid var(--pc-border); font-size:11px; }
.pcust-fact:last-child { padding-bottom:0; border-bottom:0; }
.pcust-fact > span { color:var(--pc-secondary); }
.pcust-fact strong { max-width:58%; font-weight:600; text-align:right; overflow-wrap:anywhere; }
.pcust-visit { position:relative; margin-left:5px; padding:0 0 20px 18px; border-left:1px solid var(--pc-border-light); }
.pcust-visit:last-child { padding-bottom:0; }
.pcust-visit::before { content:""; position:absolute; top:5px; left:-4px; width:7px; height:7px; border:2px solid var(--pc-dark); border-radius:50%; background:var(--pc-gold); }
.pcust-visit-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
.pcust-visit-heading strong { font-size:12px; }
.pcust-visit-status { padding:3px 7px; border:1px solid var(--pc-border-light); border-radius:6px; color:var(--pc-secondary); font-size:9px; text-transform:capitalize; }
.pcust-visit-status.completed { border-color:rgba(34,197,94,.3); color:var(--pc-success); }
.pcust-visit-status.cancelled,
.pcust-visit-status.rejected { border-color:rgba(239,68,68,.3); color:var(--pc-error); }
.pcust-visit-meta { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin:8px 0; color:var(--pc-muted); font-size:10px; }
.pcust-visit b { color:var(--pc-gold); font-size:11px; }
.pcust-visit small { display:block; margin-top:7px; color:var(--pc-secondary); overflow-wrap:anywhere; }
.pcust-notice { display:flex; align-items:flex-start; gap:8px; margin-top:20px; color:var(--pc-muted); font-size:10px; line-height:1.7; }
.pcust-notice svg { color:var(--pc-success); }

@media(max-width:1250px) {
  .pcust-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .pcust-page .pcust-row {
    grid-template-columns:minmax(160px,1.4fr) minmax(85px,.8fr) minmax(90px,.8fr) minmax(100px,.9fr) 30px;
    gap:12px;
  }
  .pcust-favorite { display:none; }
}
@media(max-width:900px) {
  .pcust-page .pcust-row { grid-template-columns:minmax(170px,1.4fr) 1fr 1fr 30px; }
  .pcust-last { grid-column:2; grid-row:2; }
  .pcust-favorite { display:flex; grid-column:3; grid-row:2; }
  .pcust-person { grid-row:1 / span 2; }
  .pcust-open { grid-column:4; grid-row:1 / span 2; }
}
@media(max-width:640px) {
  .pcust-page { padding:20px 15px 28px; }
  .pcust-heading { gap:17px; margin-bottom:20px; }
  .pcust-actions { width:100%; }
  .pcust-page .pcust-actions .pcust-button { flex:1; padding:10px; font-size:10px; }
  .pcust-stats { gap:10px; margin-bottom:18px; }
  .pcust-stat { min-height:128px; padding:12px; border-radius:11px; }
  .pcust-stat-top { gap:7px; margin-bottom:11px; }
  .pcust-stat-overline { font-size:8px; letter-spacing:.5px; }
  .pcust-stat-icon { width:28px; height:28px; border-radius:8px; }
  .pcust-stat-value { font-size:24px; }
  .pcust-stat h3 { font-size:10px; }
  .pcust-stat p { font-size:9px; }
  .pcust-directory { border-radius:14px; }
  .pcust-directory-head { padding:18px 15px; }
  .pcust-directory-head h2 { font-size:18px; }
  .pcust-toolbar { padding:15px; }
  .pcust-search { width:100%; }
  .pcust-filter-row { padding:0 15px 16px; }
  .pcust-list { gap:10px; padding:0 12px 16px; }
  .pcust-page .pcust-row {
    position:relative;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:14px 12px;
    min-height:0;
    padding:14px;
  }
  .pcust-person {
    grid-column:1/-1;
    grid-row:auto;
    padding:0 34px 12px 0;
    border-bottom:1px solid var(--pc-border);
  }
  .pcust-open { position:absolute; top:19px; right:14px; grid-column:auto; grid-row:auto; }
  .pcust-last,
  .pcust-favorite { grid-column:auto; grid-row:auto; }
  .pcust-cell { gap:5px; }
  .pcust-overlay { padding:8px; }
  .pcust-panel { width:100%; border-radius:15px; }
  .pcust-panel-body { padding:18px; }
  .pcust-panel-head { padding:14px; }
}
@media(prefers-reduced-motion:reduce) {
  .pcust-page *,
  .pcust-page *::before,
  .pcust-page *::after {
    animation-duration:.01ms!important;
    transition-duration:.01ms!important;
  }
  .pcust-stat:hover { transform:none; }
}
`;

function formatMoney(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string | null): string {
  if (!value) return "Not yet";

  const date = new Date(`${value.slice(0, 10)}T12:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-IN", {
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
      .map((word) => word[0].toUpperCase())
      .join("") || "C"
  );
}

function CustomerAvatar({
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

  return (
    <span
      className={`pcust-avatar ${
        large ? "pcust-avatar-large" : ""
      }`}
    >
      {customer.image_url && !failed ? (
        <img
          src={customer.image_url}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        initials(customer.name)
      )}
    </span>
  );
}

function RelationshipBadge({
  relationship,
}: {
  relationship: CustomerRelationship;
}) {
  return (
    <span className={`pcust-badge ${relationship}`}>
      {RELATIONSHIP_LABELS[relationship]}
    </span>
  );
}

function CustomerProfilePanel({
  customerKey,
  onClose,
}: {
  customerKey: string;
  onClose: () => void;
}) {
  const [data, setData] =
    useState<CustomerDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    setData(null);
    setLoading(true);
    setError("");

    void getShopCustomerDetails(
      customerKey,
      controller.signal
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;

        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load customer profile."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [customerKey]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable =
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'
        );

      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  const customer = data?.customer;

  return (
    <div className="pcust-overlay" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        className="pcust-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Customer relationship profile"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pcust-panel-head">
          <button
            type="button"
            className="pcust-button"
            onClick={onClose}
          >
            <ChevronLeft size={16} />
            Customer Directory
          </button>

          <button
            ref={closeButtonRef}
            type="button"
            className="pcust-close"
            onClick={onClose}
            aria-label="Close customer profile"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="pcust-empty" role="status">
            <RefreshCw size={25} className="pcust-spin" />
            <strong>Loading customer profile</strong>
          </div>
        ) : error ? (
          <div className="pcust-panel-body">
            <div className="pcust-error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          </div>
        ) : customer && data ? (
          <div className="pcust-panel-body">
            <section className="pcust-profile">
              <CustomerAvatar customer={customer} large />

              <span className="pcust-profile-overline">
                CUSTOMER RELATIONSHIP PROFILE
              </span>

              <h2>{customer.name}</h2>

              <p>
                <Phone size={13} />
                {customer.phone || "Phone not available"}
              </p>

              <RelationshipBadge
                relationship={customer.relationship}
              />
            </section>

            <div className="pcust-profile-metrics">
              <div>
                <CalendarCheck2 size={18} />
                <strong>{customer.completed_visits}</strong>
                <span>Completed Visits</span>
              </div>

              <div>
                <IndianRupee size={18} />
                <strong>
                  {formatMoney(customer.total_spent)}
                </strong>
                <span>Total Spent</span>
              </div>

              <div>
                <History size={18} />
                <strong>{customer.total_bookings}</strong>
                <span>Total Bookings</span>
              </div>
            </div>

            <section className="pcust-detail-section">
              <div className="pcust-section-heading">
                <Heart size={18} />
                <div>
                  <h3>Relationship Insights</h3>
                  <p>Customer engagement at your shop</p>
                </div>
              </div>

              {[
                ["Customer Since", formatDate(customer.first_booking)],
                ["Last Completed Visit", formatDate(customer.last_visit)],
                [
                  "Favorite Service",
                  customer.favorite_service || "Not available",
                ],
                ["Confirmed Bookings", customer.confirmed_bookings],
                ["Pending Bookings", customer.pending_bookings],
                [
                  "Cancelled / Rejected",
                  customer.cancelled_bookings +
                    customer.rejected_bookings,
                ],
              ].map(([label, value]) => (
                <div className="pcust-fact" key={String(label)}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </section>

            <section className="pcust-detail-section">
              <div className="pcust-section-heading">
                <History size={18} />
                <div>
                  <h3>Customer Journey</h3>
                  <p>Booking history with your shop</p>
                </div>
              </div>

              {data.visits.length === 0 ? (
                <div className="pcust-notice">
                  No visit history is available.
                </div>
              ) : (
                data.visits.map((visit) => (
                  <div
                    className="pcust-visit"
                    key={visit.booking_id}
                  >
                    <div className="pcust-visit-heading">
                      <strong>{visit.service_name}</strong>
                      <span
                        className={`pcust-visit-status ${visit.status}`}
                      >
                        {visit.status}
                      </span>
                    </div>

                    <div className="pcust-visit-meta">
                      <CalendarDays size={12} />
                      {formatDate(visit.booking_date)}
                      <span>·</span>
                      {visit.start_time.slice(0, 5)}
                    </div>

                    <b>{formatMoney(visit.service_price)}</b>

                    {visit.customer_notes && (
                      <small>{visit.customer_notes}</small>
                    )}
                  </div>
                ))
              )}
            </section>

            <div className="pcust-notice">
              <ShieldCheck size={16} />
              <span>
                This profile displays records associated with your
                authenticated shop only.
              </span>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export default function CustomersPage() {
  const navigate = useNavigate();

  const [data, setData] =
    useState<CustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] =
    useState<CustomerFilter>("all");
  const [selectedKey, setSelectedKey] =
    useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(9);
  const [updatedAt, setUpdatedAt] = useState("");

  const requestId = useRef(0);

  const closeProfile = useCallback(() => {
    setSelectedKey(null);
  }, []);

  const loadCustomers = useCallback(
    async (signal?: AbortSignal) => {
      const currentRequest = ++requestId.current;

      setLoading(true);
      setError("");

      try {
        const result = await getShopCustomers(signal);

        if (
          signal?.aborted ||
          currentRequest !== requestId.current
        ) {
          return;
        }

        setData(result);

        setUpdatedAt(
          new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          })
        );
      } catch (reason: unknown) {
        if (
          signal?.aborted ||
          currentRequest !== requestId.current
        ) {
          return;
        }

        if (
          reason instanceof Error &&
          reason.name === "AbortError"
        ) {
          return;
        }

        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load customers."
        );
      } finally {
        if (
          !signal?.aborted &&
          currentRequest === requestId.current
        ) {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();

    void loadCustomers(controller.signal);

    return () => {
      controller.abort();
      requestId.current += 1;
    };
  }, [loadCustomers]);

  useEffect(() => {
    setVisibleCount(9);
  }, [search, filter]);

  const summary = data?.summary ?? EMPTY_SUMMARY;

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return (data?.customers ?? []).filter((customer) => {
      if (
        filter !== "all" &&
        customer.relationship !== filter
      ) {
        return false;
      }

      return (
        !query ||
        customer.name.toLowerCase().includes(query) ||
        (customer.phone ?? "").toLowerCase().includes(query) ||
        (customer.favorite_service ?? "")
          .toLowerCase()
          .includes(query)
      );
    });
  }, [data, search, filter]);

  const visibleCustomers = filteredCustomers.slice(
    0,
    visibleCount
  );

  const metrics = [
    {
      label: "Total Customers",
      value: summary.total_customers,
      note: "Unique customers at your shop",
      icon: UsersRound,
      overline: "CUSTOMER BASE",
    },
    {
      label: "Returning Customers",
      value: summary.returning_customers,
      note: "Two or more completed visits",
      icon: Repeat2,
      overline: "REPEAT VISITS",
    },
    {
      label: "New This Month",
      value: summary.new_this_month,
      note: "First booking this month",
      icon: UserRoundPlus,
      overline: "NEW RELATIONSHIPS",
    },
    {
      label: "Customer Retention",
      value: `${summary.retention_rate}%`,
      note: "Repeat visitors among visitors",
      icon: Heart,
      overline: "CUSTOMER LOYALTY",
    },
  ];

  const displayValue = (value: string | number) =>
    loading && !data ? "..." : !data ? "—" : value;

  const resetFilters = () => {
    setSearch("");
    setFilter("all");
  };

  return (
    <div className="pcust-page">
      <style>{CSS}</style>

      <div className="pcust-shell">
        <header className="pcust-heading">
          <div>
            <span className="pcust-eyebrow">
              Customer Relationships
            </span>
            <h1>Your customer community</h1>
            <p>
              Know your customers. Understand their visits.
              Build lasting relationships.
            </p>
          </div>

          <div className="pcust-actions">
            <button
              type="button"
              className="pcust-button"
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft size={15} />
              Dashboard
            </button>

            <button
              type="button"
              className="pcust-button pcust-button-gold"
              onClick={() => void loadCustomers()}
              disabled={loading}
            >
              <RefreshCw
                size={15}
                className={loading ? "pcust-spin" : ""}
              />
              {loading ? "Refreshing..." : "Refresh Customers"}
            </button>
          </div>
        </header>

        {error && (
          <div className="pcust-error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button
              type="button"
              className="pcust-button"
              disabled={loading}
              onClick={() => void loadCustomers()}
            >
              Retry
            </button>
          </div>
        )}

        <section
          className="pcust-stats"
          aria-label="Customer relationship insights"
        >
          {metrics.map(
            ({ label, value, note, icon: Icon, overline }) => (
              <article className="pcust-stat" key={label}>
                <div className="pcust-stat-top">
                  <span className="pcust-stat-overline">
                    {overline}
                  </span>
                  <span className="pcust-stat-icon">
                    <Icon size={17} strokeWidth={1.8} />
                  </span>
                </div>

                <strong className="pcust-stat-value">
                  {displayValue(value)}
                </strong>

                <h3>{label}</h3>
                <p>{note}</p>
              </article>
            )
          )}
        </section>

        <section
          className="pcust-directory"
          aria-label="Customer directory"
          aria-busy={loading}
        >
          <div className="pcust-directory-head">
            <div>
              <span className="pcust-eyebrow">
                Your Shop · Your Customers
              </span>
              <h2>Customer Directory</h2>
              <p>
                Visit history and customer insights, together in
                one place.
              </p>
            </div>

            <div className="pcust-count">
              <UsersRound size={16} />
              <strong>
                {data ? summary.total_customers : "—"}
              </strong>
              <span>Customers</span>
            </div>
          </div>

          <div className="pcust-toolbar">
            <label className="pcust-search">
              <Search size={17} />

              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, mobile number or service..."
                aria-label="Search customers"
              />

              {search && (
                <button
                  type="button"
                  className="pcust-clear"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </label>

            <div className="pcust-security">
              <ShieldCheck size={15} />
              Protected shop records
            </div>
          </div>

          <div className="pcust-filter-row">
            <div
              className="pcust-filters"
              role="group"
              aria-label="Customer categories"
            >
              {FILTERS.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  className={`pcust-filter ${
                    filter === item.value ? "active" : ""
                  }`}
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                  {item.value === "all" && data && (
                    <span>{summary.total_customers}</span>
                  )}
                </button>
              ))}
            </div>

            {data && (
              <span
                className="pcust-results"
                aria-live="polite"
              >
                Showing{" "}
                {Math.min(visibleCount, filteredCustomers.length)}{" "}
                of {filteredCustomers.length} customers
              </span>
            )}
          </div>

          {loading && !data ? (
            <div className="pcust-empty" role="status">
              <RefreshCw size={28} className="pcust-spin" />
              <strong>Loading your customers</strong>
              <span>
                Retrieving your shop’s customer records.
              </span>
            </div>
          ) : !data ? (
            <div className="pcust-empty">
              <AlertCircle size={30} />
              <strong>Directory unavailable</strong>
              <span>Use Refresh Customers to try again.</span>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="pcust-empty">
              <UsersRound size={34} />
              <strong>
                {search || filter !== "all"
                  ? "No matching customers"
                  : "Your customer community starts here"}
              </strong>
              <span>
                {search || filter !== "all"
                  ? "Try a different search or customer category."
                  : "Customers will appear after your shop receives bookings."}
              </span>
              {(search || filter !== "all") && (
                <button
                  type="button"
                  className="pcust-button"
                  onClick={resetFilters}
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="pcust-list">
                {visibleCustomers.map((customer) => (
                  <button
                    type="button"
                    className="pcust-row"
                    key={customer.customer_key}
                    onClick={() =>
                      setSelectedKey(customer.customer_key)
                    }
                    aria-label={`View ${customer.name}'s customer profile`}
                  >
                    <span className="pcust-person">
                      <CustomerAvatar customer={customer} />

                      <span className="pcust-person-info">
                        <strong
                          className="pcust-name"
                          title={customer.name}
                        >
                          {customer.name}
                        </strong>

                        <span className="pcust-phone">
                          <Phone size={10} />
                          <span>
                            {customer.phone || "Phone not available"}
                          </span>
                        </span>

                        <RelationshipBadge
                          relationship={customer.relationship}
                        />
                      </span>
                    </span>

                    <span className="pcust-cell">
                      <span className="pcust-cell-label">
                        <CalendarCheck2 size={12} />
                        Completed Visits
                      </span>
                      <strong className="pcust-cell-value">
                        {customer.completed_visits}
                      </strong>
                    </span>

                    <span className="pcust-cell">
                      <span className="pcust-cell-label">
                        <IndianRupee size={12} />
                        Total Spent
                      </span>
                      <strong className="pcust-cell-value pcust-money">
                        {formatMoney(customer.total_spent)}
                      </strong>
                    </span>

                    <span className="pcust-cell pcust-last">
                      <span className="pcust-cell-label">
                        <Clock3 size={12} />
                        Last Visit
                      </span>
                      <strong className="pcust-cell-value">
                        {formatDate(customer.last_visit)}
                      </strong>
                    </span>

                    <span className="pcust-cell pcust-favorite">
                      <span className="pcust-cell-label">
                        <Scissors size={12} />
                        Favorite Service
                      </span>
                      <strong
                        className="pcust-cell-value"
                        title={
                          customer.favorite_service || "Not available"
                        }
                      >
                        {customer.favorite_service || "Not available"}
                      </strong>
                    </span>

                    <span
                      className="pcust-open"
                      aria-hidden="true"
                    >
                      <ArrowUpRight size={15} />
                    </span>
                  </button>
                ))}
              </div>

              {visibleCount < filteredCustomers.length && (
                <div className="pcust-load-more">
                  <button
                    type="button"
                    className="pcust-button"
                    onClick={() =>
                      setVisibleCount((count) => count + 9)
                    }
                  >
                    Show More Customers
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <footer className="pcust-footer">
          <span>
            <ShieldCheck size={14} />
            Customer records from your authenticated shop API.
          </span>
          {updatedAt && (
            <span>Last refreshed {updatedAt}</span>
          )}
        </footer>
      </div>

      {selectedKey && (
        <CustomerProfilePanel
          customerKey={selectedKey}
          onClose={closeProfile}
        />
      )}
    </div>
  );
}