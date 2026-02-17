"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api";

type Policy = {
  id: string;
  name: string;
  version: number;
  yaml_text: string;
  is_active: boolean;
  created_at: string;
};

export default function PoliciesPage() {
  const router = useRouter();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("Policy");
  const [version, setVersion] = useState(1);
  const [yamlText, setYamlText] = useState(`version: 1\nrules:\n  - name: "Default allow"\n    then:\n      decision: "ALLOW"\n      reason: "Default"\n`);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setPolicies(await apiRequest("/policies"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load policies");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save policy");
    }
  };

  const activate = async (id: string) => {
    setError("");
    try {
      await apiRequest(`/policies/${id}/activate`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate policy");
    }
  };

  const loadEditor = (policy: Policy) => {
    setEditingId(policy.id);
    setName(policy.name);
    setVersion(policy.version);
    setYamlText(policy.yaml_text);
  };

  return (
    <main className="container-page space-y-4">
      <h1 className="text-2xl font-semibold">Policies</h1>

      <section className="card space-y-3">
        <h2 className="font-semibold">YAML Editor</h2>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Policy name" />
        <input className="input" type="number" value={version} onChange={(e) => setVersion(parseInt(e.target.value || "1", 10))} />
        <textarea className="input min-h-[260px] font-mono text-xs" value={yamlText} onChange={(e) => setYamlText(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn-primary" onClick={save}>{editingId ? "Update Policy" : "Create Policy"}</button>
          {editingId ? <button className="btn-secondary" onClick={() => setEditingId(null)}>Clear Edit</button> : null}
        </div>
        {error ? <p className="text-red-600 text-sm">{error}</p> : null}
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3">Policies</h2>
        <div className="space-y-2">
          {policies.map((policy) => (
            <div key={policy.id} className="border border-slate-200 rounded p-3 flex items-center justify-between">
              <div>
                <p className="font-medium">{policy.name} v{policy.version} {policy.is_active ? "(active)" : ""}</p>
                <p className="text-xs text-slate-500">{policy.id}</p>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => loadEditor(policy)}>Edit</button>
                <button className="btn-primary" onClick={() => activate(policy.id)}>Activate</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
