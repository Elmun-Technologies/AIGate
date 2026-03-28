// ── Permission Audit Service ───────────────────────────────────────────────────
// Records permission-sensitive actions with identity context for SOC 2 compliance.

import type { Permission } from "@/src/config/permissions";
import type { Role } from "@/src/config/roles";

// ── Types ──────────────────────────────────────────────────────────────────────

export type RBACEventType =
    | "ROLE_ASSIGNED"
    | "ROLE_REVOKED"
    | "MEMBER_INVITED"
    | "MEMBER_REMOVED"
    | "PERMISSION_DENIED"
    | "IMPERSONATION_STARTED"
    | "IMPERSONATION_ENDED";

export type PermissionAuditEvent = {
    id: string;
    timestamp: string;
    event_type: RBACEventType;
    actor_id: string;
    actor_email: string;
    actor_role: Role;
    actor_permissions_at_time: Permission[];
    target_user_id?: string;
    target_user_email?: string;
    target_role?: Role;
    permission_attempted?: Permission;
    description: string;
    ip_address: string;
    user_agent: string;
    session_id: string;
};

// ── Storage ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "agentgate_permission_audit_v1";
const SESSION_KEY = "agentgate_session_id";

function getSessionId(): string {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
        sid = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
}

function getMockIp(): string {
    return `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

function loadEvents(): PermissionAuditEvent[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return seedDemoEvents();
        const list = JSON.parse(raw) as PermissionAuditEvent[];
        return list.length ? list : seedDemoEvents();
    } catch {
        return seedDemoEvents();
    }
}

function seedDemoEvents(): PermissionAuditEvent[] {
    const now = Date.now();
    const sid = getSessionId();
    const demos: PermissionAuditEvent[] = [
        {
            id: "paudit_seed_001", timestamp: new Date(now - 86400000).toISOString(),
            event_type: "MEMBER_INVITED", actor_id: "user_admin_001", actor_email: "admin@example.com",
            actor_role: "SECURITY_ADMIN", actor_permissions_at_time: [],
            target_user_id: "user_dev_001", target_user_email: "dev@company.com", target_role: "DEVELOPER",
            description: "admin@example.com invited dev@company.com with role Developer",
            ip_address: "192.168.1.10", user_agent: "seed", session_id: sid,
        },
        {
            id: "paudit_seed_002", timestamp: new Date(now - 72000000).toISOString(),
            event_type: "ROLE_ASSIGNED", actor_id: "user_admin_001", actor_email: "admin@example.com",
            actor_role: "SECURITY_ADMIN", actor_permissions_at_time: [],
            target_user_id: "user_approver_001", target_user_email: "approver@company.com", target_role: "SECURITY_APPROVER",
            description: "admin@example.com assigned Security Approver role to approver@company.com",
            ip_address: "192.168.1.10", user_agent: "seed", session_id: sid,
        },
        {
            id: "paudit_seed_003", timestamp: new Date(now - 43200000).toISOString(),
            event_type: "PERMISSION_DENIED", actor_id: "user_viewer_001", actor_email: "auditor@external.com",
            actor_role: "VIEWER", actor_permissions_at_time: [],
            permission_attempted: "policies:publish",
            description: "auditor@external.com attempted to publish a policy but was denied (Viewer role)",
            ip_address: "10.0.0.55", user_agent: "seed", session_id: sid,
        },
        {
            id: "paudit_seed_004", timestamp: new Date(now - 21600000).toISOString(),
            event_type: "IMPERSONATION_STARTED", actor_id: "user_admin_001", actor_email: "admin@example.com",
            actor_role: "SECURITY_ADMIN", actor_permissions_at_time: [],
            target_user_id: "user_viewer_001", target_user_email: "auditor@external.com", target_role: "VIEWER",
            description: "admin@example.com started impersonating auditor@external.com (Viewer)",
            ip_address: "192.168.1.10", user_agent: "seed", session_id: sid,
        },
        {
            id: "paudit_seed_005", timestamp: new Date(now - 18000000).toISOString(),
            event_type: "IMPERSONATION_ENDED", actor_id: "user_admin_001", actor_email: "admin@example.com",
            actor_role: "SECURITY_ADMIN", actor_permissions_at_time: [],
            target_user_id: "user_viewer_001", target_user_email: "auditor@external.com", target_role: "VIEWER",
            description: "admin@example.com ended impersonation of auditor@external.com",
            ip_address: "192.168.1.10", user_agent: "seed", session_id: sid,
        },
    ];
    saveEvents(demos);
    return demos;
}

function saveEvents(events: PermissionAuditEvent[]): void {
    // Keep max 500 events
    const trimmed = events.slice(0, 500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function recordPermissionAudit(
    eventType: RBACEventType,
    actor: {
        id: string;
        email: string;
        role: Role;
        permissions: Permission[];
    },
    details: {
        targetUserId?: string;
        targetUserEmail?: string;
        targetRole?: Role;
        permissionAttempted?: Permission;
        description: string;
    },
): PermissionAuditEvent {
    const event: PermissionAuditEvent = {
        id: `paudit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        event_type: eventType,
        actor_id: actor.id,
        actor_email: actor.email,
        actor_role: actor.role,
        actor_permissions_at_time: [...actor.permissions],
        target_user_id: details.targetUserId,
        target_user_email: details.targetUserEmail,
        target_role: details.targetRole,
        permission_attempted: details.permissionAttempted,
        description: details.description,
        ip_address: getMockIp(),
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "server",
        session_id: getSessionId(),
    };

    const events = loadEvents();
    events.unshift(event);
    saveEvents(events);

    return event;
}

export function recordPermissionDenied(
    actor: {
        id: string;
        email: string;
        role: Role;
        permissions: Permission[];
    },
    permission: Permission,
    description: string,
): PermissionAuditEvent {
    return recordPermissionAudit("PERMISSION_DENIED", actor, {
        permissionAttempted: permission,
        description,
    });
}

/** Load all permission audit events */
export function loadPermissionAuditEvents(): PermissionAuditEvent[] {
    return loadEvents();
}

/** Load permission audit events filtered by event types */
export function loadPermissionChangeEvents(): PermissionAuditEvent[] {
    return loadEvents().filter((e) =>
        [
            "ROLE_ASSIGNED",
            "ROLE_REVOKED",
            "MEMBER_INVITED",
            "MEMBER_REMOVED",
            "PERMISSION_DENIED",
            "IMPERSONATION_STARTED",
            "IMPERSONATION_ENDED",
        ].includes(e.event_type),
    );
}

/** All RBAC event types for the filter UI */
export const RBAC_EVENT_TYPES: RBACEventType[] = [
    "ROLE_ASSIGNED",
    "ROLE_REVOKED",
    "MEMBER_INVITED",
    "MEMBER_REMOVED",
    "PERMISSION_DENIED",
    "IMPERSONATION_STARTED",
    "IMPERSONATION_ENDED",
];
