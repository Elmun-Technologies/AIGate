import { apiRequest } from "@/lib/api";
import { createJiraIssue } from "@/src/services/jiraService";
import { resolvePagerDutyIncident, triggerPagerDutyIncident } from "@/src/services/pagerdutyService";
import {
  getIntegrationById,
  incrementIntegrationEvents,
  loadIntegrationConfig,
  loadIntegrations,
  markIntegrationError,
} from "@/src/services/integrationStore";
import type { Integration, IntegrationCapability } from "@/src/config/integrations";
import type { CoverageReport } from "@/src/services/complianceEngine";
import type { Incident } from "@/src/types/incident";
import type { NotificationPayload } from "@/lib/notificationService";

export type SLABreachPayload = NotificationPayload;

export type PolicyTriggerPayload = {
  policy_id: string;
  policy_name: string;
  action: string;
  actor: string;
  risk_score: number;
  context?: Record<string, unknown>;
};

export type MetricPayload = {
  risk_score: number;
  blocked_count: number;
  agent_health_score: number;
  timestamp: string;
  tags?: string[];
};

export type PlatformEvent =
  | { type: "SLA_BREACH_NOTIFIED"; payload: SLABreachPayload }
  | { type: "INCIDENT_CREATED"; payload: Incident }
  | { type: "INCIDENT_RESOLVED"; payload: Incident }
  | { type: "POLICY_TRIGGERED"; payload: PolicyTriggerPayload }
  | { type: "COMPLIANCE_REPORT_GENERATED"; payload: CoverageReport }
  | { type: "METRIC_EXPORTED"; payload: MetricPayload };

export type RouteEventResult = {
  integration_id: string;
  capability_id: string;
  event_type: PlatformEvent["type"];
  success: boolean;
  attempts: number;
  message: string;
  provider_reference?: string | null;
};

export type IntegrationActivityLog = {
  id: string;
  integration_id: string;
  integration_name: string;
  event_type: string;
  capability_id: string;
  capability_label: string;
  direction: "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL";
  status: "SUCCESS" | "FAILURE";
  message: string;
  attempts: number;
  timestamp: string;
};

type DispatchResult = {
  success: boolean;
  message: string;
  provider_reference?: string | null;
};

const ACTIVITY_KEY = "agentgate_integration_activity_v1";

function envValue(key: string): string {
  if (typeof process === "undefined") return "";
  return (process.env[key] ?? "").trim();
}

function isMockIntegrations(): boolean {
  const raw =
    envValue("NEXT_PUBLIC_MOCK_INTEGRATIONS") ||
    envValue("VITE_MOCK_INTEGRATIONS") ||
    "true";
  return raw.toLowerCase() === "true";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function readActivityLogs(): IntegrationActivityLog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    return raw ? (JSON.parse(raw) as IntegrationActivityLog[]) : [];
  } catch {
    return [];
  }
}

function writeActivityLogs(logs: IntegrationActivityLog[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(logs.slice(0, 500)));
  window.dispatchEvent(new CustomEvent("agentgate:integrations-updated"));
}

export function listIntegrationActivityLogs(limit = 200): IntegrationActivityLog[] {
  return readActivityLogs().slice(0, limit);
}

export function listIntegrationActivity(integrationId: string, limit = 20): IntegrationActivityLog[] {
  return readActivityLogs().filter((item) => item.integration_id === integrationId).slice(0, limit);
}

export function recordIntegrationActivityLog(
  input: Omit<IntegrationActivityLog, "id" | "timestamp"> & { timestamp?: string },
): IntegrationActivityLog {
  const entry: IntegrationActivityLog = {
    ...input,
    id: randomId("ial"),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  writeActivityLogs([entry, ...readActivityLogs()]);
  return entry;
}

function capabilityMatchesEvent(capability: IntegrationCapability, eventType: string): boolean {
  if (!capability.enabled) return false;

  const triggers = capability.trigger_event
    .split(/[|,]/g)
    .map((item) => item.trim())
    .filter(Boolean);

  return triggers.includes("ALL_EVENTS") || triggers.includes(eventType);
}

async function postSlackWebhook(
  webhookUrl: string,
  text: string,
): Promise<DispatchResult> {
  if (!webhookUrl) {
    return { success: false, message: "Missing Slack webhook URL" };
  }

  if (isMockIntegrations()) {
    return { success: true, message: "MOCK Slack dispatch completed", provider_reference: randomId("slack") };
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const textBody = await response.text();
    return { success: false, message: `Slack HTTP ${response.status}: ${textBody}` };
  }

  return { success: true, message: "Slack message sent", provider_reference: "ok" };
}

async function dispatchSlackEvent(
  integration: Integration,
  event: PlatformEvent,
): Promise<DispatchResult> {
  const config = loadIntegrationConfig(integration.id);

  if (event.type === "SLA_BREACH_NOTIFIED") {
    const { sendSlackAlert } = await import("@/lib/notificationService");
    const result = await sendSlackAlert({
      ...event.payload,
      slack_webhook_url: String(config.webhook_url ?? event.payload.slack_webhook_url ?? ""),
    });
    return {
      success: result.success,
      message: result.success ? "SLA breach alert sent to Slack" : result.error ?? "Slack delivery failed",
      provider_reference: null,
    };
  }

  if (event.type === "INCIDENT_CREATED") {
    const text = `AI Governance Incident: ${event.payload.title} [${event.payload.severity}]`; 
    return postSlackWebhook(String(config.webhook_url ?? ""), text);
  }

  return { success: true, message: "Event ignored by Slack adapter" };
}

async function dispatchJiraEvent(
  integration: Integration,
  event: PlatformEvent,
): Promise<DispatchResult> {
  if (event.type !== "INCIDENT_CREATED") {
    return { success: true, message: "Event ignored by Jira adapter" };
  }

  const config = loadIntegrationConfig(integration.id);
  const result = await createJiraIssue(event.payload, {
    domain: String(config.domain ?? ""),
    email: String(config.email ?? ""),
    api_token: String(config.api_token ?? ""),
    project_key: String(config.project_key ?? ""),
    incident_issue_type: String(config.incident_issue_type ?? "Security Incident"),
  });
  return {
    success: result.success,
    message: result.success
      ? `Jira issue ${result.issueKey ?? "created"}`
      : result.error ?? "Failed to create Jira issue",
    provider_reference: result.issueKey,
  };
}

async function dispatchPagerDutyEvent(
  integration: Integration,
  event: PlatformEvent,
): Promise<DispatchResult> {
  const config = loadIntegrationConfig(integration.id);
  const overrides = {
    routing_key: String(config.routing_key ?? ""),
  };

  if (event.type === "INCIDENT_CREATED") {
    const result = await triggerPagerDutyIncident(event.payload, "/incidents", overrides);
    return {
      success: result.success,
      message: result.success
        ? `PagerDuty incident ${result.incidentId ?? "triggered"}`
        : result.error ?? "PagerDuty trigger failed",
      provider_reference: result.incidentId,
    };
  }

  if (event.type === "INCIDENT_RESOLVED") {
    const result = await resolvePagerDutyIncident(event.payload.pagerduty_incident_id, overrides);
    return {
      success: result.success,
      message: result.success ? "PagerDuty incident resolved" : result.error ?? "PagerDuty resolve failed",
      provider_reference: result.incidentId,
    };
  }

  return { success: true, message: "Event ignored by PagerDuty adapter" };
}

async function dispatchSplunkEvent(
  integration: Integration,
  event: PlatformEvent,
): Promise<DispatchResult> {
  const config = loadIntegrationConfig(integration.id);
  const hecUrl = String(config.hec_url ?? "");
  const hecToken = String(config.hec_token ?? "");
  const index = String(config.index ?? "ai_governance");
  const sourcetype = String(config.sourcetype ?? "ai_governance:event");

  if (!hecUrl || !hecToken) {
    return { success: false, message: "Missing Splunk HEC configuration" };
  }

  if (isMockIntegrations()) {
    return { success: true, message: "MOCK Splunk forward completed", provider_reference: randomId("spl") };
  }

  const response = await fetch(hecUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Splunk ${hecToken}`,
    },
    body: JSON.stringify({
      event: event.payload,
      source: "ai-governance",
      sourcetype,
      index,
      host: "agent-gateway",
      time: Date.now() / 1000,
      fields: { event_type: event.type },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { success: false, message: `Splunk HTTP ${response.status}: ${body}` };
  }

  return { success: true, message: "Event forwarded to Splunk" };
}

async function dispatchDatadogEvent(
  integration: Integration,
  event: PlatformEvent,
): Promise<DispatchResult> {
  const config = loadIntegrationConfig(integration.id);
  const apiKey = String(config.api_key ?? "");
  const appKey = String(config.app_key ?? "");
  const site = String(config.site ?? "datadoghq.com");
  const envTag = String(config.env_tag ?? "production");
  const serviceName = String(config.service_name ?? "ai-governance");

  if (!apiKey || !appKey) {
    return { success: false, message: "Missing Datadog API credentials" };
  }

  if (isMockIntegrations()) {
    return { success: true, message: "MOCK Datadog export completed", provider_reference: randomId("dd") };
  }

  if (event.type === "METRIC_EXPORTED") {
    const url = `https://api.${site}/api/v1/series`;
    const payload = {
      series: [
        {
          metric: "ai_governance.risk_score",
          points: [[Math.floor(Date.now() / 1000), event.payload.risk_score]],
          type: "gauge",
          tags: [`env:${envTag}`, `service:${serviceName}`],
        },
        {
          metric: "ai_governance.blocked_count",
          points: [[Math.floor(Date.now() / 1000), event.payload.blocked_count]],
          type: "gauge",
          tags: [`env:${envTag}`, `service:${serviceName}`],
        },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "DD-API-KEY": apiKey,
        "DD-APPLICATION-KEY": appKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      return { success: false, message: `Datadog metrics HTTP ${response.status}: ${body}` };
    }

    return { success: true, message: "Metrics exported to Datadog" };
  }

  if (event.type === "INCIDENT_CREATED") {
    const url = `https://api.${site}/api/v1/events`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "DD-API-KEY": apiKey,
        "DD-APPLICATION-KEY": appKey,
      },
      body: JSON.stringify({
        title: `AI Governance Incident: ${event.payload.title}`,
        text: `Severity ${event.payload.severity} incident created from AI Governance platform`,
        alert_type: event.payload.severity === "CRITICAL" ? "error" : "warning",
        source_type_name: "ai-governance",
        tags: [`env:${envTag}`, `service:${serviceName}`],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { success: false, message: `Datadog events HTTP ${response.status}: ${body}` };
    }

    return { success: true, message: "Incident event posted to Datadog" };
  }

  const logsUrl = `https://http-intake.logs.${site}/api/v2/logs`;
  const logsResponse = await fetch(logsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "DD-API-KEY": apiKey,
    },
    body: JSON.stringify({
      message: `AI Governance event ${event.type}`,
      service: serviceName,
      ddsource: "ai-governance",
      ddtags: `env:${envTag}`,
      event_type: event.type,
      payload: event.payload,
    }),
  });

  if (!logsResponse.ok) {
    const body = await logsResponse.text();
    return { success: false, message: `Datadog logs HTTP ${logsResponse.status}: ${body}` };
  }

  return { success: true, message: "Event log posted to Datadog" };
}

async function dispatchGithubActionsEvent(
  integration: Integration,
  event: PlatformEvent,
): Promise<DispatchResult> {
  if (event.type !== "COMPLIANCE_REPORT_GENERATED") {
    return { success: true, message: "Event ignored by GitHub Actions adapter" };
  }

  const config = loadIntegrationConfig(integration.id);
  const repository = String(config.repository ?? "");
  const token = String(config.personal_access_token ?? "");

  if (!repository || !token) {
    return { success: false, message: "Missing GitHub repository or access token" };
  }

  if (isMockIntegrations()) {
    return { success: true, message: "MOCK GitHub Actions compliance summary posted", provider_reference: randomId("gh") };
  }

  return {
    success: true,
    message: `Compliance report prepared for ${repository}; no pull request context attached`,
  };
}

async function dispatchToIntegration(
  integration: Integration,
  capability: IntegrationCapability,
  event: PlatformEvent,
): Promise<DispatchResult> {
  switch (integration.id) {
    case "SLACK":
      return dispatchSlackEvent(integration, event);
    case "JIRA":
      return dispatchJiraEvent(integration, event);
    case "PAGERDUTY":
      return dispatchPagerDutyEvent(integration, event);
    case "SPLUNK":
      return dispatchSplunkEvent(integration, event);
    case "DATADOG":
      return dispatchDatadogEvent(integration, event);
    case "GITHUB_ACTIONS":
      return dispatchGithubActionsEvent(integration, event);
    default:
      return { success: true, message: "No dispatcher registered for integration" };
  }
}

async function writeNotificationFailedAudit(
  integration: Integration,
  capability: IntegrationCapability,
  event: PlatformEvent,
  error: string,
): Promise<void> {
  try {
    await apiRequest("/audit/events", {
      method: "POST",
      body: JSON.stringify({
        event_type: "NOTIFICATION_FAILED",
        agent_id: "integration-router",
        tool_call_id: `${integration.id}:${capability.id}`,
        decision: "error",
        risk_score: 0,
        details: {
          integration_id: integration.id,
          integration_name: integration.name,
          capability_id: capability.id,
          capability_label: capability.label,
          routed_event: event.type,
          error,
        },
      }),
    });
  } catch {
    // best-effort only
  }
}

async function executeWithRetry(
  integration: Integration,
  capability: IntegrationCapability,
  event: PlatformEvent,
): Promise<RouteEventResult> {
  const maxAttempts = 3; // initial + 2 retries
  let lastError = "Unknown integration error";

  for (let attempts = 1; attempts <= maxAttempts; attempts += 1) {
    try {
      const result = await dispatchToIntegration(integration, capability, event);
      if (result.success) {
        return {
          integration_id: integration.id,
          capability_id: capability.id,
          event_type: event.type,
          success: true,
          attempts,
          message: result.message,
          provider_reference: result.provider_reference,
        };
      }
      lastError = result.message;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempts < maxAttempts) {
      await sleep(300 * attempts);
    }
  }

  return {
    integration_id: integration.id,
    capability_id: capability.id,
    event_type: event.type,
    success: false,
    attempts: maxAttempts,
    message: lastError,
  };
}

export async function routeEvent(
  event: PlatformEvent,
  options?: { integrationIds?: string[] },
): Promise<RouteEventResult[]> {
  const integrationFilter = options?.integrationIds;
  const connected = loadIntegrations().filter((integration) => {
    if (integration.status !== "CONNECTED") return false;
    if (!integrationFilter || integrationFilter.length === 0) return true;
    return integrationFilter.includes(integration.id);
  });
  const targets: Array<{ integration: Integration; capability: IntegrationCapability }> = [];

  for (const integration of connected) {
    for (const capability of integration.capabilities) {
      if (capabilityMatchesEvent(capability, event.type)) {
        targets.push({ integration, capability });
      }
    }
  }

  const results = await Promise.all(
    targets.map(async ({ integration, capability }) => {
      const result = await executeWithRetry(integration, capability, event);
      const activityStatus = result.success ? "SUCCESS" : "FAILURE";

      recordIntegrationActivityLog({
        integration_id: integration.id,
        integration_name: integration.name,
        event_type: event.type,
        capability_id: capability.id,
        capability_label: capability.label,
        direction: capability.direction,
        status: activityStatus,
        message: result.message,
        attempts: result.attempts,
      });

      if (result.success) {
        incrementIntegrationEvents(integration.id, 1);
      } else {
        markIntegrationError(integration.id);
        await writeNotificationFailedAudit(integration, capability, event, result.message);
      }

      return result;
    }),
  );

  return results;
}

export function getIntegrationByIdWithActivity(integrationId: string) {
  const integration = getIntegrationById(integrationId);
  if (!integration) return null;
  return {
    integration,
    activity: listIntegrationActivity(integrationId, 20),
    config: loadIntegrationConfig(integrationId),
  };
}
