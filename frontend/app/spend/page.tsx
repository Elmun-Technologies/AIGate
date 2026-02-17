"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api";

type SpendSummary = {
  total_usd: number;
  by_day: Array<{ day: string; usd: number }>;
  top_agents: Array<{ agent_id: string; agent_name?: string; usd: number; tool_calls: number }>;
  top_tools: Array<{ tool: string; usd: number }>;
  alerts_triggered: Array<{
    id: string;
    scope_type: string;
    scope_id: string | null;
    period: string;
    threshold_usd: number;
    status: string;
    last_triggered_at: string | null;
  }>;
};

type SpendAlert = {
  id: string;
  scope_type: "agent" | "org";
  scope_id: string | null;
  period: "daily" | "monthly";
  threshold_usd: string;
  status: "active" | "triggered" | "muted";
  last_triggered_at: string | null;
  created_at: string;
};

type Agent = {
  id: string;
  name: string;
};

function formatMoney(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function SpendPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<SpendSummary>({
    total_usd: 0,
    by_day: [],
    top_agents: [],
    top_tools: [],
    alerts_triggered: [],
  });
  const [alerts, setAlerts] = useState<SpendAlert[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [scopeType, setScopeType] = useState<"agent" | "org">("org");
  const [scopeId, setScopeId] = useState("");
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");
  const [thresholdUsd, setThresholdUsd] = useState("1.00");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const maxDayUsd = useMemo(() => {
    if (!summary.by_day.length) return 1;
    return Math.max(...summary.by_day.map((item) => item.usd), 1);
  }, [summary.by_day]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const to = new Date();
      const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });

      const [summaryData, alertsData, agentsData] = await Promise.all([
        apiRequest(`/spend/summary?${params.toString()}`),
        apiRequest("/spend/alerts"),
        apiRequest("/agents"),
      ]);
      setSummary(summaryData);
      setAlerts(alertsData);
      setAgents(agentsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load spend data");
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

  useEffect(() => {
    const onRefresh = () => load();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "gateway:refresh-at") {
        load();
      }
    };
    window.addEventListener("gateway:refresh", onRefresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("gateway:refresh", onRefresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [load]);

  const createAlert = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setError("");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create alert");
    }
  };

  return (
    <main className="container-page space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Spend</h1>
          <p className="text-sm text-slate-600">AI spend tracing and threshold alerts for security governance.</p>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card">
          <p className="text-xs text-slate-500">Total Spend (Last 7 Days)</p>
          <p className="text-2xl font-semibold">{formatMoney(summary.total_usd)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-500">Triggered Alerts</p>
          <p className="text-2xl font-semibold">{summary.alerts_triggered.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-500">Top Tool</p>
          <p className="text-2xl font-semibold">{summary.top_tools[0]?.tool || "-"}</p>
        </div>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Spend by Day</h2>
        {summary.by_day.length === 0 ? (
          <p className="text-sm text-slate-600">No spend data yet. Run simulator to generate tool calls and costs.</p>
        ) : (
          <div className="space-y-2">
            {summary.by_day.map((item) => (
              <div key={item.day} className="grid grid-cols-[110px_1fr_90px] gap-2 items-center text-sm">
                <span className="text-slate-600">{item.day}</span>
                <div className="h-3 bg-slate-100 rounded overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${Math.max((item.usd / maxDayUsd) * 100, 4)}%` }} />
                </div>
                <span className="text-right font-medium">{formatMoney(item.usd)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card">
          <h2 className="font-semibold mb-2">Top Agents</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Agent</th>
                <th className="py-2">USD</th>
                <th className="py-2">Tool Calls</th>
              </tr>
            </thead>
            <tbody>
              {summary.top_agents.map((row) => (
                <tr key={row.agent_id} className="border-b">
                  <td className="py-2">{row.agent_name || row.agent_id}</td>
                  <td>{formatMoney(row.usd)}</td>
                  <td>{row.tool_calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="font-semibold mb-2">Top Tools</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Tool</th>
                <th className="py-2">USD</th>
              </tr>
            </thead>
            <tbody>
              {summary.top_tools.map((row) => (
                <tr key={row.tool} className="border-b">
                  <td className="py-2">{row.tool}</td>
                  <td>{formatMoney(row.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            ) : null}
            <select className="input" value={period} onChange={(event) => setPeriod(event.target.value as "daily" | "monthly")}>
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
            </select>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={thresholdUsd}
              onChange={(event) => setThresholdUsd(event.target.value)}
              placeholder="Threshold USD"
              required
            />
            <button className="btn-primary" type="submit">Create Alert</button>
          </form>
        </div>

        <div className="card">
          <h2 className="font-semibold mb-2">Alerts</h2>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-600">No alerts configured.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {alerts.map((alert) => (
                <li key={alert.id} className="border border-slate-200 rounded p-2">
                  <p className="font-medium">{alert.scope_type.toUpperCase()} | {alert.period.toUpperCase()} | ${Number(alert.threshold_usd).toFixed(2)}</p>
                  <p className="text-slate-600">status={alert.status} | scope_id={alert.scope_id || "org"}</p>
                  <p className="text-slate-500">last_triggered_at={formatDate(alert.last_triggered_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
