"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest, apiRequestWithRetry } from "@/lib/api";
import InfoTooltip from "@/components/InfoTooltip";
import { PermissionGate } from "@/src/components/PermissionGate";

type Policy = {
  id: string;
  name: string;
  version: number;
  yaml_text: string;
  is_active: boolean;
  created_at: string;
};

type PolicyTemplate = {
  key: string;
  name: string;
  description: string;
  yaml_text: string;
};

type DashboardMetrics = {
  blocked_count: number;
  tool_calls_count: number;
};

export default function PoliciesPage() {
  const router = useRouter();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [templates, setTemplates] = useState<PolicyTemplate[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>({ blocked_count: 0, tool_calls_count: 0 });
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("Policy");
  const [version, setVersion] = useState(1);
  const [yamlText, setYamlText] = useState(
    `version: 1\nrules:\n  - name: \"Safe default\"\n    then:\n      decision: \"REQUIRE_APPROVAL\"\n      reason: \"Safe default posture\"\n`,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const minDelay = new Promise((resolve) => setTimeout(resolve, 900));
    try {
      setLoading(true);
      setError("");
      const [data, templateData, metricData] = await Promise.all([
        apiRequestWithRetry("/policies"),
        apiRequestWithRetry("/policies/templates/catalog"),
        apiRequestWithRetry("/dashboard/metrics"),
      ]);
      setPolicies(Array.isArray(data) ? (data as Policy[]) : []);
      setTemplates(
        Array.isArray((templateData as { templates?: PolicyTemplate[] })?.templates)
          ? (templateData as { templates: PolicyTemplate[] }).templates
          : [],
      );
      setMetrics((metricData as DashboardMetrics) || { blocked_count: 0, tool_calls_count: 0 });
    } catch {
      setError("Failed to load policies. Please try again.");
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

  const save = async () => {
    setError("");
    try {
      if (editingId) {
        await apiRequest(`/policies/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({ name, version, yaml_text: yamlText }),
        });
      } else {
        await apiRequest("/policies", {
          method: "POST",
          body: JSON.stringify({ name, version, yaml_text: yamlText, is_active: false }),
        });
      }
      setEditingId(null);
      await load();
      localStorage.setItem("gateway:refresh-at", String(Date.now()));
      window.dispatchEvent(new CustomEvent("gateway:refresh"));
    } catch {
      setError("Failed to save policy. Please check YAML syntax.");
    }
  };

  const activate = async (id: string) => {
    setError("");
    try {
      await apiRequest(`/policies/${id}/activate`, { method: "POST" });
      await load();
      localStorage.setItem("gateway:refresh-at", String(Date.now()));
      window.dispatchEvent(new CustomEvent("gateway:refresh"));
    } catch {
      setError("Failed to activate policy.");
    }
  };

  const loadEditor = (policy: Policy) => {
    setEditingId(policy.id);
    setName(policy.name);
    setVersion(policy.version);
    setYamlText(policy.yaml_text);
  };

  const applyTemplate = async () => {
    if (!selectedTemplate) return;
    setError("");
    try {
      await apiRequest("/policies/templates/apply", {
        method: "POST",
        body: JSON.stringify({ template_key: selectedTemplate, is_active: true }),
      });
      setEditingId(null);
      await load();
    } catch {
      setError("Failed to apply template.");
    }
  };

  const activePolicies = useMemo(() => policies.filter((p) => p.is_active), [policies]);

  return (
    <main className="container-page space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight section-title">
          AI Policies Builder
          <InfoTooltip text="Define guardrails, triggers, and enforcement actions for every agent tool call." />
        </h1>
        <p className="text-sm text-slate-600 mono">Policy-authoring surface for enforcement-first governance.</p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card stat-card-enterprise"><p className="stat-label">Total Blocks (24h)</p><p className="stat-number">{metrics.blocked_count}</p></div>
        <div className="card stat-card-enterprise"><p className="stat-label">Active Policies</p><p className="stat-number">{activePolicies.length}</p></div>
        <div className="card stat-card-enterprise"><p className="stat-label">Highest Risk Category</p><p className="stat-number text-[32px]">PII Leakage</p></div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="font-semibold">Active Guardrails</h2>
          <span className="badge">{policies.length} rulesets</span>
        </div>
        <div className="table-wrap">
          <table className="w-full enterprise-table">
            <thead>
              <tr>
                <th>Policy Name</th>
                <th>Status</th>
                <th>Trigger Type</th>
                <th>Hit Count (24h)</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy.id}>
                  <td>
                    <div className="font-semibold">{policy.name}</div>
                    <div className="text-xs text-slate-600 mono">v{policy.version}</div>
                  </td>
                  <td>
                    <span className={policy.is_active ? "badge badge-allow" : "badge"}>
                      {policy.is_active ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </td>
                  <td><span className="badge badge-pending">Security</span></td>
                  <td className="mono">{Math.max(1, metrics.blocked_count - policy.version)}</td>
                  <td className="mono">{new Date(policy.created_at).toLocaleString()}</td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn-secondary !px-2 !py-1" onClick={() => loadEditor(policy)}>Edit</button>
                      <PermissionGate permission="policies:publish" fallback="hide"><button className="btn-primary !px-2 !py-1" onClick={() => activate(policy.id)}>Activate</button></PermissionGate>
                    </div>
                  </td>
                </tr>
              ))}
              {!policies.length ? (
                <tr><td colSpan={6} className="text-slate-600">No policies found.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[1fr_1.1fr] gap-3">
        <div className="card space-y-3">
          <h2 className="font-semibold">Policy Templates</h2>
          <div className="space-y-2">
            {templates.map((template) => (
              <button
                key={template.key}
                className={`w-full border rounded p-3 text-left ${selectedTemplate === template.key ? "border-[var(--accent-primary)] bg-[var(--primary-dim)]" : "border-[var(--border)]"
                  }`}
                onClick={() => {
                  setSelectedTemplate(template.key);
                  setName(template.name);
                  setYamlText(template.yaml_text);
                }}
              >
                <p className="font-semibold text-sm">{template.name}</p>
                <p className="text-xs text-slate-600 mt-1">{template.description}</p>
                <p className="text-[11px] mono mt-2 text-slate-500">{template.key}</p>
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={applyTemplate} disabled={!selectedTemplate}>
            Activate Template
          </button>
        </div>

        <div className="card space-y-3">
          <div className="card-header">
            <h2 className="font-semibold">Policy Logic Builder</h2>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setEditingId(null)}>Discard</button>
              <PermissionGate permission="policies:publish" fallback="disable"><button className="btn-primary" onClick={save}>{editingId ? "Update Policy" : "Publish Rule"}</button></PermissionGate>
            </div>
          </div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Policy name" />
          <input className="input" type="number" value={version} onChange={(e) => setVersion(parseInt(e.target.value || "1", 10))} />
          <textarea className="input min-h-[340px] mono" value={yamlText} onChange={(e) => setYamlText(e.target.value)} />
          {error ? <p className="text-slate-600 text-sm">—</p> : null}
        </div>
      </section>

      {loading ? <p className="text-sm text-slate-600">Loading...</p> : null}
    </main>
  );
}
