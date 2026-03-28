import { checklistTemplates, type ChecklistTemplateKey } from "@/src/config/checklistTemplates";
import { syncJiraDoneStatuses } from "@/src/services/jiraService";
import { pullAcknowledgedPagerDuty } from "@/src/services/pagerdutyService";
import { routeEvent } from "@/src/services/eventRouter";
import type { Incident, IncidentSeverity, IncidentStatus, TimelineEvent } from "@/src/types/incident";
import { loadNotifications } from "@/lib/notificationService";
import type { ControlCoverage } from "@/src/services/complianceEngine";

type AutoToolCall = {
  id: string;
  agent_id: string;
  risk_score: number;
  status: string;
  decision_reason?: string | null;
  created_at: string;
  request_json_redacted?: { tool?: string };
};

type AutoShadowModel = {
  id: string;
  name: string;
  version: string;
  status: string;
  riskClass: string;
  linkedAgentIds?: string[];
};

const INCIDENTS_KEY = "agentgate_incidents_v1";

function nowIso() {
  return new Date().toISOString();
}

function randId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function emitIncidentsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("agentgate:incidents-updated"));
  }
}

function cloneChecklist(template: ChecklistTemplateKey) {
  return checklistTemplates[template].map((item) => ({
    ...item,
    id: randId("chk"),
    completed: false,
    completed_by: null,
    completed_at: null,
  }));
}

function createTimelineEvent(
  actor: string,
  event_type: string,
  description: string,
  timestamp = nowIso()
): TimelineEvent {
  return {
    id: randId("tl"),
    timestamp,
    actor,
    event_type,
    description,
  };
}

export function loadIncidents(): Incident[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(INCIDENTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Incident[];
  } catch {
    return [];
  }
}

function persistIncidents(incidents: Incident[]): void {
  localStorage.setItem(INCIDENTS_KEY, JSON.stringify(incidents));
  emitIncidentsUpdated();
}

function requiredChecklistDone(incident: Incident): boolean {
  return incident.containment_checklist
    .filter((i) => i.required)
    .every((i) => i.completed);
}

function inferTemplateFromToolCall(toolCall: AutoToolCall): ChecklistTemplateKey {
  const action = toolCall.request_json_redacted?.tool ?? "unknown";
  if (action === "external_post" && toolCall.risk_score > 80) return "DATA_EXFILTRATION";
  if (toolCall.status === "blocked") return "PROMPT_INJECTION";
  return "SLA_BREACH_ESCALATION";
}

async function createIncidentInternal(
  incidents: Incident[],
  base: Omit<Incident, "id" | "timeline" | "created_at" | "resolved_at">,
  actor = "system",
  _incidentUrl = ""
): Promise<Incident[]> {
  const created: Incident = {
    ...base,
    id: randId("inc"),
    created_at: nowIso(),
    resolved_at: null,
    timeline: [
      createTimelineEvent(actor, "INCIDENT_CREATED", `Incident created: ${base.title}`),
    ],
  };

  const routed = await routeEvent({ type: "INCIDENT_CREATED", payload: created });

  const jiraSuccess = routed.find(
    (result) => result.integration_id === "JIRA" && result.success,
  );
  if (jiraSuccess?.provider_reference) {
    created.jira_ticket_id = jiraSuccess.provider_reference;
    created.timeline.push(
      createTimelineEvent("system", "JIRA_TICKET_CREATED", `Jira issue created: ${jiraSuccess.provider_reference}`),
    );
  } else {
    const jiraFailure = routed.find(
      (result) => result.integration_id === "JIRA" && !result.success,
    );
    if (jiraFailure) {
      created.timeline.push(
        createTimelineEvent("system", "JIRA_TICKET_FAILED", jiraFailure.message),
      );
    }
  }

  const pagerDutySuccess = routed.find(
    (result) => result.integration_id === "PAGERDUTY" && result.success,
  );
  if (pagerDutySuccess?.provider_reference) {
    created.pagerduty_incident_id = pagerDutySuccess.provider_reference;
    created.timeline.push(
      createTimelineEvent(
        "system",
        "PAGERDUTY_TRIGGERED",
        `PagerDuty incident triggered: ${pagerDutySuccess.provider_reference}`,
      ),
    );
  } else {
    const pagerDutyFailure = routed.find(
      (result) => result.integration_id === "PAGERDUTY" && !result.success,
    );
    if (pagerDutyFailure) {
      created.timeline.push(
        createTimelineEvent("system", "PAGERDUTY_TRIGGER_FAILED", pagerDutyFailure.message),
      );
    }
  }

  const next = [created, ...incidents];
  persistIncidents(next);
  return next;
}

export async function runAutoIncidentCreation(
  toolCalls: AutoToolCall[],
  shadowModels: AutoShadowModel[]
): Promise<Incident[]> {
  let incidents = loadIncidents();
  const existingTriggerIds = new Set(incidents.map((i) => i.triggered_by.audit_log_id));

  // Rule 1: risk_score >= 90
  const highRiskCalls = toolCalls.filter((tc) => tc.risk_score >= 90);
  for (const tc of highRiskCalls) {
    const triggerId = `HIGH_RISK:${tc.id}`;
    if (existingTriggerIds.has(triggerId)) continue;
    existingTriggerIds.add(triggerId);

    const action = tc.request_json_redacted?.tool ?? "unknown_action";
    incidents = await createIncidentInternal(
      incidents,
      {
        title: `High-risk ${action} from agent ${tc.agent_id.slice(0, 8)}`,
        severity: tc.risk_score >= 95 ? "CRITICAL" : "HIGH",
        status: "OPEN",
        triggered_by: {
          audit_log_id: triggerId,
          agent_id: tc.agent_id,
          action_type: action,
          risk_score: tc.risk_score,
          policy_triggered: tc.decision_reason ?? "Policy enforcement",
        },
        assigned_to: null,
        jira_ticket_id: null,
        pagerduty_incident_id: null,
        containment_checklist: cloneChecklist(inferTemplateFromToolCall(tc)),
      },
      "system"
    );
  }

  // Rule 2: CRITICAL shadow model detected
  for (const model of shadowModels.filter((m) => m.status === "shadow" && m.riskClass === "CRITICAL")) {
    const triggerId = `SHADOW_CRITICAL:${model.version}`;
    if (existingTriggerIds.has(triggerId)) continue;
    existingTriggerIds.add(triggerId);

    incidents = await createIncidentInternal(
      incidents,
      {
        title: `Critical shadow model detected: ${model.name}`,
        severity: "CRITICAL",
        status: "OPEN",
        triggered_by: {
          audit_log_id: triggerId,
          agent_id: model.linkedAgentIds?.[0] ?? "unknown",
          action_type: "MODEL_SHADOW_DETECTED",
          risk_score: 99,
          policy_triggered: "Shadow model detection",
        },
        assigned_to: null,
        jira_ticket_id: null,
        pagerduty_incident_id: null,
        containment_checklist: cloneChecklist("SHADOW_MODEL"),
      },
      "system"
    );
  }

  // Rule 3: SLA breach unacknowledged for 2+ hours
  const notifications = loadNotifications();
  const staleSlaBreaches = notifications.filter((n) => {
    if (n.kind !== "sla_breach" || n.read) return false;
    return Date.now() - new Date(n.created_at).getTime() >= 2 * 60 * 60 * 1000;
  });

  for (const breach of staleSlaBreaches) {
    const triggerId = `SLA_UNACK:${breach.request_id}`;
    if (existingTriggerIds.has(triggerId)) continue;
    existingTriggerIds.add(triggerId);

    incidents = await createIncidentInternal(
      incidents,
      {
        title: `Unacknowledged SLA breach for request ${breach.request_id.slice(0, 8)}`,
        severity: "HIGH",
        status: "OPEN",
        triggered_by: {
          audit_log_id: triggerId,
          agent_id: "unknown",
          action_type: breach.action_type,
          risk_score: breach.risk_score,
          policy_triggered: "SLA breach escalation",
        },
        assigned_to: null,
        jira_ticket_id: null,
        pagerduty_incident_id: null,
        containment_checklist: cloneChecklist("SLA_BREACH_ESCALATION"),
      },
      "system"
    );
  }

  // Rule 4: 10+ blocked actions within 1 hour by same agent
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const blockedRecent = toolCalls.filter(
    (tc) => tc.status === "blocked" && new Date(tc.created_at).getTime() >= oneHourAgo
  );
  const blockedByAgent = new Map<string, AutoToolCall[]>();
  for (const tc of blockedRecent) {
    const list = blockedByAgent.get(tc.agent_id) ?? [];
    list.push(tc);
    blockedByAgent.set(tc.agent_id, list);
  }

  for (const [agentId, calls] of blockedByAgent.entries()) {
    if (calls.length < 10) continue;
    const hourBucket = new Date().toISOString().slice(0, 13);
    const triggerId = `PROMPT_BURST:${agentId}:${hourBucket}`;
    if (existingTriggerIds.has(triggerId)) continue;
    existingTriggerIds.add(triggerId);

    incidents = await createIncidentInternal(
      incidents,
      {
        title: `Prompt-injection pattern: ${calls.length} blocked actions from agent ${agentId.slice(0, 8)} in 1h`,
        severity: "CRITICAL",
        status: "OPEN",
        triggered_by: {
          audit_log_id: triggerId,
          agent_id: agentId,
          action_type: "PROMPT_INJECTION_PATTERN",
          risk_score: Math.max(...calls.map((c) => c.risk_score)),
          policy_triggered: "Repeated blocked pattern",
        },
        assigned_to: null,
        jira_ticket_id: null,
        pagerduty_incident_id: null,
        containment_checklist: cloneChecklist("PROMPT_INJECTION"),
      },
      "system"
    );
  }

  return incidents;
}

export async function createComplianceGapIncident(input: {
  frameworkId: string;
  overallCoverage: number;
  droppedControls: ControlCoverage[];
}): Promise<Incident[]> {
  let incidents = loadIncidents();
  const triggerId = `COMPLIANCE_GAP:${input.frameworkId}:${new Date().toISOString().slice(0, 10)}`;

  if (incidents.some((i) => i.triggered_by.audit_log_id === triggerId)) {
    return incidents;
  }

  const primaryControl = input.droppedControls[0];
  const title = `Compliance gap detected in ${input.frameworkId} (${input.overallCoverage}% coverage)`;

  incidents = await createIncidentInternal(
    incidents,
    {
      title,
      severity: "HIGH",
      status: "OPEN",
      triggered_by: {
        audit_log_id: triggerId,
        agent_id: "compliance-monitor",
        action_type: "COMPLIANCE_GAP_DETECTED",
        risk_score: Math.max(70, 100 - input.overallCoverage),
        policy_triggered: primaryControl
          ? `${primaryControl.control_id} ${primaryControl.control_name}`
          : "Compliance coverage below threshold",
      },
      assigned_to: null,
      jira_ticket_id: null,
      pagerduty_incident_id: null,
      containment_checklist: cloneChecklist("SLA_BREACH_ESCALATION"),
    },
    "system"
  );

  return incidents;
}

function updateIncident(
  incidents: Incident[],
  incidentId: string,
  updater: (incident: Incident) => Incident
): Incident[] {
  return incidents.map((incident) =>
    incident.id === incidentId ? updater(incident) : incident
  );
}

export function setIncidentStatus(
  incidentId: string,
  status: IncidentStatus,
  actor: string,
  description?: string
): Incident[] {
  const incidents = loadIncidents();
  const next = updateIncident(incidents, incidentId, (incident) => {
    const timeline = [
      ...incident.timeline,
      createTimelineEvent(actor, "STATUS_CHANGED", description ?? `Status changed to ${status}`),
    ];
    return {
      ...incident,
      status,
      resolved_at: status === "RESOLVED" ? nowIso() : incident.resolved_at,
      timeline,
    };
  });
  persistIncidents(next);

  if (status === "RESOLVED") {
    const resolvedIncident = next.find((incident) => incident.id === incidentId);
    if (resolvedIncident) {
      void routeEvent({ type: "INCIDENT_RESOLVED", payload: resolvedIncident });
    }
  }

  return next;
}

export function appendIncidentTimelineEvent(
  incidentId: string,
  actor: string,
  eventType: string,
  description: string,
): Incident[] {
  const incidents = loadIncidents();
  const next = updateIncident(incidents, incidentId, (incident) => ({
    ...incident,
    timeline: [...incident.timeline, createTimelineEvent(actor, eventType, description)],
  }));
  persistIncidents(next);
  return next;
}

export function assignIncidentTo(incidentId: string, assigneeEmail: string, actor: string): Incident[] {
  const incidents = loadIncidents();
  const next = updateIncident(incidents, incidentId, (incident) => ({
    ...incident,
    assigned_to: assigneeEmail,
    timeline: [
      ...incident.timeline,
      createTimelineEvent(actor, "ASSIGNED", `Assigned to ${assigneeEmail}`),
    ],
  }));
  persistIncidents(next);
  return next;
}

export function toggleChecklistItem(
  incidentId: string,
  checklistItemId: string,
  actor: string,
  completed: boolean
): Incident[] {
  const incidents = loadIncidents();
  const next = updateIncident(incidents, incidentId, (incident) => {
    const updatedChecklist = incident.containment_checklist.map((item) => {
      if (item.id !== checklistItemId) return item;
      return {
        ...item,
        completed,
        completed_by: completed ? actor : null,
        completed_at: completed ? nowIso() : null,
      };
    });

    const changedItem = updatedChecklist.find((item) => item.id === checklistItemId);
    const eventDesc = completed
      ? `Checklist completed: ${changedItem?.label ?? checklistItemId}`
      : `Checklist unchecked: ${changedItem?.label ?? checklistItemId}`;

    return {
      ...incident,
      containment_checklist: updatedChecklist,
      timeline: [
        ...incident.timeline,
        createTimelineEvent(actor, "CHECKLIST_ITEM_COMPLETED", eventDesc),
      ],
    };
  });
  persistIncidents(next);
  return next;
}

export function linkJiraTicketManually(
  incidentId: string,
  jiraTicketId: string,
  actor: string
): Incident[] {
  const incidents = loadIncidents();
  const next = updateIncident(incidents, incidentId, (incident) => ({
    ...incident,
    jira_ticket_id: jiraTicketId,
    timeline: [
      ...incident.timeline,
      createTimelineEvent(actor, "JIRA_TICKET_LINKED", `Manually linked Jira ticket ${jiraTicketId}`),
    ],
  }));
  persistIncidents(next);
  return next;
}

export async function escalateToPagerDuty(
  incidentId: string,
  actor: string,
  _incidentUrl: string
): Promise<Incident[]> {
  const incidents = loadIncidents();
  const incident = incidents.find((i) => i.id === incidentId);
  if (!incident) return incidents;

  const routed = await routeEvent(
    { type: "INCIDENT_CREATED", payload: incident },
    { integrationIds: ["PAGERDUTY"] },
  );
  const result = routed.find((entry) => entry.integration_id === "PAGERDUTY");
  const success = Boolean(result?.success);
  const providerReference = result?.provider_reference ?? null;

  const next = updateIncident(incidents, incidentId, (current) => ({
    ...current,
    pagerduty_incident_id: success
      ? providerReference ?? current.pagerduty_incident_id
      : current.pagerduty_incident_id,
    timeline: [
      ...current.timeline,
      createTimelineEvent(
        actor,
        success ? "PAGERDUTY_TRIGGERED" : "PAGERDUTY_TRIGGER_FAILED",
        success
          ? `PagerDuty incident triggered ${providerReference ?? ""}`
          : `PagerDuty failed: ${result?.message ?? "unknown error"}`
      ),
    ],
  }));
  persistIncidents(next);
  return next;
}

export function attemptResolveIncident(incidentId: string, actor: string): { ok: boolean; incidents: Incident[] } {
  const incidents = loadIncidents();
  const incident = incidents.find((i) => i.id === incidentId);
  if (!incident) return { ok: false, incidents };
  if (!requiredChecklistDone(incident)) return { ok: false, incidents };

  const next = setIncidentStatus(incidentId, "RESOLVED", actor, "Incident resolved after checklist completion");
  return { ok: true, incidents: next };
}

export async function syncIncidentsWithIntegrations(): Promise<Incident[]> {
  let incidents = loadIncidents();
  const resolvedViaJira: Incident[] = [];

  // Jira done -> RESOLVED
  const jiraKeys = incidents
    .filter((i) => i.jira_ticket_id && i.status !== "RESOLVED")
    .map((i) => i.jira_ticket_id!)
    .filter(Boolean);

  if (jiraKeys.length > 0) {
    const doneKeys = await syncJiraDoneStatuses(jiraKeys);
    if (doneKeys.length > 0) {
      incidents = incidents.map((incident) => {
        if (!incident.jira_ticket_id || !doneKeys.includes(incident.jira_ticket_id)) return incident;
        if (incident.status === "RESOLVED") return incident;
        const nextIncident = {
          ...incident,
          status: "RESOLVED" as IncidentStatus,
          resolved_at: nowIso(),
          timeline: [
            ...incident.timeline,
            createTimelineEvent("system", "STATUS_CHANGED", `Jira issue ${incident.jira_ticket_id} moved to Done`),
          ],
        };
        resolvedViaJira.push(nextIncident);
        return nextIncident;
      });
    }
  }

  // PagerDuty ack -> INVESTIGATING
  const pdIds = incidents
    .filter((i) => i.pagerduty_incident_id && i.status === "OPEN")
    .map((i) => i.pagerduty_incident_id!)
    .filter(Boolean);

  if (pdIds.length > 0) {
    const acked = pullAcknowledgedPagerDuty(pdIds);
    if (acked.length > 0) {
      incidents = incidents.map((incident) => {
        if (!incident.pagerduty_incident_id || !acked.includes(incident.pagerduty_incident_id)) return incident;
        return {
          ...incident,
          status: "INVESTIGATING" as IncidentStatus,
          timeline: [
            ...incident.timeline,
            createTimelineEvent("system", "PAGERDUTY_ACKNOWLEDGED", `PagerDuty incident ${incident.pagerduty_incident_id} acknowledged`),
          ],
        };
      });
    }
  }

  persistIncidents(incidents);
  await Promise.all(
    resolvedViaJira.map((incident) =>
      routeEvent({ type: "INCIDENT_RESOLVED", payload: incident }),
    ),
  );
  return incidents;
}

export function calculateIncidentMetrics(incidents: Incident[]) {
  const containedHours: number[] = [];
  const resolvedHours: number[] = [];

  for (const incident of incidents) {
    const created = new Date(incident.created_at).getTime();
    if (Number.isNaN(created)) continue;

    const containedEvent = incident.timeline.find(
      (e) => e.event_type === "STATUS_CHANGED" && e.description.toLowerCase().includes("contained")
    );
    if (containedEvent) {
      const t = new Date(containedEvent.timestamp).getTime();
      if (!Number.isNaN(t) && t >= created) containedHours.push((t - created) / 36e5);
    } else if (["CONTAINED", "RESOLVED"].includes(incident.status)) {
      const t = new Date(incident.resolved_at ?? incident.created_at).getTime();
      if (!Number.isNaN(t) && t >= created) containedHours.push((t - created) / 36e5);
    }

    if (incident.status === "RESOLVED" && incident.resolved_at) {
      const resolved = new Date(incident.resolved_at).getTime();
      if (!Number.isNaN(resolved) && resolved >= created) {
        resolvedHours.push((resolved - created) / 36e5);
      }
    }
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  return {
    mttcHours: Number(avg(containedHours).toFixed(1)),
    mttrHours: Number(avg(resolvedHours).toFixed(1)),
  };
}
