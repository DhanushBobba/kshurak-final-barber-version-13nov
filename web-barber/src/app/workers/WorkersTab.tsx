
import { useMemo, useState } from "react";
import {
  Check,
  Clock3,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";

export type WorkerRecord = {
  id: string;
  fullName: string;
  phone: string;
  role: string;
  experience: string;
  specializations: string;
  startTime: string;
  endTime: string;
  active: boolean;
};

type WorkersTabProps = {
  workers: WorkerRecord[];
  onWorkersChange: (workers: WorkerRecord[]) => void;
  onManageSlots?: (workerId: string) => void;
};

const EMPTY_WORKER: WorkerRecord = {
  id: "",
  fullName: "",
  phone: "",
  role: "Barber",
  experience: "0",
  specializations: "",
  startTime: "09:00",
  endTime: "21:00",
  active: true,
};

const ROLES = [
  "Senior Barber",
  "Barber",
  "Junior Barber",
  "Hair Stylist",
  "Beard Specialist",
  "Assistant",
  "Shop Manager",
];

const styles = `
.kwt {
  --wt-primary:#F59E0B;
  --wt-dark:#0D0D0E;
  --wt-surface:#17181A;
  --wt-light:#202124;
  --wt-text:#FFFFFF;
  --wt-secondary:#9E9EA7;
  --wt-muted:#71717A;
  --wt-border:#27282C;
  --wt-border-light:#3E3F45;
  --wt-success:#22C55E;
  --wt-error:#EF4444;
  width:100%;
  min-width:0;
  color:var(--wt-text);
  font-family:Inter,"Segoe UI",Arial,sans-serif;
  font-size:13px;
  color-scheme:dark;
}

.kwt *, .kwt *::before, .kwt *::after {
  box-sizing:border-box;
}

.kwt button,.kwt input,.kwt select {
  font:inherit;
}

.kwt button {
  cursor:pointer;
}

.kwt button:disabled {
  opacity:.5;
  cursor:not-allowed;
}

.kwt-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:15px;
  margin-bottom:22px;
}

.kwt-eyebrow {
  display:block;
  font-size:10px;
  font-weight:800;
  letter-spacing:1.2px;
  color:var(--wt-primary);
  margin-bottom:7px;
}

.kwt-heading h2 {
  font-size:20px;
  font-weight:750;
  color:#FFFFFF;
  letter-spacing:-.3px;
  margin:0 0 7px;
}

.kwt-heading p {
  color:var(--wt-secondary);
  font-size:12px;
  line-height:1.6;
  margin:0;
}

.kwt-count {
  display:inline-flex;
  align-items:center;
  gap:8px;
  margin-top:10px;
  font-size:11px;
  color:var(--wt-secondary);
}

.kwt-count-dot {
  display:inline-block;
  width:5px;
  height:5px;
  border-radius:50%;
  background:var(--wt-muted);
}

.kwt-add {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:9px;
  min-height:41px;
  padding:10px 16px;
  background:var(--wt-primary);
  border:1px solid var(--wt-primary);
  border-radius:9px;
  color:#000000;
  font-size:12px;
  font-weight:800;
  white-space:nowrap;
  transition:filter .18s,transform .18s;
}

.kwt-add:hover:not(:disabled) {
  filter:brightness(1.08);
  transform:translateY(-1px);
}

.kwt-tablewrap {
  width:100%;
  overflow-x:auto;
  border:1px solid var(--wt-border);
  border-radius:11px;
  background:var(--wt-dark);
  scrollbar-width:thin;
  scrollbar-color:var(--wt-border-light) transparent;
}

.kwt-table {
  width:100%;
  min-width:780px;
  border-collapse:collapse;
  table-layout:auto;
}

.kwt-table th {
  padding:15px 14px;
  background:var(--wt-light);
  color:var(--wt-secondary);
  text-align:left;
  font-size:10px;
  font-weight:800;
  letter-spacing:.4px;
  text-transform:uppercase;
  white-space:nowrap;
}

.kwt-table td {
  padding:15px 14px;
  border-top:1px solid var(--wt-border);
  color:#E4E4E7;
  font-size:11px;
  vertical-align:middle;
}

.kwt-table tbody tr {
  transition:background .18s;
}

.kwt-table tbody tr:hover {
  background:rgba(255,255,255,.025);
}

.kwt-worker {
  display:flex;
  align-items:center;
  gap:11px;
  min-width:160px;
}

.kwt-avatar {
  display:grid;
  place-items:center;
  flex-shrink:0;
  width:38px;
  height:38px;
  border:1px solid rgba(245,158,11,.25);
  border-radius:10px;
  background:rgba(245,158,11,.09);
  color:var(--wt-primary);
}

.kwt-worker strong {
  display:block;
  color:#FFFFFF;
  font-size:12px;
  font-weight:750;
}

.kwt-worker small {
  display:block;
  margin-top:4px;
  color:var(--wt-secondary);
  font-size:10px;
}

.kwt-time {
  color:#E4E4E7;
  font-size:11px;
  white-space:nowrap;
}

.kwt-role {
  display:inline-flex;
  align-items:center;
  min-height:26px;
  padding:5px 9px;
  border:1px solid var(--wt-border-light);
  border-radius:7px;
  background:var(--wt-light);
  color:#E4E4E7;
  font-size:10px;
  white-space:nowrap;
}

.kwt-status {
  display:inline-flex;
  align-items:center;
  gap:7px;
  font-size:10px;
  font-weight:800;
}

.kwt-status.active {
  color:var(--wt-success);
}

.kwt-status.inactive {
  color:var(--wt-error);
}

.kwt-dot {
  width:7px;
  height:7px;
  border-radius:50%;
  background:var(--wt-success);
}

.kwt-dot.off {
  background:var(--wt-error);
}

.kwt-actions {
  display:flex;
  align-items:center;
  gap:7px;
}

.kwt-icon {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  min-height:34px;
  padding:8px 10px;
  border:1px solid var(--wt-border-light);
  border-radius:8px;
  background:var(--wt-light);
  color:var(--wt-text);
  font-size:10px;
  font-weight:650;
  white-space:nowrap;
  transition:border-color .18s,color .18s;
}

.kwt-icon:hover {
  color:var(--wt-primary);
  border-color:var(--wt-primary);
}

.kwt-icon.danger {
  color:var(--wt-error);
}

.kwt-icon.danger:hover {
  border-color:var(--wt-error);
}

.kwt-empty {
  display:flex;
  flex-direction:column;
  align-items:center;
  padding:48px 20px;
  border:1px dashed var(--wt-border-light);
  border-radius:12px;
  background:var(--wt-dark);
  text-align:center;
}

.kwt-empty > svg {
  color:var(--wt-primary);
  margin-bottom:13px;
}

.kwt-empty h3 {
  color:#FFFFFF;
  margin:0 0 8px;
  font-size:17px;
}

.kwt-empty p {
  max-width:350px;
  color:var(--wt-secondary);
  font-size:12px;
  line-height:1.7;
  margin:0 0 19px;
}

.kwt-modalbackdrop {
  position:fixed;
  inset:0;
  z-index:120;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:18px;
  background:rgba(18,18,20,.82);
  backdrop-filter:blur(7px);
}

.kwt-modal {
  width:100%;
  max-width:660px;
  max-height:90dvh;
  overflow-y:auto;
  padding:25px;
  border:1px solid var(--wt-border-light);
  border-radius:15px;
  background:var(--wt-surface);
  box-shadow:0 25px 75px rgba(0,0,0,.55);
  scrollbar-width:thin;
}

.kwt-modalheading {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  margin-bottom:20px;
  padding-bottom:16px;
  border-bottom:1px solid var(--wt-border);
}

.kwt-modalheading h3 {
  margin:0 0 5px;
  color:#FFFFFF;
  font-size:20px;
  font-weight:750;
}

.kwt-modalheading p {
  margin:0;
  color:var(--wt-secondary);
  font-size:11px;
}

.kwt-grid {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:16px;
}

.kwt-field {
  display:flex;
  flex-direction:column;
  min-width:0;
  gap:8px;
  color:#FFFFFF;
  font-size:11px;
  font-weight:700;
}

.kwt-field input,.kwt-field select {
  width:100%;
  min-height:44px;
  padding:11px 12px;
  border:1px solid var(--wt-border-light);
  border-radius:9px;
  outline:none;
  background:var(--wt-dark);
  color:#FFFFFF;
  font-size:12px;
}

.kwt-field input:focus,.kwt-field select:focus {
  border-color:var(--wt-primary);
  box-shadow:0 0 0 3px rgba(245,158,11,.08);
}

.kwt-field input::placeholder {
  color:var(--wt-muted);
}

.kwt-field select option {
  background:var(--wt-surface);
}

.kwt-buttons {
  display:flex;
  justify-content:flex-end;
  flex-wrap:wrap;
  gap:11px;
  margin-top:23px;
  padding-top:17px;
  border-top:1px solid var(--wt-border);
}

.kwt-cancel {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:41px;
  padding:10px 17px;
  background:var(--wt-light);
  border:1px solid var(--wt-border-light);
  border-radius:9px;
  color:var(--wt-text);
  font-size:12px;
  font-weight:700;
}

.kwt-cancel:hover {
  border-color:var(--wt-primary);
  color:var(--wt-primary);
}

.kwt-error {
  margin:15px 0;
  padding:12px 14px;
  background:rgba(239,68,68,.09);
  border:1px solid rgba(239,68,68,.34);
  border-radius:9px;
  color:#FCA5A5;
  font-size:12px;
}

.kwt-info {
  margin-top:15px;
  color:var(--wt-muted);
  font-size:11px;
  line-height:1.7;
}

@media(max-width:650px) {
  .kwt-heading {
    flex-direction:column;
    align-items:stretch;
  }

  .kwt-add {
    align-self:flex-start;
  }

  .kwt-grid {
    grid-template-columns:1fr;
  }

  .kwt-modal {
    padding:18px;
  }

  .kwt-buttons {
    flex-wrap:wrap;
  }
}
`;

function createId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function timeMinutes(value: string): number {
  const parts = value.split(":").map(Number);

  if (
    parts.length !== 2 ||
    parts.some((part) => !Number.isFinite(part))
  ) {
    return NaN;
  }

  return parts[0] * 60 + parts[1];
}

function displayTime(value: string): string {
  const minutes = timeMinutes(value);

  if (!Number.isFinite(minutes)) return "—";

  const hours = Math.floor(minutes / 60);

  return `${String(hours % 12 || 12).padStart(
    2,
    "0"
  )}:${String(minutes % 60).padStart(2, "0")} ${
    hours >= 12 ? "PM" : "AM"
  }`;
}

function validateWorker(
  worker: WorkerRecord
): string | null {
  if (worker.fullName.trim().length < 2) {
    return "Worker name must contain at least 2 characters.";
  }

  const phone = worker.phone.trim();
  const digits = phone.replace(/\D/g, "");

  if (
    !/^[0-9+\-\s()]{10,20}$/.test(phone) ||
    digits.length < 10 ||
    digits.length > 15
  ) {
    return "Enter a valid worker contact number.";
  }

  if (
    !/^\d+$/.test(worker.experience) ||
    Number(worker.experience) > 80
  ) {
    return "Experience must be between 0 and 80 years.";
  }

  const start = timeMinutes(worker.startTime);
  const end = timeMinutes(worker.endTime);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end
  ) {
    return "Working end time must be later than working start time.";
  }

  return null;
}

export default function WorkersTab({
  workers,
  onWorkersChange,
  onManageSlots,
}: WorkersTabProps) {
  const [editor, setEditor] =
    useState<WorkerRecord | null>(null);

  const [error, setError] = useState("");

  const activeCount = useMemo(
    () => workers.filter((worker) => worker.active).length,
    [workers]
  );

  const startAdding = () => {
    setError("");
    setEditor({ ...EMPTY_WORKER });
  };

  const startEditing = (worker: WorkerRecord) => {
    setError("");
    setEditor({ ...worker });
  };

  const updateField = <K extends keyof WorkerRecord>(
    field: K,
    value: WorkerRecord[K]
  ) => {
    setEditor((current) =>
      current ? { ...current, [field]: value } : null
    );

    setError("");
  };

  const saveWorker = () => {
    if (!editor) return;

    const problem = validateWorker(editor);

    if (problem) {
      setError(problem);
      return;
    }

    const saved: WorkerRecord = {
      ...editor,
      id: editor.id || createId(),
      fullName: editor.fullName.trim(),
      phone: editor.phone.trim(),
      specializations: editor.specializations.trim(),
    };

    const exists = workers.some(
      (worker) => worker.id === saved.id
    );

    const nextWorkers = exists
      ? workers.map((worker) =>
          worker.id === saved.id ? saved : worker
        )
      : [...workers, saved];

    onWorkersChange(nextWorkers);
    setEditor(null);
    setError("");
  };

  const removeWorker = (worker: WorkerRecord) => {
    if (
      !window.confirm(
        `Remove ${worker.fullName} from your shop's workers?`
      )
    ) {
      return;
    }

    onWorkersChange(
      workers.filter((item) => item.id !== worker.id)
    );
  };

  const changeStatus = (worker: WorkerRecord) => {
    onWorkersChange(
      workers.map((item) =>
        item.id === worker.id
          ? { ...item, active: !item.active }
          : item
      )
    );
  };

  return (
    <div className="kwt">
      <style>{styles}</style>

      <div className="kwt-heading">
        <div>
          <span className="kwt-eyebrow">
            TEAM DIRECTORY
          </span>

          <h2>Your Workers</h2>

          <p>
            Manage worker profiles, roles, and availability.
          </p>

          <div className="kwt-count">
            <span>{workers.length} total workers</span>
            <span className="kwt-count-dot" />
            <span>{activeCount} active</span>
          </div>
        </div>

        <button
          type="button"
          className="kwt-add"
          onClick={startAdding}
        >
          <Plus size={17} />
          Add Worker
        </button>
      </div>

      {workers.length === 0 ? (
        <div className="kwt-empty">
          <Users size={33} />

          <h3>No workers added yet</h3>

          <p>
            Workers added through Shop Setup will appear here.
            You can also create your first worker using
            the button below.
          </p>

          <button
            type="button"
            className="kwt-add"
            onClick={startAdding}
          >
            <Plus size={17} />
            Add Worker
          </button>
        </div>
      ) : (
        <div className="kwt-tablewrap">
          <table className="kwt-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Worker</th>
                <th>Role</th>
                <th>Working Hours</th>
                <th>Available Slots</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {workers.map((worker, index) => (
                <tr key={worker.id}>
                  <td>{index + 1}</td>

                  <td>
                    <div className="kwt-worker">
                      <div className="kwt-avatar">
                        <UserRound size={19} />
                      </div>

                      <div>
                        <strong>{worker.fullName}</strong>
                        <small>{worker.phone}</small>
                      </div>
                    </div>
                  </td>

                  <td>
                    <span className="kwt-role">
                      {worker.role}
                    </span>
                  </td>

                  <td>
                    <span className="kwt-time">
                      {displayTime(worker.startTime)}
                      {" – "}
                      {displayTime(worker.endTime)}
                    </span>
                  </td>

                  <td>
                    {onManageSlots ? (
                      <button
                        type="button"
                        className="kwt-icon"
                        onClick={() =>
                          onManageSlots(worker.id)
                        }
                        title="Manage worker slots"
                      >
                        <Clock3 size={15} />
                        Manage Slots
                      </button>
                    ) : (
                      <span className="kwt-info">
                        Not configured
                      </span>
                    )}
                  </td>

                  <td>
                    <button
                      type="button"
                      className="kwt-icon"
                      title="Change worker status"
                      onClick={() => changeStatus(worker)}
                    >
                      <span
                        className={`kwt-status ${
                          worker.active
                            ? "active"
                            : "inactive"
                        }`}
                      >
                        <span
                          className={`kwt-dot ${
                            worker.active ? "" : "off"
                          }`}
                        />
                        {worker.active
                          ? "Active"
                          : "Inactive"}
                      </span>
                    </button>
                  </td>

                  <td>
                    <div className="kwt-actions">
                      <button
                        type="button"
                        className="kwt-icon"
                        title="Edit worker"
                        aria-label={`Edit ${worker.fullName}`}
                        onClick={() => startEditing(worker)}
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        type="button"
                        className="kwt-icon danger"
                        title="Remove worker"
                        aria-label={`Remove ${worker.fullName}`}
                        onClick={() => removeWorker(worker)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

     
      {editor && (
        <div
          className="kwt-modalbackdrop"
          onClick={() => setEditor(null)}
        >
          <section
            className="kwt-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              editor.id ? "Edit Worker" : "Add Worker"
            }
            onClick={(event) => event.stopPropagation()}
          >
            <div className="kwt-modalheading">
              <div>
                <h3>
                  {editor.id
                    ? "Edit Worker"
                    : "Add New Worker"}
                </h3>
                <p>
                  Enter professional details and working hours.
                </p>
              </div>

              <button
                type="button"
                className="kwt-icon"
                aria-label="Close"
                onClick={() => setEditor(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="kwt-grid">
              <label className="kwt-field">
                Worker Name *
                <input
                  value={editor.fullName}
                  onChange={(event) =>
                    updateField(
                      "fullName",
                      event.target.value
                    )
                  }
                  placeholder="Enter worker name"
                />
              </label>

              <label className="kwt-field">
                Mobile Number *
                <input
                  type="tel"
                  value={editor.phone}
                  onChange={(event) =>
                    updateField(
                      "phone",
                      event.target.value
                    )
                  }
                  placeholder="Enter phone number"
                />
              </label>

              <label className="kwt-field">
                Role *
                <select
                  value={editor.role}
                  onChange={(event) =>
                    updateField(
                      "role",
                      event.target.value
                    )
                  }
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>

              <label className="kwt-field">
                Years of Experience *
                <input
                  type="number"
                  min={0}
                  max={80}
                  value={editor.experience}
                  onChange={(event) =>
                    updateField(
                      "experience",
                      event.target.value
                    )
                  }
                />
              </label>

              <label className="kwt-field">
                Working Hours From *
                <input
                  type="time"
                  value={editor.startTime}
                  onChange={(event) =>
                    updateField(
                      "startTime",
                      event.target.value
                    )
                  }
                />
              </label>

              <label className="kwt-field">
                Working Hours To *
                <input
                  type="time"
                  value={editor.endTime}
                  onChange={(event) =>
                    updateField(
                      "endTime",
                      event.target.value
                    )
                  }
                />
              </label>

              <label className="kwt-field">
                Specializations
                <input
                  value={editor.specializations}
                  onChange={(event) =>
                    updateField(
                      "specializations",
                      event.target.value
                    )
                  }
                  placeholder="Haircut, Styling, Beard Trim"
                />
              </label>

              <label className="kwt-field">
                Worker Status
                <select
                  value={
                    editor.active ? "active" : "inactive"
                  }
                  onChange={(event) =>
                    updateField(
                      "active",
                      event.target.value === "active"
                    )
                  }
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>

            {error && (
              <div className="kwt-error" role="alert">
                {error}
              </div>
            )}

            <div className="kwt-buttons">
              <button
                type="button"
                className="kwt-cancel"
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="kwt-add"
                onClick={saveWorker}
              >
                <Check size={17} />
                Save Worker
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
