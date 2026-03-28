"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest, apiRequestWithRetry } from "@/lib/api";
import InfoTooltip from "@/components/InfoTooltip";
import { PermissionGate } from "@/src/components/PermissionGate";
import {
  handleSlaBreachNotification,
  sendEarlyWarningAlert,
  loadEscalationConfig,
} from "@/lib/notificationService";

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskFactor = {
  name: string;
  explanation: string;
  contribution: number;
};

type Approval = {
  id: string;
  tool_call_id: string;
  status: string;
  reason: string | null;
  created_at: string;
  resolved_at: string | null;
  risk_score: number;
  decision_reason: string | null;
  tool_name: string | null;
  destination_domain: string | null;
  risk_breakdown: RiskFactor[] | null;
  payload_preview?: {
    redacted?: {
      prompt?: string;
      args?: Record<string, unknown>;
    };
  } | null;
};

type AutoAction = {
  id: string;
  type: "approved" | "denied";
  tool_name: string;
  risk_score: number;
  timestamp: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SLA_MS = 24 * 60 * 60 * 1000; // 24 hours
const AUTO_APPROVE_THRESHOLD = 30;
const AUTO_DENY_THRESHOLD = 90;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function riskColor(score: number) {
  if (score <= 30) return "badge-allow";
  if (score <= 69) return "badge-pending";
  return "badge-blocked";
}

function riskLabel(score: number) {
  if (score <= 30) return "LOW RISK";
  if (score <= 69) return "MED RISK";
  if (score <= 89) return "HIGH RISK";
  return "CRITICAL";
}

function riskBarColor(score: number) {
  if (score <= 30) return "var(--accent-green, #22c55e)";
  if (score <= 69) return "var(--accent-yellow, #f59e0b)";
  return "var(--accent-red, #ef4444)";
}

function getRemainingMs(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  const deadline = created + SLA_MS;
  return deadline - Date.now();
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

// ─── SLA Timer component (live per card) ─────────────────────────────────────

function SlaTimer({ createdAt }: { createdAt: string }) {
  const [ms, setMs] = useState(() => getRemainingMs(createdAt));

  useEffect(() => {
    const id = setInterval(() => setMs(getRemainingMs(createdAt)), 1000);
    return () => clearInterval(id);
  }, [createdAt]);

  const escalated = ms <= 0;
  const urgent = !escalated && ms < 2 * 60 * 60 * 1000; // < 2h

  if (escalated) {
    return (
      <span className="badge badge-blocked" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.05em" }}>
        ESCALATED
      </span>
    );
  }

  return (
    <span
      className={`badge ${urgent ? "badge-pending" : ""}`}
      style={{
        fontVariantNumeric: "tabular-nums",
        fontFamily: "monospace",
        background: urgent ? undefined : "var(--surface2)",
        color: urgent ? undefined : "var(--text-muted)",
      }}
      title="SLA countdown (24h)"
    >
      SLA {formatCountdown(ms)}
    </span>
  );
}

// ─── Risk breakdown mini bar ──────────────────────────────────────────────────

function RiskBreakdown({ factors }: { factors: RiskFactor[] }) {
  const sorted = [...factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 4);
  return (
    <div className="space-y-1 mt-2">
      {sorted.map((f) => (
        <div key={f.name} className="flex items-center gap-2">
          <span className="text-xs text-slate-500 mono w-28 shrink-0 truncate">{f.name.replace(/_/g, " ")}</span>
          <div className="flex-1 h-1.5 rounded-full" style={{ background: "var(--surface2)" }}>
            <div
              className="h-1.5 rounded-full transition-all"
              style={{
                width: `${Math.min(100, Math.abs(f.contribution) * 2)}%`,
                background: f.contribution > 0 ? "var(--accent-red,#ef4444)" : "var(--accent-green,#22c55e)",
              }}
            />
          </div>
          <span className={`text-xs mono w-10 text-right ${f.contribution > 0 ? "text-red-500" : "text-emerald-500"}`}>
            {f.contribution > 0 ? "+" : ""}{f.contribution}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const router = useRouter();

  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"pending" | "high" | "escalated">("pending");
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string>("");
  const [autoActions, setAutoActions] = useState<AutoAction[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);

  // Track which IDs we have already auto-processed this session
  const autoProcessed = useRef<Set<string>>(new Set());
  // Track which IDs have already had an SLA breach notification fired
  const breachNotified = useRef<Set<string>>(new Set());
  // Track which IDs have already had an early-warning notification fired
  const earlyWarnNotified = useRef<Set<string>>(new Set());

  // ── Load approvals ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiRequestWithRetry("/approvals?status=pending");
      setApprovals(Array.isArray(data) ? (data as Approval[]) : []);
    } catch {
      setError("Failed to load approvals. Please try again.");
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

  // ── Auto-routing engine ─────────────────────────────────────────────────────

  useEffect(() => {
    if (loading || autoRunning) return;

    const toProcess = approvals.filter((a) => {
      if (autoProcessed.current.has(a.id)) return false;
      return a.risk_score < AUTO_APPROVE_THRESHOLD || a.risk_score > AUTO_DENY_THRESHOLD;
    });

    if (!toProcess.length) return;

    setAutoRunning(true);
    let cancelled = false;

    (async () => {
      for (const approval of toProcess) {
        if (cancelled) break;
        autoProcessed.current.add(approval.id);

        const isApprove = approval.risk_score < AUTO_APPROVE_THRESHOLD;
        const type = isApprove ? "approve" : "reject";
        const reason = isApprove
          ? "Auto-approved: low risk"
          : "Auto-denied: critical risk threshold exceeded";

        try {
          await apiRequest(`/approvals/${approval.id}/${type}`, {
            method: "POST",
            body: JSON.stringify({ reason }),
          });

          setAutoActions((prev) => [
            {
              id: approval.id,
              type: isApprove ? "approved" : "denied",
              tool_name: approval.tool_name ?? "unknown",
              risk_score: approval.risk_score,
              timestamp: Date.now(),
            },
            ...prev.slice(0, 49), // keep last 50
          ]);

          // Small delay between actions to avoid hammering the API
          await new Promise((r) => setTimeout(r, 300));
        } catch {
          // If auto-action fails, remove from processed so it can retry next cycle
          autoProcessed.current.delete(approval.id);
        }
      }

      if (!cancelled) {
        await load();
        localStorage.setItem("gateway:refresh-at", String(Date.now()));
        window.dispatchEvent(new CustomEvent("gateway:refresh"));
        setAutoRunning(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [approvals, loading, autoRunning, load]);

  // ── SLA breach + early-warning scanner (runs every 60 s) ───────────────────

  useEffect(() => {
    if (!approvals.length) return;

    const scan = () => {
      const cfg = loadEscalationConfig();
      const SLA_MS_LOCAL = 24 * 60 * 60 * 1000;
      const EARLY_WARN_MS = SLA_MS_LOCAL * 0.75; // 18 h

      for (const approval of approvals) {
        const created = new Date(approval.created_at).getTime();
        const elapsed = Date.now() - created;
        const remaining = SLA_MS_LOCAL - elapsed;

        // ── SLA breach ──────────────────────────────────────────────────────
        if (remaining <= 0 && !breachNotified.current.has(approval.id)) {
          breachNotified.current.add(approval.id);
          handleSlaBreachNotification(approval, Math.abs(remaining)).catch(console.error);
        }

        // ── Early warning (75 % elapsed = 25 % remaining) ──────────────────
        if (
          cfg.notify_early_warning &&
          elapsed >= EARLY_WARN_MS &&
          remaining > 0 &&
          !earlyWarnNotified.current.has(approval.id)
        ) {
          earlyWarnNotified.current.add(approval.id);
          sendEarlyWarningAlert({
            id: approval.id,
            tool_name: approval.tool_name,
            risk_score: approval.risk_score,
            action_type: approval.tool_name ?? "unknown",
            time_remaining_ms: remaining,
          });
        }
      }
    };

    scan(); // run immediately on mount / data change
    const id = window.setInterval(scan, 60_000); // then every 60 s
    return () => window.clearInterval(id);
  }, [approvals]);

  // ── Manual approve / deny ───────────────────────────────────────────────────

  const action = async (id: string, type: "approve" | "reject") => {
    const reason = reasonById[id] || (type === "approve" ? "Approved via queue" : "Denied via queue");
    setError("");
    setBusyId(id);
    try {
      await apiRequest(`/approvals/${id}/${type}`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await load();
      localStorage.setItem("gateway:refresh-at", String(Date.now()));
      window.dispatchEvent(new CustomEvent("gateway:refresh"));
    } catch {
      setError("Failed to process approval. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  // ── Derived stats ───────────────────────────────────────────────────────────

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const stats = useMemo(() => {
    const autoApprovedToday = autoActions.filter(
      (a) => a.type === "approved" && a.timestamp >= todayStart
    ).length;
    const escalated = approvals.filter((a) => getRemainingMs(a.created_at) <= 0).length;
    const pending = approvals.length;
    return { autoApprovedToday, escalated, pending };
  }, [autoActions, approvals, todayStart]);

  // ── Filtered list ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (tab === "high") return approvals.filter((a) => a.risk_score >= 70);
    if (tab === "escalated") return approvals.filter((a) => getRemainingMs(a.created_at) <= 0);
    return approvals;
  }, [approvals, tab]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="container-page space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight section-title">
            Access Approvals Queue
            <InfoTooltip text="Intelligent auto-routing queue: low-risk requests auto-approved, critical-risk auto-denied, rest require human review." />
          </h1>
          <p className="text-sm text-slate-600 mono mt-0.5">Auto-routing active · SLA 24h · {approvals.length} requests pending human review</p>
        </div>
        <button className="btn-primary" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* ── Queue stats bar ─────────────────────────────────────────────────── */}
      <section className="card" style={{ padding: "12px 16px" }}>
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-xs text-slate-500 mono uppercase tracking-wider shrink-0">Queue Stats</p>
          <div className="flex flex-wrap gap-6 flex-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent-green,#22c55e)" }} />
              <span className="text-sm mono">
                Auto-approved today: <strong className="text-emerald-500">{stats.autoApprovedToday}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-sm mono">
                Escalated: <strong className="text-red-500">{stats.escalated}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent-yellow,#f59e0b)" }} />
              <span className="text-sm mono">
                Pending human review: <strong style={{ color: "var(--accent-yellow,#f59e0b)" }}>{stats.pending}</strong>
              </span>
            </div>
            {autoRunning && (
              <div className="flex items-center gap-1 text-xs text-slate-500 mono">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                Auto-routing in progress…
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Auto-routing rules info ─────────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card" style={{ borderLeft: "3px solid var(--accent-green,#22c55e)", padding: "10px 14px" }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-emerald-500 mono uppercase">Auto-Approve Rule</span>
            <span className="badge badge-allow text-xs">ACTIVE</span>
          </div>
          <p className="text-sm text-slate-600">
            Risk score <strong>&lt; {AUTO_APPROVE_THRESHOLD}</strong> → automatically approved with audit log entry
            <span className="mono text-xs block mt-0.5 text-slate-500">"Auto-approved: low risk"</span>
          </p>
        </div>
        <div className="card" style={{ borderLeft: "3px solid var(--accent-red,#ef4444)", padding: "10px 14px" }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-red-500 mono uppercase">Auto-Deny Rule</span>
            <span className="badge badge-blocked text-xs">ACTIVE</span>
          </div>
          <p className="text-sm text-slate-600">
            Risk score <strong>&gt; {AUTO_DENY_THRESHOLD}</strong> → automatically denied with audit log entry
            <span className="mono text-xs block mt-0.5 text-slate-500">"Auto-denied: critical risk threshold exceeded"</span>
          </p>
        </div>
      </section>

      {/* ── Recent auto-actions log ─────────────────────────────────────────── */}
      {autoActions.length > 0 && (
        <section className="card" style={{ padding: "10px 14px" }}>
          <p className="text-xs text-slate-500 mono uppercase tracking-wider mb-2">Recent Auto-Actions</p>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {autoActions.slice(0, 8).map((a) => (
              <div key={`${a.id}-${a.timestamp}`} className="flex items-center gap-3 text-xs mono">
                <span className={a.type === "approved" ? "text-emerald-500" : "text-red-500"}>
                  {a.type === "approved" ? "✓ AUTO-APPROVED" : "✗ AUTO-DENIED"}
                </span>
                <span className="text-slate-500">{a.tool_name}</span>
                <span className="text-slate-600">risk={a.risk_score}</span>
                <span className="text-slate-600 ml-auto">
                  {new Date(a.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Tab filter ──────────────────────────────────────────────────────── */}
      <section className="card" style={{ padding: "10px 14px" }}>
        <div className="flex flex-wrap items-center gap-2">
          {(["pending", "high", "escalated"] as const).map((t) => {
            const labels: Record<typeof t, string> = {
              pending: `All Pending (${approvals.length})`,
              high: `High Risk (${approvals.filter((a) => a.risk_score >= 70).length})`,
              escalated: `Escalated (${stats.escalated})`,
            };
            const active: Record<typeof t, string> = {
              pending: "badge-allow",
              high: "badge-pending",
              escalated: "badge-blocked",
            };
            return (
              <button
                key={t}
                className={`badge ${tab === t ? active[t] : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setTab(t)}
              >
                {labels[t]}
              </button>
            );
          })}
        </div>
      </section>

      {error && <p className="text-sm text-red-500 mono">{error}</p>}

      {/* ── Cards ───────────────────────────────────────────────────────────── */}
      {loading ? (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card space-y-2">
              <div className="skeleton skeleton-sm" />
              <div className="skeleton skeleton-row" />
              <div className="skeleton skeleton-row" />
              <div className="skeleton skeleton-row" />
            </div>
          ))}
        </section>
      ) : (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map((approval) => {
            const score = approval.risk_score ?? 0;
            const isExpanded = expandedId === approval.id;
            const escalated = getRemainingMs(approval.created_at) <= 0;

            return (
              <article
                key={approval.id}
                className="card"
                style={{
                  borderLeft: `3px solid ${escalated
                      ? "var(--accent-red,#ef4444)"
                      : score >= 70
                        ? "var(--accent-yellow,#f59e0b)"
                        : "var(--border)"
                    }`,
                }}
              >
                {/* Card header */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold truncate">
                        {approval.tool_name ?? "Unknown Tool"}
                      </p>
                      <span className={`badge ${riskColor(score)}`}>{riskLabel(score)}</span>
                    </div>
                    <p className="text-xs text-slate-500 mono mt-0.5 truncate">
                      {approval.tool_call_id}
                    </p>
                  </div>
                  {/* SLA timer */}
                  <SlaTimer createdAt={approval.created_at} />
                </div>

                {/* Risk score bar */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs mono mb-0.5">
                    <span className="text-slate-500">Risk Score</span>
                    <span style={{ color: riskBarColor(score) }}>{score} / 100</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: "var(--surface2)" }}>
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${score}%`, background: riskBarColor(score) }}
                    />
                  </div>
                </div>

                {/* Scores grid */}
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {[
                    { label: "Risk", value: score },
                    { label: "Privacy", value: Math.max(5, score - 10) },
                    { label: "Shadow IT", value: Math.max(5, score - 25) },
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center">
                      <p className="text-xs text-slate-500 mono">{label}</p>
                      <p
                        className="font-bold mono"
                        style={{ color: riskBarColor(value), fontSize: "1.1rem" }}
                      >
                        {value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Justification */}
                <div
                  className="text-sm text-slate-600 mb-2 px-2 py-1.5 rounded"
                  style={{ background: "var(--surface2)", fontSize: "0.8rem" }}
                >
                  {approval.decision_reason ?? "Flagged for manual review"}
                  {approval.destination_domain && (
                    <span className="ml-2 mono text-xs text-slate-500">
                      → {approval.destination_domain}
                    </span>
                  )}
                </div>

                {/* Expandable risk breakdown */}
                {approval.risk_breakdown && approval.risk_breakdown.length > 0 && (
                  <div className="mb-2">
                    <button
                      className="text-xs text-slate-500 mono hover:text-slate-300 flex items-center gap-1"
                      onClick={() => setExpandedId(isExpanded ? null : approval.id)}
                    >
                      {isExpanded ? "▲" : "▼"} Risk breakdown ({approval.risk_breakdown.length} factors)
                    </button>
                    {isExpanded && (
                      <RiskBreakdown factors={approval.risk_breakdown} />
                    )}
                  </div>
                )}

                {/* Decision reason input */}
                <input
                  className="input w-full mb-2"
                  placeholder="Override reason (optional)"
                  value={reasonById[approval.id] ?? ""}
                  onChange={(e) =>
                    setReasonById((prev) => ({ ...prev, [approval.id]: e.target.value }))
                  }
                  style={{ fontSize: "0.8rem", padding: "6px 10px" }}
                />

                {/* Actions */}
                <PermissionGate permission="approvals:approve" fallback="disable">
                  <div className="flex gap-2">
                    <button
                      className="btn-primary flex-1"
                      onClick={() => action(approval.id, "approve")}
                      disabled={busyId === approval.id}
                      style={{ fontSize: "0.85rem", padding: "6px 12px" }}
                    >
                      {busyId === approval.id ? "Processing…" : "✓ Approve"}
                    </button>
                    <button
                      className="btn-secondary flex-1"
                      onClick={() => action(approval.id, "reject")}
                      disabled={busyId === approval.id}
                      style={{ fontSize: "0.85rem", padding: "6px 12px" }}
                    >
                      {busyId === approval.id ? "Processing…" : "✗ Deny"}
                    </button>
                  </div>
                </PermissionGate>

                {/* Metadata footer */}
                <p className="text-xs text-slate-600 mono mt-2">
                  Created {new Date(approval.created_at).toLocaleString()}
                </p>
              </article>
            );
          })}

          {!loading && !filtered.length && (
            <div className="card col-span-2 text-center py-8 text-slate-600">
              <p className="text-lg font-semibold mb-1">Queue Clear</p>
              <p className="text-sm mono">No pending requests in this view.</p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
