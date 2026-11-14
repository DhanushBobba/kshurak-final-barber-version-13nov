
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const STORAGE_KEYS = {
  TOKEN: "kshurak_barber_token",
  BARBER_ID: "kshurak_barber_id",
  USERNAME: "kshurak_barber_username",
  IDENTIFIER: "kshurak_barber_identifier",
  EXPIRES_AT: "kshurak_barber_expires_at",
  REFRESH_TOKEN: "kshurak_barber_refresh_token",
} as const;

export type BarberSession = {
  token: string;
  barberId: string;
  username: string;
  expiresAt?: number | null;
  refreshToken?: string | null;
};

export type BarberSessionStatus =
  | "missing"
  | "valid"
  | "expired"
  | "unknown";

const REFRESH_BUFFER_MS = 60_000;

export async function saveBarberSession(
  session: BarberSession
): Promise<void> {
  const token = session.token.trim();
  const barberId = session.barberId.trim();
  const username = session.username.trim() || "Barber";

  if (!token || !barberId) {
    throw new Error(
      "Cannot save an incomplete barber session."
    );
  }

  await SecureStore.setItemAsync(
    STORAGE_KEYS.TOKEN,
    token
  );

  await SecureStore.setItemAsync(
    STORAGE_KEYS.BARBER_ID,
    barberId
  );

  await SecureStore.setItemAsync(
    STORAGE_KEYS.USERNAME,
    username
  );

  if (
    typeof session.expiresAt === "number" &&
    Number.isFinite(session.expiresAt) &&
    session.expiresAt > 0
  ) {
    await SecureStore.setItemAsync(
      STORAGE_KEYS.EXPIRES_AT,
      String(session.expiresAt)
    );
  } else {
    await SecureStore.deleteItemAsync(
      STORAGE_KEYS.EXPIRES_AT
    );
  }

  if (session.refreshToken?.trim()) {
    await SecureStore.setItemAsync(
      STORAGE_KEYS.REFRESH_TOKEN,
      session.refreshToken.trim()
    );
  } else {
    await SecureStore.deleteItemAsync(
      STORAGE_KEYS.REFRESH_TOKEN
    );
  }
}

export async function getBarberSession():
  Promise<BarberSession | null> {
  const [
    token,
    barberId,
    username,
    expiresAtText,
    refreshToken,
  ] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_KEYS.TOKEN),
    SecureStore.getItemAsync(STORAGE_KEYS.BARBER_ID),
    SecureStore.getItemAsync(STORAGE_KEYS.USERNAME),
    SecureStore.getItemAsync(STORAGE_KEYS.EXPIRES_AT),
    SecureStore.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
  ]);

  if (!token?.trim() || !barberId?.trim()) {
    return null;
  }

  const parsedExpiry = expiresAtText
    ? Number(expiresAtText)
    : NaN;

  return {
    token: token.trim(),
    barberId: barberId.trim(),
    username: username?.trim() || "Barber",
    expiresAt: Number.isFinite(parsedExpiry)
      ? parsedExpiry
      : null,
    refreshToken: refreshToken || null,
  };
}

export async function getBarberToken():
  Promise<string | null> {
  const session = await getBarberSession();
  return session?.token || null;
}

export async function getBarberSessionStatus():
  Promise<BarberSessionStatus> {
  const session = await getBarberSession();

  if (!session) {
    return "missing";
  }

  if (!session.expiresAt) {
    return "unknown";
  }

  if (
    Date.now() + REFRESH_BUFFER_MS >=
    session.expiresAt
  ) {
    return "expired";
  }

  return "valid";
}

export function calculateTokenExpiry(
  expiresInSeconds: number
): number | null {
  if (
    !Number.isFinite(expiresInSeconds) ||
    expiresInSeconds <= 0
  ) {
    return null;
  }

  return Date.now() +
    Math.floor(expiresInSeconds * 1000);
}

export async function clearBarberSession():
  Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(STORAGE_KEYS.TOKEN),
    SecureStore.deleteItemAsync(STORAGE_KEYS.BARBER_ID),
    SecureStore.deleteItemAsync(STORAGE_KEYS.USERNAME),
    SecureStore.deleteItemAsync(STORAGE_KEYS.EXPIRES_AT),
    SecureStore.deleteItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
  ]);
}

export async function saveRememberedIdentifier(
  identifier: string
): Promise<void> {
  await AsyncStorage.setItem(
    STORAGE_KEYS.IDENTIFIER,
    identifier.trim()
  );
}

export async function getRememberedIdentifier():
  Promise<string | null> {
  return AsyncStorage.getItem(
    STORAGE_KEYS.IDENTIFIER
  );
}

export async function clearRememberedIdentifier():
  Promise<void> {
  await AsyncStorage.removeItem(
    STORAGE_KEYS.IDENTIFIER
  );
}
