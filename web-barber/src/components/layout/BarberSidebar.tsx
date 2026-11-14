
import {
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Scissors,
  Star,
  Store,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { useLocation, useNavigate } from "react-router-dom";

type BarberSidebarProps = {
  open: boolean;
  onClose: () => void;
  unreadCount: number;
};

const navigationItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Shop Setup", path: "/shop-setup", icon: Store },
  { label: "Workers", path: "/workers", icon: Users },
  { label: "Bookings", path: "/bookings", icon: CalendarDays },
  { label: "Rescheduling", path: "/rescheduling", icon: CalendarClock },
  { label: "Notifications", path: "/notifications", icon: Bell },
  { label: "Customers", path: "/customers", icon: UserRound },
  { label: "Reviews", path: "/reviews", icon: Star },
  { label: "Services", path: "/services", icon: Scissors },
] as const;

export default function BarberSidebar({
  open,
  onClose,
  unreadCount,
}: BarberSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const navigateTo = (path: string) => {
    onClose();
    navigate(path);
  };

  const logout = () => {
    [
      "kshurak_barber_token",
      "kshurak_barber_id",
      "kshurak_barber_username",
      "barber_access_token",
      "barber_id",
      "barber_username",
    ].forEach((key) => sessionStorage.removeItem(key));

    onClose();
    navigate("/login", { replace: true });
  };

  return (
    <>
      {open && (
        <button
          type="button"
          className="kb-sidebar-backdrop"
          aria-label="Close navigation"
          onClick={onClose}
        />
      )}

      <aside
        className={`kb-sidebar ${open ? "kb-sidebar-open" : ""}`}
        aria-label="Barber navigation"
      >
        <div className="kb-sidebar-brand">
          <img src="/assets/logo.png" alt="KSHURAK" />

          <button
            type="button"
            className="kb-sidebar-close"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X size={19} />
          </button>
        </div>

        <div className="kb-menu-caption">MAIN MENU</div>

        <nav className="kb-sidebar-nav">
          {navigationItems.map((item) => {
            const Icon = item.icon;

            const active =
              location.pathname === item.path ||
              location.pathname.startsWith(`${item.path}/`);

            return (
              <button
                key={item.label}
                type="button"
                className={`kb-nav-link ${active ? "active" : ""}`}
                onClick={() => navigateTo(item.path)}
                title={item.label}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={17} strokeWidth={1.9} />

                <span className="kb-nav-text">
                  {item.label}
                </span>

                {item.label === "Notifications" &&
                  unreadCount > 0 && (
                    <span className="kb-nav-badge">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}

                {active && <ChevronRight size={14} />}
              </button>
            );
          })}
        </nav>

        <div className="kb-sidebar-bottom">
          <button
            type="button"
            className="kb-nav-link kb-logout"
            onClick={logout}
          >
            <LogOut size={17} />
            <span className="kb-nav-text">Logout</span>
          </button>

          <div className="kb-sidebar-copyright">
            © 2026 KSHURAK
          </div>
        </div>
      </aside>
    </>
  );
}
