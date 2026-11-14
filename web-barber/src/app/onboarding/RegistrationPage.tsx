
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  MapPin,
  Briefcase,
  ChevronDown,
  ArrowRight,
  ArrowLeft,
  Globe,
  Store,
  Target,
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  Phone,
  ImagePlus,
  FileText,
  UploadCloud,
  X,
  ShieldCheck,
} from "lucide-react";

import {
  registerBarber,
  type BarberRegistrationPayload,
} from "../../services/barberApi";
import { COLORS } from "../../styles/colors";
import "../../styles/registration.css";

type RegistrationStep = 1 | 2;

interface RegistrationForm {
  username: string;
  email: string;
  password: string;
  experience: string;
  shop_name: string;
  shop_phone: string;
  shop_address: string;
  shop_image: File | null;
  shop_documents: File[];
}

const initialForm: RegistrationForm = {
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

const experienceOptions = [
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

const MAX_SHOP_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;
const MAX_DOCUMENTS = 5;

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

function formatFileSize(size: number): string {
  return size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export default function RegistrationPage() {
  const [form, setForm] =
    useState<RegistrationForm>(initialForm);

  const [step, setStep] =
    useState<RegistrationStep>(1);

  const [showPassword, setShowPassword] =
    useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [imagePreview, setImagePreview] = useState("");

  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!form.shop_image) {
      setImagePreview("");
      return;
    }

    const url = URL.createObjectURL(form.shop_image);
    setImagePreview(url);

    return () => URL.revokeObjectURL(url);
  }, [form.shop_image]);

  const handleChange = (
    field:
      | "username"
      | "email"
      | "password"
      | "experience"
      | "shop_name"
      | "shop_phone"
      | "shop_address",
    value: string
  ) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
    setError("");
  };

  const validateStepOne = (): string | null => {
    if (!/^[a-zA-Z0-9_]{3,50}$/.test(form.username.trim())) {
      return "Username must contain 3–50 letters, numbers, or underscores.";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
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
      return "Password must contain at least one letter and one number.";
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
      return "Please enter a valid shop contact number containing 10–15 digits.";
    }

    if (
      form.shop_address.trim().length < 10 ||
      form.shop_address.trim().length > 500
    ) {
      return "Please enter your complete shop address (10–500 characters).";
    }

    if (
      !form.shop_image ||
      !IMAGE_TYPES.includes(form.shop_image.type) ||
      form.shop_image.size === 0 ||
      form.shop_image.size > MAX_SHOP_IMAGE_SIZE
    ) {
      return "Please upload a valid JPG, PNG, or WebP shop image smaller than 8 MB.";
    }

    if (
      form.shop_documents.length === 0 ||
      form.shop_documents.length > MAX_DOCUMENTS
    ) {
      return "Please upload between 1 and 5 shop verification documents.";
    }

    for (const file of form.shop_documents) {
      if (
        !DOCUMENT_TYPES.includes(file.type) ||
        file.size === 0 ||
        file.size > MAX_DOCUMENT_SIZE
      ) {
        return `Document "${file.name}" must be a valid PDF, JPG, PNG, or WebP smaller than 5 MB.`;
      }
    }

    return null;
  };

  // Switch steps without forcing the entire page to scroll.
  const moveToStep = (nextStep: RegistrationStep) => {
    setStep(nextStep);
    setError("");
  };

  const handleNext = () => {
    const validationError = validateStepOne();

    if (validationError) {
      setError(validationError);
      return;
    }

    moveToStep(2);
  };

  const handleShopImage = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!IMAGE_TYPES.includes(file.type)) {
      setError("Shop image must be JPG, PNG, or WebP.");
      return;
    }

    if (
      file.size === 0 ||
      file.size > MAX_SHOP_IMAGE_SIZE
    ) {
      setError(
        "Shop image must be a non-empty file smaller than 8 MB."
      );
      return;
    }

    setForm((previous) => ({
      ...previous,
      shop_image: file,
    }));

    setError("");
  };

  const handleShopDocuments = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(
      event.target.files || []
    );
    event.target.value = "";

    if (selectedFiles.length === 0) return;

    if (
      form.shop_documents.length + selectedFiles.length >
      MAX_DOCUMENTS
    ) {
      setError(
        `You can upload a maximum of ${MAX_DOCUMENTS} documents.`
      );
      return;
    }

    for (const file of selectedFiles) {
      if (!DOCUMENT_TYPES.includes(file.type)) {
        setError(
          `Invalid document format: ${file.name}. Choose PDF, JPG, PNG, or WebP.`
        );
        return;
      }

      if (
        file.size === 0 ||
        file.size > MAX_DOCUMENT_SIZE
      ) {
        setError(
          `Document "${file.name}" must be a non-empty file smaller than 5 MB.`
        );
        return;
      }
    }

    setForm((previous) => ({
      ...previous,
      shop_documents: [
        ...previous.shop_documents,
        ...selectedFiles,
      ],
    }));

    setError("");
  };

  const removeDocument = (index: number) => {
    setForm((previous) => ({
      ...previous,
      shop_documents: previous.shop_documents.filter(
        (_, i) => i !== index
      ),
    }));

    setError("");
  };

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (loading) return;

    if (step === 1) {
      handleNext();
      return;
    }

    const firstError = validateStepOne();

    if (firstError) {
      moveToStep(1);
      setError(firstError);
      return;
    }

    const secondError = validateStepTwo();

    if (secondError) {
      setError(secondError);
      return;
    }

    const payload: BarberRegistrationPayload = {
      username: form.username.trim(),
      email: form.email.trim().toLowerCase(),
      password: form.password,
      years_experience: Number(form.experience),
      shop_name: form.shop_name.trim(),
      shop_phone: form.shop_phone.trim(),
      shop_address: form.shop_address.trim(),
      shop_image: form.shop_image,
      shop_documents: form.shop_documents,
    };

    setLoading(true);
    setError("");

    try {
      await registerBarber(payload);
      setSuccess(true);
      setForm({
        ...initialForm,
        shop_documents: [],
      });
      setStep(1);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="registration-viewport">
      <div className="ambient-glow-top-left" />
      <div className="ambient-glow-card" />

      <header className="registration-header">
        <div className="header-brand">
          <img
            src="/assets/logo.png"
            alt="KSHURAK"
            className="header-brand-logo"
          />
        </div>

        <div className="header-auth-action">
          <span>Already have an account?</span>
          <Link
            to="/login"
            className="header-login-link"
          >
            Login
            <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      <main className="registration-content-container">
        <section className="hero-column">
          <div className="hero-kicker">
            <span className="hero-kicker-dot" />
            KSHURAK PARTNER PROGRAM
          </div>

          <h1 className="hero-heading">
            Be a Part of
            <span className="hero-heading-brand">
              KSHURAK
            </span>
          </h1>

          <p className="hero-description">
            Showcase your talent,
            <br />
            Manage your shop,
            <br />
            Get more customers.
          </p>

          <div className="hero-badges-row">
            <div className="hero-badge-card">
              <div className="hero-badge-icon-box">
                <Store size={23} color={COLORS.primary} />
              </div>
              <span className="hero-badge-label">
                Grow Your
                <br />
                Business
              </span>
            </div>

            <div className="hero-badge-card">
              <div className="hero-badge-icon-box">
                <Target size={23} color={COLORS.primary} />
              </div>
              <span className="hero-badge-label">
                Reach More
                <br />
                Customers
              </span>
            </div>

            <div className="hero-badge-card">
              <div className="hero-badge-icon-box">
                <ShoppingBag
                  size={23}
                  color={COLORS.primary}
                />
              </div>
              <span className="hero-badge-label">
                Manage
                <br />
                Easily
              </span>
            </div>
          </div>

          <div className="hero-footer-bar">
            <div className="hero-url-container">
              <Globe size={15} color={COLORS.primary} />
              <span>kshurak.com</span>
            </div>
            <div className="hero-url-line" />
          </div>
        </section>

        <section className="form-column">
          <div
            className="registration-glass-card"
            ref={cardRef}
          >
            {success ? (
              <div className="registration-success-content">
                <div className="success-badge-icon">
                  <CheckCircle2
                    size={37}
                    color={COLORS.success}
                  />
                </div>

                <h2>Application Submitted!</h2>

                <p>
                  Your KSHURAK barber registration has
                  been submitted successfully.
                </p>

                <div className="approval-status-chip">
                  <CheckCircle2
                    size={17}
                    color={COLORS.primary}
                  />
                  <span>Waiting for Admin Approval</span>
                </div>

                <p className="success-note">
                  Your account, shop details, image, and
                  verification documents have been submitted.
                  After admin approval, an activation link
                  will be sent to your registered email
                  address.
                </p>

                <button
                  className="submit-gold-button"
                  type="button"
                  onClick={() => {
                    setSuccess(false);
                    moveToStep(1);
                  }}
                >
                  Back to Registration
                  <ArrowRight size={17} />
                </button>
              </div>
            ) : (
              <>
                <div className="card-topline">
                  <span className="card-topline-dot" />
                  BARBER ONBOARDING
                  <span className="card-step-count">
                    STEP {step} OF 2
                  </span>
                </div>

                <h2 className="card-title">
                  {step === 1
                    ? "Create Barber Account"
                    : "Complete Shop Registration"}
                </h2>

                <p className="card-subtitle">
                  {step === 1
                    ? "Start with your basic and business details"
                    : "Just a few more details to submit your application"}
                </p>

                <div className="registration-step-header">
                  <span className={step === 1 ? "step-current" : ""}>
                    01 · Basic Details
                  </span>
                  <span className={step === 2 ? "step-current" : ""}>
                    02 · Shop Verification
                  </span>
                </div>

                <div className="registration-step-bars">
                  <div className="step-progress-active" />
                  <div
                    className={
                      step === 2
                        ? "step-progress-active"
                        : "step-progress-idle"
                    }
                  />
                </div>

                <form
                  onSubmit={handleSubmit}
                  className="registration-form-content"
                  noValidate
                >
                  {step === 1 ? (
                    <>
                      <div className="form-group">
                        <label
                          className="form-label"
                          htmlFor="username"
                        >
                          Username *
                        </label>

                        <div className="input-field-wrapper">
                          <User
                            className="input-icon-left"
                            size={17}
                          />
                          <input
                            id="username"
                            className="form-input"
                            type="text"
                            autoComplete="username"
                            placeholder="arjunbarber"
                            value={form.username}
                            maxLength={50}
                            onChange={(e) =>
                              handleChange("username", e.target.value)
                            }
                            required
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label
                          className="form-label"
                          htmlFor="email"
                        >
                          Email ID *
                        </label>

                        <div className="input-field-wrapper">
                          <Mail
                            className="input-icon-left"
                            size={17}
                          />
                          <input
                            id="email"
                            className="form-input"
                            type="email"
                            autoComplete="email"
                            placeholder="arjun.kumar@gmail.com"
                            value={form.email}
                            onChange={(e) =>
                              handleChange("email", e.target.value)
                            }
                            required
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label
                          className="form-label"
                          htmlFor="password"
                        >
                          Password *
                        </label>

                        <div className="input-field-wrapper">
                          <Lock
                            className="input-icon-left"
                            size={17}
                          />

                          <input
                            id="password"
                            className="form-input"
                            type={
                              showPassword ? "text" : "password"
                            }
                            autoComplete="new-password"
                            placeholder="Minimum 8 characters"
                            value={form.password}
                            minLength={8}
                            maxLength={128}
                            onChange={(e) =>
                              handleChange("password", e.target.value)
                            }
                            required
                          />

                          <button
                            type="button"
                            className="input-toggle-btn"
                            aria-label={
                              showPassword
                                ? "Hide password"
                                : "Show password"
                            }
                            onClick={() =>
                              setShowPassword((value) => !value)
                            }
                          >
                            {showPassword ? (
                              <EyeOff size={17} />
                            ) : (
                              <Eye size={17} />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="form-group">
                        <label
                          className="form-label"
                          htmlFor="experience"
                        >
                          Years of Experience *
                        </label>

                        <div className="input-field-wrapper">
                          <Briefcase
                            className="input-icon-left"
                            size={17}
                          />

                          <select
                            id="experience"
                            className="form-select"
                            value={form.experience}
                            onChange={(e) =>
                              handleChange(
                                "experience",
                                e.target.value
                              )
                            }
                            required
                          >
                            <option value="">
                              Select your experience
                            </option>

                            {experienceOptions.map((option) => (
                              <option
                                key={option.label}
                                value={option.value}
                              >
                                {option.label}
                              </option>
                            ))}
                          </select>

                          <ChevronDown
                            className="select-chevron"
                            size={17}
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label
                          className="form-label"
                          htmlFor="shop_name"
                        >
                          Shop Name *
                        </label>

                        <div className="input-field-wrapper">
                          <Store
                            className="input-icon-left"
                            size={17}
                          />

                          <input
                            id="shop_name"
                            className="form-input"
                            type="text"
                            autoComplete="organization"
                            placeholder="Enter your barber shop name"
                            value={form.shop_name}
                            maxLength={150}
                            onChange={(e) =>
                              handleChange(
                                "shop_name",
                                e.target.value
                              )
                            }
                            required
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="form-group">
                        <label
                          className="form-label"
                          htmlFor="shop_phone"
                        >
                          Shop Contact Number *
                        </label>

                        <div className="input-field-wrapper">
                          <Phone
                            className="input-icon-left"
                            size={17}
                          />

                          <input
                            id="shop_phone"
                            className="form-input"
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            placeholder="Enter shop contact number"
                            value={form.shop_phone}
                            maxLength={20}
                            onChange={(e) =>
                              handleChange(
                                "shop_phone",
                                e.target.value
                              )
                            }
                            required
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label
                          className="form-label"
                          htmlFor="shop_address"
                        >
                          Shop Address *
                        </label>

                        <div className="input-field-wrapper textarea-wrapper">
                          <MapPin
                            className="input-icon-left"
                            size={17}
                          />

                          <textarea
                            id="shop_address"
                            className="form-textarea"
                            placeholder="Door number, street, locality, city and PIN code"
                            rows={2}
                            value={form.shop_address}
                            maxLength={500}
                            onChange={(e) =>
                              handleChange(
                                "shop_address",
                                e.target.value
                              )
                            }
                            required
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label
                          className="form-label"
                          htmlFor="shop_image"
                        >
                          Shop Image *
                        </label>

                        <div className="registration-upload-box">
                          {!form.shop_image ? (
                            <label
                              htmlFor="shop_image"
                              className="registration-upload-trigger"
                            >
                              <span className="registration-upload-icon">
                                <ImagePlus
                                  size={23}
                                  color={COLORS.primary}
                                />
                              </span>

                              <span className="registration-upload-text">
                                <strong>
                                  Upload Shop Image
                                </strong>
                                <small>
                                  Click to select your shop photo
                                </small>
                                <em>
                                  JPG, PNG, WebP · Max 8 MB
                                </em>
                              </span>
                            </label>
                          ) : (
                            <div className="registration-upload-selected">
                              {imagePreview && (
                                <img
                                  src={imagePreview}
                                  alt="Selected shop preview"
                                  className="registration-image-preview"
                                />
                              )}

                              <div className="registration-selected-details">
                                <strong>
                                  {form.shop_image.name}
                                </strong>
                                <small>
                                  {formatFileSize(
                                    form.shop_image.size
                                  )}
                                  {" · Ready to upload"}
                                </small>
                                <span className="registration-selected-success">
                                  <CheckCircle2 size={12} />
                                  Image selected
                                </span>
                              </div>

                              <button
                                type="button"
                                className="registration-remove-file"
                                aria-label="Remove shop image"
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    shop_image: null,
                                  }))
                                }
                              >
                                <X size={16} />
                              </button>
                            </div>
                          )}

                          <input
                            id="shop_image"
                            className="registration-file-input"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={handleShopImage}
                          />
                        </div>

                        <p className="registration-upload-hint">
                          Upload a clear photograph of your barber shop.
                        </p>
                      </div>

                      <div className="form-group">
                        <label
                          className="form-label"
                          htmlFor="shop_documents"
                        >
                          Shop Verification Documents *
                        </label>

                        <div className="registration-upload-box">
                          <label
                            htmlFor="shop_documents"
                            className="registration-upload-trigger"
                          >
                            <span className="registration-upload-icon">
                              <UploadCloud
                                size={23}
                                color={COLORS.primary}
                              />
                            </span>

                            <span className="registration-upload-text">
                              <strong>
                                Upload Shop Documents
                              </strong>
                              <small>
                                Trade license or business address proof
                              </small>
                              <em>
                                PDF, JPG, PNG, WebP · Max 5 MB each
                              </em>
                            </span>
                          </label>

                          <input
                            id="shop_documents"
                            className="registration-file-input"
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp"
                            multiple
                            onChange={handleShopDocuments}
                          />
                        </div>

                        <p className="registration-upload-hint">
                          {form.shop_documents.length} of{" "}
                          {MAX_DOCUMENTS} documents selected.
                          At least one is required.
                        </p>

                        {form.shop_documents.length > 0 && (
                          <div className="registration-documents-list">
                            {form.shop_documents.map(
                              (file, index) => (
                                <div
                                  className="registration-document-item"
                                  key={`${file.name}-${file.size}-${index}`}
                                >
                                  <FileText
                                    size={17}
                                    color={COLORS.primary}
                                  />

                                  <div className="registration-selected-details">
                                    <strong>{file.name}</strong>
                                    <small>
                                      {formatFileSize(file.size)}
                                    </small>
                                  </div>

                                  <button
                                    type="button"
                                    className="registration-remove-file"
                                    aria-label={`Remove ${file.name}`}
                                    onClick={() =>
                                      removeDocument(index)
                                    }
                                  >
                                    <X size={15} />
                                  </button>
                                </div>
                              )
                            )}
                          </div>
                        )}

                        <div className="registration-security-note">
                          <ShieldCheck
                            size={15}
                            color={COLORS.primary}
                          />
                          <span>
                            Documents will be submitted for
                            verification and should be accessible
                            only to authorized reviewers.
                          </span>
                        </div>
                      </div>
                    </>
                  )}

                  {error && (
                    <div
                      className="form-error-banner"
                      role="alert"
                    >
                      <AlertCircle size={17} />
                      <span>{error}</span>
                    </div>
                  )}

                  {step === 1 ? (
                    <button
                      type="submit"
                      className="submit-gold-button"
                    >
                      Next
                      <ArrowRight size={18} />
                    </button>
                  ) : (
                    <div className="registration-form-actions">
                      <button
                        type="button"
                        className="registration-back-button"
                        disabled={loading}
                        onClick={() => moveToStep(1)}
                      >
                        <ArrowLeft size={16} />
                        Back
                      </button>

                      <button
                        type="submit"
                        className="submit-gold-button"
                        disabled={loading}
                      >
                        {loading
                          ? "Submitting..."
                          : "Submit for Approval"}

                        {!loading && (
                          <ArrowRight size={17} />
                        )}
                      </button>
                    </div>
                  )}
                </form>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
