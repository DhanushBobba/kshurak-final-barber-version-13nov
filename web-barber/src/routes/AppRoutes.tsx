import { useCallback, useState } from "react";

import {
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import type { ReactNode } from "react";

import RegistrationPage from "../app/onboarding/RegistrationPage";
import CorrectRegistrationPage from "../app/onboarding/CorrectRegistrationPage";

import LoginPage from "../app/auth/LoginPage";
import ForgotPasswordPage from "../app/auth/ForgotPasswordPage";
import ActivateAccountPage from "../app/auth/ActivateAccountPage";

import DashboardPage from "../app/dashboard/DashboardPage";
import ShopSetupPage from "../app/shop-setup/ShopSetupPage";
import WorkersPage from "../app/workers/WorkersPage";
import BookingsPage from "../app/bookings/BookingsPage";
import ReschedulingPage from "../app/rescheduling/ReschedulingPage";
import NotificationsPage from "../app/notifications/NotificationsPage";
import CustomersPage from "../app/customers/CustomersPage";
import ServicesPage from "../app/services/ServicesPage";
import ReviewsPage from "../app/reviews/ReviewsPage";

import BarberLayout from "../components/layout/BarberLayout";
import AnimatedSplashScreen from "../components/splash/AnimatedSplashScreen";


function getBarberSession(): boolean {
  const accessToken =
    sessionStorage.getItem("kshurak_barber_token") ||
    sessionStorage.getItem("barber_access_token");

  const barberId =
    sessionStorage.getItem("kshurak_barber_id") ||
    sessionStorage.getItem("barber_id");

  if (!accessToken || !barberId) {
    return false;
  }

  try {
    const parts = accessToken.split(".");

    if (parts.length !== 3) {
      return false;
    }

    const base64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const padded = base64.padEnd(
      Math.ceil(base64.length / 4) * 4,
      "="
    );

    const payload = JSON.parse(atob(padded));

    if (
      payload.type !== "barber_access" ||
      payload.sub !== barberId ||
      typeof payload.exp !== "number"
    ) {
      return false;
    }

    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}


function ProtectedBarberRoute({
  children,
}: {
  children: ReactNode;
}) {
  if (!getBarberSession()) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}


function HomeRedirect() {
  return (
    <Navigate
      to={
        getBarberSession()
          ? "/dashboard"
          : "/login"
      }
      replace
    />
  );
}


export default function AppRoutes() {
  const [showSplash, setShowSplash] = useState(true);

  const handleSplashFinish = useCallback(() => {
    setShowSplash(false);
  }, []);

  if (showSplash) {
    return (
      <AnimatedSplashScreen
        onFinish={handleSplashFinish}
      />
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={<HomeRedirect />}
      />

      {/* Public registration and authentication */}

      <Route
        path="/register"
        element={<RegistrationPage />}
      />

      <Route
        path="/login"
        element={<LoginPage />}
      />

      <Route
        path="/forgot-password"
        element={<ForgotPasswordPage />}
      />

      <Route
        path="/activate"
        element={<ActivateAccountPage />}
      />

      {/*
        Public correction page.

        The backend validates the email token.
        This route does not require or create
        a dashboard session.
      */}

      <Route
        path="/correct-registration"
        element={<CorrectRegistrationPage />}
      />

      {/* Protected dashboard */}

      <Route
        path="/dashboard"
        element={
          <ProtectedBarberRoute>
            <DashboardPage />
          </ProtectedBarberRoute>
        }
      />

      {/* Protected shop management */}

      <Route
        element={
          <ProtectedBarberRoute>
            <BarberLayout />
          </ProtectedBarberRoute>
        }
      >
        <Route
          path="/shop-setup"
          element={<ShopSetupPage />}
        />

        <Route
          path="/workers"
          element={<WorkersPage />}
        />

        <Route
          path="/bookings"
          element={<BookingsPage />}
        />

        <Route
          path="/rescheduling"
          element={<ReschedulingPage />}
        />

        <Route
          path="/customers"
          element={<CustomersPage />}
        />

        <Route
          path="/notifications"
          element={<NotificationsPage />}
        />

        <Route
          path="/services"
          element={<ServicesPage />}
        />

        <Route
          path="/reviews"
          element={<ReviewsPage />}
        />
      </Route>

      <Route
        path="*"
        element={<HomeRedirect />}
      />
    </Routes>
  );
}