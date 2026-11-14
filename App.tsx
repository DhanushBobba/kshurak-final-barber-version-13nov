import { useCallback, useEffect, useState } from "react";

import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  NavigationContainer,
  type LinkingOptions,
} from "@react-navigation/native";

import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from "@react-navigation/native-stack";

import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";

import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

import {
  ArrowLeft,
  ArrowRight,
  Construction,
} from "lucide-react-native";

import { COLORS } from "./src/constants/colors";

import AnimatedSplashScreen from "./src/screens/splash/AnimatedSplashScreen";

import RegisterScreen from "./src/screens/auth/RegisterScreen";
import LoginScreen from "./src/screens/auth/LoginScreen";
import ForgotPasswordScreen from "./src/screens/auth/ForgotPasswordScreen";
import ResetPasswordScreen from "./src/screens/auth/ResetPasswordScreen";
import CorrectRegistrationScreen from "./src/screens/auth/CorrectRegistrationScreen";

import DashboardScreen from "./src/screens/dashboard/DashboardScreen";
import ShopSetupScreen from "./src/screens/shop-setup/ShopSetupScreen";
import WorkersScreen from "./src/screens/workers/WorkersScreen";
import BookingsScreen from "./src/screens/bookings/BookingsScreen";
import ReschedulingScreen from "./src/screens/rescheduling/ReschedulingScreen";
import NotificationsScreen from "./src/screens/notifications/NotificationsScreen";
import CustomersScreen from "./src/screens/customers/CustomersScreen";
import ReviewsScreen from "./src/screens/reviews/ReviewsScreen";
import ServicesScreen from "./src/screens/services/ServicesScreen";

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;

  ResetPassword: {
    token: string;
  };

  CorrectRegistration: {
    token: string;
  };

  Dashboard: undefined;
  ShopSetup: undefined;
  Workers: undefined;
  Bookings: undefined;
  Rescheduling: undefined;
  Notifications: undefined;
  Customers: undefined;
  Reviews: undefined;
  Services: undefined;
  Profile: undefined;
  Settings: undefined;
};

type AppNavigation =
  NativeStackNavigationProp<RootStackParamList>;

const Stack =
  createNativeStackNavigator<RootStackParamList>();

const STORAGE_KEYS = [
  "kshurak_barber_token",
  "kshurak_barber_id",
  "kshurak_barber_username",
];

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["kshurakbarber://"],

  config: {
    screens: {
      Login: "login",
      Register: "register",
      ForgotPassword: "forgot-password",

      ResetPassword: {
        path: "reset-password",
        parse: {
          token: (value: string) => value,
        },
      },

      CorrectRegistration: {
        path: "correct-registration",
        parse: {
          token: (value: string) => value,
        },
      },

      Dashboard: "dashboard",
      ShopSetup: "shop-setup",
      Workers: "workers",
      Bookings: "bookings",
      Rescheduling: "rescheduling",
      Notifications: "notifications",
      Customers: "customers",
      Reviews: "reviews",
      Services: "services",
      Profile: "profile",
      Settings: "settings",
    },
  },
};

async function clearSession(): Promise<void> {
  await Promise.all(
    STORAGE_KEYS.map((key) =>
      SecureStore.deleteItemAsync(key)
    )
  );
}

function openModule(
  navigation: AppNavigation,
  screen: string
): void {
  switch (screen.trim()) {
    case "Dashboard":
      navigation.navigate("Dashboard");
      return;

    case "Shop Setup":
    case "ShopSetup":
    case "Documents":
      navigation.navigate("ShopSetup");
      return;

    case "Worker":
    case "Workers":
    case "Slots":
      navigation.navigate("Workers");
      return;

    case "Booking":
    case "Bookings":
      navigation.navigate("Bookings");
      return;

    case "Reschedule":
    case "Rescheduling":
      navigation.navigate("Rescheduling");
      return;

    case "Notification":
    case "Notifications":
      navigation.navigate("Notifications");
      return;

    case "Customer":
    case "Customers":
      navigation.navigate("Customers");
      return;

    case "Review":
    case "Reviews":
      navigation.navigate("Reviews");
      return;

    case "Service":
    case "Services":
      navigation.navigate("Services");
      return;

    case "Profile":
      navigation.navigate("Profile");
      return;

    case "Settings":
      navigation.navigate("Settings");
      return;

    default:
      Alert.alert(
        "Module unavailable",
        "This module has not been connected yet."
      );
  }
}

function LoadingScreen() {
  return (
    <View style={styles.loadingScreen}>
      <ActivityIndicator
        size="large"
        color={COLORS.primary}
      />

      <Text style={styles.loadingText}>
        Loading KSHURAK...
      </Text>
    </View>
  );
}

function ModulePlaceholder({
  title,
  description,
  onBack,
}: {
  title: string;
  description: string;
  onBack: () => void;
}) {
  return (
    <SafeAreaView
      style={styles.moduleScreen}
      edges={["top", "bottom", "left", "right"]}
    >
      <View style={styles.moduleHeader}>
        <Pressable
          style={styles.headerBack}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to dashboard"
        >
          <ArrowLeft size={21} color={COLORS.text} />
        </Pressable>

        <Text style={styles.headerTitle}>{title}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.moduleContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.moduleIconBox}>
          <Construction
            size={34}
            color={COLORS.primary}
          />
        </View>

        <Text style={styles.moduleEyebrow}>
          KSHURAK BARBER
        </Text>

        <Text style={styles.moduleTitle}>{title}</Text>

        <Text style={styles.moduleDescription}>
          {description}
        </Text>

        <View style={styles.moduleInfo}>
          <Text style={styles.moduleInfoText}>
            This screen is ready for navigation. Its functional
            implementation is the next development step.
          </Text>
        </View>

        <Pressable
          style={styles.returnButton}
          onPress={onBack}
          accessibilityRole="button"
        >
          <Text style={styles.returnButtonText}>
            Back to Dashboard
          </Text>

          <ArrowRight size={18} color={COLORS.black} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  const [splashFinished, setSplashFinished] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      try {
        const [token, barberId] = await Promise.all([
          SecureStore.getItemAsync("kshurak_barber_token"),
          SecureStore.getItemAsync("kshurak_barber_id"),
        ]);

        if ((!token || !barberId) && (token || barberId)) {
          await clearSession();
        }

        if (active) {
          setSignedIn(Boolean(token && barberId));
        }
      } catch {
        if (active) setSignedIn(false);
      } finally {
        if (active) setCheckingSession(false);
      }
    }

    void restoreSession();

    return () => {
      active = false;
    };
  }, []);

  const handleSplashFinish = useCallback(() => {
    setSplashFinished(true);
  }, []);

  const handleLoginSuccess = useCallback(async () => {
    try {
      const [token, barberId] = await Promise.all([
        SecureStore.getItemAsync("kshurak_barber_token"),
        SecureStore.getItemAsync("kshurak_barber_id"),
      ]);

      if (token && barberId) {
        setSignedIn(true);
        return;
      }

      await clearSession();
      setSignedIn(false);

      Alert.alert(
        "Login incomplete",
        "Please log in again."
      );
    } catch {
      setSignedIn(false);

      Alert.alert(
        "Session unavailable",
        "Unable to read your secure login session."
      );
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await clearSession();
      setSignedIn(false);
    } catch {
      Alert.alert(
        "Unable to log out",
        "Please try again."
      );
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />

      {!splashFinished ? (
        <AnimatedSplashScreen
          onFinish={handleSplashFinish}
        />
      ) : checkingSession ? (
        <LoadingScreen />
      ) : (
        <NavigationContainer
          linking={linking}
          fallback={<LoadingScreen />}
        >
          <Stack.Navigator
            initialRouteName={signedIn ? "Dashboard" : "Login"}
            screenOptions={{
              headerShown: false,
              animation: "fade",
              contentStyle: {
                backgroundColor: COLORS.background,
              },
            }}
          >
            {signedIn ? (
              <Stack.Group navigationKey="authenticated">
                <Stack.Screen name="Dashboard">
                  {({ navigation }) => (
                    <DashboardScreen
                      onLogout={() => {
                        void handleLogout();
                      }}
                      onNavigate={(screen) =>
                        openModule(navigation, screen)
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="ShopSetup">
                  {({ navigation }) => (
                    <ShopSetupScreen
                      onBack={() =>
                        navigation.navigate("Dashboard")
                      }
                      onWorkers={() =>
                        navigation.navigate("Workers")
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="Workers">
                  {({ navigation }) => (
                    <WorkersScreen
                      onBack={() =>
                        navigation.navigate("Dashboard")
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="Bookings">
                  {({ navigation }) => (
                    <BookingsScreen
                      onBack={() =>
                        navigation.navigate("Dashboard")
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="Rescheduling">
                  {({ navigation }) => (
                    <ReschedulingScreen
                      onBack={() =>
                        navigation.navigate("Dashboard")
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="Notifications">
                  {({ navigation }) => (
                    <NotificationsScreen
                      onBack={() =>
                        navigation.navigate("Dashboard")
                      }
                      onNavigate={(screen) =>
                        openModule(navigation, screen)
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="Customers">
                  {({ navigation }) => (
                    <CustomersScreen
                      onBack={() =>
                        navigation.navigate("Dashboard")
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="Reviews">
                  {({ navigation }) => (
                    <ReviewsScreen
                      onBack={() =>
                        navigation.navigate("Dashboard")
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="Services">
                  {({ navigation }) => (
                    <ServicesScreen
                      onBack={() =>
                        navigation.navigate("Dashboard")
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="Profile">
                  {({ navigation }) => (
                    <ModulePlaceholder
                      title="Barber Profile"
                      description="Review your barber profile, shop details and account information."
                      onBack={() =>
                        navigation.navigate("Dashboard")
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="Settings">
                  {({ navigation }) => (
                    <ModulePlaceholder
                      title="Settings"
                      description="Manage your barber account preferences and application settings."
                      onBack={() =>
                        navigation.navigate("Dashboard")
                      }
                    />
                  )}
                </Stack.Screen>
              </Stack.Group>
            ) : (
              <Stack.Group navigationKey="unauthenticated">
                <Stack.Screen name="Login">
                  {({ navigation }) => (
                    <LoginScreen
                      onRegister={() =>
                        navigation.navigate("Register")
                      }
                      onForgotPassword={() =>
                        navigation.navigate("ForgotPassword")
                      }
                      onDashboard={() => {
                        void handleLoginSuccess();
                      }}
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="Register">
                  {({ navigation }) => (
                    <RegisterScreen
                      onLogin={() =>
                        navigation.navigate("Login")
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="ForgotPassword">
                  {({ navigation }) => (
                    <ForgotPasswordScreen
                      onLogin={() =>
                        navigation.navigate("Login")
                      }
                    />
                  )}
                </Stack.Screen>

                <Stack.Screen name="ResetPassword">
                  {({ navigation, route }) => (
                    <ResetPasswordScreen
                      token={route.params?.token || ""}
                      onLogin={() =>
                        navigation.navigate("Login")
                      }
                    />
                  )}
                </Stack.Screen>
              </Stack.Group>
            )}

            {/*
              Public in both authentication states.
              Correction access never sets signedIn.
            */}
            <Stack.Screen
              name="CorrectRegistration"
              navigationKey={
                signedIn
                  ? "correction-authenticated"
                  : "correction-unauthenticated"
              }
            >
              {({ navigation, route }) => (
                <CorrectRegistrationScreen
                  token={route.params?.token || ""}
                  onBack={() => {
                    navigation.reset({
                      index: 0,
                      routes: [
                        {
                          name: signedIn
                            ? "Dashboard"
                            : "Login",
                        },
                      ],
                    });
                  }}
                />
              )}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: COLORS.background,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  moduleScreen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  moduleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 18,
    paddingVertical: 15,
    backgroundColor: COLORS.surfaceDark,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerBack: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "800",
  },
  moduleContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  moduleIconBox: {
    width: 78,
    height: 78,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
    marginBottom: 20,
  },
  moduleEyebrow: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  moduleTitle: {
    color: COLORS.text,
    fontSize: 23,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 11,
  },
  moduleDescription: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 340,
    marginBottom: 18,
  },
  moduleInfo: {
    width: "100%",
    maxWidth: 350,
    padding: 15,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    marginBottom: 25,
  },
  moduleInfoText: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center",
  },
  returnButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    minHeight: 46,
    borderRadius: 10,
    paddingHorizontal: 20,
    backgroundColor: COLORS.primary,
  },
  returnButtonText: {
    color: COLORS.black,
    fontSize: 13,
    fontWeight: "800",
  },
});