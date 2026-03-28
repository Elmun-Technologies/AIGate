"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { apiRequest } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const stored = localStorage.getItem("agentgate-theme-v2");
    const nextTheme = stored === "light" || stored === "dark" ? stored : "dark";
    root.setAttribute("data-theme", nextTheme);
    // Only clear tokens if explicitly logging out (via ?logout param)
    if (searchParams?.get("logout") === "1") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    }
  }, [searchParams]);

  const DEMO_USERS: Record<string, { password: string; user: { email: string; name: string; role: string } }> = {
    "admin@example.com": { password: "admin123", user: { email: "admin@example.com", name: "Security Admin", role: "SECURITY_ADMIN" } },
    "approver@company.com": { password: "approver123", user: { email: "approver@company.com", name: "Sarah Chen", role: "SECURITY_APPROVER" } },
    "dev@company.com": { password: "dev123", user: { email: "dev@company.com", name: "Marcus Rivera", role: "DEVELOPER" } },
    "compliance@company.com": { password: "compliance123", user: { email: "compliance@company.com", name: "Elena Vasquez", role: "COMPLIANCE_OFFICER" } },
    "viewer@company.com": { password: "viewer123", user: { email: "viewer@company.com", name: "James Park", role: "VIEWER" } },
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        },
        false,
      );
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("user", JSON.stringify(data.user));
      router.push("/dashboard");
    } catch {
      // Fallback: demo login when backend is unreachable
      const demo = DEMO_USERS[email.toLowerCase().trim()];
      if (demo && password === demo.password) {
        localStorage.setItem("token", "demo_token_" + Date.now());
        localStorage.setItem("user", JSON.stringify(demo.user));
        router.push("/dashboard");
        return;
      }
      setError(
        demo
          ? "Noto'g'ri parol. Demo parol: " + demo.password
          : "Email yoki parol noto'g'ri. Demo: admin@example.com / admin123"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <div className="login-grid" aria-hidden />
      <div className="login-card w-full">
        <div className="login-brand">
          <div className="login-logo-icon">AG</div>
          <div>
            <p className="login-logo-text">AI Governance</p>
            <span className="login-logo-badge">CONTROL PLANE</span>
          </div>
        </div>
        <div className="login-divider" />
        <p className="login-subtitle mono">AI Agent Runtime Enforcement</p>

        <form className="login-form" onSubmit={onSubmit}>
          <label className="login-field">
            <span>Email</span>
            <input className="input login-input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </label>
          <label className="login-field">
            <span>Password</span>
            <input className="input login-input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
          </label>
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          <button className="btn-primary w-full login-submit" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="login-protected text-xs mono">
          <span className="shield-icon" aria-hidden>🔒</span>
          <span>Protected by Runtime Policy Engine</span>
        </div>
      </div>
    </main>
  );
}
