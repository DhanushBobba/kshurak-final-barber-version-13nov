
import React, { useState } from "react";

import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import { SafeAreaView } from "react-native-safe-area-context";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  Globe,
  ImagePlus,
  Lock,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  ShoppingBag,
  Store,
  Target,
  UploadCloud,
  User,
  X,
} from "lucide-react-native";

import { COLORS } from "../../constants/colors";

import {
  registerBarber,
  type RegistrationFile,
} from "../../services/barberRegistrationApi";

type Props = {
  onLogin: () => void;
};

type RegistrationStep = 1 | 2;

type FieldKey =
  | "username"
  | "email"
  | "password"
  | "experience"
  | "shop_name"
  | "shop_phone"
  | "shop_address";

interface RegistrationForm {
  username: string;
  email: string;
  password: string;
  experience: string;
  shop_name: string;
  shop_phone: string;
  shop_address: string;
  shop_image: RegistrationFile | null;
  shop_documents: RegistrationFile[];
}

const INITIAL_FORM: RegistrationForm = {
  username: "",
  email: "",
  password: "",
  experience: "",
  shop_name: "",
  shop_phone: "",
  shop_address: "",
  shop_image: null,
  shop_documents: [],
};

const EXPERIENCE_OPTIONS = [
  { label: "Less than 1 Year", value: "0" },
  { label: "1 Year", value: "1" },
  { label: "2 Years", value: "2" },
  { label: "3 Years", value: "3" },
  { label: "4 Years", value: "4" },
  { label: "5+ Years", value: "5" },
  { label: "10+ Years", value: "10" },
  { label: "15+ Years", value: "15" },
  { label: "20+ Years", value: "20" },
];

const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;
const MAX_DOCUMENTS = 5;

const GOLD = COLORS.primary;

function formatFileSize(size: number): string {
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Something went wrong. Please try again.";
}

function isValidImage(
  file: RegistrationFile
): boolean {
  return (
    IMAGE_TYPES.includes(file.mimeType) &&
    file.size > 0 &&
    file.size <= MAX_IMAGE_SIZE
  );
}

function isValidDocument(
  file: RegistrationFile
): boolean {
  return (
    DOCUMENT_TYPES.includes(file.mimeType) &&
    file.size > 0 &&
    file.size <= MAX_DOCUMENT_SIZE
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  icon: Icon,
  secureTextEntry = false,
  keyboardType = "default",
  maxLength,
  multiline = false,
  right,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon: typeof User;
  secureTextEntry?: boolean;
  keyboardType?:
    | "default"
    | "email-address"
    | "phone-pad";
  maxLength?: number;
  multiline?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.formGroup}>
      <Text style={styles.formLabel}>
        {label} <Text style={styles.required}>*</Text>
      </Text>

      <View
        style={[
          styles.inputWrapper,
          multiline && styles.textareaWrapper,
        ]}
      >
        <Icon
          size={18}
          color={COLORS.textMuted}
          style={multiline ? { marginTop: 3 } : undefined}
        />

        <TextInput
          style={[
            styles.input,
            multiline && styles.textarea,
          ]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textMuted}
          selectionColor={COLORS.primary}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          maxLength={maxLength}
          multiline={multiline}
          textAlignVertical={multiline ? "top" : "center"}
          autoCapitalize={
            keyboardType === "email-address"
              ? "none"
              : "sentences"
          }
          autoCorrect={false}
        />

        {right}
      </View>
    </View>
  );
}

export default function RegisterScreen({
  onLogin,
}: Props) {
  const [form, setForm] =
    useState<RegistrationForm>(INITIAL_FORM);

  const [step, setStep] =
    useState<RegistrationStep>(1);

  const [showPassword, setShowPassword] =
    useState(false);

  const [experienceOpen, setExperienceOpen] =
    useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const updateField = (
    field: FieldKey,
    value: string
  ) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));

    setError("");
  };

  const validateStepOne = (): string | null => {
    if (
      !/^[a-zA-Z0-9_]{3,50}$/.test(
        form.username.trim()
      )
    ) {
      return (
        "Username must contain 3–50 letters, " +
        "numbers, or underscores."
      );
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        form.email.trim()
      )
    ) {
      return "Please enter a valid email address.";
    }

    if (
      form.password.length < 8 ||
      form.password.length > 128
    ) {
      return "Password must contain 8–128 characters.";
    }

    if (
      !/[A-Za-z]/.test(form.password) ||
      !/\d/.test(form.password)
    ) {
      return (
        "Password must contain at least one letter " +
        "and one number."
      );
    }

    if (
      form.experience === "" ||
      !/^\d+$/.test(form.experience) ||
      Number(form.experience) > 50
    ) {
      return "Please select valid years of experience.";
    }

    if (
      form.shop_name.trim().length < 2 ||
      form.shop_name.trim().length > 150
    ) {
      return "Shop name must contain 2–150 characters.";
    }

    return null;
  };

  const validateStepTwo = (): string | null => {
    const phone = form.shop_phone.trim();
    const digits = phone.replace(/\D/g, "");

    if (
      !/^[0-9+\-\s()]{10,20}$/.test(phone) ||
      digits.length < 10 ||
      digits.length > 15
    ) {
      return (
        "Please enter a valid shop contact number " +
        "containing 10–15 digits."
      );
    }

    if (
      form.shop_address.trim().length < 10 ||
      form.shop_address.trim().length > 500
    ) {
      return (
        "Please enter your complete shop address " +
        "(10–500 characters)."
      );
    }

    if (
      !form.shop_image ||
      !isValidImage(form.shop_image)
    ) {
      return (
        "Please upload a JPG, PNG, or WebP shop image " +
        "smaller than 8 MB."
      );
    }

    if (
      form.shop_documents.length === 0 ||
      form.shop_documents.length > MAX_DOCUMENTS
    ) {
      return (
        "Please upload between 1 and 5 " +
        "shop verification documents."
      );
    }

    for (const file of form.shop_documents) {
      if (!isValidDocument(file)) {
        return (
          `Document "${file.name}" must be a PDF, ` +
          "JPG, PNG, or WebP smaller than 5 MB."
        );
      }
    }

    return null;
  };

  const handleNext = () => {
    const validation = validateStepOne();

    if (validation) {
      setError(validation);
      return;
    }

    setError("");
    setStep(2);
  };

  const handleShopImage = async () => {
    try {
      const result =
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          quality: 1,
        });

      if (result.canceled || !result.assets.length) {
        return;
      }

      const image = result.assets[0];

      const extension =
        image.uri.split("?")[0]
          .split(".")
          .pop()
          ?.toLowerCase();

      const mimeType =
        image.mimeType ||
        (extension === "png"
          ? "image/png"
          : extension === "webp"
          ? "image/webp"
          : "image/jpeg");

      const file: RegistrationFile = {
        uri: image.uri,
        name:
          image.fileName ||
          `shop-image.${extension || "jpg"}`,
        mimeType,
        size: image.fileSize ?? 0,
      };

      if (!isValidImage(file)) {
        setError(
          "Shop image must be JPG, PNG, or WebP, " +
          "non-empty, and no larger than 8 MB."
        );
        return;
      }

      setForm((current) => ({
        ...current,
        shop_image: file,
      }));

      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleDocuments = async () => {
    try {
      const result =
        await DocumentPicker.getDocumentAsync({
          type: DOCUMENT_TYPES,
          multiple: true,
          copyToCacheDirectory: true,
        });

      if (result.canceled || !result.assets || !result.assets.length) {
        return;
      }

      const picked: RegistrationFile[] =
        result.assets.map((asset: DocumentPicker.DocumentPickerAsset) => ({
          uri: asset.uri,
          name: asset.name,
          mimeType:
            asset.mimeType || "application/octet-stream",
          size: asset.size ?? 0,
        }));

      if (
        form.shop_documents.length + picked.length >
        MAX_DOCUMENTS
      ) {
        setError(
          `You can upload a maximum of ${MAX_DOCUMENTS} documents.`
        );
        return;
      }

      for (const file of picked) {
        if (!isValidDocument(file)) {
          setError(
            `Invalid document "${file.name}". ` +
            "Choose a PDF, JPG, PNG, or WebP file " +
            "smaller than 5 MB."
          );
          return;
        }
      }

      setForm((current) => ({
        ...current,
        shop_documents: [
          ...current.shop_documents,
          ...picked,
        ],
      }));

      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeDocument = (index: number) => {
    setForm((current) => ({
      ...current,
      shop_documents: current.shop_documents.filter(
        (_, i) => i !== index
      ),
    }));

    setError("");
  };

  const handleSubmit = async () => {
    if (loading) return;

    const firstError = validateStepOne();

    if (firstError) {
      setStep(1);
      setError(firstError);
      return;
    }

    const secondError = validateStepTwo();

    if (secondError) {
      setError(secondError);
      return;
    }

    if (!form.shop_image) return;

    setLoading(true);
    setError("");

    try {
      await registerBarber({
        username: form.username.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        years_experience: Number(form.experience),
        shop_name: form.shop_name.trim(),
        shop_phone: form.shop_phone.trim(),
        shop_address: form.shop_address.trim(),
        shop_image: form.shop_image,
        shop_documents: form.shop_documents,
      });

      setSuccess(true);
      setForm(INITIAL_FORM);
      setStep(1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const renderProgress = () => (
    <>
      <View style={styles.cardTopline}>
        <View style={styles.dot} />
        <Text style={styles.toplineText}>
          BARBER ONBOARDING
        </Text>

        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>
            STEP {step} OF 2
          </Text>
        </View>
      </View>

      <Text style={styles.cardTitle}>
        {step === 1
          ? "Create Barber Account"
          : "Complete Shop Registration"}
      </Text>

      <Text style={styles.cardSubtitle}>
        {step === 1
          ? "Start with your basic and business details"
          : "Just a few more details to submit your application"}
      </Text>

      <View style={styles.stepLabels}>
        <Text
          style={[
            styles.stepLabel,
            step === 1 && styles.stepLabelActive,
          ]}
        >
          01 · Basic Details
        </Text>

        <Text
          style={[
            styles.stepLabel,
            step === 2 && styles.stepLabelActive,
          ]}
        >
          02 · Shop Verification
        </Text>
      </View>

      <View style={styles.progressRow}>
        <View style={styles.progressActive} />

        <View
          style={
            step === 2
              ? styles.progressActive
              : styles.progressIdle
          }
        />
      </View>
    </>
  );

  const renderStepOne = () => (
    <>
      <Field
        label="Username"
        value={form.username}
        onChange={(value) =>
          updateField("username", value)
        }
        placeholder="arjunbarber"
        icon={User}
        maxLength={50}
      />

      <Field
        label="Email ID"
        value={form.email}
        onChange={(value) =>
          updateField("email", value)
        }
        placeholder="arjun.kumar@gmail.com"
        icon={Mail}
        keyboardType="email-address"
      />

      <Field
        label="Password"
        value={form.password}
        onChange={(value) =>
          updateField("password", value)
        }
        placeholder="Minimum 8 characters"
        icon={Lock}
        secureTextEntry={!showPassword}
        maxLength={128}
        right={
          <Pressable
            onPress={() =>
              setShowPassword((value) => !value)
            }
            hitSlop={8}
          >
            {showPassword ? (
              <EyeOff
                size={18}
                color={COLORS.textSecondary}
              />
            ) : (
              <Eye
                size={18}
                color={COLORS.textSecondary}
              />
            )}
          </Pressable>
        }
      />

      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>
          Years of Experience{" "}
          <Text style={styles.required}>*</Text>
        </Text>

        <Pressable
          style={styles.inputWrapper}
          onPress={() =>
            setExperienceOpen((value) => !value)
          }
        >
          <Briefcase
            size={18}
            color={COLORS.textMuted}
          />

          <Text
            style={[
              styles.selectionText,
              !form.experience &&
                styles.selectionPlaceholder,
            ]}
          >
            {EXPERIENCE_OPTIONS.find(
              (option) =>
                option.value === form.experience
            )?.label || "Select your experience"}
          </Text>

          <ChevronDown
            size={17}
            color={COLORS.textMuted}
          />
        </Pressable>

        {experienceOpen && (
          <View style={styles.optionsPanel}>
            {EXPERIENCE_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={styles.option}
                onPress={() => {
                  updateField(
                    "experience",
                    option.value
                  );
                  setExperienceOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.optionText,
                    form.experience === option.value &&
                      { color: GOLD },
                  ]}
                >
                  {option.label}
                </Text>

                {form.experience === option.value && (
                  <CheckCircle2
                    size={15}
                    color={GOLD}
                  />
                )}
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <Field
        label="Shop Name"
        value={form.shop_name}
        onChange={(value) =>
          updateField("shop_name", value)
        }
        placeholder="Enter your barber shop name"
        icon={Store}
        maxLength={150}
      />

      {error ? (
        <View style={styles.errorBanner}>
          <AlertCircle
            size={17}
            color={COLORS.error}
          />
          <Text style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      <Pressable
        style={styles.primaryButton}
        onPress={handleNext}
      >
        <Text style={styles.primaryButtonText}>
          Next
        </Text>
        <ArrowRight
          size={18}
          color={COLORS.black}
        />
      </Pressable>
    </>
  );

  const renderStepTwo = () => (
    <>
      <Field
        label="Shop Contact Number"
        value={form.shop_phone}
        onChange={(value) =>
          updateField("shop_phone", value)
        }
        placeholder="Enter shop contact number"
        icon={Phone}
        keyboardType="phone-pad"
        maxLength={20}
      />

      <Field
        label="Shop Address"
        value={form.shop_address}
        onChange={(value) =>
          updateField("shop_address", value)
        }
        placeholder="Door number, street, locality, city and PIN code"
        icon={MapPin}
        multiline
        maxLength={500}
      />

      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>
          Shop Image{" "}
          <Text style={styles.required}>*</Text>
        </Text>

        {!form.shop_image ? (
          <Pressable
            style={styles.uploadBox}
            onPress={() =>
              void handleShopImage()
            }
          >
            <View style={styles.uploadIcon}>
              <ImagePlus
                size={23}
                color={GOLD}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.uploadTitle}>
                Upload Shop Image
              </Text>
              <Text style={styles.uploadSubtitle}>
                Tap to select your shop photo
              </Text>
              <Text style={styles.uploadFormat}>
                JPG, PNG, WebP · Max 8 MB
              </Text>
            </View>
          </Pressable>
        ) : (
          <View style={styles.selectedFile}>
            <Image
              source={{
                uri: form.shop_image.uri,
              }}
              style={styles.imagePreview}
            />

            <View style={{ flex: 1 }}>
              <Text
                style={styles.selectedFileName}
                numberOfLines={2}
              >
                {form.shop_image.name}
              </Text>

              <Text style={styles.fileSize}>
                {formatFileSize(
                  form.shop_image.size
                )}
              </Text>

              <Text style={styles.selectedSuccess}>
                Image selected
              </Text>
            </View>

            <Pressable
              style={styles.removeButton}
              onPress={() =>
                setForm((current) => ({
                  ...current,
                  shop_image: null,
                }))
              }
            >
              <X
                size={16}
                color={COLORS.error}
              />
            </Pressable>
          </View>
        )}

        <Text style={styles.hint}>
          Upload a clear photograph of your barber shop.
        </Text>
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>
          Shop Verification Documents{" "}
          <Text style={styles.required}>*</Text>
        </Text>

        <Pressable
          style={styles.uploadBox}
          onPress={() =>
            void handleDocuments()
          }
        >
          <View style={styles.uploadIcon}>
            <UploadCloud
              size={23}
              color={GOLD}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.uploadTitle}>
              Upload Shop Documents
            </Text>

            <Text style={styles.uploadSubtitle}>
              Trade license or business address proof
            </Text>

            <Text style={styles.uploadFormat}>
              PDF, JPG, PNG, WebP · Max 5 MB each
            </Text>
          </View>
        </Pressable>

        <Text style={styles.hint}>
          {form.shop_documents.length} of{" "}
          {MAX_DOCUMENTS} documents selected.
          At least one is required.
        </Text>

        {form.shop_documents.map((document, index) => (
          <View
            key={`${document.uri}-${index}`}
            style={styles.documentRow}
          >
            <FileText
              size={18}
              color={GOLD}
            />

            <View style={{ flex: 1 }}>
              <Text
                style={styles.selectedFileName}
                numberOfLines={2}
              >
                {document.name}
              </Text>

              <Text style={styles.fileSize}>
                {formatFileSize(document.size)}
              </Text>
            </View>

            <Pressable
              style={styles.removeButton}
              onPress={() =>
                removeDocument(index)
              }
            >
              <X
                size={16}
                color={COLORS.error}
              />
            </Pressable>
          </View>
        ))}

        <View style={styles.securityNote}>
          <ShieldCheck
            size={17}
            color={GOLD}
          />

          <Text style={styles.securityText}>
            Documents will be submitted for verification
            and should be accessible only to authorized reviewers.
          </Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <AlertCircle
            size={17}
            color={COLORS.error}
          />
          <Text style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable
          disabled={loading}
          style={styles.backButton}
          onPress={() => {
            setStep(1);
            setError("");
          }}
        >
          <ArrowLeft
            size={16}
            color={COLORS.text}
          />
          <Text style={styles.backButtonText}>
            Back
          </Text>
        </Pressable>

        <Pressable
          disabled={loading}
          style={[
            styles.primaryButton,
            { flex: 1 },
            loading && { opacity: 0.55 },
          ]}
          onPress={() =>
            void handleSubmit()
          }
        >
          {loading ? (
            <ActivityIndicator
              color={COLORS.black}
              size="small"
            />
          ) : (
            <Text style={styles.primaryButtonText}>
              Submit for Approval
            </Text>
          )}
        </Pressable>
      </View>
    </>
  );

  const renderSuccess = () => (
    <View style={styles.successContent}>
      <View style={styles.successIcon}>
        <CheckCircle2
          size={40}
          color={COLORS.success}
        />
      </View>

      <Text style={styles.successHeading}>
        Application Submitted!
      </Text>

      <Text style={styles.successDescription}>
        Your KSHURAK barber registration has
        been submitted successfully.
      </Text>

      <View style={styles.approvalChip}>
        <ShieldCheck
          size={17}
          color={GOLD}
        />

        <Text style={styles.approvalText}>
          Waiting for Admin Approval
        </Text>
      </View>

      <Text style={styles.successNote}>
        Your account, shop details, image, and
        verification documents have been submitted.
        After admin approval, an activation link
        will be sent to your registered email address.
      </Text>

      <Pressable
        style={styles.primaryButton}
        onPress={() => {
          setSuccess(false);
          setStep(1);
          setError("");
        }}
      >
        <Text style={styles.primaryButtonText}>
          Back to Registration
        </Text>
        <ArrowRight
          size={17}
          color={COLORS.black}
        />
      </Pressable>

      <Pressable
        style={styles.successLogin}
        onPress={onLogin}
      >
        <Text style={styles.successLoginText}>
          Go to Login
        </Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={
          Platform.OS === "ios" ? "padding" : undefined
        }
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.brand}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkText}>K</Text>
              </View>

              <Text style={styles.brandText}>
                KSHURAK
              </Text>
            </View>

            <Pressable
              style={styles.loginButton}
              onPress={onLogin}
            >
              <Text style={styles.loginText}>
                Login
              </Text>
              <ArrowRight
                size={14}
                color={GOLD}
              />
            </Pressable>
          </View>

          <View style={styles.hero}>
            <View style={styles.partnerBadge}>
              <View style={styles.dot} />
              <Text style={styles.partnerText}>
                KSHURAK PARTNER PROGRAM
              </Text>
            </View>

            <Text style={styles.heroTitle}>
              Be a Part of{" "}
              <Text style={styles.heroBrand}>
                KSHURAK
              </Text>
            </Text>

            <Text style={styles.heroDescription}>
              Showcase your talent. Manage your shop.
              Get more customers.
            </Text>

            <View style={styles.featuresRow}>
              {[
                {
                  title: "Grow Your\nBusiness",
                  Icon: Store,
                },
                {
                  title: "Reach More\nCustomers",
                  Icon: Target,
                },
                {
                  title: "Manage\nEasily",
                  Icon: ShoppingBag,
                },
              ].map(({ title, Icon }) => (
                <View
                  key={title}
                  style={styles.feature}
                >
                  <View style={styles.featureIcon}>
                    <Icon
                      size={21}
                      color={GOLD}
                    />
                  </View>

                  <Text style={styles.featureText}>
                    {title}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.formCard}>
            {success ? (
              renderSuccess()
            ) : (
              <>
                {renderProgress()}

                {step === 1
                  ? renderStepOne()
                  : renderStepTwo()}
              </>
            )}
          </View>

          <View style={styles.footer}>
            <Globe
              size={15}
              color={GOLD}
            />
            <Text style={styles.footerText}>
              kshurak.com
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 35,
    flexGrow: 1,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandMark: {
    height: 35,
    width: 35,
    backgroundColor: COLORS.primary,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  brandMarkText: {
    fontSize: 23,
    fontWeight: "900",
    color: COLORS.black,
  },
  brandText: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  loginButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    backgroundColor: "rgba(245,158,11,0.07)",
  },
  loginText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  hero: {
    marginBottom: 23,
  },
  partnerBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 30,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.22)",
    marginBottom: 15,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  partnerText: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  heroTitle: {
    color: COLORS.text,
    fontSize: 33,
    fontWeight: "800",
    letterSpacing: -1,
    lineHeight: 41,
  },
  heroBrand: {
    color: COLORS.primary,
    fontWeight: "900",
  },
  heroDescription: {
    marginTop: 10,
    color: "#D4D4D8",
    fontSize: 13,
    lineHeight: 21,
  },
  featuresRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 9,
    marginTop: 20,
  },
  feature: {
    flex: 1,
    alignItems: "center",
    gap: 9,
  },
  featureIcon: {
    width: 47,
    height: 47,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.28)",
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    color: "#E4E4E7",
    fontSize: 10,
    textAlign: "center",
    lineHeight: 15,
    fontWeight: "600",
  },
  formCard: {
    borderRadius: 18,
    padding: 19,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
  },
  cardTopline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  toplineText: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  stepBadge: {
    marginLeft: "auto",
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 5,
  },
  stepBadgeText: {
    color: COLORS.textSecondary,
    fontSize: 9,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 6,
  },
  cardSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 17,
    marginBottom: 18,
  },
  stepLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  },
  stepLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: "700",
  },
  stepLabelActive: {
    color: COLORS.primary,
  },
  progressRow: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 20,
  },
  progressActive: {
    flex: 1,
    height: 4,
    backgroundColor: COLORS.primary,
    borderRadius: 5,
  },
  progressIdle: {
    flex: 1,
    height: 4,
    backgroundColor: COLORS.borderLight,
    borderRadius: 5,
  },
  formGroup: {
    marginBottom: 15,
  },
  formLabel: {
    color: "#E4E4E7",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 7,
  },
  required: {
    color: COLORS.primary,
  },
  inputWrapper: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 9,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
  },
  textareaWrapper: {
    alignItems: "flex-start",
    paddingVertical: 11,
  },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: 12,
    paddingVertical: 8,
    minWidth: 0,
  },
  textarea: {
    minHeight: 65,
    paddingVertical: 0,
  },
  selectionText: {
    color: COLORS.text,
    flex: 1,
    fontSize: 12,
  },
  selectionPlaceholder: {
    color: COLORS.textMuted,
  },
  optionsPanel: {
    backgroundColor: COLORS.surfaceDark,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 9,
    marginTop: 6,
    overflow: "hidden",
  },
  option: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  optionText: {
    color: COLORS.text,
    fontSize: 12,
  },
  uploadBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(245,158,11,0.4)",
    borderRadius: 9,
    backgroundColor: "rgba(245,158,11,0.045)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 78,
    padding: 12,
  },
  uploadIcon: {
    height: 39,
    width: 39,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.22)",
    backgroundColor: "rgba(245,158,11,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadTitle: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "800",
  },
  uploadSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 10,
    marginTop: 3,
    lineHeight: 15,
  },
  uploadFormat: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 4,
  },
  hint: {
    color: COLORS.textSecondary,
    fontSize: 10,
    marginTop: 7,
    lineHeight: 15,
  },
  selectedFile: {
    backgroundColor: COLORS.surfaceDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 9,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  imagePreview: {
    height: 56,
    width: 62,
    borderRadius: 7,
    backgroundColor: COLORS.surfaceLight,
  },
  selectedFileName: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "800",
  },
  fileSize: {
    color: COLORS.textSecondary,
    fontSize: 10,
    marginTop: 4,
  },
  selectedSuccess: {
    color: COLORS.success,
    fontSize: 10,
    marginTop: 3,
  },
  removeButton: {
    height: 30,
    width: 30,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    backgroundColor: "rgba(239,68,68,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  documentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    backgroundColor: COLORS.surfaceDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 9,
    marginTop: 7,
  },
  securityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginTop: 11,
  },
  securityText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 10,
    lineHeight: 16,
  },
  errorBanner: {
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(239,68,68,0.1)",
    borderRadius: 8,
    padding: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    color: "#FCA5A5",
    fontSize: 11,
    lineHeight: 17,
  },
  primaryButton: {
    minHeight: 45,
    backgroundColor: COLORS.primary,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: COLORS.black,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "stretch",
  },
  backButton: {
    minHeight: 45,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 9,
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
  },
  backButtonText: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "700",
  },
  successContent: {
    alignItems: "center",
    gap: 17,
    paddingVertical: 22,
  },
  successIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.4)",
    backgroundColor: "rgba(34,197,94,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  successHeading: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  successDescription: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
  },
  approvalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.3)",
    backgroundColor: "rgba(245,158,11,0.07)",
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 9,
  },
  approvalText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  successNote: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 19,
    textAlign: "center",
  },
  successLogin: {
    paddingVertical: 10,
  },
  successLoginText: {
    color: COLORS.primary,
    fontWeight: "700",
    fontSize: 12,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 24,
  },
  footerText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "700",
  },
});
