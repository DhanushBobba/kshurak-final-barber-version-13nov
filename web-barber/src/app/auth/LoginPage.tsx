
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import {
  Mail,
  LockKeyhole,
  Eye,
  EyeOff,
  ArrowRight,
  CalendarCheck,
  UsersRound,
  ChartNoAxesCombined,
  Globe,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  Clock3,
  X,
} from "lucide-react";

import {
  loginBarber,
  BarberLoginError,
  type LoginErrorCode,
} from "../../services/loginService";

import "../../styles/login.css";

type LoginPopup = {
  code: LoginErrorCode | "LOGIN_SUCCESS";
  title: string;
  message: string;
};

const LOGO_PATH = "/assets/logo.png";

export default function LoginPage() {
  const navigate = useNavigate();

  // Load the previously remembered username or email.
  const [identifier, setIdentifier] = useState<string>(() => {
    return (
      localStorage.getItem("kshurak_barber_identifier") || ""
    );
  });

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [rememberMe, setRememberMe] = useState(() =>
    Boolean(
      localStorage.getItem("kshurak_barber_identifier")
    )
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [popup, setPopup] = useState<LoginPopup | null>(null);

  // =====================================================
  // LOGIN STATUS POPUP
  // =====================================================

  const showLoginPopup = (
    code: LoginErrorCode,
    message: string
  ) => {
    const titles: Record<LoginErrorCode, string> = {
      ADMIN_APPROVAL_REQUIRED:
        "Admin Approval Required",

      APPLICATION_REJECTED:
        "Application Not Approved",

      ACCOUNT_NOT_APPROVED:
        "Account Not Approved",

      EMAIL_ACTIVATION_REQUIRED:
        "Email Activation Required",

      INVALID_CREDENTIALS:
        "Invalid Login Details",

      LOGIN_ERROR:
        "Login Unavailable",
    };

    setPopup({
      code,
      title: titles[code],
      message,
    });
  };

  // =====================================================
  // HANDLE BARBER LOGIN
  // =====================================================

  const handleLogin = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (loading) return;

    setError("");
    setPopup(null);

    const trimmedIdentifier = identifier.trim();

    if (!trimmedIdentifier || !password) {
      setError(
        "Please enter your email/username and password."
      );
      return;
    }

    setLoading(true);

    try {
      // -----------------------------------------------
      // CALL EXISTING FASTAPI LOGIN SERVICE
      // -----------------------------------------------

      const result = await loginBarber({
        identifier: trimmedIdentifier,
        password,
      });

      // -----------------------------------------------
      // STORE AUTHENTICATED BARBER SESSION
      // -----------------------------------------------

      sessionStorage.setItem(
        "kshurak_barber_token",
        result.access_token
      );

      sessionStorage.setItem(
        "kshurak_barber_id",
        result.barber_id
      );

      sessionStorage.setItem(
        "kshurak_barber_username",
        result.username
      );

      // Remove legacy session keys, if present.
      sessionStorage.removeItem(
        "barber_access_token"
      );

      sessionStorage.removeItem(
        "barber_id"
      );

      sessionStorage.removeItem(
        "barber_username"
      );

      // -----------------------------------------------
      // REMEMBER EMAIL / USERNAME ONLY
      // -----------------------------------------------

      if (rememberMe) {
        localStorage.setItem(
          "kshurak_barber_identifier",
          trimmedIdentifier
        );
      } else {
        localStorage.removeItem(
          "kshurak_barber_identifier"
        );
      }

      // Clear the password after login.
      setPassword("");

      // -----------------------------------------------
      // SHOW SUCCESS POPUP
      // -----------------------------------------------

      setPopup({
        code: "LOGIN_SUCCESS",
        title: "Login Successful",
        message:
          `Welcome back, ${result.username}! ` +
          "Your account has been verified. " +
          "Click Continue to open your dashboard.",
      });

    } catch (err) {
      // -----------------------------------------------
      // EXISTING LOGIN ERROR HANDLING
      // -----------------------------------------------

      if (err instanceof BarberLoginError) {
        showLoginPopup(
          err.code,
          err.message
        );
      } else {
        setError(
          "Something went wrong. Please try again."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // CLOSE POPUP / OPEN DASHBOARD
  // =====================================================

  const closePopup = () => {
    const loginWasSuccessful =
      popup?.code === "LOGIN_SUCCESS";

    setPopup(null);

    // IMPORTANT NEW FUNCTIONALITY:
    // After successful login, navigate to the
    // authenticated Barber Dashboard.
    if (loginWasSuccessful) {
      navigate("/dashboard", {
        replace: true,
      });
    }
  };

  // =====================================================
  // LOGIN UI
  // =====================================================

  return (
    <div className="kl-page">
      <div className="kl-background-overlay" />

      {/* HEADER */}
      <header className="kl-header">
        <a
          href="/register"
          className="kl-header-logo"
        >
          <img
            src={LOGO_PATH}
            alt="KSHURAK"
          />
        </a>

        <div className="kl-header-register">
          <span>
            Don't have an account?
          </span>

          <button
            type="button"
            onClick={() =>
              navigate("/register")
            }
          >
            Register
            <ArrowRight size={18} />
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="kl-main">

        {/* LEFT HERO */}
        <section className="kl-hero">
          <div className="kl-hero-content">

            <h1>
              Welcome Back,
              <span>Barber</span>
            </h1>

            <p>
              Log in to your KSHURAK account
              <br />
              and manage your bookings,
              <br />
              customers and business.
            </p>

            <div className="kl-features">

              <div className="kl-feature">
                <div className="kl-feature-icon">
                  <CalendarCheck size={30} />
                </div>

                <span>
                  Manage
                  <br />
                  Bookings
                </span>
              </div>

              <div className="kl-feature">
                <div className="kl-feature-icon">
                  <UsersRound size={30} />
                </div>

                <span>
                  Track
                  <br />
                  Customers
                </span>
              </div>

              <div className="kl-feature">
                <div className="kl-feature-icon">
                  <ChartNoAxesCombined size={30} />
                </div>

                <span>
                  Grow
                  <br />
                  Your Business
                </span>
              </div>

            </div>
          </div>

          <div className="kl-hero-footer">
            <div>
              <Globe size={20} />
              <span>kshurak.com</span>
            </div>

            <span className="kl-footer-line" />
          </div>
        </section>

        {/* RIGHT LOGIN CARD */}
        <section className="kl-login-column">
          <div className="kl-login-card">

            <h2>
              Login to Your Account
            </h2>

            <p className="kl-card-subtitle">
              Access your dashboard and manage
              your shop
            </p>

            <form onSubmit={handleLogin}>

              {/* EMAIL / USERNAME */}
              <div className="kl-form-group">
                <label htmlFor="login-identifier">
                  Email ID / Username
                </label>

                <div className="kl-input-wrapper">
                  <Mail size={21} />

                  <input
                    id="login-identifier"
                    type="text"
                    autoComplete="username"
                    placeholder="Enter your email or username"
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      setError("");
                    }}
                    required
                  />
                </div>
              </div>

              {/* PASSWORD */}
              <div className="kl-form-group">
                <label htmlFor="login-password">
                  Password
                </label>

                <div className="kl-input-wrapper">
                  <LockKeyhole size={21} />

                  <input
                    id="login-password"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError("");
                    }}
                    required
                  />

                  <button
                    type="button"
                    className="kl-eye-button"
                    aria-label={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
                    onClick={() =>
                      setShowPassword(
                        (current) => !current
                      )
                    }
                  >
                    {showPassword ? (
                      <EyeOff size={20} />
                    ) : (
                      <Eye size={20} />
                    )}
                  </button>
                </div>
              </div>

              {/* REMEMBER ME / FORGOT PASSWORD */}
              <div className="kl-form-options">

                <label className="kl-remember">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) =>
                      setRememberMe(
                        e.target.checked
                      )
                    }
                  />

                  <span>
                    Remember me
                  </span>
                </label>

                <button
                  type="button"
                  className="kl-text-link"
                  onClick={() =>
                    navigate("/forgot-password")
                  }
                >
                  Forgot Password?
                </button>

              </div>

              {/* INLINE ERROR */}
              {error && (
                <div
                  className="kl-inline-error"
                  role="alert"
                >
                  <AlertCircle size={17} />
                  <span>{error}</span>
                </div>
              )}

              {/* LOGIN BUTTON */}
              <button
                type="submit"
                className="kl-submit"
                disabled={loading}
              >
                {loading
                  ? "Signing In..."
                  : "Login"}

                {!loading && (
                  <ArrowRight size={21} />
                )}
              </button>

              {/* GOOGLE SIGN-IN PLACEHOLDER */}
              <div className="kl-separator">
                <span />
                <p>or continue with</p>
                <span />
              </div>

              <button
                type="button"
                className="kl-google-button"
                disabled
                title="Google login is not configured"
              >
                <span className="kl-google-mark">
                  G
                </span>

                Continue with Google
              </button>

            </form>
          </div>
        </section>
      </main>

      {/* LOGIN STATUS POPUP */}
      {popup && (
        <div
          className="kl-modal-backdrop"
          onClick={closePopup}
        >
          <div
            className="kl-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="kl-modal-title"
            aria-describedby="kl-modal-message"
            onClick={(e) =>
              e.stopPropagation()
            }
          >

            {/* CLOSE BUTTON */}
            <button
              type="button"
              className="kl-modal-close"
              onClick={closePopup}
              aria-label="Close popup"
            >
              <X size={20} />
            </button>

            {/* STATUS ICON */}
            <div
              className={
                popup.code === "LOGIN_SUCCESS"
                  ? "kl-modal-icon kl-modal-success"
                  : "kl-modal-icon"
              }
            >
              {popup.code ===
                "LOGIN_SUCCESS" ? (
                <CheckCircle2 size={34} />
              ) : popup.code ===
                "ADMIN_APPROVAL_REQUIRED" ? (
                <Clock3 size={34} />
              ) : (
                <ShieldAlert size={34} />
              )}
            </div>

            {/* STATUS MESSAGE */}
            <h3 id="kl-modal-title">
              {popup.title}
            </h3>

            <p id="kl-modal-message">
              {popup.message}
            </p>

            {/* CONTINUE BUTTON */}
            <button
              type="button"
              className="kl-submit kl-modal-action"
              onClick={closePopup}
            >
              {popup.code === "LOGIN_SUCCESS"
                ? "Continue to Dashboard"
                : "Okay, Got It"}
            </button>

          </div>
        </div>
      )}
    </div>
  );
}
