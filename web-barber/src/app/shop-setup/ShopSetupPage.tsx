
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Store,
  Trash2,
  UserRound,
  Users,
  X,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";

import {
  getBarberProfile,
  getWorkers,
  createWorker,
  updateWorker,
  fromBarberWorker,
  toWorkerPayload,
  type BarberDocument,
} from "../../services/barberApi";

import {
  getShopSetup,
  saveShopSetup,
  submitShopSetup,
  uploadShopSetupDocument,
  type SetupSection,
  type SubmissionStatus,
} from "../../services/shopSetupApi";

import GoogleShopLocation, {
  type SelectedShopLocation,
} from "../../components/maps/GoogleShopLocation";

import "../../styles/shop-setup.css";

/* ============================================================
   TYPES
============================================================ */

type StepKey = SetupSection | "review";

type Worker = {
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

type ShopDraft = {
  fullName: string;
  phone: string;
  experience: string;
  displayName: string;
  email: string;
  specializations: string[];
  languages: string[];
  bio: string;
  shopName: string;
  shopPhone: string;
  shopEmail: string;
  shopType: string;
  description: string;
  address: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  latitude: string;
  longitude: string;
  googlePlaceId: string;
  openingTime: string;
  closingTime: string;
  workingDays: string[];
  amenities: string[];
  workers: Worker[];
  chairs: string;
  activeChairs: string;
  simultaneousBookings: string;
  appointmentDuration: string;
  bufferMinutes: string;
  advanceNoticeHours: string;
  bookingWindowDays: string;
  lunchStart: string;
  lunchEnd: string;
  acceptsTerms: boolean;
};

/* ============================================================
   CONFIGURATION
============================================================ */

const STEPS = [
  {
    key: "profile" as StepKey,
    name: "Barber Profile",
    description: "Personal and professional details",
    icon: UserRound,
  },
  {
    key: "shop" as StepKey,
    name: "Shop Details",
    description: "Business details and location",
    icon: Store,
  },
  {
    key: "workers" as StepKey,
    name: "Workers",
    description: "Manage your team members",
    icon: Users,
  },
  {
    key: "documents" as StepKey,
    name: "Documents",
    description: "Business verification documents",
    icon: FileText,
  },
  {
    key: "capacity" as StepKey,
    name: "Capacity",
    description: "Chairs, bookings and availability",
    icon: Clock3,
  },
  {
    key: "review" as StepKey,
    name: "Review & Publish",
    description: "Publish your shop directly",
    icon: ClipboardCheck,
  },
];

const REQUIRED_SECTIONS: SetupSection[] = [
  "profile",
  "shop",
  "workers",
  "documents",
  "capacity",
];

const DAYS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

const SPECIALIZATIONS = [
  "Haircut",
  "Hair Styling",
  "Skin Fade",
  "Beard Trim",
  "Royal Shave",
  "Hair Colouring",
  "Hair Spa",
  "Kids Haircut",
  "Grooming",
];

const LANGUAGES = [
  "English",
  "Hindi",
  "Telugu",
  "Tamil",
  "Kannada",
  "Malayalam",
  "Urdu",
];

const AMENITIES = [
  "Air Conditioning",
  "Wi-Fi",
  "Parking",
  "Waiting Area",
  "Digital Payments",
  "Wheelchair Access",
  "Drinking Water",
  "Washroom",
];

const SHOP_TYPES = [
  "Unisex Salon",
  "Men's Barber Shop",
  "Women's Salon",
  "Premium Grooming Studio",
];

const WORKER_ROLES = [
  "Senior Barber",
  "Barber",
  "Junior Barber",
  "Hair Stylist",
  "Assistant",
  "Shop Manager",
];

const DOCUMENT_TYPES = [
  ["trade_license", "Trade License"],
  ["address_proof", "Address Proof"],
  ["identity_proof", "Identity Proof"],
  ["professional_certificate", "Professional Certificate"],
  ["other", "Other"],
];

const EMPTY_WORKER: Worker = {
  id: "",
  fullName: "",
  phone: "",
  role: "Barber",
  experience: "0",
  specializations: "",
  startTime: "09:00",
  endTime: "18:00",
  active: true,
};

const EMPTY_DRAFT: ShopDraft = {
  fullName: "",
  phone: "",
  experience: "",
  displayName: "",
  email: "",
  specializations: [],
  languages: [],
  bio: "",
  shopName: "",
  shopPhone: "",
  shopEmail: "",
  shopType: "Unisex Salon",
  description: "",
  address: "",
  landmark: "",
  city: "",
  state: "",
  pincode: "",
  latitude: "",
  longitude: "",
  googlePlaceId: "",
  openingTime: "09:00",
  closingTime: "21:00",
  workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  amenities: [],
  workers: [],
  chairs: "",
  activeChairs: "",
  simultaneousBookings: "",
  appointmentDuration: "30",
  bufferMinutes: "10",
  advanceNoticeHours: "2",
  bookingWindowDays: "30",
  lunchStart: "",
  lunchEnd: "",
  acceptsTerms: false,
};

/* ============================================================
   VALIDATION
============================================================ */

const validPhone = (value: string) =>
  /^[0-9+\-\s()]{10,20}$/.test(value.trim()) &&
  value.replace(/\D/g, "").length >= 10 &&
  value.replace(/\D/g, "").length <= 15;

const validEmail = (value: string) =>
  !value.trim() ||
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const positive = (value: string) =>
  /^\d+$/.test(value.trim()) && Number(value) > 0;

const nonnegative = (value: string) =>
  /^\d+$/.test(value.trim()) && Number(value) >= 0;

const validHours = (start: string, end: string) =>
  /^\d{2}:\d{2}$/.test(start) &&
  /^\d{2}:\d{2}$/.test(end) &&
  start < end;

/* ============================================================
   FORM COMPONENTS
============================================================ */

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
  required = false,
  full = false,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  full?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <label className={`kss-field ${full ? "kss-full" : ""}`}>
      <span>
        {label}
        {required && <b className="kss-required"> *</b>}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="kss-field kss-full">
      <span>{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="kss-field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ChipSelector({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="kss-chips">
      {options.map((option) => {
        const active = selected.includes(option);

        return (
          <button
            key={option}
            type="button"
            className={`kss-chip ${active ? "active" : ""}`}
            onClick={() => onToggle(option)}
          >
            <span>{active ? "✓" : "+"}</span>
            {option}
          </button>
        );
      })}
    </div>
  );
}

function SectionTitle({
  children,
}: {
  children: React.ReactNode;
}) {
  return <h4 className="kss-sectiontitle">{children}</h4>;
}

/* ============================================================
   SHOP SETUP PAGE
============================================================ */

export default function ShopSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const username =
    sessionStorage.getItem("kshurak_barber_username") ||
    sessionStorage.getItem("barber_username") ||
    "Barber";

  const barberId =
    sessionStorage.getItem("kshurak_barber_id") ||
    sessionStorage.getItem("barber_id") ||
    "";

  const [draft, setDraft] = useState<ShopDraft>({
    ...EMPTY_DRAFT,
  });

  const [registeredDocuments, setRegisteredDocuments] =
    useState<BarberDocument[]>([]);

  const [registrationImageAvailable, setRegistrationImageAvailable] =
    useState(false);

  const [documentUploading, setDocumentUploading] = useState(false);
  const [documentType, setDocumentType] = useState("trade_license");

  const [workerEditor, setWorkerEditor] = useState<Worker | null>(null);
  const [workersLoading, setWorkersLoading] = useState(true);
  const [workerSaving, setWorkerSaving] = useState(false);
  const [workersError, setWorkersError] = useState("");

  const [setupLoading, setSetupLoading] = useState(true);
  const [setupSaving, setSetupSaving] = useState(false);

  const [setupStatus, setSetupStatus] =
    useState<SubmissionStatus>("draft");

  const [publishedAt, setPublishedAt] = useState<string | null>(null);

  const [savedSections, setSavedSections] =
    useState<SetupSection[]>([]);

  const [
    backendLocationVerified,
    setBackendLocationVerified,
  ] = useState(false);

  const [profileStatus, setProfileStatus] =
    useState("Loading registration details...");

  const [locationStatus, setLocationStatus] =
    useState("Select your shop address from Google Maps.");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  /* ============================================================
     NAVIGATION
  ============================================================ */

  const selected = useMemo<StepKey | null>(() => {
    const step = new URLSearchParams(location.search).get("step");

    return STEPS.some((item) => item.key === step)
      ? (step as StepKey)
      : null;
  }, [location.search]);

  const currentStep = STEPS.find(
    (item) => item.key === selected
  );

  /* ============================================================
     NEW PUBLISHING STATE RULES
  ============================================================ */

  const isPublished =
    setupStatus === "approved" &&
    Boolean(publishedAt);

  // Existing backend save rules still lock pending-review
  // and approved records. Publishing is handled separately.
  const readOnly =
    setupStatus === "pending_review" ||
    setupStatus === "approved";

  const completedCount = REQUIRED_SECTIONS.filter(
    (section) => savedSections.includes(section)
  ).length;

  const progress = Math.round(
    (completedCount / REQUIRED_SECTIONS.length) * 100
  );

  const canPublish =
    completedCount === REQUIRED_SECTIONS.length &&
    backendLocationVerified &&
    draft.acceptsTerms &&
    !setupSaving &&
    !setupLoading &&
    !workersLoading &&
    !workersError &&
    !documentUploading &&
    !isPublished;

  const applySetupResult = (
    result: Awaited<ReturnType<typeof getShopSetup>>
  ) => {
    setSavedSections(result.completed_sections || []);
    setSetupStatus(result.submission_status || "draft");
    setBackendLocationVerified(Boolean(result.location_verified));
    setPublishedAt(result.published_at || null);

    setRegisteredDocuments(
      Array.isArray(result.registration_documents)
        ? result.registration_documents
        : []
    );

    setRegistrationImageAvailable(
      Boolean(result.shop_image_path)
    );
  };

  /* ============================================================
     DRAFT HELPERS
  ============================================================ */

  const update = <K extends keyof ShopDraft>(
    field: K,
    value: ShopDraft[K]
  ) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));

    setMessage("");
    setError("");
  };

  const toggleValue = (
    field:
      | "specializations"
      | "languages"
      | "workingDays"
      | "amenities",
    value: string
  ) => {
    const values = draft[field];

    update(
      field,
      values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value]
    );
  };

  const onGoogleLocation = (place: SelectedShopLocation) => {
    setDraft((current) => ({
      ...current,
      address: place.address,
      city: place.city,
      state: place.state,
      pincode: place.pincode,
      latitude: place.latitude,
      longitude: place.longitude,
      googlePlaceId: place.placeId,
    }));

    setBackendLocationVerified(false);

    setLocationStatus(
      "Google Maps location selected. Save Shop Details to verify it."
    );

    setMessage("");
    setError("");
  };

  const open = (step: StepKey) => {
    setError("");
    setMessage("");
    setWorkerEditor(null);
    navigate(`/shop-setup?step=${step}`);
  };

  const close = () => {
    setError("");
    setMessage("");
    setWorkerEditor(null);
    navigate("/shop-setup");
  };

  /* ============================================================
     LOAD SHOP SETUP
  ============================================================ */

  const loadSetup = async () => {
    setSetupLoading(true);

    try {
      const result = await getShopSetup();

      const fields = result.setup_data as Partial<ShopDraft>;

      setDraft((current) => ({
        ...current,
        ...fields,
        workers: current.workers,
        acceptsTerms: current.acceptsTerms,
      }));

      applySetupResult(result);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load Shop Setup."
      );
    } finally {
      setSetupLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const result = await getShopSetup();
        if (!active) return;

        const fields = result.setup_data as Partial<ShopDraft>;

        setDraft((current) => ({
          ...current,
          ...fields,
          workers: current.workers,
          acceptsTerms: false,
        }));

        applySetupResult(result);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load Shop Setup."
          );
        }
      } finally {
        if (active) setSetupLoading(false);
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, []);

  /* ============================================================
     LOAD BARBER PROFILE
  ============================================================ */

  useEffect(() => {
    const controller = new AbortController();

    getBarberProfile(controller.signal)
      .then((profile) => {
        if (controller.signal.aborted) return;

        if (barberId && profile.id !== barberId) {
          setProfileStatus(
            "Login session does not match this barber account. Please sign in again."
          );
          return;
        }

        setDraft((current) => ({
          ...current,
          displayName: current.displayName || profile.username,
          email: current.email || profile.email,
          experience:
            current.experience ||
            String(profile.years_experience),
          shopName:
            current.shopName || profile.shop_name || "",
          shopPhone:
            current.shopPhone || profile.shop_phone || "",
          shopEmail:
            current.shopEmail || profile.email,
          address:
            current.address || profile.shop_address || "",
        }));

        setRegisteredDocuments((current) =>
          current.length > 0
            ? current
            : Array.isArray(profile.document_paths)
              ? profile.document_paths
              : []
        );

        setRegistrationImageAvailable(
          (current) =>
            current || Boolean(profile.shop_image_path)
        );

        setProfileStatus(
          "Registration details loaded successfully."
        );
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setProfileStatus(
            err instanceof Error
              ? err.message
              : "Unable to load barber profile."
          );
        }
      });

    return () => controller.abort();
  }, [barberId]);

  /* ============================================================
     WORKERS
  ============================================================ */

  const refreshWorkers = async () => {
    setWorkersLoading(true);
    setWorkersError("");

    try {
      const records = await getWorkers();

      setDraft((current) => ({
        ...current,
        workers: records.map(fromBarberWorker),
      }));

      return records;
    } catch (err) {
      setWorkersError(
        err instanceof Error
          ? err.message
          : "Unable to load workers."
      );
      throw err;
    } finally {
      setWorkersLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    getWorkers()
      .then((records) => {
        if (active) {
          setDraft((current) => ({
            ...current,
            workers: records.map(fromBarberWorker),
          }));
        }
      })
      .catch((err) => {
        if (active) {
          setWorkersError(
            err instanceof Error
              ? err.message
              : "Unable to load workers."
          );
        }
      })
      .finally(() => {
        if (active) setWorkersLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  /* ============================================================
     SECTION VALIDATION
  ============================================================ */

  const checkSection = (section: StepKey): boolean => {
    if (section === "profile") {
      return (
        draft.fullName.trim().length >= 2 &&
        validPhone(draft.phone) &&
        nonnegative(draft.experience) &&
        Number(draft.experience) <= 80 &&
        draft.specializations.length > 0 &&
        validEmail(draft.email)
      );
    }

    if (section === "shop") {
      return (
        draft.shopName.trim().length >= 2 &&
        validPhone(draft.shopPhone) &&
        validEmail(draft.shopEmail) &&
        draft.address.trim().length >= 10 &&
        Boolean(draft.city.trim() && draft.state.trim()) &&
        /^\d{6}$/.test(draft.pincode) &&
        validHours(
          draft.openingTime,
          draft.closingTime
        ) &&
        draft.workingDays.length > 0 &&
        Boolean(
          draft.googlePlaceId &&
          draft.latitude &&
          draft.longitude
        )
      );
    }

    if (section === "workers") {
      return (
        !workersLoading &&
        !workersError &&
        draft.workers.some((worker) => worker.active)
      );
    }

    if (section === "documents") {
      return registeredDocuments.length > 0;
    }

    if (section === "capacity") {
      return (
        positive(draft.chairs) &&
        positive(draft.activeChairs) &&
        Number(draft.activeChairs) <= Number(draft.chairs) &&
        positive(draft.simultaneousBookings) &&
        Number(draft.simultaneousBookings) <=
          Number(draft.activeChairs) &&
        positive(draft.appointmentDuration) &&
        nonnegative(draft.bufferMinutes) &&
        nonnegative(draft.advanceNoticeHours) &&
        positive(draft.bookingWindowDays) &&
        (
          (!draft.lunchStart && !draft.lunchEnd) ||
          validHours(draft.lunchStart, draft.lunchEnd)
        )
      );
    }

    return false;
  };

  /* ============================================================
     SAVE A SECTION
  ============================================================ */

  const saveSection = async (moveNext = false) => {
    if (
      !selected ||
      selected === "review" ||
      setupSaving ||
      setupLoading ||
      readOnly
    ) {
      return;
    }

    if (
      selected === "workers" &&
      (
        workerEditor ||
        workerSaving ||
        workersLoading ||
        workersError
      )
    ) {
      setError(
        "Finish saving your worker records before continuing."
      );
      return;
    }

    if (!checkSection(selected)) {
      setError(
        selected === "shop"
          ? "Complete the shop information and select a valid Google Maps location."
          : "Please complete all required fields in this section."
      );
      return;
    }

    setSetupSaving(true);
    setError("");
    setMessage("");

    try {
      const {
        workers,
        acceptsTerms,
        ...formFields
      } = draft;

      void workers;
      void acceptsTerms;

      const result = await saveShopSetup(formFields);

      applySetupResult(result);

      if (result.setup_data) {
        setDraft((current) => ({
          ...current,
          ...(result.setup_data as Partial<ShopDraft>),
          workers: current.workers,
          acceptsTerms: current.acceptsTerms,
        }));
      }

      setLocationStatus(
        result.location_verified
          ? "Shop location verified successfully by the backend."
          : "Shop location verification is pending."
      );

      setMessage("Shop details saved successfully.");

      if (moveNext) {
        const index = STEPS.findIndex(
          (item) => item.key === selected
        );

        if (STEPS[index + 1]) {
          open(STEPS[index + 1].key);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save Shop Setup."
      );
    } finally {
      setSetupSaving(false);
    }
  };

  /* ============================================================
     SAVE WORKER
  ============================================================ */

  const saveWorker = async () => {
    if (
      !workerEditor ||
      workerSaving ||
      readOnly
    ) {
      return;
    }

    if (
      workerEditor.fullName.trim().length < 2 ||
      !validPhone(workerEditor.phone) ||
      !nonnegative(workerEditor.experience) ||
      Number(workerEditor.experience) > 80 ||
      !validHours(
        workerEditor.startTime,
        workerEditor.endTime
      )
    ) {
      setError(
        "Enter a valid worker name, phone, experience, and shift."
      );
      return;
    }

    setWorkerSaving(true);
    setError("");

    try {
      const payload = toWorkerPayload(workerEditor);

      if (workerEditor.id) {
        await updateWorker(workerEditor.id, payload);
      } else {
        await createWorker(payload);
      }

      await refreshWorkers();

      setWorkerEditor(null);
      setMessage("Worker saved successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save worker."
      );
    } finally {
      setWorkerSaving(false);
    }
  };

  const deactivateWorker = async (worker: Worker) => {
    if (!window.confirm(`Deactivate ${worker.fullName}?`)) {
      return;
    }

    setWorkerSaving(true);
    setError("");

    try {
      await updateWorker(worker.id, {
        is_active: false,
      });

      await refreshWorkers();

      setMessage("Worker deactivated.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to deactivate worker."
      );
    } finally {
      setWorkerSaving(false);
    }
  };

  /* ============================================================
     UPLOAD DOCUMENT
  ============================================================ */

  const uploadDocument = async (file: File) => {
    if (documentUploading || readOnly) return;

    setDocumentUploading(true);
    setError("");
    setMessage("");

    try {
      const result = await uploadShopSetupDocument(
        file,
        documentType
      );

      setRegisteredDocuments(
        result.registration_documents
      );

      const saved = await getShopSetup();

      applySetupResult(saved);

      setMessage(
        "Document uploaded successfully."
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Document upload failed."
      );
    } finally {
      setDocumentUploading(false);
    }
  };

  /* ============================================================
     NEW DIRECT SHOP PUBLISHING
  ============================================================ */

  const handlePublish = async () => {
    if (!canPublish) {
      setError(
        "Complete all five sections, verify your shop location, and accept the declaration before publishing."
      );
      return;
    }

    const confirmed = window.confirm(
      "Publish your shop now? Your verified shop details will become available to nearby KSHURAK customers."
    );

    if (!confirmed) return;

    setSetupSaving(true);
    setError("");
    setMessage("");

    try {
      // Existing API method.
      // Backend /submit must support direct publication.
      const result = await submitShopSetup();

      setSavedSections(
        result.completed_sections || []
      );

      setSetupStatus(
        result.submission_status || "draft"
      );

      setBackendLocationVerified(
        Boolean(result.location_verified)
      );

      // Check the authoritative persisted publication state.
      const latest = await getShopSetup();

      applySetupResult(latest);

      if (
        latest.submission_status === "approved" &&
        Boolean(latest.published_at)
      ) {
        setDraft((current) => ({
          ...current,
          acceptsTerms: false,
        }));

        setMessage(
          "Your shop has been published successfully! Eligible customers within 15 km can now discover it."
        );

        window.alert(
          "Shop Published Successfully!\n\nYour shop is now eligible to appear in nearby barber searches."
        );
      } else {
        setError(
          "The backend accepted the request but did not confirm publication. Check that the direct-publish backend endpoint is deployed."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to publish your shop."
      );
    } finally {
      setSetupSaving(false);
    }
  };

  /* ============================================================
     BACK NAVIGATION
  ============================================================ */

  const previous = () => {
    if (!selected) return;

    const index = STEPS.findIndex(
      (item) => item.key === selected
    );

    if (index > 0) {
      open(STEPS[index - 1].key);
    }
  };

  /* ============================================================
     SCREEN
  ============================================================ */

  return (
    <div className="kss">
      <div className="kss-wrap">

        {/* HEADER */}
        <div className="kss-pagehead">
          <div>
            <h1>Shop Setup</h1>
            <p>
              Complete your barber profile and publish
              your shop for nearby customers.
            </p>
          </div>

          <button
            type="button"
            className="kss-back"
            onClick={() => navigate("/dashboard")}
          >
            <ArrowLeft size={16} />
            Dashboard
          </button>
        </div>

        {/* HERO */}
        <section className="kss-hero">
          <div className="kss-herotop">
            <div>
              <span className="kss-hero-label">
                YOUR SHOP WORKSPACE
              </span>

              <h2>Welcome back, {username}!</h2>

              <p>
                Complete all five setup sections.
                Once your details and location are verified,
                you can publish your shop directly.
                No additional Admin review is required.
              </p>
            </div>

            <div className="kss-progress">
              <div className="kss-progresslabel">
                <span>Setup Progress</span>
                <strong>
                  {completedCount}/5 · {progress}%
                </strong>
              </div>

              <div className="kss-progressbar">
                <div
                  style={{
                    width: `${progress}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* SETUP STEPS */}
          <div className="kss-grid">
            {STEPS.map((step, index) => {
              const Icon = step.icon;

              const complete =
                step.key === "review"
                  ? isPublished
                  : savedSections.includes(
                      step.key as SetupSection
                    );

              return (
                <button
                  type="button"
                  key={step.key}
                  className={`kss-step ${
                    complete ? "complete" : ""
                  } ${
                    selected === step.key ? "selected" : ""
                  }`}
                  onClick={() => open(step.key)}
                >
                  <span className="kss-step-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  <span className="kss-round">
                    {complete ? (
                      <Check size={24} />
                    ) : (
                      <Icon size={23} />
                    )}
                  </span>

                  <strong>{step.name}</strong>
                  <small>{step.description}</small>

                  <span className="kss-stepstatus">
                    {complete
                      ? "Completed"
                      : selected === step.key
                        ? "Editing"
                        : "Pending"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* PUBLICATION STATUS */}
          <p className="kss-note">
            {isPublished
              ? "Shop Published — visible to eligible nearby customers."
              : setupStatus === "pending_review"
                ? "Previously submitted. You can now publish your shop directly."
                : setupStatus === "approved"
                  ? "Shop approval recorded. Publication confirmation is pending."
                  : setupStatus === "rejected"
                    ? "Complete any missing details and publish again."
                    : "Shop Setup is currently in draft."}
          </p>
        </section>

        {setupLoading && (
          <div className="kss-notice">
            Loading Shop Setup...
          </div>
        )}

        {error && (
          <div className="kss-alert" role="alert">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {message && (
          <div className="kss-success" role="status">
            <CheckCircle2 size={17} />
            {message}
          </div>
        )}

        {isPublished && (
          <div className="kss-success">
            <ShieldCheck size={19} />
            <div>
              <strong>Shop Published Successfully</strong>
              <p>
                Your verified shop is eligible to appear
                in customer searches within 15 km.
              </p>
            </div>
          </div>
        )}

        {readOnly && !isPublished && (
          <div className="kss-notice">
            This setup has already been submitted.
            Existing backend rules currently restrict
            editing, but you can use the Publish action
            once all requirements are complete.
          </div>
        )}

        {isPublished && (
          <div className="kss-notice">
            Your shop is currently published.
            Further editing of submitted setup details
            requires the backend update workflow.
          </div>
        )}

        {/* CURRENT STEP */}
        {selected && !setupLoading && (
          <section className="kss-panel">

            <div className="kss-panelhead">
              <div>
                <span className="kss-eyebrow">
                  SHOP CONFIGURATION
                </span>

                <h3>{currentStep?.name}</h3>
                <p>{currentStep?.description}</p>
              </div>

              <button
                type="button"
                className="kss-close"
                onClick={close}
                aria-label="Close form"
              >
                <X size={18} />
              </button>
            </div>

            
<fieldset
  disabled={
    setupSaving ||
    workerSaving ||
    (selected !== "review" && readOnly)
  }
  style={{
    border: 0,
    margin: 0,
    padding: 0,
    minWidth: 0,
  }}
>


              {/* ===========================================
                  STEP 1: BARBER PROFILE
              =========================================== */}

              {selected === "profile" && (
                <>
                  <div className="kss-notice">
                    {profileStatus}
                  </div>

                  <SectionTitle>
                    Personal Information
                  </SectionTitle>

                  <div className="kss-fields">
                    <Field
                      label="Full Name"
                      required
                      value={draft.fullName}
                      onChange={(v) => update("fullName", v)}
                    />

                    <Field
                      label="Professional Display Name"
                      value={draft.displayName}
                      onChange={(v) => update("displayName", v)}
                    />

                    <Field
                      label="Mobile Number"
                      required
                      type="tel"
                      value={draft.phone}
                      onChange={(v) => update("phone", v)}
                    />

                    <Field
                      label="Email Address"
                      type="email"
                      value={draft.email}
                      onChange={(v) => update("email", v)}
                    />

                    <Field
                      label="Years of Experience"
                      required
                      type="number"
                      min={0}
                      max={80}
                      value={draft.experience}
                      onChange={(v) => update("experience", v)}
                    />
                  </div>

                  <SectionTitle>
                    Professional Specializations *
                  </SectionTitle>

                  <ChipSelector
                    options={SPECIALIZATIONS}
                    selected={draft.specializations}
                    onToggle={(v) =>
                      toggleValue("specializations", v)
                    }
                  />

                  <SectionTitle>
                    Languages Spoken
                  </SectionTitle>

                  <ChipSelector
                    options={LANGUAGES}
                    selected={draft.languages}
                    onToggle={(v) =>
                      toggleValue("languages", v)
                    }
                  />

                  <SectionTitle>
                    Professional Biography
                  </SectionTitle>

                  <div className="kss-fields">
                    <TextArea
                      label="About Yourself"
                      value={draft.bio}
                      onChange={(v) => update("bio", v)}
                      placeholder="Tell customers about your expertise."
                    />
                  </div>
                </>
              )}

              {/* ===========================================
                  STEP 2: SHOP DETAILS
              =========================================== */}

              {selected === "shop" && (
                <>
                  <div className="kss-notice">
                    {profileStatus}
                  </div>

                  <SectionTitle>
                    Business Information
                  </SectionTitle>

                  <div className="kss-fields">
                    <Field
                      label="Shop Name"
                      required
                      value={draft.shopName}
                      onChange={(v) => update("shopName", v)}
                    />

                    <SelectField
                      label="Shop Type"
                      value={draft.shopType}
                      options={SHOP_TYPES}
                      onChange={(v) => update("shopType", v)}
                    />

                    <Field
                      label="Shop Phone Number"
                      required
                      type="tel"
                      value={draft.shopPhone}
                      onChange={(v) => update("shopPhone", v)}
                    />

                    <Field
                      label="Business Email"
                      type="email"
                      value={draft.shopEmail}
                      onChange={(v) => update("shopEmail", v)}
                    />

                    <TextArea
                      label="Shop Description"
                      value={draft.description}
                      onChange={(v) => update("description", v)}
                    />
                  </div>

                  <SectionTitle>
                    Shop Address & Location
                  </SectionTitle>

                  <GoogleShopLocation
                    onSelect={onGoogleLocation}
                  />

                  <div className="kss-fields">
                    <Field
                      label="Complete Address"
                      required
                      full
                      value={draft.address}
                      onChange={(v) => update("address", v)}
                    />

                    <Field
                      label="Nearby Landmark"
                      value={draft.landmark}
                      onChange={(v) => update("landmark", v)}
                    />

                    <Field
                      label="City"
                      required
                      value={draft.city}
                      onChange={(v) => update("city", v)}
                    />

                    <Field
                      label="State"
                      required
                      value={draft.state}
                      onChange={(v) => update("state", v)}
                    />

                    <Field
                      label="PIN Code"
                      required
                      value={draft.pincode}
                      onChange={(v) => update("pincode", v)}
                    />
                  </div>

                  <div className="kss-notice">
                    <MapPin size={16} />
                    {locationStatus}
                  </div>

                  {draft.latitude && draft.longitude && (
                    <div className="kss-notice">
                      <p>
                        Latitude: {draft.latitude}
                        {" · "}
                        Longitude: {draft.longitude}
                      </p>

                      <p>
                        Place ID:{" "}
                        {draft.googlePlaceId || "Not selected"}
                      </p>

                      <p>
                        Backend verification:{" "}
                        {backendLocationVerified
                          ? "Verified"
                          : "Pending"}
                      </p>
                    </div>
                  )}

                  <SectionTitle>
                    Working Hours
                  </SectionTitle>

                  <div className="kss-fields">
                    <Field
                      label="Opening Time"
                      required
                      type="time"
                      value={draft.openingTime}
                      onChange={(v) => update("openingTime", v)}
                    />

                    <Field
                      label="Closing Time"
                      required
                      type="time"
                      value={draft.closingTime}
                      onChange={(v) => update("closingTime", v)}
                    />
                  </div>

                  <SectionTitle>
                    Working Days
                  </SectionTitle>

                  <ChipSelector
                    options={DAYS}
                    selected={draft.workingDays}
                    onToggle={(v) =>
                      toggleValue("workingDays", v)
                    }
                  />

                  <SectionTitle>
                    Shop Amenities
                  </SectionTitle>

                  <ChipSelector
                    options={AMENITIES}
                    selected={draft.amenities}
                    onToggle={(v) =>
                      toggleValue("amenities", v)
                    }
                  />
                </>
              )}

              {/* ===========================================
                  STEP 3: WORKERS
              =========================================== */}

              {selected === "workers" && (
                <>
                  <SectionTitle>
                    Shop Workers
                  </SectionTitle>

                  <div className="kss-notice">
                    At least one active worker is required
                    before publishing your shop.
                  </div>

                  <div className="kss-actions">
                    <button
                      type="button"
                      className="kss-outline"
                      disabled={
                        workersLoading || workerSaving
                      }
                      onClick={() => void refreshWorkers()}
                    >
                      <RefreshCw size={16} />
                      Refresh
                    </button>

                    <button
                      type="button"
                      className="kss-outline"
                      onClick={() => navigate("/workers")}
                    >
                      <Users size={16} />
                      Workers Dashboard
                    </button>

                    <button
                      type="button"
                      className="kss-primary"
                      disabled={
                        workersLoading ||
                        workerSaving ||
                        Boolean(workersError)
                      }
                      onClick={() =>
                        setWorkerEditor({ ...EMPTY_WORKER })
                      }
                    >
                      <Plus size={16} />
                      Add Worker
                    </button>
                  </div>

                  {workersLoading && (
                    <div className="kss-notice">
                      Loading workers...
                    </div>
                  )}

                  {workersError && (
                    <div className="kss-alert">
                      {workersError}
                    </div>
                  )}

                  {!workersLoading &&
                    !workersError &&
                    draft.workers.length === 0 && (
                      <div className="kss-notice">
                        No workers added yet.
                      </div>
                    )}

                  {draft.workers.map((worker) => (
                    <div
                      className="kss-worker"
                      key={worker.id}
                    >
                      <div>
                        <strong>{worker.fullName}</strong>

                        <p>
                          {worker.role} · {worker.phone}
                        </p>

                        <p>
                          Shift: {worker.startTime}–
                          {worker.endTime}
                        </p>

                        <p>
                          {worker.active
                            ? "Active"
                            : "Inactive"}
                          {" · "}
                          {worker.experience} years
                          of experience
                        </p>

                        {worker.specializations && (
                          <p>
                            Specializations:{" "}
                            {worker.specializations}
                          </p>
                        )}
                      </div>

                      <div className="kss-worker-actions">
                        <button
                          type="button"
                          className="kss-iconbutton"
                          onClick={() =>
                            setWorkerEditor({ ...worker })
                          }
                        >
                          Edit
                        </button>

                        {worker.active && (
                          <button
                            type="button"
                            className="kss-iconbutton kss-danger"
                            onClick={() =>
                              void deactivateWorker(worker)
                            }
                          >
                            <Trash2 size={15} />
                            Deactivate
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {workerEditor && (
                    <div className="kss-workerform">
                      <div className="kss-panelhead">
                        <div>
                          <h3>
                            {workerEditor.id
                              ? "Edit Worker"
                              : "Add Worker"}
                          </h3>
                          <p>
                            Worker information and shift details
                          </p>
                        </div>

                        <button
                          type="button"
                          className="kss-close"
                          onClick={() => setWorkerEditor(null)}
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div className="kss-fields">
                        <Field
                          label="Worker Full Name"
                          required
                          value={workerEditor.fullName}
                          onChange={(v) =>
                            setWorkerEditor((w) =>
                              w ? { ...w, fullName: v } : w
                            )
                          }
                        />

                        <Field
                          label="Mobile Number"
                          required
                          value={workerEditor.phone}
                          onChange={(v) =>
                            setWorkerEditor((w) =>
                              w ? { ...w, phone: v } : w
                            )
                          }
                        />

                        <SelectField
                          label="Worker Role"
                          value={workerEditor.role}
                          options={WORKER_ROLES}
                          onChange={(v) =>
                            setWorkerEditor((w) =>
                              w ? { ...w, role: v } : w
                            )
                          }
                        />

                        <Field
                          label="Experience (Years)"
                          required
                          type="number"
                          min={0}
                          max={80}
                          value={workerEditor.experience}
                          onChange={(v) =>
                            setWorkerEditor((w) =>
                              w ? { ...w, experience: v } : w
                            )
                          }
                        />

                        <Field
                          label="Specializations"
                          value={workerEditor.specializations}
                          onChange={(v) =>
                            setWorkerEditor((w) =>
                              w
                                ? { ...w, specializations: v }
                                : w
                            )
                          }
                        />

                        <Field
                          label="Shift Start"
                          required
                          type="time"
                          value={workerEditor.startTime}
                          onChange={(v) =>
                            setWorkerEditor((w) =>
                              w ? { ...w, startTime: v } : w
                            )
                          }
                        />

                        <Field
                          label="Shift End"
                          required
                          type="time"
                          value={workerEditor.endTime}
                          onChange={(v) =>
                            setWorkerEditor((w) =>
                              w ? { ...w, endTime: v } : w
                            )
                          }
                        />

                        <SelectField
                          label="Employment Status"
                          value={
                            workerEditor.active
                              ? "Active"
                              : "Inactive"
                          }
                          options={["Active", "Inactive"]}
                          onChange={(v) =>
                            setWorkerEditor((w) =>
                              w
                                ? {
                                    ...w,
                                    active: v === "Active",
                                  }
                                : w
                            )
                          }
                        />
                      </div>

                      <div className="kss-actions">
                        <button
                          type="button"
                          className="kss-outline"
                          onClick={() => setWorkerEditor(null)}
                        >
                          Cancel
                        </button>

                        <button
                          type="button"
                          className="kss-primary"
                          disabled={workerSaving}
                          onClick={() => void saveWorker()}
                        >
                          <Save size={16} />
                          {workerSaving
                            ? "Saving..."
                            : "Save Worker"}
                        </button>
                      </div>
                    </div>
                  )}

                  <p className="kss-helper">
                    Manage worker availability and breaks
                    from the Workers Dashboard.
                  </p>
                </>
              )}

              {/* ===========================================
                  STEP 4: DOCUMENTS
              =========================================== */}

              {selected === "documents" && (
                <>
                  <SectionTitle>
                    Registered Documents
                  </SectionTitle>

                  {registrationImageAvailable && (
                    <div className="kss-document">
                      <div className="kss-document-info">
                        <Store size={20} />
                        <div>
                          <strong>
                            Registered Shop Image
                          </strong>
                          <small>
                            Available in registration storage
                          </small>
                        </div>
                      </div>
                      <Check size={18} color="#22C55E" />
                    </div>
                  )}

                  {registeredDocuments.map(
                    (document, index) => (
                      <div
                        className="kss-document"
                        key={`${document.path}-${index}`}
                      >
                        <div className="kss-document-info">
                          <FileText
                            size={20}
                            color="#F59E0B"
                          />

                          <div>
                            <strong>
                              {document.original_name ||
                                `Document ${index + 1}`}
                            </strong>

                            <small>
                              {document.document_type ||
                                "Registration document"}
                              {" · "}
                              {document.content_type ||
                                "Stored file"}
                            </small>
                          </div>
                        </div>

                        <Check size={18} color="#22C55E" />
                      </div>
                    )
                  )}

                  <SectionTitle>
                    Upload Missing Documents
                  </SectionTitle>

                  <div className="kss-fields">
                    <label className="kss-field">
                      <span>Document Type</span>

                      <select
                        value={documentType}
                        disabled={documentUploading}
                        onChange={(e) =>
                          setDocumentType(e.target.value)
                        }
                      >
                        {DOCUMENT_TYPES.map(([value, label]) => (
                          <option
                            key={value}
                            value={value}
                          >
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="kss-field">
                      <span>
                        Choose Document (PDF, JPG,
                        PNG, WebP; max 5 MB)
                      </span>

                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        disabled={documentUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";

                          if (file) {
                            void uploadDocument(file);
                          }
                        }}
                      />
                    </label>
                  </div>
                </>
              )}

              {/* ===========================================
                  STEP 5: CAPACITY
              =========================================== */}

              {selected === "capacity" && (
                <>
                  <SectionTitle>
                    Shop Seating Capacity
                  </SectionTitle>

                  <div className="kss-fields">
                    <Field
                      label="Total Chairs"
                      required
                      type="number"
                      min={1}
                      value={draft.chairs}
                      onChange={(v) => update("chairs", v)}
                    />

                    <Field
                      label="Active Chairs"
                      required
                      type="number"
                      min={1}
                      value={draft.activeChairs}
                      onChange={(v) =>
                        update("activeChairs", v)
                      }
                    />

                    <Field
                      label="Simultaneous Bookings"
                      required
                      type="number"
                      min={1}
                      value={draft.simultaneousBookings}
                      onChange={(v) =>
                        update("simultaneousBookings", v)
                      }
                    />

                    <Field
                      label="Appointment Duration (minutes)"
                      required
                      type="number"
                      min={1}
                      value={draft.appointmentDuration}
                      onChange={(v) =>
                        update("appointmentDuration", v)
                      }
                    />
                  </div>

                  <SectionTitle>
                    Booking Rules
                  </SectionTitle>

                  <div className="kss-fields">
                    <Field
                      label="Buffer Between Bookings (minutes)"
                      type="number"
                      min={0}
                      value={draft.bufferMinutes}
                      onChange={(v) =>
                        update("bufferMinutes", v)
                      }
                    />

                    <Field
                      label="Minimum Advance Notice (hours)"
                      type="number"
                      min={0}
                      value={draft.advanceNoticeHours}
                      onChange={(v) =>
                        update("advanceNoticeHours", v)
                      }
                    />

                    <Field
                      label="Booking Window (days)"
                      type="number"
                      min={1}
                      value={draft.bookingWindowDays}
                      onChange={(v) =>
                        update("bookingWindowDays", v)
                      }
                    />
                  </div>

                  <SectionTitle>
                    Lunch Break (Optional)
                  </SectionTitle>

                  <div className="kss-fields">
                    <Field
                      label="Lunch Start"
                      type="time"
                      value={draft.lunchStart}
                      onChange={(v) =>
                        update("lunchStart", v)
                      }
                    />

                    <Field
                      label="Lunch End"
                      type="time"
                      value={draft.lunchEnd}
                      onChange={(v) =>
                        update("lunchEnd", v)
                      }
                    />
                  </div>
                </>
              )}

              {/* ===========================================
                  STEP 6: REVIEW & PUBLISH
              =========================================== */}

              {selected === "review" && (
                <>
                  <SectionTitle>
                    Review Your Shop Setup
                  </SectionTitle>

                  <div className="kss-recap">
                    <div className="kss-recapitem">
                      <h4>
                        <UserRound size={17} />
                        Barber Profile
                      </h4>
                      <p>
                        {draft.fullName || "Not provided"}
                      </p>
                      <p>{draft.phone}</p>
                    </div>

                    <div className="kss-recapitem">
                      <h4>
                        <Store size={17} />
                        Shop Details
                      </h4>
                      <p>
                        {draft.shopName || "Not provided"}
                      </p>
                      <p>
                        {draft.address || "Address missing"}
                      </p>
                    </div>

                    <div className="kss-recapitem">
                      <h4>
                        <Users size={17} />
                        Workers
                      </h4>
                      <p>
                        {
                          draft.workers.filter(
                            (worker) => worker.active
                          ).length
                        }{" "}
                        active workers
                      </p>
                    </div>

                    <div className="kss-recapitem">
                      <h4>
                        <FileText size={17} />
                        Documents
                      </h4>
                      <p>
                        {registeredDocuments.length}{" "}
                        registered documents
                      </p>
                    </div>

                    <div className="kss-recapitem">
                      <h4>
                        <Clock3 size={17} />
                        Capacity
                      </h4>
                      <p>
                        {draft.chairs || "0"} total chairs
                      </p>
                      <p>
                        {draft.activeChairs || "0"}{" "}
                        active chairs
                      </p>
                    </div>

                    <div className="kss-recapitem">
                      <h4>
                        <MapPin size={17} />
                        Location Verification
                      </h4>
                      <p>
                        {backendLocationVerified
                          ? "Verified by backend"
                          : "Verification pending"}
                      </p>
                    </div>
                  </div>

                  <SectionTitle>
                    Shop Publication
                  </SectionTitle>

                  {isPublished ? (
                    <div className="kss-success">
                      <CheckCircle2 size={20} />
                      <div>
                        <strong>
                          Your shop is published!
                        </strong>
                        <p>
                          Eligible customers within 15 km
                          can discover your shop.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="kss-notice">
                        <ShieldCheck size={18} />
                        After your barber account has been
                        approved and activated, you can
                        publish your completed shop directly.
                        All required details and the location
                        must be verified by the backend.
                      </div>

                      <label
                        className="kss-field"
                        style={{
                          flexDirection: "row",
                          alignItems: "flex-start",
                          marginTop: 16,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={draft.acceptsTerms}
                          disabled={setupSaving}
                          onChange={(e) =>
                            update(
                              "acceptsTerms",
                              e.target.checked
                            )
                          }
                        />

                        <span>
                          I confirm my shop details and
                          documents are accurate, and I
                          agree to publish this information
                          for nearby customers.
                        </span>
                      </label>

                      <div className="kss-actions">
                        <button
                          type="button"
                          className="kss-primary"
                          disabled={!canPublish}
                          onClick={() => void handlePublish()}
                        >
                          <ClipboardCheck size={17} />

                          {setupSaving
                            ? "Publishing..."
                            : "Publish My Shop"}
                        </button>
                      </div>

                      {!canPublish && (
                        <p className="kss-helper">
                          Complete all five setup sections,
                          verify your location, and accept
                          the declaration to enable
                          publishing.
                        </p>
                      )}
                    </>
                  )}

                  <div className="kss-actions">
                    <button
                      type="button"
                      className="kss-outline"
                      disabled={setupLoading}
                      onClick={() => void loadSetup()}
                    >
                      <RefreshCw size={16} />
                      Refresh Publication Status
                    </button>
                  </div>
                </>
              )}
            </fieldset>

            {/* FORM ACTIONS */}
            {selected !== "review" && (
              <div className="kss-actions kss-bottom-actions">
                <button
                  type="button"
                  className="kss-outline"
                  disabled={setupSaving || workerSaving}
                  onClick={previous}
                >
                  <ArrowLeft size={16} />
                  Previous
                </button>

                <button
                  type="button"
                  className="kss-outline"
                  disabled={
                    setupSaving ||
                    setupLoading ||
                    readOnly
                  }
                  onClick={() => void saveSection(false)}
                >
                  <Save size={16} />
                  {setupSaving
                    ? "Saving..."
                    : "Save Draft"}
                </button>

                <button
                  type="button"
                  className="kss-primary"
                  disabled={
                    setupSaving ||
                    setupLoading ||
                    readOnly
                  }
                  onClick={() => void saveSection(true)}
                >
                  Save & Next
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
