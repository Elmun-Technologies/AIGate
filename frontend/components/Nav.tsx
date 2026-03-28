"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { apiRequestWithRetry } from "@/lib/api";
import { useNotifications } from "@/lib/useNotifications";
import { InAppNotification } from "@/lib/notificationService";
import { startComplianceMonitor, stopComplianceMonitor } from "@/src/services/complianceMonitor";
import { useAuth } from "@/src/contexts/AuthContext";
import { getRoleLabel } from "@/src/config/roles";

type ShellLink = {
  href: string;
  label: string;
  icon: string;
  group: "main" | "management" | "ops";
};

const links: ShellLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: "◧", group: "main" },
  { href: "/executive", label: "Governance", icon: "◉", group: "main" },
  { href: "/compliance", label: "Compliance", icon: "☑", group: "main" },
  { href: "/agents", label: "Agents", icon: "⚙", group: "main" },
  { href: "/policies", label: "Policies", icon: "⛨", group: "main" },
  { href: "/approvals", label: "Approvals", icon: "✓", group: "main" },
  { href: "/evidence", label: "Evidence Locker", icon: "▣", group: "management" },
  { href: "/incidents", label: "Incidents", icon: "⚠", group: "management" },
  { href: "/integrations", label: "Integrations", icon: "⎋", group: "management" },
  { href: "/audit", label: "Audit Logs", icon: "▦", group: "management" },
  { href: "/spend", label: "Spend Analytics", icon: "$", group: "management" },
  { href: "/quickstart", label: "Quickstart", icon: "➤", group: "ops" },
  { href: "/simulators", label: "Simulator", icon: "⌁", group: "ops" },
  { href: "/team", label: "Team", icon: "👥", group: "ops" },
  { href: "/settings", label: "Settings", icon: "⚙", group: "ops" },
];

const routeTitle: Record<string, string> = Object.fromEntries(links.map((item) => [item.href, item.label]));
const topActions: Record<string, { label: string; href: string }> = {
  "/dashboard": { label: "Export Report", href: "/audit" },
  "/executive": { label: "Export Report", href: "/audit" },
  "/compliance": { label: "Export Audit Package", href: "/compliance" },
  "/agents": { label: "Register New Agent", href: "/agents" },
  "/policies": { label: "Create New Policy", href: "/policies" },
  "/approvals": { label: "Batch Actions", href: "/approvals" },
  "/evidence": { label: "Export Package", href: "/audit" },
  "/incidents": { label: "Incident Board", href: "/incidents" },
  "/integrations": { label: "Add Integration", href: "/integrations" },
  "/audit": { label: "Export CSV", href: "/audit" },
  "/spend": { label: "Export Report", href: "/spend" },
  "/quickstart": { label: "Support Portal", href: "/quickstart" },
  "/simulators": { label: "Deploy Policy", href: "/policies" },
  "/settings": { label: "Save Settings", href: "/settings" },
};

export default function Nav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [userEmail, setUserEmail] = useState("admin@example.com");
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLDivElement | null>(null);
  const { notifications, unreadCount, dismissOne, dismissAll } = useNotifications();
  const { user: authUser, impersonating, stopImpersonation } = useAuth();

  useEffect(() => {
    const root = document.documentElement;
    const stored = localStorage.getItem("agentgate-theme-v2");
    const theme = stored === "light" || stored === "dark" ? stored : "dark";
    root.setAttribute("data-theme", theme);
    if (!stored) localStorage.setItem("agentgate-theme-v2", theme);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    setAuthed(Boolean(token));
    const rawUser = localStorage.getItem("user");
    if (rawUser) {
      try {
        const parsed = JSON.parse(rawUser) as { email?: string };
        setUserEmail(parsed.email || "admin@example.com");
      } catch {
        setUserEmail("admin@example.com");
      }
    }
  }, [pathname]);

  useEffect(() => {
    if (!authed || pathname === "/login") return;

    startComplianceMonitor();

    const loadShellData = async () => {
      try {
        const [approvals] = await Promise.all([
          apiRequestWithRetry("/approvals?status=pending"),
          apiRequestWithRetry("/tool-calls"),
        ]);
        const safeApprovals = Array.isArray(approvals) ? approvals : [];
        setPendingApprovalsCount(safeApprovals.length);
      } catch {
        setPendingApprovalsCount(0);
      }
    };
    loadShellData();
    const onRefresh = () => loadShellData();
    window.addEventListener("gateway:refresh", onRefresh);
    return () => {
      window.removeEventListener("gateway:refresh", onRefresh);
      stopComplianceMonitor();
    };
  }, [authed, pathname]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!bellRef.current) return;
      if (!bellRef.current.contains(event.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  if (pathname === "/login" || !authed) {
    return <>{children}</>;
  }

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/login?logout=1");
  };

  const initials = userEmail.slice(0, 2).toUpperCase();
  const currentPath = pathname ?? "/dashboard";
  const title = routeTitle[currentPath] || "Dashboard";
  const topAction = topActions[currentPath] || { label: "Export Report", href: "/audit" };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenuOpen ? "open" : ""}`}>
        <div className="logo">
          <div className="logo-icon">🛡</div>
          <div>
            <p className="logo-text">AI Governance</p>
            <span className="logo-badge">ENTERPRISE SECURITY</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <p className="nav-section">Main Menu</p>
          {links
            .filter((item) => item.group === "main")
            .map((item) => {
              const active = pathname === item.href;
              const showApprovalBadge = item.href === "/approvals" && pendingApprovalsCount > 0;
              return (
                <Link key={item.href} href={item.href} className={`nav-item ${active ? "active" : ""}`} onClick={() => setMobileMenuOpen(false)}>
                  <span className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  {showApprovalBadge ? <span className="nav-badge">{pendingApprovalsCount}</span> : null}
                </Link>
              );
            })}
          <p className="nav-section">Management</p>
          {links
            .filter((item) => item.group === "management")
            .map((item) => (
              <Link key={item.href} href={item.href} className={`nav-item ${pathname === item.href ? "active" : ""}`} onClick={() => setMobileMenuOpen(false)}>
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
          <p className="nav-section">Operations</p>
          {links
            .filter((item) => item.group === "ops")
            .map((item) => (
              <Link key={item.href} href={item.href} className={`nav-item ${pathname === item.href ? "active" : ""}`} onClick={() => setMobileMenuOpen(false)}>
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-menu-wrap" ref={userMenuRef}>
            <button type="button" className="user-chip user-chip-button" onClick={() => setUserMenuOpen((prev) => !prev)}>
              <div className="avatar">{initials}</div>
              <div className="user-info">
                <p className="user-name">{userEmail}</p>
                <p className="user-role">{authUser ? getRoleLabel(authUser.role) : "Security Admin"}</p>
              </div>
            </button>
            <div className={`user-menu-popover ${userMenuOpen ? "open" : ""}`}>
              <button className="user-menu-item" onClick={() => router.push("/settings")}>⚙️ Settings</button>
              <div className="user-menu-divider" />
              <button className="user-menu-item user-menu-danger" onClick={logout}>🚪 Sign out</button>
            </div>
          </div>
        </div>
      </aside>

      <button className={`sidebar-backdrop ${mobileMenuOpen ? "open" : ""}`} onClick={() => setMobileMenuOpen(false)} aria-label="Close sidebar" />

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen((prev) => !prev)} aria-label="Open menu">
              ☰
            </button>
            <div className="breadcrumb">
              <span>Governance</span>
              <span className="crumb-separator">/</span>
              <strong>{title}</strong>
            </div>
            <div className="topbar-search">
              <span className="topbar-search-icon">⌕</span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && searchQuery.trim()) {
                    router.push(`/audit?agent_id=${encodeURIComponent(searchQuery.trim())}`);
                  }
                }}
                placeholder="Search infrastructure, models, or alerts..."
              />
            </div>
          </div>
          <div className="topbar-right">
            {/* ── Notification bell ── */}
            <div ref={bellRef} style={{ position: "relative" }}>
              <button
                className="icon-btn"
                aria-label="Notifications"
                onClick={() => setBellOpen((prev) => !prev)}
                style={{ position: "relative" }}
              >
                🔔
                {unreadCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      minWidth: 16,
                      height: 16,
                      borderRadius: "9999px",
                      background: "#ef4444",
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                      padding: "0 3px",
                      pointerEvents: "none",
                    }}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 8px)",
                    width: 340,
                    maxHeight: 440,
                    borderRadius: 10,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
                    zIndex: 1000,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  {/* Header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13 }}>
                      Notifications
                      {unreadCount > 0 && (
                        <span
                          style={{
                            marginLeft: 8,
                            background: "#ef4444",
                            color: "#fff",
                            borderRadius: 9999,
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "1px 6px",
                          }}
                        >
                          {unreadCount} new
                        </span>
                      )}
                    </span>
                    {unreadCount > 0 && (
                      <button
                        onClick={dismissAll}
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  {/* List */}
                  <div style={{ overflowY: "auto", flex: 1 }}>
                    {notifications.length === 0 ? (
                      <div
                        style={{
                          padding: "32px 16px",
                          textAlign: "center",
                          color: "var(--text-muted)",
                          fontSize: 13,
                        }}
                      >
                        No notifications yet
                      </div>
                    ) : (
                      notifications.slice(0, 20).map((n: InAppNotification) => (
                        <div
                          key={n.id}
                          style={{
                            display: "flex",
                            gap: 10,
                            padding: "10px 14px",
                            borderBottom: "1px solid var(--border)",
                            background: n.read ? "transparent" : "rgba(239,68,68,0.06)",
                            cursor: "pointer",
                            transition: "background 0.15s",
                          }}
                          onClick={() => {
                            dismissOne(n.id);
                            setBellOpen(false);
                          }}
                        >
                          <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                            {n.kind === "sla_breach" ? "🚨" : "⚠️"}
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontWeight: n.read ? 400 : 700,
                                fontSize: 12,
                                marginBottom: 2,
                                color: n.read ? "var(--text-muted)" : "var(--text)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {n.title}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>
                              {n.body}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                              {new Date(n.created_at).toLocaleString()}
                            </div>
                          </div>
                          {!n.read && (
                            <span
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                background: "#ef4444",
                                flexShrink: 0,
                                marginTop: 5,
                              }}
                            />
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Footer */}
                  <div
                    style={{
                      padding: "8px 14px",
                      borderTop: "1px solid var(--border)",
                      textAlign: "center",
                    }}
                  >
                    <Link
                      href="/approvals"
                      style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}
                      onClick={() => setBellOpen(false)}
                    >
                      View Approvals Queue →
                    </Link>
                  </div>
                </div>
              )}
            </div>

            <button className="icon-btn" aria-label="Help">?</button>
            <Link className="btn-primary" href={topAction.href}>
              {topAction.label}
            </Link>
          </div>
        </header>
        <div className="page-wrap">
          {impersonating && (
            <div
              style={{
                background: "linear-gradient(90deg, #f59e0b, #ef4444)",
                color: "#fff",
                padding: "8px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontWeight: 700,
                fontSize: 12,
                borderRadius: 0,
              }}
            >
              <span>👁 Viewing as <strong>{impersonating.email}</strong> ({getRoleLabel(impersonating.role)})</span>
              <button
                onClick={stopImpersonation}
                style={{ background: "#fff", color: "#ef4444", border: "none", borderRadius: 4, padding: "4px 10px", fontWeight: 700, fontSize: 11, cursor: "pointer" }}
              >
                Exit Impersonation
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
