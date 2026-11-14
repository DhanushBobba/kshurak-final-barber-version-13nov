
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  ArrowLeft,
  Users,
  Clock3,
  RefreshCw,
  AlertCircle,
  UserRound,
  ShieldCheck,
  BarChart3,
} from "lucide-react";

import WorkersTab, {
  type WorkerRecord,
} from "./WorkersTab";

import SlotManagementTab from "./SlotManagementTab";

import WorkerPerformanceTab from "./WorkerPerformanceTab";

import {
  getWorkers,
  createWorker,
  updateWorker,
  fromBarberWorker,
  toWorkerPayload,
} from "../../services/barberApi";

// ============================================================
// TYPES
// ============================================================

type ActiveTab = "workers" | "slots" | "performance";

// ============================================================
// STYLES - CSS INCLUDED IN THE SAME TSX FILE
// ============================================================

const styles = `

.kw-page {
  --kw-primary: #F59E0B;
  --kw-background: #070708;
  --kw-surface: #17181A;
  --kw-surface-dark: #0D0D0E;
  --kw-surface-light: #202124;
  --kw-text: #FFFFFF;
  --kw-secondary: #9E9EA7;
  --kw-muted: #71717A;
  --kw-border: #27282C;
  --kw-border-light: #3E3F45;
  --kw-success: #22C55E;
  --kw-error: #EF4444;

  width: 100%;
  min-width: 0;
  min-height: 100%;
  background: var(--kw-background);
  color: var(--kw-text);
  font-family: Inter, "Segoe UI", Arial, sans-serif;
  font-size: 13px;
  color-scheme: dark;
}

.kw-page *,
.kw-page *::before,
.kw-page *::after {
  box-sizing: border-box;
}

.kw-page button,
.kw-page input,
.kw-page select {
  font: inherit;
}

.kw-page button {
  cursor: pointer;
}

.kw-page button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.kw-page :is(button, input, select):focus-visible {
  outline: 2px solid var(--kw-primary);
  outline-offset: 3px;
}

/* ============================================================
   MAIN LAYOUT
============================================================ */

.kw-main {
  width: 100%;
  max-width: 1550px;
  margin: 0 auto;
  padding: 28px clamp(16px, 2.5vw, 34px) 48px;
}

.kw-eyebrow {
  display: block;
  color: var(--kw-primary);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1.5px;
  margin-bottom: 9px;
}

/* ============================================================
   PAGE HEADING
============================================================ */

.kw-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 23px;
}

.kw-heading h1 {
  font-size: clamp(23px, 2.4vw, 30px);
  line-height: 1.3;
  letter-spacing: -0.6px;
  font-weight: 750;
  color: var(--kw-text);
  margin: 0 0 8px;
}

.kw-heading h1 .kw-highlight {
  color: var(--kw-primary);
}

.kw-heading p {
  color: var(--kw-secondary);
  font-size: 12px;
  line-height: 1.6;
  margin: 0;
}

.kw-heading-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* ============================================================
   HEADER BUTTONS
============================================================ */

.kw-back,
.kw-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 10px 14px;
  background: var(--kw-surface-light);
  color: var(--kw-text);
  border: 1px solid var(--kw-border-light);
  border-radius: 9px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;

  transition:
    border-color 0.18s,
    color 0.18s,
    background 0.18s;
}

.kw-back:hover,
.kw-refresh:hover:not(:disabled) {
  color: var(--kw-primary);
  border-color: var(--kw-primary);
}

.kw-refresh svg {
  color: var(--kw-primary);
}

/* ============================================================
   OVERVIEW CARDS
============================================================ */

.kw-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}

.kw-overview-card {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  padding: 18px;

  background: linear-gradient(
    145deg,
    #202124,
    #17181A 60%,
    #0D0D0E
  );

  border: 1px solid var(--kw-border);
  border-radius: 13px;

  transition:
    border-color 0.2s,
    transform 0.2s;
}

.kw-overview-card:hover {
  border-color: rgba(245, 158, 11, 0.4);
  transform: translateY(-2px);
}

.kw-overview-icon {
  display: grid;
  place-items: center;

  width: 43px;
  height: 43px;
  flex-shrink: 0;

  color: var(--kw-primary);
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: 10px;
}

.kw-overview-card:nth-child(2) .kw-overview-icon {
  color: var(--kw-success);
  background: rgba(34, 197, 94, 0.09);
  border-color: rgba(34, 197, 94, 0.2);
}

.kw-overview-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.kw-overview-info span {
  color: var(--kw-secondary);
  font-size: 11px;
}

.kw-overview-info strong {
  color: var(--kw-text);
  font-size: 25px;
  font-weight: 800;
  line-height: 1.2;
}

.kw-overview-info small {
  color: var(--kw-muted);
  font-size: 10px;
}

/* ============================================================
   WORKERS PANEL
============================================================ */

.kw-panel {
  background: var(--kw-surface);
  border: 1px solid var(--kw-border);
  border-radius: 14px;
  overflow: hidden;
  min-width: 0;
}

/* ============================================================
   THREE-TAB NAVIGATION
============================================================ */

.kw-tabs {
  display: flex;
  align-items: stretch;
  gap: 5px;
  padding: 0 22px;

  border-bottom: 1px solid var(--kw-border);
  background: var(--kw-surface-dark);

  overflow-x: auto;
  scrollbar-width: thin;
}

.kw-tab {
  position: relative;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;

  flex-shrink: 0;
  padding: 19px 20px;

  border: 0;
  border-bottom: 2px solid transparent;

  background: transparent;
  color: var(--kw-secondary);

  font-size: 12px;
  font-weight: 750;
  white-space: nowrap;

  transition:
    background 0.18s,
    color 0.18s;
}

.kw-tab:hover {
  color: var(--kw-text);
  background: rgba(255, 255, 255, 0.025);
}

.kw-tab.active {
  color: var(--kw-primary);
  border-bottom-color: var(--kw-primary);
  background: rgba(245, 158, 11, 0.05);
}

.kw-tab svg {
  flex-shrink: 0;
}

/* Performance tab icon */

.kw-tab-performance.active svg {
  color: var(--kw-primary);
}

/* ============================================================
   TAB CONTENT
============================================================ */

.kw-content {
  padding: 24px;
  min-width: 0;
}

.kw-tab-content {
  width: 100%;
  min-width: 0;
  animation: kw-fade-in 0.24s ease-out;
}

@keyframes kw-fade-in {
  from {
    opacity: 0;
    transform: translateY(5px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ============================================================
   ERROR MESSAGE
============================================================ */

.kw-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;

  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.32);
  color: #FCA5A5;

  border-radius: 10px;
  padding: 13px 15px;
  margin-bottom: 18px;

  font-size: 12px;
  line-height: 1.6;
}

.kw-alert svg {
  flex-shrink: 0;
}

/* ============================================================
   LOADING STATE
============================================================ */

.kw-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;

  min-height: 260px;
  padding: 40px;

  color: var(--kw-secondary);
  text-align: center;
  font-size: 12px;
}

.kw-spinner {
  width: 30px;
  height: 30px;

  border: 3px solid var(--kw-border-light);
  border-top-color: var(--kw-primary);
  border-radius: 50%;

  animation: kw-spin 0.75s linear infinite;
}

@keyframes kw-spin {
  to {
    transform: rotate(360deg);
  }
}

.kw-working {
  opacity: 0.6;
  pointer-events: none;
}

/* ============================================================
   NOTICE
============================================================ */

.kw-notice {
  display: flex;
  align-items: flex-start;
  gap: 9px;

  margin-top: 17px;
  padding: 13px 15px;

  border: 1px solid var(--kw-border);
  border-radius: 10px;

  background: var(--kw-surface-dark);
  color: var(--kw-secondary);

  font-size: 11px;
  line-height: 1.7;
}

.kw-notice svg {
  color: var(--kw-primary);
  flex-shrink: 0;
  margin-top: 1px;
}

/* ============================================================
   RESPONSIVE - LAPTOP
============================================================ */

@media (max-width: 1100px) {
  .kw-overview {
    gap: 10px;
  }

  .kw-overview-card {
    padding: 14px;
  }

  .kw-tab {
    padding: 17px 15px;
  }
}

/* ============================================================
   RESPONSIVE - TABLET
============================================================ */

@media (max-width: 780px) {
  .kw-main {
    padding: 22px 17px 40px;
  }

  .kw-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .kw-content {
    padding: 17px;
  }

  .kw-overview {
    grid-template-columns: repeat(
      2,
      minmax(0, 1fr)
    );
  }

  .kw-overview-card:last-child {
    grid-column: 1 / -1;
  }

  .kw-tabs {
    padding: 0 12px;
  }

  .kw-tab {
    padding: 15px 12px;
  }
}

/* ============================================================
   RESPONSIVE - MOBILE
============================================================ */

@media (max-width: 520px) {
  .kw-main {
    padding: 18px 13px 35px;
  }

  .kw-heading h1 {
    font-size: 23px;
  }

  .kw-heading-actions {
    width: 100%;
  }

  .kw-heading-actions button {
    flex: 1;
  }

  .kw-tabs {
    padding: 0 8px;
    gap: 0;
  }

  .kw-tab {
    flex: 1;
    gap: 6px;
    padding: 15px 8px;
    font-size: 10px;
  }

  .kw-tab svg {
    width: 15px;
    height: 15px;
  }

  .kw-content {
    padding: 12px;
  }

  .kw-overview-card {
    padding: 12px;
  }

  .kw-overview-icon {
    width: 35px;
    height: 35px;
  }

  .kw-overview-info strong {
    font-size: 22px;
  }
}

/* ============================================================
   REDUCED MOTION
============================================================ */

@media (prefers-reduced-motion: reduce) {
  .kw-page *,
  .kw-page *::before,
  .kw-page *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

`;

// ============================================================
// WORKER COMPARISON
// ============================================================

function workersEqual(
  a: WorkerRecord,
  b: WorkerRecord
): boolean {
  return (
    a.fullName === b.fullName &&
    a.phone === b.phone &&
    a.role === b.role &&
    a.experience === b.experience &&
    a.specializations === b.specializations &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    a.active === b.active
  );
}

// ============================================================
// ERROR HANDLER
// ============================================================

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred. Please try again.";
}

// ============================================================
// MAIN WORKERS PAGE
// ============================================================

export default function WorkersPage() {
  const navigate = useNavigate();

  // ==========================================================
  // AUTHENTICATION
  // ==========================================================

  const barberId =
    sessionStorage.getItem("kshurak_barber_id") ||
    sessionStorage.getItem("barber_id") ||
    "";

  const token =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");

  // ==========================================================
  // TAB STATE
  // ==========================================================

  const [activeTab, setActiveTab] =
    useState<ActiveTab>("workers");

  const [selectedWorkerId, setSelectedWorkerId] =
    useState("");

  // ==========================================================
  // WORKERS STATE
  // ==========================================================

  const [workers, setWorkers] =
    useState<WorkerRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const workersRef = useRef<WorkerRecord[]>([]);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);

  // ==========================================================
  // COMPONENT LIFECYCLE
  // ==========================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ==========================================================
  // AUTH VALIDATION
  // ==========================================================

  useEffect(() => {
    if (!token || !barberId) {
      navigate("/login", {
        replace: true,
      });
    }
  }, [token, barberId, navigate]);

  // ==========================================================
  // LOAD WORKERS
  // ==========================================================

  useEffect(() => {
    if (!token || !barberId) return;

    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const records = await getWorkers(
          controller.signal
        );

        if (controller.signal.aborted) return;

        const mapped = records.map(fromBarberWorker);

        workersRef.current = mapped;
        setWorkers(mapped);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;

        setError(errorMessage(err));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      controller.abort();
    };
  }, [token, barberId]);

  // ==========================================================
  // REFRESH WORKERS
  // ==========================================================

  const refreshWorkers = async () => {
    if (savingRef.current) return;

    setLoading(true);
    setError("");

    try {
      const records = await getWorkers();

      if (!mountedRef.current) return;

      const mapped = records.map(fromBarberWorker);

      workersRef.current = mapped;
      setWorkers(mapped);
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError(errorMessage(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  // ==========================================================
  // ADD / UPDATE WORKERS
  // ==========================================================

  const updateWorkers = (
    updatedWorkers: WorkerRecord[]
  ) => {
    if (savingRef.current) return;

    const previous = workersRef.current;

    const previousIds = new Set(
      previous.map((worker) => worker.id)
    );

    const updatedIds = new Set(
      updatedWorkers.map((worker) => worker.id)
    );

    // --------------------------------------------------------
    // CHECK DELETED WORKERS
    // --------------------------------------------------------

    const removedWorkers = previous.filter(
      (worker) => !updatedIds.has(worker.id)
    );

    if (removedWorkers.length > 0) {
      setError(
        "Permanent worker deletion is not supported " +
        "by the backend yet. Use the worker's " +
        "Active/Inactive toggle instead."
      );

      return;
    }

    // --------------------------------------------------------
    // CHECK ADDED WORKERS
    // --------------------------------------------------------

    const addedWorkers = updatedWorkers.filter(
      (worker) => !previousIds.has(worker.id)
    );

    // --------------------------------------------------------
    // CHECK EDITED WORKERS
    // --------------------------------------------------------

    const editedWorkers = updatedWorkers.filter(
      (worker) => {
        const original = previous.find(
          (item) => item.id === worker.id
        );

        return (
          original !== undefined &&
          !workersEqual(original, worker)
        );
      }
    );

    if (
      addedWorkers.length === 0 &&
      editedWorkers.length === 0
    ) {
      return;
    }

    // --------------------------------------------------------
    // SAVE WORKER CHANGES
    // --------------------------------------------------------

    const save = async () => {
      savingRef.current = true;

      setSaving(true);
      setError("");

      try {
        // CREATE NEW WORKERS

        for (const worker of addedWorkers) {
          await createWorker(
            toWorkerPayload(worker)
          );
        }

        // UPDATE EXISTING WORKERS

        for (const worker of editedWorkers) {
          const original = previous.find(
            (item) => item.id === worker.id
          );

          if (!original) continue;

          const payload = toWorkerPayload(worker);
          const oldPayload = toWorkerPayload(original);

          const changes: Partial<typeof payload> = {};

          for (
            const key of Object.keys(payload) as Array<
              keyof typeof payload
            >
          ) {
            if (payload[key] !== oldPayload[key]) {
              Object.assign(changes, {
                [key]: payload[key],
              });
            }
          }

          if (Object.keys(changes).length > 0) {
            await updateWorker(
              worker.id,
              changes
            );
          }
        }

        // RELOAD UPDATED DATA

        const records = await getWorkers();

        if (!mountedRef.current) return;

        const mapped = records.map(fromBarberWorker);

        workersRef.current = mapped;
        setWorkers(mapped);
      } catch (err: unknown) {
        if (!mountedRef.current) return;

        setError(
          `Unable to save worker changes: ${errorMessage(err)}`
        );

        // REFRESH FROM BACKEND AFTER FAILED SAVE

        try {
          const records = await getWorkers();

          if (!mountedRef.current) return;

          const mapped = records.map(fromBarberWorker);

          workersRef.current = mapped;
          setWorkers(mapped);
        } catch {
          workersRef.current = previous;
          setWorkers(previous);
        }
      } finally {
        savingRef.current = false;

        if (mountedRef.current) {
          setSaving(false);
        }
      }
    };

    void save();
  };

  // ==========================================================
  // MANAGE SLOTS FOR SELECTED WORKER
  // ==========================================================

  const manageWorkerSlots = (workerId: string) => {
    setSelectedWorkerId(workerId);
    setActiveTab("slots");
  };

  // ==========================================================
  // NAVIGATE BETWEEN TABS
  // ==========================================================

  const changeTab = (tab: ActiveTab) => {
    if (savingRef.current) return;

    setActiveTab(tab);
    setError("");
  };

  // ==========================================================
  // AUTH GUARD
  // ==========================================================

  if (!token || !barberId) return null;

  // ==========================================================
  // WORKERS SUMMARY
  // ==========================================================

  const totalWorkers = workers.length;

  const activeWorkers = workers.filter(
    (worker) => worker.active
  ).length;

  const inactiveWorkers =
    totalWorkers - activeWorkers;

  const displayNumber = (value: number) =>
    loading && totalWorkers === 0
      ? "..."
      : String(value);

  // ==========================================================
  // PAGE UI
  // ==========================================================

  return (
    <div className="kw-page">
      <style>{styles}</style>

      <main className="kw-main">

        {/* ===================================================
            PAGE HEADER
        =================================================== */}

        <div className="kw-heading">
          <div>
            <h1>
              Workers{" "}
              <span className="kw-highlight">
                Management
              </span>
            </h1>

            <p>
              Manage your shop team, working shifts,
              slot availability, and worker performance.
            </p>
          </div>

          <div className="kw-heading-actions">
            <button
              type="button"
              className="kw-back"
              onClick={() =>
                navigate("/dashboard")
              }
            >
              <ArrowLeft size={16} />
              Dashboard
            </button>

            <button
              type="button"
              className="kw-refresh"
              disabled={loading || saving}
              onClick={() =>
                void refreshWorkers()
              }
            >
              <RefreshCw size={16} />

              {loading
                ? "Loading..."
                : "Refresh Workers"}
            </button>
          </div>
        </div>

        {/* ===================================================
            WORKERS SUMMARY CARDS
        =================================================== */}

        <div className="kw-overview">

          {/* TOTAL WORKERS */}

          <div className="kw-overview-card">
            <div className="kw-overview-icon">
              <Users size={21} />
            </div>

            <div className="kw-overview-info">
              <span>Total Workers</span>

              <strong>
                {displayNumber(totalWorkers)}
              </strong>

              <small>
                Registered team members
              </small>
            </div>
          </div>

          {/* ACTIVE WORKERS */}

          <div className="kw-overview-card">
            <div className="kw-overview-icon">
              <ShieldCheck size={21} />
            </div>

            <div className="kw-overview-info">
              <span>Active Workers</span>

              <strong>
                {displayNumber(activeWorkers)}
              </strong>

              <small>
                Currently active in the shop
              </small>
            </div>
          </div>

          {/* INACTIVE WORKERS */}

          <div className="kw-overview-card">
            <div className="kw-overview-icon">
              <UserRound size={21} />
            </div>

            <div className="kw-overview-info">
              <span>Inactive Workers</span>

              <strong>
                {displayNumber(inactiveWorkers)}
              </strong>

              <small>
                Not available for new slots
              </small>
            </div>
          </div>
        </div>

        {/* ===================================================
            ERROR MESSAGE
        =================================================== */}

        {error && (
          <div
            className="kw-alert"
            role="alert"
          >
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {/* ===================================================
            MAIN WORKERS PANEL
        =================================================== */}

        <section className="kw-panel">

          {/* =================================================
              THREE NAVIGATION TABS
          ================================================= */}

          <div
            className="kw-tabs"
            role="tablist"
            aria-label="Worker management sections"
          >

            {/* TAB 1 - WORKERS */}

            <button
              id="kw-tab-workers"
              type="button"
              role="tab"
              aria-selected={
                activeTab === "workers"
              }
              aria-controls="kw-active-panel"
              className={`kw-tab ${
                activeTab === "workers"
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                changeTab("workers")
              }
            >
              <Users size={17} />
              Workers
            </button>

            {/* TAB 2 - SLOT MANAGEMENT */}

            <button
              id="kw-tab-slots"
              type="button"
              role="tab"
              aria-selected={
                activeTab === "slots"
              }
              aria-controls="kw-active-panel"
              className={`kw-tab ${
                activeTab === "slots"
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                changeTab("slots")
              }
            >
              <Clock3 size={17} />
              Slot Management
            </button>

            {/* TAB 3 - PERFORMANCE ANALYSIS */}

            <button
              id="kw-tab-performance"
              type="button"
              role="tab"
              aria-selected={
                activeTab === "performance"
              }
              aria-controls="kw-active-panel"
              className={`kw-tab kw-tab-performance ${
                activeTab === "performance"
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                changeTab("performance")
              }
            >
              <BarChart3 size={17} />
              Performance Analysis
            </button>
          </div>

          {/* =================================================
              ACTIVE TAB CONTENT
          ================================================= */}

          <div
            id="kw-active-panel"
            role="tabpanel"
            aria-labelledby={
              activeTab === "workers"
                ? "kw-tab-workers"
                : activeTab === "slots"
                ? "kw-tab-slots"
                : "kw-tab-performance"
            }
            className="kw-content"
          >
            {loading ? (
              <div className="kw-loading">
                <span className="kw-spinner" />

                Loading workers from
                KSHURAK backend...
              </div>
            ) : (
              <div
                className={
                  saving ? "kw-working" : ""
                }
                aria-busy={saving}
              >
                {/* ===========================================
                    TAB 1 - WORKERS
                =========================================== */}

                {activeTab === "workers" && (
                  <div className="kw-tab-content">
                    <WorkersTab
                      workers={workers}
                      onWorkersChange={updateWorkers}
                      onManageSlots={
                        manageWorkerSlots
                      }
                    />
                  </div>
                )}

                {/* ===========================================
                    TAB 2 - SLOT MANAGEMENT
                =========================================== */}

                {activeTab === "slots" && (
                  <div className="kw-tab-content">
                    <SlotManagementTab
                      workers={workers}
                      barberId={barberId}
                      initialWorkerId={
                        selectedWorkerId
                      }
                    />
                  </div>
                )}

                {/* ===========================================
                    TAB 3 - PERFORMANCE ANALYSIS
                =========================================== */}

                {activeTab === "performance" && (
                  <div className="kw-tab-content">
                    <WorkerPerformanceTab
                      workers={workers}
                      onManageSlots={
                        manageWorkerSlots
                      }
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ===================================================
            BACKEND STATUS NOTICE
        =================================================== */}

        <div className="kw-notice">
          <ShieldCheck size={17} />

          <span>
            Worker records are synchronized with
            FastAPI and PostgreSQL. Slot availability
            and custom breaks are currently stored
            in browser session storage until backend
            synchronization is implemented.
            Performance analytics use booking records
            from the shared backend.
          </span>
        </div>
      </main>
    </div>
  );
}
