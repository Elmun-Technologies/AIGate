"use client";

// ── Auth Context ───────────────────────────────────────────────────────────────
// Provides the current user's identity and permissions throughout the app.
// Includes impersonation support and developer self-approval constraint.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Permission } from "@/src/config/permissions";
import type { Role } from "@/src/config/roles";
import { getRolePermissions, isBuiltInRole } from "@/src/config/roles";
import { recordPermissionAudit } from "@/src/services/auditService";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AuthUser = {
    id: string;
    email: string;
    name: string;
    role: Role;
    permissions: Permission[];
    owned_agent_ids: string[];
    last_login: string;
    mfa_verified: boolean;
};

export type ApprovalRequest = {
    id: string;
    agent_id: string;
    [key: string]: unknown;
};

export type AuthContextType = {
    user: AuthUser | null;
    hasPermission: (permission: Permission) => boolean;
    canApproveRequest: (request: ApprovalRequest) => boolean;
    isAdmin: () => boolean;
    impersonating: AuthUser | null;
    startImpersonation: (targetUser: AuthUser) => void;
    stopImpersonation: () => void;
    updateUser: (updates: Partial<AuthUser>) => void;
    setActiveUser: (user: AuthUser) => void;
};

// ── Default user (Security Admin for development) ──────────────────────────────

const DEFAULT_USER: AuthUser = {
    id: "user_admin_001",
    email: "admin@example.com",
    name: "Security Admin",
    role: "SECURITY_ADMIN",
    permissions: getRolePermissions("SECURITY_ADMIN"),
    owned_agent_ids: [],
    last_login: new Date().toISOString(),
    mfa_verified: true,
};

const AUTH_USER_KEY = "agentgate_auth_user_v1";
const IMPERSONATION_KEY = "agentgate_impersonation_v1";

// ── Context ────────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType>({
    user: null,
    hasPermission: () => false,
    canApproveRequest: () => false,
    isAdmin: () => false,
    impersonating: null,
    startImpersonation: () => { },
    stopImpersonation: () => { },
    updateUser: () => { },
    setActiveUser: () => { },
});

// ── Provider ───────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [realUser, setRealUser] = useState<AuthUser | null>(null);
    const [impersonating, setImpersonating] = useState<AuthUser | null>(null);

    // Load user from localStorage on mount
    useEffect(() => {
        try {
            const raw = localStorage.getItem(AUTH_USER_KEY);
            if (raw) {
                const stored = JSON.parse(raw) as AuthUser;
                // Re-resolve permissions from role in case role definitions changed
                stored.permissions = getRolePermissions(stored.role);
                setRealUser(stored);
            } else {
                // Initialize with default admin user
                localStorage.setItem(AUTH_USER_KEY, JSON.stringify(DEFAULT_USER));
                setRealUser(DEFAULT_USER);
            }
        } catch {
            localStorage.setItem(AUTH_USER_KEY, JSON.stringify(DEFAULT_USER));
            setRealUser(DEFAULT_USER);
        }

        // Restore impersonation if active
        try {
            const impRaw = localStorage.getItem(IMPERSONATION_KEY);
            if (impRaw) {
                const impUser = JSON.parse(impRaw) as AuthUser;
                impUser.permissions = getRolePermissions(impUser.role);
                setImpersonating(impUser);
            }
        } catch {
            // ignore
        }
    }, []);

    // The "effective" user — impersonated user if impersonation is active, otherwise the real user
    const effectiveUser = impersonating ?? realUser;

    const hasPermission = useCallback(
        (permission: Permission): boolean => {
            if (!effectiveUser) return false;
            return effectiveUser.permissions.includes(permission);
        },
        [effectiveUser],
    );

    const canApproveRequest = useCallback(
        (request: ApprovalRequest): boolean => {
            if (!effectiveUser) return false;
            // Must have approvals:approve permission
            if (!effectiveUser.permissions.includes("approvals:approve" as Permission)) return false;
            // Developer self-approval constraint: cannot approve requests from own agents
            if (effectiveUser.owned_agent_ids.includes(request.agent_id)) return false;
            return true;
        },
        [effectiveUser],
    );

    const isAdmin = useCallback((): boolean => {
        if (!effectiveUser) return false;
        return effectiveUser.role === "SECURITY_ADMIN";
    }, [effectiveUser]);

    const startImpersonation = useCallback(
        (targetUser: AuthUser) => {
            if (!realUser || realUser.role !== "SECURITY_ADMIN") return;
            const impUser = {
                ...targetUser,
                permissions: getRolePermissions(targetUser.role),
            };
            setImpersonating(impUser);
            localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(impUser));

            recordPermissionAudit("IMPERSONATION_STARTED", {
                id: realUser.id,
                email: realUser.email,
                role: realUser.role,
                permissions: realUser.permissions,
            }, {
                targetUserId: targetUser.id,
                targetUserEmail: targetUser.email,
                targetRole: targetUser.role,
                description: `Admin ${realUser.email} started impersonating ${targetUser.email} (role: ${targetUser.role})`,
            });
        },
        [realUser],
    );

    const stopImpersonation = useCallback(() => {
        if (!realUser || !impersonating) return;

        recordPermissionAudit("IMPERSONATION_ENDED", {
            id: realUser.id,
            email: realUser.email,
            role: realUser.role,
            permissions: realUser.permissions,
        }, {
            targetUserId: impersonating.id,
            targetUserEmail: impersonating.email,
            description: `Admin ${realUser.email} stopped impersonating ${impersonating.email}`,
        });

        setImpersonating(null);
        localStorage.removeItem(IMPERSONATION_KEY);
    }, [realUser, impersonating]);

    const updateUser = useCallback(
        (updates: Partial<AuthUser>) => {
            setRealUser((prev) => {
                if (!prev) return prev;
                const updated = { ...prev, ...updates };
                // Re-resolve permissions if role changed
                if (updates.role) {
                    updated.permissions = getRolePermissions(updates.role);
                }
                localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
                return updated;
            });
        },
        [],
    );

    const setActiveUser = useCallback((user: AuthUser) => {
        const resolved = { ...user, permissions: getRolePermissions(user.role) };
        setRealUser(resolved);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(resolved));
    }, []);

    const value = useMemo<AuthContextType>(
        () => ({
            user: effectiveUser,
            hasPermission,
            canApproveRequest,
            isAdmin,
            impersonating,
            startImpersonation,
            stopImpersonation,
            updateUser,
            setActiveUser,
        }),
        [effectiveUser, hasPermission, canApproveRequest, isAdmin, impersonating, startImpersonation, stopImpersonation, updateUser, setActiveUser],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
    return useContext(AuthContext);
}
