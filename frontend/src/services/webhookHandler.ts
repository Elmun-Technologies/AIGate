import { apiRequest, apiRequestWithRetry } from "@/lib/api";
import {
  appendIncidentTimelineEvent,
  loadIncidents,
  setIncidentStatus,
} from "@/src/services/incidentService";
import { recordIntegrationActivityLog } from "@/src/services/eventRouter";

type SignatureInput = {
  signature: string;
  rawBody: string;
  secret: string;
};

type SlackSlashPayload = {
  command?: string;
  text?: string;
  user_name?: string;
  user_id?: string;
  signature?: string;
  raw_body?: string;
};

type PagerDutyWebhookPayload = {
  event_type?: string;
  event?: {
    event_type?: string;
    data?: {
      incident_id?: string;
      id?: string;
      status?: string;
    };
  };
  dedup_key?: string;
  incident_id?: string;
  signature?: string;
  raw_body?: string;
};

type GitHubWebhookPayload = {
  ref?: string;
  commits?: Array<{
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
  signature?: string;
  raw_body?: string;
};

const POLICY_SYNC_KEY = "agentgate_policy_sync_discrepancies_v1";

function envValue(key: string): string {
  if (typeof process === "undefined") return "";
  return (process.env[key] ?? "").trim();
}

function shouldSkipSignatureCheck(): boolean {
  const raw =
    envValue("VITE_SKIP_WEBHOOK_SIGNATURE") ||
    envValue("NEXT_PUBLIC_SKIP_WEBHOOK_SIGNATURE") ||
    "false";
  return raw.toLowerCase() === "true";
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Crypto API unavailable for webhook signature verification");
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toHex(signature);
}

function normalizeSignature(signature: string): string {
  if (signature.startsWith("sha256=")) {
    return signature.slice("sha256=".length);
  }
  return signature;
}

export async function verifyWebhookSignature(input: SignatureInput): Promise<boolean> {
  if (shouldSkipSignatureCheck()) return true;
  if (!input.signature || !input.rawBody || !input.secret) return false;

  const expected = await hmacSha256Hex(input.rawBody, input.secret);
  const incoming = normalizeSignature(input.signature).toLowerCase();
  return incoming === expected;
}

export async function handleSlackSlashCommand(
  payload: SlackSlashPayload,
  secret = envValue("VITE_WEBHOOK_SHARED_SECRET") || envValue("NEXT_PUBLIC_WEBHOOK_SHARED_SECRET"),
): Promise<{ ok: boolean; message: string }> {
  const verified = await verifyWebhookSignature({
    signature: payload.signature ?? "",
    rawBody: payload.raw_body ?? JSON.stringify(payload),
    secret,
  });

  if (!verified) {
    return { ok: false, message: "Signature verification failed" };
  }

  const rawCommand = String(payload.command ?? "").trim();
  const text = String(payload.text ?? "").trim();

  const isApprove = rawCommand.includes("approve") || text.startsWith("approve ") || text.startsWith("/approve ");
  const isDeny = rawCommand.includes("deny") || text.startsWith("deny ") || text.startsWith("/deny ");

  const normalized = text.replace(/^\/(approve|deny)\s+/i, "").replace(/^(approve|deny)\s+/i, "");
  const [requestId = "", ...reasonParts] = normalized.split(" ").filter(Boolean);
  const reason = reasonParts.join(" ").trim();

  if ((!isApprove && !isDeny) || !requestId) {
    return {
      ok: false,
      message: "Invalid command. Use /approve {request_id} {reason} or /deny {request_id} {reason}.",
    };
  }

  const action = isApprove ? "approve" : "reject";
  const decision = isApprove ? "approved" : "denied";

  try {
    await apiRequest(`/approvals/${requestId}/${action}`, {
      method: "POST",
      body: JSON.stringify({ reason: reason || `Decision via Slack slash command by ${payload.user_name ?? payload.user_id ?? "unknown"}` }),
    });

    recordIntegrationActivityLog({
      integration_id: "SLACK",
      integration_name: "Slack",
      event_type: "APPROVAL_DECISION",
      capability_id: "slack_approval_commands",
      capability_label: "Receive approval decisions via slash command",
      direction: "INBOUND",
      status: "SUCCESS",
      message: `Approval ${requestId} ${decision} by ${payload.user_name ?? payload.user_id ?? "unknown"}`,
      attempts: 1,
    });

    return {
      ok: true,
      message: `Request ${requestId} ${decision}. Decision recorded for ${payload.user_name ?? payload.user_id ?? "unknown user"}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update approval";
    recordIntegrationActivityLog({
      integration_id: "SLACK",
      integration_name: "Slack",
      event_type: "APPROVAL_DECISION",
      capability_id: "slack_approval_commands",
      capability_label: "Receive approval decisions via slash command",
      direction: "INBOUND",
      status: "FAILURE",
      message,
      attempts: 1,
    });

    return { ok: false, message };
  }
}

function parsePagerDutyAction(payload: PagerDutyWebhookPayload): "acknowledged" | "resolved" | null {
  const eventType = String(payload.event?.event_type ?? payload.event_type ?? "").toLowerCase();
  if (eventType.includes("ack")) return "acknowledged";
  if (eventType.includes("resolve")) return "resolved";
  return null;
}

function findPagerDutyIncidentId(payload: PagerDutyWebhookPayload): string {
  return String(
    payload.event?.data?.incident_id ||
      payload.event?.data?.id ||
      payload.incident_id ||
      payload.dedup_key ||
      "",
  );
}

export async function handlePagerDutyWebhook(
  payload: PagerDutyWebhookPayload,
  secret = envValue("VITE_WEBHOOK_SHARED_SECRET") || envValue("NEXT_PUBLIC_WEBHOOK_SHARED_SECRET"),
): Promise<{ ok: boolean; message: string; incident_id?: string }> {
  const verified = await verifyWebhookSignature({
    signature: payload.signature ?? "",
    rawBody: payload.raw_body ?? JSON.stringify(payload),
    secret,
  });

  if (!verified) {
    return { ok: false, message: "Signature verification failed" };
  }

  const action = parsePagerDutyAction(payload);
  const pagerDutyId = findPagerDutyIncidentId(payload);

  if (!action || !pagerDutyId) {
    return { ok: false, message: "Unsupported PagerDuty webhook payload" };
  }

  const incident = loadIncidents().find((item) => item.pagerduty_incident_id === pagerDutyId);
  if (!incident) {
    return { ok: false, message: `No local incident mapped to PagerDuty id ${pagerDutyId}` };
  }

  if (action === "acknowledged") {
    setIncidentStatus(incident.id, "INVESTIGATING", "pagerduty-webhook", "PagerDuty acknowledged incident");
    appendIncidentTimelineEvent(
      incident.id,
      "pagerduty-webhook",
      "PAGERDUTY_ACKNOWLEDGED",
      `PagerDuty acknowledged incident ${pagerDutyId}`,
    );
  } else {
    setIncidentStatus(incident.id, "RESOLVED", "pagerduty-webhook", "PagerDuty resolved incident");
    appendIncidentTimelineEvent(
      incident.id,
      "pagerduty-webhook",
      "PAGERDUTY_RESOLVED",
      `PagerDuty resolved incident ${pagerDutyId}`,
    );
  }

  recordIntegrationActivityLog({
    integration_id: "PAGERDUTY",
    integration_name: "PagerDuty",
    event_type: action === "acknowledged" ? "PAGERDUTY_ACK_RECEIVED" : "INCIDENT_RESOLVED",
    capability_id: "pagerduty_ack_sync",
    capability_label: "Sync acknowledgement back to incident status",
    direction: "INBOUND",
    status: "SUCCESS",
    message: `Processed PagerDuty ${action} webhook for ${pagerDutyId}`,
    attempts: 1,
  });

  return {
    ok: true,
    message: `PagerDuty ${action} webhook processed`,
    incident_id: incident.id,
  };
}

export function loadPolicySyncDiscrepancies(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(POLICY_SYNC_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function handleGitHubWebhook(
  payload: GitHubWebhookPayload,
  secret = envValue("VITE_WEBHOOK_SHARED_SECRET") || envValue("NEXT_PUBLIC_WEBHOOK_SHARED_SECRET"),
): Promise<{ ok: boolean; message: string; discrepancies: string[] }> {
  const verified = await verifyWebhookSignature({
    signature: payload.signature ?? "",
    rawBody: payload.raw_body ?? JSON.stringify(payload),
    secret,
  });

  if (!verified) {
    return { ok: false, message: "Signature verification failed", discrepancies: [] };
  }

  if (payload.ref !== "refs/heads/main") {
    return { ok: true, message: "GitHub webhook ignored (not a push to main)", discrepancies: [] };
  }

  const changedFiles = (payload.commits ?? []).flatMap((commit) => [
    ...(commit.added ?? []),
    ...(commit.modified ?? []),
    ...(commit.removed ?? []),
  ]);
  const policyFiles = changedFiles.filter((file) => file.toLowerCase().includes("policy"));

  const policiesData = await apiRequestWithRetry("/policies");
  const activePolicyNames = new Set(
    (Array.isArray(policiesData) ? policiesData : [])
      .filter((policy) => typeof policy === "object" && policy !== null)
      .filter((policy) => (policy as { is_active?: boolean }).is_active)
      .map((policy) => String((policy as { name?: string }).name ?? "").toLowerCase().replace(/\s+/g, "-"))
      .filter(Boolean),
  );

  const discrepancies = policyFiles.filter((filePath) => {
    const fileName = filePath.split("/").pop()?.replace(/\.[^.]+$/, "").toLowerCase() ?? "";
    return fileName && !activePolicyNames.has(fileName);
  });

  if (typeof window !== "undefined") {
    localStorage.setItem(POLICY_SYNC_KEY, JSON.stringify(discrepancies));
    window.dispatchEvent(new CustomEvent("agentgate:policy-sync-updated"));
  }

  recordIntegrationActivityLog({
    integration_id: "GITHUB_ACTIONS",
    integration_name: "GitHub Actions",
    event_type: "GITHUB_PUSH_EVENT",
    capability_id: "gh_trigger_deploy_on_main",
    capability_label: "Trigger policy deployment on merge to main",
    direction: "INBOUND",
    status: discrepancies.length === 0 ? "SUCCESS" : "FAILURE",
    message:
      discrepancies.length === 0
        ? "Policy sync check completed with no discrepancies"
        : `Policy sync discrepancies: ${discrepancies.join(", ")}`,
    attempts: 1,
  });

  return {
    ok: true,
    message:
      discrepancies.length === 0
        ? "Policy sync check completed"
        : "Policy sync discrepancies detected",
    discrepancies,
  };
}
