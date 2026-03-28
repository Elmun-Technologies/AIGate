"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest, apiRequestWithRetry } from "@/lib/api";
import { useBudget, formatBudget, formatBudgetShort } from "@/lib/useBudget";
import InfoTooltip from "@/components/InfoTooltip";

type ProviderSpend = {
  provider: string;
  usd: number;
  tokens_in: number;
  tokens_out: number;
  events: number;
  shadow_events: number;
};

type SpendAlert = {
  id: string;
  scope_type: "agent" | "org";
  scope_id: string | null;
  period: "daily" | "monthly";
  threshold_usd: string;
  status: "active" | "triggered" | "muted";
  last_triggered_at: string | null;
};

type SpendAnomaly = {
  id: string;
  anomaly_date: string;
  scope_type: string;
  scope_id: string;
  current_usd: number;
  baseline_usd: number;
  spike_percent: number;
};

type Agent = {
  id: string;
  name: string;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function SpendPage() {
  const router = useRouter();
  const [anomalies, setAnomalies] = useState<SpendAnomaly[]>([]);
  const [alerts, setAlerts] = useState<SpendAlert[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [scopeType, setScopeType] = useState<"agent" | "org">("org");
  const [scopeId, setScopeId] = useState("");
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");
  const [thresholdUsd, setThresholdUsd] = useState("1.00");
  const [loading, setLoading] = useState(false);
  const { spend, providers, loading: spendLoading } = useBudget();

  const maxDayUsd = useMemo(() => {
    if (!spend.by_day.length) return 1;
    return Math.max(...spend.by_day.map((item) => item.usd), 1);
  }, [spend.by_day]);

  const load = useCallback(async () => {
    const minDelay = new Promise((resolve) => setTimeout(resolve, 900));
    try {
      setLoading(true);
      const [anomaliesData, alertsData, agentsData] = await Promise.all([
        apiRequestWithRetry(`/spend/anomalies`),
        apiRequestWithRetry("/spend/alerts"),
        apiRequestWithRetry("/agents"),
      ]);

      setAnomalies(
        Array.isArray((anomaliesData as { anomalies?: SpendAnomaly[] })?.anomalies)
          ? (anomaliesData as { anomalies: SpendAnomaly[] }).anomalies
          : [],
      );
      setAlerts(Array.isArray(alertsData) ? (alertsData as SpendAlert[]) : []);
      setAgents(Array.isArray(agentsData) ? (agentsData as Agent[]) : []);
    } catch {
      // intentionally silent
    } finally {
      await minDelay;
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

  const createAlert = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest("/spend/alerts", {
        method: "POST",
        body: JSON.stringify({
          scope_type: scopeType,
          scope_id: scopeType === "agent" ? scopeId : null,
          period,
          threshold_usd: thresholdUsd,
        }),
      });
      await load();
    } catch {
      // intentionally silent
    }
  };

  const projected = spend.total_usd * 4;
  const budgetLimit = Math.max(5, Number(alerts[0]?.threshold_usd || 10));
  const budgetUsage = Math.min(100, Math.round((projected / budgetLimit) * 100));
  const budgetAtRisk = budgetUsage >= 80;

  return (
    <main className="container-page space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight section-title">
            AI Spend Analytics
            <InfoTooltip text="Real-time monitoring of token usage, model cost, and spend anomalies." />
          </h1>
          <p className="text-sm text-slate-600 mono">Real-time monitoring of token usage and infrastructure costs.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary">Export Report</button>
        </div>
      </div>

      <section className={`card spend-warning ${budgetAtRisk ? "warning" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold mono">{budgetAtRisk ? "BUDGET WARNING" : "BUDGET HEALTHY"}</p>
            <p className="text-sm text-slate-600">Projected monthly usage is {budgetUsage}% of the configured budget threshold.</p>
          </div>
          <span className={budgetAtRisk ? "badge badge-pending" : "badge badge-allow"}>{budgetUsage}% used</span>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="card stat-card-enterprise"><p className="stat-label">Total Spend (MTD)</p><p className="stat-number">{formatBudgetShort(spend.total_usd)}</p></div>
        <div className="card stat-card-enterprise"><p className="stat-label">Projected Spend</p><p className="stat-number">{formatBudget(projected)}</p></div>
        <div className="card stat-card-enterprise"><p className="stat-label">Total Tokens</p><p className="stat-number">{providers.reduce((acc, row) => acc + row.tokens_in + row.tokens_out, 0)}</p></div>
        <div className="card stat-card-enterprise"><p className="stat-label">Budget Status</p><p className="stat-number">{budgetAtRisk ? "AT RISK" : "OK"}</p></div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-3">
        <div className="card">
          <div className="card-header"><h2 className="font-semibold">Monthly Spend by Day</h2><span className="badge">7d</span></div>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, idx) => <div key={idx} className="skeleton skeleton-row" />)}</div>
          ) : (
            <div className="space-y-2">
              {spend.by_day.map((item) => (
                <div key={item.day} className="grid grid-cols-[110px_1fr_90px] gap-2 items-center text-sm">
                  <span className="text-slate-600 mono">{item.day}</span>
                  <div className="h-3 bg-slate-100 rounded overflow-hidden">
                    <div className="h-full" style={{ width: `${Math.max((item.usd / maxDayUsd) * 100, 4)}%`, background: "var(--accent-primary)" }} />
                  </div>
                  <span className="text-right font-medium mono">{formatBudget(item.usd)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card space-y-2">
          <h2 className="font-semibold">Spend by Provider</h2>
          {providers.map((row) => (
            <div key={row.provider} className="provider-row">
              <div>
                <p className="font-semibold">{row.provider}</p>
                <p className="text-xs text-slate-600 mono">events={row.events} shadow={row.shadow_events}</p>
              </div>
              <p className="mono font-semibold">{formatMoney(row.usd)}</p>
            </div>
          ))}
          {!providers.length ? <p className="text-sm text-slate-600">No provider data yet.</p> : null}
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-3">
        <div className="card">
          <div className="card-header"><h2 className="font-semibold">Top Models by Cost</h2></div>
          <div className="space-y-3">
            {spend.top_tools.map((row) => (
              <div key={row.tool}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="mono">{row.tool}</span>
                  <span className="mono">{formatBudget(row.usd)}</span>
                </div>
                <div className="risk-progress-track"><div className="risk-progress-fill" style={{ width: `${Math.max(8, (row.usd / Math.max(spend.total_usd, 1)) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className="card space-y-2">
          <div className="card-header"><h2 className="font-semibold">Cost Anomalies</h2></div>
          {anomalies.slice(0, 5).map((item) => (
            <div key={item.id} className="anomaly-row">
              <div>
                <p className="font-semibold">Spike in usage</p>
                <p className="text-xs text-slate-600 mono">{item.scope_type}:{item.scope_id} • {item.anomaly_date}</p>
              </div>
              <span className={item.spike_percent >= 300 ? "badge badge-blocked" : "badge badge-pending"}>+{item.spike_percent.toFixed(0)}%</span>
            </div>
          ))}
          {!anomalies.length ? <p className="text-sm text-slate-600">No anomalies in selected window.</p> : null}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card space-y-3">
          <h2 className="font-semibold">Create Spend Alert</h2>
          <form onSubmit={createAlert} className="space-y-2">
            <select className="input" value={scopeType} onChange={(event) => setScopeType(event.target.value as "agent" | "org")}> 
              <option value="org">Organization</option>
              <option value="agent">Agent</option>
            </select>
            {scopeType === "agent" ? (
              <select className="input" value={scopeId} onChange={(event) => setScopeId(event.target.value)} required>
                <option value="">Select agent</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            ) : null}
            <select className="input" value={period} onChange={(event) => setPeriod(event.target.value as "daily" | "monthly")}> 
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
            </select>
            <input className="input" type="number" min="0" step="0.01" value={thresholdUsd} onChange={(event) => setThresholdUsd(event.target.value)} required />
            <button className="btn-primary" type="submit">Create Alert</button>
          </form>
        </div>

        <div className="card space-y-2">
          <h2 className="font-semibold">Alerts</h2>
          {alerts.map((alert) => (
            <div key={alert.id} className="border border-[var(--border)] rounded p-2">
              <p className="mono font-semibold">{alert.scope_type.toUpperCase()} | {alert.period.toUpperCase()} | ${Number(alert.threshold_usd).toFixed(2)}</p>
              <p className="text-slate-600 mono">status={alert.status} | scope_id={alert.scope_id || "org"}</p>
              <p className="text-slate-500 mono">last_triggered_at={formatDate(alert.last_triggered_at)}</p>
            </div>
          ))}
          {!alerts.length ? <p className="text-sm text-slate-600">No alerts configured.</p> : null}
        </div>
      </section>
    </main>
  );
}
