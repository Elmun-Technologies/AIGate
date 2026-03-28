"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/src/contexts/AuthContext";
import { PermissionGate } from "@/src/components/PermissionGate";
import { Permission, PERMISSION_REGISTRY, type PermissionDomain } from "@/src/config/permissions";
import {
    BUILT_IN_ROLES,
    getRoleLabel,
    getRolePermissions,
    listAllRoles,
    createCustomRole,
    deleteCustomRole,
    type Role,
    type AnyRoleDefinition,
} from "@/src/config/roles";
import { recordPermissionAudit } from "@/src/services/auditService";

// ── Types ──────────────────────────────────────────────────────────────────────

type TeamMemberStatus = "ACTIVE" | "PENDING" | "DISABLED";

type TeamMember = {
    id: string;
    email: string;
    name: string;
    role: Role;
    status: TeamMemberStatus;
    last_login: string | null;
    mfa_verified: boolean;
    joined_at: string;
    invited_by: string;
};

// ── Storage ────────────────────────────────────────────────────────────────────

const MEMBERS_KEY = "agentgate_team_members_v1";

function loadMembers(): TeamMember[] {
    try {
        const raw = localStorage.getItem(MEMBERS_KEY);
        if (!raw) return getDefaultMembers();
        const list = JSON.parse(raw) as TeamMember[];
        return list.length ? list : getDefaultMembers();
    } catch {
        return getDefaultMembers();
    }
}

function saveMembers(members: TeamMember[]): void {
    localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
}

function getDefaultMembers(): TeamMember[] {
    return [
        {
            id: "user_admin_001",
            email: "admin@example.com",
            name: "Security Admin",
            role: "SECURITY_ADMIN",
            status: "ACTIVE",
            last_login: new Date().toISOString(),
            mfa_verified: true,
            joined_at: new Date(Date.now() - 90 * 86400000).toISOString(),
            invited_by: "system",
        },
        {
            id: "user_approver_001",
            email: "approver@company.com",
            name: "Sarah Chen",
            role: "SECURITY_APPROVER",
            status: "ACTIVE",
            last_login: new Date(Date.now() - 3600000).toISOString(),
            mfa_verified: true,
            joined_at: new Date(Date.now() - 60 * 86400000).toISOString(),
            invited_by: "admin@example.com",
        },
        {
            id: "user_dev_001",
            email: "dev@company.com",
            name: "Marcus Rivera",
            role: "DEVELOPER",
            status: "ACTIVE",
            last_login: new Date(Date.now() - 7200000).toISOString(),
            mfa_verified: true,
            joined_at: new Date(Date.now() - 45 * 86400000).toISOString(),
            invited_by: "admin@example.com",
        },
        {
            id: "user_compliance_001",
            email: "compliance@company.com",
            name: "Elena Vasquez",
            role: "COMPLIANCE_OFFICER",
            status: "ACTIVE",
            last_login: new Date(Date.now() - 86400000).toISOString(),
            mfa_verified: false,
            joined_at: new Date(Date.now() - 30 * 86400000).toISOString(),
            invited_by: "admin@example.com",
        },
        {
            id: "user_viewer_001",
            email: "auditor@external.com",
            name: "James Park",
            role: "VIEWER",
            status: "ACTIVE",
            last_login: new Date(Date.now() - 259200000).toISOString(),
            mfa_verified: true,
            joined_at: new Date(Date.now() - 15 * 86400000).toISOString(),
            invited_by: "admin@example.com",
        },
        {
            id: "user_pending_001",
            email: "new-hire@company.com",
            name: "Pending User",
            role: "DEVELOPER",
            status: "PENDING",
            last_login: null,
            mfa_verified: false,
            joined_at: new Date(Date.now() - 86400000).toISOString(),
            invited_by: "admin@example.com",
        },
    ];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
    if (!iso) return "Never";
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "Just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function TeamPage() {
    const router = useRouter();
    const { user, isAdmin, startImpersonation, impersonating, stopImpersonation } = useAuth();
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [showInvite, setShowInvite] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState<Role>("VIEWER");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editRole, setEditRole] = useState<Role>("VIEWER");
    const [showRemoveConfirm, setShowRemoveConfirm] = useState<string | null>(null);
    const [showCustomRoleDialog, setShowCustomRoleDialog] = useState(false);
    const [customRoleName, setCustomRoleName] = useState("");
    const [customRoleDesc, setCustomRoleDesc] = useState("");
    const [customRolePerms, setCustomRolePerms] = useState<Permission[]>([]);
    const [notice, setNotice] = useState("");

    useEffect(() => {
        if (!localStorage.getItem("token")) {
            router.replace("/login");
            return;
        }
        setMembers(loadMembers());
    }, [router]);

    useEffect(() => {
        if (!notice) return;
        const t = setTimeout(() => setNotice(""), 3000);
        return () => clearTimeout(t);
    }, [notice]);

    const allRoles = useMemo(() => listAllRoles(), [members]);

    const stats = useMemo(() => {
        const total = members.length;
        const admins = members.filter((m) => m.role === "SECURITY_ADMIN").length;
        const pending = members.filter((m) => m.status === "PENDING").length;
        const lastActivity = members
            .filter((m) => m.last_login)
            .sort((a, b) => new Date(b.last_login!).getTime() - new Date(a.last_login!).getTime())[0];
        return { total, admins, pending, lastActivity: lastActivity ? timeAgo(lastActivity.last_login) : "—" };
    }, [members]);

    // ── Actions ──────────────────────────────────────────────────────────────────

    const inviteMember = useCallback(() => {
        if (!inviteEmail.trim() || !user) return;
        const newMember: TeamMember = {
            id: `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            email: inviteEmail.trim(),
            name: inviteEmail.split("@")[0],
            role: inviteRole,
            status: "PENDING",
            last_login: null,
            mfa_verified: false,
            joined_at: new Date().toISOString(),
            invited_by: user.email,
        };
        const updated = [...members, newMember];
        setMembers(updated);
        saveMembers(updated);

        recordPermissionAudit("MEMBER_INVITED", {
            id: user.id,
            email: user.email,
            role: user.role,
            permissions: user.permissions,
        }, {
            targetUserId: newMember.id,
            targetUserEmail: newMember.email,
            targetRole: inviteRole,
            description: `${user.email} invited ${newMember.email} with role ${getRoleLabel(inviteRole)}`,
        });

        setInviteEmail("");
        setInviteRole("VIEWER");
        setShowInvite(false);
        setNotice(`Invite sent to ${newMember.email}`);
    }, [inviteEmail, inviteRole, members, user]);

    const changeRole = useCallback(
        (memberId: string) => {
            if (!user) return;
            const member = members.find((m) => m.id === memberId);
            if (!member) return;

            // Prevent removing last admin
            if (member.role === "SECURITY_ADMIN" && editRole !== "SECURITY_ADMIN") {
                const adminCount = members.filter((m) => m.role === "SECURITY_ADMIN").length;
                if (adminCount <= 1) {
                    setNotice("Cannot demote the last Security Admin");
                    setEditingId(null);
                    return;
                }
            }

            const oldRole = member.role;
            const updated = members.map((m) => (m.id === memberId ? { ...m, role: editRole } : m));
            setMembers(updated);
            saveMembers(updated);

            recordPermissionAudit("ROLE_ASSIGNED", {
                id: user.id,
                email: user.email,
                role: user.role,
                permissions: user.permissions,
            }, {
                targetUserId: member.id,
                targetUserEmail: member.email,
                targetRole: editRole,
                description: `${user.email} changed ${member.email} from ${getRoleLabel(oldRole)} to ${getRoleLabel(editRole)}`,
            });

            recordPermissionAudit("ROLE_REVOKED", {
                id: user.id,
                email: user.email,
                role: user.role,
                permissions: user.permissions,
            }, {
                targetUserId: member.id,
                targetUserEmail: member.email,
                targetRole: oldRole,
                description: `Previous role ${getRoleLabel(oldRole)} revoked from ${member.email}`,
            });

            setEditingId(null);
            setNotice(`Role updated for ${member.email}`);
        },
        [members, editRole, user],
    );

    const removeMember = useCallback(
        (memberId: string) => {
            if (!user) return;
            const member = members.find((m) => m.id === memberId);
            if (!member) return;

            // Prevent removing last admin
            if (member.role === "SECURITY_ADMIN") {
                const adminCount = members.filter((m) => m.role === "SECURITY_ADMIN").length;
                if (adminCount <= 1) {
                    setNotice("Cannot remove the last Security Admin");
                    setShowRemoveConfirm(null);
                    return;
                }
            }

            // Prevent removing yourself
            if (member.id === user.id) {
                setNotice("You cannot remove yourself");
                setShowRemoveConfirm(null);
                return;
            }

            const updated = members.filter((m) => m.id !== memberId);
            setMembers(updated);
            saveMembers(updated);

            recordPermissionAudit("MEMBER_REMOVED", {
                id: user.id,
                email: user.email,
                role: user.role,
                permissions: user.permissions,
            }, {
                targetUserId: member.id,
                targetUserEmail: member.email,
                targetRole: member.role,
                description: `${user.email} removed ${member.email} (role: ${getRoleLabel(member.role)})`,
            });

            setShowRemoveConfirm(null);
            setNotice(`${member.email} removed`);
        },
        [members, user],
    );

    const resendInvite = useCallback(
        (memberId: string) => {
            const member = members.find((m) => m.id === memberId);
            if (!member) return;
            setNotice(`Invite resent to ${member.email}`);
        },
        [members],
    );

    const handleImpersonate = useCallback(
        (member: TeamMember) => {
            startImpersonation({
                id: member.id,
                email: member.email,
                name: member.name,
                role: member.role,
                permissions: getRolePermissions(member.role),
                owned_agent_ids: [],
                last_login: member.last_login ?? new Date().toISOString(),
                mfa_verified: member.mfa_verified,
            });
            setNotice(`Now impersonating ${member.email}`);
        },
        [startImpersonation],
    );

    const handleCreateCustomRole = useCallback(() => {
        if (!customRoleName.trim() || !user) return;
        createCustomRole(customRoleName, customRoleDesc, customRolePerms, user.email);
        setCustomRoleName("");
        setCustomRoleDesc("");
        setCustomRolePerms([]);
        setShowCustomRoleDialog(false);
        setNotice(`Custom role "${customRoleName}" created`);
    }, [customRoleName, customRoleDesc, customRolePerms, user]);

    const toggleCustomPerm = (p: Permission) => {
        setCustomRolePerms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
    };

    // ── Invite permission preview ────────────────────────────────────────────────

    const invitePreviewPerms = useMemo(() => getRolePermissions(inviteRole), [inviteRole]);

    // ── Render ──────────────────────────────────────────────────────────────────

    const roleBadgeColor = (role: Role) => {
        if (role === "SECURITY_ADMIN") return { background: "#ef444420", color: "#ef4444", border: "1px solid #ef4444" };
        if (role === "SECURITY_APPROVER") return { background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b" };
        if (role === "DEVELOPER") return { background: "#3b82f620", color: "#3b82f6", border: "1px solid #3b82f6" };
        if (role === "COMPLIANCE_OFFICER") return { background: "#8b5cf620", color: "#8b5cf6", border: "1px solid #8b5cf6" };
        if (role === "VIEWER") return { background: "#22c55e20", color: "#22c55e", border: "1px solid #22c55e" };
        return { background: "#06b6d420", color: "#06b6d4", border: "1px solid #06b6d4" };
    };

    const statusBadge = (status: TeamMemberStatus) => {
        if (status === "ACTIVE") return "badge badge-allow";
        if (status === "PENDING") return "badge badge-pending";
        return "badge badge-blocked";
    };

    return (
        <main className="container-page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Impersonation Banner */}
            {impersonating && (
                <div
                    style={{
                        background: "linear-gradient(90deg, #f59e0b, #ef4444)",
                        color: "#fff",
                        padding: "10px 18px",
                        borderRadius: 10,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontWeight: 700,
                        fontSize: 13,
                    }}
                >
                    <span>👁 You are viewing as <strong>{impersonating.email}</strong> ({getRoleLabel(impersonating.role)})</span>
                    <button
                        onClick={stopImpersonation}
                        style={{ background: "#fff", color: "#ef4444", border: "none", borderRadius: 6, padding: "5px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                    >
                        Exit Impersonation
                    </button>
                </div>
            )}

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Team Management</h1>
                    <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
                        Manage members, roles, and permissions across the workspace
                    </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                    <PermissionGate permission="team:manage" fallback="hide">
                        <button
                            className="btn-secondary"
                            onClick={() => setShowCustomRoleDialog(true)}
                            style={{ fontSize: 12 }}
                        >
                            + Custom Role
                        </button>
                    </PermissionGate>
                    <PermissionGate permission="team:invite" fallback="hide">
                        <button className="btn-primary" onClick={() => setShowInvite(true)} style={{ fontSize: 12 }}>
                            + Invite Member
                        </button>
                    </PermissionGate>
                </div>
            </div>

            {notice && (
                <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontFamily: "monospace", color: "var(--accent-green, #22c55e)" }}>
                    ✓ {notice}
                </div>
            )}

            {/* Summary Bar */}
            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
                {[
                    ["TOTAL MEMBERS", stats.total, "#3b82f6"],
                    ["ADMINS", stats.admins, "#ef4444"],
                    ["PENDING INVITES", stats.pending, "#f59e0b"],
                    ["LAST ACTIVITY", stats.lastActivity, "#22c55e"],
                ].map(([label, value, color]) => (
                    <div key={String(label)} className="card" style={{ borderLeft: `3px solid ${color}`, padding: "10px 12px" }}>
                        <p style={{ margin: 0, fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", textTransform: "uppercase" }}>{String(label)}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: String(color) }}>{String(value)}</p>
                    </div>
                ))}
            </section>

            {/* Member Table */}
            <section className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <p style={{ margin: 0, fontWeight: 700 }}>Team Members</p>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>{members.length} members</span>
                </div>
                <div className="table-wrap">
                    <table className="w-full enterprise-table">
                        <thead>
                            <tr>
                                <th>Name & Email</th>
                                <th>Role</th>
                                <th>Status</th>
                                <th>Last Login</th>
                                <th>MFA</th>
                                <th>Joined</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {members.map((member) => (
                                <tr key={member.id}>
                                    <td>
                                        <div style={{ fontWeight: 600 }}>{member.name}</div>
                                        <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>{member.email}</div>
                                    </td>
                                    <td>
                                        {editingId === member.id ? (
                                            <div style={{ display: "flex", gap: 4 }}>
                                                <select
                                                    className="input"
                                                    style={{ fontSize: 11, padding: "3px 6px", width: 140 }}
                                                    value={editRole}
                                                    onChange={(e) => setEditRole(e.target.value as Role)}
                                                >
                                                    {allRoles.map((r) => (
                                                        <option key={r.id} value={r.id}>{r.label}</option>
                                                    ))}
                                                </select>
                                                <button onClick={() => changeRole(member.id)} style={{ fontSize: 10, background: "#22c55e", color: "#fff", border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontWeight: 700 }}>Save</button>
                                                <button onClick={() => setEditingId(null)} style={{ fontSize: 10, background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", color: "var(--text-muted)" }}>×</button>
                                            </div>
                                        ) : (
                                            <span
                                                style={{ ...roleBadgeColor(member.role), borderRadius: 9999, fontSize: 10, fontWeight: 700, padding: "2px 8px", fontFamily: "monospace", display: "inline-block" }}
                                            >
                                                {getRoleLabel(member.role)}
                                            </span>
                                        )}
                                    </td>
                                    <td><span className={statusBadge(member.status)} style={{ fontSize: 10 }}>{member.status}</span></td>
                                    <td style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>{timeAgo(member.last_login)}</td>
                                    <td>
                                        <span style={{ fontSize: 14 }}>{member.mfa_verified ? "🟢" : "🔴"}</span>
                                    </td>
                                    <td style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>{formatDate(member.joined_at)}</td>
                                    <td>
                                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                            <PermissionGate permission="team:manage" fallback="hide">
                                                <button
                                                    onClick={() => { setEditingId(member.id); setEditRole(member.role); }}
                                                    style={{ fontSize: 10, background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", color: "var(--text)" }}
                                                >
                                                    Edit Role
                                                </button>
                                            </PermissionGate>
                                            <PermissionGate permission="team:manage" fallback="hide">
                                                <button
                                                    onClick={() => setShowRemoveConfirm(member.id)}
                                                    style={{ fontSize: 10, background: "none", border: "1px solid #ef4444", borderRadius: 4, padding: "2px 8px", cursor: "pointer", color: "#ef4444" }}
                                                >
                                                    Remove
                                                </button>
                                            </PermissionGate>
                                            {member.status === "PENDING" && (
                                                <PermissionGate permission="team:invite" fallback="hide">
                                                    <button
                                                        onClick={() => resendInvite(member.id)}
                                                        style={{ fontSize: 10, background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", color: "var(--text-muted)" }}
                                                    >
                                                        Resend
                                                    </button>
                                                </PermissionGate>
                                            )}
                                            {isAdmin() && member.id !== user?.id && member.status === "ACTIVE" && (
                                                <button
                                                    onClick={() => handleImpersonate(member)}
                                                    style={{ fontSize: 10, background: "#f59e0b20", border: "1px solid #f59e0b", borderRadius: 4, padding: "2px 8px", cursor: "pointer", color: "#f59e0b" }}
                                                >
                                                    Impersonate
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ── Invite Member Modal ─────────────────────────────────────────────── */}
            {showInvite && (
                <div className="settings-dialog-backdrop" onClick={() => setShowInvite(false)}>
                    <div className="settings-dialog card" style={{ maxWidth: 560, width: "90%" }} onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Invite Team Member</h3>
                        <p style={{ margin: "6px 0 16px", fontSize: 12, color: "var(--text-muted)" }}>
                            The invited member will receive an email with instructions to join the workspace.
                        </p>

                        <label style={{ display: "block", marginBottom: 12 }}>
                            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Email Address</span>
                            <input className="input" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@company.com" />
                        </label>

                        <label style={{ display: "block", marginBottom: 12 }}>
                            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Role</span>
                            <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                                {allRoles.map((r) => (
                                    <option key={r.id} value={r.id}>{r.label}</option>
                                ))}
                            </select>
                        </label>

                        {/* Permission Preview */}
                        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 14, maxHeight: 220, overflowY: "auto" }}>
                            <p style={{ margin: "0 0 8px", fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                Permission Preview — {getRoleLabel(inviteRole)}
                            </p>
                            {(Object.entries(PERMISSION_REGISTRY) as [PermissionDomain, typeof PERMISSION_REGISTRY[PermissionDomain]][]).map(([domain, perms]) => {
                                const granted = perms.filter((p) => invitePreviewPerms.includes(p.id));
                                if (!granted.length) return null;
                                return (
                                    <div key={domain} style={{ marginBottom: 6 }}>
                                        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>{domain}</p>
                                        {granted.map((p) => (
                                            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 8, marginTop: 2 }}>
                                                <span style={{ color: "#22c55e", fontSize: 10 }}>✓</span>
                                                <span style={{ fontSize: 11 }}>{p.label}</span>
                                                <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>({p.id})</span>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button className="btn-secondary" onClick={() => setShowInvite(false)}>Cancel</button>
                            <button className="btn-primary" onClick={inviteMember} disabled={!inviteEmail.trim()}>Send Invite</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Remove Confirmation Modal ───────────────────────────────────────── */}
            {showRemoveConfirm && (
                <div className="settings-dialog-backdrop" onClick={() => setShowRemoveConfirm(null)}>
                    <div className="settings-dialog card" onClick={(e) => e.stopPropagation()}>
                        <h3 className="settings-dialog-title">Remove team member?</h3>
                        <p className="settings-dialog-text">
                            This will revoke {members.find((m) => m.id === showRemoveConfirm)?.email}&apos;s access to the workspace. This action can be undone by re-inviting them.
                        </p>
                        <div className="settings-inline-actions">
                            <button className="btn-secondary settings-action-btn" onClick={() => setShowRemoveConfirm(null)}>Cancel</button>
                            <button className="btn-danger settings-action-btn" onClick={() => removeMember(showRemoveConfirm)}>Remove</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Custom Role Dialog ──────────────────────────────────────────────── */}
            {showCustomRoleDialog && (
                <div className="settings-dialog-backdrop" onClick={() => setShowCustomRoleDialog(false)}>
                    <div className="settings-dialog card" style={{ maxWidth: 600, width: "90%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Create Custom Role</h3>
                        <p style={{ margin: "6px 0 16px", fontSize: 12, color: "var(--text-muted)" }}>
                            Custom roles allow fine-grained permission sets beyond the built-in roles.
                        </p>

                        <label style={{ display: "block", marginBottom: 10 }}>
                            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Role Name</span>
                            <input className="input" value={customRoleName} onChange={(e) => setCustomRoleName(e.target.value)} placeholder="e.g. Senior Auditor" />
                        </label>

                        <label style={{ display: "block", marginBottom: 10 }}>
                            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Description</span>
                            <input className="input" value={customRoleDesc} onChange={(e) => setCustomRoleDesc(e.target.value)} placeholder="Brief description of this role" />
                        </label>

                        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 14, maxHeight: 300, overflowY: "auto" }}>
                            <p style={{ margin: "0 0 8px", fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", textTransform: "uppercase" }}>Permissions</p>
                            {(Object.entries(PERMISSION_REGISTRY) as [PermissionDomain, typeof PERMISSION_REGISTRY[PermissionDomain]][]).map(([domain, perms]) => (
                                <div key={domain} style={{ marginBottom: 8 }}>
                                    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>{domain}</p>
                                    {perms.map((p) => (
                                        <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 8, marginTop: 3, cursor: "pointer" }}>
                                            <input type="checkbox" checked={customRolePerms.includes(p.id)} onChange={() => toggleCustomPerm(p.id)} />
                                            <span style={{ fontSize: 11 }}>{p.label}</span>
                                            <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>({p.id})</span>
                                        </label>
                                    ))}
                                </div>
                            ))}
                        </div>

                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button className="btn-secondary" onClick={() => setShowCustomRoleDialog(false)}>Cancel</button>
                            <button className="btn-primary" onClick={handleCreateCustomRole} disabled={!customRoleName.trim()}>
                                Create Role ({customRolePerms.length} permissions)
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
