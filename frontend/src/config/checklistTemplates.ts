import type { ChecklistItem } from "@/src/types/incident";

export type ChecklistTemplateKey =
  | "PROMPT_INJECTION"
  | "DATA_EXFILTRATION"
  | "SHADOW_MODEL"
  | "SLA_BREACH_ESCALATION";

function item(label: string, required = false): ChecklistItem {
  return {
    id: Math.random().toString(36).slice(2, 10),
    label,
    completed: false,
    completed_by: null,
    completed_at: null,
    required,
  };
}

export const checklistTemplates: Record<ChecklistTemplateKey, ChecklistItem[]> = {
  PROMPT_INJECTION: [
    item("Isolate the affected agent (set status to inactive)", true),
    item("Rotate the agent's API key immediately", true),
    item("Review the last 50 inputs sent to this agent for signs of coordinated attack"),
    item("Check if other agents share the same system prompt and may be similarly vulnerable"),
    item("Document attack vector in Evidence Locker", true),
    item("Notify affected data owners if PII was involved"),
  ],
  DATA_EXFILTRATION: [
    item("Confirm what data was in the blocked payload", true),
    item("Verify no successful exfiltration occurred before the block (check logs 24h prior)", true),
    item("Identify which upstream process fed data to this agent"),
    item("File a potential breach report if PII confirmed", true),
    item("Notify legal and compliance team"),
    item("Update DLP policy to catch similar patterns"),
  ],
  SHADOW_MODEL: [
    item("Identify which team or developer deployed this model", true),
    item("Assess whether the model has processed sensitive data"),
    item("Register the model and assign risk classification", true),
    item("Apply appropriate policy coverage immediately"),
    item("Issue a developer security reminder to the owning team"),
  ],
  SLA_BREACH_ESCALATION: [
    item("Identify why the approval request went unacknowledged"),
    item("Make an approval decision now (approve or deny)", true),
    item("Determine if the SLA window needs to be shortened"),
    item("Review if notification routing reached the right person"),
  ],
};
