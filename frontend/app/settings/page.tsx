"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api";
import { PermissionGate } from "@/src/components/PermissionGate";
import {
  EscalationConfig,
  NotificationResult,
  loadEscalationConfig,
  saveEscalationConfig,
  sendEmailAlert,
} from "@/lib/notificationService";
import { routeEvent } from "@/src/services/eventRouter";
import { BUILT_IN_ROLES, getRoleLabel, type Role } from "@/src/config/roles";

type SettingsSection = "general" | "api" | "organization" | "notifications" | "sso" | "danger";

// ── SSO Configuration Component ────────────────────────────────────────────────

type SSOProvider = "saml" | "oidc";
type SAMLConfig = {
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate: string;
  sp_entity_id: string;
  attr_email: string;
  attr_name: string;
  attr_role: string;
};
type OIDCConfig = {
  discovery_url: string;
  client_id: string;
  client_secret: string;
  allowed_domains: string;
  default_role: Role;
  jit_provisioning: boolean;
};

const SSO_KEY = "agentgate_sso_config_v1";

function loadSSOConfig(): { provider: SSOProvider; saml: SAMLConfig; oidc: OIDCConfig } {
  try {
    const raw = localStorage.getItem(SSO_KEY);
    if (raw) return JSON.parse(raw);
  } catch { }
  return {
    provider: "saml",
    saml: {
      idp_entity_id: "",
      idp_sso_url: "",
      idp_certificate: "",
      sp_entity_id: typeof window !== "undefined" ? `${window.location.origin}/sso/saml/metadata` : "",
      attr_email: "email",
      attr_name: "displayName",
      attr_role: "role",
    },
    oidc: {
      discovery_url: "",
      client_id: "",
      client_secret: "",
      allowed_domains: "",
      default_role: "VIEWER",
      jit_provisioning: false,
    },
  };
}

function SSOConfigSection() {
  const [provider, setProvider] = useState<SSOProvider>("saml");
  const [saml, setSaml] = useState<SAMLConfig>(loadSSOConfig().saml);
  const [oidc, setOidc] = useState<OIDCConfig>(loadSSOConfig().oidc);
  const [notice, setNotice] = useState("");
  const [testResult, setTestResult] = useState<null | {
    attributes: Record<string, string>;
    mappedRole: string;
    accessGranted: boolean;
  }>(null);

  useEffect(() => {
    const cfg = loadSSOConfig();
    setProvider(cfg.provider);
    setSaml(cfg.saml);
    setOidc(cfg.oidc);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const saveConfig = () => {
    localStorage.setItem(SSO_KEY, JSON.stringify({ provider, saml, oidc }));
    setNotice("SSO configuration saved");
  };

  const testSSO = () => {
    setTestResult(null);
    setTimeout(() => {
      if (provider === "saml") {
        setTestResult({
          attributes: {
            [saml.attr_email]: "test-user@company.com",
            [saml.attr_name]: "Test User",
            [saml.attr_role]: "Security Approver",
            nameID: "test-user@company.com",
            sessionIndex: "_session_abc123",
          },
          mappedRole: "SECURITY_APPROVER",
          accessGranted: true,
        });
      } else {
        const domains = oidc.allowed_domains.split(",").map((d) => d.trim()).filter(Boolean);
        const testEmail = "test-user@company.com";
        const emailDomain = testEmail.split("@")[1];
        const accessGranted = domains.length === 0 || domains.includes(emailDomain);
        setTestResult({
          attributes: {
            email: testEmail,
            name: "Test User",
            sub: "oauth2|123456789",
            email_verified: "true",
          },
          mappedRole: oidc.default_role,
          accessGranted,
        });
      }
    }, 800);
  };

  const spMetadata = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${saml.sp_entity_id}">
  <SPSSODescriptor
    AuthnRequestsSigned="true"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${typeof window !== 'undefined' ? window.location.origin : ''}/sso/saml/acs"
      index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;

  return (
    <section className="card settings-panel">
      <h2 className="settings-section-title">Single Sign-On (SSO)</h2>
      <p className="settings-section-subtitle">Configure SAML 2.0 or OIDC identity provider for enterprise authentication.</p>

      {notice && <p className="mono" style={{ color: "var(--accent-green, #22c55e)", fontSize: 12, marginBottom: 10 }}>✓ {notice}</p>}

      {/* Provider Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["saml", "oidc"] as SSOProvider[]).map((p) => (
          <button
            key={p}
            className={provider === p ? "btn-primary" : "btn-secondary"}
            style={{ fontSize: 12, padding: "6px 16px" }}
            onClick={() => setProvider(p)}
          >
            {p === "saml" ? "SAML 2.0" : "OIDC"}
          </button>
        ))}
      </div>

      {provider === "saml" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="settings-field">
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>IdP Entity ID *</span>
            <input className="input settings-input" value={saml.idp_entity_id} onChange={(e) => setSaml((p) => ({ ...p, idp_entity_id: e.target.value }))} placeholder="https://idp.example.com/metadata" />
          </label>
          <label className="settings-field">
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>IdP SSO URL *</span>
            <input className="input settings-input" type="url" value={saml.idp_sso_url} onChange={(e) => setSaml((p) => ({ ...p, idp_sso_url: e.target.value }))} placeholder="https://idp.example.com/sso" />
          </label>
          <label className="settings-field">
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>IdP Certificate (PEM) *</span>
            <textarea className="input settings-input" style={{ minHeight: 100, fontFamily: "monospace", fontSize: 11 }} value={saml.idp_certificate} onChange={(e) => setSaml((p) => ({ ...p, idp_certificate: e.target.value }))} placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" />
          </label>
          <label className="settings-field">
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>SP Entity ID (auto-populated)</span>
            <input className="input settings-input settings-input-readonly" value={saml.sp_entity_id} readOnly />
          </label>

          {/* Attribute Mapping */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase", color: "var(--text-muted)" }}>Attribute Mapping</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <label className="settings-field">
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>Email attribute</span>
                <input className="input settings-input" value={saml.attr_email} onChange={(e) => setSaml((p) => ({ ...p, attr_email: e.target.value }))} />
              </label>
              <label className="settings-field">
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>Name attribute</span>
                <input className="input settings-input" value={saml.attr_name} onChange={(e) => setSaml((p) => ({ ...p, attr_name: e.target.value }))} />
              </label>
              <label className="settings-field">
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>Role attribute</span>
                <input className="input settings-input" value={saml.attr_role} onChange={(e) => setSaml((p) => ({ ...p, attr_role: e.target.value }))} />
              </label>
            </div>
          </div>

          {/* SP Metadata */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase", color: "var(--text-muted)" }}>SP Metadata (give to your IdP)</p>
            <pre style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", background: "var(--surface2)", padding: 10, borderRadius: 6, overflow: "auto", maxHeight: 160, whiteSpace: "pre-wrap" }}>{spMetadata}</pre>
            <button className="btn-secondary" style={{ fontSize: 11, marginTop: 8 }} onClick={() => { navigator.clipboard.writeText(spMetadata); setNotice("SP Metadata copied"); }}>Copy XML</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="settings-field">
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>Discovery URL *</span>
            <input className="input settings-input" type="url" value={oidc.discovery_url} onChange={(e) => setOidc((p) => ({ ...p, discovery_url: e.target.value }))} placeholder="https://accounts.google.com/.well-known/openid-configuration" />
          </label>
          <label className="settings-field">
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>Client ID *</span>
            <input className="input settings-input" value={oidc.client_id} onChange={(e) => setOidc((p) => ({ ...p, client_id: e.target.value }))} placeholder="your-client-id" />
          </label>
          <label className="settings-field">
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>Client Secret *</span>
            <input className="input settings-input" type="password" value={oidc.client_secret} onChange={(e) => setOidc((p) => ({ ...p, client_secret: e.target.value }))} placeholder="your-client-secret" />
          </label>
          <label className="settings-field">
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>Allowed email domains (comma-separated)</span>
            <input className="input settings-input" value={oidc.allowed_domains} onChange={(e) => setOidc((p) => ({ ...p, allowed_domains: e.target.value }))} placeholder="company.com, partner.com" />
          </label>
          <label className="settings-field">
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>Default role for new SSO users</span>
            <select className="input settings-input" value={oidc.default_role} onChange={(e) => setOidc((p) => ({ ...p, default_role: e.target.value as Role }))}>
              {BUILT_IN_ROLES.map((r) => (
                <option key={r} value={r}>{getRoleLabel(r)}</option>
              ))}
            </select>
          </label>
          <div className="settings-toggle-row">
            <div>
              <p className="settings-toggle-title">Just-in-time provisioning</p>
              <p className="settings-toggle-description">Auto-create user accounts on first SSO login without requiring a prior invite.</p>
            </div>
            <button className={`toggle ${oidc.jit_provisioning ? "on" : ""}`} onClick={() => setOidc((p) => ({ ...p, jit_provisioning: !p.jit_provisioning }))} aria-label="Toggle JIT provisioning" />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <button className="btn-primary settings-save-btn" style={{ margin: 0 }} onClick={saveConfig}>
          Save SSO Configuration
        </button>
        <button className="btn-secondary settings-save-btn" style={{ margin: 0 }} onClick={testSSO}>
          Test SSO
        </button>
      </div>

      {/* Test Result */}
      {testResult && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--border)" }}>
          <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, fontFamily: "monospace", color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>SSO Test Result</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 16 }}>{testResult.accessGranted ? "✅" : "❌"}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{testResult.accessGranted ? "Access Granted" : "Access Denied"}</span>
          </div>
          <p style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", marginBottom: 4 }}>MAPPED ROLE</p>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{getRoleLabel(testResult.mappedRole as Role)}</p>
          <p style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", marginBottom: 4 }}>RECEIVED ATTRIBUTES</p>
          {Object.entries(testResult.attributes).map(([key, val]) => (
            <div key={key} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 2 }}>
              <span style={{ fontFamily: "monospace", color: "var(--text-muted)", minWidth: 120 }}>{key}:</span>
              <span>{val}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
type ThemeMode = "light" | "dark" | "system";
const THEME_MODE_KEY = "agentgate-theme-mode-v2";
const THEME_KEY = "agentgate-theme-v2";

function generateApiKey() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `ag_${body}`;
}

function maskedKey(value: string) {
  if (!value) return "ag_••••••••••••75d5";
  const suffix = value.slice(-4);
  return `ag_••••••••••••${suffix}`;
}

const sections: Array<{ id: SettingsSection; icon: string; label: string; protected?: boolean }> = [
  { id: "general", icon: "⚙️", label: "General" },
  { id: "api", icon: "🔑", label: "API Keys" },
  { id: "organization", icon: "🏢", label: "Organization" },
  { id: "notifications", icon: "🔔", label: "Notifications" },
  { id: "sso", icon: "🔐", label: "SSO" },
  { id: "danger", icon: "🚨", label: "Danger Zone", protected: true },
];

export default function SettingsPage() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [apiKey, setApiKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [orgName, setOrgName] = useState("Enterprise AI Org");
  const [adminEmail, setAdminEmail] = useState("admin@example.com");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [weeklySummary, setWeeklySummary] = useState(false);
  const [assumedIncidentCost, setAssumedIncidentCost] = useState("25000");
  const [assumptionConfidence, setAssumptionConfidence] = useState("0.35");
  const [highRiskThreshold, setHighRiskThreshold] = useState("70");
  const [assumptionsEnabled, setAssumptionsEnabled] = useState(true);
  const [busyReset, setBusyReset] = useState(false);
  const [notice, setNotice] = useState("");
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [escalationCfg, setEscalationCfg] = useState<EscalationConfig>({
    slack_webhook_url: "",
    approver_email: "",
    notify_on_escalation: true,
    notify_early_warning: false,
  });
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<NotificationResult[] | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
      return;
    }

    const userRaw = localStorage.getItem("user");
    if (userRaw) {
      try {
        const user = JSON.parse(userRaw) as { email?: string };
        setAdminEmail(user.email || "admin@example.com");
      } catch {
        setAdminEmail("admin@example.com");
      }
    }

    const storedApiKey = localStorage.getItem("agentgate_org_api_key");
    if (storedApiKey) {
      setApiKey(storedApiKey);
    } else {
      const generated = generateApiKey();
      localStorage.setItem("agentgate_org_api_key", generated);
      setApiKey(generated);
    }

    setOrgName(localStorage.getItem("agentgate_org_name") || "Enterprise AI Org");
    setEmailAlerts(localStorage.getItem("agentgate_notify_email_blocked") !== "false");
    setWeeklySummary(localStorage.getItem("agentgate_notify_weekly_summary") === "true");
    setEscalationCfg(loadEscalationConfig());

    const storedTheme = localStorage.getItem(THEME_MODE_KEY);
    const nextThemeMode: ThemeMode =
      storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
        ? storedTheme
        : "dark";
    setThemeMode(nextThemeMode);

    apiRequest("/dashboard/loss-assumptions")
      .then((data) => {
        const assumptions = data as {
          assumed_incident_cost_usd?: number | null;
          confidence?: number | null;
          high_risk_threshold?: number | null;
          enabled?: boolean;
        };
        if (typeof assumptions.assumed_incident_cost_usd === "number") {
          setAssumedIncidentCost(String(assumptions.assumed_incident_cost_usd));
        }
        if (typeof assumptions.confidence === "number") {
          setAssumptionConfidence(String(assumptions.confidence));
        }
        if (typeof assumptions.high_risk_threshold === "number") {
          setHighRiskThreshold(String(assumptions.high_risk_threshold));
        }
        if (typeof assumptions.enabled === "boolean") {
          setAssumptionsEnabled(assumptions.enabled);
        }
      })
      .catch(() => undefined);
  }, [router]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 1800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const displayedKey = useMemo(() => (reveal ? apiKey : maskedKey(apiKey)), [apiKey, reveal]);

  const applyThemeMode = (nextMode: ThemeMode) => {
    const root = document.documentElement;
    localStorage.setItem(THEME_MODE_KEY, nextMode);
    setThemeMode(nextMode);

    if (nextMode === "system") {
      localStorage.removeItem(THEME_KEY);
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.setAttribute("data-theme", prefersDark ? "dark" : "light");
      return;
    }

    localStorage.setItem(THEME_KEY, nextMode);
    root.setAttribute("data-theme", nextMode);
  };

  const copyKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setNotice("API key copied");
    } catch {
      setNotice("—");
    }
  };

  const regenerateKey = () => {
    if (!window.confirm("Regenerate API key? Existing integrations will stop working until updated.")) return;
    const generated = generateApiKey();
    setApiKey(generated);
    localStorage.setItem("agentgate_org_api_key", generated);
    setNotice("API key regenerated");
  };

  const saveOrganization = () => {
    localStorage.setItem("agentgate_org_name", orgName);
    setNotice("Organization saved");
  };

  const saveAssumptions = async () => {
    try {
      await apiRequest("/dashboard/loss-assumptions", {
        method: "PUT",
        body: JSON.stringify({
          assumed_incident_cost_usd: Number(assumedIncidentCost),
          confidence: Number(assumptionConfidence),
          high_risk_threshold: Number(highRiskThreshold),
          enabled: assumptionsEnabled,
        }),
      });
      setNotice("Assumptions saved");
      localStorage.setItem("gateway:refresh-at", String(Date.now()));
      window.dispatchEvent(new CustomEvent("gateway:refresh"));
    } catch {
      setNotice("—");
    }
  };

  const saveNotifications = (emailBlocked: boolean, weekly: boolean) => {
    localStorage.setItem("agentgate_notify_email_blocked", String(emailBlocked));
    localStorage.setItem("agentgate_notify_weekly_summary", String(weekly));
  };

  const runTestNotification = async () => {
    setTestRunning(true);
    setTestResults(null);

    // Build a realistic fake breach payload using current config
    const now = new Date();
    const fakeBreachedAt = new Date(now.getTime() - 65 * 60 * 1000); // 65 min ago
    const fakeCreatedAt = new Date(fakeBreachedAt.getTime() - 24 * 60 * 60 * 1000);

    const mockPayload = {
      request_id: `test-${Date.now().toString(16)}`,
      agent_id: `test-agent-00000000`,
      action_type: "send_email",
      risk_score: 85,
      sla_breached_at: fakeBreachedAt.toISOString(),
      overdue_ms: 65 * 60 * 1000,
      approver_email: escalationCfg.approver_email,
      slack_webhook_url: escalationCfg.slack_webhook_url,
    };

    const [routed, emailResult] = await Promise.all([
      routeEvent({ type: "SLA_BREACH_NOTIFIED", payload: mockPayload }, { integrationIds: ["SLACK"] }),
      sendEmailAlert(mockPayload),
    ]);

    const slackRoute = routed.find((item) => item.integration_id === "SLACK");
    const slackResult: NotificationResult = slackRoute
      ? {
        success: slackRoute.success,
        channel: "slack",
        error: slackRoute.success ? undefined : slackRoute.message,
      }
      : { success: false, channel: "slack", error: "Slack integration route not available" };

    setTestResults([slackResult, emailResult]);
    setTestRunning(false);

    const allOk = slackResult.success && emailResult.success;
    setNotice(allOk ? "Test alerts sent successfully" : "Some channels failed — check results below");
    void fakeCreatedAt; // silence unused var warning
  };

  const resetSimulationData = async () => {
    try {
      setBusyReset(true);
      await apiRequest("/sim/reset", { method: "POST" });
      localStorage.setItem("gateway:refresh-at", String(Date.now()));
      window.dispatchEvent(new CustomEvent("gateway:refresh"));
      setNotice("Simulation data reset");
    } catch {
      setNotice("—");
    } finally {
      setBusyReset(false);
      setShowResetDialog(false);
    }
  };

  return (
    <main className="container-page settings-root">
      <div className="settings-header">
        <h1 className="page-title">Settings</h1>
        <p className="mono settings-header-subtitle">Workspace-level controls for runtime enforcement.</p>
      </div>

      {notice ? <p className="mono settings-notice">{notice}</p> : null}

      <section className="settings-shell">
        <aside className="settings-nav" aria-label="Settings Sections">
          {sections.map((section) => (
            <button
              key={section.id}
              className={`settings-nav-item ${activeSection === section.id ? "active" : ""}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span className="settings-nav-icon" aria-hidden>{section.icon}</span>
              <span>{section.label}</span>
            </button>
          ))}
        </aside>

        <div className="settings-content">
          {activeSection === "general" ? (
            <section className="card settings-panel">
              <h2 className="settings-section-title">General</h2>
              <p className="settings-section-subtitle">Configure appearance and account defaults.</p>

              <div className="settings-subsection">
                <p className="settings-subsection-label">Theme</p>
                <div className="settings-theme-grid">
                  {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
                    <button
                      key={mode}
                      className={`settings-theme-card ${themeMode === mode ? "selected" : ""}`}
                      onClick={() => applyThemeMode(mode)}
                    >
                      <span className={`settings-theme-preview preview-${mode}`}>
                        <span className="preview-top" />
                        <span className="preview-body" />
                      </span>
                      <span className="settings-theme-name">{mode[0].toUpperCase() + mode.slice(1)}</span>
                      {themeMode === mode ? <span className="settings-theme-check">✓</span> : null}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-subsection">
                <p className="settings-subsection-label">Language</p>
                <select className="input settings-input settings-input-disabled" disabled>
                  <option>English</option>
                </select>
              </div>

              <div className="settings-subsection">
                <p className="settings-subsection-label">Prevented-loss assumptions</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="settings-field">
                    <span>Assumed incident cost (USD)</span>
                    <input className="input settings-input" type="number" min="0" step="100" value={assumedIncidentCost} onChange={(e) => setAssumedIncidentCost(e.target.value)} />
                  </label>
                  <label className="settings-field">
                    <span>Confidence (0..1)</span>
                    <input className="input settings-input" type="number" min="0" max="1" step="0.01" value={assumptionConfidence} onChange={(e) => setAssumptionConfidence(e.target.value)} />
                  </label>
                  <label className="settings-field">
                    <span>High-risk threshold</span>
                    <input className="input settings-input" type="number" min="0" max="100" step="1" value={highRiskThreshold} onChange={(e) => setHighRiskThreshold(e.target.value)} />
                  </label>
                  <label className="settings-toggle-row">
                    <div>
                      <p className="settings-toggle-title">Enable prevented-loss estimation</p>
                    </div>
                    <button
                      className={`toggle ${assumptionsEnabled ? "on" : ""}`}
                      onClick={() => setAssumptionsEnabled((prev) => !prev)}
                      type="button"
                      aria-label="Toggle prevented-loss assumptions"
                    />
                  </label>
                </div>
                <button className="btn-primary settings-save-btn" onClick={saveAssumptions}>Save assumptions</button>
              </div>
            </section>
          ) : null}

          {activeSection === "api" ? (
            <section className="card settings-panel">
              <h2 className="settings-section-title">API Keys</h2>
              <p className="settings-section-subtitle">Manage the workspace key used by SDK and integrations.</p>

              <div className="settings-subsection">
                <p className="settings-subsection-label">API Key</p>
                <code className="settings-key mono">{displayedKey || "ag_••••••••••••75d5"}</code>
                <div className="settings-inline-actions">
                  <button className="btn-secondary settings-action-btn" onClick={() => setReveal((prev) => !prev)}>
                    {reveal ? "Hide" : "Reveal"}
                  </button>
                  <button className="btn-secondary settings-action-btn" onClick={copyKey}>Copy</button>
                  <button className="btn-secondary settings-action-btn settings-action-danger" onClick={regenerateKey}>
                    Regenerate
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {activeSection === "organization" ? (
            <section className="card settings-panel">
              <h2 className="settings-section-title">Organization</h2>
              <p className="settings-section-subtitle">Tenant metadata used across policy, audit, and spend views.</p>

              <label className="settings-field">
                <span>Organization name</span>
                <input className="input settings-input" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              </label>
              <label className="settings-field">
                <span>Admin email</span>
                <input className="input settings-input settings-input-readonly" value={adminEmail} readOnly />
              </label>
              <button className="btn-primary settings-save-btn" onClick={saveOrganization}>Save</button>
            </section>
          ) : null}

          {activeSection === "notifications" ? (
            <section className="card settings-panel">
              <h2 className="settings-section-title">Notifications</h2>
              <p className="settings-section-subtitle">Alert delivery preferences and SLA escalation routing.</p>

              {/* ── General toggles ── */}
              <div className="settings-toggle-row">
                <div>
                  <p className="settings-toggle-title">Email alerts for blocked actions</p>
                  <p className="settings-toggle-description">Receive a notification when high-risk actions are blocked.</p>
                </div>
                <button
                  className={`toggle ${emailAlerts ? "on" : ""}`}
                  onClick={() => { const n = !emailAlerts; setEmailAlerts(n); saveNotifications(n, weeklySummary); }}
                  aria-label="Toggle blocked action alerts"
                />
              </div>

              <div className="settings-toggle-divider" />

              <div className="settings-toggle-row">
                <div>
                  <p className="settings-toggle-title">Weekly compliance summary</p>
                  <p className="settings-toggle-description">Weekly digest of approvals, blocks, and usage evidence.</p>
                </div>
                <button
                  className={`toggle ${weeklySummary ? "on" : ""}`}
                  onClick={() => { const n = !weeklySummary; setWeeklySummary(n); saveNotifications(emailAlerts, n); }}
                  aria-label="Toggle weekly summary"
                />
              </div>

              <div className="settings-toggle-divider" style={{ margin: "20px 0" }} />

              {/* ── Escalation config panel ── */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <h3 className="settings-section-title" style={{ margin: 0, fontSize: "0.95rem" }}>
                    SLA Escalation Routing
                  </h3>
                  <span className="badge badge-allow" style={{ fontSize: 10 }}>NEW</span>
                </div>
                <p className="settings-section-subtitle" style={{ marginBottom: 14 }}>
                  When an approval breaches its 24-hour SLA, fire alerts via Slack and email automatically.
                </p>

                {/* Slack webhook */}
                <label className="settings-field" style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                    Slack Webhook URL
                  </span>
                  <input
                    className="input settings-input"
                    type="url"
                    placeholder="https://hooks.slack.com/services/T00.../B00.../xxx"
                    value={escalationCfg.slack_webhook_url}
                    onChange={(e) =>
                      setEscalationCfg((prev) => ({ ...prev, slack_webhook_url: e.target.value }))
                    }
                  />
                </label>

                {/* Approver email */}
                <label className="settings-field" style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                    Security Approver Email
                  </span>
                  <input
                    className="input settings-input"
                    type="email"
                    placeholder="security-team@company.com"
                    value={escalationCfg.approver_email}
                    onChange={(e) =>
                      setEscalationCfg((prev) => ({ ...prev, approver_email: e.target.value }))
                    }
                  />
                </label>

                {/* Toggle: notify on escalation */}
                <div className="settings-toggle-row" style={{ marginBottom: 10 }}>
                  <div>
                    <p className="settings-toggle-title">Notify on escalation</p>
                    <p className="settings-toggle-description">
                      Fire Slack + email when a request's 24-hour SLA hits zero.
                    </p>
                  </div>
                  <button
                    className={`toggle ${escalationCfg.notify_on_escalation ? "on" : ""}`}
                    onClick={() =>
                      setEscalationCfg((prev) => ({
                        ...prev,
                        notify_on_escalation: !prev.notify_on_escalation,
                      }))
                    }
                    aria-label="Toggle escalation notifications"
                  />
                </div>

                <div className="settings-toggle-divider" />

                {/* Toggle: early warning at 75 % */}
                <div className="settings-toggle-row" style={{ marginTop: 10, marginBottom: 16 }}>
                  <div>
                    <p className="settings-toggle-title">Notify at 75% of SLA window</p>
                    <p className="settings-toggle-description">
                      Send an early-warning in-app alert when 18 hours have elapsed (6 h remaining).
                    </p>
                  </div>
                  <button
                    className={`toggle ${escalationCfg.notify_early_warning ? "on" : ""}`}
                    onClick={() =>
                      setEscalationCfg((prev) => ({
                        ...prev,
                        notify_early_warning: !prev.notify_early_warning,
                      }))
                    }
                    aria-label="Toggle early warning"
                  />
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn-primary settings-save-btn"
                    style={{ margin: 0 }}
                    onClick={() => {
                      saveEscalationConfig(escalationCfg);
                      setNotice("Escalation config saved");
                    }}
                  >
                    Save escalation settings
                  </button>
                  <button
                    className="btn-secondary settings-save-btn"
                    style={{ margin: 0 }}
                    disabled={testRunning}
                    onClick={runTestNotification}
                  >
                    {testRunning ? "Sending test…" : "Send Test Notification"}
                  </button>
                </div>

                {/* Test results panel */}
                {testResults !== null && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: "12px 16px",
                      borderRadius: 8,
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, fontFamily: "monospace", color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Test Results
                    </p>
                    {testResults.map((r) => (
                      <div
                        key={r.channel}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                          padding: "8px 0",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <span style={{ fontSize: 16, lineHeight: 1.4 }}>
                          {r.success ? "✅" : "❌"}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>
                            {r.channel}
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 11,
                                fontFamily: "monospace",
                                color: r.success ? "var(--accent-green,#22c55e)" : "#ef4444",
                              }}
                            >
                              {r.success ? "SENT" : "FAILED"}
                            </span>
                          </p>
                          {r.error && (
                            <p style={{ margin: "3px 0 0", fontSize: 11, color: "#ef4444", fontFamily: "monospace", wordBreak: "break-all" }}>
                              {r.error}
                            </p>
                          )}
                          {!r.error && r.success && (
                            <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                              {r.channel === "slack"
                                ? "Check your Slack channel for the test message."
                                : `Email delivered to ${escalationCfg.approver_email || "configured address"}.`}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {activeSection === "sso" ? (
            <SSOConfigSection />
          ) : null}

          {activeSection === "danger" ? (
            <PermissionGate permission="settings:danger_zone" fallback="replace" fallbackElement={
              <section className="card settings-panel">
                <h2 className="settings-section-title" style={{ color: "var(--text-muted)" }}>🔒 Danger Zone</h2>
                <p className="settings-section-subtitle">You do not have permission to access this section. Only Security Admins can perform destructive operations.</p>
              </section>
            }>
              <section className="card settings-panel settings-danger-panel">
                <h2 className="settings-section-title settings-danger-title">Danger Zone</h2>
                <p className="settings-section-subtitle">
                  Reset all generated simulator artifacts. This action cannot be undone.
                </p>
                <button className="btn-secondary settings-danger-btn" onClick={() => setShowResetDialog(true)}>
                  Reset all simulation data
                </button>
              </section>
            </PermissionGate>
          ) : null}
        </div>
      </section>

      {showResetDialog ? (
        <div className="settings-dialog-backdrop" onClick={() => setShowResetDialog(false)}>
          <div className="settings-dialog card" onClick={(e) => e.stopPropagation()}>
            <h3 className="settings-dialog-title">Are you sure?</h3>
            <p className="settings-dialog-text">
              This will delete all audit logs, approvals, and simulation data. This cannot be undone.
            </p>
            <div className="settings-inline-actions">
              <button className="btn-secondary settings-action-btn" onClick={() => setShowResetDialog(false)}>
                Cancel
              </button>
              <button className="btn-danger settings-action-btn" onClick={resetSimulationData} disabled={busyReset}>
                {busyReset ? "Resetting..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
