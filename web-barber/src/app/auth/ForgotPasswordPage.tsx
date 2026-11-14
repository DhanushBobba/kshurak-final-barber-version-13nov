
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import {
  Mail,
  ArrowRight,
  ArrowLeft,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Clock3,
  Globe,
} from "lucide-react";

import { requestBarberPasswordReset } from "../../services/barberAuthService";

import "../../styles/forgot-password.css";

const LOGO_PATH = "/assets/logo.png";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (loading) return;

    setError("");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);

    try {
      await requestBarberPasswordReset(email);
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to request password reset."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="kfp-page">
      <div className="kfp-overlay" />

      {/* HEADER */}
      <header className="kfp-header">
        <Link to="/login" className="kfp-logo">
          <img src={LOGO_PATH} alt="KSHURAK" />
        </Link>

        <Link to="/login" className="kfp-header-link">
          <ArrowLeft size={18} />
          Back to Login
        </Link>
      </header>

      {/* MAIN CONTENT */}
      <main className="kfp-main">
        {/* LEFT HERO */}
        <section className="kfp-hero">
          <div>
            <span className="kfp-eyebrow">
              KSHURAK ACCOUNT SECURITY
            </span>

            <h1>
              Forgot Your
              <span>Password?</span>
            </h1>

            <p>
              Securely recover access to your
              <br />
              KSHURAK barber account and
              <br />
              get back to managing your shop.
            </p>

            <div className="kfp-benefits">
              <div className="kfp-benefit">
                <span className="kfp-benefit-icon">
                  <ShieldCheck size={25} />
                </span>
                <span>Secure<br />Recovery</span>
              </div>

              <div className="kfp-benefit">
                <span className="kfp-benefit-icon">
                  <Mail size={25} />
                </span>
                <span>Email<br />Verification</span>
              </div>

              <div className="kfp-benefit">
                <span className="kfp-benefit-icon">
                  <Clock3 size={25} />
                </span>
                <span>15-Minute<br />Reset Link</span>
              </div>
            </div>
          </div>

          <div className="kfp-hero-footer">
            <Globe size={19} />
            <span>kshurak.inteleraai.com</span>
          </div>
        </section>

        {/* RIGHT CARD */}
        <section className="kfp-card-column">
          <div className="kfp-card">
            {submitted ? (
              <div
                className="kfp-success"
                role="status"
                aria-live="polite"
              >
                <div className="kfp-success-icon">
                  <CheckCircle2 size={43} />
                </div>

                <h2>Check Your Email</h2>

                <p>
                  If an eligible KSHURAK account
                  exists for this email, a password-reset
                  link will be sent.
                </p>

                <div className="kfp-info-box">
                  <Mail size={20} />

                  <span>
                    Check your inbox and spam folder.
                    The reset link expires after 15 minutes.
                  </span>
                </div>

                <Link
                  to="/login"
                  className="kfp-primary-button"
                >
                  Back to Login
                  <ArrowRight size={20} />
                </Link>

                <button
                  type="button"
                  className="kfp-text-button"
                  onClick={() => {
                    setSubmitted(false);
                    setError("");
                  }}
                >
                  Try another email
                </button>
              </div>
            ) : (
              <>
                <div className="kfp-card-brand">
                  <KeyRound size={25} />
                  <span>ACCOUNT RECOVERY</span>
                </div>

                <h2>Reset Your Password</h2>

                <p className="kfp-card-description">
                  Enter your registered email address.
                  We'll send you instructions to reset
                  your password securely.
                </p>

                <form onSubmit={handleSubmit}>
                  <div className="kfp-form-group">
                    <label htmlFor="reset-email">
                      Registered Email Address
                    </label>

                    <div className="kfp-input-wrapper">
                      <Mail size={20} />

                      <input
                        id="reset-email"
                        type="email"
                        placeholder="Enter your registered email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value);
                          setError("");
                        }}
                        required
                      />
                    </div>
                  </div>

                  {error && (
                    <div
                      className="kfp-error"
                      role="alert"
                    >
                      <AlertCircle size={18} />
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="kfp-primary-button"
                    disabled={loading}
                  >
                    {loading
                      ? "Sending Reset Link..."
                      : "Send Reset Link"}

                    {!loading && <ArrowRight size={20} />}
                  </button>
                </form>

                <div className="kfp-help-text">
                  Remember your password?{" "}
                  <Link to="/login">
                    Login here
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
