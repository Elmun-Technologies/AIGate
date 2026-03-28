export type IntegrationCategory =
  | "COMMUNICATION"
  | "TICKETING"
  | "OBSERVABILITY"
  | "CI_CD"
  | "SIEM"
  | "IDENTITY";

export type IntegrationStatus = "CONNECTED" | "DISCONNECTED" | "ERROR" | "COMING_SOON";

export type CapabilityDirection = "OUTBOUND" | "INBOUND" | "BIDIRECTIONAL";

export type ConfigFieldType = "text" | "password" | "url" | "select" | "toggle";

export type IntegrationCapability = {
  id: string;
  label: string;
  direction: CapabilityDirection;
  enabled: boolean;
  trigger_event: string;
};

export type ConfigField = {
  key: string;
  label: string;
  type: ConfigFieldType;
  required: boolean;
  placeholder: string;
  help_text: string;
  options?: string[];
  default_value?: string | boolean;
};

export type Integration = {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  logo_url: string;
  status: IntegrationStatus;
  capabilities: IntegrationCapability[];
  config_schema: ConfigField[];
  docs_url: string;
  connected_at: string | null;
  last_sync_at: string | null;
  event_count_24h: number;
};

function logo(letter: string, bg: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'>
    <rect width='64' height='64' rx='14' fill='${bg}' />
    <text x='32' y='41' text-anchor='middle' font-size='30' font-family='Arial, sans-serif' font-weight='700' fill='white'>${letter}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const INTEGRATIONS_REGISTRY: Integration[] = [
  {
    id: "SLACK",
    name: "Slack",
    category: "COMMUNICATION",
    description: "Bi-directional alerting and approval workflow integration for security operations.",
    logo_url: logo("S", "#4A154B"),
    status: "CONNECTED",
    capabilities: [
      {
        id: "slack_sla_alerts",
        label: "Send SLA breach alerts",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "SLA_BREACH_NOTIFIED",
      },
      {
        id: "slack_incident_notifications",
        label: "Send incident notifications",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "INCIDENT_CREATED",
      },
      {
        id: "slack_approval_commands",
        label: "Receive approval decisions via slash command",
        direction: "INBOUND",
        enabled: true,
        trigger_event: "APPROVAL_DECISION",
      },
      {
        id: "slack_daily_digest",
        label: "Daily compliance digest",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "SCHEDULED_DIGEST",
      },
    ],
    config_schema: [
      {
        key: "webhook_url",
        label: "Webhook URL",
        type: "url",
        required: true,
        placeholder: "https://hooks.slack.com/services/T.../B.../...",
        help_text: "Incoming webhook used for outbound notifications.",
      },
      {
        key: "bot_token",
        label: "Bot Token",
        type: "password",
        required: false,
        placeholder: "xoxb-...",
        help_text: "Optional. Required only for slash command and richer API actions.",
      },
      {
        key: "default_channel",
        label: "Default Channel",
        type: "text",
        required: true,
        placeholder: "#ai-governance-alerts",
        help_text: "Target channel for incident and SLA notifications.",
      },
      {
        key: "notify_on_critical_only",
        label: "Notify On Critical Only",
        type: "toggle",
        required: false,
        placeholder: "",
        help_text: "If enabled, sends only CRITICAL severity events to Slack.",
        default_value: false,
      },
    ],
    docs_url: "https://api.slack.com/messaging/webhooks",
    connected_at: "2026-03-01T09:12:00.000Z",
    last_sync_at: "2026-03-06T17:42:00.000Z",
    event_count_24h: 247,
  },
  {
    id: "JIRA",
    name: "Jira",
    category: "TICKETING",
    description: "Automate incident ticket lifecycles and keep issue status synchronized.",
    logo_url: logo("J", "#0052CC"),
    status: "CONNECTED",
    capabilities: [
      {
        id: "jira_auto_incident",
        label: "Auto-create incident tickets",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "INCIDENT_CREATED",
      },
      {
        id: "jira_bidirectional_status",
        label: "Sync incident status bidirectionally",
        direction: "BIDIRECTIONAL",
        enabled: true,
        trigger_event: "INCIDENT_STATUS_CHANGED",
      },
      {
        id: "jira_attach_evidence",
        label: "Attach evidence package to ticket",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "EVIDENCE_EXPORTED",
      },
    ],
    config_schema: [
      {
        key: "domain",
        label: "Domain",
        type: "url",
        required: true,
        placeholder: "https://company.atlassian.net",
        help_text: "Your Jira Cloud domain, e.g. company.atlassian.net.",
      },
      {
        key: "email",
        label: "Email",
        type: "text",
        required: true,
        placeholder: "security-admin@company.com",
        help_text: "Email address associated with the Jira API token.",
      },
      {
        key: "api_token",
        label: "API Token",
        type: "password",
        required: true,
        placeholder: "••••••••",
        help_text: "Atlassian API token with create/edit issue permissions.",
      },
      {
        key: "project_key",
        label: "Project Key",
        type: "text",
        required: true,
        placeholder: "SEC",
        help_text: "Jira project key where incidents should be created.",
      },
      {
        key: "incident_issue_type",
        label: "Incident Issue Type",
        type: "select",
        required: false,
        placeholder: "Bug",
        help_text: "Issue type used when creating incidents.",
        options: ["Bug", "Task", "Story", "Epic"],
        default_value: "Bug",
      },
    ],
    docs_url: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
    connected_at: "2026-02-28T07:24:00.000Z",
    last_sync_at: "2026-03-06T16:18:00.000Z",
    event_count_24h: 12,
  },
  {
    id: "PAGERDUTY",
    name: "PagerDuty",
    category: "TICKETING",
    description: "Escalate critical incidents to on-call teams and synchronize acknowledgements.",
    logo_url: logo("P", "#06AC38"),
    status: "DISCONNECTED",
    capabilities: [
      {
        id: "pagerduty_oncall_alert",
        label: "Trigger on-call alerts for CRITICAL incidents",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "INCIDENT_CREATED",
      },
      {
        id: "pagerduty_ack_sync",
        label: "Sync acknowledgement back to incident status",
        direction: "INBOUND",
        enabled: true,
        trigger_event: "PAGERDUTY_ACK_RECEIVED",
      },
      {
        id: "pagerduty_auto_resolve",
        label: "Auto-resolve when incident is RESOLVED",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "INCIDENT_RESOLVED",
      },
    ],
    config_schema: [
      {
        key: "routing_key",
        label: "Routing Key",
        type: "password",
        required: true,
        placeholder: "••••••••",
        help_text: "PagerDuty Events API v2 routing key.",
      },
      {
        key: "escalation_policy_id",
        label: "Escalation Policy ID",
        type: "text",
        required: false,
        placeholder: "PABC123",
        help_text: "Optional policy ID for escalations.",
      },
      {
        key: "severity_threshold",
        label: "Severity Threshold",
        type: "select",
        required: false,
        placeholder: "HIGH",
        help_text: "Only page incidents at this severity and above.",
        options: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        default_value: "HIGH",
      },
    ],
    docs_url: "https://developer.pagerduty.com/docs/events-api-v2/overview/",
    connected_at: null,
    last_sync_at: null,
    event_count_24h: 0,
  },
  {
    id: "SPLUNK",
    name: "Splunk",
    category: "SIEM",
    description: "Stream AI governance logs and incident events into your SIEM for investigation.",
    logo_url: logo("S", "#111827"),
    status: "DISCONNECTED",
    capabilities: [
      {
        id: "splunk_forward_all_audit",
        label: "Forward all audit log events to Splunk index",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "ALL_EVENTS",
      },
      {
        id: "splunk_forward_blocked",
        label: "Forward blocked actions with full payload",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "POLICY_TRIGGERED",
      },
      {
        id: "splunk_incident_lifecycle",
        label: "Forward incident lifecycle events",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "INCIDENT_CREATED|INCIDENT_RESOLVED",
      },
    ],
    config_schema: [
      {
        key: "hec_url",
        label: "HEC URL",
        type: "url",
        required: true,
        placeholder: "https://splunk.example.com:8088/services/collector",
        help_text: "HTTP Event Collector endpoint URL.",
      },
      {
        key: "hec_token",
        label: "HEC Token",
        type: "password",
        required: true,
        placeholder: "••••••••",
        help_text: "Token used to authenticate to Splunk HEC.",
      },
      {
        key: "index",
        label: "Index",
        type: "text",
        required: false,
        placeholder: "ai_governance",
        help_text: "Target Splunk index.",
        default_value: "ai_governance",
      },
      {
        key: "sourcetype",
        label: "Sourcetype",
        type: "text",
        required: false,
        placeholder: "ai_governance:event",
        help_text: "Splunk sourcetype for all forwarded events.",
        default_value: "ai_governance:event",
      },
      {
        key: "batch_size",
        label: "Batch Size",
        type: "text",
        required: false,
        placeholder: "100",
        help_text: "Number of events per dispatch batch.",
        default_value: "100",
      },
    ],
    docs_url: "https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector",
    connected_at: null,
    last_sync_at: null,
    event_count_24h: 0,
  },
  {
    id: "DATADOG",
    name: "Datadog",
    category: "OBSERVABILITY",
    description: "Export AI risk metrics, logs, and incident events into Datadog observability.",
    logo_url: logo("D", "#1D4ED8"),
    status: "ERROR",
    capabilities: [
      {
        id: "datadog_custom_metrics",
        label: "Send custom metrics: risk_score, blocked_count, agent_health_score",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "METRIC_EXPORTED",
      },
      {
        id: "datadog_incident_events",
        label: "Create Datadog events for high-risk incidents",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "INCIDENT_CREATED",
      },
      {
        id: "datadog_logs_api",
        label: "Send logs via Datadog Logs API",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "ALL_EVENTS",
      },
    ],
    config_schema: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        required: true,
        placeholder: "••••••••",
        help_text: "Datadog API key.",
      },
      {
        key: "app_key",
        label: "APP Key",
        type: "password",
        required: true,
        placeholder: "••••••••",
        help_text: "Datadog application key.",
      },
      {
        key: "site",
        label: "Site",
        type: "select",
        required: false,
        placeholder: "datadoghq.com",
        help_text: "Datadog site where events and logs are sent.",
        options: ["datadoghq.com", "datadoghq.eu", "us3.datadoghq.com"],
        default_value: "datadoghq.com",
      },
      {
        key: "service_name",
        label: "Service Name",
        type: "text",
        required: false,
        placeholder: "ai-governance",
        help_text: "Service tag attached to metrics and events.",
        default_value: "ai-governance",
      },
      {
        key: "env_tag",
        label: "Environment Tag",
        type: "text",
        required: false,
        placeholder: "production",
        help_text: "Environment tag value appended to data points.",
        default_value: "production",
      },
    ],
    docs_url: "https://docs.datadoghq.com/api/latest/",
    connected_at: "2026-02-20T09:35:00.000Z",
    last_sync_at: "2026-03-06T14:12:00.000Z",
    event_count_24h: 63,
  },
  {
    id: "GITHUB_ACTIONS",
    name: "GitHub Actions",
    category: "CI_CD",
    description: "Gate merges with policy simulation checks and deploy policy updates on main.",
    logo_url: logo("G", "#24292F"),
    status: "DISCONNECTED",
    capabilities: [
      {
        id: "gh_block_merge_on_fail",
        label: "Block PR merge when policy simulation fails",
        direction: "INBOUND",
        enabled: true,
        trigger_event: "POLICY_SIMULATION_FAILED",
      },
      {
        id: "gh_trigger_deploy_on_main",
        label: "Trigger policy deployment on merge to main",
        direction: "INBOUND",
        enabled: true,
        trigger_event: "GITHUB_PUSH_EVENT",
      },
      {
        id: "gh_post_coverage_comment",
        label: "Post compliance coverage summary as PR comment",
        direction: "OUTBOUND",
        enabled: true,
        trigger_event: "COMPLIANCE_REPORT_GENERATED",
      },
    ],
    config_schema: [
      {
        key: "personal_access_token",
        label: "Personal Access Token",
        type: "password",
        required: true,
        placeholder: "ghp_...",
        help_text: "GitHub PAT with workflow and pull request write permissions.",
      },
      {
        key: "repository",
        label: "Repository",
        type: "text",
        required: true,
        placeholder: "org/repo",
        help_text: "GitHub repository identifier, e.g. org/repo.",
      },
      {
        key: "workflow_file",
        label: "Workflow File",
        type: "text",
        required: false,
        placeholder: ".github/workflows/ai-governance.yml",
        help_text: "Path for generated workflow file in the repository.",
        default_value: ".github/workflows/ai-governance.yml",
      },
      {
        key: "block_on_policy_failure",
        label: "Block On Policy Failure",
        type: "toggle",
        required: false,
        placeholder: "",
        help_text: "Fail CI checks when any DENY decision is returned.",
        default_value: true,
      },
    ],
    docs_url: "https://docs.github.com/en/actions",
    connected_at: null,
    last_sync_at: null,
    event_count_24h: 0,
  },
];

export const INTEGRATION_CATEGORIES: Array<{ id: "ALL" | IntegrationCategory; label: string }> = [
  { id: "ALL", label: "ALL" },
  { id: "COMMUNICATION", label: "COMMUNICATION" },
  { id: "TICKETING", label: "TICKETING" },
  { id: "OBSERVABILITY", label: "OBSERVABILITY" },
  { id: "CI_CD", label: "CI/CD" },
  { id: "SIEM", label: "SIEM" },
  { id: "IDENTITY", label: "IDENTITY" },
];
