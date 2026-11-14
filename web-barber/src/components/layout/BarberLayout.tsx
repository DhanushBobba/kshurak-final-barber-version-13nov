
import { useCallback, useEffect, useState } from "react";

import {
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  Bell,
  ChevronRight,
  Menu,
} from "lucide-react";

import BarberSidebar from "./BarberSidebar";

import {
  getUnreadNotificationCount,
} from "../../services/notificationsApi";

import "../../styles/barber-layout.css";

const pageNames: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/shop-setup": "Shop Setup",
  "/workers": "Workers",
  "/bookings": "Bookings",
  "/rescheduling": "Rescheduling",
  "/notifications": "Notifications",
  "/customers": "Customers",
  "/reviews": "Reviews",
  "/services": "Services",
};

export default function BarberLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const username =
    sessionStorage.getItem("kshurak_barber_username") ||
    sessionStorage.getItem("barber_username") ||
    "Barber";

  const currentPage =
    pageNames[location.pathname] || "Barber Management";

  const refreshNotifications = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await getUnreadNotificationCount(signal);

        if (!signal?.aborted) {
          setUnreadCount(response.unread_count);
        }
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.name === "AbortError"
        ) {
          return;
        }

        // Notification failures must not block other pages.
        // An unknown count is not displayed as a new alert.
      }
    },
    []
  );

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const controller = new AbortController();

    void refreshNotifications(controller.signal);

    const interval = window.setInterval(() => {
      void refreshNotifications(controller.signal);
    }, 60000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    const controller = new AbortController();

    // Refresh the notification badge after route changes.
    void refreshNotifications(controller.signal);

    return () => controller.abort();
  }, [location.pathname, refreshNotifications]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div className="kb-layout">
      <BarberSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        unreadCount={unreadCount}
      />

      <div className="kb-main">
        <header className="kb-topbar">
          <div className="kb-topbar-left">
            <button
              type="button"
              className="kb-mobile-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>

            <div className="kb-breadcrumb">
              <span>Pages</span>
              <ChevronRight size={13} />
              <strong>{currentPage}</strong>
            </div>
          </div>

          <div className="kb-topbar-right">
            <time className="kb-current-date">
              {new Date().toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </time>

            <button
              type="button"
              className="kb-notification-button"
              onClick={() => navigate("/notifications")}
              aria-label={`Notifications, ${unreadCount} unread`}
              title="Notifications"
            >
              <Bell size={19} />

              {unreadCount > 0 && (
                <span className="kb-notification-count">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            <div
              className="kb-user-avatar"
              title={username}
            >
              {username.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        <main className="kb-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
