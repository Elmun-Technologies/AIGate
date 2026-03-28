import { complianceFrameworks } from "@/src/config/complianceFrameworks";
import {
  computeAllFrameworkCoverage,
  summarizeReport,
  type CoverageReport,
  type EvidenceEntry,
} from "@/src/services/complianceEngine";
import { createComplianceGapIncident } from "@/src/services/incidentService";
import { sendComplianceGapNotification } from "@/lib/notificationService";
import { apiRequestWithRetry } from "@/lib/api";
import { routeEvent } from "@/src/services/eventRouter";

export type ComplianceHealthLevel = "green" | "yellow" | "red";

export type ComplianceHealthItem = {
  framework_id: string;
  coverage_percent: number;
  health: ComplianceHealthLevel;
  gap_controls: number;
};

const STORAGE_KEY = "agentgate_compliance_health_v1";

let monitorTimer: ReturnType<typeof setInterval> | null = null;

function envValue(key: string): string {
  if (typeof process === "undefined") return "";
  return (process.env[key] ?? "").trim();
}

function toHealth(coverage: number): ComplianceHealthLevel {
  if (coverage >= 80) return "green";
  if (coverage >= 50) return "yellow";
  return "red";
}

function saveHealth(items: ComplianceHealthItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("agentgate:compliance-health-updated", { detail: items }));
}

export function loadComplianceHealth(): ComplianceHealthItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ComplianceHealthItem[]) : [];
  } catch {
    return [];
  }
}

async function fetchEvidenceEntries(): Promise<EvidenceEntry[]> {
  const rows = await apiRequestWithRetry("/audit");
  return Array.isArray(rows) ? (rows as EvidenceEntry[]) : [];
}

async function evaluateAndReact(reports: CoverageReport[]): Promise<void> {
  const healthItems: ComplianceHealthItem[] = reports.map((report) => {
    const summary = summarizeReport(report);
    return {
      framework_id: report.framework_id,
      coverage_percent: report.overall_coverage_percent,
      health: toHealth(report.overall_coverage_percent),
      gap_controls: summary.gap,
    };
  });

  saveHealth(healthItems);

  for (const report of reports) {
    await routeEvent({
      type: "COMPLIANCE_REPORT_GENERATED",
      payload: report,
    });

    if (report.overall_coverage_percent >= 80) continue;

    const droppedControls = report.controls.filter((c) => c.coverage_status !== "COVERED");

    await createComplianceGapIncident({
      frameworkId: report.framework_id,
      overallCoverage: report.overall_coverage_percent,
      droppedControls,
    });

    sendComplianceGapNotification({
      frameworkId: report.framework_id,
      overallCoverage: report.overall_coverage_percent,
      droppedControls: droppedControls.map((c) => ({
        control_id: c.control_id,
        reason: c.coverage_status === "GAP" ? "No evidence" : "Partial/stale evidence",
      })),
    });
  }
}

/**
 * Runs one compliance monitor cycle immediately.
 *
 * Business behavior:
 * - Recomputes framework coverage from audit evidence.
 * - Updates compliance health snapshot for dashboard widgets.
 * - Creates HIGH incidents for frameworks below 80%.
 * - Sends compliance gap notifications with dropped controls.
 */
export async function runComplianceMonitorOnce(): Promise<CoverageReport[]> {
  const evidenceEntries = await fetchEvidenceEntries();
  const reports = computeAllFrameworkCoverage(complianceFrameworks, evidenceEntries);
  await evaluateAndReact(reports);
  return reports;
}

/**
 * Starts background compliance monitoring.
 *
 * Interval policy:
 * - Production default: 24 hours.
 * - Development default: 60 seconds.
 * - Override with NEXT_PUBLIC_COMPLIANCE_MONITOR_INTERVAL_MS.
 */
export function startComplianceMonitor(): void {
  if (monitorTimer) return;

  const override = Number(envValue("NEXT_PUBLIC_COMPLIANCE_MONITOR_INTERVAL_MS"));
  const appEnv = envValue("NEXT_PUBLIC_APP_ENV") || "development";
  const defaultMs = appEnv === "production" ? 24 * 60 * 60 * 1000 : 60 * 1000;
  const intervalMs = Number.isFinite(override) && override > 0 ? override : defaultMs;

  runComplianceMonitorOnce().catch(() => undefined);
  monitorTimer = setInterval(() => {
    runComplianceMonitorOnce().catch(() => undefined);
  }, intervalMs);
}

export function stopComplianceMonitor(): void {
  if (!monitorTimer) return;
  clearInterval(monitorTimer);
  monitorTimer = null;
}
