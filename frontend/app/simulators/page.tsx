"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api";

type PolicyCheckResponse = {
  status: string;
  simulated_at: string;
  verdict: {
    decision: string;
    status: string;
    reason: string;
    matched_rule: string;
    source: string;
    risk_score: number;
    rules_evaluated: number;
  };
  risk_breakdown: Array<{
    name: string;
    contribution: number;
    explanation: string;
  }>;
  rule_trace: Array<{
    index: number;
    name: string;
    matched: boolean;
    decision: string;
    reason: string;
  }>;
};

export default function SimulatorsPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState(
    "Write a python script that connects to our internal DB using these keys: AKIA_EXAMPLE_123",
  );
  const [tool, setTool] = useState("external_post");
  const [classification, setClassification] = useState("Confidential");
  const [argsText, setArgsText] = useState(
    JSON.stringify(
      {
        url: "https://public-endpoint.example/upload",
        payload: {
          note: "send customer export",
          email: "alice@example.com",
          card: "4111111111111111",
        },
      },
      null,
      2,
    ),
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PolicyCheckResponse | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
    }
  }, [router]);

  const runSimulation = async () => {
    setLoading(true);
    try {
      const parsedArgs = argsText.trim() ? JSON.parse(argsText) : {};
      const response = (await apiRequest("/sim/policy-check", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          tool,
          agent_classification: classification,
          args: parsedArgs,
        }),
      })) as PolicyCheckResponse;
      setResult(response);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const runWedge = async () => {
    setLoading(true);
    try {
      await apiRequest("/sim/run-yc", { method: "POST" });
      await runSimulation();
      localStorage.setItem("gateway:refresh-at", String(Date.now()));
      window.dispatchEvent(new CustomEvent("gateway:refresh"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container-page space-y-3">
      <section className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-3">
        <div className="card flex flex-col min-h-[760px]">
          <div className="card-header">
            <h2 className="font-semibold">TEST PROMPT</h2>
            <div className="flex items-center gap-2">
              <span className="badge">LLM: GPT-4o</span>
              <span className="badge">UTF-8</span>
            </div>
          </div>
          <textarea
            className="input mono flex-1 min-h-[530px]"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Enter a prompt to simulate policy enforcement..."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
            <select className="input" value={tool} onChange={(event) => setTool(event.target.value)}>
              <option value="read_db">read_db</option>
              <option value="send_email">send_email</option>
              <option value="external_post">external_post</option>
            </select>
            <select className="input" value={classification} onChange={(event) => setClassification(event.target.value)}>
              <option>Public</option>
              <option>Internal</option>
              <option>Confidential</option>
              <option>PII</option>
            </select>
            <button className="btn-secondary" onClick={runWedge} disabled={loading}>
              {loading ? "Running..." : "Run Wedge Scenario"}
            </button>
          </div>
          <textarea
            className="input mono min-h-[140px] mt-2"
            value={argsText}
            onChange={(event) => setArgsText(event.target.value)}
            placeholder="Tool args (JSON)"
          />
          <div className="flex items-center justify-end mt-3">
            <button className="btn-primary !px-6" onClick={runSimulation} disabled={loading}>
              {loading ? "Running Simulation..." : "Run Simulation"}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="card min-h-[300px]">
            <div className="card-header">
              <h2 className="font-semibold">SIMULATION VERDICT</h2>
            </div>
            {result ? (
              <div className="sim-verdict">
                <div
                  className={`sim-verdict-icon ${
                    result.verdict.status === "BLOCKED"
                      ? "blocked"
                      : result.verdict.status === "PENDING_APPROVAL"
                        ? "pending"
                        : "allow"
                  }`}
                >
                  {result.verdict.status === "BLOCKED" ? "⛔" : result.verdict.status === "PENDING_APPROVAL" ? "⏳" : "✓"}
                </div>
                <p className="sim-verdict-title">{result.verdict.status}</p>
                <p className="text-sm text-slate-600">{result.verdict.reason}</p>
              </div>
            ) : (
              <div className="sim-verdict">
                <p className="text-sm text-slate-600">Run simulation to get verdict.</p>
              </div>
            )}
          </div>

          <div className="card min-h-[440px]">
            <div className="card-header">
              <h2 className="font-semibold">TRACE ANALYSIS</h2>
              <span className="text-xs text-slate-500">{result?.verdict.rules_evaluated ?? 0} Rules Evaluated</span>
            </div>
            <div className="space-y-2">
              {(result?.rule_trace || []).map((rule) => (
                <div key={`${rule.index}-${rule.name}`} className={`trace-row ${rule.matched ? "matched" : ""}`}>
                  <div className="flex items-center justify-between">
                    <strong>{rule.name}</strong>
                    <span className={rule.matched ? "badge badge-blocked" : "badge"}>{rule.matched ? "CRITICAL" : "LOW"}</span>
                  </div>
                  <p className="text-sm text-slate-600 mt-1">{rule.reason}</p>
                </div>
              ))}
              {!result?.rule_trace?.length ? <p className="text-sm text-slate-600">No trace yet.</p> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 mono">
          <span>● API Status: Online</span>
          <span>☁ Region: US-East-1</span>
          <span>⌁ Log Stream: Active</span>
          <span>Status: Compliant</span>
        </div>
      </section>
    </main>
  );
}
