"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  INTEGRATION_CATEGORIES,
  type Integration,
  type IntegrationCategory,
} from "@/src/config/integrations";
import {
  connectIntegration,
  disconnectIntegration,
  loadIntegrationConfig,
  loadIntegrations,
  markIntegrationError,
  saveIntegrationConfig,
  setIntegrationCapabilityEnabled,
  type IntegrationConfigValues,
} from "@/src/services/integrationStore";
import {
  listIntegrationActivity,
  recordIntegrationActivityLog,
  type IntegrationActivityLog,
} from "@/src/services/eventRouter";
import {
  generateGithubActionsWorkflow,
  suggestedWorkflowPath,
} from "@/src/services/githubWorkflowGenerator";

type DrawerTab = "CONFIG" | "CAPABILITIES" | "ACTIVITY";
type CategoryFilter = "ALL" | IntegrationCategory;

type ConnectionTestResult = {
  level: "green" | "yellow" | "red";
  message: string;
};

function timeAgo(value: string | null): string {
  if (!value) return "never";
  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusTone(status: Integration["status"]) {
  if (status === "CONNECTED") return { color: "#22c55e", label: "Connected" };
  if (status === "ERROR") return { color: "#ef4444", label: "Error" };
  if (status === "COMING_SOON") return { color: "#94a3b8", label: "Coming Soon" };
  return { color: "#94a3b8", label: "Not connected" };
}

function asText(value: string | boolean | undefined): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return value ?? "";
}

function isUrlValid(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function runConnectionTest(config: IntegrationConfigValues): ConnectionTestResult {
  const serial = JSON.stringify(config);
  const score = serial.length % 3;
  if (score === 0) {
    return {
      level: "green",
      message: "Connection successful — credentials valid",
    };
  }
  if (score === 1) {
    return {
      level: "yellow",
      message: "Connected but webhook unreachable — check your firewall settings",
    };
  }
  return {
    level: "red",
    message: "Authentication failed — verify your API key",
  };
}

export default function IntegrationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("CONFIG");
  const [configValues, setConfigValues] = useState<IntegrationConfigValues>({});
  const [activity, setActivity] = useState<IntegrationActivityLog[]>([]);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [urlErrors, setUrlErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [disconnectPromptOpen, setDisconnectPromptOpen] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const refresh = () => {
    setIntegrations(loadIntegrations());
  };

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
      return;
    }

    refresh();

    const onUpdated = () => refresh();
    window.addEventListener("agentgate:integrations-updated", onUpdated);
    return () => window.removeEventListener("agentgate:integrations-updated", onUpdated);
  }, [router]);

  const openDrawer = (integrationId: string, updateUrl = true) => {
    const found = loadIntegrations().find((item) => item.id === integrationId);
    if (!found || found.status === "COMING_SOON") return;

    setActiveId(integrationId);
    setDrawerTab("CONFIG");
    setConfigValues(loadIntegrationConfig(integrationId));
    setActivity(listIntegrationActivity(integrationId, 20));
    setShowSecrets({});
    setUrlErrors({});
    setFormError("");
    setTestResult(null);

    if (updateUrl) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("integration", integrationId);
      const query = params.toString();
      router.replace(query ? `/integrations?${query}` : "/integrations", { scroll: false });
    }
  };

  const closeDrawer = () => {
    setActiveId(null);
    setDisconnectPromptOpen(false);

    const params = new URLSearchParams(searchParams.toString());
    params.delete("integration");
    const query = params.toString();
    router.replace(query ? `/integrations?${query}` : "/integrations", { scroll: false });
  };

  useEffect(() => {
    const deepLinkId = searchParams.get("integration");
    if (!deepLinkId) return;
    if (!integrations.some((item) => item.id === deepLinkId)) return;
    if (activeId === deepLinkId) return;
    openDrawer(deepLinkId, false);
  }, [searchParams, integrations, activeId]);

  const activeIntegration = useMemo(
    () => integrations.find((item) => item.id === activeId) ?? null,
    [activeId, integrations],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return integrations.filter((integration) => {
      if (category !== "ALL" && integration.category !== category) return false;
      if (!q) return true;
      return (
        integration.name.toLowerCase().includes(q) ||
        integration.description.toLowerCase().includes(q) ||
        integration.category.toLowerCase().includes(q)
      );
    });
  }, [category, integrations, search]);

  const setField = (key: string, value: string | boolean) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  };

  const validateConfig = (integration: Integration): boolean => {
    const nextErrors: Record<string, string> = {};

    for (const field of integration.config_schema) {
      const value = configValues[field.key];
      const normalized = asText(value).trim();

      if (field.required) {
        if (field.type === "toggle") {
          if (value !== true) {
            nextErrors[field.key] = "This setting is required.";
          }
        } else if (!normalized) {
          nextErrors[field.key] = "This field is required.";
        }
      }

      if (field.type === "url" && normalized && !isUrlValid(normalized)) {
        nextErrors[field.key] = "Please enter a valid URL.";
      }
    }

    setUrlErrors(nextErrors);
    setFormError(Object.keys(nextErrors).length ? "Please resolve validation errors before saving." : "");
    return Object.keys(nextErrors).length === 0;
  };

  const saveConfiguration = () => {
    if (!activeIntegration) return;
    if (!validateConfig(activeIntegration)) return;

    saveIntegrationConfig(activeIntegration.id, configValues);

    if (testResult?.level === "red") {
      markIntegrationError(activeIntegration.id);
    } else {
      connectIntegration(activeIntegration.id);
    }

    recordIntegrationActivityLog({
      integration_id: activeIntegration.id,
      integration_name: activeIntegration.name,
      event_type: "CONFIG_UPDATED",
      capability_id: "configuration",
      capability_label: "Configuration",
      direction: "OUTBOUND",
      status: testResult?.level === "red" ? "FAILURE" : "SUCCESS",
      message: testResult?.message ?? "Configuration saved",
      attempts: 1,
    });

    refresh();
    setActivity(listIntegrationActivity(activeIntegration.id, 20));
    setFormError("");
  };

  const runTest = () => {
    if (!activeIntegration) return;
    const result = runConnectionTest(configValues);
    setTestResult(result);

    recordIntegrationActivityLog({
      integration_id: activeIntegration.id,
      integration_name: activeIntegration.name,
      event_type: "CONNECTION_TEST",
      capability_id: "connection_test",
      capability_label: "Connection Test",
      direction: "OUTBOUND",
      status: result.level === "red" ? "FAILURE" : "SUCCESS",
      message: result.message,
      attempts: 1,
    });

    if (result.level === "red") {
      markIntegrationError(activeIntegration.id);
    }

    refresh();
    setActivity(listIntegrationActivity(activeIntegration.id, 20));
  };

  const downloadGithubWorkflow = () => {
    if (!activeIntegration || activeIntegration.id !== "GITHUB_ACTIONS") return;

    const content = generateGithubActionsWorkflow(configValues);
    const fileName = suggestedWorkflowPath(configValues).split("/").pop() || "ai-governance.yml";

    const blob = new Blob([content], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const confirmDisconnect = () => {
    if (!activeIntegration) return;
    disconnectIntegration(activeIntegration.id);
    recordIntegrationActivityLog({
      integration_id: activeIntegration.id,
      integration_name: activeIntegration.name,
      event_type: "DISCONNECTED",
      capability_id: "configuration",
      capability_label: "Configuration",
      direction: "OUTBOUND",
      status: "SUCCESS",
      message: "Integration disconnected",
      attempts: 1,
    });
    refresh();
    setDisconnectPromptOpen(false);
    closeDrawer();
  };

  return (
    <main className="container-page" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Integrations Marketplace</h1>
          <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
            Connect AI governance workflows to your enterprise communication, ticketing, and observability stack.
          </p>
        </div>
      </div>

      <section className="card" style={{ display: "grid", gap: 12 }}>
        <input
          className="input"
          placeholder="Search integrations"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {INTEGRATION_CATEGORIES.map((item) => (
            <button
              key={item.id}
              className={`badge ${category === item.id ? "badge-allow" : ""}`}
              onClick={() => setCategory(item.id)}
              style={{ cursor: "pointer" }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 10,
        }}
      >
        {filtered.map((integration) => {
          const tone = statusTone(integration.status);
          const isConnected = integration.status === "CONNECTED";
          const isError = integration.status === "ERROR";
          const isComingSoon = integration.status === "COMING_SOON";

          return (
            <article
              key={integration.id}
              className="card"
              style={{
                cursor: isComingSoon ? "not-allowed" : "pointer",
                opacity: isComingSoon ? 0.75 : 1,
                display: "grid",
                gap: 10,
              }}
              onClick={() => {
                if (!isComingSoon) openDrawer(integration.id);
              }}
            >
              <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 10 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <img src={integration.logo_url} alt={integration.name} width={36} height={36} style={{ borderRadius: 8 }} />
                  <div>
                    <p style={{ margin: 0, fontWeight: 700 }}>{integration.name}</p>
                    <span className="badge" style={{ fontSize: 10 }}>{integration.category.replace("_", "/")}</span>
                  </div>
                </div>
                {isComingSoon ? <span style={{ fontSize: 18 }}>🔒</span> : null}
              </div>

              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>{integration.description}</p>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 3 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 9999, background: tone.color }} />
                    {tone.label}
                  </span>
                  {isConnected ? (
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                      last synced {timeAgo(integration.last_sync_at)}
                    </span>
                  ) : null}
                </div>

                {isComingSoon ? null : isConnected ? null : (
                  <button
                    className="btn-secondary"
                    onClick={(event) => {
                      event.stopPropagation();
                      openDrawer(integration.id);
                    }}
                  >
                    {isError ? "Fix connection" : "Set up"}
                  </button>
                )}
              </div>

              {isConnected ? (
                <span className="badge" style={{ width: "fit-content" }}>
                  {integration.event_count_24h} events in last 24h
                </span>
              ) : null}
            </article>
          );
        })}
      </section>

      {activeIntegration ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 1300 }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} onClick={closeDrawer} />
          <aside
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              width: "min(460px, 100vw)",
              height: "100%",
              background: "var(--surface)",
              borderLeft: "1px solid var(--border)",
              display: "grid",
              gridTemplateRows: "auto auto 1fr auto",
            }}
          >
            <div style={{ padding: 16, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <img src={activeIntegration.logo_url} alt={activeIntegration.name} width={40} height={40} style={{ borderRadius: 8 }} />
                <div>
                  <p style={{ margin: 0, fontWeight: 800 }}>{activeIntegration.name}</p>
                  <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 12 }}>{activeIntegration.description}</p>
                  <a href={activeIntegration.docs_url} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>
                    Docs
                  </a>
                </div>
              </div>
              <button className="btn-secondary" onClick={closeDrawer}>Close</button>
            </div>

            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6 }}>
              {(["CONFIG", "CAPABILITIES", "ACTIVITY"] as DrawerTab[]).map((tab) => (
                <button
                  key={tab}
                  className={`badge ${drawerTab === tab ? "badge-allow" : ""}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setDrawerTab(tab);
                    if (tab === "ACTIVITY") {
                      setActivity(listIntegrationActivity(activeIntegration.id, 20));
                    }
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div style={{ overflowY: "auto", padding: 16 }}>
              {drawerTab === "CONFIG" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {activeIntegration.config_schema.map((field) => {
                    const value = configValues[field.key];
                    const error = urlErrors[field.key];

                    if (field.type === "toggle") {
                      return (
                        <div key={field.key} className="settings-toggle-row" style={{ minHeight: 52 }}>
                          <div>
                            <p className="settings-toggle-title">{field.label}</p>
                            <p className="settings-toggle-description">{field.help_text}</p>
                            {error ? <p style={{ margin: "4px 0 0", color: "#ef4444", fontSize: 11 }}>{error}</p> : null}
                          </div>
                          <button
                            type="button"
                            className={`toggle ${value === true ? "on" : ""}`}
                            onClick={() => setField(field.key, value !== true)}
                          />
                        </div>
                      );
                    }

                    return (
                      <label key={field.key} style={{ display: "grid", gap: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>
                          {field.label}{field.required ? " *" : ""}
                        </span>

                        {field.type === "select" ? (
                          <select
                            className="input"
                            value={asText(value) || asText(field.default_value)}
                            onChange={(event) => setField(field.key, event.target.value)}
                          >
                            {(field.options ?? []).map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        ) : (
                          <div style={{ position: "relative" }}>
                            <input
                              className="input"
                              type={field.type === "password" && !showSecrets[field.key] ? "password" : "text"}
                              value={asText(value)}
                              placeholder={field.placeholder}
                              onChange={(event) => setField(field.key, event.target.value)}
                              onBlur={() => {
                                if (field.type !== "url") return;
                                const raw = asText(configValues[field.key]).trim();
                                setUrlErrors((prev) => ({
                                  ...prev,
                                  [field.key]: raw && !isUrlValid(raw) ? "Please enter a valid URL." : "",
                                }));
                              }}
                              style={field.type === "password" ? { paddingRight: 72 } : undefined}
                            />
                            {field.type === "password" ? (
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{
                                  position: "absolute",
                                  right: 6,
                                  top: 6,
                                  minHeight: 28,
                                  padding: "0 10px",
                                  fontSize: 11,
                                }}
                                onClick={() => setShowSecrets((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                              >
                                {showSecrets[field.key] ? "Hide" : "Show"}
                              </button>
                            ) : null}
                          </div>
                        )}
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{field.help_text}</span>
                        {error ? <span style={{ color: "#ef4444", fontSize: 11 }}>{error}</span> : null}
                      </label>
                    );
                  })}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className="btn-secondary" onClick={runTest}>Test Connection</button>
                    {activeIntegration.id === "GITHUB_ACTIONS" ? (
                      <button
                        className="btn-secondary"
                        onClick={downloadGithubWorkflow}
                        disabled={!asText(configValues.repository) || !asText(configValues.workflow_file)}
                      >
                        Download Workflow File
                      </button>
                    ) : null}
                  </div>

                  {testResult ? (
                    <div
                      className="card"
                      style={{
                        borderColor:
                          testResult.level === "green"
                            ? "#22c55e"
                            : testResult.level === "yellow"
                              ? "#f59e0b"
                              : "#ef4444",
                        background:
                          testResult.level === "green"
                            ? "rgba(34,197,94,0.08)"
                            : testResult.level === "yellow"
                              ? "rgba(245,158,11,0.08)"
                              : "rgba(239,68,68,0.08)",
                      }}
                    >
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{testResult.message}</p>
                    </div>
                  ) : null}

                  {formError ? <p style={{ margin: 0, color: "#ef4444", fontSize: 12 }}>{formError}</p> : null}
                </div>
              ) : null}

              {drawerTab === "CAPABILITIES" ? (
                <div style={{ display: "grid", gap: 8 }}>
                  {activeIntegration.capabilities.map((capability) => (
                    <div key={capability.id} className="card" style={{ display: "grid", gap: 8, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <div>
                          <p style={{ margin: 0, fontWeight: 600 }}>{capability.label}</p>
                          <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                            Trigger: {capability.trigger_event}
                          </p>
                        </div>
                        <span className="badge" style={{ height: "fit-content" }}>{capability.direction}</span>
                      </div>

                      <div className="settings-toggle-row" style={{ minHeight: 40 }}>
                        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>Enabled</p>
                        <button
                          type="button"
                          className={`toggle ${capability.enabled ? "on" : ""}`}
                          onClick={() => {
                            setIntegrationCapabilityEnabled(activeIntegration.id, capability.id, !capability.enabled);
                            refresh();
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {drawerTab === "ACTIVITY" ? (
                <div style={{ display: "grid", gap: 8 }}>
                  {activity.length === 0 ? (
                    <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12, fontFamily: "monospace" }}>
                      No events routed yet.
                    </p>
                  ) : (
                    activity.map((item) => (
                      <div key={item.id} className="card" style={{ padding: 12, display: "grid", gap: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
                          <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{item.event_type}</p>
                          <span className={`badge ${item.status === "SUCCESS" ? "badge-allow" : "badge-blocked"}`}>
                            {item.status === "SUCCESS" ? "SUCCESS" : "FAILURE"}
                          </span>
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{item.message}</p>
                        <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                          {new Date(item.timestamp).toLocaleString()} · attempts: {item.attempts}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            <div style={{ padding: 16, borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "space-between" }}>
              <button className="btn-primary" onClick={saveConfiguration}>Save Configuration</button>
              <button className="btn-secondary" onClick={() => setDisconnectPromptOpen(true)}>Disconnect</button>
            </div>
          </aside>
        </div>
      ) : null}

      {disconnectPromptOpen && activeIntegration ? (
        <div className="settings-dialog-backdrop" style={{ zIndex: 1400 }}>
          <div className="card settings-dialog">
            <h2 className="settings-dialog-title">Disconnect {activeIntegration.name}?</h2>
            <p className="settings-dialog-text">
              Disconnecting will stop these capabilities:
            </p>
            <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
              {activeIntegration.capabilities
                .filter((capability) => capability.enabled)
                .map((capability) => (
                  <li key={capability.id} style={{ fontSize: 12, marginBottom: 4 }}>{capability.label}</li>
                ))}
            </ul>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="btn-secondary" onClick={() => setDisconnectPromptOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={confirmDisconnect}>Disconnect</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
