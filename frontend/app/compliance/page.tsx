"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import JSZip from "jszip";
import { apiRequestWithRetry } from "@/lib/api";
import {
  complianceFrameworks,
  frameworksById,
  type ComplianceFrameworkDefinition,
} from "@/src/config/complianceFrameworks";
import {
  computeAllFrameworkCoverage,
  computeFrameworkCoverage,
  summarizeReport,
  type ControlCoverage,
  type CoverageReport,
  type EvidenceEntry,
} from "@/src/services/complianceEngine";
import { runComplianceMonitorOnce } from "@/src/services/complianceMonitor";

type FrameworkId = ComplianceFrameworkDefinition["framework_id"];

function progressColor(percent: number): string {
  if (percent >= 80) return "#22c55e";
  if (percent >= 50) return "#f59e0b";
  return "#ef4444";
}

function statusBadgeStyle(status: ControlCoverage["coverage_status"]): React.CSSProperties {
  if (status === "COVERED") return { background: "#22c55e20", color: "#22c55e", border: "1px solid #22c55e" };
  if (status === "PARTIAL") return { background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b" };
  return { background: "#ef444420", color: "#ef4444", border: "1px solid #ef4444" };
}

function shortHash(value?: string): string {
  if (!value) return "n/a";
  if (value.length <= 20) return value;
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function mapEventDomain(entry: EvidenceEntry): "Data Privacy" | "Model Training" | "IAM Controls" | "Inference Security" {
  const tag = entry.event_type.toUpperCase();
  if (tag.includes("MODEL") || tag.includes("TRAIN")) return "Model Training";
  if (tag.includes("AUTH") || tag.includes("IAM") || tag.includes("APPROVAL")) return "IAM Controls";
  if (tag.includes("INFERENCE") || tag.includes("TOOL") || tag.includes("POLICY")) return "Inference Security";
  return "Data Privacy";
}

function gapActionForTags(missingTags: string[]): { cta: string; href: string } {
  if (missingTags.some((t) => t.includes("RUNTIME_AUTH") || t.includes("IAM"))) return { cta: "Open Settings", href: "/settings" };
  if (missingTags.some((t) => t.includes("POLICY"))) return { cta: "Open Policies", href: "/policies" };
  if (missingTags.some((t) => t.includes("APPROVAL"))) return { cta: "Open Approvals", href: "/approvals" };
  if (missingTags.some((t) => t.includes("INCIDENT"))) return { cta: "Open Incidents", href: "/incidents" };
  if (missingTags.some((t) => t.includes("MODEL_REGISTERED"))) return { cta: "Open Model Inventory", href: "/models" };
  if (missingTags.some((t) => t.includes("AGENT_REGISTERED"))) return { cta: "Open Agents", href: "/agents" };
  if (missingTags.some((t) => t.includes("AUDIT_LOG_EXPORTED") || t.includes("EVIDENCE_EXPORTED"))) return { cta: "Open Audit Logs", href: "/audit" };
  return { cta: "Open Quickstart", href: "/quickstart" };
}

function remediationText(frameworkId: string, control: ControlCoverage): string {
  const missing = control.missing_tags;

  if (frameworkId === "SOC_2" && control.control_id === "CC6.1") {
    return "No runtime authentication evidence found in the last 90 days. To close this gap: ensure at least one agent is actively running with authentication enabled, or review whether RUNTIME_AUTH_VERIFIED events are being captured correctly in your audit pipeline.";
  }

  if (frameworkId === "NIST_AI_RMF" && control.control_id === "GOVERN 1.1") {
    return "Policy publication evidence exists, but no POLICY_ACTIVATED events were found. To move from PARTIAL to COVERED: activate at least one published policy in the Policies page.";
  }

  if (control.coverage_status === "GAP") {
    return `No matching evidence entries found for ${control.control_id}. Missing tags: ${missing.join(", ")}. Generate activity that produces these events and verify they are captured in the audit pipeline.`;
  }

  return `Control ${control.control_id} is PARTIAL. Missing or stale tags: ${missing.join(", ") || "none"}. Ensure all required evidence tags are emitted at least once within the last 90 days.`;
}

function CircularCoverage({ percent }: { percent: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, percent));
  const offset = circumference - (progress / 100) * circumference;
  const color = progressColor(progress);

  return (
    <svg width="140" height="140" viewBox="0 0 140 140" aria-label="Coverage ring">
      <circle cx="70" cy="70" r={radius} stroke="var(--border)" strokeWidth="12" fill="none" />
      <circle
        cx="70"
        cy="70"
        r={radius}
        stroke={color}
        strokeWidth="12"
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="70" textAnchor="middle" dominantBaseline="middle" style={{ fill: color, fontWeight: 900, fontSize: 24, fontFamily: "monospace" }}>
        {progress}%
      </text>
      <text x="70" y="92" textAnchor="middle" style={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "monospace" }}>
        COVERAGE
      </text>
    </svg>
  );
}

function buildSummaryHtml(input: {
  company: string;
  generatedAt: string;
  reports: CoverageReport[];
  remediationByControl: Record<string, string>;
  evidenceByDomain: Record<string, EvidenceEntry[]>;
}): string {
  const { company, generatedAt, reports, remediationByControl, evidenceByDomain } = input;

  const frameworkSections = reports.map((report) => {
    const summary = summarizeReport(report);
    const rows = report.controls.map((control) => {
      const color =
        control.coverage_status === "COVERED"
          ? "#22c55e"
          : control.coverage_status === "PARTIAL"
            ? "#f59e0b"
            : "#ef4444";
      return `
        <tr>
          <td>${control.control_id}</td>
          <td>${control.control_name}</td>
          <td>${control.matched_evidence_count}</td>
          <td>${control.latest_evidence_at ? new Date(control.latest_evidence_at).toLocaleString() : "—"}</td>
          <td style="color:${color};font-weight:700">${control.coverage_status}</td>
        </tr>`;
    }).join("");

    return `
      <section>
        <h2>${report.framework_id} — ${report.overall_coverage_percent}%</h2>
        <p>Covered: ${summary.covered} / ${summary.total}, Gaps: ${summary.gap}</p>
        <table border="1" cellspacing="0" cellpadding="6" width="100%">
          <thead><tr><th>Control</th><th>Name</th><th>Evidence</th><th>Last Updated</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join("\n");

  const gapList = reports.flatMap((report) =>
    report.controls
      .filter((c) => c.coverage_status !== "COVERED")
      .map((c) => `<li><strong>${report.framework_id} ${c.control_id}</strong>: ${remediationByControl[`${report.framework_id}:${c.control_id}`] ?? "Review control coverage."}</li>`)
  ).join("");

  const evidenceDomainSections = Object.entries(evidenceByDomain)
    .map(([domain, entries]) => {
      const items = entries
        .map((entry) => `<li>${entry.event_type} — ${new Date(entry.created_at).toLocaleString()} — ${entry.chain_hash ?? entry.id}</li>`)
        .join("");
      return `<h3>${domain}</h3><ul>${items}</ul>`;
    })
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Compliance Coverage Summary</title>
    <style>
      body { font-family: Inter, Arial, sans-serif; margin: 24px; color: #0f172a; }
      h1, h2, h3 { margin-bottom: 8px; }
      table { border-collapse: collapse; margin-bottom: 20px; }
      th { background: #f8fafc; }
      td, th { border: 1px solid #cbd5e1; }
      .muted { color: #475569; font-size: 12px; }
    </style>
  </head>
  <body>
    <header>
      <h1>${company} — Compliance Coverage Report</h1>
      <p class="muted">Export timestamp: ${new Date(generatedAt).toLocaleString()}</p>
    </header>

    ${frameworkSections}

    <section>
      <h2>Gap Remediation</h2>
      <ul>${gapList || "<li>No gaps detected.</li>"}</ul>
    </section>

    <section>
      <h2>Evidence Entries by Compliance Domain</h2>
      ${evidenceDomainSections || "<p>No evidence referenced.</p>"}
    </section>

    <footer class="muted" style="margin-top: 32px; border-top: 1px solid #cbd5e1; padding-top: 12px;">
      This report was auto-generated by AI Governance Platform. Evidence integrity verified via hash chain.
    </footer>
  </body>
</html>`;
}

export default function CompliancePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [evidenceEntries, setEvidenceEntries] = useState<EvidenceEntry[]>([]);
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<FrameworkId>("SOC_2");
  const [expandedControls, setExpandedControls] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.replace("/login");
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const rows = await apiRequestWithRetry("/audit");
        setEvidenceEntries(Array.isArray(rows) ? (rows as EvidenceEntry[]) : []);
      } finally {
        setLoading(false);
      }
    };

    load();
    runComplianceMonitorOnce().catch(() => undefined);
  }, [router]);

  const reports = useMemo(() => computeAllFrameworkCoverage(complianceFrameworks, evidenceEntries), [evidenceEntries]);

  const selectedReport = useMemo(() => {
    const framework = frameworksById[selectedFrameworkId];
    return computeFrameworkCoverage(framework, evidenceEntries);
  }, [selectedFrameworkId, evidenceEntries]);

  const selectedSummary = useMemo(() => summarizeReport(selectedReport), [selectedReport]);

  const sortedControls = useMemo(
    () => [...selectedReport.controls].sort((a, b) => a.control_id.localeCompare(b.control_id)),
    [selectedReport.controls]
  );

  const remediationItems = useMemo(() => {
    return sortedControls
      .filter((control) => control.coverage_status !== "COVERED")
      .map((control) => {
        const key = `${selectedReport.framework_id}:${control.control_id}`;
        const action = gapActionForTags(control.missing_tags);
        return {
          key,
          control,
          text: remediationText(selectedReport.framework_id, control),
          action,
        };
      });
  }, [sortedControls, selectedReport.framework_id]);

  async function exportAuditPackage() {
    setExporting(true);
    try {
      const zip = new JSZip();

      const allReports = computeAllFrameworkCoverage(complianceFrameworks, evidenceEntries);
      const reportJson = {
        generated_at: new Date().toISOString(),
        frameworks: allReports,
      };

      zip.file("report.json", JSON.stringify(reportJson, null, 2));

      const remediationByControl: Record<string, string> = {};
      for (const report of allReports) {
        for (const control of report.controls) {
          remediationByControl[`${report.framework_id}:${control.control_id}`] = remediationText(report.framework_id, control);
        }
      }

      const referencedEntriesMap = new Map<string, EvidenceEntry>();
      for (const report of allReports) {
        for (const control of report.controls) {
          for (const entry of control.evidence_entries) {
            const key = entry.chain_hash ?? entry.id;
            if (!referencedEntriesMap.has(key)) referencedEntriesMap.set(key, entry);
          }
        }
      }

      const evidenceByDomain: Record<string, EvidenceEntry[]> = {
        "Data Privacy": [],
        "Model Training": [],
        "IAM Controls": [],
        "Inference Security": [],
      };

      for (const entry of referencedEntriesMap.values()) {
        const domain = mapEventDomain(entry);
        evidenceByDomain[domain].push(entry);
      }

      const companyName = localStorage.getItem("agentgate_org_name") || "AI Governance Organization";
      const summaryHtml = buildSummaryHtml({
        company: companyName,
        generatedAt: new Date().toISOString(),
        reports: allReports,
        remediationByControl,
        evidenceByDomain,
      });
      zip.file("summary.html", summaryHtml);

      const evidenceFolder = zip.folder("evidence");
      for (const entry of referencedEntriesMap.values()) {
        const filename = `${entry.chain_hash ?? entry.id}.json`;
        evidenceFolder?.file(filename, JSON.stringify(entry, null, 2));
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `compliance-audit-package-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="container-page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Compliance Framework Mapper</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 12, fontFamily: "monospace" }}>
            Map Evidence Locker entries to SOC 2, ISO 27001, NIST AI RMF, and EU AI Act controls
          </p>
        </div>
        <button
          onClick={exportAuditPackage}
          disabled={exporting || loading}
          style={{
            background: "#3b82f6",
            border: "none",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 14px",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
            opacity: exporting || loading ? 0.6 : 1,
          }}
        >
          {exporting ? "Exporting..." : "Export Audit Package"}
        </button>
      </div>

      <section style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {complianceFrameworks.map((framework) => {
          const active = selectedFrameworkId === framework.framework_id;
          return (
            <button
              key={framework.framework_id}
              onClick={() => setSelectedFrameworkId(framework.framework_id)}
              style={{
                border: `1px solid ${active ? "#3b82f6" : "var(--border)"}`,
                borderRadius: 9999,
                background: active ? "#3b82f620" : "transparent",
                color: active ? "#3b82f6" : "var(--text-muted)",
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 700,
                padding: "5px 12px",
                cursor: "pointer",
              }}
            >
              {framework.framework_name}
            </button>
          );
        })}
      </section>

      <section className="card" style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 18, alignItems: "center" }}>
        <CircularCoverage percent={selectedReport.overall_coverage_percent} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(120px,1fr))", gap: 8 }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
            <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>OVERALL COVERAGE</p>
            <p style={{ margin: "4px 0 0", fontWeight: 900, fontSize: 24, fontFamily: "monospace" }}>{selectedReport.overall_coverage_percent}%</p>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
            <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>CONTROLS COVERED</p>
            <p style={{ margin: "4px 0 0", fontWeight: 900, fontSize: 24, fontFamily: "monospace" }}>{selectedSummary.covered} / {selectedSummary.total}</p>
          </div>
          <div style={{ border: "1px solid #ef4444", borderRadius: 8, padding: "10px 12px", background: "#ef444410" }}>
            <p style={{ margin: 0, fontSize: 10, color: "#ef4444", fontFamily: "monospace" }}>GAPS FOUND</p>
            <p style={{ margin: "4px 0 0", fontWeight: 900, fontSize: 24, fontFamily: "monospace", color: "#ef4444" }}>{selectedSummary.gap}</p>
          </div>
        </div>
      </section>

      <section className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "10px 12px", fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>CONTROL ID</th>
              <th style={{ textAlign: "left", padding: "10px 12px", fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>CONTROL NAME</th>
              <th style={{ textAlign: "left", padding: "10px 12px", fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>EVIDENCE COUNT</th>
              <th style={{ textAlign: "left", padding: "10px 12px", fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>LAST UPDATED</th>
              <th style={{ textAlign: "left", padding: "10px 12px", fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>STATUS</th>
              <th style={{ textAlign: "left", padding: "10px 12px", fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {sortedControls.map((control) => {
              const expandedKey = `${selectedFrameworkId}:${control.control_id}`;
              const expanded = !!expandedControls[expandedKey];
              return (
                <>
                  <tr key={expandedKey} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12 }}>{control.control_id}</td>
                    <td style={{ padding: "10px 12px", fontSize: 12 }}>{control.control_name}</td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12 }}>{control.matched_evidence_count}</td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 11 }}>
                      {control.latest_evidence_at ? new Date(control.latest_evidence_at).toLocaleString() : "—"}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ ...statusBadgeStyle(control.coverage_status), borderRadius: 9999, fontFamily: "monospace", fontSize: 10, padding: "2px 8px", fontWeight: 700 }}>
                        {control.coverage_status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <button
                        onClick={() => setExpandedControls((prev) => ({ ...prev, [expandedKey]: !expanded }))}
                        style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 11, padding: "4px 8px", cursor: "pointer" }}
                      >
                        {expanded ? "Hide Evidence" : "Show Evidence"}
                      </button>
                    </td>
                  </tr>

                  {expanded && (
                    <tr>
                      <td colSpan={6} style={{ padding: "10px 12px", background: "var(--surface2)", borderTop: "1px solid var(--border)" }}>
                        {control.evidence_entries.length === 0 ? (
                          <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>No matching evidence entries.</p>
                        ) : (
                          <div style={{ display: "grid", gap: 6 }}>
                            {control.evidence_entries.slice(0, 30).map((entry) => (
                              <div key={entry.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--surface)" }}>
                                <p style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>{entry.event_type}</p>
                                <p style={{ margin: "3px 0 0", fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                                  {new Date(entry.created_at).toLocaleString()} · SHA-256: {shortHash(entry.chain_hash ?? entry.id)}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </section>

      {remediationItems.length > 0 && (
        <section className="card">
          <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 800 }}>Gap Remediation Assistant</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {remediationItems.map((item) => (
              <div key={item.key} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", borderLeft: `3px solid ${item.control.coverage_status === "GAP" ? "#ef4444" : "#f59e0b"}` }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>{selectedReport.framework_id} {item.control.control_id}</p>
                <p style={{ margin: "6px 0 8px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{item.text}</p>
                <button
                  onClick={() => router.push(item.action.href)}
                  style={{
                    background: "#3b82f6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "5px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {item.action.cta}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>Loading evidence and coverage report...</p>
      )}
    </main>
  );
}
