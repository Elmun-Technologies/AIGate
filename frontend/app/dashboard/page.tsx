"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api";

type Counts = {
  tool_calls_count: number;
  pending_count: number;
  blocked_count: number;
  executed_count: number;
  pending_approvals_count: number;
  last_demo_result?: {
    executed: number;
    blocked: number;
    pending: number;
  };
};

export default function DashboardPage() {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts>({
    tool_calls_count: 0,
    pending_count: 0,
    blocked_count: 0,
    executed_count: 0,
    pending_approvals_count: 0,
    last_demo_result: { executed: 0, blocked: 0, pending: 0 },
  });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const metrics = await apiRequest("/dashboard/metrics");
      setCounts(metrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
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

  return (
    <main className="container-page space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-600">Real-time inline enforcement metrics.</p>
      </div>

      {error ? <p className="text-red-600 text-sm">{error}</p> : null}

      <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="card"><p className="text-xs text-slate-500">Tool Calls</p><p className="text-2xl font-semibold">{counts.tool_calls_count}</p></div>
        <div className="card"><p className="text-xs text-slate-500">Pending</p><p className="text-2xl font-semibold">{counts.pending_count}</p></div>
        <div className="card"><p className="text-xs text-slate-500">Blocked</p><p className="text-2xl font-semibold">{counts.blocked_count}</p></div>
        <div className="card"><p className="text-xs text-slate-500">Executed</p><p className="text-2xl font-semibold">{counts.executed_count}</p></div>
        <div className="card"><p className="text-xs text-slate-500">Pending Approvals</p><p className="text-2xl font-semibold">{counts.pending_approvals_count}</p></div>
      </section>

      <section className="card flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Last Demo Result</h2>
          <p className="text-sm text-slate-600">
            executed={counts.last_demo_result?.executed ?? 0} | blocked={counts.last_demo_result?.blocked ?? 0} | pending={counts.last_demo_result?.pending ?? 0}
          </p>
        </div>
        <div className="flex gap-2">
          <Link className="btn-secondary" href="/audit">View Audit</Link>
          <Link className="btn-primary" href="/simulators">Run Demo</Link>
        </div>
      </section>
    </main>
  );
}
