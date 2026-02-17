"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api";

type Approval = {
  id: string;
  tool_call_id: string;
  status: string;
  reason: string | null;
  created_at: string;
};

type ToolCall = {
  id: string;
  risk_score: number;
  decision_reason: string;
  status: string;
  created_at: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function ApprovalsPage() {
  const router = useRouter();
  const [highlightedApproval, setHighlightedApproval] = useState("");

  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busyApprovalId, setBusyApprovalId] = useState("");

  const toolCallMap = useMemo(() => {
    return Object.fromEntries(toolCalls.map((item) => [item.id, item]));
  }, [toolCalls]);

  const load = async () => {
    try {
      setError("");
      const [pendingApprovals, calls] = await Promise.all([
        apiRequest("/approvals?status=pending"),
        apiRequest("/tool-calls"),
      ]);
      setApprovals(pendingApprovals);
      setToolCalls(calls);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals");
    }
  };

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    setHighlightedApproval(params.get("highlight") || "");
    load();
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForToolCallStatus = async (toolCallId: string, expected: "executed" | "blocked") => {
    for (let i = 0; i < 10; i += 1) {
      const calls = await apiRequest("/tool-calls");
      const match = (calls || []).find((item: ToolCall) => item.id === toolCallId);
      if (match?.status === expected) return match.status;
      if (match?.status === "blocked" || match?.status === "executed") return match.status;
      await sleep(700);
    }
    return "unknown";
  };

  const action = async (id: string, type: "approve" | "reject") => {
    const reason = reasonById[id] || `${type}d via UI`;
    setError("");
    setBusyApprovalId(id);
    try {
      const approval = await apiRequest(`/approvals/${id}/${type}`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      const expected = type === "approve" ? "executed" : "blocked";
      const finalStatus = await waitForToolCallStatus(approval.tool_call_id, expected);
      setToast(`Approval ${type}d. Tool call ${approval.tool_call_id} final status: ${finalStatus}.`);
      await load();
      localStorage.setItem("gateway:refresh-at", String(Date.now()));
      window.dispatchEvent(new CustomEvent("gateway:refresh"));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${type}`);
    } finally {
      setBusyApprovalId("");
    }
  };

  return (
    <main className="container-page space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <button className="btn-secondary" onClick={load}>Refresh</button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {toast ? <p className="text-sm text-emerald-700">{toast}</p> : null}

      <section className="card space-y-3">
        {approvals.length === 0 ? <p className="text-sm text-slate-600">No pending approvals.</p> : null}
        {approvals.map((approval) => {
          const relatedToolCall = toolCallMap[approval.tool_call_id];
          const highlight = highlightedApproval === approval.id;
          return (
            <div
              id={`approval-${approval.id}`}
              key={approval.id}
              className={`border rounded p-3 space-y-2 ${highlight ? "border-accent bg-teal-50" : "border-slate-200"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">Approval {approval.id}</p>
                <span className="text-xs text-slate-500">{formatDate(approval.created_at)}</span>
              </div>
              <p className="text-sm text-slate-700"><span className="font-medium">tool_call_id:</span> <code>{approval.tool_call_id}</code></p>
              <p className="text-sm text-slate-700"><span className="font-medium">risk_score:</span> {relatedToolCall?.risk_score ?? "n/a"}</p>
              <p className="text-sm text-slate-700"><span className="font-medium">reason:</span> {relatedToolCall?.decision_reason || approval.reason || "n/a"}</p>

              <input
                className="input"
                placeholder="Decision reason"
                value={reasonById[approval.id] || ""}
                onChange={(event) => setReasonById((prev) => ({ ...prev, [approval.id]: event.target.value }))}
              />
              <div className="flex gap-2">
                <button
                  className="btn-primary"
                  onClick={() => action(approval.id, "approve")}
                  disabled={busyApprovalId === approval.id}
                >
                  {busyApprovalId === approval.id ? "Working..." : "Approve"}
                </button>
                <button
                  className="btn-danger"
                  onClick={() => action(approval.id, "reject")}
                  disabled={busyApprovalId === approval.id}
                >
                  {busyApprovalId === approval.id ? "Working..." : "Reject"}
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
