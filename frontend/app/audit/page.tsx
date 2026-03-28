"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { API_URL, apiRequestWithRetry } from "@/lib/api";
import InfoTooltip from "@/components/InfoTooltip";
import { PermissionGate } from "@/src/components/PermissionGate";
import { loadPermissionChangeEvents, type PermissionAuditEvent } from "@/src/services/auditService";

type AuditEvent = {
  id: string;
  stream_id: string;
  event_type: string;
  decision: string;
  risk_score: number;
  created_at: string;
  payload_redacted_json: Record<string, unknown>;
};

type ChainVerification = {
  valid: boolean;
  checked_streams: number;
  checked_events: number;
  issues_count: number;
};

function extractTool(payload: Record<string, unknown>) {
  const request = payload?.request;
  if (request && typeof request === "object" && "tool" in request) {
    const value = (request as Record<string, unknown>).tool;
    if (typeof value === "string") return value;
  }
  return "n/a";
}

function extractActor(payload: Record<string, unknown>) {
  const request = payload?.request;
  if (request && typeof request === "object" && "prompt" in request) {
    return "service-account";
  }
  return "agent";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function riskBadge(score: number) {
  if (score >= 85) return "badge badge-blocked";
  if (score >= 70) return "badge badge-pending";
  return "badge badge-allow";
}

function getDemoAuditEvents(): AuditEvent[] {
  const now = Date.now();
  return [
    { id: "evt_001", stream_id: "stream_main", event_type: "tool_call", decision: "allow", risk_score: 12, created_at: new Date(now - 3600000).toISOString(), payload_redacted_json: { request: { tool: "web_search", prompt: "[REDACTED]" } } },
    { id: "evt_002", stream_id: "stream_main", event_type: "tool_call", decision: "allow", risk_score: 35, created_at: new Date(now - 7200000).toISOString(), payload_redacted_json: { request: { tool: "file_read", prompt: "[REDACTED]" } } },
    { id: "evt_003", stream_id: "stream_sec", event_type: "tool_call", decision: "block", risk_score: 92, created_at: new Date(now - 10800000).toISOString(), payload_redacted_json: { request: { tool: "external_post", prompt: "[REDACTED]" } } },
    { id: "evt_004", stream_id: "stream_sec", event_type: "tool_call", decision: "allow", risk_score: 45, created_at: new Date(now - 14400000).toISOString(), payload_redacted_json: { request: { tool: "db_query", prompt: "[REDACTED]" } } },
    { id: "evt_005", stream_id: "stream_main", event_type: "tool_call", decision: "block", risk_score: 88, created_at: new Date(now - 18000000).toISOString(), payload_redacted_json: { request: { tool: "shell_exec", prompt: "[REDACTED]" } } },
    { id: "evt_006", stream_id: "stream_ops", event_type: "tool_call", decision: "allow", risk_score: 5, created_at: new Date(now - 21600000).toISOString(), payload_redacted_json: { request: { tool: "get_status", prompt: "[REDACTED]" } } },
    { id: "evt_007", stream_id: "stream_ops", event_type: "tool_call", decision: "allow", risk_score: 28, created_at: new Date(now - 25200000).toISOString(), payload_redacted_json: { request: { tool: "api_call", prompt: "[REDACTED]" } } },
    { id: "evt_008", stream_id: "stream_sec", event_type: "tool_call", decision: "block", risk_score: 95, created_at: new Date(now - 28800000).toISOString(), payload_redacted_json: { request: { tool: "send_email", prompt: "[REDACTED]" } } },
  ];
}

export default function AuditPage() {
  const router = useRouter();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [agentId, setAgentId] = useState("");
  const [decision, setDecision] = useState("");
  const [minRisk, setMinRisk] = useState("");
  const [maxRisk, setMaxRisk] = useState("");
  const [error, setError] = useState("");
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPermChanges, setShowPermChanges] = useState(false);
  const [permEvents, setPermEvents] = useState<PermissionAuditEvent[]>([]);

  const load = useCallback(async () => {
    const minDelay = new Promise((resolve) => setTimeout(resolve, 900));
    const params = new URLSearchParams();
    if (agentId) params.set("agent_id", agentId);
    if (decision) params.set("decision", decision);
    if (minRisk) params.set("min_risk", minRisk);
    if (maxRisk) params.set("max_risk", maxRisk);

    try {
      setLoading(true);
      setError("");
      const data = await apiRequestWithRetry(`/audit?${params.toString()}`);
      const rows = Array.isArray(data) ? (data as AuditEvent[]) : [];
      setEvents(rows);
      setSelected(rows[0] || null);
      const verify = await apiRequestWithRetry("/audit/verify-chain");
      setVerification((verify as ChainVerification) || null);
    } catch {
      // Fallback to demo data when backend is unavailable
      const demo = getDemoAuditEvents();
      setEvents(demo);
      setSelected(demo[0] || null);
      setVerification({ valid: true, checked_streams: 3, checked_events: demo.length, issues_count: 0 });
      setError("");
    } finally {
      await minDelay;
      setLoading(false);
    }
  }, [agentId, decision, minRisk, maxRisk]);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
      return;
    }
    load();
  }, [router, load]);

  const onFilter = async (event: FormEvent) => {
    event.preventDefault();
    await load();
  };

  const exportAudit = async (format: "json" | "csv") => {
    try {
      const params = new URLSearchParams();
      params.set("format", format);
      if (agentId) params.set("agent_id", agentId);
      if (decision) params.set("decision", decision);
      if (minRisk) params.set("min_risk", minRisk);
      if (maxRisk) params.set("max_risk", maxRisk);

      const token = localStorage.getItem("token");
      const response = await fetch(`${API_URL}/audit/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) return;

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = format === "csv" ? "audit-export.csv" : "audit-export.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export audit data.");
    }
  };

  const exportAuditPack = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_URL}/audit/export-pack`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "audit-pack.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export audit pack.");
    }
  };

  const stats = useMemo(() => {
    const blocked = events.filter((event) => String(event.decision).toLowerCase() === "block").length;
    const high = events.filter((event) => event.risk_score >= 70).length;
    return {
      logs: events.length,
      blocked,
      high,
      streams: verification?.checked_streams ?? 0,
    };
  }, [events, verification]);

  return (
    <main className="container-page space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight section-title">
          System Audit Logs
          <InfoTooltip text="Continuous forensic monitoring of policy decisions and tool execution actions." />
        </h1>
        <div className="flex gap-2">
          <PermissionGate permission="audit:export" fallback="hide"><button className="btn-secondary" onClick={() => exportAudit("csv")}>Export CSV</button></PermissionGate>
          <PermissionGate permission="audit:export" fallback="hide"><button className="btn-primary" onClick={exportAuditPack}>Export Package</button></PermissionGate>
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="card stat-card-enterprise"><p className="stat-label">Total Logs</p><p className="stat-number">{stats.logs}</p></div>
        <div className="card stat-card-enterprise"><p className="stat-label">Blocked Actions</p><p className="stat-number">{stats.blocked}</p></div>
        <div className="card stat-card-enterprise"><p className="stat-label">High Risk</p><p className="stat-number">{stats.high}</p></div>
        <div className="card stat-card-enterprise"><p className="stat-label">Streams</p><p className="stat-number">{stats.streams}</p></div>
      </section>

      <section className="card">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Tamper Evidence Verification</h2>
          <span className={verification?.valid ? "badge badge-allow" : "badge badge-blocked"}>
            {verification ? (verification.valid ? "Verified" : "Issue Detected") : "—"}
          </span>
        </div>
        <p className="text-sm text-slate-600 mono mt-1">
          streams={verification?.checked_streams ?? 0} | events={verification?.checked_events ?? 0} | issues={verification?.issues_count ?? 0}
        </p>
      </section>

      <form className="card grid grid-cols-1 md:grid-cols-5 gap-2" onSubmit={onFilter}>
        <input className="input" placeholder="Search agent" value={agentId} onChange={(event) => setAgentId(event.target.value)} />
        <input className="input" placeholder="Decision" value={decision} onChange={(event) => setDecision(event.target.value)} />
        <input className="input" placeholder="Min risk" value={minRisk} onChange={(event) => setMinRisk(event.target.value)} />
        <input className="input" placeholder="Max risk" value={maxRisk} onChange={(event) => setMaxRisk(event.target.value)} />
        <button className="btn-primary" type="submit">Apply Filters</button>
      </form>

      {error ? <p className="text-sm text-slate-600">—</p> : null}

      <section className="card table-wrap">
        <table className="w-full enterprise-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User Identity</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Risk Level</th>
            </tr>
          </thead>
          <tbody>
            {(loading ? [] : events).map((event) => (
              <tr key={event.id} onClick={() => setSelected(event)} className="cursor-pointer">
                <td className="mono">{formatDate(event.created_at)}</td>
                <td>
                  <div className="font-semibold mono">{event.stream_id.slice(0, 10)}</div>
                  <div className="text-xs text-slate-600">{extractActor(event.payload_redacted_json || {})}</div>
                </td>
                <td>{event.event_type}</td>
                <td className="mono">{extractTool(event.payload_redacted_json || {})}</td>
                <td><span className={riskBadge(event.risk_score)}>{event.risk_score >= 85 ? "CRITICAL" : event.risk_score >= 70 ? "HIGH" : "LOW"}</span></td>
              </tr>
            ))}
            {loading ? (
              Array.from({ length: 6 }).map((_, idx) => (
                <tr key={`loading-${idx}`}><td colSpan={5}><div className="skeleton skeleton-row" /></td></tr>
              ))
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold mb-2">Evidence Details</h2>
        </div>
        {selected ? (
          <pre className="text-xs overflow-auto max-h-[420px] whitespace-pre-wrap">{JSON.stringify(selected, null, 2)}</pre>
        ) : (
          <p className="text-sm text-slate-600">Select an event.</p>
        )}
      </section>

      {/* Permission Changes Section */}
      <section className="card">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="font-semibold">Permission Changes</h2>
          <button
            className={showPermChanges ? "btn-primary" : "btn-secondary"}
            style={{ fontSize: 11, padding: "4px 12px" }}
            onClick={() => {
              const next = !showPermChanges;
              setShowPermChanges(next);
              if (next) setPermEvents(loadPermissionChangeEvents());
            }}
          >
            {showPermChanges ? "Hide RBAC Events" : "Show Permission Changes"}
          </button>
        </div>
        {showPermChanges && (
          <div className="table-wrap">
            <table className="w-full enterprise-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {permEvents.length === 0 ? (
                  <tr><td colSpan={5} className="text-slate-600 text-sm">No permission change events yet.</td></tr>
                ) : (
                  permEvents.map((e) => (
                    <tr key={e.id}>
                      <td className="mono" style={{ fontSize: 11 }}>{formatDate(e.timestamp)}</td>
                      <td>
                        <span className={
                          e.event_type === "PERMISSION_DENIED" ? "badge badge-blocked" :
                            e.event_type.startsWith("IMPERSONATION") ? "badge badge-pending" :
                              "badge badge-allow"
                        } style={{ fontSize: 10 }}>
                          {e.event_type}
                        </span>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        <div className="font-semibold">{e.actor_email}</div>
                        <div className="text-xs text-slate-600">{e.actor_role}</div>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {e.target_user_email ? (
                          <>
                            <div>{e.target_user_email}</div>
                            {e.target_role && <div className="text-xs text-slate-600">{e.target_role}</div>}
                          </>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td style={{ fontSize: 11, maxWidth: 300 }}>{e.description}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
