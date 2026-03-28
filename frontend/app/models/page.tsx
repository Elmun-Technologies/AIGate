"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import { apiRequest, apiRequestWithRetry } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type RiskClass = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type ModelStatus = "active" | "deprecated" | "shadow";
type CoverageStatus = "covered" | "partial" | "unprotected";
type SortField = "name" | "provider" | "riskClass" | "coverageStatus" | "lastSeen" | "status";

type RegisteredModel = {
  id: string;
  name: string;
  provider: "OpenAI" | "Anthropic" | "Google" | "Azure" | "Self-hosted";
  version: string;
  riskClass: RiskClass;
  status: ModelStatus;
  description: string;
  registeredAt: string;
  lastSeen: string;
  totalCalls7d: number;
  avgTokensPerCall: number;
  costPer1kTokens: number;
  linkedAgentIds: string[];
  coverageStatus: CoverageStatus;
  sparklineData: Array<{ day: string; avgRisk: number }>;
};

type ToolCall = {
  id: string;
  agent_id: string;
  model: string | null;
  provider: string | null;
  risk_score: number;
  status: string;
  decision_reason: string | null;
  created_at: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: string;
};

type Agent = { id: string; name: string; data_classification: string };
type Policy = { id: string; name: string; yaml_text: string; is_active: boolean };

// ── Constants ──────────────────────────────────────────────────────────────────

const PROVIDER_CATALOG: Record<string, string[]> = {
  OpenAI:    ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1"],
  Anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  Google:    ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"],
};

const RISK_ORDER: Record<RiskClass, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function getRiskColor(r: RiskClass): string {
  return r === "CRITICAL" ? "#ef4444" : r === "HIGH" ? "#f97316" : r === "MEDIUM" ? "#f59e0b" : "#22c55e";
}

function getCoverageColor(c: CoverageStatus): string {
  return c === "covered" ? "#22c55e" : c === "partial" ? "#f59e0b" : "#ef4444";
}

function computeCoverage(version: string, name: string, policies: Policy[]): CoverageStatus {
  const key = (version + " " + name).toLowerCase();
  const active = policies.filter(p => p.is_active && p.yaml_text.toLowerCase().includes(key.split("/").pop() ?? key));
  const inactive = policies.filter(p => !p.is_active && p.yaml_text.toLowerCase().includes(key.split("/").pop() ?? key));
  if (active.length > 0) return "covered";
  if (inactive.length > 0) return "partial";
  return "unprotected";
}

function buildSparkline(modelId: string, toolCalls: ToolCall[]): Array<{ day: string; avgRisk: number }> {
  const days: Record<string, number[]> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days[d.toISOString().slice(0, 10)] = [];
  }
  for (const tc of toolCalls) {
    if ((tc.model ?? tc.provider ?? "") !== modelId) continue;
    const day = tc.created_at.slice(0, 10);
    if (days[day]) days[day].push(tc.risk_score);
  }
  return Object.entries(days).map(([day, scores]) => ({
    day: day.slice(5),
    avgRisk: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
  }));
}

function deriveModelsFromToolCalls(toolCalls: ToolCall[], policies: Policy[]): RegisteredModel[] {
  const map = new Map<string, { tc: ToolCall[]; agents: Set<string> }>();
  for (const tc of toolCalls) {
    const key = tc.model ?? "unknown";
    if (!map.has(key)) map.set(key, { tc: [], agents: new Set() });
    map.get(key)!.tc.push(tc);
    map.get(key)!.agents.add(tc.agent_id);
  }
  const result: RegisteredModel[] = [];
  map.forEach(({ tc, agents }, modelKey) => {
    const sorted = [...tc].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const prov = tc[0].provider ?? "openai";
    const provLabel = prov === "openai" ? "OpenAI" : prov === "anthropic" ? "Anthropic" : prov === "google" ? "Google" : "Self-hosted";
    const tokens = tc.filter(t => t.tokens_in).map(t => (t.tokens_in ?? 0) + (t.tokens_out ?? 0));
    const avgTokens = tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : 512;
    const coverage = computeCoverage(modelKey, modelKey, policies);
    result.push({
      id: uid(),
      name: modelKey,
      provider: provLabel as RegisteredModel["provider"],
      version: modelKey,
      riskClass: "MEDIUM",
      status: "shadow",
      description: `Detected from audit logs — not formally registered`,
      registeredAt: "",
      lastSeen: sorted[0]?.created_at ?? new Date().toISOString(),
      totalCalls7d: tc.length,
      avgTokensPerCall: avgTokens,
      costPer1kTokens: 0.15,
      linkedAgentIds: [...agents],
      coverageStatus: coverage,
      sparklineData: buildSparkline(modelKey, tc),
    });
  });
  return result;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const S = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 } as React.CSSProperties,
  badge: (color: string) => ({
    background: color + "20", color, border: `1px solid ${color}`,
    borderRadius: 9999, fontSize: 10, fontWeight: 700,
    padding: "2px 8px", fontFamily: "monospace", display: "inline-block",
  } as React.CSSProperties),
  th: { padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase" as const, letterSpacing: "0.07em", cursor: "pointer", userSelect: "none" as const, whiteSpace: "nowrap" as const },
  td: { padding: "10px 12px", fontSize: 12, verticalAlign: "middle" as const },
  btn: (color = "#3b82f6") => ({
    background: color, color: "#fff", border: "none",
    borderRadius: 6, padding: "5px 12px", fontSize: 11,
    fontWeight: 700, cursor: "pointer",
  } as React.CSSProperties),
  btnGhost: {
    background: "none", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text-muted)", fontSize: 11,
    padding: "5px 10px", cursor: "pointer", fontFamily: "inherit",
  } as React.CSSProperties,
};

function RiskBadge({ rc }: { rc: RiskClass }) {
  return <span style={S.badge(getRiskColor(rc))}>{rc}</span>;
}

function CoverageBadge({ cs }: { cs: CoverageStatus }) {
  const labels = { covered: "Covered", partial: "Partial", unprotected: "Unprotected" };
  return <span style={S.badge(getCoverageColor(cs))}>{labels[cs]}</span>;
}

function SparklineChart({ data, color = "#3b82f6" }: { data: Array<{ day: string; avgRisk: number }>; color?: string }) {
  return (
    <ResponsiveContainer width={80} height={32}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="avgRisk" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Tooltip
          contentStyle={{ fontSize: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px" }}
          formatter={(v: number) => [`${v}`, "Risk"]}
          labelFormatter={(l: string) => l}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ModelDrawer({
  model,
  onClose,
}: {
  model: RegisteredModel | null;
  onClose: () => void;
}) {
  if (!model) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1200 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <aside style={{ position: "absolute", right: 0, top: 0, height: "100%", width: 380, background: "var(--surface)", borderLeft: "1px solid var(--border)", padding: 16, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 10 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 800 }}>{model.name}</p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{model.provider} · {model.version}</p>
          </div>
          <button style={S.btnGhost} onClick={onClose}>Close</button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <RiskBadge rc={model.riskClass} />
          <CoverageBadge cs={model.coverageStatus} />
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 0 }}>{model.description}</p>
        <div style={{ ...S.card, padding: 12 }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase" }}>Usage</p>
          <p style={{ margin: "2px 0", fontSize: 12 }}>Total calls (7d): <strong>{model.totalCalls7d}</strong></p>
          <p style={{ margin: "2px 0", fontSize: 12 }}>Avg tokens/call: <strong>{model.avgTokensPerCall}</strong></p>
          <p style={{ margin: "2px 0", fontSize: 12 }}>Cost per 1k: <strong>${model.costPer1kTokens.toFixed(2)}</strong></p>
          <div style={{ marginTop: 10 }}>
            <SparklineChart data={model.sparklineData} color="#ef4444" />
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function AppModelsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [models, setModels] = useState<RegisteredModel[]>([]);
  const [selected, setSelected] = useState<RegisteredModel | null>(null);
  const [filterCoverage, setFilterCoverage] = useState<"all" | CoverageStatus>("all");
  const [sortField, setSortField] = useState<SortField>("lastSeen");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [toolCallData, policyData] = await Promise.all([
        apiRequestWithRetry("/tool-calls"),
        apiRequestWithRetry("/policies"),
      ]);
      const tc = (Array.isArray(toolCallData) ? toolCallData : []) as ToolCall[];
      const p = (Array.isArray(policyData) ? policyData : []) as Policy[];
      setToolCalls(tc);
      setPolicies(p);

      const inferred = deriveModelsFromToolCalls(tc, p);
      const normalized = inferred.map((m) => ({ ...m, status: "active" as ModelStatus }));
      if (normalized.length > 0) normalized[0].status = "shadow";
      setModels(normalized);
      localStorage.setItem("agentgate_model_registry_v1", JSON.stringify(normalized));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
      return;
    }
    load();
  }, [router, load]);

  const shadowCount = useMemo(() => models.filter((m) => m.status === "shadow").length, [models]);

  const coverageStats = useMemo(() => ({
    total: models.length,
    covered: models.filter((m) => m.coverageStatus === "covered").length,
    partial: models.filter((m) => m.coverageStatus === "partial").length,
    unprotected: models.filter((m) => m.coverageStatus === "unprotected").length,
  }), [models]);

  const rows = useMemo(() => {
    const base = filterCoverage === "all" ? models : models.filter((m) => m.coverageStatus === filterCoverage);
    const sorted = [...base].sort((a, b) => {
      const factor = sortDir === "asc" ? 1 : -1;
      if (sortField === "name") return a.name.localeCompare(b.name) * factor;
      if (sortField === "provider") return a.provider.localeCompare(b.provider) * factor;
      if (sortField === "riskClass") return (RISK_ORDER[a.riskClass] - RISK_ORDER[b.riskClass]) * factor;
      if (sortField === "coverageStatus") return a.coverageStatus.localeCompare(b.coverageStatus) * factor;
      if (sortField === "status") return a.status.localeCompare(b.status) * factor;
      return a.lastSeen.localeCompare(b.lastSeen) * factor;
    });
    return sorted.sort((a, b) => (a.status === "shadow" ? -1 : 1));
  }, [models, filterCoverage, sortField, sortDir]);

  const setSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  return (
    <main className="container-page" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 900 }}>Model Inventory</h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
            Track deployed LLM models, risk class, and policy coverage
          </p>
        </div>
        <button style={S.btn()} onClick={load}>Refresh</button>
      </div>

      {shadowCount > 0 && (
        <div className="card" style={{ borderColor: "#f59e0b", background: "#f59e0b14" }}>
          <p style={{ margin: 0, fontSize: 12, color: "#f59e0b", fontWeight: 700 }}>
            ⚠ {shadowCount} unregistered models detected in agent activity. Review and classify them to ensure policy coverage.
          </p>
        </div>
      )}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
        <div className="card"><p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>TOTAL MODELS</p><p style={{ margin: "4px 0 0", fontSize: 30, fontWeight: 900, fontFamily: "monospace" }}>{coverageStats.total}</p></div>
        <div className="card"><p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>FULLY COVERED</p><p style={{ margin: "4px 0 0", fontSize: 30, fontWeight: 900, fontFamily: "monospace", color: "#22c55e" }}>{coverageStats.covered}</p></div>
        <div className="card"><p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>PARTIAL</p><p style={{ margin: "4px 0 0", fontSize: 30, fontWeight: 900, fontFamily: "monospace", color: "#f59e0b" }}>{coverageStats.partial}</p></div>
        <button className="card" onClick={() => setFilterCoverage("unprotected")} style={{ textAlign: "left", cursor: "pointer", borderColor: "#ef4444" }}>
          <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>UNPROTECTED</p>
          <p style={{ margin: "4px 0 0", fontSize: 30, fontWeight: 900, fontFamily: "monospace", color: "#ef4444" }}>{coverageStats.unprotected}</p>
        </button>
      </section>

      <div className="card" style={{ padding: 10 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {(["all", "covered", "partial", "unprotected"] as const).map((f) => (
            <button key={f} style={{ ...S.btnGhost, borderColor: filterCoverage === f ? "#3b82f6" : "var(--border)", color: filterCoverage === f ? "#3b82f6" : "var(--text-muted)" }} onClick={() => setFilterCoverage(f)}>{f.toUpperCase()}</button>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={S.th} onClick={() => setSort("name")}>MODEL NAME</th>
                <th style={S.th} onClick={() => setSort("provider")}>PROVIDER</th>
                <th style={S.th}>VERSION</th>
                <th style={S.th} onClick={() => setSort("riskClass")}>RISK CLASS</th>
                <th style={S.th} onClick={() => setSort("coverageStatus")}>POLICY COVERAGE</th>
                <th style={S.th} onClick={() => setSort("status")}>STATUS</th>
                <th style={S.th} onClick={() => setSort("lastSeen")}>LAST SEEN</th>
                <th style={S.th}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid var(--border)", borderLeft: row.status === "shadow" ? "3px solid #f59e0b" : "none" }}>
                  <td style={S.td}><button style={{ background: "none", border: "none", color: "var(--text)", cursor: "pointer", textAlign: "left", padding: 0 }} onClick={() => setSelected(row)}>{row.name}</button></td>
                  <td style={S.td}>{row.provider}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11 }}>{row.version}</td>
                  <td style={S.td}><RiskBadge rc={row.riskClass} /></td>
                  <td style={S.td}><CoverageBadge cs={row.coverageStatus} /></td>
                  <td style={S.td}><span style={S.badge(row.status === "active" ? "#22c55e" : row.status === "deprecated" ? "#64748b" : "#f59e0b")}>{row.status.toUpperCase()}</span></td>
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11 }}>{timeAgo(row.lastSeen)}</td>
                  <td style={S.td}>
                    {row.status === "shadow" ? (
                      <button style={S.btn("#f59e0b")} onClick={() => {
                        setModels((prev) => {
                          const next = prev.map((m) => m.id === row.id ? { ...m, status: "active" as ModelStatus, registeredAt: new Date().toISOString(), description: "Formally registered by security team" } : m);
                          localStorage.setItem("agentgate_model_registry_v1", JSON.stringify(next));
                          return next;
                        });
                      }}>Register Now</button>
                    ) : row.status === "active" ? (
                      <button style={S.btn("#ef4444")} onClick={() => setModels((prev) => prev.map((m) => m.id === row.id ? { ...m, status: "deprecated" as ModelStatus } : m))}>Deprecate</button>
                    ) : (
                      <button style={S.btn("#22c55e")} onClick={() => setModels((prev) => prev.map((m) => m.id === row.id ? { ...m, status: "active" as ModelStatus } : m))}>Restore</button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td style={S.td} colSpan={8}>No models found for this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ModelDrawer model={selected} onClose={() => setSelected(null)} />
    </main>
  );
}
