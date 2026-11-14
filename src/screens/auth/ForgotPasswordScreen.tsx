
import React, { useRef, useState } from "react";
import { ActivityIndicator, Image, ImageBackground, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, KeyRound, Mail, Scissors, ShieldCheck } from "lucide-react-native";
import { COLORS } from "../../constants/colors";
type Props = { onLogin?: () => void };
const LOGO = require("../../../assets/images/logo.png");
const BACKGROUND = require("../../../assets/images/barber-shop.png");
const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
function getErrorMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "Unable to request password reset. Please try again.";
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
  return "Unable to request password reset. Please try again.";
}
async function requestBarberPasswordReset(email: string): Promise<void> {
  if (!/^https?:\/\/[^/]+/i.test(API_BASE_URL)) {
    throw new Error("Backend URL is missing or invalid. Check EXPO_PUBLIC_API_BASE_URL in your .env file.");
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/barber/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
  } catch {
    throw new Error("Cannot connect to KSHURAK backend. Check your Wi-Fi connection and backend server.");
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    if (response.status === 503) throw new Error("Password recovery is temporarily unavailable. Please try again later.");
    throw new Error(getErrorMessage(data));
  }
}
export default function ForgotPasswordScreen({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);
  const submitRequest = async () => {
    if (submittingRef.current) return;
    const cleanEmail = email.trim().toLowerCase();
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("Please enter a valid registered email address.");
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      await requestBarberPasswordReset(cleanEmail);
      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ImageBackground source={BACKGROUND} resizeMode="cover" style={styles.background}>
        <LinearGradient colors={["rgba(0,0,0,0.10)", "rgba(0,0,0,0.22)", "rgba(7,7,8,0.42)", "rgba(7,7,8,0.60)"]} locations={[0, 0.32, 0.73, 1]} style={styles.backgroundGradient} />
      </ImageBackground>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.topNavigation}>
            <View style={styles.partnerBadge}><View style={styles.badgeDot} /><Text style={styles.partnerText}>ACCOUNT SECURITY</Text></View>
            <Pressable onPress={onLogin} disabled={!onLogin} style={styles.topLogin} accessibilityRole="button"><ArrowLeft size={15} color={COLORS.primary} /><Text style={styles.topLoginText}>Login</Text></Pressable>
          </View>
          <View style={styles.brandSection}>
            <View style={styles.logoContainer}><Image source={LOGO} resizeMode="contain" style={styles.logo} /></View>
            <View style={styles.brandDivider}><View style={styles.dividerLine} /><Scissors size={15} color={COLORS.primary} /><View style={styles.dividerLine} /></View>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient colors={["#F59E0B", "#7C521C", "#45301B", "#F59E0B"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardBorder}>
              <View style={styles.card}>
                {submitted ? (
                  <View style={styles.successContent}>
                    <View style={styles.successIcon}><CheckCircle2 size={43} color={COLORS.success} /></View>
                    <Text style={[styles.cardTitle, styles.centerText]}>Request Received</Text>
                    <Text style={styles.successDescription}>If an eligible KSHURAK account exists for this email, password reset instructions will be sent when email delivery is available.</Text>
                    <View style={styles.infoBox}><Mail size={19} color={COLORS.primary} /><Text style={styles.infoText}>Check your inbox and spam folder. If no email arrives, contact KSHURAK support.</Text></View>
                    <Pressable style={styles.primaryButton} onPress={onLogin} disabled={!onLogin}><Text style={styles.primaryButtonText}>BACK TO LOGIN</Text><ArrowRight size={18} color="#090909" /></Pressable>
                    <Pressable style={styles.textButton} onPress={() => { setSubmitted(false); setError(""); }}><Text style={styles.textButtonLabel}>Try another email</Text></Pressable>
                  </View>
                ) : (
                  <>
                    <View style={styles.cardHeader}>
                      <View style={styles.cardIcon}><KeyRound size={20} color={COLORS.primary} /></View>
                      <View style={styles.cardHeaderText}><Text style={styles.cardTitle}>Forgot Password?</Text><Text style={styles.cardSubtitle}>Recover your account securely</Text></View>
                    </View>
                    <View style={styles.cardSeparator} />
                    <Text style={styles.introText}>Enter your registered email address and we'll help you request a password reset.</Text>
                    <Text style={styles.label}>REGISTERED EMAIL ADDRESS</Text>
                    <View style={styles.inputContainer}>
                      <Mail size={18} color={COLORS.primary} />
                      <TextInput style={styles.input} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" placeholder="Enter your registered email" placeholderTextColor={COLORS.textMuted} value={email} onChangeText={(value) => { setEmail(value); setError(""); }} editable={!loading} returnKeyType="done" onSubmitEditing={() => { void submitRequest(); }} />
                    </View>
                    {error ? <View style={styles.errorBox}><AlertCircle size={17} color={COLORS.error} /><Text style={styles.errorText}>{error}</Text></View> : null}
                    <Pressable style={[styles.primaryButton, loading && styles.disabledButton]} disabled={loading} onPress={() => { void submitRequest(); }}>
                      {loading ? <ActivityIndicator color="#090909" /> : <><Text style={styles.primaryButtonText}>SEND RESET REQUEST</Text><ArrowRight size={18} color="#090909" /></>}
                    </Pressable>
                    <View style={styles.securityNotice}><ShieldCheck size={16} color={COLORS.primary} /><Text style={styles.securityText}>Your account security is our priority.</Text></View>
                    <View style={styles.bottomDivider} />
                    <Pressable style={styles.bottomLogin} onPress={onLogin} disabled={!onLogin}><Text style={styles.bottomLoginText}>Remember your password? <Text style={styles.goldText}>Login Now</Text></Text></Pressable>
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
  topNavigation: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  partnerBadge: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: "rgba(9,9,10,0.65)", borderWidth: 1, borderColor: "rgba(245,158,11,0.33)", borderRadius: 20 },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  partnerText: { color: "#F5E7CB", fontSize: 9, fontWeight: "800", letterSpacing: 1.05 },
  topLogin: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 20, backgroundColor: "rgba(9,9,10,0.67)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" },
  topLoginText: { color: COLORS.primary, fontSize: 12, fontWeight: "800" },
  brandSection: { alignItems: "center", marginBottom: 22 },
  logoContainer: { width: "100%", minHeight: 110, alignItems: "center", justifyContent: "center" },
  logo: { width: 208, height: 102 },
  brandDivider: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  dividerLine: { width: 42, height: 1, backgroundColor: "rgba(245,158,11,0.7)" },
  brandHeading: { color: "#FFFFFF", fontSize: 12, fontWeight: "900", letterSpacing: 0.9, textAlign: "center", textShadowColor: "rgba(0,0,0,0.9)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  brandGold: { color: COLORS.primary },
  brandSubtitle: { color: "#F1E8D9", fontSize: 11, marginTop: 7, textAlign: "center", textShadowColor: "#000000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  cardOuter: { width: "100%", maxWidth: 380, alignSelf: "center", borderRadius: 18, shadowColor: "#000000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.55, shadowRadius: 20, elevation: 12 },
  cardBorder: { padding: 1, borderRadius: 18 },
  card: { backgroundColor: "rgba(10,10,11,0.93)", borderRadius: 17, paddingHorizontal: 19, paddingTop: 21, paddingBottom: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIcon: { width: 43, height: 43, borderRadius: 12, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: "rgba(245,158,11,0.3)" },
  cardHeaderText: { flex: 1 },
  cardTitle: { color: COLORS.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.4 },
  centerText: { textAlign: "center" },
  cardSubtitle: { color: "#B5B2AD", fontSize: 11, marginTop: 5 },
  cardSeparator: { height: 1, backgroundColor: "rgba(245,158,11,0.18)", marginTop: 18, marginBottom: 18 },
  introText: { color: "#C9C4BE", fontSize: 12, lineHeight: 20, marginBottom: 21 },
  label: { color: "#E9E1D7", fontSize: 10, fontWeight: "800", letterSpacing: 0.8, marginBottom: 9 },
  inputContainer: { minHeight: 49, backgroundColor: "rgba(27,27,29,0.95)", borderWidth: 1, borderColor: "#493C2D", borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13 },
  input: { flex: 1, minWidth: 0, color: COLORS.text, fontSize: 13, paddingVertical: 10 },
  primaryButton: { minHeight: 49, marginTop: 23, backgroundColor: COLORS.primary, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 12 },
  primaryButtonText: { color: "#090909", fontSize: 12, fontWeight: "900", letterSpacing: 0.6 },
  disabledButton: { opacity: 0.6 },
  securityNotice: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16 },
  securityText: { color: "#ADA69D", fontSize: 10 },
  bottomDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.09)", marginTop: 19 },
  bottomLogin: { alignItems: "center", paddingVertical: 17 },
  bottomLoginText: { color: COLORS.textSecondary, fontSize: 12 },
  goldText: { color: COLORS.primary, fontWeight: "800" },
  errorBox: { flexDirection: "row", gap: 9, borderWidth: 1, borderColor: "rgba(239,68,68,0.4)", borderRadius: 9, padding: 11, marginTop: 15, backgroundColor: "rgba(239,68,68,0.09)" },
  errorText: { flex: 1, color: "#FFAAAA", fontSize: 11, lineHeight: 18 },
  successContent: { alignItems: "center", paddingVertical: 16 },
  successIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(34,197,94,0.11)", marginBottom: 20 },
  successDescription: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 21, textAlign: "center", marginTop: 13 },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, marginTop: 21, borderRadius: 10, borderWidth: 1, borderColor: "rgba(245,158,11,0.28)", backgroundColor: "rgba(245,158,11,0.08)" },
  infoText: { flex: 1, color: COLORS.textSecondary, fontSize: 11, lineHeight: 19 },
  textButton: { paddingVertical: 18 },
  textButtonLabel: { color: COLORS.primary, fontSize: 12, fontWeight: "800" },
  footerSection: { alignItems: "center", marginTop: 24 },
  footer: { color: "#E1D7C5", fontSize: 9, fontWeight: "700", letterSpacing: 0.3, textAlign: "center", textShadowColor: "#000000", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
  footerTagline: { color: COLORS.primary, fontSize: 9, fontWeight: "800", letterSpacing: 2, marginTop: 8 },
});
