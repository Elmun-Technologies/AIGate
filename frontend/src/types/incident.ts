export type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type IncidentStatus = "OPEN" | "INVESTIGATING" | "CONTAINED" | "RESOLVED";

export type ChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  required: boolean;
};

export type TimelineEvent = {
  id: string;
  timestamp: string;
  actor: string;
  event_type: string;
  description: string;
};

export type Incident = {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  triggered_by: {
    audit_log_id: string;
    agent_id: string;
    action_type: string;
    risk_score: number;
    policy_triggered: string;
  };
  assigned_to: string | null;
  jira_ticket_id: string | null;
  pagerduty_incident_id: string | null;
  containment_checklist: ChecklistItem[];
  created_at: string;
  resolved_at: string | null;
  timeline: TimelineEvent[];
};
