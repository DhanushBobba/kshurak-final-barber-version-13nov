
/**
 * KSHURAK Barber Mobile
 * Shared application color palette.
 *
 * Matches the existing KSHURAK Barber Web theme.
 */

export const COLORS = {
  primary: "#F59E0B",

  black: "#000000",

  background: "#070708",

  surface: "#17181A",

  surfaceDark: "#0D0D0E",

  surfaceLight: "#202124",

  thumbnail: "#222326",

  text: "#FFFFFF",

  textSecondary: "#9E9EA7",

  textMuted: "#71717A",

  border: "#27282C",

  borderDark: "#1F2023",

  borderLight: "#3E3F45",

  overlay: "rgba(18,18,20,0.75)",

  glass: "rgba(23,24,26,0.85)",

  glassBorder: "rgba(255,255,255,0.12)",

  heroFade: "rgba(23,24,26,0.4)",

  success: "#22C55E",

  error: "#EF4444",

  warning: "#F59E0B",
} as const;

export const RADIUS = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const FONT_SIZES = {
  caption: 11,
  small: 12,
  body: 14,
  medium: 16,
  large: 18,
  subtitle: 22,
  title: 28,
  heading: 34,
} as const;
