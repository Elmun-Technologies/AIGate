// ── Role Definitions ───────────────────────────────────────────────────────────
// Five immutable built-in roles + support for custom roles.
// Built-in roles cannot be edited; custom roles are stored in workspace config.

import { ALL_PERMISSIONS, Permission, PERMISSIONS } from "./permissions";

// ── Built-in Role Types ────────────────────────────────────────────────────────

export type BuiltInRole =
    | "SECURITY_ADMIN"
    | "SECURITY_APPROVER"
    | "DEVELOPER"
    | "COMPLIANCE_OFFICER"
    | "VIEWER";

export type Role = BuiltInRole | `custom:${string}`;

export type RoleDefinition = {
    id: Role;
    label: string;
    description: string;
    permissions: Permission[];
    isBuiltIn: true;
};

export type CustomRole = {
    id: `custom:${string}`;
    label: string;
    description: string;
    permissions: Permission[];
    isBuiltIn: false;
    createdBy: string;
    createdAt: string;
};

export type AnyRoleDefinition = RoleDefinition | CustomRole;

// ── Built-in Role Definitions ──────────────────────────────────────────────────

export const ROLE_DEFINITIONS: Record<BuiltInRole, RoleDefinition> = {
    SECURITY_ADMIN: {
        id: "SECURITY_ADMIN",
        label: "Security Admin",
        description: "Full access to all platform features. The only role with access to Danger Zone and Team Management.",
        permissions: [...ALL_PERMISSIONS],
        isBuiltIn: true,
    },

    SECURITY_APPROVER: {
        id: "SECURITY_APPROVER",
        label: "Security Approver",
        description: "Can approve/deny requests, manage incidents, and view compliance and audit data.",
        permissions: [
            PERMISSIONS.AGENTS_READ,
            PERMISSIONS.POLICIES_READ,
            PERMISSIONS.POLICIES_PUBLISH,
            PERMISSIONS.APPROVALS_READ,
            PERMISSIONS.APPROVALS_APPROVE,
            PERMISSIONS.APPROVALS_DENY,
            PERMISSIONS.APPROVALS_BATCH,
            PERMISSIONS.INCIDENTS_READ,
            PERMISSIONS.INCIDENTS_WRITE,
            PERMISSIONS.INCIDENTS_ASSIGN,
            PERMISSIONS.INCIDENTS_RESOLVE,
            PERMISSIONS.COMPLIANCE_READ,
            PERMISSIONS.EVIDENCE_READ,
            PERMISSIONS.AUDIT_READ,
            PERMISSIONS.SPEND_READ,
            PERMISSIONS.TEAM_READ,
            PERMISSIONS.INTEGRATIONS_READ,
        ],
        isBuiltIn: true,
    },

    DEVELOPER: {
        id: "DEVELOPER",
        label: "Developer",
        description: "Can register agents, rotate keys, and view policies and approvals. Cannot approve requests from own agents.",
        permissions: [
            PERMISSIONS.AGENTS_READ,
            PERMISSIONS.AGENTS_WRITE,
            PERMISSIONS.AGENTS_ROTATE_KEY,
            PERMISSIONS.POLICIES_READ,
            PERMISSIONS.APPROVALS_READ,
            PERMISSIONS.INCIDENTS_READ,
            PERMISSIONS.AUDIT_READ,
            PERMISSIONS.SPEND_READ,
            PERMISSIONS.INTEGRATIONS_READ,
        ],
        isBuiltIn: true,
    },

    COMPLIANCE_OFFICER: {
        id: "COMPLIANCE_OFFICER",
        label: "Compliance Officer",
        description: "Full access to compliance, evidence, and audit data with export capabilities.",
        permissions: [
            PERMISSIONS.AGENTS_READ,
            PERMISSIONS.POLICIES_READ,
            PERMISSIONS.APPROVALS_READ,
            PERMISSIONS.INCIDENTS_READ,
            PERMISSIONS.COMPLIANCE_READ,
            PERMISSIONS.COMPLIANCE_EXPORT,
            PERMISSIONS.COMPLIANCE_MAP,
            PERMISSIONS.EVIDENCE_READ,
            PERMISSIONS.EVIDENCE_EXPORT,
            PERMISSIONS.AUDIT_READ,
            PERMISSIONS.AUDIT_EXPORT,
            PERMISSIONS.SPEND_READ,
            PERMISSIONS.TEAM_READ,
        ],
        isBuiltIn: true,
    },

    VIEWER: {
        id: "VIEWER",
        label: "Viewer",
        description: "Read-only access across all modules. Cannot modify any data.",
        permissions: [
            PERMISSIONS.AGENTS_READ,
            PERMISSIONS.POLICIES_READ,
            PERMISSIONS.APPROVALS_READ,
            PERMISSIONS.INCIDENTS_READ,
            PERMISSIONS.COMPLIANCE_READ,
            PERMISSIONS.EVIDENCE_READ,
            PERMISSIONS.AUDIT_READ,
            PERMISSIONS.SPEND_READ,
            PERMISSIONS.TEAM_READ,
            PERMISSIONS.INTEGRATIONS_READ,
        ],
        isBuiltIn: true,
    },
};

// ── Custom Role Storage ────────────────────────────────────────────────────────

const CUSTOM_ROLES_KEY = "agentgate_custom_roles_v1";

export function loadCustomRoles(): CustomRole[] {
    try {
        const raw = localStorage.getItem(CUSTOM_ROLES_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as CustomRole[];
    } catch {
        return [];
    }
}

function saveCustomRoles(roles: CustomRole[]): void {
    localStorage.setItem(CUSTOM_ROLES_KEY, JSON.stringify(roles));
}

export function createCustomRole(
    name: string,
    description: string,
    permissions: Permission[],
    createdBy: string,
): CustomRole {
    const id = `custom:${name.toLowerCase().replace(/\s+/g, "_")}` as `custom:${string}`;
    const role: CustomRole = {
        id,
        label: name,
        description,
        permissions,
        isBuiltIn: false,
        createdBy,
        createdAt: new Date().toISOString(),
    };
    const existing = loadCustomRoles();
    existing.push(role);
    saveCustomRoles(existing);
    return role;
}

export function updateCustomRole(
    roleId: `custom:${string}`,
    updates: { label?: string; description?: string; permissions?: Permission[] },
): CustomRole | null {
    const roles = loadCustomRoles();
    const idx = roles.findIndex((r) => r.id === roleId);
    if (idx === -1) return null;
    if (updates.label !== undefined) roles[idx].label = updates.label;
    if (updates.description !== undefined) roles[idx].description = updates.description;
    if (updates.permissions !== undefined) roles[idx].permissions = updates.permissions;
    saveCustomRoles(roles);
    return roles[idx];
}

export function deleteCustomRole(roleId: `custom:${string}`): boolean {
    const roles = loadCustomRoles();
    const filtered = roles.filter((r) => r.id !== roleId);
    if (filtered.length === roles.length) return false;
    saveCustomRoles(filtered);
    return true;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Get permissions for any role (built-in or custom) */
export function getRolePermissions(role: Role): Permission[] {
    if (isBuiltInRole(role)) {
        return ROLE_DEFINITIONS[role].permissions;
    }
    const custom = loadCustomRoles().find((r) => r.id === role);
    return custom?.permissions ?? [];
}

/** Get role definition (built-in or custom) */
export function getRoleDefinition(role: Role): AnyRoleDefinition | null {
    if (isBuiltInRole(role)) {
        return ROLE_DEFINITIONS[role];
    }
    return loadCustomRoles().find((r) => r.id === role) ?? null;
}

/** Get human-readable label for a role */
export function getRoleLabel(role: Role): string {
    const def = getRoleDefinition(role);
    return def?.label ?? role;
}

/** Check if a role is one of the five built-in roles */
export function isBuiltInRole(role: string): role is BuiltInRole {
    return role in ROLE_DEFINITIONS;
}

/** List all available roles (built-in + custom) */
export function listAllRoles(): AnyRoleDefinition[] {
    const builtIn = Object.values(ROLE_DEFINITIONS);
    const custom = loadCustomRoles();
    return [...builtIn, ...custom];
}

/** Built-in role keys array for iterating */
export const BUILT_IN_ROLES: BuiltInRole[] = [
    "SECURITY_ADMIN",
    "SECURITY_APPROVER",
    "DEVELOPER",
    "COMPLIANCE_OFFICER",
    "VIEWER",
];
