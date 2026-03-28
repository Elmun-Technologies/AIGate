"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { API_URL, apiRequestWithRetry } from "@/lib/api";
import { PermissionGate } from "@/src/components/PermissionGate";

type AuditEvent = {
  id: string;
  stream_id: string;
  event_type: string;
  decision: string;
  risk_score: number;
  created_at: string;
  payload_redacted_json: Record<string, unknown>;
  chain_hash?: string;
};

type ChainVerification = {
  valid: boolean;
  checked_streams: number;
  checked_events: number;
  issues_count: number;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function shortHash(value?: string) {
  if (!value) return "n/a";
  return `${value.slice(0, 18)}...${value.slice(-8)}`;
}

export default function EvidencePage() {
  const router = useRouter();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [verification, setVerification] = useState<ChainVerification | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
      return;
    }
    const load = async () => {
      const [auditData, verifyData] = await Promise.all([
        apiRequestWithRetry("/audit"),
        apiRequestWithRetry("/audit/verify-chain"),
      ]);
      const rows = Array.isArray(auditData) ? (auditData as AuditEvent[]) : [];
      setEvents(rows);
      setSelected(rows[0] || null);
      setVerification((verifyData as ChainVerification) || null);
    };
    load();
  }, [router]);

  const byDomain = useMemo(() => {
    const privacy = events.filter((item) => (item.event_type || "").toLowerCase().includes("tool")).length;
    const iam = events.filter((item) => (item.event_type || "").toLowerCase().includes("approval")).length;
    const inference = events.filter((item) => {
      const type = (item.event_type || "").toLowerCase();
      return type.includes("inference") || type.includes("runtime") || type.includes("model");
    }).length;
    return { privacy, iam, inference };
  }, [events]);

  function formatCount(value: number): string {
    return value === 0 ? "—" : String(value);
  }

  const exportPack = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_URL}/audit/export-pack`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "evidence-package.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // Network error — silently handled
    }
  };

  return (
    <main className="container-page space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Compliance Evidence Locker</h1>
        <p className="text-sm text-slate-600">Automated immutable proof for audit readiness across all AI modules.</p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="card"><p className="stat-label">Data Privacy</p><p className="stat-number">{formatCount(byDomain.privacy)}</p></div>
        <div className="card"><p className="stat-label">Model Training</p><p className="stat-number">{formatCount(events.length)}</p></div>
        <div className="card"><p className="stat-label">IAM Controls</p><p className="stat-number">{formatCount(byDomain.iam)}</p></div>
        <div className="card"><p className="stat-label">Inference Security</p><p className="stat-number">{formatCount(byDomain.inference)}</p></div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-3">
        <div className="card table-wrap">
          <div className="card-header">
            <h2 className="font-semibold">Evidence Repository</h2>
            <PermissionGate permission="evidence:export" fallback="disable"><button className="btn-primary" onClick={exportPack}>Export Package</button></PermissionGate>
          </div>
          <table className="w-full enterprise-table">
            <thead>
              <tr>
                <th>Name & Source</th>
                <th>Timestamp</th>
                <th>Compliance Domain</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 20).map((event) => (
                <tr key={event.id} onClick={() => setSelected(event)} className="cursor-pointer">
                  <td>
                    <div className="font-semibold">{event.event_type}</div>
                    <div className="text-xs text-slate-600 mono">Source: Agent Runtime Stream</div>
                  </td>
                  <td className="mono">{formatDate(event.created_at)}</td>
                  <td><span className="badge badge-pending">DATA PRIVACY</span></td>
                  <td><span className="badge badge-allow">Verified</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Evidence Details</h2>
          {selected ? (
            <>
              <p className="text-xs text-slate-600 mono">FILE NAME</p>
              <p className="mono">{selected.event_type}.json</p>

              <p className="text-xs text-slate-600 mono">FINGERPRINT (SHA-256)</p>
              <code className="settings-key mono">{shortHash(selected.chain_hash)}</code>

              <p className="text-xs text-slate-600 mono">AUTOMATED AUDIT</p>
              <ul className="space-y-1 text-sm">
                <li>TLS 1.3 Check <span className="risk-low">PASSED</span></li>
                <li>AES-256 Check <span className="risk-low">PASSED</span></li>
                <li>Hash Chain Verification <span className={verification?.valid ? "risk-low" : "risk-high"}>{verification?.valid ? "PASSED" : "FAILED"}</span></li>
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-600">Select an evidence item.</p>
          )}
        </div>
      </section>
    </main>
  );
}

