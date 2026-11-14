
import React, { useRef, useState } from "react";
import { ActivityIndicator, Image, ImageBackground, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, Scissors, ShieldCheck } from "lucide-react-native";
import { COLORS } from "../../constants/colors";
type Props = { token: string; onLogin?: () => void };
const LOGO = require("../../../assets/images/logo.png");
const BACKGROUND = require("../../../assets/images/barber-shop.png");
const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || "").trim().replace(/\/+$/, "");
function getErrorMessage(data: unknown): string {
  const fallback = "Password reset failed. The link may be invalid or expired.";
  if (!data || typeof data !== "object") return fallback;
  const body = data as { detail?: unknown; message?: unknown };
  if (typeof body.detail === "string") return body.detail;
  if (body.detail && typeof body.detail === "object" && !Array.isArray(body.detail)) {
    const detail = body.detail as { message?: unknown };
    if (typeof detail.message === "string") return detail.message;
  }
  if (Array.isArray(body.detail)) {
    const messages = body.detail.map((item: unknown) => {
      if (!item || typeof item !== "object") return "";
      const message = (item as { msg?: unknown }).msg;
      return typeof message === "string" ? message : "";
    }).filter(Boolean);
    if (messages.length > 0) return messages.join(", ");
  }
  if (typeof body.message === "string") return body.message;
  return fallback;
}
async function resetBarberPassword(token: string, newPassword: string): Promise<void> {
  if (!/^https?:\/\/[^/]+/i.test(API_BASE_URL)) throw new Error("Backend URL is missing or invalid. Check EXPO_PUBLIC_API_BASE_URL in your .env file.");
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/barber/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token, new_password: newPassword }),
    });
  } catch {
    throw new Error("Cannot connect to KSHURAK backend. Check your network connection and backend server.");
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    if (response.status === 503) throw new Error("Password recovery is temporarily unavailable. Please try again later.");
    throw new Error(getErrorMessage(data));
  }
}
export default function ResetPasswordScreen({ token, onLogin }: Props) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);
  const validToken = typeof token === "string" && token.trim().length >= 20;
  const submitPassword = async () => {
    if (submittingRef.current || success) return;
    setError("");
    if (!validToken) {
      setError("Password-reset link is missing or invalid. Please request a new link.");
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError("Password must contain 8–128 characters, including at least one letter and one number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      await resetBarberPassword(token.trim(), newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setShowConfirmPassword(false);
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to reset password.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ImageBackground source={BACKGROUND} resizeMode="cover" style={styles.background}>
        <LinearGradient colors={["rgba(0,0,0,0.10)", "rgba(0,0,0,0.23)", "rgba(7,7,8,0.43)", "rgba(7,7,8,0.60)"]} locations={[0, 0.32, 0.73, 1]} style={styles.backgroundGradient} />
      </ImageBackground>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.topNavigation}>
            <View style={styles.securityBadge}><View style={styles.badgeDot} /><Text style={styles.badgeText}>ACCOUNT SECURITY</Text></View>
            <Pressable onPress={onLogin} disabled={!onLogin} style={styles.topLogin} accessibilityRole="button"><ArrowLeft size={15} color={COLORS.primary} /><Text style={styles.topLoginText}>Login</Text></Pressable>
          </View>
          <View style={styles.brandSection}>
            <View style={styles.logoContainer}><Image source={LOGO} resizeMode="contain" style={styles.logo} /></View>
            <View style={styles.brandDivider}><View style={styles.dividerLine} /><Scissors size={15} color={COLORS.primary} /><View style={styles.dividerLine} /></View>
            <Text style={styles.brandHeading}>SECURE YOUR <Text style={styles.brandGold}>KSHURAK</Text> ACCOUNT</Text>
            <Text style={styles.brandSubtitle}>Your craft deserves secure access.</Text>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient colors={["#F59E0B", "#7C521C", "#45301B", "#F59E0B"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardBorder}>
              <View style={styles.card}>
                {success ? (
                  <View style={styles.successContent}>
                    <View style={styles.successIcon}><CheckCircle2 size={43} color={COLORS.success} /></View>
                    <Text style={[styles.cardTitle, styles.centerText]}>Password Updated!</Text>
                    <Text style={styles.successDescription}>Your KSHURAK barber account password has been reset successfully. You can now log in using your new password.</Text>
                    <View style={styles.successNotice}><ShieldCheck size={18} color={COLORS.success} /><Text style={styles.successNoticeText}>Your new password is ready to use.</Text></View>
                    <Pressable style={styles.primaryButton} onPress={onLogin} disabled={!onLogin}><Text style={styles.primaryButtonText}>CONTINUE TO LOGIN</Text><ArrowRight size={18} color="#090909" /></Pressable>
                  </View>
                ) : (
                  <>
                    <View style={styles.cardHeader}>
                      <View style={styles.cardIcon}><KeyRound size={20} color={COLORS.primary} /></View>
                      <View style={styles.cardHeaderText}><Text style={styles.cardTitle}>Set New Password</Text><Text style={styles.cardSubtitle}>Recover your account securely</Text></View>
                    </View>
                    <View style={styles.cardSeparator} />
                    <Text style={styles.introText}>Create a secure password to regain access to your KSHURAK barber account.</Text>
                    {!validToken ? <View style={styles.errorBox}><AlertCircle size={17} color={COLORS.error} /><Text style={styles.errorText}>Invalid or missing reset link. Please request a new password-reset email.</Text></View> : null}
                    <Text style={styles.label}>NEW PASSWORD</Text>
                    <View style={styles.inputContainer}>
                      <LockKeyhole size={18} color={COLORS.primary} />
                      <TextInput style={styles.input} placeholder="Enter new password" placeholderTextColor={COLORS.textMuted} value={newPassword} onChangeText={(value) => { setNewPassword(value); setError(""); }} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" editable={!loading} returnKeyType="next" />
                      <Pressable onPress={() => setShowPassword((value) => !value)} accessibilityLabel={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} color={COLORS.textSecondary} /> : <Eye size={18} color={COLORS.textSecondary} />}</Pressable>
                    </View>
                    <Text style={styles.label}>CONFIRM NEW PASSWORD</Text>
                    <View style={styles.inputContainer}>
                      <LockKeyhole size={18} color={COLORS.primary} />
                      <TextInput style={styles.input} placeholder="Confirm new password" placeholderTextColor={COLORS.textMuted} value={confirmPassword} onChangeText={(value) => { setConfirmPassword(value); setError(""); }} secureTextEntry={!showConfirmPassword} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" editable={!loading} returnKeyType="done" onSubmitEditing={() => { void submitPassword(); }} />
                      <Pressable onPress={() => setShowConfirmPassword((value) => !value)} accessibilityLabel={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}>{showConfirmPassword ? <EyeOff size={18} color={COLORS.textSecondary} /> : <Eye size={18} color={COLORS.textSecondary} />}</Pressable>
                    </View>
                    <View style={styles.passwordNotice}><ShieldCheck size={15} color={COLORS.primary} /><Text style={styles.passwordHint}>Use 8–128 characters, including a letter and a number.</Text></View>
                    {error ? <View style={styles.errorBox}><AlertCircle size={17} color={COLORS.error} /><Text style={styles.errorText}>{error}</Text></View> : null}
                    <Pressable style={[styles.primaryButton, (loading || !validToken) && styles.disabledButton]} disabled={loading || !validToken} onPress={() => { void submitPassword(); }}>
                      {loading ? <ActivityIndicator color="#090909" /> : <><Text style={styles.primaryButtonText}>RESET PASSWORD</Text><ArrowRight size={18} color="#090909" /></>}
                    </Pressable>
                    <View style={styles.bottomDivider} />
                    <Pressable onPress={onLogin} disabled={!onLogin} style={styles.bottomLogin}><Text style={styles.bottomLoginText}>Remember your password? <Text style={styles.goldText}>Login Now</Text></Text></Pressable>
                  </>
                )}
              </View>
            </LinearGradient>
          </View>
          <View style={styles.footerSection}><Text style={styles.footer}>© 2026 KSHURAK · PREMIUM BARBER PLATFORM</Text><Text style={styles.footerTagline}>STYLE  •  CONFIDENCE  •  YOU</Text></View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  background: { ...StyleSheet.absoluteFill },
  backgroundGradient: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 24) + 12 : 52, paddingBottom: 30 },
  topNavigation: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  securityBadge: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: "rgba(9,9,10,0.65)", borderWidth: 1, borderColor: "rgba(245,158,11,0.33)", borderRadius: 20 },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  badgeText: { color: "#F5E7CB", fontSize: 9, fontWeight: "800", letterSpacing: 1.05 },
  topLogin: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 20, backgroundColor: "rgba(9,9,10,0.67)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" },
  topLoginText: { color: COLORS.primary, fontSize: 12, fontWeight: "800" },
  brandSection: { alignItems: "center", marginBottom: 21 },
  logoContainer: { width: "100%", minHeight: 104, alignItems: "center", justifyContent: "center" },
  logo: { width: 205, height: 99 },
  brandDivider: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 11 },
  dividerLine: { width: 42, height: 1, backgroundColor: "rgba(245,158,11,0.70)" },
  brandHeading: { color: COLORS.text, fontSize: 12, fontWeight: "900", letterSpacing: 0.8, textAlign: "center", textShadowColor: "rgba(0,0,0,0.9)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  brandGold: { color: COLORS.primary },
  brandSubtitle: { color: "#F2E8D9", fontSize: 11, textAlign: "center", marginTop: 7, textShadowColor: "#000000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  cardOuter: { width: "100%", maxWidth: 380, alignSelf: "center", borderRadius: 18, shadowColor: "#000000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.55, shadowRadius: 20, elevation: 12 },
  cardBorder: { padding: 1, borderRadius: 18 },
  card: { backgroundColor: "rgba(10,10,11,0.93)", borderRadius: 17, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 7 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  cardIcon: { width: 41, height: 41, borderRadius: 11, backgroundColor: "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: "rgba(245,158,11,0.27)", alignItems: "center", justifyContent: "center" },
  cardHeaderText: { flex: 1 },
  cardTitle: { color: COLORS.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  centerText: { textAlign: "center" },
  cardSubtitle: { color: "#B5B2AD", fontSize: 11, marginTop: 4 },
  cardSeparator: { height: 1, backgroundColor: "rgba(245,158,11,0.18)", marginTop: 16, marginBottom: 15 },
  introText: { color: "#C9C4BE", fontSize: 12, lineHeight: 19, marginBottom: 7 },
  label: { color: "#E9E1D7", fontSize: 10, fontWeight: "800", letterSpacing: 0.8, marginTop: 14, marginBottom: 7 },
  inputContainer: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#493C2D", backgroundColor: "rgba(27,27,29,0.95)", borderRadius: 9 },
  input: { flex: 1, minWidth: 0, fontSize: 12, color: COLORS.text, paddingVertical: 9 },
  passwordNotice: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 15 },
  passwordHint: { flex: 1, color: "#ADA69D", fontSize: 10, lineHeight: 16 },
  primaryButton: { minHeight: 48, backgroundColor: COLORS.primary, borderRadius: 9, marginTop: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 12 },
  primaryButtonText: { color: "#090909", fontSize: 12, fontWeight: "900", letterSpacing: 0.6, textAlign: "center" },
  disabledButton: { opacity: 0.5 },
  bottomDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.09)", marginTop: 18 },
  bottomLogin: { paddingVertical: 17, alignItems: "center" },
  bottomLoginText: { color: COLORS.textSecondary, fontSize: 12 },
  goldText: { color: COLORS.primary, fontWeight: "800" },
  errorBox: { flexDirection: "row", gap: 9, padding: 11, marginTop: 14, borderRadius: 9, borderWidth: 1, borderColor: "rgba(239,68,68,0.4)", backgroundColor: "rgba(239,68,68,0.09)" },
  errorText: { flex: 1, color: "#FFAAAA", fontSize: 11, lineHeight: 18 },
  successContent: { alignItems: "center", paddingVertical: 17 },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  successDescription: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 21, textAlign: "center", marginTop: 14 },
  successNotice: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 20, padding: 12, borderWidth: 1, borderColor: "rgba(34,197,94,0.25)", borderRadius: 9, backgroundColor: "rgba(34,197,94,0.07)" },
  successNoticeText: { color: "#A8E2B5", fontSize: 11, flexShrink: 1 },
  footerSection: { alignItems: "center", marginTop: 23 },
  footer: { color: "#E1D7C5", fontSize: 9, fontWeight: "700", textAlign: "center", letterSpacing: 0.3, textShadowColor: "#000000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
  footerTagline: { color: COLORS.primary, fontSize: 9, fontWeight: "800", letterSpacing: 2, marginTop: 8 },
});
