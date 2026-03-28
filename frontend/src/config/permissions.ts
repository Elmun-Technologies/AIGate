// ── Permission Registry ────────────────────────────────────────────────────────
// Every granular permission the platform supports, grouped by domain.
// All permissions are typed as a string union so the compiler catches typos.

export const PERMISSIONS = {
  // ── AGENTS ──
  AGENTS_READ: "agents:read" as const,
  AGENTS_WRITE: "agents:write" as const,
  AGENTS_DELETE: "agents:delete" as const,
  AGENTS_ROTATE_KEY: "agents:rotate_key" as const,

  // ── POLICIES ──
  POLICIES_READ: "policies:read" as const,
  POLICIES_WRITE: "policies:write" as const,
  POLICIES_PUBLISH: "policies:publish" as const,
  POLICIES_DELETE: "policies:delete" as const,

  // ── APPROVALS ──
  APPROVALS_READ: "approvals:read" as const,
  APPROVALS_APPROVE: "approvals:approve" as const,
  APPROVALS_DENY: "approvals:deny" as const,
  APPROVALS_BATCH: "approvals:batch" as const,

  // ── INCIDENTS ──
  INCIDENTS_READ: "incidents:read" as const,
  INCIDENTS_WRITE: "incidents:write" as const,
  INCIDENTS_ASSIGN: "incidents:assign" as const,
  INCIDENTS_RESOLVE: "incidents:resolve" as const,

  // ── COMPLIANCE ──
  COMPLIANCE_READ: "compliance:read" as const,
  COMPLIANCE_EXPORT: "compliance:export" as const,
  COMPLIANCE_MAP: "compliance:map" as const,

  // ── EVIDENCE ──
  EVIDENCE_READ: "evidence:read" as const,
  EVIDENCE_EXPORT: "evidence:export" as const,

  // ── AUDIT ──
  AUDIT_READ: "audit:read" as const,
  AUDIT_EXPORT: "audit:export" as const,

  // ── SPEND ──
  SPEND_READ: "spend:read" as const,
  SPEND_CONFIGURE: "spend:configure" as const,

  // ── TEAM ──
  TEAM_READ: "team:read" as const,
  TEAM_INVITE: "team:invite" as const,
  TEAM_MANAGE: "team:manage" as const,

  // ── SETTINGS ──
  SETTINGS_READ: "settings:read" as const,
  SETTINGS_WRITE: "settings:write" as const,
  SETTINGS_DANGER_ZONE: "settings:danger_zone" as const,

  // ── INTEGRATIONS ──
  INTEGRATIONS_READ: "integrations:read" as const,
  INTEGRATIONS_WRITE: "integrations:write" as const,
  INTEGRATIONS_DISCONNECT: "integrations:disconnect" as const,
} as const;

/** Union of every valid permission string */
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Permission metadata for UI display */
export type PermissionMeta = {
  id: Permission;
  label: string;
  description: string;
  domain: PermissionDomain;
};

export type PermissionDomain =
  | "agents"
  | "policies"
  | "approvals"
  | "incidents"
  | "compliance"
  | "evidence"
  | "audit"
  | "spend"
  | "team"
  | "settings"
  | "integrations";

/** Grouped registry for UI display (permission checklist, role editors, etc.) */
export const PERMISSION_REGISTRY: Record<PermissionDomain, PermissionMeta[]> = {
  agents: [
    { id: PERMISSIONS.AGENTS_READ, label: "View Agents", description: "View agent registry", domain: "agents" },
    { id: PERMISSIONS.AGENTS_WRITE, label: "Manage Agents", description: "Register and edit agents", domain: "agents" },
    { id: PERMISSIONS.AGENTS_DELETE, label: "Delete Agents", description: "Remove agents from registry", domain: "agents" },
    { id: PERMISSIONS.AGENTS_ROTATE_KEY, label: "Rotate Keys", description: "Rotate agent API keys", domain: "agents" },
  ],
  policies: [
    { id: PERMISSIONS.POLICIES_READ, label: "View Policies", description: "View policies and rules", domain: "policies" },
    { id: PERMISSIONS.POLICIES_WRITE, label: "Edit Policies", description: "Create and edit policies", domain: "policies" },
    { id: PERMISSIONS.POLICIES_PUBLISH, label: "Publish Policies", description: "Activate policies to enforcement", domain: "policies" },
    { id: PERMISSIONS.POLICIES_DELETE, label: "Delete Policies", description: "Remove policies", domain: "policies" },
  ],
  approvals: [
    { id: PERMISSIONS.APPROVALS_READ, label: "View Queue", description: "View approval queue", domain: "approvals" },
    { id: PERMISSIONS.APPROVALS_APPROVE, label: "Approve Requests", description: "Approve requests", domain: "approvals" },
    { id: PERMISSIONS.APPROVALS_DENY, label: "Deny Requests", description: "Deny requests", domain: "approvals" },
    { id: PERMISSIONS.APPROVALS_BATCH, label: "Batch Approve", description: "Batch approve low-risk requests", domain: "approvals" },
  ],
  incidents: [
    { id: PERMISSIONS.INCIDENTS_READ, label: "View Incidents", description: "View incident list and detail", domain: "incidents" },
    { id: PERMISSIONS.INCIDENTS_WRITE, label: "Update Incidents", description: "Update status and checklist items", domain: "incidents" },
    { id: PERMISSIONS.INCIDENTS_ASSIGN, label: "Assign Incidents", description: "Assign incidents to team members", domain: "incidents" },
    { id: PERMISSIONS.INCIDENTS_RESOLVE, label: "Resolve Incidents", description: "Mark incidents as resolved", domain: "incidents" },
  ],
  compliance: [
    { id: PERMISSIONS.COMPLIANCE_READ, label: "View Compliance", description: "View compliance coverage reports", domain: "compliance" },
    { id: PERMISSIONS.COMPLIANCE_EXPORT, label: "Export Compliance", description: "Export audit packages", domain: "compliance" },
    { id: PERMISSIONS.COMPLIANCE_MAP, label: "Map Controls", description: "Edit framework control mappings", domain: "compliance" },
  ],
  evidence: [
    { id: PERMISSIONS.EVIDENCE_READ, label: "View Evidence", description: "View evidence locker entries", domain: "evidence" },
    { id: PERMISSIONS.EVIDENCE_EXPORT, label: "Export Evidence", description: "Export evidence packages", domain: "evidence" },
  ],
  audit: [
    { id: PERMISSIONS.AUDIT_READ, label: "View Audit Logs", description: "View audit logs", domain: "audit" },
    { id: PERMISSIONS.AUDIT_EXPORT, label: "Export Audit", description: "Export audit CSV and packages", domain: "audit" },
  ],
  spend: [
    { id: PERMISSIONS.SPEND_READ, label: "View Spend", description: "View spend analytics", domain: "spend" },
    { id: PERMISSIONS.SPEND_CONFIGURE, label: "Configure Spend", description: "Set budget thresholds and alerts", domain: "spend" },
  ],
  team: [
    { id: PERMISSIONS.TEAM_READ, label: "View Team", description: "View team members and roles", domain: "team" },
    { id: PERMISSIONS.TEAM_INVITE, label: "Invite Members", description: "Invite new members", domain: "team" },
    { id: PERMISSIONS.TEAM_MANAGE, label: "Manage Team", description: "Edit roles and remove members", domain: "team" },
  ],
  settings: [
    { id: PERMISSIONS.SETTINGS_READ, label: "View Settings", description: "View workspace settings", domain: "settings" },
    { id: PERMISSIONS.SETTINGS_WRITE, label: "Edit Settings", description: "Modify workspace settings", domain: "settings" },
    { id: PERMISSIONS.SETTINGS_DANGER_ZONE, label: "Danger Zone", description: "Access destructive operations", domain: "settings" },
  ],
  integrations: [
    { id: PERMISSIONS.INTEGRATIONS_READ, label: "View Integrations", description: "View integration status", domain: "integrations" },
    { id: PERMISSIONS.INTEGRATIONS_WRITE, label: "Configure Integrations", description: "Configure and connect integrations", domain: "integrations" },
    { id: PERMISSIONS.INTEGRATIONS_DISCONNECT, label: "Disconnect Integrations", description: "Remove integrations", domain: "integrations" },
  ],
};

/** All permissions as a flat array */
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Get human-readable label for a permission */
export function getPermissionLabel(permission: Permission): string {
  for (const metas of Object.values(PERMISSION_REGISTRY)) {
    const found = metas.find((m) => m.id === permission);
    if (found) return found.label;
  }
  return permission;
}

/** Get domain for a permission */
export function getPermissionDomain(permission: Permission): PermissionDomain {
  return permission.split(":")[0] as PermissionDomain;
}
