import type { ComplianceFrameworkDefinition } from "@/src/config/complianceFrameworks";

export type CoverageStatus = "COVERED" | "PARTIAL" | "GAP";

export type EvidenceEntry = {
  id: string;
  event_type: string;
  created_at: string;
  chain_hash?: string;
  decision?: string;
  risk_score?: number;
  stream_id?: string;
  payload_redacted_json?: Record<string, unknown>;
};

export type ControlCoverage = {
  control_id: string;
  control_name: string;
  required_evidence_tags: string[];
  matched_evidence_count: number;
  latest_evidence_at: string | null;
  coverage_status: CoverageStatus;
  evidence_entries: EvidenceEntry[];
  matched_tags: string[];
  missing_tags: string[];
};

export type CoverageReport = {
  framework_id: string;
  overall_coverage_percent: number;
  controls: ControlCoverage[];
};

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const EVENT_TAG_ALIASES: Record<string, string[]> = {
  // Runtime auth + IAM
  RUNTIME_AUTH_VERIFIED: ["RUNTIME_AUTH_VERIFIED", "RUNTIME_AUTH_VALIDATE", "RUNTIME_AUTH_CHECKED"],
  RUNTIME_AUTH_ISSUED: ["RUNTIME_AUTH_ISSUED", "RUNTIME_TOKEN_ISSUED", "RUNTIME_AUTH_TOKEN_ISSUED"],
  IAM_ROLE_ASSIGNED: ["IAM_ROLE_ASSIGNED", "ROLE_ASSIGNED", "USER_ROLE_ASSIGNED"],

  // Execution and policy path
  TOOL_EXECUTED: ["TOOL_EXECUTED", "TOOL_CALL_EXECUTED", "TOOL_CALL", "TOOL_CALL_CREATED"],
  POLICY_TRIGGERED: ["POLICY_TRIGGERED", "POLICY_EVALUATED", "POLICY_MATCHED", "POLICY_BLOCKED"],
  APPROVAL_DECISION: ["APPROVAL_DECISION", "APPROVAL_RESOLVED", "APPROVAL_APPROVED", "APPROVAL_DENIED"],
  AUDIT_LOG_EXPORTED: ["AUDIT_LOG_EXPORTED", "AUDIT_EXPORT", "AUDIT_PACK_EXPORTED"],
  ANOMALY_DETECTED: ["ANOMALY_DETECTED", "SPEND_ANOMALY_DETECTED", "RISK_ANOMALY_DETECTED"],

  // Incident lifecycle
  INCIDENT_CREATED: ["INCIDENT_CREATED"],
  INCIDENT_RESOLVED: ["INCIDENT_RESOLVED"],
  SLA_BREACH_NOTIFIED: ["SLA_BREACH_NOTIFIED"],

  // Policies and model/agent inventory
  POLICY_PUBLISHED: ["POLICY_PUBLISHED", "POLICY_CREATED", "POLICY_UPDATED"],
  POLICY_ACTIVATED: ["POLICY_ACTIVATED", "POLICY_ENABLED"],
  AGENT_REGISTERED: ["AGENT_REGISTERED", "AGENT_CREATED"],
  MODEL_REGISTERED: ["MODEL_REGISTERED"],
  EVIDENCE_EXPORTED: ["EVIDENCE_EXPORTED", "EVIDENCE_PACKAGE_EXPORTED"],
};

function toCanonicalTag(rawEventType: string): string {
  return rawEventType.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function tagMatchesRequiredTag(evidenceTag: string, requiredTag: string): boolean {
  const requiredAliases = EVENT_TAG_ALIASES[requiredTag] ?? [requiredTag];
  if (requiredAliases.includes(evidenceTag)) return true;

  // Fallback fuzzy matching so custom pipeline tags still map
  return requiredAliases.some((alias) => evidenceTag.includes(alias) || alias.includes(evidenceTag));
}

/**
 * Determines whether an evidence entry is inside the compliance recency window.
 *
 * Business rationale:
 * Compliance frameworks require continuous control operation, not one-time setup.
 * A control can only be considered fully covered when recent evidence exists.
 */
export function isEvidenceRecent(createdAt: string, now = Date.now()): boolean {
  const ts = new Date(createdAt).getTime();
  if (Number.isNaN(ts)) return false;
  return now - ts <= NINETY_DAYS_MS;
}

/**
 * Computes coverage status for a single control.
 *
 * Inputs:
 * - requiredTags: Control's evidence tags from framework definition
 * - evidenceEntries: Full evidence dataset (already filtered for the framework run)
 *
 * Output:
 * - ControlCoverage with matched entries, missing tags and coverage status.
 *
 * Decision logic:
 * - GAP: no evidence matched any required tag.
 * - PARTIAL:
 *   - some but not all required tags matched, OR
 *   - all tags matched but latest evidence is older than 90 days.
 * - COVERED:
 *   - all required tags matched and at least one match within 90 days.
 */
export function computeControlCoverage(
  controlId: string,
  controlName: string,
  requiredTags: string[],
  evidenceEntries: EvidenceEntry[],
  now = Date.now()
): ControlCoverage {
  const normalizedEvidence = evidenceEntries.map((entry) => ({
    ...entry,
    _tag: toCanonicalTag(entry.event_type),
  }));

  const matchedEntries = normalizedEvidence
    .filter((entry) => requiredTags.some((required) => tagMatchesRequiredTag(entry._tag, required)))
    .map(({ _tag: _, ...rest }) => rest);

  const matchedTags = requiredTags.filter((required) =>
    normalizedEvidence.some((entry) => tagMatchesRequiredTag(entry._tag, required))
  );

  const missingTags = requiredTags.filter((tag) => !matchedTags.includes(tag));

  const latestEvidenceAt = matchedEntries.length
    ? [...matchedEntries].sort((a, b) => b.created_at.localeCompare(a.created_at))[0].created_at
    : null;

  let coverageStatus: CoverageStatus;
  if (matchedEntries.length === 0) {
    coverageStatus = "GAP";
  } else {
    const allTagsMatched = missingTags.length === 0;
    const hasRecentEvidence = matchedEntries.some((entry) => isEvidenceRecent(entry.created_at, now));

    if (allTagsMatched && hasRecentEvidence) coverageStatus = "COVERED";
    else coverageStatus = "PARTIAL";
  }

  return {
    control_id: controlId,
    control_name: controlName,
    required_evidence_tags: requiredTags,
    matched_evidence_count: matchedEntries.length,
    latest_evidence_at: latestEvidenceAt,
    coverage_status: coverageStatus,
    evidence_entries: matchedEntries,
    matched_tags: matchedTags,
    missing_tags: missingTags,
  };
}

/**
 * Pure coverage engine for one framework.
 *
 * Inputs:
 * - framework: Framework definition with controls and required evidence tags.
 * - evidenceEntries: All evidence entries from Evidence Locker.
 * - now: Optional timestamp for deterministic unit tests.
 *
 * Output:
 * - CoverageReport with per-control status and aggregate coverage percentage.
 *
 * Business logic rationale:
 * - overall_coverage_percent uses strict covered-controls ratio:
 *   covered_controls / total_controls * 100
 *   This mirrors auditor interpretation where partially met controls
 *   still need remediation work.
 */
export function computeFrameworkCoverage(
  framework: ComplianceFrameworkDefinition,
  evidenceEntries: EvidenceEntry[],
  now = Date.now()
): CoverageReport {
  const controls = framework.controls.map((control) =>
    computeControlCoverage(
      control.control_id,
      control.control_name,
      control.evidence_tags,
      evidenceEntries,
      now
    )
  );

  const coveredCount = controls.filter((c) => c.coverage_status === "COVERED").length;
  const overall = controls.length > 0
    ? Math.round((coveredCount / controls.length) * 100)
    : 0;

  return {
    framework_id: framework.framework_id,
    overall_coverage_percent: overall,
    controls,
  };
}

/**
 * Computes reports for all frameworks in one pass.
 *
 * Inputs:
 * - frameworks: list of framework definitions
 * - evidenceEntries: shared evidence pool
 * - now: optional timestamp for deterministic test runs
 */
export function computeAllFrameworkCoverage(
  frameworks: ComplianceFrameworkDefinition[],
  evidenceEntries: EvidenceEntry[],
  now = Date.now()
): CoverageReport[] {
  return frameworks.map((framework) => computeFrameworkCoverage(framework, evidenceEntries, now));
}

/**
 * Utility to summarize status counts for UI scorecards.
 */
export function summarizeReport(report: CoverageReport) {
  const covered = report.controls.filter((c) => c.coverage_status === "COVERED").length;
  const partial = report.controls.filter((c) => c.coverage_status === "PARTIAL").length;
  const gap = report.controls.filter((c) => c.coverage_status === "GAP").length;
  return {
    covered,
    partial,
    gap,
    total: report.controls.length,
  };
}
