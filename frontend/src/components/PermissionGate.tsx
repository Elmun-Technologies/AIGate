"use client";

// ── Permission Gate ────────────────────────────────────────────────────────────
// Declarative component and imperative hook for enforcing permissions at the UI layer.

import React from "react";
import { useAuth, type ApprovalRequest } from "@/src/contexts/AuthContext";
import type { Permission } from "@/src/config/permissions";
import { getPermissionLabel } from "@/src/config/permissions";
import { recordPermissionDenied } from "@/src/services/auditService";

// ── PermissionGate Component ───────────────────────────────────────────────────

type FallbackBehavior = "hide" | "disable" | "replace";

type PermissionGateProps = {
    permission: Permission;
    /** "hide" (default) = render nothing; "disable" = grey out; "replace" = use fallbackElement */
    fallback?: FallbackBehavior;
    /** Custom element shown when fallback="replace" */
    fallbackElement?: React.ReactNode;
    children: React.ReactNode;
};

export function PermissionGate({
    permission,
    fallback = "hide",
    fallbackElement,
    children,
}: PermissionGateProps) {
    const { hasPermission } = useAuth();
    const allowed = hasPermission(permission);

    if (allowed) return <>{children}</>;

    switch (fallback) {
        case "disable":
            return (
                <div
                    style={{ opacity: 0.4, pointerEvents: "none", position: "relative", cursor: "not-allowed" }}
                    title={`Requires permission: ${getPermissionLabel(permission)}`}
                >
                    {children}
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            zIndex: 2,
                        }}
                    >
                        <span
                            style={{
                                background: "rgba(0,0,0,0.75)",
                                color: "#fff",
                                fontSize: 10,
                                fontFamily: "monospace",
                                padding: "2px 8px",
                                borderRadius: 4,
                                whiteSpace: "nowrap",
                            }}
                        >
                            🔒 {getPermissionLabel(permission)}
                        </span>
                    </div>
                </div>
            );

        case "replace":
            return <>{fallbackElement ?? null}</>;

        case "hide":
        default:
            return null;
    }
}

// ── usePermission Hook ─────────────────────────────────────────────────────────

export function usePermission() {
    const { user, hasPermission, canApproveRequest } = useAuth();

    /** Check permission; optionally record denial in audit log */
    const checkPermission = (permission: Permission, recordDenial = false): boolean => {
        const allowed = hasPermission(permission);
        if (!allowed && recordDenial && user) {
            recordPermissionDenied(
                {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    permissions: user.permissions,
                },
                permission,
                `User ${user.email} attempted action requiring ${permission}`,
            );
        }
        return allowed;
    };

    /** Service-layer permission check that always records denial */
    const enforcePermission = (permission: Permission): boolean => {
        return checkPermission(permission, true);
    };

    return {
        hasPermission,
        checkPermission,
        enforcePermission,
        canApproveRequest: canApproveRequest as (request: ApprovalRequest) => boolean,
    };
}
