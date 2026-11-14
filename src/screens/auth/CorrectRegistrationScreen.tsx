import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import * as DocumentPicker from "expo-document-picker";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  ImagePlus,
  LockKeyhole,
  ShieldCheck,
  Store,
  UploadCloud,
  X,
} from "lucide-react-native";

import { COLORS } from "../../constants/colors";

import {
  RegistrationCorrectionError,
  resubmitRegistrationCorrection,
  validateRegistrationCorrection,
  type CorrectionFile,
  type RegistrationCorrectionDetails,
} from "../../services/registrationCorrectionApi";

interface Props {
  token: string;
  onBack: () => void;
}

const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const DOCUMENT_TYPES = [
  ...IMAGE_TYPES,
  "application/pdf",
];

function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to complete your request. Please try again.";
}

function safeUrl(
  value: string | null | undefined
): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "Unavailable";
  }

  return (
    date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " IST"
  );
}

function formatSize(size: number): string {
  return size < 1024 * 1024
    ? `${Math.ceil(size / 1024)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function selectedFile(
  asset: DocumentPicker.DocumentPickerAsset,
  imageOnly: boolean
): CorrectionFile {
  const mimeType = String(
    asset.mimeType || ""
  ).toLowerCase();

  const size = asset.size;

  const allowed = imageOnly
    ? IMAGE_TYPES
    : DOCUMENT_TYPES;

  const maximum =
    (imageOnly ? 8 : 5) * 1024 * 1024;

  if (!allowed.includes(mimeType)) {
    throw new Error(
      imageOnly
        ? "Select a JPEG, PNG or WebP image."
        : "Select a PDF, JPEG, PNG or WebP document."
    );
  }

  if (
    typeof size !== "number" ||
    !Number.isFinite(size) ||
    size <= 0
  ) {
    throw new Error(
      "The file size could not be verified. Save the file on your device and select it again."
    );
  }

  if (size > maximum) {
    throw new Error(
      `${asset.name}: maximum size is ${
        imageOnly ? 8 : 5
      } MB.`
    );
  }

  if (!asset.uri || !asset.name) {
    throw new Error(
      "This file could not be read. Please select it again."
    );
  }

  return {
    uri: asset.uri,
    name: asset.name,
    mimeType,
    size,
  };
}

function SectionTitle({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.numberBox}>
        <Text style={styles.numberText}>
          {number}
        </Text>
      </View>

      <View style={styles.flex}>
        <Text style={styles.sectionTitle}>
          {title}
        </Text>
        <Text style={styles.description}>
          {description}
        </Text>
      </View>
    </View>
  );
}

function ShopPhoto({
  uri,
}: {
  uri: string | null;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (!uri || failed) {
    return (
      <View style={styles.emptyImage}>
        <Store
          size={30}
          color={COLORS.textMuted}
        />
        <Text style={styles.smallText}>
          Preview unavailable
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      resizeMode="contain"
      style={styles.shopImage}
      accessibilityLabel="Shop photograph preview"
      onError={() => setFailed(true)}
    />
  );
}

export default function CorrectRegistrationScreen({
  token,
  onBack,
}: Props) {
  const normalizedToken = token.trim();

  // Reset all form state when another correction link is opened.
  return (
    <CorrectionForm
      key={normalizedToken || "missing-token"}
      token={normalizedToken}
      onBack={onBack}
    />
  );
}

function CorrectionForm({
  token,
  onBack,
}: Props) {
  const [details, setDetails] =
    useState<RegistrationCorrectionDetails | null>(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [requiresReload, setRequiresReload] =
    useState(false);

  const [shopName, setShopName] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [experience, setExperience] = useState("");

  const [shopImage, setShopImage] =
    useState<CorrectionFile | null>(null);
  const [documents, setDocuments] =
    useState<CorrectionFile[]>([]);

  const mounted = useRef(false);
  const submitLock = useRef(false);
  const pickerLock = useRef(false);

  const busy = submitting || picking;
  const formLocked = busy || requiresReload;

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setDetails(null);
    setPageError("");
    setFormError("");
    setSuccess("");
    setRequiresReload(false);
    setShopImage(null);
    setDocuments([]);

    async function load() {
      try {
        if (!token) {
          throw new Error(
            "The correction token is missing. Open the complete correction link sent to your email."
          );
        }

        const result =
          await validateRegistrationCorrection(
            token,
            controller.signal
          );

        if (
          controller.signal.aborted ||
          !mounted.current
        ) {
          return;
        }

        setDetails(result);
        setShopName(result.shop_name || "");
        setShopPhone(result.shop_phone || "");
        setShopAddress(result.shop_address);
        setExperience(
          String(result.years_experience)
        );
      } catch (error: unknown) {
        if (
          !controller.signal.aborted &&
          mounted.current
        ) {
          setPageError(messageFrom(error));
        }
      } finally {
        if (
          !controller.signal.aborted &&
          mounted.current
        ) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [token, reloadKey]);

  async function pickFiles(imageOnly: boolean) {
    if (
      pickerLock.current ||
      submitLock.current ||
      formLocked
    ) {
      return;
    }

    pickerLock.current = true;
    setPicking(true);
    setFormError("");

    try {
      const result =
        await DocumentPicker.getDocumentAsync({
          type: imageOnly
            ? IMAGE_TYPES
            : DOCUMENT_TYPES,
          multiple: !imageOnly,
          copyToCacheDirectory: true,
        });

      if (
        result.canceled ||
        !mounted.current
      ) {
        return;
      }

      if (
        !imageOnly &&
        result.assets.length > 5
      ) {
        throw new Error(
          "Select a maximum of 5 documents."
        );
      }

      const files = result.assets.map((asset) =>
        selectedFile(asset, imageOnly)
      );

      if (imageOnly) {
        setShopImage(files[0] || null);
      } else {
        setDocuments(files);
      }
    } catch (error: unknown) {
      if (mounted.current) {
        setFormError(messageFrom(error));
      }
    } finally {
      pickerLock.current = false;

      if (mounted.current) {
        setPicking(false);
      }
    }
  }

  async function openDocument(
    value?: string | null
  ) {
    if (busy) return;

    const url = safeUrl(value);

    if (!url) {
      setFormError(
        "This preview is unavailable. Reload the application to refresh document links."
      );
      return;
    }

    try {
      await Linking.openURL(url);
    } catch {
      if (mounted.current) {
        setFormError(
          "Unable to open this document on your device."
        );
      }
    }
  }

  function reloadApplication() {
    if (
      submitLock.current ||
      pickerLock.current
    ) {
      return;
    }

    setReloadKey((value) => value + 1);
  }

  async function submit() {
    if (
      submitLock.current ||
      pickerLock.current ||
      !details ||
      requiresReload ||
      loading
    ) {
      return;
    }

    setFormError("");

    const name = shopName.trim();
    const phone = shopPhone.trim();
    const address = shopAddress.trim();
    const yearsText = experience.trim();
    const years = Number(yearsText);
    const digits = phone.replace(/\D/g, "");

    if (
      name.length < 2 ||
      name.length > 150
    ) {
      setFormError(
        "Shop name must contain 2–150 characters."
      );
      return;
    }

    if (
      !/^[0-9+\-\s()]{10,20}$/.test(phone) ||
      digits.length < 10 ||
      digits.length > 15
    ) {
      setFormError(
        "Enter a valid shop phone number with 10–15 digits."
      );
      return;
    }

    if (
      !/^\d{1,2}$/.test(yearsText) ||
      !Number.isInteger(years) ||
      years < 0 ||
      years > 50
    ) {
      setFormError(
        "Experience must be a whole number between 0 and 50."
      );
      return;
    }

    if (
      address.length < 10 ||
      address.length > 500
    ) {
      setFormError(
        "Shop address must contain 10–500 characters."
      );
      return;
    }

    if (
      !documents.length &&
      !details.documents.length
    ) {
      setFormError(
        "Upload at least one verification document."
      );
      return;
    }

    submitLock.current = true;
    setSubmitting(true);

    try {
      const result =
        await resubmitRegistrationCorrection({
          token,
          shop_name: name,
          shop_phone: phone,
          shop_address: address,
          years_experience: years,
          shop_image: shopImage,
          shop_documents: documents,
        });

      if (!mounted.current) return;

      if (result.barber_id !== details.barber_id) {
        throw new RegistrationCorrectionError(
          "The submission receipt could not be verified. Reload the application status before retrying.",
          0,
          true
        );
      }

      setSuccess(
        result.message ||
          "Your application has been resubmitted for Admin review."
      );
      setDetails(null);
      setShopImage(null);
      setDocuments([]);
    } catch (error: unknown) {
      if (!mounted.current) return;

      setFormError(messageFrom(error));

      if (
        !(error instanceof RegistrationCorrectionError) ||
        error.outcomeUnknown ||
        error.status === 0 ||
        error.status === 401 ||
        error.status === 409 ||
        error.status >= 500
      ) {
        setRequiresReload(true);
      }
    } finally {
      submitLock.current = false;

      if (mounted.current) {
        setSubmitting(false);
      }
    }
  }

  const preview =
    shopImage?.uri ||
    safeUrl(details?.shop_image_url);

  return (
    <SafeAreaView
      style={styles.safe}
      edges={["top", "bottom", "left", "right"]}
    >
      <View style={styles.topbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to login"
          onPress={onBack}
          disabled={busy}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
        >
          <ArrowLeft
            size={20}
            color={COLORS.text}
          />
        </Pressable>

        <View style={styles.flex}>
          <Text style={styles.brand}>
            KSHURAK
          </Text>
          <Text style={styles.brandCaption}>
            BARBER PARTNER
          </Text>
        </View>

        <View style={styles.secureBadge}>
          <LockKeyhole
            size={13}
            color={COLORS.primary}
          />
          <Text style={styles.secureText}>
            PRIVATE
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : undefined
        }
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>
              PARTNER ONBOARDING
            </Text>
            <Text style={styles.heroTitle}>
              A few updates.
            </Text>
            <Text style={styles.heroSubtitle}>
              One step closer.
            </Text>
            <Text style={styles.heroDescription}>
              Review our team’s feedback and update your
              registration to continue the approval process.
            </Text>
          </View>

          {loading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator
                size="large"
                color={COLORS.primary}
              />
              <Text style={styles.stateTitle}>
                Preparing your application
              </Text>
              <Text style={styles.centerDescription}>
                Validating your secure link and loading
                saved details.
              </Text>
            </View>
          ) : success ? (
            <View style={styles.stateCard}>
              <View style={styles.successIcon}>
                <CheckCircle2
                  size={34}
                  color={COLORS.success}
                />
              </View>

              <Text style={styles.successEyebrow}>
                APPLICATION RESUBMITTED
              </Text>
              <Text style={styles.stateTitle}>
                Back in review.
              </Text>

              <Text
                accessibilityRole="alert"
                style={styles.centerDescription}
              >
                {success}
              </Text>

              <View style={styles.pendingBadge}>
                <Clock3
                  size={15}
                  color={COLORS.primary}
                />
                <Text style={styles.pendingText}>
                  Pending Admin approval
                </Text>
              </View>

              <Text style={styles.centerDescription}>
                Resubmission does not approve your account.
                Dashboard access remains subject to approval
                and the existing activation requirements.
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={onBack}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.primaryText}>
                  Return to login
                </Text>
                <ArrowRight
                  size={17}
                  color={COLORS.black}
                />
              </Pressable>
            </View>
          ) : pageError ? (
            <View style={styles.stateCard}>
              <LockKeyhole
                size={30}
                color={COLORS.primary}
              />

              <Text style={styles.stateTitle}>
                Check your correction link
              </Text>

              <Text
                accessibilityRole="alert"
                style={styles.centerDescription}
              >
                {pageError}
              </Text>

              <Text style={styles.centerDescription}>
                Contact Admin for a new link if yours
                has expired or has already been used.
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={reloadApplication}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.primaryText}>
                  Retry validation
                </Text>
              </Pressable>
            </View>
          ) : details ? (
            <>
              <View style={styles.reviewCard}>
                <View style={styles.rowBetween}>
                  <View style={styles.iconTile}>
                    <FileText
                      size={21}
                      color={COLORS.primary}
                    />
                  </View>

                  <View style={styles.actionBadge}>
                    <View style={styles.goldDot} />
                    <Text style={styles.actionText}>
                      Action required
                    </Text>
                  </View>
                </View>

                <Text style={styles.reviewEyebrow}>
                  A NOTE FROM OUR TEAM
                </Text>
                <Text style={styles.reviewTitle}>
                  Here’s what needs updating.
                </Text>

                <View style={styles.reasonBox}>
                  <Text selectable style={styles.reason}>
                    {details.correction_reason}
                  </Text>
                </View>

                <View style={styles.dateRow}>
                  <Clock3
                    size={14}
                    color={COLORS.textSecondary}
                  />
                  <View style={styles.flex}>
                    <Text style={styles.smallText}>
                      Requested on
                    </Text>
                    <Text style={styles.dateText}>
                      {formatDate(
                        details.correction_requested_at
                      )}
                    </Text>
                  </View>
                </View>

                <Text style={styles.expiry}>
                  Link expires:{" "}
                  {formatDate(details.token_expires_at)}
                </Text>
              </View>

              <View style={styles.formCard}>
                <Text style={styles.eyebrow}>
                  YOUR APPLICATION
                </Text>
                <Text style={styles.formTitle}>
                  Registration details
                </Text>

                <View style={styles.accountBox}>
                  <View style={styles.avatar}>
                    <Store
                      size={22}
                      color={COLORS.primary}
                    />
                  </View>

                  <View style={styles.flex}>
                    <Text style={styles.accountName}>
                      {details.username}
                    </Text>
                    <Text
                      selectable
                      style={styles.accountEmail}
                    >
                      {details.email}
                    </Text>
                  </View>

                  <LockKeyhole
                    size={15}
                    color={COLORS.textMuted}
                  />
                </View>

                <SectionTitle
                  number="01"
                  title="Your shop"
                  description="Update your business and contact details."
                />

                <Text style={styles.label}>
                  Shop name
                </Text>
                <TextInput
                  accessibilityLabel="Shop name"
                  style={styles.input}
                  value={shopName}
                  onChangeText={setShopName}
                  editable={!formLocked}
                  maxLength={150}
                  placeholder="Your shop’s name"
                  placeholderTextColor={COLORS.textMuted}
                  selectionColor={COLORS.primary}
                />

                <Text style={styles.label}>
                  Shop phone
                </Text>
                <TextInput
                  accessibilityLabel="Shop phone"
                  style={styles.input}
                  value={shopPhone}
                  onChangeText={setShopPhone}
                  editable={!formLocked}
                  maxLength={20}
                  keyboardType="phone-pad"
                  placeholder="Business contact number"
                  placeholderTextColor={COLORS.textMuted}
                  selectionColor={COLORS.primary}
                />

                <Text style={styles.label}>
                  Years of experience
                </Text>
                <TextInput
                  accessibilityLabel="Years of experience"
                  style={styles.input}
                  value={experience}
                  onChangeText={setExperience}
                  editable={!formLocked}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="0"
                  placeholderTextColor={COLORS.textMuted}
                  selectionColor={COLORS.primary}
                />

                <Text style={styles.label}>
                  Complete shop address
                </Text>
                <TextInput
                  accessibilityLabel="Complete shop address"
                  style={[
                    styles.input,
                    styles.addressInput,
                  ]}
                  value={shopAddress}
                  onChangeText={setShopAddress}
                  editable={!formLocked}
                  multiline
                  textAlignVertical="top"
                  maxLength={500}
                  placeholder="Building, street, area, city and postal code"
                  placeholderTextColor={COLORS.textMuted}
                  selectionColor={COLORS.primary}
                />

                <View style={styles.divider} />

                <SectionTitle
                  number="02"
                  title="Shop photograph"
                  description="Keep your saved image or choose a replacement."
                />

                <ShopPhoto uri={preview} />

                <Pressable
                  accessibilityRole="button"
                  disabled={formLocked}
                  onPress={() => void pickFiles(true)}
                  style={({ pressed }) => [
                    styles.uploadBox,
                    pressed && styles.pressed,
                    formLocked && styles.disabled,
                  ]}
                >
                  <ImagePlus
                    size={25}
                    color={COLORS.primary}
                  />
                  <Text style={styles.uploadTitle}>
                    Choose replacement image
                  </Text>
                  <Text style={styles.uploadHint}>
                    JPEG, PNG or WebP · Maximum 8 MB
                  </Text>
                </Pressable>

                {shopImage && (
                  <View style={styles.selectedRow}>
                    <CheckCircle2
                      size={16}
                      color={COLORS.success}
                    />

                    <View style={styles.flex}>
                      <Text style={styles.selectedName}>
                        {shopImage.name}
                      </Text>
                      <Text style={styles.smallText}>
                        {formatSize(shopImage.size)}
                      </Text>
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Keep saved shop image"
                      disabled={formLocked}
                      onPress={() => setShopImage(null)}
                      hitSlop={10}
                      style={styles.smallIconButton}
                    >
                      <X
                        size={17}
                        color={COLORS.textSecondary}
                      />
                    </Pressable>
                  </View>
                )}

                <View style={styles.divider} />

                <SectionTitle
                  number="03"
                  title="Verification documents"
                  description="Review saved files or select a replacement document set."
                />

                {details.documents.length === 0 && (
                  <Text style={styles.description}>
                    No saved verification documents.
                    Upload at least one document below.
                  </Text>
                )}

                {details.documents.map(
                  (document, index) => {
                    const documentUrl =
                      safeUrl(document.signed_url);

                    return (
                      <Pressable
                        key={`${document.path}-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={
                          document.original_name ||
                          `Document ${index + 1}`
                        }
                        disabled={busy || !documentUrl}
                        onPress={() =>
                          void openDocument(
                            document.signed_url
                          )
                        }
                        style={({ pressed }) => [
                          styles.documentRow,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.documentIcon}>
                          <FileText
                            size={19}
                            color={COLORS.primary}
                          />
                        </View>

                        <View style={styles.flex}>
                          <Text style={styles.documentName}>
                            {document.original_name ||
                              `Document ${index + 1}`}
                          </Text>
                          <Text style={styles.smallText}>
                            {documentUrl
                              ? "Tap to view saved document"
                              : "Preview unavailable"}
                          </Text>
                        </View>

                        <ArrowRight
                          size={15}
                          color={COLORS.textSecondary}
                        />
                      </Pressable>
                    );
                  }
                )}

                <Pressable
                  accessibilityRole="button"
                  disabled={formLocked}
                  onPress={() => void pickFiles(false)}
                  style={({ pressed }) => [
                    styles.uploadBox,
                    pressed && styles.pressed,
                    formLocked && styles.disabled,
                  ]}
                >
                  <UploadCloud
                    size={27}
                    color={COLORS.primary}
                  />
                  <Text style={styles.uploadTitle}>
                    Select replacement documents
                  </Text>
                  <Text style={styles.uploadHint}>
                    Up to 5 files · Maximum 5 MB each
                  </Text>
                  <Text style={styles.uploadHint}>
                    PDF, JPEG, PNG or WebP
                  </Text>
                </Pressable>

                {documents.length > 0 && (
                  <View style={styles.newDocuments}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.selectionHeading}>
                        {documents.length} replacement{" "}
                        {documents.length === 1
                          ? "file"
                          : "files"}
                      </Text>

                      <Pressable
                        accessibilityRole="button"
                        disabled={formLocked}
                        onPress={() => setDocuments([])}
                      >
                        <Text style={styles.textButton}>
                          Clear
                        </Text>
                      </Pressable>
                    </View>

                    {documents.map((file, index) => (
                      <View
                        key={`${file.uri}-${index}`}
                        style={styles.selectedRow}
                      >
                        <CheckCircle2
                          size={14}
                          color={COLORS.success}
                        />

                        <View style={styles.flex}>
                          <Text style={styles.selectedName}>
                            {file.name}
                          </Text>
                          <Text style={styles.smallText}>
                            {formatSize(file.size)}
                          </Text>
                        </View>

                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${file.name}`}
                          disabled={formLocked}
                          hitSlop={8}
                          onPress={() =>
                            setDocuments((current) =>
                              current.filter(
                                (_, position) =>
                                  position !== index
                              )
                            )
                          }
                          style={styles.smallIconButton}
                        >
                          <X
                            size={16}
                            color={COLORS.textSecondary}
                          />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.notice}>
                  <FileText
                    size={16}
                    color={COLORS.primary}
                  />
                  <Text style={styles.noticeText}>
                    New documents replace the entire saved
                    list. Include every document you want
                    reviewed. Leave the replacement list
                    empty to keep your current documents.
                  </Text>
                </View>

                {picking && (
                  <ActivityIndicator
                    color={COLORS.primary}
                    style={styles.pickerLoading}
                  />
                )}

                {!!formError && (
                  <View style={styles.errorBox}>
                    <Text
                      accessibilityRole="alert"
                      style={styles.errorText}
                    >
                      {formError}
                    </Text>
                  </View>
                )}

                {requiresReload && (
                  <>
                    <Text style={styles.reloadHint}>
                      Check the latest application status
                      before submitting again. A failed
                      connection does not confirm whether
                      the server saved your changes.
                    </Text>

                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={reloadApplication}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        pressed && styles.pressed,
                        busy && styles.disabled,
                      ]}
                    >
                      <Text style={styles.secondaryText}>
                        Reload application status
                      </Text>
                    </Pressable>
                  </>
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: formLocked,
                    busy: submitting,
                  }}
                  disabled={formLocked}
                  onPress={() => void submit()}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.pressed,
                    formLocked && styles.disabled,
                  ]}
                >
                  {submitting ? (
                    <>
                      <ActivityIndicator
                        color={COLORS.black}
                      />
                      <Text style={styles.primaryText}>
                        Resubmitting…
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.primaryText}>
                        Resubmit Application
                      </Text>
                      <ArrowRight
                        size={18}
                        color={COLORS.black}
                      />
                    </>
                  )}
                </Pressable>

                <Text style={styles.submitHint}>
                  Your changes return to Admin for review.
                  Dashboard access requires approval and
                  activation.
                </Text>
              </View>
            </>
          ) : null}

          <View style={styles.footer}>
            <ShieldCheck
              size={15}
              color={COLORS.primary}
            />
            <Text style={styles.footerText}>
              Secure correction access · KSHURAK
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderDark,
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  brand: {
    color: COLORS.primary,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 2,
  },
  brandCaption: {
    color: COLORS.textSecondary,
    fontSize: 8,
    letterSpacing: 1.7,
    marginTop: 4,
  },
  secureBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${COLORS.primary}33`,
    backgroundColor: `${COLORS.primary}0D`,
  },
  secureText: {
    color: COLORS.primary,
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1,
  },
  content: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  hero: {
    paddingTop: 25,
    paddingBottom: 22,
  },
  eyebrow: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.7,
  },
  heroTitle: {
    color: COLORS.text,
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -1,
    marginTop: 12,
  },
  heroSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 29,
    fontWeight: "600",
    letterSpacing: -0.8,
    marginTop: 2,
  },
  heroDescription: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 21,
    marginTop: 11,
  },
  reviewCard: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `${COLORS.primary}40`,
    backgroundColor: COLORS.surface,
    marginBottom: 16,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: `${COLORS.primary}26`,
    backgroundColor: `${COLORS.primary}0D`,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: `${COLORS.primary}14`,
  },
  goldDot: {
    width: 5,
    height: 5,
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  actionText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "700",
  },
  reviewEyebrow: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 20,
  },
  reviewTitle: {
    color: COLORS.text,
    fontSize: 21,
    fontWeight: "700",
    lineHeight: 28,
    marginTop: 8,
    marginBottom: 15,
  },
  reasonBox: {
    backgroundColor: COLORS.surfaceDark,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.primary,
    padding: 14,
    borderRadius: 8,
  },
  reason: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 23,
  },
  dateRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 17,
  },
  smallText: {
    color: COLORS.textMuted,
    fontSize: 10,
    lineHeight: 17,
  },
  dateText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 3,
    lineHeight: 18,
  },
  expiry: {
    color: COLORS.textSecondary,
    fontSize: 10,
    lineHeight: 18,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  formCard: {
    padding: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
  },
  formTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 18,
  },
  accountBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 11,
    backgroundColor: COLORS.surfaceDark,
    marginBottom: 23,
  },
  avatar: {
    width: 39,
    height: 39,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.thumbnail,
  },
  accountName: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "700",
  },
  accountEmail: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 4,
    lineHeight: 17,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    marginBottom: 7,
  },
  numberBox: {
    width: 31,
    height: 31,
    borderWidth: 1,
    borderColor: `${COLORS.primary}33`,
    borderRadius: 9,
    backgroundColor: `${COLORS.primary}0D`,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "800",
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "700",
  },
  description: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 5,
  },
  label: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 17,
    marginBottom: 8,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 10,
    color: COLORS.text,
    fontSize: 13,
  },
  addressInput: {
    minHeight: 105,
    lineHeight: 21,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 23,
  },
  shopImage: {
    width: "100%",
    height: 200,
    borderRadius: 11,
    backgroundColor: COLORS.surfaceDark,
    marginTop: 14,
  },
  emptyImage: {
    height: 150,
    borderRadius: 11,
    backgroundColor: COLORS.surfaceDark,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
  },
  uploadBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 21,
    paddingHorizontal: 12,
    gap: 8,
    marginTop: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: `${COLORS.primary}66`,
    borderRadius: 11,
    backgroundColor: `${COLORS.primary}08`,
  },
  uploadTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  uploadHint: {
    color: COLORS.textSecondary,
    fontSize: 10,
    lineHeight: 16,
    textAlign: "center",
  },
  selectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  selectedName: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 17,
  },
  smallIconButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: COLORS.surfaceDark,
  },
  documentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceDark,
  },
  documentIcon: {
    width: 34,
    height: 39,
    borderRadius: 8,
    backgroundColor: COLORS.thumbnail,
    alignItems: "center",
    justifyContent: "center",
  },
  documentName: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 17,
    marginBottom: 4,
  },
  newDocuments: {
    padding: 12,
    borderWidth: 1,
    borderColor: `${COLORS.primary}33`,
    borderRadius: 10,
    marginTop: 13,
    backgroundColor: `${COLORS.primary}08`,
  },
  selectionHeading: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "700",
  },
  textButton: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "700",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 16,
  },
  noticeText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 10,
    lineHeight: 18,
  },
  pickerLoading: {
    marginTop: 17,
  },
  errorBox: {
    padding: 13,
    backgroundColor: `${COLORS.error}0D`,
    borderWidth: 1,
    borderColor: `${COLORS.error}40`,
    borderRadius: 10,
    marginTop: 18,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 12,
    lineHeight: 21,
  },
  reloadHint: {
    color: COLORS.warning,
    fontSize: 11,
    lineHeight: 19,
    marginTop: 12,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 50,
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    marginTop: 21,
    width: "100%",
  },
  primaryText: {
    color: COLORS.black,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
    flexShrink: 1,
  },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    marginTop: 14,
  },
  secondaryText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.45,
  },
  submitHint: {
    color: COLORS.textMuted,
    fontSize: 10,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 12,
  },
  stateCard: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: "center",
  },
  stateTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 18,
    lineHeight: 29,
  },
  centerDescription: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 11,
  },
  successIcon: {
    width: 70,
    height: 70,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: `${COLORS.success}40`,
    backgroundColor: `${COLORS.success}0D`,
    alignItems: "center",
    justifyContent: "center",
  },
  successEyebrow: {
    color: COLORS.success,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 19,
    textAlign: "center",
  },
  pendingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 11,
    borderWidth: 1,
    borderColor: `${COLORS.primary}33`,
    borderRadius: 20,
    marginTop: 18,
    backgroundColor: `${COLORS.primary}08`,
  },
  pendingText: {
    color: COLORS.primary,
    fontSize: 11,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 25,
  },
  footerText: {
    color: COLORS.textMuted,
    fontSize: 10,
  },
});