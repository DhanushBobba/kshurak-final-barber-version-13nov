
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Eye,
  EyeOff,
  Globe,
  LockKeyhole,
  Mail,
  Scissors,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react-native";

import { COLORS } from "../../constants/colors";
import {
  calculateTokenExpiry,
  clearRememberedIdentifier,
  getRememberedIdentifier,
  saveBarberSession,
  saveRememberedIdentifier,
} from "../../utils/storage";

type LoginErrorCode =
  | "ADMIN_APPROVAL_REQUIRED"
  | "APPLICATION_REJECTED"
  | "ACCOUNT_NOT_APPROVED"
  | "EMAIL_ACTIVATION_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "LOGIN_ERROR";

type PopupCode = LoginErrorCode | "LOGIN_SUCCESS";

type LoginPopup = {
  code: PopupCode;
  title: string;
  message: string;
};

type LoginResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  barber_id: string;
  username: string;
  message?: string;
};

type Props = {
  onRegister?: () => void;
  onForgotPassword?: () => void;
  onDashboard?: () => void;
};

const LOGO = require("../../../assets/images/logo.png");
const BACKGROUND = require("../../../assets/images/barber-shop.png");

const API_BASE_URL = String(
  process.env.EXPO_PUBLIC_API_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const POPUP_TITLES: Record<LoginErrorCode, string> = {
  ADMIN_APPROVAL_REQUIRED: "Admin Approval Required",
  APPLICATION_REJECTED: "Application Not Approved",
  ACCOUNT_NOT_APPROVED: "Account Not Approved",
  EMAIL_ACTIVATION_REQUIRED: "Email Activation Required",
  INVALID_CREDENTIALS: "Invalid Login Details",
  LOGIN_ERROR: "Login Unavailable",
};

class BarberLoginError extends Error {
  readonly code: LoginErrorCode;

  constructor(code: LoginErrorCode, message: string) {
    super(message);
    this.name = "BarberLoginError";
    this.code = code;
    Object.setPrototypeOf(this, BarberLoginError.prototype);
  }
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

async function loginBarber(
  identifier: string,
  password: string
): Promise<LoginResponse> {
  if (!/^https?:\/\/[^/]+/i.test(API_BASE_URL)) {
    throw new BarberLoginError(
      "LOGIN_ERROR",
      "Configure a valid EXPO_PUBLIC_API_BASE_URL."
    );
  }

  let response: Response;

  try {
    response = await fetch(
      `${API_BASE_URL}/api/v1/barber/login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          identifier,
          password,
        }),
      }
    );
  } catch {
    throw new BarberLoginError(
      "LOGIN_ERROR",
      "Cannot connect to KSHURAK backend. Check your internet connection."
    );
  }

  const data: unknown = await response
    .json()
    .catch(() => null);

  if (!response.ok) {
    const detail = isRecord(data)
      ? data.detail
      : null;

    if (
      isRecord(detail) &&
      typeof detail.code === "string" &&
      detail.code in POPUP_TITLES
    ) {
      const code = detail.code as LoginErrorCode;

      throw new BarberLoginError(
        code,
        typeof detail.message === "string"
          ? detail.message
          : "Login is not allowed."
      );
    }

    const message =
      typeof detail === "string"
        ? detail
        : isRecord(detail) &&
            typeof detail.message === "string"
        ? detail.message
        : "Unable to log in. Please try again.";

    throw new BarberLoginError(
      response.status === 401
        ? "INVALID_CREDENTIALS"
        : "LOGIN_ERROR",
      message
    );
  }

  if (
    !isRecord(data) ||
    typeof data.access_token !== "string" ||
    !data.access_token.trim() ||
    typeof data.barber_id !== "string" ||
    !data.barber_id.trim() ||
    typeof data.username !== "string" ||
    !data.username.trim()
  ) {
    throw new BarberLoginError(
      "LOGIN_ERROR",
      "Invalid login response from the backend."
    );
  }

  // The backend currently returns expires_in.
  // Do not assume this is a refreshable session.
  const expiresIn = Number(data.expires_in);

  if (
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new BarberLoginError(
      "LOGIN_ERROR",
      "The backend did not provide a valid access-token lifetime."
    );
  }

  return {
    access_token: data.access_token,
    token_type:
      typeof data.token_type === "string"
        ? data.token_type
        : "bearer",
    expires_in: expiresIn,
    barber_id: data.barber_id,
    username: data.username,
    message:
      typeof data.message === "string"
        ? data.message
        : undefined,
  };
}

export default function LoginScreen({
  onRegister,
  onForgotPassword,
  onDashboard,
}: Props) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] =
    useState(false);
  const [rememberMe, setRememberMe] =
    useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [popup, setPopup] =
    useState<LoginPopup | null>(null);

  const submittingRef = useRef(false);

  useEffect(() => {
    let active = true;

    void getRememberedIdentifier()
      .then((saved) => {
        if (!active || !saved) return;
        setIdentifier(saved);
        setRememberMe(true);
      })
      .catch(() => {
        // Remembered username is optional.
      });

    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async () => {
    if (submittingRef.current) return;

    setError("");

    const cleanIdentifier = identifier.trim();

    if (!cleanIdentifier || !password) {
      setError(
        "Please enter your email/username and password."
      );
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      const result = await loginBarber(
        cleanIdentifier,
        password
      );

      const expiresAt = calculateTokenExpiry(
        result.expires_in
      );

      if (!expiresAt) {
        throw new BarberLoginError(
          "LOGIN_ERROR",
          "Unable to determine session expiration."
        );
      }

      await saveBarberSession({
        token: result.access_token,
        barberId: result.barber_id,
        username: result.username,
        expiresAt,
      });

      if (rememberMe) {
        await saveRememberedIdentifier(
          cleanIdentifier
        );
      } else {
        await clearRememberedIdentifier();
      }

      setPassword("");

      setPopup({
        code: "LOGIN_SUCCESS",
        title: "Login Successful",
        message:
          `Welcome back, ${result.username}! ` +
          "Your account has been verified. " +
          "Continue to your dashboard.",
      });
    } catch (err: unknown) {
      if (err instanceof BarberLoginError) {
        setPopup({
          code: err.code,
          title: POPUP_TITLES[err.code],
          message: err.message,
        });
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again."
        );
      }
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const closePopup = () => {
    const success =
      popup?.code === "LOGIN_SUCCESS";

    setPopup(null);

    if (success) {
      onDashboard?.();
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      <ImageBackground
        source={BACKGROUND}
        resizeMode="cover"
        style={styles.background}
      >
        <LinearGradient
          colors={[
            "rgba(0,0,0,0.10)",
            "rgba(0,0,0,0.23)",
            "rgba(7,7,8,0.43)",
            "rgba(7,7,8,0.60)",
          ]}
          locations={[0, 0.32, 0.73, 1]}
          style={styles.backgroundGradient}
        />
      </ImageBackground>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : undefined
        }
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.topNavigation}>
            <View style={styles.partnerBadge}>
              <View style={styles.badgeDot} />
              <Text style={styles.partnerText}>
                BARBER PARTNER
              </Text>
            </View>

            <Pressable
              onPress={onRegister}
              disabled={!onRegister}
              style={styles.topRegister}
            >
              <Text style={styles.topRegisterText}>
                Register
              </Text>
              <ArrowRight
                size={15}
                color={COLORS.primary}
              />
            </Pressable>
          </View>

          <View style={styles.brandSection}>
            <View style={styles.logoContainer}>
              <Image
                source={LOGO}
                resizeMode="contain"
                style={styles.logo}
              />
            </View>

            <View style={styles.brandDivider}>
              <View style={styles.dividerLine} />
              <Scissors
                size={15}
                color={COLORS.primary}
              />
              <View style={styles.dividerLine} />
            </View>
          </View>

          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[
                "#F59E0B",
                "#7C521C",
                "#45301B",
                "#F59E0B",
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardBorder}
            >
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardIcon}>
                    <LockKeyhole
                      size={19}
                      color={COLORS.primary}
                    />
                  </View>

                  <View style={styles.cardHeaderText}>
                    <Text style={styles.cardTitle}>
                      Partner Login
                    </Text>
                    <Text style={styles.cardSubtitle}>
                      Sign in to manage your business
                    </Text>
                  </View>
                </View>

                <View style={styles.cardSeparator} />

                <Text style={styles.label}>
                  EMAIL ID / USERNAME
                </Text>

                <View style={styles.inputContainer}>
                  <Mail
                    size={18}
                    color={COLORS.primary}
                  />

                  <TextInput
                    style={styles.input}
                    placeholder="Enter email or username"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    value={identifier}
                    onChangeText={(value) => {
                      setIdentifier(value);
                      setError("");
                    }}
                    editable={!loading}
                    returnKeyType="next"
                  />
                </View>

                <Text style={styles.label}>
                  PASSWORD
                </Text>

                <View style={styles.inputContainer}>
                  <LockKeyhole
                    size={18}
                    color={COLORS.primary}
                  />

                  <TextInput
                    style={styles.input}
                    placeholder="Enter password"
                    placeholderTextColor={COLORS.textMuted}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="current-password"
                    value={password}
                    onChangeText={(value) => {
                      setPassword(value);
                      setError("");
                    }}
                    editable={!loading}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      void handleLogin();
                    }}
                  />

                  <Pressable
                    onPress={() =>
                      setShowPassword((current) => !current)
                    }
                    accessibilityLabel={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
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
                </View>

                <View style={styles.optionsRow}>
                  <Pressable
                    onPress={() =>
                      setRememberMe((current) => !current)
                    }
                    style={styles.rememberButton}
                    accessibilityRole="checkbox"
                    accessibilityState={{
                      checked: rememberMe,
                    }}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        rememberMe &&
                          styles.checkboxChecked,
                      ]}
                    >
                      {rememberMe && (
                        <CheckCircle2
                          size={14}
                          color="#090909"
                        />
                      )}
                    </View>

                    <Text style={styles.rememberText}>
                      Remember me
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={onForgotPassword}
                    disabled={!onForgotPassword}
                  >
                    <Text style={styles.forgotText}>
                      Forgot Password?
                    </Text>
                  </Pressable>
                </View>

                {!!error && (
                  <View style={styles.errorBox}>
                    <AlertCircle
                      size={17}
                      color={COLORS.error}
                    />
                    <Text style={styles.errorText}>
                      {error}
                    </Text>
                  </View>
                )}

                <Pressable
                  style={[
                    styles.loginButton,
                    loading && styles.disabledButton,
                  ]}
                  disabled={loading}
                  onPress={() => {
                    void handleLogin();
                  }}
                >
                  {loading ? (
                    <ActivityIndicator color="#090909" />
                  ) : (
                    <>
                      <Text style={styles.loginButtonText}>
                        LOGIN TO DASHBOARD
                      </Text>

                      <ArrowRight
                        size={18}
                        color="#090909"
                      />
                    </>
                  )}
                </Pressable>

                <View style={styles.securityNotice}>
                  <ShieldCheck
                    size={15}
                    color={COLORS.primary}
                  />
                  <Text style={styles.securityText}>
                    Secure access for approved barber partners
                  </Text>
                </View>

                <View style={styles.separator}>
                  <View style={styles.separatorLine} />
                  <Text style={styles.separatorText}>
                    OR
                  </Text>
                  <View style={styles.separatorLine} />
                </View>

                <Pressable
                  style={styles.googleButton}
                  disabled
                >
                  <Text style={styles.googleMark}>
                    G
                  </Text>
                  <Text style={styles.googleText}>
                    Continue with Google
                  </Text>
                </Pressable>

                <View style={styles.bottomDivider} />

                <Pressable
                  onPress={onRegister}
                  disabled={!onRegister}
                  style={styles.bottomRegister}
                >
                  <Text style={styles.bottomRegisterText}>
                    New to KSHURAK?{" "}
                    <Text style={styles.goldText}>
                      Create Account
                    </Text>
                  </Text>
                </Pressable>
              </View>
            </LinearGradient>
          </View>

          <View style={styles.footer}>
            <Globe size={14} color="#D0C0A3" />
            <Text style={styles.footerText}>
              KSHURAK · STYLE • CONFIDENCE • YOU
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={popup !== null}
        transparent
        animationType="fade"
        onRequestClose={closePopup}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalOuter}>
            <LinearGradient
              colors={[
                "#F59E0B",
                "#7C521C",
                "#49301D",
                "#F59E0B",
              ]}
              style={styles.modalBorder}
            >
              <View style={styles.modalCard}>
                <Pressable
                  onPress={closePopup}
                  style={styles.modalClose}
                  accessibilityLabel="Close popup"
                >
                  <X
                    size={21}
                    color={COLORS.textSecondary}
                  />
                </Pressable>

                <View
                  style={[
                    styles.modalIcon,
                    popup?.code === "LOGIN_SUCCESS" &&
                      styles.modalSuccessIcon,
                  ]}
                >
                  {popup?.code === "LOGIN_SUCCESS" ? (
                    <CheckCircle2
                      size={35}
                      color={COLORS.success}
                    />
                  ) : popup?.code ===
                    "ADMIN_APPROVAL_REQUIRED" ? (
                    <Clock3
                      size={35}
                      color={COLORS.primary}
                    />
                  ) : (
                    <ShieldAlert
                      size={35}
                      color={COLORS.primary}
                    />
                  )}
                </View>

                <Text style={styles.modalTitle}>
                  {popup?.title}
                </Text>

                <Text style={styles.modalMessage}>
                  {popup?.message}
                </Text>

                <Pressable
                  onPress={closePopup}
                  style={styles.loginButton}
                >
                  <Text style={styles.loginButtonText}>
                    {popup?.code === "LOGIN_SUCCESS"
                      ? "CONTINUE TO DASHBOARD"
                      : "OKAY, GOT IT"}
                  </Text>

                  <ArrowRight
                    size={18}
                    color="#090909"
                  />
                </Pressable>
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: { flex: 1 },
  background: { ...StyleSheet.absoluteFill },
  backgroundGradient: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop:
      Platform.OS === "android"
        ? (StatusBar.currentHeight || 24) + 12
        : 52,
    paddingBottom: 28,
  },
  topNavigation: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 11,
  },
  partnerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 8,
    backgroundColor: "rgba(9,9,10,0.66)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.33)",
    borderRadius: 20,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  partnerText: {
    color: "#F5E7CB",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.05,
  },
  topRegister: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: "rgba(9,9,10,0.67)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
  },
  topRegisterText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  brandSection: {
    alignItems: "center",
    marginBottom: 18,
  },
  logoContainer: {
    width: "100%",
    minHeight: 103,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: 205, height: 98 },
  brandDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  dividerLine: {
    width: 41,
    height: 1,
    backgroundColor: "rgba(245,158,11,0.7)",
  },
  cardOuter: {
    width: "100%",
    maxWidth: 380,
    alignSelf: "center",
    borderRadius: 18,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.55,
    shadowRadius: 20,
    elevation: 12,
  },
  cardBorder: { padding: 1, borderRadius: 18 },
  card: {
    backgroundColor: "rgba(10,10,11,0.92)",
    borderRadius: 17,
    paddingHorizontal: 17,
    paddingTop: 19,
    paddingBottom: 6,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  cardIcon: {
    width: 39,
    height: 39,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.27)",
  },
  cardHeaderText: { flex: 1 },
  cardTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  cardSubtitle: {
    color: "#B5B2AD",
    fontSize: 11,
    marginTop: 4,
  },
  cardSeparator: {
    height: 1,
    backgroundColor: "rgba(245,158,11,0.18)",
    marginTop: 15,
    marginBottom: 5,
  },
  label: {
    color: "#E9E1D7",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.75,
    marginTop: 12,
    marginBottom: 6,
  },
  inputContainer: {
    backgroundColor: "rgba(27,27,29,0.96)",
    borderWidth: 1,
    borderColor: "#43382B",
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: COLORS.text,
    fontSize: 12,
    paddingVertical: 8,
  },
  optionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    gap: 8,
  },
  rememberButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#8B806F",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  rememberText: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },
  forgotText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  errorBox: {
    flexDirection: "row",
    gap: 9,
    marginTop: 15,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.4)",
    borderRadius: 9,
    backgroundColor: "rgba(239,68,68,0.09)",
  },
  errorText: {
    flex: 1,
    color: "#FFAAAA",
    fontSize: 11,
    lineHeight: 17,
  },
  loginButton: {
    minHeight: 47,
    backgroundColor: COLORS.primary,
    borderRadius: 9,
    marginTop: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 12,
  },
  loginButtonText: {
    color: "#090909",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  disabledButton: { opacity: 0.6 },
  securityNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 13,
  },
  securityText: {
    color: "#AAA29A",
    fontSize: 10,
    textAlign: "center",
    flexShrink: 1,
  },
  separator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    marginTop: 16,
    marginBottom: 12,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  separatorText: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: "700",
  },
  googleButton: {
    opacity: 0.55,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 9,
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 11,
    backgroundColor: COLORS.surface,
  },
  googleMark: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: "800",
  },
  googleText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  bottomDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginTop: 15,
  },
  bottomRegister: {
    alignItems: "center",
    paddingVertical: 14,
  },
  bottomRegisterText: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  goldText: {
    color: COLORS.primary,
    fontWeight: "800",
  },
  footer: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  footerText: {
    color: "#DCCBAE",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 22,
    backgroundColor: "rgba(0,0,0,0.80)",
  },
  modalOuter: {
    width: "100%",
    maxWidth: 375,
    borderRadius: 19,
  },
  modalBorder: {
    padding: 1,
    borderRadius: 19,
  },
  modalCard: {
    backgroundColor: "#131315",
    borderRadius: 18,
    paddingHorizontal: 23,
    paddingTop: 35,
    paddingBottom: 24,
    alignItems: "center",
  },
  modalClose: {
    position: "absolute",
    top: 12,
    right: 12,
    padding: 6,
  },
  modalIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(245,158,11,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  modalSuccessIcon: {
    backgroundColor: "rgba(34,197,94,0.12)",
  },
  modalTitle: {
    color: COLORS.text,
    fontSize: 21,
    fontWeight: "800",
    textAlign: "center",
  },
  modalMessage: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 12,
  },
});
