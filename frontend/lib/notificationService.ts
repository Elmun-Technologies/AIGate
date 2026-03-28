/**
 * lib/notificationService.ts
 *
 * Notification service for SLA breach alerts.
 * Integrations:
 *   - Slack  → real fetch() to Incoming Webhook (Block Kit format)
 *   - Email  → real fetch() via /api/send-email proxy (Resend)
 *   - In-app → localStorage store + CustomEvent broadcast
 *   - Audit  → POST /audit/events with event_type "SLA_BREACH_NOTIFIED"
 *              or "NOTIFICATION_FAILED"
 *
 * All external calls use a shared retryWithBackoff() wrapper (2 retries,
 * 2 s delay) and return a NotificationResult so callers can surface errors.
 */

import { apiRequest } from "@/lib/api";
import { env } from "@/lib/env";
import { routeEvent } from "@/src/services/eventRouter";

// ── Types (extended from Prompt 2, not replaced) ───────────────────────────────

export type NotificationPayload = {
  request_id: string;
  agent_id: string;
  action_type: string;
  risk_score: number;
  sla_breached_at: string;
  overdue_ms: number;
  approver_email: string;
  slack_webhook_url: string;
};

export type InAppNotification = {
  id: string;
  kind: "sla_breach" | "early_warning" | "compliance_gap";
  title: string;
  body: string;
  request_id: string;
  risk_score: number;
  action_type: string;
  created_at: string;
  read: boolean;
};

export type EscalationConfig = {
  slack_webhook_url: string;
  approver_email: string;
  notify_on_escalation: boolean;
  notify_early_warning: boolean;
};

/** Returned by every external send function. */
export type NotificationResult = {
  success: boolean;
  channel: "slack" | "email";
  error?: string;
};

// ── Config storage ─────────────────────────────────────────────────────────────

const CONFIG_KEY = "agentgate_escalation_config";
const NOTIFS_KEY = "agentgate_notifications";

const DEFAULT_CONFIG: EscalationConfig = {
  slack_webhook_url: env.SLACK_WEBHOOK_URL,
  approver_email: env.APPROVER_EMAIL,
  notify_on_escalation: true,
  notify_early_warning: false,
};

export function loadEscalationConfig(): EscalationConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<EscalationConfig>) };
  } catch { /* ignore */ }
  return DEFAULT_CONFIG;
}

export function saveEscalationConfig(cfg: EscalationConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

// ── In-app store ───────────────────────────────────────────────────────────────

export function loadNotifications(): InAppNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(NOTIFS_KEY);
    return raw ? (JSON.parse(raw) as InAppNotification[]) : [];
  } catch { return []; }
}

function saveNotifications(notifs: InAppNotification[]): void {
  localStorage.setItem(NOTIFS_KEY, JSON.stringify(notifs.slice(0, 100)));
}

function appendNotification(notif: InAppNotification): void {
  const existing = loadNotifications();
  const alreadyExists = existing.some(
    (n) => n.request_id === notif.request_id && n.kind === notif.kind
  );
  if (alreadyExists) return;
  saveNotifications([notif, ...existing]);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("agentgate:notification", { detail: notif }));
  }
}

export function markAllRead(): void {
  saveNotifications(loadNotifications().map((n) => ({ ...n, read: true })));
  window.dispatchEvent(new CustomEvent("agentgate:notifications-read"));
}

export function markOneRead(id: string): void {
  saveNotifications(
    loadNotifications().map((n) => (n.id === id ? { ...n, read: true } : n))
  );
  window.dispatchEvent(new CustomEvent("agentgate:notifications-read"));
}

// ── Retry helper ───────────────────────────────────────────────────────────────

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 2000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

function isMockIntegrations(): boolean {
  const raw =
    (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MOCK_INTEGRATIONS ?? "" : "") ||
    (typeof process !== "undefined" ? process.env.VITE_MOCK_INTEGRATIONS ?? "" : "") ||
    "true";
  return raw.toLowerCase() === "true";
}

// ── Audit log helpers ──────────────────────────────────────────────────────────

async function writeAuditEvent(
  payload: NotificationPayload,
  channel: string,
  eventType: "SLA_BREACH_NOTIFIED" | "NOTIFICATION_FAILED",
  errorMsg?: string
): Promise<void> {
  try {
    await apiRequest("/audit/events", {
      method: "POST",
      body: JSON.stringify({
        event_type: eventType,
        agent_id: payload.agent_id,
        tool_call_id: payload.request_id,
        decision: eventType === "NOTIFICATION_FAILED" ? "error" : "escalated",
        risk_score: payload.risk_score,
        details: {
          channel,
          action_type: payload.action_type,
          sla_breached_at: payload.sla_breached_at,
          overdue_ms: payload.overdue_ms,
          approver_email: payload.approver_email,
          ...(errorMsg ? { error: errorMsg } : {}),
        },
      }),
    });
  } catch {
    console.warn("[notificationService] audit write failed (best-effort)");
  }
}

// ── Slack Block Kit builder ────────────────────────────────────────────────────

function buildSlackBlocks(payload: NotificationPayload, overdueMin: number, origin: string) {
  const sidebarColor = payload.risk_score >= 90 ? "#ef4444" : "#f59e0b";

  return {
    text: `SLA BREACH: ${payload.action_type} from agent ${payload.agent_id}`,
    attachments: [
      {
        color: sidebarColor,
        blocks: [
          // Header
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "SLA Breach — Action Required",
              emoji: true,
            },
          },
          // Two-column details section
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Agent ID*\n\`${payload.agent_id.slice(0, 12)}...\`` },
              { type: "mrkdwn", text: `*Action Type*\n${payload.action_type}` },
              { type: "mrkdwn", text: `*Risk Score*\n${payload.risk_score} / 100` },
              { type: "mrkdwn", text: `*Time Overdue*\n${overdueMin} minutes` },
              { type: "mrkdwn", text: `*Request ID*\n\`${payload.request_id.slice(0, 12)}...\`` },
              {
                type: "mrkdwn",
                text: `*SLA Breached At*\n${new Date(payload.sla_breached_at).toLocaleString()}`,
              },
            ],
          },
          // Divider
          { type: "divider" },
          // Action buttons
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Approve", emoji: true },
                style: "primary",
                url: `${origin}/approvals?id=${payload.request_id}&action=approve`,
                action_id: "approve_request",
              },
              {
                type: "button",
                text: { type: "plain_text", text: "Deny", emoji: true },
                style: "danger",
                url: `${origin}/approvals?id=${payload.request_id}&action=deny`,
                action_id: "deny_request",
              },
              {
                type: "button",
                text: { type: "plain_text", text: "View Queue", emoji: true },
                url: `${origin}/approvals`,
                action_id: "view_queue",
              },
            ],
          },
          // Footer context
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `AgentGate · AI Governance Platform · ${env.APP_ENV.toUpperCase()} environment`,
              },
            ],
          },
        ],
      },
    ],
  };
}

// ── Email HTML/text builder ────────────────────────────────────────────────────

function buildEmailHtml(payload: NotificationPayload, overdueMin: number, origin: string): string {
  const riskColor = payload.risk_score >= 90 ? "#ef4444" : "#f59e0b";
  const riskLabel =
    payload.risk_score >= 90 ? "CRITICAL" : payload.risk_score >= 70 ? "HIGH" : "MEDIUM";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SLA Breach Alert</title></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Segoe UI',Arial,sans-serif;color:#e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1d27;border-radius:12px;overflow:hidden;border:1px solid #2d3048;">
        <!-- Header -->
        <tr>
          <td style="background:${riskColor};padding:20px 32px;">
            <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.8);letter-spacing:2px;text-transform:uppercase;font-family:monospace;">AgentGate · AI Governance</p>
            <h1 style="margin:8px 0 0;font-size:22px;font-weight:800;color:#fff;">SLA Breach Detected</h1>
          </td>
        </tr>
        <!-- Risk badge -->
        <tr>
          <td style="padding:20px 32px 0;">
            <span style="display:inline-block;background:${riskColor}22;border:1px solid ${riskColor};color:${riskColor};padding:4px 12px;border-radius:9999px;font-size:11px;font-weight:700;letter-spacing:1px;font-family:monospace;">${riskLabel} RISK · SCORE ${payload.risk_score}/100</span>
          </td>
        </tr>
        <!-- Details table -->
        <tr>
          <td style="padding:20px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              ${[
                ["Request ID",    `<code style="font-family:monospace;font-size:12px;background:#0f1117;padding:2px 6px;border-radius:4px;">${payload.request_id}</code>`],
                ["Agent ID",      `<code style="font-family:monospace;font-size:12px;background:#0f1117;padding:2px 6px;border-radius:4px;">${payload.agent_id}</code>`],
                ["Action Type",   payload.action_type],
                ["Risk Score",    `<span style="color:${riskColor};font-weight:700;">${payload.risk_score} / 100</span>`],
                ["SLA Breached",  new Date(payload.sla_breached_at).toLocaleString()],
                ["Time Overdue",  `<strong style="color:${riskColor};">${overdueMin} minutes</strong>`],
              ].map(([label, value]) => `
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #2d3048;color:#94a3b8;font-size:13px;width:140px;">${label}</td>
                <td style="padding:10px 0 10px 16px;border-bottom:1px solid #2d3048;font-size:13px;">${value}</td>
              </tr>`).join("")}
            </table>
          </td>
        </tr>
        <!-- CTA button -->
        <tr>
          <td style="padding:8px 32px 32px;">
            <p style="margin:0 0 16px;font-size:13px;color:#94a3b8;">This request requires immediate attention. Click below to review and take action.</p>
            <a href="${origin}/approvals?id=${payload.request_id}"
               style="display:inline-block;background:${riskColor};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;">
              Review in Approvals Queue
            </a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #2d3048;text-align:center;">
            <p style="margin:0;font-size:11px;color:#4a5568;font-family:monospace;">
              AgentGate · AI Governance Platform · ${env.APP_ENV.toUpperCase()} · Auto-generated alert
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildEmailText(payload: NotificationPayload, overdueMin: number, origin: string): string {
  return [
    "=== AgentGate SLA BREACH ALERT ===",
    "",
    `Request ID:   ${payload.request_id}`,
    `Agent ID:     ${payload.agent_id}`,
    `Action Type:  ${payload.action_type}`,
    `Risk Score:   ${payload.risk_score} / 100`,
    `SLA Breached: ${new Date(payload.sla_breached_at).toLocaleString()}`,
    `Time Overdue: ${overdueMin} minutes`,
    "",
    "ACTION REQUIRED — Review this request immediately:",
    `${origin}/approvals?id=${payload.request_id}`,
    "",
    "---",
    "AgentGate · AI Governance Platform",
  ].join("\n");
}

// ── Part 2: Real Slack integration ────────────────────────────────────────────

export async function sendSlackAlert(
  payload: NotificationPayload
): Promise<NotificationResult> {
  if (isMockIntegrations()) {
    await writeAuditEvent(payload, "slack", "SLA_BREACH_NOTIFIED");
    return { success: true, channel: "slack" };
  }

  const webhookUrl = payload.slack_webhook_url || env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    const msg = "No Slack webhook URL configured. Set NEXT_PUBLIC_SLACK_WEBHOOK_URL or configure in Settings.";
    console.warn(`[notificationService] sendSlackAlert: ${msg}`);
    return { success: false, channel: "slack", error: msg };
  }

  const overdueMin = Math.round(payload.overdue_ms / 60_000);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.agentgate.ai";
  const slackBody = buildSlackBlocks(payload, overdueMin, origin);

  try {
    await retryWithBackoff(async () => {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackBody),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Slack responded ${res.status}: ${text}`);
      }
    });

    console.info(`[notificationService] Slack alert sent for request ${payload.request_id}`);
    await writeAuditEvent(payload, "slack", "SLA_BREACH_NOTIFIED");
    return { success: true, channel: "slack" };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[notificationService] sendSlackAlert failed: ${errorMsg}`);
    await writeAuditEvent(payload, "slack", "NOTIFICATION_FAILED", errorMsg);
    return { success: false, channel: "slack", error: errorMsg };
  }
}

// ── Part 3: Real Resend email integration ─────────────────────────────────────

export async function sendEmailAlert(
  payload: NotificationPayload
): Promise<NotificationResult> {
  if (isMockIntegrations()) {
    await writeAuditEvent(payload, "email", "SLA_BREACH_NOTIFIED");
    return { success: true, channel: "email" };
  }

  const to = payload.approver_email || env.APPROVER_EMAIL;

  if (!to) {
    const msg = "No approver email configured. Set NEXT_PUBLIC_APPROVER_EMAIL or configure in Settings.";
    console.warn(`[notificationService] sendEmailAlert: ${msg}`);
    return { success: false, channel: "email", error: msg };
  }

  const overdueMin = Math.round(payload.overdue_ms / 60_000);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.agentgate.ai";

  const emailPayload = {
    to,
    subject: `[AI Governance] SLA Breach: ${payload.action_type} from agent ${payload.agent_id.slice(0, 8)}`,
    html: buildEmailHtml(payload, overdueMin, origin),
    text: buildEmailText(payload, overdueMin, origin),
  };

  try {
    await retryWithBackoff(async () => {
      // POST to our own Next.js API route which holds the RESEND_API_KEY server-side
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailPayload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    });

    console.info(`[notificationService] Email alert sent to ${to} for request ${payload.request_id}`);
    await writeAuditEvent(payload, "email", "SLA_BREACH_NOTIFIED");
    return { success: true, channel: "email" };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[notificationService] sendEmailAlert failed: ${errorMsg}`);
    await writeAuditEvent(payload, "email", "NOTIFICATION_FAILED", errorMsg);
    return { success: false, channel: "email", error: errorMsg };
  }
}

// ── Early warning (75 % SLA elapsed) ──────────────────────────────────────────

export function sendEarlyWarningAlert(approval: {
  id: string;
  tool_name: string | null;
  risk_score: number;
  action_type: string;
  time_remaining_ms: number;
}): void {
  const minutesLeft = Math.round(approval.time_remaining_ms / 60_000);
  console.info(`[notificationService] earlyWarning – ${minutesLeft} min left for ${approval.id}`);
  appendNotification({
    id: `ew-${approval.id}`,
    kind: "early_warning",
    title: `SLA Warning – ${approval.action_type}`,
    body: `Approval needed within ${minutesLeft} minutes (75% SLA elapsed)`,
    request_id: approval.id,
    risk_score: approval.risk_score,
    action_type: approval.action_type,
    created_at: new Date().toISOString(),
    read: false,
  });
}

export function sendComplianceGapNotification(input: {
  frameworkId: string;
  overallCoverage: number;
  droppedControls: Array<{ control_id: string; reason: string }>;
}): void {
  const { frameworkId, overallCoverage, droppedControls } = input;
  const controlsLabel = droppedControls.length > 0
    ? droppedControls.map((c) => `${c.control_id}: ${c.reason}`).join(" | ")
    : "Coverage below threshold";

  appendNotification({
    id: `compliance-${frameworkId}-${Date.now()}`,
    kind: "compliance_gap",
    title: `Compliance gap detected · ${frameworkId}`,
    body: `${overallCoverage}% coverage. ${controlsLabel}`,
    request_id: `compliance:${frameworkId}`,
    risk_score: Math.max(1, 100 - overallCoverage),
    action_type: "COMPLIANCE_GAP_DETECTED",
    created_at: new Date().toISOString(),
    read: false,
  });

  console.warn("[notificationService] compliance gap notification", {
    frameworkId,
    overallCoverage,
    droppedControls,
  });
}

// ── Main orchestrator ──────────────────────────────────────────────────────────

export async function handleSlaBreachNotification(
  approval: {
    id: string;
    tool_call_id: string;
    tool_name: string | null;
    risk_score: number;
    created_at: string;
  },
  overdue_ms: number
): Promise<NotificationResult[]> {
  const cfg = loadEscalationConfig();
  if (!cfg.notify_on_escalation) return [];

  const sla_breached_at = new Date(
    new Date(approval.created_at).getTime() + 24 * 60 * 60 * 1000
  ).toISOString();

  const payload: NotificationPayload = {
    request_id: approval.id,
    agent_id: approval.tool_call_id,
    action_type: approval.tool_name ?? "unknown",
    risk_score: approval.risk_score,
    sla_breached_at,
    overdue_ms,
    approver_email: cfg.approver_email || env.APPROVER_EMAIL,
    slack_webhook_url: cfg.slack_webhook_url || env.SLACK_WEBHOOK_URL,
  };

  // 1. In-app notification (always fires)
  appendNotification({
    id: `breach-${approval.id}`,
    kind: "sla_breach",
    title: `SLA Breach – ${payload.action_type}`,
    body: `Risk ${approval.risk_score} · Overdue ${Math.round(overdue_ms / 60_000)} min`,
    request_id: approval.id,
    risk_score: approval.risk_score,
    action_type: payload.action_type,
    created_at: new Date().toISOString(),
    read: false,
  });

  // 2. Route through integration marketplace first.
  const routedResults = await routeEvent({
    type: "SLA_BREACH_NOTIFIED",
    payload,
  });

  const slackFromRouter: NotificationResult[] = routedResults
    .filter((result) => result.integration_id === "SLACK")
    .map((result) => ({
      success: result.success,
      channel: "slack" as const,
      error: result.success ? undefined : result.message,
    }));

  // Preserve first-party email delivery.
  const emailResult = await sendEmailAlert(payload);

  // Compatibility fallback: if Slack is not connected in marketplace, still try direct webhook.
  const fallbackSlack = slackFromRouter.length === 0 ? [await sendSlackAlert(payload)] : [];
  const results = [...slackFromRouter, ...fallbackSlack, emailResult];

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    console.warn(
      `[notificationService] ${failed.length} channel(s) failed:`,
      failed.map((r) => `${r.channel}: ${r.error}`).join(", ")
    );
  }

  return results;
}
