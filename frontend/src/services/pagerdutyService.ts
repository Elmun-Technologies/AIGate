import type { Incident } from "@/src/types/incident";

type PagerDutyResult = {
  success: boolean;
  incidentId: string | null;
  error?: string;
};

export type PagerDutyConfigOverrides = {
  routing_key?: string;
};

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

function pagerDutySeverity(incident: Incident): "critical" | "error" | "warning" | "info" {
  if (incident.severity === "CRITICAL") return "critical";
  if (incident.severity === "HIGH") return "error";
  if (incident.severity === "MEDIUM") return "warning";
  return "info";
}

const MOCK_ACK_KEY = "agentgate_mock_pagerduty_ack_ids";

export async function triggerPagerDutyIncident(
  incident: Incident,
  incidentUrl: string,
  overrides: PagerDutyConfigOverrides = {},
): Promise<PagerDutyResult> {
  if (!["CRITICAL", "HIGH"].includes(incident.severity)) {
    return { success: true, incidentId: null };
  }

  const mock = isMockIntegrations();
  const routingKey =
    overrides.routing_key ||
    envValue("NEXT_PUBLIC_PAGERDUTY_ROUTING_KEY") ||
    envValue("VITE_PAGERDUTY_ROUTING_KEY");

  if (mock) {
    const incidentId = `PD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    console.log("[pagerdutyService] MOCK trigger", { incidentId, incidentIdLocal: incident.id });
    return { success: true, incidentId };
  }

  if (!routingKey) {
    return {
      success: false,
      incidentId: null,
      error: "Missing PagerDuty routing key",
    };
  }

  try {
    const body = {
      routing_key: routingKey,
      event_action: "trigger",
      payload: {
        summary: incident.title,
        severity: pagerDutySeverity(incident),
        source: "ai-governance-platform",
        custom_details: incident,
      },
      client: "AI Governance",
      client_url: incidentUrl,
    };

    const response = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, incidentId: null, error: `PagerDuty HTTP ${response.status}: ${text}` };
    }

    const data = (await response.json()) as { dedup_key?: string };
    return { success: true, incidentId: data.dedup_key ?? null };
  } catch (error) {
    return {
      success: false,
      incidentId: null,
      error: error instanceof Error ? error.message : "Unknown PagerDuty error",
    };
  }
}

export async function resolvePagerDutyIncident(
  incidentId: string | null,
  overrides: PagerDutyConfigOverrides = {},
): Promise<PagerDutyResult> {
  if (!incidentId) {
    return { success: true, incidentId: null };
  }

  const mock = isMockIntegrations();
  const routingKey =
    overrides.routing_key ||
    envValue("NEXT_PUBLIC_PAGERDUTY_ROUTING_KEY") ||
    envValue("VITE_PAGERDUTY_ROUTING_KEY");

  if (mock) {
    return { success: true, incidentId };
  }

  if (!routingKey) {
    return {
      success: false,
      incidentId: null,
      error: "Missing PagerDuty routing key",
    };
  }

  try {
    const body = {
      routing_key: routingKey,
      event_action: "resolve",
      dedup_key: incidentId,
      payload: {
        summary: `Resolve AI Governance incident ${incidentId}`,
        severity: "info",
        source: "ai-governance-platform",
      },
    };

    const response = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, incidentId: null, error: `PagerDuty HTTP ${response.status}: ${text}` };
    }

    return { success: true, incidentId };
  } catch (error) {
    return {
      success: false,
      incidentId: null,
      error: error instanceof Error ? error.message : "Unknown PagerDuty error",
    };
  }
}

export function simulatePagerDutyAck(pagerDutyIncidentId: string): void {
  const raw = localStorage.getItem(MOCK_ACK_KEY);
  const ids = raw ? (JSON.parse(raw) as string[]) : [];
  if (!ids.includes(pagerDutyIncidentId)) ids.push(pagerDutyIncidentId);
  localStorage.setItem(MOCK_ACK_KEY, JSON.stringify(ids));
}

export function pullAcknowledgedPagerDuty(idsToCheck: string[]): string[] {
  const raw = localStorage.getItem(MOCK_ACK_KEY);
  const acked = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  return idsToCheck.filter((id) => acked.has(id));
}
