import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  ImagePlus,
  Loader2,
  LockKeyhole,
  Mail,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Store,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";

import {
  RegistrationCorrectionError,
  resubmitRegistrationCorrection,
  validateRegistrationCorrection,
} from "../../services/registrationCorrectionApi";

import type {
  RegistrationCorrectionDetails,
} from "../../services/registrationCorrectionApi";

import "../../styles/registration-correction.css";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOCUMENT_TYPES = [...IMAGE_TYPES, "application/pdf"];

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to complete your request. Please try again.";
}

function safeUrl(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function formatDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function fileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SectionHeading({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="krc-section-heading">
      <span className="krc-section-number">{number}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="krc-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="krc-field-hint">{hint}</p>}
    </div>
  );
}

export default function CorrectRegistrationPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() || "";

  const [details, setDetails] =
    useState<RegistrationCorrectionDetails | null>(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [requiresReload, setRequiresReload] = useState(false);

  const [shopName, setShopName] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [experience, setExperience] = useState("");

  const [shopImage, setShopImage] = useState<File | null>(null);
  const [documents, setDocuments] = useState<File[]>([]);
  const [imagePreview, setImagePreview] = useState("");

  const imageInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);

  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>(
      'meta[name="referrer"]'
    );

    const previous = meta?.getAttribute("content");
    const created = !meta;

    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "referrer";
      document.head.appendChild(meta);
    }

    meta.content = "no-referrer";

    return () => {
      if (created) meta?.remove();
      else if (previous === null) meta?.removeAttribute("content");
      else if (previous !== undefined) {
        meta?.setAttribute("content", previous);
      }
    };
  }, []);

  useEffect(() => {
    if (!shopImage) {
      setImagePreview("");
      return;
    }

    const url = URL.createObjectURL(shopImage);
    setImagePreview(url);

    return () => URL.revokeObjectURL(url);
  }, [shopImage]);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setDetails(null);
    setPageError("");
    setFormError("");
    setRequiresReload(false);
    setShopImage(null);
    setDocuments([]);

    if (imageInput.current) imageInput.current.value = "";
    if (documentInput.current) documentInput.current.value = "";

    if (!token) {
      setPageError(
        "Your correction link is incomplete. Open the full link sent to your registered email."
      );
      setLoading(false);
      return () => controller.abort();
    }

    async function load() {
      try {
        const result = await validateRegistrationCorrection(
          token,
          controller.signal
        );

        if (controller.signal.aborted) return;

        setDetails(result);
        setShopName(result.shop_name || "");
        setShopPhone(result.shop_phone || "");
        setShopAddress(result.shop_address);
        setExperience(String(result.years_experience));
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setPageError(errorMessage(error));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();

    return () => controller.abort();
  }, [token, reloadKey]);

  function chooseImage(file?: File) {
    if (!file) return;
    setFormError("");

    if (!IMAGE_TYPES.includes(file.type)) {
      setFormError("Choose a JPEG, PNG or WebP shop image.");
      if (imageInput.current) imageInput.current.value = "";
      return;
    }

    if (!file.size || file.size > MAX_IMAGE_SIZE) {
      setFormError("Your shop image must be non-empty and no larger than 8 MB.");
      if (imageInput.current) imageInput.current.value = "";
      return;
    }

    setShopImage(file);
  }

  function chooseDocuments(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;

    setFormError("");

    const invalid = selected.find(
      (file) =>
        !DOCUMENT_TYPES.includes(file.type) ||
        !file.size ||
        file.size > MAX_DOCUMENT_SIZE
    );

    if (selected.length > 5 || invalid) {
      setFormError(
        selected.length > 5
          ? "Select a maximum of 5 verification documents."
          : `${invalid?.name}: choose a non-empty PDF, JPEG, PNG or WebP file up to 5 MB.`
      );

      if (documentInput.current) documentInput.current.value = "";
      return;
    }

    setDocuments(selected);
  }

  function clearImage() {
    setShopImage(null);
    if (imageInput.current) imageInput.current.value = "";
  }

  function clearDocuments() {
    setDocuments([]);
    if (documentInput.current) documentInput.current.value = "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitLock.current || !details || requiresReload) return;

    setFormError("");

    const name = shopName.trim();
    const phone = shopPhone.trim();
    const address = shopAddress.trim();
    const years = Number(experience);
    const digits = phone.replace(/\D/g, "");

    if (name.length < 2 || name.length > 150) {
      setFormError("Shop name must contain 2-150 characters.");
      return;
    }

    if (
      !/^[0-9+\-\s()]{10,20}$/.test(phone) ||
      digits.length < 10 ||
      digits.length > 15
    ) {
      setFormError("Enter a valid shop phone number with 10-15 digits.");
      return;
    }

    if (address.length < 10 || address.length > 500) {
      setFormError("Enter a complete shop address containing 10-500 characters.");
      return;
    }

    if (
      !experience.trim() ||
      !Number.isInteger(years) ||
      years < 0 ||
      years > 50
    ) {
      setFormError("Experience must be a whole number between 0 and 50.");
      return;
    }

    if (!documents.length && !details.documents.length) {
      setFormError("Upload at least one verification document.");
      return;
    }

    submitLock.current = true;
    setSubmitting(true);

    try {
      const result = await resubmitRegistrationCorrection({
        token,
        shop_name: name,
        shop_phone: phone,
        shop_address: address,
        years_experience: years,
        shop_image: shopImage,
        shop_documents: documents,
      });

      setSuccessMessage(result.message);
      setDetails(null);
      setShopImage(null);
      setDocuments([]);

      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname
      );
    } catch (error: unknown) {
      setFormError(errorMessage(error));

      if (
        !(error instanceof RegistrationCorrectionError) ||
        error.status === 0 ||
        error.status === 401 ||
        error.status === 409 ||
        error.status >= 500
      ) {
        setRequiresReload(true);
      }
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  const displayedImage =
    imagePreview || safeUrl(details?.shop_image_url);

  return (
    <main className="krc-page">
      <div className="krc-shell">
        <nav className="krc-topbar" aria-label="Page navigation">
          <Link to="/login" className="krc-wordmark">
            <span className="krc-brand-icon">
              <img
                src="/assets/logo.png"
                alt="KSHURAK Logo"
                className="krc-brand-logo"
              />
            </span>
            <span>
              KSHURAK
              <small>BARBER PARTNER</small>
            </span>
          </Link>

          <Link to="/login" className="krc-back-link">
            <ArrowLeft size={15} />
            Back to login
          </Link>
        </nav>

        <header className="krc-hero">
          <span className="krc-eyebrow">
            <span />
            PARTNER ONBOARDING
          </span>
          <h1>
            A few updates.{" "}<span>One step closer.</span>
          </h1>
          <p>
            Refine your registration details so our team can
            continue reviewing your application.
          </p>
        </header>

        {successMessage ? (
          <section className="krc-state-card krc-success" role="status">
            <div className="krc-state-icon">
              <CheckCircle2 size={35} />
            </div>
            <span className="krc-eyebrow">SUCCESSFULLY SUBMITTED</span>
            <h2>Your application is back in review.</h2>
            <p>{successMessage}</p>

            <div className="krc-success-note">
              <Clock3 size={18} />
              Pending Admin approval
            </div>

            <Link to="/login" className="krc-primary-button">
              Return to login <ArrowRight size={17} />
            </Link>
          </section>
        ) : loading ? (
          <section className="krc-state-card" role="status">
            <Loader2 className="krc-spin" size={32} />
            <h2>Preparing your application</h2>
            <p>We're validating your link and loading your saved details.</p>
          </section>
        ) : pageError ? (
          <section className="krc-state-card">
            <div className="krc-state-icon krc-error-icon">
              <LockKeyhole size={30} />
            </div>
            <h2>Let's check your correction link.</h2>
            <p role="alert">{pageError}</p>
            <p>
              If the link has expired or was already used,
              contact Admin for a new correction link.
            </p>
            <button
              type="button"
              className="krc-primary-button"
              onClick={() => setReloadKey((value) => value + 1)}
            >
              <RefreshCw size={16} /> Retry validation
            </button>
          </section>
        ) : details ? (
          <div className="krc-layout">
            <aside className="krc-sidebar">
              <section className="krc-review-card">
                <div className="krc-review-top">
                  <span className="krc-icon-tile">
                    <FileText size={20} />
                  </span>
                  <span className="krc-status">
                    <span /> Action required
                  </span>
                </div>

                <p className="krc-eyebrow">A NOTE FROM OUR TEAM</p>
                <h2>Here's what needs updating.</h2>

                <div className="krc-reason">
                  {details.correction_reason}
                </div>

                <div className="krc-date-row">
                  <Clock3 size={15} />
                  <div>
                    <span>Requested on</span>
                    <strong>
                      {formatDate(details.correction_requested_at)}
                    </strong>
                  </div>
                </div>

                <div className="krc-expiry">
                  Link valid until {formatDate(details.token_expires_at)}
                </div>
              </section>

              <section className="krc-steps-card">
                <p className="krc-eyebrow">WHAT HAPPENS NEXT</p>

                <div className="krc-step krc-step-active">
                  <span>1</span>
                  <div>
                    <strong>Update your details</strong>
                    <p>Follow the review notes above.</p>
                  </div>
                </div>

                <div className="krc-step">
                  <span>2</span>
                  <div>
                    <strong>Resubmit for review</strong>
                    <p>Our team reviews your changes.</p>
                  </div>
                </div>

                <div className="krc-step">
                  <span>3</span>
                  <div>
                    <strong>Approval & activation</strong>
                    <p>Dashboard access follows approval and activation.</p>
                  </div>
                </div>
              </section>

              <p className="krc-security">
                <ShieldCheck size={18} />
                This link allows registration corrections only.
              </p>
            </aside>

            <form className="krc-form" onSubmit={submit}>
              <div className="krc-form-top">
                <div>
                  <span className="krc-eyebrow">YOUR APPLICATION</span>
                  <h2>Registration details</h2>
                </div>
                <span className="krc-private">
                  <LockKeyhole size={13} /> Private
                </span>
              </div>

              <div className="krc-account">
                <div className="krc-avatar">
                  <UserRound size={22} />
                </div>
                <div className="krc-account-details">
                  <strong>{details.username}</strong>
                  <span><Mail size={13} /> {details.email}</span>
                </div>
                <span className="krc-account-lock" title="Account details remain unchanged">
                  <LockKeyhole size={16} />
                </span>
              </div>

              <fieldset disabled={submitting}>
                <section className="krc-form-section">
                  <SectionHeading
                    number="01"
                    title="Your shop"
                    description="Keep your business and contact information accurate."
                  />

                  <div className="krc-grid">
                    <Field label="Shop name" htmlFor="krc-shop-name">
                      <input
                        id="krc-shop-name"
                        value={shopName}
                        onChange={(event) => setShopName(event.target.value)}
                        required
                        minLength={2}
                        maxLength={150}
                        placeholder="Your shop's name"
                        autoComplete="organization"
                      />
                    </Field>

                    <Field label="Shop phone" htmlFor="krc-phone">
                      <input
                        id="krc-phone"
                        type="tel"
                        value={shopPhone}
                        onChange={(event) => setShopPhone(event.target.value)}
                        required
                        maxLength={20}
                        placeholder="Business contact number"
                        autoComplete="tel"
                      />
                    </Field>
                  </div>

                  <Field
                    label="Years of experience"
                    htmlFor="krc-experience"
                    hint="Enter completed years of professional experience."
                  >
                    <input
                      id="krc-experience"
                      className="krc-short-input"
                      type="number"
                      min={0}
                      max={50}
                      step={1}
                      required
                      value={experience}
                      onChange={(event) => setExperience(event.target.value)}
                    />
                  </Field>

                  <Field
                    label="Complete shop address"
                    htmlFor="krc-address"
                  >
                    <textarea
                      id="krc-address"
                      rows={3}
                      required
                      minLength={10}
                      maxLength={500}
                      value={shopAddress}
                      onChange={(event) => setShopAddress(event.target.value)}
                      placeholder="Building, street, area, city and postal code"
                      autoComplete="street-address"
                    />
                  </Field>

                  <span className="krc-location-note">
                    <MapPin size={13} />
                    Include a clear landmark where helpful.
                  </span>
                </section>

                <section className="krc-form-section">
                  <SectionHeading
                    number="02"
                    title="Shop photograph"
                    description="A clear image helps our team verify your business."
                  />

                  <div className="krc-photo-layout">
                    <div className="krc-photo">
                      {displayedImage ? (
                        <img
                          src={displayedImage}
                          alt={shopImage ? "New shop photograph" : "Saved shop photograph"}
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="krc-photo-empty">
                          <Store size={30} />
                          <span>Preview unavailable</span>
                        </div>
                      )}

                      <span className="krc-photo-label">
                        {shopImage ? "NEW SELECTION" : "SAVED IMAGE"}
                      </span>
                    </div>

                    <div>
                      <label className="krc-upload" htmlFor="krc-image">
                        <ImagePlus size={25} />
                        <strong>
                          {shopImage ? "Choose another image" : "Upload a replacement"}
                        </strong>
                        <span>JPEG, PNG or WebP · Up to 8 MB</span>
                        <input
                          ref={imageInput}
                          id="krc-image"
                          className="krc-file-control"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(event) => chooseImage(event.target.files?.[0])}
                        />
                      </label>

                      {shopImage ? (
                        <div className="krc-selection">
                          <span>
                            <Check size={14} />
                            {shopImage.name}
                          </span>
                          <button
                            type="button"
                            onClick={clearImage}
                            aria-label="Remove replacement image and keep saved image"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <p className="krc-field-hint">
                          Your saved image stays unless you select a replacement.
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="krc-form-section">
                  <SectionHeading
                    number="03"
                    title="Verification documents"
                    description="Review your saved documents or upload a replacement set."
                  />

                  <div className="krc-document-list">
                    {details.documents.map((document, index) => {
                      const url = safeUrl(document.signed_url);

                      return (
                        <div
                          className="krc-document"
                          key={`${document.path}-${index}`}
                        >
                          <span className="krc-document-icon">
                            <FileText size={19} />
                          </span>
                          <div>
                            <strong>
                              {document.original_name || `Verification document ${index + 1}`}
                            </strong>
                            <span>
                              {document.size ? `${fileSize(document.size)} · ` : ""}
                              Saved document
                            </span>
                          </div>
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              referrerPolicy="no-referrer"
                              aria-label={`Open document ${index + 1}`}
                            >
                              <ExternalLink size={17} />
                            </a>
                          ) : (
                            <span className="krc-muted">No preview</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {!details.documents.length && (
                    <p className="krc-field-hint">
                      No saved documents were returned. Upload at least one document.
                    </p>
                  )}

                  <label className="krc-upload krc-upload-wide" htmlFor="krc-documents">
                    <UploadCloud size={27} />
                    <strong>Select replacement documents</strong>
                    <span>PDF, JPEG, PNG or WebP · Up to 5 files · 5 MB each</span>
                    <input
                      ref={documentInput}
                      id="krc-documents"
                      className="krc-file-control"
                      type="file"
                      multiple
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={(event) => chooseDocuments(event.target.files)}
                    />
                  </label>

                  {documents.length > 0 && (
                    <div className="krc-new-documents">
                      <div className="krc-new-documents-heading">
                        <strong>{documents.length} replacement files</strong>
                        <button
                          type="button"
                          className="krc-text-button"
                          onClick={clearDocuments}
                        >
                          Clear selection
                        </button>
                      </div>

                      {documents.map((file, index) => (
                        <div
                          className="krc-selected-document"
                          key={`${file.name}-${index}`}
                        >
                          <CheckCircle2 size={15} />
                          <span>{file.name}</span>
                          <small>{fileSize(file.size)}</small>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="krc-document-note">
                    <FileText size={17} />
                    <p>
                      New uploads replace the entire saved document list.
                      Include every document you want reviewed.
                      Leave this empty to keep your current documents.
                    </p>
                  </div>
                </section>

                <div className="krc-submit-area">
                  {formError && (
                    <div className="krc-error-message" role="alert">
                      {formError}
                    </div>
                  )}

                  {requiresReload && (
                    <button
                      type="button"
                      className="krc-secondary-button"
                      onClick={() => setReloadKey((value) => value + 1)}
                    >
                      <RefreshCw size={15} />
                      Reload application status
                    </button>
                  )}

                  <div className="krc-submit-row">
                    <p>
                      <ShieldCheck size={18} />
                      <span>
                        Ready for another look?
                        <small>Your changes will return to Admin for review.</small>
                      </span>
                    </p>

                    <button
                      type="submit"
                      className="krc-primary-button"
                      disabled={submitting || requiresReload}
                    >
                      {submitting ? (
                        <>
                          <Loader2 size={17} className="krc-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          Resubmit application
                          <ArrowRight size={17} />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </fieldset>
            </form>
          </div>
        ) : null}

        <footer className="krc-footer">
          <span>KSHURAK <span className="krc-footer-dot">·</span> Partner registration</span>
          <span><ShieldCheck size={13} /> Secure correction access</span>
        </footer>
      </div>
    </main>
  );
}