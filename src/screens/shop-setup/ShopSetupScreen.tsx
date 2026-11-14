
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Store,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react-native";
import { COLORS } from "../../constants/colors";
import {
  createShopSetupWorker,
  getShopSetup,
  getShopSetupProfile,
  getShopSetupWorkers,
  saveShopSetup,
  setShopSetupWorkerActive,
  submitShopSetup,
  toShopSetupWorkerPayload,
  updateShopSetupWorker,
  uploadShopSetupDocument,
  type BarberProfileResponse,
  type RegistrationDocument,
  type SavedShopSetup,
  type SetupSection,
  type ShopSetupWorker,
  type SubmissionStatus,
  type WorkerFormValues,
} from "../../services/shopSetupApi";

type StepKey = SetupSection | "review";
type Props = {
  onBack: () => void;
  onWorkers?: () => void;
};

type Draft = {
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

type DraftStringKey = {
  [K in keyof Draft]: Draft[K] extends string ? K : never;
}[keyof Draft];

type DraftArrayKey =
  | "specializations"
  | "languages"
  | "workingDays"
  | "amenities";

type Place = {
  id: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  latitude: string;
  longitude: string;
};

const GOOGLE_KEY = (
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || ""
).trim();

const STEPS: {
  key: StepKey;
  title: string;
  description: string;
}[] = [
  { key: "profile", title: "Barber Profile", description: "Professional details" },
  { key: "shop", title: "Shop Details", description: "Business and location" },
  { key: "workers", title: "Workers", description: "Your team members" },
  { key: "documents", title: "Documents", description: "Verification files" },
  { key: "capacity", title: "Capacity", description: "Booking availability" },
  { key: "review", title: "Review & Publish", description: "Admin approval" },
];

const REQUIRED: SetupSection[] = [
  "profile", "shop", "workers", "documents", "capacity",
];

const SPECIALIZATIONS = [
  "Haircut", "Hair Styling", "Skin Fade", "Beard Trim",
  "Royal Shave", "Hair Colouring", "Hair Spa",
  "Kids Haircut", "Grooming",
];

const LANGUAGES = [
  "English", "Hindi", "Telugu", "Tamil",
  "Kannada", "Malayalam", "Urdu",
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const AMENITIES = [
  "Air Conditioning", "Wi-Fi", "Parking", "Waiting Area",
  "Digital Payments", "Wheelchair Access",
  "Drinking Water", "Washroom",
];

const SHOP_TYPES = [
  "Unisex Salon", "Men's Barber Shop",
  "Women's Salon", "Premium Grooming Studio",
];

const DOCUMENT_TYPES = [
  { id: "trade_license", title: "Trade License / Shop Registration" },
  { id: "address_proof", title: "Business Address Proof" },
  { id: "identity_proof", title: "Identity Verification Document" },
  { id: "professional_certificate", title: "Professional Certificate" },
  { id: "other", title: "Other Supporting Document" },
];

const EMPTY_DRAFT: Draft = {
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

const EMPTY_WORKER: WorkerFormValues = {
  fullName: "",
  phone: "",
  role: "Barber",
  experience: "0",
  specializations: "",
  startTime: "09:00",
  endTime: "18:00",
  active: true,
};

function validPhone(value: string): boolean {
  return (
    /^[0-9+\-\s()]{10,20}$/.test(value.trim()) &&
    value.replace(/\D/g, "").length >= 10 &&
    value.replace(/\D/g, "").length <= 15
  );
}

function validEmail(value: string): boolean {
  return !value.trim() ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function positive(value: string): boolean {
  return /^\d+$/.test(value.trim()) && Number(value) > 0;
}

function nonnegative(value: string): boolean {
  return /^\d+$/.test(value.trim()) && Number(value) >= 0;
}

function validHours(start: string, end: string): boolean {
  return /^\d{2}:\d{2}$/.test(start) &&
    /^\d{2}:\d{2}$/.test(end) &&
    start < end;
}

function hydrateDraft(
  data: Record<string, unknown>,
  profile?: BarberProfileResponse
): Draft {
  const draft: Draft = {
    ...EMPTY_DRAFT,
    workingDays: [...EMPTY_DRAFT.workingDays],
    ...data,
    acceptsTerms: false,
  } as Draft;

  for (const key of [
    "specializations", "languages", "workingDays", "amenities",
  ] as DraftArrayKey[]) {
    if (!Array.isArray(draft[key])) {
      draft[key] = [...EMPTY_DRAFT[key]];
    }
  }

  if (profile) {
    draft.displayName ||= profile.username;
    draft.email ||= profile.email;
    draft.experience ||= String(profile.years_experience);
    draft.shopName ||= profile.shop_name || "";
    draft.shopPhone ||= profile.shop_phone || "";
    draft.shopEmail ||= profile.email;
    draft.address ||= profile.shop_address || "";
  }

  return draft;
}

function getAddressPart(
  parts: Array<{
    types: string[];
    longText?: string;
  }>,
  type: string
): string {
  return parts.find((item) => item.types.includes(type))?.longText || "";
}

// Google Places API (New) search.
// The backend independently verifies the selected Place ID on save.
async function searchGooglePlaces(query: string): Promise<
  Array<{ id: string; label: string }>
> {
  if (!GOOGLE_KEY) {
    throw new Error(
      "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not configured."
    );
  }

  const response = await fetch(
    "https://places.googleapis.com/v1/places:autocomplete",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_KEY,
      },
      body: JSON.stringify({
        input: query,
        includedRegionCodes: ["in"],
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      data?.error?.message || "Google Places search failed."
    );
  }

  return (data.suggestions || [])
    .filter((item: any) => item.placePrediction?.placeId)
    .map((item: any) => ({
      id: String(item.placePrediction.placeId),
      label: String(
        item.placePrediction.text?.text || item.placePrediction.placeId
      ),
    }));
}

async function getGooglePlace(placeId: string): Promise<Place> {
  if (!GOOGLE_KEY) {
    throw new Error("Google Maps API key is missing.");
  }

  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask":
          "id,formattedAddress,location,addressComponents",
      },
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Unable to load place.");
  }

  if (!data.id || !data.location) {
    throw new Error("Google Places returned an incomplete location.");
  }

  const parts = Array.isArray(data.addressComponents)
    ? data.addressComponents
    : [];

  const city =
    getAddressPart(parts, "locality") ||
    getAddressPart(parts, "administrative_area_level_3") ||
    getAddressPart(parts, "administrative_area_level_2");

  return {
    id: String(data.id),
    address: String(data.formattedAddress || ""),
    latitude: String(data.location.latitude),
    longitude: String(data.location.longitude),
    city,
    state: getAddressPart(parts, "administrative_area_level_1"),
    pincode: getAddressPart(parts, "postal_code"),
  };
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  keyboardType?: "default" | "numeric" | "phone-pad" | "email-address";
  multiline?: boolean;
  editable?: boolean;
};

function Field({
  label, value, onChange, placeholder,
  required = false,
  keyboardType = "default",
  multiline = false,
  editable = true,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        style={[
          styles.input,
          multiline && styles.multilineInput,
          !editable && styles.disabledInput,
        ]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder || label}
        placeholderTextColor={COLORS.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        autoCorrect={false}
        selectionColor={COLORS.primary}
        textAlignVertical={multiline ? "top" : "center"}
      />
    </View>
  );
}

function ChipSelector({
  options, selected, onToggle, disabled = false,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <Pressable
            key={option}
            disabled={disabled}
            onPress={() => onToggle(option)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[
              styles.chipText,
              active && styles.chipTextActive,
            ]}>
              {active ? "✓  " : "+  "}{option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function ActionButton({
  title, onPress, primary = false, disabled = false, icon,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.actionButton,
        primary && styles.primaryButton,
        disabled && styles.disabledButton,
      ]}
    >
      {icon}
      <Text style={[
        styles.actionText,
        primary && styles.primaryText,
      ]}>
        {title}
      </Text>
    </Pressable>
  );
}

export default function ShopSetupScreen({
  onBack,
  onWorkers,
}: Props) {
  const [step, setStep] = useState<StepKey>("profile");
  const [draft, setDraft] = useState<Draft>(() => hydrateDraft({}));
  const [profile, setProfile] = useState<BarberProfileResponse | null>(null);
  const [workers, setWorkers] = useState<ShopSetupWorker[]>([]);
  const [documents, setDocuments] = useState<RegistrationDocument[]>([]);
  const [completedSections, setCompletedSections] =
    useState<SetupSection[]>([]);
  const [submissionStatus, setSubmissionStatus] =
    useState<SubmissionStatus>("draft");
  const [locationVerified, setLocationVerified] = useState(false);
  const [shopImageAvailable, setShopImageAvailable] = useState(false);
  const [applicationId, setApplicationId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [workerSaving, setWorkerSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [workerEditor, setWorkerEditor] =
    useState<WorkerFormValues | null>(null);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);

  const [documentType, setDocumentType] =
    useState("trade_license");

  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] =
    useState<Array<{ id: string; label: string }>>([]);
  const [placeLoading, setPlaceLoading] = useState(false);

  const readOnly =
    submissionStatus === "pending_review" ||
    submissionStatus === "approved";

  const completedCount = REQUIRED.filter((item) =>
    completedSections.includes(item)
  ).length;

  const progress = Math.round((completedCount / 5) * 100);

  const canSubmit =
    completedCount === 5 &&
    locationVerified &&
    draft.acceptsTerms &&
    !readOnly &&
    !saving &&
    !loading;

  const selectedIndex = STEPS.findIndex((item) => item.key === step);

  const applySetup = useCallback((result: SavedShopSetup) => {
    setCompletedSections(result.completed_sections || []);
    setSubmissionStatus(result.submission_status || "draft");
    setLocationVerified(Boolean(result.location_verified));
    setDocuments(result.registration_documents || []);
    setShopImageAvailable(Boolean(result.shop_image_path));
    setApplicationId(result.application_id);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [setup, currentProfile, currentWorkers] = await Promise.all([
        getShopSetup(),
        getShopSetupProfile(),
        getShopSetupWorkers(),
      ]);

      setProfile(currentProfile);
      setWorkers(currentWorkers);
      setDraft(hydrateDraft(setup.setup_data, currentProfile));
      applySetup(setup);
      setMessage("");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unable to load Shop Setup."
      );
    } finally {
      setLoading(false);
    }
  }, [applySetup]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const update = (key: DraftStringKey, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
    setError("");
  };

  const toggleArray = (key: DraftArrayKey, value: string) => {
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));
    setMessage("");
    setError("");
  };

  const pickPlace = async (placeId: string) => {
    setPlaceLoading(true);
    setError("");

    try {
      const place = await getGooglePlace(placeId);
      setDraft((current) => ({
        ...current,
        address: place.address,
        city: place.city,
        state: place.state,
        pincode: place.pincode,
        latitude: place.latitude,
        longitude: place.longitude,
        googlePlaceId: place.id,
      }));
      setLocationVerified(false);
      setPlaceQuery(place.address);
      setPlaceResults([]);
      setMessage("Location selected. Save Shop Details to verify it.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Location failed.");
    } finally {
      setPlaceLoading(false);
    }
  };

  const findPlaces = async () => {
    if (placeQuery.trim().length < 3) {
      setError("Enter at least 3 characters to search Google Places.");
      return;
    }

    setPlaceLoading(true);
    setError("");

    try {
      setPlaceResults(await searchGooglePlaces(placeQuery.trim()));
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unable to search locations."
      );
    } finally {
      setPlaceLoading(false);
    }
  };

  const openMaps = async () => {
    const address = [
      draft.shopName, draft.address, draft.city,
      draft.state, draft.pincode,
    ].filter(Boolean).join(", ");

    if (!address) return;

    try {
      await Linking.openURL(
        "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(address)
      );
    } catch {
      Alert.alert("Google Maps", "Unable to open Google Maps.");
    }
  };

  const checkSection = (key: SetupSection): boolean => {
    if (key === "profile") {
      return (
        draft.fullName.trim().length >= 2 &&
        validPhone(draft.phone) &&
        nonnegative(draft.experience) &&
        Number(draft.experience) <= 80 &&
        draft.specializations.length > 0 &&
        validEmail(draft.email)
      );
    }

    if (key === "shop") {
      return (
        draft.shopName.trim().length >= 2 &&
        validPhone(draft.shopPhone) &&
        validEmail(draft.shopEmail) &&
        draft.address.trim().length >= 10 &&
        Boolean(draft.city.trim() && draft.state.trim()) &&
        /^\d{6}$/.test(draft.pincode) &&
        validHours(draft.openingTime, draft.closingTime) &&
        draft.workingDays.length > 0 &&
        Boolean(
          draft.googlePlaceId &&
          draft.latitude &&
          draft.longitude
        )
      );
    }

    if (key === "workers") {
      return workers.some((worker) => worker.is_active);
    }

    if (key === "documents") {
      return documents.length > 0;
    }

    return (
      positive(draft.chairs) &&
      positive(draft.activeChairs) &&
      Number(draft.activeChairs) <= Number(draft.chairs) &&
      positive(draft.simultaneousBookings) &&
      Number(draft.simultaneousBookings) <= Number(draft.activeChairs) &&
      positive(draft.appointmentDuration) &&
      nonnegative(draft.bufferMinutes) &&
      nonnegative(draft.advanceNoticeHours) &&
      positive(draft.bookingWindowDays) &&
      (
        (!draft.lunchStart && !draft.lunchEnd) ||
        validHours(draft.lunchStart, draft.lunchEnd)
      )
    );
  };

  const saveSection = async (next = false) => {
    if (saving || readOnly || step === "review") return;

    if (!checkSection(step)) {
      setError(
        step === "shop"
          ? "Complete shop details and select a Google Maps location."
          : "Please complete all required fields for this section."
      );
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const { acceptsTerms, ...fields } = draft;
      void acceptsTerms;

      const result = await saveShopSetup(fields);
      applySetup(result);

      setDraft((current) => ({
        ...current,
        ...(result.setup_data as Partial<Draft>),
        acceptsTerms: current.acceptsTerms,
      }));

      setMessage("Shop Setup saved successfully to the backend.");

      if (next) {
        setStep(STEPS[Math.min(selectedIndex + 1, 5)].key);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const refreshWorkers = async () => {
    const result = await getShopSetupWorkers();
    setWorkers(result);
    const setup = await getShopSetup();
    applySetup(setup);
  };

  const saveWorker = async () => {
    if (!workerEditor || readOnly || workerSaving) return;

    if (
      workerEditor.fullName.trim().length < 2 ||
      !validPhone(workerEditor.phone) ||
      !nonnegative(workerEditor.experience) ||
      Number(workerEditor.experience) > 80 ||
      !validHours(workerEditor.startTime, workerEditor.endTime)
    ) {
      setError("Enter a valid worker name, phone, experience and shift.");
      return;
    }

    setWorkerSaving(true);
    setError("");

    try {
      const payload = toShopSetupWorkerPayload(workerEditor);

      if (editingWorkerId) {
        await updateShopSetupWorker(editingWorkerId, payload);
      } else {
        await createShopSetupWorker(payload);
      }

      await refreshWorkers();
      setWorkerEditor(null);
      setEditingWorkerId(null);
      setMessage("Worker saved successfully.");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unable to save worker."
      );
    } finally {
      setWorkerSaving(false);
    }
  };

  const editWorker = (worker: ShopSetupWorker) => {
    setEditingWorkerId(worker.id);
    setWorkerEditor({
      fullName: worker.full_name,
      phone: worker.phone,
      role: worker.role,
      experience: String(worker.years_experience),
      specializations: worker.specializations || "",
      startTime: worker.shift_start.slice(0, 5),
      endTime: worker.shift_end.slice(0, 5),
      active: worker.is_active,
    });
  };

  const deactivateWorker = (worker: ShopSetupWorker) => {
    Alert.alert(
      "Deactivate Worker",
      `Deactivate ${worker.full_name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deactivate",
          style: "destructive",
          onPress: () => {
            setWorkerSaving(true);
            void setShopSetupWorkerActive(worker.id, false)
              .then(refreshWorkers)
              .then(() => setMessage("Worker deactivated."))
              .catch((err: unknown) =>
                setError(err instanceof Error ? err.message : "Failed.")
              )
              .finally(() => setWorkerSaving(false));
          },
        },
      ]
    );
  };

  const uploadDocument = async () => {
    if (uploading || readOnly) return;

    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (selected.canceled || !selected.assets.length) return;

      const file = selected.assets[0];
      setUploading(true);
      setError("");

      const result = await uploadShopSetupDocument(
        {
          uri: file.uri,
          name: file.name,
          mimeType: file.mimeType || "application/pdf",
          size: file.size,
        },
        documentType
      );

      setDocuments(result.registration_documents);
      applySetup(await getShopSetup());
      setMessage("Document uploaded to the backend successfully.");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Document upload failed."
      );
    } finally {
      setUploading(false);
    }
  };

  const publish = async () => {
    if (!canSubmit) return;

    setSaving(true);
    setError("");

    try {
      const result = await submitShopSetup();
      applySetup(result);
      setMessage("Shop Setup submitted for admin review.");
      Alert.alert(
        "Submitted",
        "Your shop setup has been submitted for admin review."
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Submission failed."
      );
    } finally {
      setSaving(false);
    }
  };

  const saveWorkerField = (
    key: keyof WorkerFormValues,
    value: string | boolean
  ) => {
    setWorkerEditor((current) =>
      current ? { ...current, [key]: value } : null
    );
  };

  const renderProfile = () => (
    <View style={styles.card}>
      <SectionTitle>Personal Information</SectionTitle>
      <Field label="Full Name" required value={draft.fullName}
        editable={!readOnly} onChange={(v) => update("fullName", v)} />
      <Field label="Professional Display Name" value={draft.displayName}
        editable={!readOnly} onChange={(v) => update("displayName", v)} />
      <Field label="Mobile Number" required keyboardType="phone-pad"
        value={draft.phone} editable={!readOnly}
        onChange={(v) => update("phone", v)} />
      <Field label="Email Address" keyboardType="email-address"
        value={draft.email} editable={!readOnly}
        onChange={(v) => update("email", v)} />
      <Field label="Years of Experience" required keyboardType="numeric"
        value={draft.experience} editable={!readOnly}
        onChange={(v) => update("experience", v)} />

      <SectionTitle>Professional Specializations *</SectionTitle>
      <ChipSelector options={SPECIALIZATIONS}
        selected={draft.specializations} disabled={readOnly}
        onToggle={(v) => toggleArray("specializations", v)} />

      <SectionTitle>Languages Spoken</SectionTitle>
      <ChipSelector options={LANGUAGES}
        selected={draft.languages} disabled={readOnly}
        onToggle={(v) => toggleArray("languages", v)} />

      <Field label="Professional Bio" multiline value={draft.bio}
        editable={!readOnly} onChange={(v) => update("bio", v)} />
    </View>
  );

  const renderShop = () => (
    <View style={styles.card}>
      <SectionTitle>Business Information</SectionTitle>
      <Field label="Shop Name" required value={draft.shopName}
        editable={!readOnly} onChange={(v) => update("shopName", v)} />
      <Field label="Shop Phone" required keyboardType="phone-pad"
        value={draft.shopPhone} editable={!readOnly}
        onChange={(v) => update("shopPhone", v)} />
      <Field label="Shop Email" keyboardType="email-address"
        value={draft.shopEmail} editable={!readOnly}
        onChange={(v) => update("shopEmail", v)} />

      <Text style={styles.fieldLabel}>Shop Type</Text>
      <ChipSelector options={SHOP_TYPES}
        selected={[draft.shopType]}
        disabled={readOnly}
        onToggle={(v) => update("shopType", v)} />

      <Field label="Shop Description" value={draft.description}
        multiline editable={!readOnly}
        onChange={(v) => update("description", v)} />

      <SectionTitle>Google Maps Location *</SectionTitle>
      <Text style={styles.help}>
        Search and select a Google Place. The server validates
        the Place ID and coordinates when you save.
      </Text>

      {!readOnly && (
        <>
          <Field label="Search Google Places" value={placeQuery}
            onChange={setPlaceQuery}
            placeholder="Shop name, street or locality..." />
          <ActionButton
            title={placeLoading ? "Searching..." : "Search Places"}
            disabled={placeLoading}
            onPress={() => void findPlaces()}
            icon={<MapPin size={16} color={COLORS.text} />}
          />
          {placeResults.map((place) => (
            <Pressable
              key={place.id}
              style={styles.placeResult}
              onPress={() => void pickPlace(place.id)}
            >
              <MapPin size={17} color={COLORS.primary} />
              <Text style={styles.placeText}>{place.label}</Text>
              <ChevronRight size={17} color={COLORS.textSecondary} />
            </Pressable>
          ))}
        </>
      )}

      <Field label="Complete Address" required value={draft.address}
        editable={false} onChange={() => {}} />
      <Field label="City" required value={draft.city}
        editable={false} onChange={() => {}} />
      <Field label="State" required value={draft.state}
        editable={false} onChange={() => {}} />
      <Field label="PIN Code" required value={draft.pincode}
        editable={!readOnly}
        keyboardType="numeric"
        onChange={(v) => update("pincode", v)} />
      <Field label="Landmark" value={draft.landmark}
        editable={!readOnly} onChange={(v) => update("landmark", v)} />

      <View style={styles.infoBox}>
        <MapPin size={17} color={COLORS.primary} />
        <Text style={styles.infoText}>
          {locationVerified
            ? "Location verified by the backend."
            : draft.googlePlaceId
            ? "Place selected. Save this section for backend verification."
            : "Select a location using Google Places."}
        </Text>
      </View>

      <ActionButton
        title="View Location in Google Maps"
        onPress={() => void openMaps()}
        icon={<MapPin size={16} color={COLORS.text} />}
      />

      <SectionTitle>Working Hours</SectionTitle>
      <Field label="Opening Time (HH:MM)" required
        value={draft.openingTime} editable={!readOnly}
        onChange={(v) => update("openingTime", v)} />
      <Field label="Closing Time (HH:MM)" required
        value={draft.closingTime} editable={!readOnly}
        onChange={(v) => update("closingTime", v)} />

      <SectionTitle>Working Days *</SectionTitle>
      <ChipSelector options={DAYS} selected={draft.workingDays}
        disabled={readOnly}
        onToggle={(v) => toggleArray("workingDays", v)} />

      <SectionTitle>Shop Amenities</SectionTitle>
      <ChipSelector options={AMENITIES}
        selected={draft.amenities} disabled={readOnly}
        onToggle={(v) => toggleArray("amenities", v)} />
    </View>
  );

  const renderWorkers = () => (
    <View style={styles.card}>
      <SectionTitle>Workers Management</SectionTitle>
      <Text style={styles.help}>
        Workers are saved directly to PostgreSQL.
        At least one active worker is required.
      </Text>

      {workers.map((worker) => (
        <View key={worker.id} style={styles.workerCard}>
          <View style={styles.workerHeading}>
            <View style={styles.workerAvatar}>
              <Users size={20} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.workerName}>{worker.full_name}</Text>
              <Text style={styles.workerMeta}>
                {worker.role} · {worker.phone}
              </Text>
              <Text style={styles.workerMeta}>
                {worker.shift_start.slice(0, 5)}
                {" – "}
                {worker.shift_end.slice(0, 5)}
              </Text>
            </View>
            <Text style={[
              styles.workerStatus,
              !worker.is_active && styles.inactiveStatus,
            ]}>
              {worker.is_active ? "Active" : "Inactive"}
            </Text>
          </View>

          {!readOnly && (
            <View style={styles.workerActions}>
              <ActionButton
                title="Edit"
                onPress={() => editWorker(worker)}
              />
              {worker.is_active && (
                <ActionButton
                  title="Deactivate"
                  disabled={workerSaving}
                  onPress={() => deactivateWorker(worker)}
                  icon={<Trash2 size={15} color={COLORS.error} />}
                />
              )}
            </View>
          )}
        </View>
      ))}

      {!readOnly && !workerEditor && (
        <ActionButton
          title="Add New Worker"
          onPress={() => {
            setEditingWorkerId(null);
            setWorkerEditor({ ...EMPTY_WORKER });
          }}
          primary
          icon={<Plus size={16} color={COLORS.black} />}
        />
      )}

      {workerEditor && !readOnly && (
        <View style={styles.editor}>
          <View style={styles.editorHead}>
            <Text style={styles.sectionTitle}>
              {editingWorkerId ? "Edit Worker" : "New Worker"}
            </Text>
            <Pressable onPress={() => setWorkerEditor(null)}>
              <X size={21} color={COLORS.text} />
            </Pressable>
          </View>

          <Field label="Full Name" required
            value={workerEditor.fullName}
            onChange={(v) => saveWorkerField("fullName", v)} />
          <Field label="Phone" required keyboardType="phone-pad"
            value={workerEditor.phone}
            onChange={(v) => saveWorkerField("phone", v)} />
          <Field label="Role" value={workerEditor.role}
            onChange={(v) => saveWorkerField("role", v)} />
          <Field label="Experience" required keyboardType="numeric"
            value={workerEditor.experience}
            onChange={(v) => saveWorkerField("experience", v)} />
          <Field label="Specializations"
            value={workerEditor.specializations}
            onChange={(v) => saveWorkerField("specializations", v)} />
          <Field label="Shift Start (HH:MM)"
            value={workerEditor.startTime}
            onChange={(v) => saveWorkerField("startTime", v)} />
          <Field label="Shift End (HH:MM)"
            value={workerEditor.endTime}
            onChange={(v) => saveWorkerField("endTime", v)} />

          <View style={styles.switchRow}>
            <Text style={styles.fieldLabel}>Active Worker</Text>
            <Switch
              value={workerEditor.active}
              onValueChange={(v) => saveWorkerField("active", v)}
              trackColor={{
                false: COLORS.borderLight,
                true: COLORS.primary,
              }}
            />
          </View>

          <ActionButton
            title={workerSaving ? "Saving..." : "Save Worker"}
            primary
            disabled={workerSaving}
            onPress={() => void saveWorker()}
          />
        </View>
      )}

      {onWorkers && (
        <ActionButton
          title="Open Worker Management"
          onPress={onWorkers}
        />
      )}
    </View>
  );

  const renderDocuments = () => (
    <View style={styles.card}>
      <SectionTitle>Business Verification Documents</SectionTitle>
      <Text style={styles.help}>
        Supported formats: PDF, JPEG, PNG and WebP.
        Maximum 5 MB per file and 10 documents per account.
      </Text>

      {documents.map((document, index) => (
        <View key={`${document.path}-${index}`} style={styles.documentRow}>
          <FileText size={21} color={COLORS.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.documentName}>
              {document.original_name || "Uploaded Document"}
            </Text>
            <Text style={styles.workerMeta}>
              {document.document_type || "Supporting document"}
            </Text>
          </View>
          <CheckCircle2 size={19} color={COLORS.success} />
        </View>
      ))}

      {shopImageAvailable && (
        <View style={styles.infoBox}>
          <CheckCircle2 size={17} color={COLORS.success} />
          <Text style={styles.infoText}>
            Registration shop image is available.
          </Text>
        </View>
      )}

      {!readOnly && (
        <>
          <SectionTitle>Document Type</SectionTitle>
          <View style={styles.chips}>
            {DOCUMENT_TYPES.map((type) => (
              <Pressable
                key={type.id}
                onPress={() => setDocumentType(type.id)}
                style={[
                  styles.chip,
                  documentType === type.id && styles.chipActive,
                ]}
              >
                <Text style={[
                  styles.chipText,
                  documentType === type.id && styles.chipTextActive,
                ]}>
                  {type.title}
                </Text>
              </Pressable>
            ))}
          </View>

          <ActionButton
            title={uploading ? "Uploading..." : "Select & Upload Document"}
            primary
            disabled={uploading || saving}
            onPress={() => void uploadDocument()}
            icon={<Plus size={16} color={COLORS.black} />}
          />
        </>
      )}
    </View>
  );

  const renderCapacity = () => (
    <View style={styles.card}>
      <SectionTitle>Shop Capacity</SectionTitle>
      <Field label="Total Chairs" required keyboardType="numeric"
        value={draft.chairs} editable={!readOnly}
        onChange={(v) => update("chairs", v)} />
      <Field label="Active Chairs" required keyboardType="numeric"
        value={draft.activeChairs} editable={!readOnly}
        onChange={(v) => update("activeChairs", v)} />
      <Field label="Simultaneous Bookings" required keyboardType="numeric"
        value={draft.simultaneousBookings} editable={!readOnly}
        onChange={(v) => update("simultaneousBookings", v)} />
      <Field label="Appointment Duration (Minutes)" required
        keyboardType="numeric" value={draft.appointmentDuration}
        editable={!readOnly}
        onChange={(v) => update("appointmentDuration", v)} />
      <Field label="Buffer Between Appointments (Minutes)"
        keyboardType="numeric" value={draft.bufferMinutes}
        editable={!readOnly}
        onChange={(v) => update("bufferMinutes", v)} />
      <Field label="Advance Notice (Hours)" keyboardType="numeric"
        value={draft.advanceNoticeHours} editable={!readOnly}
        onChange={(v) => update("advanceNoticeHours", v)} />
      <Field label="Booking Window (Days)" keyboardType="numeric"
        value={draft.bookingWindowDays} editable={!readOnly}
        onChange={(v) => update("bookingWindowDays", v)} />
      <Field label="Lunch Break Start (HH:MM)"
        value={draft.lunchStart} editable={!readOnly}
        onChange={(v) => update("lunchStart", v)} />
      <Field label="Lunch Break End (HH:MM)"
        value={draft.lunchEnd} editable={!readOnly}
        onChange={(v) => update("lunchEnd", v)} />

      <View style={styles.infoBox}>
        <Clock3 size={17} color={COLORS.primary} />
        <Text style={styles.infoText}>
          Active chairs cannot exceed total chairs.
          Simultaneous bookings cannot exceed active chairs.
        </Text>
      </View>
    </View>
  );

  const renderReview = () => (
    <View style={styles.card}>
      <SectionTitle>Review Your Shop Setup</SectionTitle>

      <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>Shop</Text>
        <Text style={styles.reviewValue}>
          {draft.shopName || "Not provided"}
        </Text>
      </View>
      <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>Address</Text>
        <Text style={styles.reviewValue}>
          {draft.address || "Not provided"}
        </Text>
      </View>
      <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>Active Workers</Text>
        <Text style={styles.reviewValue}>
          {workers.filter((worker) => worker.is_active).length}
        </Text>
      </View>
      <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>Documents</Text>
        <Text style={styles.reviewValue}>{documents.length}</Text>
      </View>
      <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>Location Verified</Text>
        <Text style={styles.reviewValue}>
          {locationVerified ? "Yes" : "No"}
        </Text>
      </View>

      {REQUIRED.map((key) => (
        <View key={key} style={styles.reviewRow}>
          <Text style={styles.reviewLabel}>
            {STEPS.find((item) => item.key === key)?.title}
          </Text>
          <Text style={[
            styles.reviewValue,
            completedSections.includes(key)
              ? styles.successText
              : styles.warningText,
          ]}>
            {completedSections.includes(key) ? "Complete" : "Incomplete"}
          </Text>
        </View>
      ))}

      <View style={styles.infoBox}>
        <ShieldCheck size={18} color={COLORS.primary} />
        <Text style={styles.infoText}>
          Submitting sends your setup for admin review.
          Pending and approved submissions cannot be edited.
        </Text>
      </View>

      {!readOnly && (
        <>
          <Pressable
            onPress={() =>
              setDraft((current) => ({
                ...current,
                acceptsTerms: !current.acceptsTerms,
              }))
            }
            style={styles.termsRow}
          >
            <View style={[
              styles.checkbox,
              draft.acceptsTerms && styles.checkboxActive,
            ]}>
              {draft.acceptsTerms &&
                <Check size={15} color={COLORS.black} />}
            </View>
            <Text style={styles.termsText}>
              I confirm the information is accurate and agree
              to submit it for review.
            </Text>
          </Pressable>

          <ActionButton
            title={saving ? "Submitting..." : "Submit for Admin Review"}
            primary
            disabled={!canSubmit}
            onPress={() => void publish()}
            icon={<ClipboardCheck size={17} color={COLORS.black} />}
          />
        </>
      )}
    </View>
  );

  const renderCurrentStep = () => {
    if (step === "profile") return renderProfile();
    if (step === "shop") return renderShop();
    if (step === "workers") return renderWorkers();
    if (step === "documents") return renderDocuments();
    if (step === "capacity") return renderCapacity();
    return renderReview();
  };

  const currentStep = STEPS[selectedIndex];

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void loadAll()}
              tintColor={COLORS.primary}
            />
          }
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.pageHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pageTitle}>Shop Setup</Text>
              <Text style={styles.pageSubtitle}>
                Complete your profile and prepare your shop for customers.
              </Text>
            </View>
            <Pressable onPress={onBack} style={styles.backButton}>
              <ArrowLeft size={16} color={COLORS.text} />
              <Text style={styles.backText}>Dashboard</Text>
            </Pressable>
          </View>

          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>YOUR SHOP WORKSPACE</Text>
            <Text style={styles.heroTitle}>
              Welcome back{profile?.username
                ? `, ${profile.username}` : ""}!
            </Text>
            <Text style={styles.heroDescription}>
              Complete and save all five sections before submitting
              your shop for admin review.
            </Text>
            <View style={styles.progressLabels}>
              <Text style={styles.progressText}>Setup Progress</Text>
              <Text style={styles.progressValue}>
                {completedCount}/5 · {progress}%
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[
                styles.progressFill,
                { width: `${progress}%` },
              ]} />
            </View>
            <Text style={styles.statusText}>
              Status: {submissionStatus.replace("_", " ").toUpperCase()}
            </Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {message ? (
            <View style={styles.messageBox}>
              <CheckCircle2 size={17} color={COLORS.success} />
              <Text style={styles.messageText}>{message}</Text>
            </View>
          ) : null}

          {readOnly && (
            <View style={styles.infoBox}>
              <ShieldCheck size={18} color={COLORS.primary} />
              <Text style={styles.infoText}>
                {submissionStatus === "approved"
                  ? "Your setup is approved. Editing is disabled."
                  : "Your setup is under admin review. Editing is disabled."}
              </Text>
            </View>
          )}

          <View style={styles.stepList}>
            {STEPS.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => {
                  setStep(item.key);
                  setError("");
                  setMessage("");
                  setWorkerEditor(null);
                }}
                style={[
                  styles.stepCard,
                  step === item.key && styles.stepCardActive,
                ]}
              >
                <View style={styles.stepIcon}>
                  {completedSections.includes(item.key as SetupSection) &&
                  item.key !== "review" ? (
                    <Check size={17} color={COLORS.success} />
                  ) : (
                    <Store size={17} color={COLORS.primary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{item.title}</Text>
                  <Text style={styles.stepDescription}>
                    {item.description}
                  </Text>
                </View>
                <ChevronRight size={17} color={COLORS.textSecondary} />
              </Pressable>
            ))}
          </View>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionEyebrow}>
              STEP {selectedIndex + 1} OF 6
            </Text>
            <Text style={styles.currentTitle}>{currentStep.title}</Text>
            <Text style={styles.currentDescription}>
              {currentStep.description}
            </Text>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.help}>Loading saved Shop Setup...</Text>
            </View>
          ) : renderCurrentStep()}

          {!loading && step !== "review" && !readOnly && (
            <View style={styles.footerActions}>
              <ActionButton
                title={saving ? "Saving..." : "Save Draft"}
                disabled={saving || uploading || workerSaving}
                onPress={() => void saveSection(false)}
                icon={<Save size={16} color={COLORS.text} />}
              />
              <ActionButton
                title="Save & Next"
                primary
                disabled={saving || uploading || workerSaving}
                onPress={() => void saveSection(true)}
                icon={<ArrowRight size={16} color={COLORS.black} />}
              />
            </View>
          )}

          {selectedIndex > 0 && (
            <View style={styles.previousWrap}>
              <ActionButton
                title="Previous Step"
                onPress={() => setStep(STEPS[selectedIndex - 1].key)}
                icon={<ArrowLeft size={16} color={COLORS.text} />}
              />
            </View>
          )}

          <Pressable
            style={styles.refreshLink}
            onPress={() => void loadAll()}
          >
            <RefreshCw size={15} color={COLORS.primary} />
            <Text style={styles.refreshText}>Refresh Shop Setup</Text>
          </Pressable>

          {applicationId && (
            <Text style={styles.applicationText}>
              Application ID: {applicationId}
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 42,
  },
  pageHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 19,
  },
  pageTitle: {
    color: COLORS.text,
    fontSize: 25,
    fontWeight: "800",
  },
  pageSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 5,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 9,
    paddingHorizontal: 12,
    minHeight: 41,
  },
  backText: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "700",
  },
  hero: {
    padding: 20,
    backgroundColor: "#191713",
    borderColor: "#544020",
    borderWidth: 1,
    borderRadius: 15,
    marginBottom: 17,
  },
  heroEyebrow: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginBottom: 9,
  },
  heroTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 7,
  },
  heroDescription: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 19,
    marginBottom: 18,
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 9,
  },
  progressText: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },
  progressValue: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  progressTrack: {
    height: 7,
    backgroundColor: "#39322A",
    borderRadius: 10,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.primary,
    borderRadius: 10,
  },
  statusText: {
    color: COLORS.textSecondary,
    fontSize: 10,
    marginTop: 12,
  },
  stepList: {
    gap: 9,
    marginBottom: 23,
  },
  stepCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  stepCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: "#252019",
  },
  stepIcon: {
    width: 37,
    height: 37,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245,158,11,.10)",
  },
  stepTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "700",
  },
  stepDescription: {
    color: COLORS.textSecondary,
    fontSize: 10,
    marginTop: 3,
  },
  sectionHead: {
    marginBottom: 15,
  },
  sectionEyebrow: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 7,
  },
  currentTitle: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: "800",
  },
  currentDescription: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 5,
  },
  card: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 17,
    backgroundColor: COLORS.surface,
    gap: 4,
  },
  sectionTitle: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 12,
    marginBottom: 12,
  },
  field: {
    marginBottom: 15,
  },
  fieldLabel: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 9,
  },
  required: {
    color: COLORS.primary,
  },
  input: {
    minHeight: 45,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 9,
    backgroundColor: COLORS.surfaceDark,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: COLORS.text,
    fontSize: 12,
  },
  multilineInput: {
    minHeight: 94,
    textAlignVertical: "top",
  },
  disabledInput: {
    opacity: 0.65,
  },
  help: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 19,
    marginBottom: 13,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipActive: {
    borderColor: COLORS.primary,
    backgroundColor: "rgba(245,158,11,.13)",
  },
  chipText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  chipTextActive: {
    color: COLORS.primary,
  },
  actionButton: {
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 9,
    marginVertical: 5,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  disabledButton: {
    opacity: 0.45,
  },
  actionText: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "800",
  },
  primaryText: {
    color: COLORS.black,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 13,
    backgroundColor: "rgba(245,158,11,.07)",
    borderColor: "rgba(245,158,11,.25)",
    borderWidth: 1,
    borderRadius: 9,
    marginVertical: 12,
  },
  infoText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 18,
    flex: 1,
  },
  placeResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  placeText: {
    color: COLORS.text,
    fontSize: 11,
    flex: 1,
    lineHeight: 18,
  },
  workerCard: {
    backgroundColor: COLORS.surfaceDark,
    padding: 13,
    borderColor: COLORS.borderLight,
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 10,
  },
  workerHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  workerAvatar: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245,158,11,.1)",
    borderRadius: 10,
  },
  workerName: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
  },
  workerMeta: {
    color: COLORS.textSecondary,
    fontSize: 10,
    marginTop: 4,
  },
  workerStatus: {
    color: COLORS.success,
    fontSize: 10,
    fontWeight: "800",
  },
  inactiveStatus: {
    color: COLORS.textMuted,
  },
  workerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  editor: {
    padding: 13,
    marginTop: 10,
    marginBottom: 15,
    borderColor: COLORS.primary,
    borderWidth: 1,
    borderRadius: 12,
  },
  editorHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  documentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 13,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    marginBottom: 9,
    backgroundColor: COLORS.surfaceDark,
  },
  documentName: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "700",
  },
  reviewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 15,
    paddingVertical: 13,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
  },
  reviewLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    flex: 1,
  },
  reviewValue: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "right",
    flex: 1,
  },
  successText: {
    color: COLORS.success,
  },
  warningText: {
    color: COLORS.primary,
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginVertical: 18,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  termsText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 19,
    flex: 1,
  },
  footerActions: {
    flexDirection: "row",
    gap: 9,
    marginTop: 15,
  },
  previousWrap: {
    alignItems: "flex-start",
    marginTop: 12,
  },
  refreshLink: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    padding: 16,
    marginTop: 16,
  },
  refreshText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "700",
  },
  applicationText: {
    color: COLORS.textMuted,
    fontSize: 9,
    textAlign: "center",
    marginTop: 10,
  },
  errorBox: {
    backgroundColor: "rgba(239,68,68,.09)",
    borderColor: "rgba(239,68,68,.35)",
    borderWidth: 1,
    borderRadius: 10,
    padding: 13,
    marginBottom: 15,
  },
  errorText: {
    color: "#FCA5A5",
    fontSize: 11,
    lineHeight: 19,
  },
  messageBox: {
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
    borderColor: "rgba(34,197,94,.3)",
    borderWidth: 1,
    backgroundColor: "rgba(34,197,94,.07)",
    borderRadius: 10,
    padding: 13,
    marginBottom: 15,
  },
  messageText: {
    color: "#86EFAC",
    fontSize: 11,
    flex: 1,
  },
  loadingBox: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
    gap: 14,
  },
});
