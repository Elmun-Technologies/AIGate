"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequestWithRetry } from "@/lib/api";
import { loadIntegrations } from "@/src/services/integrationStore";
import { routeEvent } from "@/src/services/eventRouter";
import type { Integration } from "@/src/config/integrations";

type ExecutiveSummary = {
  kpis: {
    total_spend_7d_usd: number;
    projected_monthly_usd: number;
    shadow_providers_count: number;
    open_alerts_count: number;
  };
  top_alerts: Array<{
    id: string;
    severity: string;
    type: string;
    message: string;
    created_at: string | null;
  }>;
};

type DashboardProof = {
  blocked_high_risk: number;
  approvals_pending: number;
  approvals_resolved: number;
  audit_records: number;
};

export default function ExecutivePage() {
  const router = useRouter();
  const [summary, setSummary] = useState<ExecutiveSummary>({
    kpis: {
      total_spend_7d_usd: 0,
      projected_monthly_usd: 0,
      shadow_providers_count: 0,
      open_alerts_count: 0,
    },
    top_alerts: [],
  });
  const [proof, setProof] = useState<DashboardProof>({
    blocked_high_risk: 0,
    approvals_pending: 0,
    approvals_resolved: 0,
    audit_records: 0,
  });
  const [integrationHealth, setIntegrationHealth] = useState<Integration[]>([]);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
      return;
    }
    const load = async () => {
      const [summaryData, proofData] = await Promise.all([
        apiRequestWithRetry("/ai-governance/summary?days=7"),
        apiRequestWithRetry("/dashboard/proof"),
      ]);
      if (summaryData) setSummary(summaryData as ExecutiveSummary);
      if (proofData) setProof(proofData as DashboardProof);
      setIntegrationHealth(loadIntegrations());

      if (proofData) {
        const nextProof = proofData as DashboardProof;
        void routeEvent({
          type: "METRIC_EXPORTED",
          payload: {
            risk_score: Math.min(100, nextProof.blocked_high_risk * 10 + nextProof.approvals_pending * 6),
            blocked_count: nextProof.blocked_high_risk,
            agent_health_score: Math.max(0, 100 - nextProof.approvals_pending * 5),
            timestamp: new Date().toISOString(),
            tags: ["source:executive-dashboard"],
          },
        });
      }
    };
    load();

    const onIntegrationUpdate = () => setIntegrationHealth(loadIntegrations());
    window.addEventListener("agentgate:integrations-updated", onIntegrationUpdate);
    return () => window.removeEventListener("agentgate:integrations-updated", onIntegrationUpdate);
  }, [router]);

  const compliance = useMemo(() => {
    const numerator = proof.approvals_resolved + Math.max(1, proof.audit_records);
    const denominator = Math.max(1, proof.audit_records + proof.approvals_pending);
    return Math.min(100, Math.round((numerator / denominator) * 100));
  }, [proof]);

  const configuredIntegrations = useMemo(
    () => integrationHealth.filter((item) => item.status !== "COMING_SOON" && (item.status !== "DISCONNECTED" || Boolean(item.connected_at))),
    [integrationHealth],
  );

  const integrationErrors = useMemo(
    () => configuredIntegrations.filter((item) => item.status === "ERROR"),
    [configuredIntegrations],
  );

  const integrationErrorSummary = useMemo(() => {
    if (integrationErrors.length === 0) return "";
    const first = integrationErrors[0];
    if (!first.last_sync_at) return `${first.name} sync is failing.`;
    const elapsedHours = Math.max(1, Math.floor((Date.now() - new Date(first.last_sync_at).getTime()) / 3600000));
    return `${first.name} sync has been failing for ${elapsedHours} hour${elapsedHours === 1 ? "" : "s"}.`;
  }, [integrationErrors]);

  const formatSyncAge = (iso: string | null) => {
    if (!iso) return "never";
    const mins = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <main className="container-page space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">Governance Overview</h1>
        <span className="badge badge-allow">SYSTEMS OPERATIONAL</span>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="card stat-card-enterprise">
          <p className="stat-label">Overall Compliance</p>
          <p className="stat-number">{compliance}%</p>
          <div className="risk-progress-track mt-2"><div className="risk-progress-fill" style={{ width: `${compliance}%` }} /></div>
        </div>
        <div className="card stat-card-enterprise">
          <p className="stat-label">Active Risks</p>
          <p className="stat-number">{proof.blocked_high_risk + proof.approvals_pending}</p>
          <p className="text-sm text-slate-600">{proof.blocked_high_risk} critical, {proof.approvals_pending} moderate</p>
        </div>
        <div className="card stat-card-enterprise">
          <p className="stat-label">Pending Audits</p>
          <p className="stat-number">{summary.kpis.open_alerts_count.toString().padStart(2, "0")}</p>
          <p className="text-sm text-slate-600">due in 7d</p>
        </div>
        <div className="card stat-card-enterprise">
          <p className="stat-label">AI Models Logged</p>
          <p className="stat-number">{proof.audit_records}</p>
          <p className="text-sm text-slate-600">{summary.kpis.shadow_providers_count} shadow providers</p>
        </div>
      </section>

      {integrationErrors.length > 0 ? (
        <button
          className="card"
          style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,0.12)", textAlign: "left" }}
          onClick={() => router.push(`/integrations?integration=${integrationErrors[0].id}`)}
        >
          <p style={{ margin: 0, fontWeight: 700 }}>
            {integrationErrors.length} integration{integrationErrors.length === 1 ? "" : "s"} require{integrationErrors.length === 1 ? "s" : ""} attention
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>{integrationErrorSummary}</p>
        </button>
      ) : null}

      <section className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Integration Health</h2>
          <button className="badge" onClick={() => router.push("/integrations")}>Manage</button>
        </div>

        {configuredIntegrations.length === 0 ? (
          <p className="text-sm text-slate-600">No integrations configured yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {configuredIntegrations.map((integration) => {
              const stateLabel =
                integration.status === "CONNECTED"
                  ? "CONNECTED"
                  : integration.status === "ERROR"
                    ? "ERROR"
                    : "DISCONNECTED";
              const metricLabel =
                integration.id === "JIRA"
                  ? `${integration.event_count_24h} tickets synced`
                  : integration.status === "ERROR"
                    ? `Last sync ${formatSyncAge(integration.last_sync_at)}`
                    : `${integration.event_count_24h} events today`;
              const stateColor = integration.status === "ERROR" ? "#ef4444" : integration.status === "CONNECTED" ? "#22c55e" : "#94a3b8";

              return (
                <button
                  key={integration.id}
                  style={{ display: "grid", gridTemplateColumns: "28px 1fr auto auto auto", gap: 10, alignItems: "center", textAlign: "left" }}
                  onClick={() => router.push(`/integrations?integration=${integration.id}`)}
                >
                  <img src={integration.logo_url} alt={integration.name} width={24} height={24} style={{ borderRadius: 6 }} />
                  <span style={{ fontWeight: 600 }}>{integration.name}</span>
                  <span className="badge" style={{ color: stateColor, borderColor: stateColor }}>{stateLabel}</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{metricLabel}</span>
                  <span>{integration.status === "ERROR" ? "⚠" : "✓"}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-3">
        <div className="space-y-3">
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Framework Compliance</h2>
              <span className="risk-low">View All Frameworks</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="card">
                <div className="flex justify-between"><strong>GDPR</strong><strong className="risk-low">92%</strong></div>
                <p className="text-sm text-slate-600">Data Privacy & Rights</p>
                <div className="risk-progress-track mt-2"><div className="risk-progress-fill" style={{ width: "92%" }} /></div>
              </div>
              <div className="card">
                <div className="flex justify-between"><strong>SOC2 Type II</strong><strong className="risk-mid">78%</strong></div>
                <p className="text-sm text-slate-600">Security Trust Criteria</p>
                <div className="risk-progress-track mt-2"><div className="risk-progress-fill warning" style={{ width: "78%" }} /></div>
              </div>
              <div className="card">
                <div className="flex justify-between"><strong>HIPAA</strong><strong className="risk-low">85%</strong></div>
                <p className="text-sm text-slate-600">Healthcare Data Standards</p>
                <div className="risk-progress-track mt-2"><div className="risk-progress-fill" style={{ width: "85%" }} /></div>
              </div>
              <div className="card">
                <div className="flex justify-between"><strong>ISO 42001</strong><strong className="risk-low">100%</strong></div>
                <p className="text-sm text-slate-600">AI Management System</p>
                <div className="risk-progress-track mt-2"><div className="risk-progress-fill" style={{ width: "100%" }} /></div>
              </div>
            </div>
          </div>

          <div className="card table-wrap">
            <div className="card-header">
              <h2 className="font-semibold">Immediate Governance Actions</h2>
              <span className="badge">By Priority</span>
            </div>
            <table className="w-full enterprise-table">
              <tbody>
                <tr>
                  <td>Update Data Residency Policy</td>
                  <td className="text-right"><span className="badge badge-blocked">OVERDUE</span></td>
                </tr>
                <tr>
                  <td>Marketing AI Model Bias Test</td>
                  <td className="text-right"><span className="badge badge-pending">DUE IN 2D</span></td>
                </tr>
                <tr>
                  <td>Appoint AI Ethics Officer</td>
                  <td className="text-right"><span className="badge badge-allow">UPCOMING</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 className="font-semibold mb-2">Risk Heatmap</h2>
          <p className="text-sm text-slate-600">Business Unit Vulnerability</p>
          <div className="heatmap-grid mt-2">
            {Array.from({ length: 16 }).map((_, index) => (
              <span
                key={index}
                className={`heatmap-cell ${
                  index % 5 === 0 ? "high" : index % 3 === 0 ? "mid" : "low"
                }`}
              />
            ))}
          </div>
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span>Engineering (R&D)</span><span className="risk-high">Critical</span></div>
            <div className="flex justify-between"><span>Sales & Marketing</span><span className="risk-mid">Moderate</span></div>
            <div className="flex justify-between"><span>HR & Operations</span><span className="risk-low">Low</span></div>
          </div>
        </div>
      </section>
    </main>
  );
}
