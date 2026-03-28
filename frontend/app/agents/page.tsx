"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest, apiRequestWithRetry } from "@/lib/api";
import InfoTooltip from "@/components/InfoTooltip";
import { PermissionGate } from "@/src/components/PermissionGate";

type Agent = {
  id: string;
  name: string;
  owner_email: string;
  data_classification: string;
  status: string;
  created_at: string;
};

type ToolCall = {
  id: string;
  agent_id: string;
  created_at: string;
  risk_score: number;
};

function formatLastActivity(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [name, setName] = useState("sim-agent");
  const [ownerEmail, setOwnerEmail] = useState("owner@example.com");
  const [classification, setClassification] = useState("Public");
  const [status, setStatus] = useState("active");
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const minDelay = new Promise((resolve) => setTimeout(resolve, 900));
    try {
      setLoading(true);
      setError("");
      const [agentsData, callsData] = await Promise.all([
        apiRequestWithRetry("/agents"),
        apiRequestWithRetry("/tool-calls"),
      ]);
      setAgents(Array.isArray(agentsData) ? (agentsData as Agent[]) : []);
      setToolCalls(Array.isArray(callsData) ? (callsData as ToolCall[]) : []);
    } catch {
      setError("Failed to load agents. Please try again.");
    } finally {
      await minDelay;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
      return;
    }
    load();
  }, [router]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const created = await apiRequest("/agents", {
        method: "POST",
        body: JSON.stringify({
          name,
          owner_email: ownerEmail,
          data_classification: classification,
          status,
        }),
      });
      setNewKey(created.api_key);
      await load();
      localStorage.setItem("gateway:refresh-at", String(Date.now()));
      window.dispatchEvent(new CustomEvent("gateway:refresh"));
    } catch {
      setError("Failed to create agent. Please check your input.");
    }
  };

  const lastActivityByAgent = useMemo(() => {
    const grouped: Record<string, string> = {};
    for (const call of toolCalls) {
      if (!grouped[call.agent_id]) grouped[call.agent_id] = call.created_at;
    }
    return grouped;
  }, [toolCalls]);

  const stats = useMemo(() => {
    const total = agents.length;
    const active = agents.filter((a) => a.status === "active").length;
    const protectedAgents = agents.filter((a) => ["Confidential", "PII"].includes(a.data_classification)).length;
    const calls = toolCalls.length;
    return { total, active, protectedAgents, calls };
  }, [agents, toolCalls]);

  return (
    <main className="container-page space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight section-title">
          AI Agents Inventory
          <InfoTooltip text="Manage and audit organizational AI agents and their runtime access levels." />
        </h1>
        <p className="text-sm text-slate-600 mono">
          Register agents, classify data access, and track operational security posture.
        </p>
      </div>

      {loading ? (
        <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="card">
              <div className="skeleton skeleton-sm mb-3" />
              <div className="skeleton skeleton-lg" />
            </div>
          ))}
        </section>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="card stat-card-enterprise"><p className="stat-label">Total Agents</p><p className="stat-number">{stats.total}</p></div>
          <div className="card stat-card-enterprise"><p className="stat-label">Active Agents</p><p className="stat-number">{stats.active}</p></div>
          <div className="card stat-card-enterprise"><p className="stat-label">Protected Access</p><p className="stat-number">{stats.protectedAgents}</p></div>
          <div className="card stat-card-enterprise"><p className="stat-label">API Calls</p><p className="stat-number">{stats.calls}</p></div>
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="font-semibold">Register New Agent</h2>
          <span className="badge badge-pending">Runtime onboarding</span>
        </div>
        <form className="grid grid-cols-1 md:grid-cols-2 gap-3" onSubmit={create}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" required />
          <input className="input" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="Owner email" required />
          <select className="input" value={classification} onChange={(e) => setClassification(e.target.value)}>
            <option>Public</option>
            <option>Internal</option>
            <option>PII</option>
            <option>Confidential</option>
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
          <button className="btn-primary md:col-span-2" type="submit">Register New Agent</button>
        </form>
        {newKey ? <p className="text-sm mt-3 text-emerald-700 mono">One-time API key: <code>{newKey}</code></p> : null}
        {error ? <p className="text-sm text-slate-600 mt-2">—</p> : null}
      </section>

      <section className="card table-wrap">
        <div className="card-header">
          <h2 className="font-semibold">Agent Registry</h2>
          <span className="badge">{agents.length} agents</span>
        </div>
        <table className="w-full text-sm enterprise-table">
          <thead>
            <tr>
              <th>Agent Name</th>
              <th>Owner</th>
              <th>Access Level</th>
              <th>Status</th>
              <th>Last Activity</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <td>
                  <div className="mono">{agent.name}</div>
                  <div className="text-xs text-slate-600 mono">{agent.id}</div>
                </td>
                <td>{agent.owner_email}</td>
                <td>
                  <span className={
                    agent.data_classification === "Public"
                      ? "badge badge-allow"
                      : agent.data_classification === "Internal"
                        ? "badge badge-pending"
                        : "badge badge-blocked"
                  }>
                    {agent.data_classification}
                  </span>
                </td>
                <td>
                  <span className={agent.status === "active" ? "badge badge-allow" : "badge badge-blocked"}>
                    {agent.status}
                  </span>
                </td>
                <td className="mono">{formatLastActivity(lastActivityByAgent[agent.id])}</td>
                <td><PermissionGate permission="agents:rotate_key" fallback="hide"><button className="btn-ghost !px-2 !py-1" onClick={() => alert(`Key rotation requested for ${agent.name}. This will invalidate the current API key.`)}>Rotate Key</button></PermissionGate></td>
              </tr>
            ))}
            {!agents.length ? (
              <tr>
                <td colSpan={6} className="text-slate-600">No agents yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="flex items-start gap-3">
          <span className="simulator-ready-icon" aria-hidden>i</span>
          <div>
            <h2 className="font-semibold">API Key Security Policy</h2>
            <p className="text-sm text-slate-600">
              Agents with Confidential/PII access should rotate credentials every 30 days and require approval gates for external tools.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
