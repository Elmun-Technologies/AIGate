"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, ResponsiveContainer, Tooltip,
} from "recharts";

import { apiRequestWithRetry } from "@/lib/api";
import RiskTrendChart, { RiskDay } from "@/components/RiskTrendChart";
import {
  calculateIncidentMetrics,
  loadIncidents,
  runAutoIncidentCreation,
} from "@/src/services/incidentService";
import { loadComplianceHealth } from "@/src/services/complianceMonitor";

// ── Types ──────────────────────────────────────────────────────────────────────

type DashboardMetrics = {
  tool_calls_count: number;
  pending_count: number;
  blocked_count: number;
  executed_count: number;
  pending_approvals_count: number;
};

type Agent = {
  id: string;
  name: string;
  data_classification: string;
  status: string;
};

type ToolCall = {
  id: string;
  agent_id: string;
  status: string;
  risk_score: number;
  decision_reason: string;
  created_at: string;
  request_json_redacted?: {
    tool?: string;
  };
};

type LossAssumptions = {
  assumed_incident_cost_usd: number;
  confidence: number;
  high_risk_threshold: number;
  enabled: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function riskBadgeStyle(score: number): React.CSSProperties {
  const bg = score >= 85 ? "#ef444420" : score >= 70 ? "#f59e0b20" : "#22c55e20";
  const color = score >= 85 ? "#ef4444" : score >= 70 ? "#f59e0b" : "#22c55e";
  return {
    background: bg, color, border: `1px solid ${color}`,
    borderRadius: 9999, fontSize: 10, fontWeight: 700,
    padding: "2px 8px", fontFamily: "monospace",
  };
}

function healthColor(score: number) {
  if (score >= 80) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function computeHealthScore(agentId: string, toolCalls: ToolCall[]): number {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = toolCalls.filter(
    (tc) => tc.agent_id === agentId && new Date(tc.created_at).getTime() > cutoff
  );
  const highRisk = recent.filter((tc) => tc.risk_score > 70).length;
  const slaBreaches = recent.filter(
    (tc) => tc.status === "pending" && Date.now() - new Date(tc.created_at).getTime() > 24 * 60 * 60 * 1000
  ).length;
  return Math.max(0, 100 - highRisk * 5 - slaBreaches * 10);
}

function agentSparklineData(agentId: string, toolCalls: ToolCall[]) {
  const days: Record<string, number[]> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days[d.toISOString().slice(0, 10)] = [];
  }
  for (const tc of toolCalls) {
    if (tc.agent_id !== agentId) continue;
    const day = tc.created_at.slice(0, 10);
    if (days[day]) days[day].push(tc.risk_score);
  }
  return Object.entries(days).map(([date, scores]) => ({
    date,
    avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
  }));
}

// ── Empty state card ───────────────────────────────────────────────────────────

function EmptyCard({
  icon, title, body, ctaLabel, ctaHref,
}: { icon: string; title: string; body: string; ctaLabel: string; ctaHref: string }) {
  const router = useRouter();
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", textAlign: "center",
      padding: "32px 24px", gap: 12,
    }}>
      <span style={{ fontSize: 36 }}>{icon}</span>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{title}</p>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", maxWidth: 260, lineHeight: 1.5 }}>{body}</p>
      <button
        onClick={() => router.push(ctaHref)}
        style={{
          marginTop: 4, padding: "7px 18px", borderRadius: 8,
          background: "#3b82f6", color: "#fff", border: "none",
          fontSize: 12, fontWeight: 700, cursor: "pointer",
        }}
      >
        {ctaLabel}
      </button>
    </div>
  );
}

// ── ROI Calculator ─────────────────────────────────────────────────────────────

function RoiCalculator({
  blockedCount,
  assumptions,
}: {
  blockedCount: number;
  assumptions: LossAssumptions;
}) {
  const [platformCost, setPlatformCost] = useState(2000);

  const preventedLoss = useMemo(
    () => Math.round(assumptions.assumed_incident_cost_usd * assumptions.confidence * blockedCount),
    [assumptions, blockedCount]
  );

  const roi = platformCost > 0
    ? Math.round(((preventedLoss - platformCost) / platformCost) * 100)
    : null;

  const row = (label: string, value: string, isTotal = false) => (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "7px 0",
      borderBottom: isTotal ? "none" : "1px solid var(--border)",
      marginBottom: isTotal ? 0 : undefined,
    }}>
      <span style={{ fontSize: 12, color: isTotal ? "var(--text)" : "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: isTotal ? 15 : 13, fontWeight: isTotal ? 800 : 500, fontFamily: "monospace" }}>{value}</span>
    </div>
  );

  return (
    <div>
      {row("Blocked actions this month", String(blockedCount))}
      {row("Assumed cost per incident", `$${assumptions.assumed_incident_cost_usd.toLocaleString()}`)}
      {row("Confidence factor", `${(assumptions.confidence * 100).toFixed(0)}%`)}

      <div style={{ borderTop: "1px solid var(--text-muted)", margin: "8px 0" }} />

      {row("Estimated loss prevented", `$${preventedLoss.toLocaleString()}`, true)}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Platform cost (monthly)</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)", fontFamily: "monospace" }}>$</span>
          <input
            type="number"
            value={platformCost}
            onChange={(e) => setPlatformCost(Math.max(0, parseInt(e.target.value || "0", 10)))}
            style={{
              width: 90, padding: "3px 6px", borderRadius: 6, textAlign: "right",
              background: "var(--surface2)", border: "1px solid var(--border)",
              color: "var(--text)", fontSize: 13, fontFamily: "monospace", outline: "none",
            }}
          />
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--text-muted)", margin: "8px 0" }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Estimated ROI</span>
        <span style={{
          fontSize: 22, fontWeight: 900, fontFamily: "monospace",
          color: roi !== null && roi >= 0 ? "#22c55e" : "#ef4444",
        }}>
          {roi !== null ? `${roi.toLocaleString()}%` : "—"}
        </span>
      </div>

      <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 10, fontFamily: "monospace", lineHeight: 1.5 }}>
        ROI = ((prevented_loss − platform_cost) / platform_cost) × 100
        <br />Assumptions configurable in Settings → General
      </p>
    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [riskDays, setRiskDays] = useState<RiskDay[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [assumptions, setAssumptions] = useState<LossAssumptions>({
    assumed_incident_cost_usd: 25000,
    confidence: 0.35,
    high_risk_threshold: 70,
    enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [incidentTick, setIncidentTick] = useState(0);
  const [complianceTick, setComplianceTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Initial load ────────────────────────────────────────────────────────────

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [m, risk, ag, tc, loss] = await Promise.all([
        apiRequestWithRetry("/dashboard/metrics"),
        apiRequestWithRetry("/dashboard/risk-over-time?days=7"),
        apiRequestWithRetry("/agents"),
        apiRequestWithRetry("/tool-calls"),
        apiRequestWithRetry("/dashboard/loss-assumptions"),
      ]);
      if (m) setMetrics(m as DashboardMetrics);
      setRiskDays((risk as { days?: RiskDay[] })?.days ?? []);
      setAgents(Array.isArray(ag) ? (ag as Agent[]) : []);
      const toolCallRows = Array.isArray(tc) ? (tc as ToolCall[]) : [];
      setToolCalls(toolCallRows);
      if (loss) setAssumptions(loss as LossAssumptions);

      // Trigger auto-incident creation from dashboard context as well,
      // so incident workflow starts without waiting for incidents page open.
      try {
        const raw = localStorage.getItem("agentgate_model_registry_v1");
        const models = raw ? (JSON.parse(raw) as Array<{ id: string; name: string; version: string; status: string; riskClass: string; linkedAgentIds?: string[] }>) : [];
        const shadowCritical = models.filter((m) => m.status === "shadow" && m.riskClass === "CRITICAL");
        await runAutoIncidentCreation(toolCallRows, shadowCritical);
        setIncidentTick((v) => v + 1);
      } catch {
        // no-op
      }
    } catch { /* silent — data stays stale */ }
    finally { if (!silent) setLoading(false); }
  };

  useEffect(() => {
    if (!localStorage.getItem("token")) { router.replace("/login"); return; }
    load();
    // 30-second polling for blocked actions timeline
    pollRef.current = setInterval(() => load(true), 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [router]);

  useEffect(() => {
    const onCompliance = () => setComplianceTick((v) => v + 1);
    window.addEventListener("agentgate:compliance-health-updated", onCompliance);
    return () => window.removeEventListener("agentgate:compliance-health-updated", onCompliance);
  }, []);

  // ── Derived data ────────────────────────────────────────────────────────────

  const blockedCalls = useMemo(
    () => toolCalls.filter((tc) => tc.status === "blocked").slice(0, 20),
    [toolCalls]
  );

  const recentHighRisk = useMemo(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    return toolCalls.filter(
      (tc) => tc.risk_score > (assumptions.high_risk_threshold ?? 70) && new Date(tc.created_at).getTime() > cutoff
    ).length;
  }, [toolCalls, assumptions.high_risk_threshold]);

  const overallStatus = useMemo<"SECURE" | "ELEVATED" | "CRITICAL">(() => {
    if (recentHighRisk === 0) return "SECURE";
    if (recentHighRisk <= 5) return "ELEVATED";
    return "CRITICAL";
  }, [recentHighRisk]);

  const statusStyle: Record<string, React.CSSProperties> = {
    SECURE:   { background: "#22c55e20", color: "#22c55e", border: "1px solid #22c55e" },
    ELEVATED: { background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b" },
    CRITICAL: { background: "#ef444420", color: "#ef4444", border: "1px solid #ef4444" },
  };

  const preventedLoss = useMemo(() => {
    if (!assumptions.enabled) return 0;
    return Math.round(
      assumptions.assumed_incident_cost_usd * assumptions.confidence * (metrics?.blocked_count ?? 0)
    );
  }, [assumptions, metrics]);

  const agentCards = useMemo(() =>
    agents.map((agent) => ({
      agent,
      health: computeHealthScore(agent.id, toolCalls),
      sparkline: agentSparklineData(agent.id, toolCalls),
    })),
  [agents, toolCalls]);

  const agentNameMap = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name])),
    [agents]
  );

  const incidentMetrics = useMemo(() => calculateIncidentMetrics(loadIncidents()), [toolCalls.length, loading, incidentTick]);
  const complianceHealth = useMemo(() => loadComplianceHealth(), [complianceTick]);

  const isEmpty = !loading && metrics?.tool_calls_count === 0 && agents.length === 0;

  // ── Card wrapper ────────────────────────────────────────────────────────────

  const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div className="card" style={style}>{children}</div>
  );

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
      {children}
    </p>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="container-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: "-0.5px" }}>
            Executive Dashboard
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
            AI environment health · auto-refreshes every 30s · {new Date().toLocaleTimeString()}
          </p>
        </div>
        <div
          style={{
            ...statusStyle[overallStatus],
            borderRadius: 9999, padding: "6px 18px",
            fontSize: 13, fontWeight: 800, fontFamily: "monospace",
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "currentColor", display: "inline-block",
            animation: overallStatus !== "SECURE" ? "pulse 1.5s infinite" : "none",
          }} />
          {overallStatus}
        </div>
      </div>

      {/* ── PART 1: Top status bar ─────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        {/* Overall Risk Status */}
        <Card>
          <p style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" }}>
            Overall Risk Status
          </p>
          <div style={{ ...statusStyle[overallStatus], borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 900, fontFamily: "monospace" }}>{overallStatus}</p>
            <p style={{ margin: "3px 0 0", fontSize: 10, opacity: 0.8 }}>
              {recentHighRisk} high-risk in last 1h
            </p>
          </div>
        </Card>

        {/* Active Agents */}
        <Card>
          <p style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>Active Agents</p>
          <p style={{ margin: 0, fontSize: 36, fontWeight: 900, fontFamily: "monospace", lineHeight: 1.1 }}>
            {loading ? "—" : agents.filter((a) => a.status === "active").length}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
            {agents.length} registered total
          </p>
        </Card>

        {/* Blocked Today */}
        <Card>
          <p style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>Blocked Today</p>
          <p style={{ margin: 0, fontSize: 36, fontWeight: 900, fontFamily: "monospace", lineHeight: 1.1, color: "#ef4444" }}>
            {loading ? "—" : (metrics?.blocked_count ?? 0)}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
            of {metrics?.tool_calls_count ?? 0} total calls
          </p>
        </Card>

        {/* MTTC */}
        <Card>
          <p style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>MTTC</p>
          <p style={{ margin: 0, fontSize: 30, fontWeight: 900, fontFamily: "monospace", lineHeight: 1.1, color: "#06b6d4" }}>
            {loading ? "—" : `${incidentMetrics.mttcHours}h`}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
            Mean Time to Contain
          </p>
        </Card>

        {/* MTTR */}
        <Card>
          <p style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>MTTR</p>
          <p style={{ margin: 0, fontSize: 30, fontWeight: 900, fontFamily: "monospace", lineHeight: 1.1, color: "#8b5cf6" }}>
            {loading ? "—" : `${incidentMetrics.mttrHours}h`}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
            Industry avg: 72h
          </p>
        </Card>

        {/* Compliance Health */}
        <Card>
          <p style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>Compliance Health</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            {(complianceHealth.length > 0 ? complianceHealth : [
              { framework_id: "SOC_2", health: "yellow", coverage_percent: 0 },
              { framework_id: "ISO_27001", health: "yellow", coverage_percent: 0 },
              { framework_id: "NIST_AI_RMF", health: "yellow", coverage_percent: 0 },
              { framework_id: "EU_AI_ACT", health: "yellow", coverage_percent: 0 },
            ]).map((item) => {
              const color = item.health === "green" ? "#22c55e" : item.health === "yellow" ? "#f59e0b" : "#ef4444";
              return (
                <div key={item.framework_id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
                  <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>
                    {item.framework_id.replace("_", " ")} {item.coverage_percent ? `${item.coverage_percent}%` : ""}
                  </span>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => router.push("/compliance")}
            style={{ marginTop: 8, background: "none", border: "none", color: "#3b82f6", fontSize: 11, cursor: "pointer", padding: 0, fontFamily: "monospace" }}
          >
            Open compliance mapper →
          </button>
        </Card>

        {/* Prevented Loss */}
        <Card>
          <p style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>
            Prevented Loss (est.)
          </p>
          <p style={{ margin: 0, fontSize: 24, fontWeight: 900, fontFamily: "monospace", lineHeight: 1.1, color: "#22c55e" }}>
            {loading ? "—" : `$${preventedLoss.toLocaleString()}`}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
            ${assumptions.assumed_incident_cost_usd.toLocaleString()} × {(assumptions.confidence * 100).toFixed(0)}% × {metrics?.blocked_count ?? 0}
          </p>
        </Card>
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {isEmpty && (
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <EmptyCard
              icon="🤖" title="No agents registered"
              body="Register your first AI agent to start monitoring tool calls and enforcing policies."
              ctaLabel="Register Agent" ctaHref="/agents"
            />
            <EmptyCard
              icon="📊" title="No activity data"
              body="Run the simulator to generate sample events and see this dashboard come to life."
              ctaLabel="Open Simulator" ctaHref="/simulators"
            />
            <EmptyCard
              icon="🛡" title="No policies active"
              body="Deploy a governance policy to start enforcing rules on every agent tool call."
              ctaLabel="Create Policy" ctaHref="/policies"
            />
          </div>
        </Card>
      )}

      {/* ── Main content grid ─────────────────────────────────────────────── */}
      {!isEmpty && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>

          {/* LEFT column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>

            {/* ── PART 2: Risk Trend Chart ───────────────────────────────── */}
            <Card>
              <SectionTitle>Risk Trend — Last 7 Days</SectionTitle>
              {loading ? (
                <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <p style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "monospace" }}>Loading…</p>
                </div>
              ) : (
                <RiskTrendChart data={riskDays} threshold={assumptions.high_risk_threshold} />
              )}
            </Card>

            {/* ── PART 3: Agent Health Scorecards ──────────────────────── */}
            <Card>
              <SectionTitle>Agent Health Scorecards</SectionTitle>
              {loading ? (
                <p style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "monospace" }}>Loading…</p>
              ) : agentCards.length === 0 ? (
                <EmptyCard
                  icon="🤖" title="No agents yet"
                  body="Register agents to see their health scores here."
                  ctaLabel="Register Agent" ctaHref="/agents"
                />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
                  {agentCards.map(({ agent, health, sparkline }) => {
                    const hColor = healthColor(health);
                    const classification = agent.data_classification;
                    const classColor = classification === "Confidential" || classification === "Restricted"
                      ? "#ef4444" : classification === "Internal" ? "#f59e0b" : "#22c55e";

                    return (
                      <button
                        key={agent.id}
                        onClick={() => router.push(`/audit?agent_id=${agent.id}`)}
                        style={{
                          textAlign: "left", padding: "12px 14px",
                          background: "var(--surface2)",
                          border: `1px solid var(--border)`,
                          borderLeft: `3px solid ${hColor}`,
                          borderRadius: 10, cursor: "pointer",
                          transition: "border-color 0.15s",
                          width: "100%",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = hColor)}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderTopColor = "var(--border)";
                          e.currentTarget.style.borderRightColor = "var(--border)";
                          e.currentTarget.style.borderBottomColor = "var(--border)";
                          e.currentTarget.style.borderLeftColor = hColor;
                        }}
                      >
                        {/* Header */}
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {agent.name}
                            </p>
                            <span style={{
                              fontSize: 9, fontWeight: 700, fontFamily: "monospace",
                              color: classColor, textTransform: "uppercase",
                            }}>
                              {classification}
                            </span>
                          </div>
                          {/* Health score circle */}
                          <div style={{
                            width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                            border: `2.5px solid ${hColor}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: `${hColor}15`,
                          }}>
                            <span style={{ fontSize: 12, fontWeight: 900, fontFamily: "monospace", color: hColor }}>
                              {health}
                            </span>
                          </div>
                        </div>

                        {/* Health bar */}
                        <div style={{ height: 4, borderRadius: 9999, background: "var(--border)", marginBottom: 8 }}>
                          <div style={{
                            height: 4, borderRadius: 9999,
                            width: `${health}%`, background: hColor,
                            transition: "width 0.5s ease",
                          }} />
                        </div>

                        {/* 7-day sparkline */}
                        <div style={{ height: 36, marginBottom: 4 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={sparkline}>
                              <Line
                                type="monotone"
                                dataKey="avg"
                                stroke={hColor}
                                strokeWidth={1.5}
                                dot={false}
                                isAnimationActive={false}
                              />
                              <Tooltip
                                contentStyle={{ fontSize: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4 }}
                                formatter={(v: number) => [`${v}`, "Avg risk"]}
                                labelFormatter={(l: string) => l}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>

                        <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                          Health {health}/100 · tap to audit →
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* ── PART 5: ROI Calculator ────────────────────────────────── */}
            <Card>
              <SectionTitle>Prevented-Loss ROI Calculator</SectionTitle>
              {!loading && (
                <RoiCalculator blockedCount={metrics?.blocked_count ?? 0} assumptions={assumptions} />
              )}
            </Card>
          </div>

          {/* RIGHT column: blocked actions timeline */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <Card style={{ maxHeight: 760, overflowY: "auto" }}>
              {/* ── PART 4: Blocked Actions Timeline ──────────────────── */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Blocked Actions</p>
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                  auto-refreshes 30s
                </span>
              </div>

              {blockedCalls.length === 0 && !loading ? (
                <EmptyCard
                  icon="✅" title="No blocked actions"
                  body="All agent activity is within policy. Run a simulation to test enforcement."
                  ctaLabel="Open Simulator" ctaHref="/simulators"
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {blockedCalls.map((tc, idx) => {
                    const agentName = agentNameMap[tc.agent_id] ?? tc.agent_id.slice(0, 8);
                    const toolName = tc.request_json_redacted?.tool ?? "unknown-tool";
                    const policyHint = tc.decision_reason?.replace(/^(Blocked?:?\s*)/i, "").slice(0, 48) ?? "Policy rule";

                    return (
                      <div
                        key={tc.id}
                        style={{
                          paddingBottom: 12,
                          marginBottom: 12,
                          borderBottom: idx < blockedCalls.length - 1 ? "1px solid var(--border)" : "none",
                        }}
                      >
                        {/* Timestamp + score */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                            {timeAgo(tc.created_at)}
                          </span>
                          <span style={riskBadgeStyle(tc.risk_score)}>
                            {tc.risk_score}
                          </span>
                        </div>

                        {/* Agent + action */}
                        <p style={{ margin: "0 0 3px", fontSize: 12, fontWeight: 700 }}>
                          {agentName}
                          <span style={{ fontWeight: 400, color: "var(--text-muted)" }}> · {toolName}</span>
                        </p>

                        {/* Policy that triggered */}
                        <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", lineHeight: 1.4 }}>
                          ⛔ {policyHint}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </main>
  );
}
