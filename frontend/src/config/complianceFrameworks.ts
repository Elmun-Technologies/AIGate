export type ComplianceControlDefinition = {
  control_id: string;
  control_name: string;
  evidence_tags: string[];
};

export type ComplianceFrameworkDefinition = {
  framework_id: "SOC_2" | "ISO_27001" | "NIST_AI_RMF" | "EU_AI_ACT";
  framework_name: string;
  controls: ComplianceControlDefinition[];
};

export const complianceFrameworks: ComplianceFrameworkDefinition[] = [
  {
    framework_id: "SOC_2",
    framework_name: "SOC 2",
    controls: [
      {
        control_id: "CC6.1",
        control_name: "Logical access controls",
        evidence_tags: ["RUNTIME_AUTH_VERIFIED", "RUNTIME_AUTH_ISSUED", "IAM_ROLE_ASSIGNED"],
      },
      {
        control_id: "CC6.6",
        control_name: "External threat protection",
        evidence_tags: ["TOOL_EXECUTED", "POLICY_TRIGGERED", "APPROVAL_DECISION"],
      },
      {
        control_id: "CC7.2",
        control_name: "System monitoring",
        evidence_tags: ["TOOL_EXECUTED", "AUDIT_LOG_EXPORTED", "ANOMALY_DETECTED"],
      },
      {
        control_id: "CC9.2",
        control_name: "Risk mitigation",
        evidence_tags: ["INCIDENT_CREATED", "INCIDENT_RESOLVED", "POLICY_PUBLISHED"],
      },
    ],
  },
  {
    framework_id: "ISO_27001",
    framework_name: "ISO 27001",
    controls: [
      {
        control_id: "A.9.4",
        control_name: "System access control",
        evidence_tags: ["RUNTIME_AUTH_VERIFIED", "RUNTIME_AUTH_ISSUED"],
      },
      {
        control_id: "A.12.4",
        control_name: "Logging and monitoring",
        evidence_tags: ["TOOL_EXECUTED", "AUDIT_LOG_EXPORTED"],
      },
      {
        control_id: "A.16.1",
        control_name: "Incident management",
        evidence_tags: ["INCIDENT_CREATED", "INCIDENT_RESOLVED", "SLA_BREACH_NOTIFIED"],
      },
      {
        control_id: "A.18.1",
        control_name: "Compliance with legal requirements",
        evidence_tags: ["APPROVAL_DECISION", "POLICY_PUBLISHED", "EVIDENCE_EXPORTED"],
      },
    ],
  },
  {
    framework_id: "NIST_AI_RMF",
    framework_name: "NIST AI RMF",
    controls: [
      {
        control_id: "GOVERN 1.1",
        control_name: "AI risk policies established",
        evidence_tags: ["POLICY_PUBLISHED", "POLICY_ACTIVATED"],
      },
      {
        control_id: "MAP 1.1",
        control_name: "AI system context identified",
        evidence_tags: ["AGENT_REGISTERED", "MODEL_REGISTERED"],
      },
      {
        control_id: "MEASURE 2.5",
        control_name: "AI outputs monitored",
        evidence_tags: ["TOOL_EXECUTED", "ANOMALY_DETECTED", "APPROVAL_DECISION"],
      },
      {
        control_id: "MANAGE 1.3",
        control_name: "Incidents tracked and resolved",
        evidence_tags: ["INCIDENT_CREATED", "INCIDENT_RESOLVED"],
      },
    ],
  },
  {
    framework_id: "EU_AI_ACT",
    framework_name: "EU AI Act",
    controls: [
      {
        control_id: "Article 9",
        control_name: "Risk management system",
        evidence_tags: ["INCIDENT_CREATED", "POLICY_PUBLISHED", "AGENT_REGISTERED"],
      },
      {
        control_id: "Article 12",
        control_name: "Record keeping",
        evidence_tags: ["TOOL_EXECUTED", "AUDIT_LOG_EXPORTED", "EVIDENCE_EXPORTED"],
      },
      {
        control_id: "Article 13",
        control_name: "Transparency obligations",
        evidence_tags: ["APPROVAL_DECISION", "POLICY_TRIGGERED"],
      },
      {
        control_id: "Article 17",
        control_name: "Quality management system",
        evidence_tags: ["MODEL_REGISTERED", "POLICY_PUBLISHED", "INCIDENT_RESOLVED"],
      },
    ],
  },
];

export const frameworksById = Object.fromEntries(
  complianceFrameworks.map((fw) => [fw.framework_id, fw])
) as Record<ComplianceFrameworkDefinition["framework_id"], ComplianceFrameworkDefinition>;
