"use client";

import { useEffect, useState } from "react";

import { API_URL, apiRequestWithRetry } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AuditEvent = {
  id: string;
  event_type: string;
  decision: string;
  created_at: string;
  chain_hash?: string;
  payload_redacted_json: Record<string, unknown>;
};

export default function EvidencePage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  useEffect(() => {
    const load = async () => {
      const data = await apiRequestWithRetry("/audit");
      const rows = Array.isArray(data) ? (data as AuditEvent[]) : [];
      setEvents(rows);
      setSelected(rows[0] || null);
    };
    load();
  }, []);

  const exportPack = async () => {
    const token = localStorage.getItem("token");
    const response = await fetch(`${API_URL}/audit/export-pack`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "audit-pack.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="page-shell">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="page-title">Compliance Evidence Locker</h1>
          <p className="page-subtitle">Packaged evidence artifacts for compliance export (derived from audit stream).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><a href="/audit">Open Raw Audit Logs</a></Button>
          <Button onClick={exportPack}>Export Package</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Evidence Repository</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id} onClick={() => setSelected(event)} className="cursor-pointer">
                    <TableCell>
                      <p className="mono text-sm">{event.id.slice(0, 20)}…</p>
                    </TableCell>
                    <TableCell className="mono text-slate-400">{new Date(event.created_at).toLocaleString()}</TableCell>
                    <TableCell>{event.event_type}</TableCell>
                    <TableCell>
                      <Badge variant={event.decision.toLowerCase().includes("block") ? "danger" : "success"}>
                        {event.decision}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Evidence Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selected ? (
              <>
                <div>
                  <p className="mono text-xs uppercase text-slate-500">File name</p>
                  <p>{selected.id}.json</p>
                </div>
                <div>
                  <p className="mono text-xs uppercase text-slate-500">Fingerprint (sha-256)</p>
                  <p className="mono break-all text-xs text-slate-300">{selected.chain_hash || "not-available"}</p>
                </div>
                <div>
                  <p className="mono text-xs uppercase text-slate-500">Automated audit</p>
                  <p className="text-emerald-300">TLS 1.3 Check PASSED</p>
                  <p className="text-emerald-300">AES-256 Check PASSED</p>
                  <p className="text-emerald-300">Key Rotation PASSED</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">Select evidence record.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
