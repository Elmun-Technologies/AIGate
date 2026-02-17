"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { API_URL, apiRequest } from "@/lib/api";

type DemoStepResult = {
  status?: string;
  tool_call_id?: string;
  approval_request_id?: string;
  risk_score?: number;
  decision_reason?: string;
  [key: string]: unknown;
};

type DemoStep = {
  name: string;
  result: DemoStepResult;
};

type DemoResult = {
  status: string;
  public_agent_id: string;
  confidential_agent_id: string;
  steps: DemoStep[];
  pending_approvals_count: number;
  pending_approval_ids: string[];
  summary?: {
    executed: number;
    blocked: number;
    pending_approval: number;
  };
};

function statusLabel(status?: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "executed") return "EXECUTED";
  if (normalized === "pending_approval") return "PENDING_APPROVAL";
  if (normalized === "blocked") return "BLOCKED";
  return (status || "UNKNOWN").toUpperCase();
}

function statusClass(status?: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "executed") return "bg-emerald-100 text-emerald-800 border border-emerald-200";
  if (normalized === "pending_approval") return "bg-amber-100 text-amber-900 border border-amber-200";
  if (normalized === "blocked") return "bg-red-100 text-red-800 border border-red-200";
  return "bg-slate-100 text-slate-700 border border-slate-200";
}

export default function SimulatorsPage() {
  const router = useRouter();
  const [result, setResult] = useState<DemoResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("");
  const progressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
    }
    return () => {
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
      }
    };
  }, [router]);

  const selectedStep = useMemo(() => {
    if (!result || result.steps.length === 0) return null;
    return result.steps[selectedIndex] || result.steps[0];
  }, [result, selectedIndex]);

  const run = async () => {
    setLoading(true);
    setError("");
    setCopyState("");
    setProgress(7);
    if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = window.setInterval(() => {
      setProgress((prev) => (prev >= 90 ? prev : prev + 7));
    }, 350);

    try {
      const data = await apiRequest("/sim/run", { method: "POST" });
      const parsed = data as DemoResult;
      setResult(parsed);
      setSelectedIndex(0);
      setProgress(100);
      window.dispatchEvent(new CustomEvent("gateway:refresh"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
      setLoading(false);
    }
  };

  const copyToolCall = async (toolCallId?: string) => {
    if (!toolCallId) return;
    try {
      await navigator.clipboard.writeText(toolCallId);
      setCopyState(`Copied ${toolCallId}`);
      setTimeout(() => setCopyState(""), 1500);
    } catch {
      setCopyState("Clipboard unavailable");
      setTimeout(() => setCopyState(""), 1500);
    }
  };

  const exportEvidence = async (format: "json" | "csv") => {
    try {
      setError("");
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_URL}/audit/export?format=${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error(`Export failed with status ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = format === "json" ? "evidence.json" : "evidence.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export evidence");
    }
  };

  return (
    <main className="container-page space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Demo Narrative</h1>
        <p className="text-sm text-slate-600">Run a full policy and approvals flow, then show evidence to investors in one screen.</p>
      </div>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={run} disabled={loading}>
            {loading ? "Running Demo..." : result ? "Replay Demo" : "Run Demo"}
          </button>
          <button className="btn-secondary" onClick={() => exportEvidence("json")} disabled={!result}>
            Export Evidence (JSON)
          </button>
          <button className="btn-secondary" onClick={() => exportEvidence("csv")} disabled={!result}>
            Export Evidence (CSV)
          </button>
        </div>

        {(loading || progress > 0) ? (
          <div>
            <div className="h-2 bg-slate-100 rounded overflow-hidden">
              <div className="h-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-slate-600 mt-1">{loading ? `Executing demo... ${progress}%` : "Demo completed"}</p>
          </div>
        ) : null}

        {copyState ? <p className="text-xs text-emerald-700">{copyState}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </section>

      {result ? (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">6-Step Timeline</h2>
              <span className="text-xs text-slate-500">Pending approvals: {result.pending_approvals_count}</span>
            </div>

            <div className="space-y-2">
              {result.steps.map((step, index) => (
                <button
                  key={`${step.name}-${index}`}
                  onClick={() => setSelectedIndex(index)}
                  className={`w-full text-left border rounded p-3 transition ${selectedIndex === index ? "border-accent bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm">{index + 1}. {step.name}</p>
                    <span className={`text-[11px] px-2 py-1 rounded ${statusClass(step.result?.status)}`}>
                      {statusLabel(step.result?.status)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    risk_score={step.result?.risk_score ?? "n/a"} | reason={step.result?.decision_reason || "n/a"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-600">tool_call_id:</span>
                    <code className="bg-slate-100 px-2 py-1 rounded break-all">{step.result?.tool_call_id || "n/a"}</code>
                    {step.result?.tool_call_id ? (
                      <button
                        className="btn-secondary !px-2 !py-1 !text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          copyToolCall(step.result.tool_call_id);
                        }}
                      >
                        Copy
                      </button>
                    ) : null}
                    {step.result?.approval_request_id ? (
                      <Link
                        href={`/approvals?highlight=${step.result.approval_request_id}`}
                        className="btn-secondary !px-2 !py-1 !text-xs"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Open Approval
                      </Link>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="card space-y-2">
            <h2 className="font-semibold">Step Detail (JSON)</h2>
            {selectedStep ? (
              <pre className="text-xs overflow-auto max-h-[560px] whitespace-pre-wrap">
                {JSON.stringify(selectedStep, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-slate-600">Run demo to inspect details.</p>
            )}
          </div>
        </section>
      ) : (
        <section className="card">
          <p className="text-sm text-slate-600">Press Run Demo to generate a timeline, pending approvals, and audit evidence.</p>
        </section>
      )}
    </main>
  );
}
