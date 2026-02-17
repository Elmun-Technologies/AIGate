"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api";

type Agent = {
  id: string;
  name: string;
  owner_email: string;
  data_classification: string;
  status: string;
  created_at: string;
};

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState("demo-agent");
  const [ownerEmail, setOwnerEmail] = useState("owner@example.com");
  const [classification, setClassification] = useState("Public");
  const [status, setStatus] = useState("active");
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setAgents(await apiRequest("/agents"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    }
  };

  return (
    <main className="container-page space-y-4">
      <h1 className="text-2xl font-semibold">Agents</h1>

      <section className="card">
        <h2 className="font-semibold mb-3">Create Agent</h2>
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
          <button className="btn-primary md:col-span-2" type="submit">Create Agent</button>
        </form>
        {newKey ? <p className="text-sm mt-3 text-emerald-700">New API key (shown once): <code>{newKey}</code></p> : null}
        {error ? <p className="text-sm text-red-600 mt-2">{error}</p> : null}
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3">Inventory</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Name</th>
                <th>Owner</th>
                <th>Classification</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-b">
                  <td className="py-2">{agent.name}</td>
                  <td>{agent.owner_email}</td>
                  <td>{agent.data_classification}</td>
                  <td>{agent.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
