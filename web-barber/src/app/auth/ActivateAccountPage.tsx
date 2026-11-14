
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Clock3,
  Globe,
  KeyRound,
  LoaderCircle,
  MailCheck,
  ShieldCheck,
} from "lucide-react";

import { activateBarberAccount } from "../../services/barberAuthService";
import "../../styles/forgot-password.css";

const LOGO_PATH = "/assets/logo.png";

type ActivationStatus =
  | "ready"
  | "loading"
  | "success"
  | "error"
  | "missing";

export default function ActivateAccountPage() {
  const [token] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token")?.trim() || "";
  });

  const [status, setStatus] = useState<ActivationStatus>(
    token ? "ready" : "missing"
  );

  const [error, setError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);

    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");

      window.history.replaceState(
        window.history.state,
        "",
        url.pathname + url.search + url.hash
      );
    }
  }, []);

  const handleActivation = async () => {
    if (!token || status === "loading" || status === "success") {
      return;
    }

    setStatus("loading");
    setError("");

    try {
      await activateBarberAccount(token);
      setStatus("success");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to activate your account. Please try again."
      );
      setStatus("error");
    }
  };

  return (
    <div className="kfp-page">
      <div className="kfp-overlay" />

      <header className="kfp-header">
        <Link to="/login" className="kfp-logo">
          <img src={LOGO_PATH} alt="KSHURAK" />
        </Link>

        <Link to="/login" className="kfp-header-link">
          <ArrowLeft size={18} />
          Back to Login
        </Link>
      </header>

      <main className="kfp-main">
        <section className="kfp-hero">
          <div>
            <span className="kfp-eyebrow">
              KSHURAK ACCOUNT SECURITY
            </span>

            <h1>
              Activate Your
              <span>Barber Account.</span>
            </h1>

            <p>
              Verify your email address and
              <br />
              securely activate your approved
              <br />
              KSHURAK Barber account.
            </p>

            <div className="kfp-benefits">
              <div className="kfp-benefit">
                <span className="kfp-benefit-icon">
                  <ShieldCheck size={25} />
                </span>
                <span>Secure<br />Activation</span>
              </div>

              <div className="kfp-benefit">
                <span className="kfp-benefit-icon">
                  <MailCheck size={25} />
                </span>
                <span>Email<br />Verification</span>
              </div>

              <div className="kfp-benefit">
                <span className="kfp-benefit-icon">
                  <Clock3 size={25} />
                </span>
                <span>Protected<br />Access</span>
              </div>
            </div>
          </div>

          <div className="kfp-hero-footer">
            <Globe size={19} />
            <span>kshurak.inteleraai.com</span>
          </div>
        </section>

        <section className="kfp-card-column">
          <div className="kfp-card">
            {status === "success" ? (
              <div className="kfp-success" role="status">
                <div className="kfp-success-icon">
                  <CheckCircle2 size={43} />
                </div>

                <h2>Account Activated!</h2>

                <p>
                  Your email has been successfully verified.
                  You can now log in to your KSHURAK Barber account.
                </p>

                <div className="kfp-info-box">
                  <ShieldCheck size={20} />
                  <span>
                    Your account is activated and ready to use.
                  </span>
                </div>

                <Link to="/login" className="kfp-primary-button">
                  Continue to Login
                  <ArrowRight size={20} />
                </Link>
              </div>
            ) : status === "missing" ? (
              <div className="kfp-success" role="alert">
                <div className="kfp-success-icon">
                  <AlertCircle size={43} />
                </div>

                <h2>Activation Link Required</h2>

                <p>
                  Please open the activation link sent
                  to your registered email address.
                </p>

                <Link to="/login" className="kfp-primary-button">
                  Back to Login
                  <ArrowRight size={20} />
                </Link>
              </div>
            ) : (
              <>
                <div className="kfp-card-brand">
                  <KeyRound size={25} />
                  <span>EMAIL ACTIVATION</span>
                </div>

                <h2>Verify Your Account</h2>

                <p className="kfp-card-description">
                  Your activation link is ready.
                  Click below to securely activate
                  your approved Barber account.
                </p>

                {status === "error" && (
                  <div className="kfp-error" role="alert">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="button"
                  className="kfp-primary-button"
                  onClick={handleActivation}
                  disabled={status === "loading"}
                >
                  {status === "loading"
                    ? "Activating Account..."
                    : status === "error"
                      ? "Try Again"
                      : "Activate My Account"}

                  {status === "loading" ? (
                    <LoaderCircle size={20} />
                  ) : (
                    <ArrowRight size={20} />
                  )}
                </button>

                <div className="kfp-help-text">
                  Already activated?{" "}
                  <Link to="/login">Login here</Link>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
