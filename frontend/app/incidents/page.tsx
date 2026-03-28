"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequestWithRetry } from "@/lib/api";
import {
  assignIncidentTo,
  attemptResolveIncident,
  calculateIncidentMetrics,
  escalateToPagerDuty,
  linkJiraTicketManually,
  loadIncidents,
  runAutoIncidentCreation,
  setIncidentStatus,
  syncIncidentsWithIntegrations,
  toggleChecklistItem,
} from "@/src/services/incidentService";
import { simulatePagerDutyAck } from "@/src/services/pagerdutyService";
import { markMockJiraDone } from "@/src/services/jiraService";
import type { Incident } from "@/src/types/incident";
import { PermissionGate } from "@/src/components/PermissionGate";

type ToolCall = {
  id: string;
  agent_id: string;
  risk_score: number;
  status: string;
  decision_reason?: string | null;
  created_at: string;
  request_json_redacted?: { tool?: string };
};

type Agent = { id: string; name: string; data_classification: string };

type ModelSnapshot = {
  id: string;
  name: string;
  version: string;
  status: string;
  riskClass: string;
  linkedAgentIds?: string[];
};

const severityWeight = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as const;

function statusBadge(status: Incident["status"]): React.CSSProperties {
  if (status === "OPEN") return { background: "#ef444420", color: "#ef4444", border: "1px solid #ef4444" };
  if (status === "INVESTIGATING") return { background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b" };
  if (status === "CONTAINED") return { background: "#3b82f620", color: "#3b82f6", border: "1px solid #3b82f6" };
  return { background: "#22c55e20", color: "#22c55e", border: "1px solid #22c55e" };
}

function severityBadge(severity: Incident["severity"]): React.CSSProperties {
  if (severity === "CRITICAL") return { background: "#ef444420", color: "#ef4444", border: "1px solid #ef4444" };
  if (severity === "HIGH") return { background: "#f9731620", color: "#f97316", border: "1px solid #f97316" };
  if (severity === "MEDIUM") return { background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b" };
  return { background: "#22c55e20", color: "#22c55e", border: "1px solid #22c55e" };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function requiredProgress(incident: Incident) {
  const required = incident.containment_checklist.filter((c) => c.required);
  const done = required.filter((c) => c.completed);
  return { done: done.length, total: required.length };
}

function loadShadowCriticalModels(): ModelSnapshot[] {
  try {
    const raw = localStorage.getItem("agentgate_model_registry_v1");
    if (!raw) return [];
    const models = JSON.parse(raw) as ModelSnapshot[];
    return models.filter((m) => m.status === "shadow" && m.riskClass === "CRITICAL");
  } catch {
    return [];
  }
}

export default function IncidentsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jiraManualKey, setJiraManualKey] = useState("");

  const me = useMemo(() => {
    try {
      const raw = localStorage.getItem("user");
      if (!raw) return "security-analyst@company.com";
      return (JSON.parse(raw) as { email?: string }).email ?? "security-analyst@company.com";
    } catch {
      return "security-analyst@company.com";
    }
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [toolCallsData, agentsData] = await Promise.all([
        apiRequestWithRetry("/tool-calls"),
        apiRequestWithRetry("/agents"),
      ]);
      const toolCalls = (Array.isArray(toolCallsData) ? toolCallsData : []) as ToolCall[];
      const agentList = (Array.isArray(agentsData) ? agentsData : []) as Agent[];
      setAgents(agentList);

      const shadowCritical = loadShadowCriticalModels();
      await runAutoIncidentCreation(toolCalls, shadowCritical);
      const synced = await syncIncidentsWithIntegrations();
      setIncidents(synced);
    } catch {
      setIncidents(loadIncidents());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
      return;
    }

    load();
    const onUpdated = () => setIncidents(loadIncidents());
    window.addEventListener("agentgate:incidents-updated", onUpdated);

    // Jira sync every 5 minutes
    const syncTimer = window.setInterval(async () => {
      const synced = await syncIncidentsWithIntegrations();
      setIncidents(synced);
    }, 5 * 60 * 1000);

    return () => {
      window.removeEventListener("agentgate:incidents-updated", onUpdated);
      window.clearInterval(syncTimer);
    };
  }, [router]);

  const sorted = useMemo(() => {
    return [...incidents].sort((a, b) => {
      const sev = severityWeight[b.severity] - severityWeight[a.severity];
      if (sev !== 0) return sev;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [incidents]);

  const selected = useMemo(
    () => sorted.find((i) => i.id === selectedId) ?? sorted[0] ?? null,
    [sorted, selectedId]
  );

  const summary = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      OPEN: incidents.filter((i) => i.status === "OPEN").length,
      INVESTIGATING: incidents.filter((i) => i.status === "INVESTIGATING").length,
      CONTAINED: incidents.filter((i) => i.status === "CONTAINED").length,
      RESOLVED_WEEK: incidents.filter((i) => i.status === "RESOLVED" && i.resolved_at && new Date(i.resolved_at).getTime() >= weekAgo).length,
    };
  }, [incidents]);

  const metrics = useMemo(() => calculateIncidentMetrics(incidents), [incidents]);

  const agentNameMap = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents]);

  return (
    <main className="container-page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Incident Response Workflow</h1>
          <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
            Structured response from detection to containment to resolution
          </p>
        </div>
        <button onClick={load} style={{ background: "#3b82f6", border: "none", color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: 12, padding: "7px 14px", cursor: "pointer" }}>
          Refresh
        </button>
      </div>

      {/* Summary Bar */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8 }}>
        {[
          ["OPEN", summary.OPEN, "#ef4444"],
          ["INVESTIGATING", summary.INVESTIGATING, "#f59e0b"],
          ["CONTAINED", summary.CONTAINED, "#3b82f6"],
          ["RESOLVED THIS WEEK", summary.RESOLVED_WEEK, "#22c55e"],
          ["MTTC (hrs)", metrics.mttcHours, "#06b6d4"],
          ["MTTR (hrs)", metrics.mttrHours, "#8b5cf6"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="card" style={{ borderLeft: `3px solid ${color}`, padding: "10px 12px" }}>
            <p style={{ margin: 0, fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", textTransform: "uppercase" }}>{label}</p>
            <p style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 900, fontFamily: "monospace", color: String(color) }}>{String(value)}</p>
          </div>
        ))}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: 12 }}>
        {/* List view */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
            <p style={{ margin: 0, fontWeight: 700 }}>Incidents</p>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{sorted.length} total</span>
          </div>
          <div style={{ maxHeight: 620, overflowY: "auto" }}>
            {loading ? (
              <p style={{ padding: 16, color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>Loading incidents…</p>
            ) : sorted.length === 0 ? (
              <p style={{ padding: 16, color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>No incidents yet.</p>
            ) : (
              sorted.map((incident) => {
                const progress = requiredProgress(incident);
                const active = selected?.id === incident.id;
                return (
                  <button
                    key={incident.id}
                    onClick={() => setSelectedId(incident.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      background: active ? "var(--surface2)" : "transparent",
                      borderBottom: "1px solid var(--border)",
                      padding: "10px 14px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, lineHeight: 1.4 }}>{incident.title}</p>
                      <span style={{ ...severityBadge(incident.severity), borderRadius: 9999, fontSize: 10, fontWeight: 700, padding: "1px 7px", fontFamily: "monospace", flexShrink: 0 }}>{incident.severity}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                      <span style={{ ...statusBadge(incident.status), borderRadius: 9999, fontSize: 10, fontWeight: 700, padding: "1px 7px", fontFamily: "monospace" }}>{incident.status}</span>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{timeAgo(incident.created_at)}</span>
                    </div>
                    <div style={{ marginTop: 7 }}>
                      <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                        Required checklist progress: {progress.done}/{progress.total}
                      </p>
                      <div style={{ marginTop: 4, height: 4, borderRadius: 9999, background: "var(--border)" }}>
                        <div style={{ height: 4, borderRadius: 9999, width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: progress.done === progress.total ? "#22c55e" : "#f59e0b" }} />
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Detail view */}
        <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 0.85fr", gap: 12 }}>
          {!selected ? (
            <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>Select an incident to view details.</p>
          ) : (
            <>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{selected.title}</h2>
                <p style={{ margin: "4px 0 10px", fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                  Incident ID: {selected.id}
                </p>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  <span style={{ ...severityBadge(selected.severity), borderRadius: 9999, fontSize: 10, fontWeight: 700, padding: "2px 8px", fontFamily: "monospace" }}>{selected.severity}</span>
                  <span style={{ ...statusBadge(selected.status), borderRadius: 9999, fontSize: 10, fontWeight: 700, padding: "2px 8px", fontFamily: "monospace" }}>{selected.status}</span>
                  {selected.jira_ticket_id ? <span style={{ border: "1px solid var(--border)", borderRadius: 9999, fontSize: 10, padding: "2px 8px", fontFamily: "monospace" }}>Jira: {selected.jira_ticket_id}</span> : null}
                  {selected.pagerduty_incident_id ? <span style={{ border: "1px solid var(--border)", borderRadius: 9999, fontSize: 10, padding: "2px 8px", fontFamily: "monospace" }}>PD: {selected.pagerduty_incident_id}</span> : null}
                </div>

                {/* Metadata */}
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                  <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase" }}>Triggered By</p>
                  <p style={{ margin: "6px 0 0", fontSize: 12 }}><strong>Agent:</strong> {agentNameMap[selected.triggered_by.agent_id] ?? selected.triggered_by.agent_id}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12 }}><strong>Action:</strong> {selected.triggered_by.action_type}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12 }}><strong>Risk:</strong> {selected.triggered_by.risk_score}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12 }}><strong>Policy:</strong> {selected.triggered_by.policy_triggered}</p>
                </div>

                {/* Checklist */}
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                  <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase" }}>Containment Checklist</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                    {selected.containment_checklist.map((item) => (
                      <label key={item.id} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 8, alignItems: "start", fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={item.completed}
                          onChange={(e) => {
                            const next = toggleChecklistItem(selected.id, item.id, me, e.target.checked);
                            setIncidents(next);
                          }}
                        />
                        <span style={{ color: item.completed ? "#22c55e" : "var(--text)", textDecoration: item.completed ? "line-through" : "none" }}>
                          {item.required ? "[required] " : ""}{item.label}
                          {item.completed_at ? (
                            <span style={{ display: "block", marginTop: 2, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                              completed by {item.completed_by} · {new Date(item.completed_at).toLocaleString()}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                    onClick={() => {
                      const next = assignIncidentTo(selected.id, me, me);
                      setIncidents(next);
                    }}
                  >
                    Assign to me
                  </button>

                  <button
                    style={{ background: "#f59e0b", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                    onClick={async () => {
                      const next = await escalateToPagerDuty(selected.id, me, `${window.location.origin}/incidents`);
                      setIncidents(next);
                    }}
                  >
                    Escalate to PagerDuty
                  </button>

                  {selected.pagerduty_incident_id ? (
                    <button
                      style={{ background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                      onClick={async () => {
                        simulatePagerDutyAck(selected.pagerduty_incident_id!);
                        const synced = await syncIncidentsWithIntegrations();
                        setIncidents(synced);
                      }}
                    >
                      Simulate Ack
                    </button>
                  ) : null}

                  <button
                    style={{ background: "#06b6d4", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                    onClick={() => {
                      const statusCycle: Incident["status"][] = ["OPEN", "INVESTIGATING", "CONTAINED"];
                      const idx = statusCycle.indexOf(selected.status as Incident["status"]);
                      const nextStatus = statusCycle[Math.min(statusCycle.length - 1, idx + 1)] ?? "CONTAINED";
                      const next = setIncidentStatus(selected.id, nextStatus, me, `Status changed to ${nextStatus}`);
                      setIncidents(next);
                    }}
                  >
                    Advance Status
                  </button>

                  <PermissionGate permission="incidents:resolve" fallback="disable">
                    <button
                      style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", opacity: requiredProgress(selected).done === requiredProgress(selected).total ? 1 : 0.5 }}
                      disabled={requiredProgress(selected).done !== requiredProgress(selected).total}
                      onClick={() => {
                        const out = attemptResolveIncident(selected.id, me);
                        setIncidents(out.incidents);
                      }}
                    >
                      Mark as Resolved
                    </button>
                  </PermissionGate>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                  <input
                    placeholder="SEC-142"
                    value={jiraManualKey}
                    onChange={(e) => setJiraManualKey(e.target.value)}
                    style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: 11, padding: "6px 8px", width: 110 }}
                  />
                  <button
                    style={{ background: "none", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 6, padding: "6px 10px", fontSize: 11, cursor: "pointer" }}
                    onClick={() => {
                      if (!jiraManualKey.trim()) return;
                      const next = linkJiraTicketManually(selected.id, jiraManualKey.trim(), me);
                      setIncidents(next);
                      setJiraManualKey("");
                    }}
                  >
                    Link Jira Ticket manually
                  </button>

                  {selected.jira_ticket_id ? (
                    <button
                      style={{ background: "none", border: "1px solid #8b5cf6", color: "#8b5cf6", borderRadius: 6, padding: "6px 10px", fontSize: 11, cursor: "pointer" }}
                      onClick={async () => {
                        markMockJiraDone(selected.jira_ticket_id!);
                        const synced = await syncIncidentsWithIntegrations();
                        setIncidents(synced);
                      }}
                    >
                      Simulate Jira Done
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Immutable timeline */}
              <aside style={{ borderLeft: "1px solid var(--border)", paddingLeft: 10, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>Timeline (immutable)</p>
                <p style={{ margin: "4px 0 8px", fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                  Append-only legal evidence log
                </p>
                <div style={{ maxHeight: 560, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  {[...selected.timeline]
                    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
                    .map((event) => (
                      <div key={event.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--surface2)" }}>
                        <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                          {new Date(event.timestamp).toLocaleString()} · {event.actor}
                        </p>
                        <p style={{ margin: "3px 0 0", fontSize: 11, fontFamily: "monospace", color: "#3b82f6" }}>{event.event_type}</p>
                        <p style={{ margin: "3px 0 0", fontSize: 12, lineHeight: 1.4 }}>{event.description}</p>
                      </div>
                    ))}
                </div>
              </aside>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
