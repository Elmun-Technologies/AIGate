"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { API_URL, apiRequest } from "@/lib/api";

type AuditEvent = {
  id: string;
  stream_id: string;
  event_type: string;
  decision: string;
  risk_score: number;
  created_at: string;
  payload_redacted_json: Record<string, unknown>;
  chain_hash: string;
  prev_hash: string | null;
};

function extractTool(payload: Record<string, unknown>) {
  const request = payload?.request;
  if (request && typeof request === "object" && "tool" in request) {
    const value = (request as Record<string, unknown>).tool;
    if (typeof value === "string") return value;
  }
  return "n/a";
}

function extractApprovalId(payload: Record<string, unknown>) {
  const value = payload?.approval_request_id;
  return typeof value === "string" ? value : "n/a";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (agentId) params.set("agent_id", agentId);
    if (decision) params.set("decision", decision);
    if (minRisk) params.set("min_risk", minRisk);
    if (maxRisk) params.set("max_risk", maxRisk);

    try {
      setError("");
      const data = await apiRequest(`/audit?${params.toString()}`);
      setEvents(data);
      if (data.length > 0) {
        setSelected(await apiRequest(`/audit/${data[0].id}`));
      } else {
        setSelected(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit events");
    }
  }, [agentId, decision, minRisk, maxRisk]);

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

  const onFilter = async (event: FormEvent) => {
    event.preventDefault();
    await load();
  };

  const openDetail = async (id: string) => {
    try {
      setSelected(await apiRequest(`/audit/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open audit detail");
    }
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
      if (!response.ok) {
        throw new Error(`Export failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = format === "csv" ? "audit-export.csv" : "audit-export.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export audit");
    }
  };

  const rows = useMemo(
    () =>
      events.map((event) => ({
        ...event,
        tool: extractTool(event.payload_redacted_json || {}),
        approvalId: extractApprovalId(event.payload_redacted_json || {}),
      })),
    [events],
  );

  return (
    <main className="container-page space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Audit Evidence</h1>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={load}>Refresh</button>
          <button className="btn-secondary" onClick={() => exportAudit("json")}>Export JSON</button>
          <button className="btn-secondary" onClick={() => exportAudit("csv")}>Export CSV</button>
        </div>
      </div>

      <form className="card grid grid-cols-1 md:grid-cols-5 gap-2" onSubmit={onFilter}>
        <input className="input" placeholder="agent_id" value={agentId} onChange={(event) => setAgentId(event.target.value)} />
        <input className="input" placeholder="decision" value={decision} onChange={(event) => setDecision(event.target.value)} />
        <input className="input" placeholder="min_risk" value={minRisk} onChange={(event) => setMinRisk(event.target.value)} />
        <input className="input" placeholder="max_risk" value={maxRisk} onChange={(event) => setMaxRisk(event.target.value)} />
        <button className="btn-primary" type="submit">Apply Filters</button>
      </form>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card overflow-auto max-h-[560px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">Time</th>
                <th className="pr-2">Agent</th>
                <th className="pr-2">Tool</th>
                <th className="pr-2">Decision</th>
                <th className="pr-2">Risk</th>
                <th className="pr-2">Approval ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event) => (
                <tr
                  key={event.id}
                  className="border-b cursor-pointer hover:bg-slate-50"
                  onClick={() => openDetail(event.id)}
                >
                  <td className="py-2 pr-2">{formatDate(event.created_at)}</td>
                  <td className="pr-2"><code>{event.stream_id}</code></td>
                  <td className="pr-2">{event.tool}</td>
                  <td className="pr-2">{event.decision}</td>
                  <td className="pr-2">{event.risk_score}</td>
                  <td className="pr-2"><code>{event.approvalId}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="font-semibold mb-2">Detail JSON</h2>
          {selected ? (
            <pre className="text-xs overflow-auto max-h-[520px] whitespace-pre-wrap">{JSON.stringify(selected, null, 2)}</pre>
          ) : (
            <p className="text-sm text-slate-600">Select an event.</p>
          )}
        </div>
      </section>
    </main>
  );
}
