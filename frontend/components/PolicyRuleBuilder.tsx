/**
 * PolicyRuleBuilder.tsx
 *
 * Visual no-code rule builder for AI Governance policies.
 * Non-technical compliance officers build rules via dropdowns;
 * power users can switch to raw YAML via "Advanced Mode".
 *
 * Features:
 *  - IF [field] [operator] [value] rows
 *  - AND / OR group logic (up to 3 levels deep)
 *  - THEN outcome dropdown
 *  - Live YAML preview (right panel)
 *  - Template quick-start (4 built-in templates)
 *  - Validation + plain-English confirmation modal
 */

"use client";

import { useCallback, useId, useMemo, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export type FieldKey =
  | "risk_score"
  | "data_privacy_score"
  | "shadow_it_risk"
  | "action_type"
  | "agent_access_level"
  | "destination_domain";

export type FieldType = "number" | "string" | "enum";

export type Operator =
  | "gt" | "lt" | "eq" | "between"          // number
  | "eq" | "contains" | "neq"               // string
  | "one_of";                               // enum

export type Decision = "APPROVE" | "DENY" | "REQUIRE_APPROVAL" | "FLAG_FOR_REVIEW";

export type ConditionRow = {
  id: string;
  field: FieldKey;
  op: Operator;
  value: string;
  value2: string;   // used for "between"
};

export type RuleGroup = {
  id: string;
  logic: "AND" | "OR";
  conditions: ConditionRow[];
  groups: RuleGroup[];   // nested sub-groups (max depth enforced by UI)
};

export type PolicyRule = {
  id: string;
  name: string;
  group: RuleGroup;
  decision: Decision | "";
  reason: string;
};

export type BuilderState = {
  policyName: string;
  version: number;
  rules: PolicyRule[];
};

// ── Field / Operator meta ──────────────────────────────────────────────────────

const FIELD_META: Record<FieldKey, { label: string; type: FieldType; enumOptions?: string[] }> = {
  risk_score:          { label: "Risk Score",           type: "number" },
  data_privacy_score:  { label: "Data Privacy Score",   type: "number" },
  shadow_it_risk:      { label: "Shadow IT Risk",       type: "number" },
  action_type:         { label: "Action Type",          type: "enum",
    enumOptions: ["send_email", "external_post", "read_file", "write_file", "api_call", "database_query"] },
  agent_access_level:  { label: "Agent Access Level",   type: "enum",
    enumOptions: ["Public", "Internal", "Confidential", "Restricted"] },
  destination_domain:  { label: "Destination Domain",   type: "string" },
};

const OPERATORS_FOR_TYPE: Record<FieldType, Array<{ value: Operator; label: string }>> = {
  number: [
    { value: "gt",      label: "is greater than" },
    { value: "lt",      label: "is less than" },
    { value: "eq",      label: "is equal to" },
    { value: "between", label: "is between" },
  ],
  string: [
    { value: "eq",       label: "is equal to" },
    { value: "contains", label: "contains" },
    { value: "neq",      label: "is not equal to" },
  ],
  enum: [
    { value: "eq",     label: "is" },
    { value: "neq",    label: "is not" },
    { value: "one_of", label: "is one of" },
  ],
};

const DECISION_OPTIONS: Array<{ value: Decision; label: string; color: string }> = [
  { value: "APPROVE",          label: "APPROVE",          color: "#22c55e" },
  { value: "DENY",             label: "DENY",             color: "#ef4444" },
  { value: "REQUIRE_APPROVAL", label: "REQUIRE APPROVAL", color: "#f59e0b" },
  { value: "FLAG_FOR_REVIEW",  label: "FLAG FOR REVIEW",  color: "#8b5cf6" },
];

// ── YAML serializer ────────────────────────────────────────────────────────────

function opToYaml(op: Operator): string {
  const map: Record<Operator, string> = {
    gt: "gt", lt: "lt", eq: "eq", between: "between",
    contains: "contains", neq: "neq", one_of: "one_of",
  };
  return map[op] ?? op;
}

function conditionToYaml(c: ConditionRow, indent: string): string {
  const base = `${indent}- field: ${c.field}\n${indent}  op: ${opToYaml(c.op)}`;
  if (c.op === "between") {
    return `${base}\n${indent}  value: [${c.value || 0}, ${c.value2 || 100}]`;
  }
  if (c.op === "one_of") {
    const items = c.value.split(",").map((v) => v.trim()).filter(Boolean);
    return `${base}\n${indent}  value: [${items.map((v) => `"${v}"`).join(", ")}]`;
  }
  const numericFields: FieldKey[] = ["risk_score", "data_privacy_score", "shadow_it_risk"];
  const isNumeric = numericFields.includes(c.field);
  return `${base}\n${indent}  value: ${isNumeric ? c.value || 0 : `"${c.value}"`}`;
}

function groupToYaml(group: RuleGroup, depth: number): string {
  const i = "    ".repeat(depth + 3);
  const lines: string[] = [`${i}operator: ${group.logic}`];

  const hasConditions = group.conditions.length > 0;
  const hasGroups = group.groups.length > 0;

  if (hasConditions || hasGroups) {
    lines.push(`${i}rules:`);
    for (const c of group.conditions) {
      lines.push(conditionToYaml(c, i + "  "));
    }
    for (const g of group.groups) {
      lines.push(`${i}  - operator: ${g.logic}`);
      lines.push(`${i}    rules:`);
      for (const c of g.conditions) {
        lines.push(conditionToYaml(c, i + "      "));
      }
    }
  }
  return lines.join("\n");
}

export function builderToYaml(state: BuilderState): string {
  const lines = [`version: ${state.version}`, `name: "${state.policyName}"`, "rules:"];
  for (const rule of state.rules) {
    lines.push(`  - name: "${rule.name}"`);
    if (rule.group.conditions.length > 0 || rule.group.groups.length > 0) {
      lines.push("    conditions:");
      lines.push(groupToYaml(rule.group, 0));
    }
    lines.push("    then:");
    lines.push(`      decision: ${rule.decision || "REQUIRE_APPROVAL"}`);
    if (rule.reason) lines.push(`      reason: "${rule.reason}"`);
  }
  return lines.join("\n");
}

// ── Plain-English summary ──────────────────────────────────────────────────────

function conditionToEnglish(c: ConditionRow): string {
  const fieldLabel = FIELD_META[c.field]?.label ?? c.field;
  switch (c.op) {
    case "gt":       return `${fieldLabel} is greater than ${c.value}`;
    case "lt":       return `${fieldLabel} is less than ${c.value}`;
    case "eq":       return `${fieldLabel} is "${c.value}"`;
    case "neq":      return `${fieldLabel} is not "${c.value}"`;
    case "contains": return `${fieldLabel} contains "${c.value}"`;
    case "between":  return `${fieldLabel} is between ${c.value} and ${c.value2}`;
    case "one_of":   return `${fieldLabel} is one of [${c.value}]`;
    default:         return `${fieldLabel} ${c.op} ${c.value}`;
  }
}

function ruleToEnglish(rule: PolicyRule): string {
  const decision = DECISION_OPTIONS.find((d) => d.value === rule.decision)?.label ?? rule.decision;
  const { group } = rule;
  if (group.conditions.length === 0 && group.groups.length === 0) {
    return `This rule will always ${decision}${rule.reason ? ` with reason "${rule.reason}"` : ""}.`;
  }
  const condParts = group.conditions.map(conditionToEnglish);
  const join = ` ${group.logic} `;
  return `This rule will ${decision} any action where ${condParts.join(join)}${rule.reason ? `. Reason: "${rule.reason}"` : ""}.`;
}

// ── Validation ─────────────────────────────────────────────────────────────────

type ValidationError = { ruleId: string; message: string };

export function validateBuilder(state: BuilderState): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenNames = new Set<string>();

  for (const rule of state.rules) {
    if (!rule.name.trim()) {
      errors.push({ ruleId: rule.id, message: "Rule name is required." });
    }
    if (seenNames.has(rule.name.trim())) {
      errors.push({ ruleId: rule.id, message: `Duplicate rule name: "${rule.name}".` });
    }
    seenNames.add(rule.name.trim());

    if (!rule.decision) {
      errors.push({ ruleId: rule.id, message: "THEN outcome must be selected." });
    }
    const allConditions = [
      ...rule.group.conditions,
      ...rule.group.groups.flatMap((g) => g.conditions),
    ];
    for (const c of allConditions) {
      if (!c.value.trim() && c.op !== "between") {
        errors.push({ ruleId: rule.id, message: `Value is required for "${FIELD_META[c.field].label}" condition.` });
      }
    }
  }
  return errors;
}

// ── ID factory ─────────────────────────────────────────────────────────────────

let _counter = 0;
function uid(): string {
  return `r${Date.now().toString(36)}${(++_counter).toString(36)}`;
}

function emptyCondition(): ConditionRow {
  return { id: uid(), field: "risk_score", op: "gt", value: "", value2: "" };
}

function emptyGroup(logic: "AND" | "OR" = "AND"): RuleGroup {
  return { id: uid(), logic, conditions: [emptyCondition()], groups: [] };
}

function emptyRule(name = "New Rule"): PolicyRule {
  return { id: uid(), name, group: emptyGroup(), decision: "REQUIRE_APPROVAL", reason: "" };
}

// ── Built-in templates ─────────────────────────────────────────────────────────

type BuiltInTemplate = {
  key: string;
  name: string;
  description: string;
  icon: string;
  rules: PolicyRule[];
};

const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    key: "budget_cap",
    name: "Budget Cap",
    description: "Require approval for high-cost operations above risk threshold.",
    icon: "$",
    rules: [{
      id: uid(), name: "High risk score gate", decision: "REQUIRE_APPROVAL",
      reason: "High risk score requires manual approval",
      group: { id: uid(), logic: "AND", groups: [],
        conditions: [{ id: uid(), field: "risk_score", op: "gt", value: "75", value2: "" }] },
    }],
  },
  {
    key: "confidential_approval",
    name: "Confidential Approval Required",
    description: "Any access to confidential data must be approved.",
    icon: "🔒",
    rules: [{
      id: uid(), name: "Confidential access gate", decision: "REQUIRE_APPROVAL",
      reason: "Confidential data classification requires approval",
      group: { id: uid(), logic: "AND", groups: [],
        conditions: [{ id: uid(), field: "agent_access_level", op: "eq", value: "Confidential", value2: "" }] },
    }],
  },
  {
    key: "destination_allowlist",
    name: "Destination Allowlist",
    description: "Block external posts to un-allowlisted domains.",
    icon: "🌐",
    rules: [
      {
        id: uid(), name: "Block external post", decision: "DENY",
        reason: "External destination not in allowlist",
        group: { id: uid(), logic: "AND", groups: [],
          conditions: [
            { id: uid(), field: "action_type", op: "eq", value: "external_post", value2: "" },
            { id: uid(), field: "destination_domain", op: "neq", value: "api.partner.example", value2: "" },
          ] },
      },
      {
        id: uid(), name: "Allow trusted partner", decision: "REQUIRE_APPROVAL",
        reason: "Allowlisted destination requires approval",
        group: { id: uid(), logic: "AND", groups: [],
          conditions: [
            { id: uid(), field: "action_type", op: "eq", value: "external_post", value2: "" },
            { id: uid(), field: "destination_domain", op: "eq", value: "api.partner.example", value2: "" },
          ] },
      },
    ],
  },
  {
    key: "pii_outbound_block",
    name: "PII Outbound Block",
    description: "Deny any email or external post from Restricted agents.",
    icon: "🚫",
    rules: [{
      id: uid(), name: "Block PII outbound", decision: "DENY",
      reason: "PII outbound blocked for restricted agents",
      group: {
        id: uid(), logic: "AND", groups: [],
        conditions: [
          { id: uid(), field: "agent_access_level", op: "eq", value: "Restricted", value2: "" },
          { id: uid(), field: "action_type", op: "one_of", value: "send_email, external_post", value2: "" },
        ],
      },
    }],
  },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

const S = {
  input: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--text)",
    fontSize: 12,
    padding: "4px 8px",
    fontFamily: "inherit",
    outline: "none",
    minWidth: 0,
  } as React.CSSProperties,
  select: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--text)",
    fontSize: 12,
    padding: "4px 8px",
    fontFamily: "inherit",
    outline: "none",
    cursor: "pointer",
  } as React.CSSProperties,
  btnGhost: {
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--text-muted)",
    fontSize: 11,
    padding: "3px 8px",
    cursor: "pointer",
    fontFamily: "inherit",
  } as React.CSSProperties,
  btnDanger: {
    background: "none",
    border: "none",
    color: "#ef4444",
    fontSize: 14,
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 4,
    lineHeight: 1,
  } as React.CSSProperties,
};

// Condition row
function ConditionRowEditor({
  condition,
  onUpdate,
  onRemove,
  canRemove,
}: {
  condition: ConditionRow;
  onUpdate: (updated: ConditionRow) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const meta = FIELD_META[condition.field];
  const operators = OPERATORS_FOR_TYPE[meta.type];

  function changeField(field: FieldKey) {
    const newMeta = FIELD_META[field];
    const newOps = OPERATORS_FOR_TYPE[newMeta.type];
    const op = newOps[0].value;
    onUpdate({ ...condition, field, op, value: "", value2: "" });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 16, textAlign: "center" }}>IF</span>

      {/* Field */}
      <select
        style={S.select}
        value={condition.field}
        onChange={(e) => changeField(e.target.value as FieldKey)}
      >
        {(Object.keys(FIELD_META) as FieldKey[]).map((f) => (
          <option key={f} value={f}>{FIELD_META[f].label}</option>
        ))}
      </select>

      {/* Operator */}
      <select
        style={S.select}
        value={condition.op}
        onChange={(e) => onUpdate({ ...condition, op: e.target.value as Operator, value: "", value2: "" })}
      >
        {operators.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {/* Value(s) */}
      {meta.type === "enum" && condition.op !== "one_of" ? (
        <select
          style={{ ...S.select, minWidth: 120 }}
          value={condition.value}
          onChange={(e) => onUpdate({ ...condition, value: e.target.value })}
        >
          <option value="">— select —</option>
          {meta.enumOptions?.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : meta.type === "enum" && condition.op === "one_of" ? (
        <input
          style={{ ...S.input, minWidth: 160 }}
          placeholder="val1, val2, val3"
          value={condition.value}
          onChange={(e) => onUpdate({ ...condition, value: e.target.value })}
        />
      ) : condition.op === "between" ? (
        <>
          <input
            style={{ ...S.input, width: 60 }}
            type="number"
            placeholder="min"
            value={condition.value}
            onChange={(e) => onUpdate({ ...condition, value: e.target.value })}
          />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>and</span>
          <input
            style={{ ...S.input, width: 60 }}
            type="number"
            placeholder="max"
            value={condition.value2}
            onChange={(e) => onUpdate({ ...condition, value2: e.target.value })}
          />
        </>
      ) : meta.type === "number" ? (
        <input
          style={{ ...S.input, width: 70 }}
          type="number"
          placeholder="0–100"
          value={condition.value}
          onChange={(e) => onUpdate({ ...condition, value: e.target.value })}
        />
      ) : (
        <input
          style={{ ...S.input, minWidth: 120 }}
          type="text"
          placeholder="value"
          value={condition.value}
          onChange={(e) => onUpdate({ ...condition, value: e.target.value })}
        />
      )}

      {canRemove && (
        <button style={S.btnDanger} onClick={onRemove} title="Remove condition">×</button>
      )}
    </div>
  );
}

// Rule group (recursive, max depth 3)
function RuleGroupEditor({
  group,
  depth,
  onUpdate,
  onRemoveGroup,
  canRemoveGroup,
}: {
  group: RuleGroup;
  depth: number;
  onUpdate: (g: RuleGroup) => void;
  onRemoveGroup?: () => void;
  canRemoveGroup?: boolean;
}) {
  function updateCondition(idx: number, updated: ConditionRow) {
    const conditions = [...group.conditions];
    conditions[idx] = updated;
    onUpdate({ ...group, conditions });
  }

  function removeCondition(idx: number) {
    onUpdate({ ...group, conditions: group.conditions.filter((_, i) => i !== idx) });
  }

  function addCondition() {
    onUpdate({ ...group, conditions: [...group.conditions, emptyCondition()] });
  }

  function updateSubGroup(idx: number, updated: RuleGroup) {
    const groups = [...group.groups];
    groups[idx] = updated;
    onUpdate({ ...group, groups });
  }

  function removeSubGroup(idx: number) {
    onUpdate({ ...group, groups: group.groups.filter((_, i) => i !== idx) });
  }

  function addSubGroup() {
    onUpdate({ ...group, groups: [...group.groups, emptyGroup()] });
  }

  const depthColors = ["var(--border)", "#3b82f633", "#8b5cf633"];
  const borderColor = depthColors[Math.min(depth, 2)];

  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: 12,
        background: depth > 0 ? "rgba(0,0,0,0.12)" : "transparent",
        marginTop: depth > 0 ? 8 : 0,
      }}
    >
      {/* Group header: AND / OR toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {depth > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
            GROUP
          </span>
        )}
        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
          {(["AND", "OR"] as const).map((op) => (
            <button
              key={op}
              onClick={() => onUpdate({ ...group, logic: op })}
              style={{
                padding: "3px 12px",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "monospace",
                cursor: "pointer",
                border: "none",
                background: group.logic === op ? (op === "AND" ? "#3b82f6" : "#8b5cf6") : "var(--surface2)",
                color: group.logic === op ? "#fff" : "var(--text-muted)",
                transition: "all 0.15s",
              }}
            >
              {op}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {group.logic === "AND" ? "All conditions must match" : "Any condition must match"}
        </span>
        {canRemoveGroup && onRemoveGroup && (
          <button style={{ ...S.btnDanger, marginLeft: "auto" }} onClick={onRemoveGroup}>
            Remove group
          </button>
        )}
      </div>

      {/* Condition rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {group.conditions.map((c, idx) => (
          <ConditionRowEditor
            key={c.id}
            condition={c}
            onUpdate={(updated) => updateCondition(idx, updated)}
            onRemove={() => removeCondition(idx)}
            canRemove={group.conditions.length > 1 || group.groups.length > 0}
          />
        ))}
      </div>

      {/* Sub-groups */}
      {group.groups.map((g, idx) => (
        <RuleGroupEditor
          key={g.id}
          group={g}
          depth={depth + 1}
          onUpdate={(updated) => updateSubGroup(idx, updated)}
          onRemoveGroup={() => removeSubGroup(idx)}
          canRemoveGroup
        />
      ))}

      {/* Add condition / add group */}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button style={S.btnGhost} onClick={addCondition}>+ Add condition</button>
        {depth < 2 && (
          <button style={S.btnGhost} onClick={addSubGroup}>+ Add group</button>
        )}
      </div>
    </div>
  );
}

// Confirmation modal
function ConfirmModal({
  rules,
  onConfirm,
  onCancel,
}: {
  rules: PolicyRule[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 12, padding: 28, maxWidth: 540, width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800 }}>
          Confirm Policy Deployment
        </h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 18, fontFamily: "monospace" }}>
          Read carefully — this policy will enforce these rules on every tool call.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
          {rules.map((rule) => {
            const decOpt = DECISION_OPTIONS.find((d) => d.value === rule.decision);
            return (
              <div
                key={rule.id}
                style={{
                  padding: "12px 14px",
                  borderRadius: 8,
                  background: "var(--surface2)",
                  borderLeft: `3px solid ${decOpt?.color ?? "var(--border)"}`,
                }}
              >
                <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700 }}>{rule.name}</p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {ruleToEnglish(rule)}
                </p>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{ ...S.btnGhost, padding: "8px 18px", fontSize: 13 }}
          >
            Go Back
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: "#3b82f6", color: "#fff", border: "none",
              borderRadius: 8, padding: "8px 22px", fontSize: 13,
              fontWeight: 700, cursor: "pointer",
            }}
          >
            Confirm & Publish
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export type PolicyRuleBuilderProps = {
  initialName?: string;
  initialVersion?: number;
  onPublish: (name: string, version: number, yamlText: string) => Promise<void>;
  onCancel: () => void;
  existingRuleNames?: string[];
};

export default function PolicyRuleBuilder({
  initialName = "New Policy",
  initialVersion = 1,
  onPublish,
  onCancel,
  existingRuleNames = [],
}: PolicyRuleBuilderProps) {
  const baseId = useId();

  const [state, setState] = useState<BuilderState>({
    policyName: initialName,
    version: initialVersion,
    rules: [emptyRule("Default Rule")],
  });

  const [showTemplates, setShowTemplates] = useState(true);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // ── YAML preview ────────────────────────────────────────────────────────────

  const yaml = useMemo(() => builderToYaml(state), [state]);

  // ── Rule helpers ────────────────────────────────────────────────────────────

  const updateRule = useCallback((idx: number, updated: PolicyRule) => {
    setState((prev) => {
      const rules = [...prev.rules];
      rules[idx] = updated;
      return { ...prev, rules };
    });
  }, []);

  const addRule = () => {
    setState((prev) => ({
      ...prev,
      rules: [...prev.rules, emptyRule(`Rule ${prev.rules.length + 1}`)],
    }));
  };

  const removeRule = (idx: number) => {
    setState((prev) => ({ ...prev, rules: prev.rules.filter((_, i) => i !== idx) }));
  };

  // ── Template loader ─────────────────────────────────────────────────────────

  const loadTemplate = (tpl: BuiltInTemplate) => {
    setState((prev) => ({
      ...prev,
      policyName: tpl.name,
      rules: tpl.rules.map((r) => ({ ...r, id: uid() })),
    }));
    setShowTemplates(false);
    setValidationErrors([]);
  };

  // ── Publish flow ────────────────────────────────────────────────────────────

  const handlePublishClick = () => {
    const errors = validateBuilder(state);

    // also check against existing policy names from parent
    for (const rule of state.rules) {
      if (existingRuleNames.includes(rule.name.trim())) {
        errors.push({ ruleId: rule.id, message: `Rule name "${rule.name}" already exists in another policy.` });
      }
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    setShowConfirm(true);
  };

  const handleConfirmedPublish = async () => {
    setPublishing(true);
    try {
      await onPublish(state.policyName, state.version, yaml);
      setShowConfirm(false);
    } finally {
      setPublishing(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {showConfirm && (
        <ConfirmModal
          rules={state.rules}
          onConfirm={handleConfirmedPublish}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            style={{ ...S.input, fontSize: 15, fontWeight: 700, flex: 1, minWidth: 180, padding: "6px 10px" }}
            value={state.policyName}
            onChange={(e) => setState((p) => ({ ...p, policyName: e.target.value }))}
            placeholder="Policy name"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>v</span>
            <input
              style={{ ...S.input, width: 48, textAlign: "center" }}
              type="number"
              min={1}
              value={state.version}
              onChange={(e) => setState((p) => ({ ...p, version: parseInt(e.target.value || "1", 10) }))}
            />
          </div>
          <button style={S.btnGhost} onClick={() => setShowTemplates((v) => !v)}>
            {showTemplates ? "Hide Templates" : "Start from Template"}
          </button>
        </div>

        {/* Template quick-start */}
        {showTemplates && (
          <div
            style={{
              border: "1px solid var(--border)", borderRadius: 10,
              padding: 14, background: "var(--surface2)",
            }}
          >
            <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "monospace" }}>
              Quick-Start Templates
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 8 }}>
              {BUILT_IN_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.key}
                  onClick={() => loadTemplate(tpl)}
                  style={{
                    textAlign: "left", padding: "10px 12px",
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 8, cursor: "pointer", transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#3b82f6")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                >
                  <span style={{ fontSize: 18 }}>{tpl.icon}</span>
                  <p style={{ margin: "6px 0 3px", fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{tpl.name}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{tpl.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Two-panel layout: rules (left) + YAML preview (right) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

          {/* Left: rule editor */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            {state.rules.map((rule, rIdx) => {
              const ruleErrors = validationErrors.filter((e) => e.ruleId === rule.id);
              const decOpt = DECISION_OPTIONS.find((d) => d.value === rule.decision);

              return (
                <div
                  key={rule.id}
                  style={{
                    border: `1px solid ${ruleErrors.length > 0 ? "#ef4444" : "var(--border)"}`,
                    borderRadius: 10, padding: 14,
                    background: "var(--surface2)",
                    position: "relative",
                  }}
                >
                  {/* Rule header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span
                      style={{
                        background: "#3b82f620", color: "#3b82f6",
                        borderRadius: 9999, fontSize: 10, fontWeight: 700,
                        padding: "2px 8px", fontFamily: "monospace",
                      }}
                    >
                      RULE {rIdx + 1}
                    </span>
                    <input
                      key={`${baseId}-name-${rule.id}`}
                      style={{ ...S.input, flex: 1, fontWeight: 600 }}
                      value={rule.name}
                      onChange={(e) => updateRule(rIdx, { ...rule, name: e.target.value })}
                      placeholder="Rule name"
                    />
                    {state.rules.length > 1 && (
                      <button style={S.btnDanger} onClick={() => removeRule(rIdx)} title="Remove rule">×</button>
                    )}
                  </div>

                  {/* Conditions group */}
                  <RuleGroupEditor
                    group={rule.group}
                    depth={0}
                    onUpdate={(g) => updateRule(rIdx, { ...rule, group: g })}
                  />

                  {/* THEN row */}
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      marginTop: 10, flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                        fontFamily: "monospace", minWidth: 34,
                      }}
                    >
                      THEN
                    </span>
                    <select
                      style={{
                        ...S.select,
                        fontWeight: 700,
                        color: decOpt?.color ?? "var(--text)",
                        borderColor: decOpt?.color ?? "var(--border)",
                      }}
                      value={rule.decision}
                      onChange={(e) => updateRule(rIdx, { ...rule, decision: e.target.value as Decision })}
                    >
                      <option value="">— select outcome —</option>
                      {DECISION_OPTIONS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                    <input
                      style={{ ...S.input, flex: 1, minWidth: 120 }}
                      placeholder="Reason (stored in audit log)"
                      value={rule.reason}
                      onChange={(e) => updateRule(rIdx, { ...rule, reason: e.target.value })}
                    />
                  </div>

                  {/* Validation errors */}
                  {ruleErrors.map((err) => (
                    <p key={err.message} style={{ margin: "6px 0 0", fontSize: 11, color: "#ef4444", fontFamily: "monospace" }}>
                      ⚠ {err.message}
                    </p>
                  ))}
                </div>
              );
            })}

            <button
              style={{ ...S.btnGhost, padding: "8px 0", width: "100%", textAlign: "center", fontSize: 12 }}
              onClick={addRule}
            >
              + Add Rule
            </button>
          </div>

          {/* Right: YAML preview */}
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", fontFamily: "monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                YAML Preview
              </span>
              <button
                style={S.btnGhost}
                onClick={() => navigator.clipboard?.writeText(yaml).catch(() => {})}
                title="Copy YAML"
              >
                Copy
              </button>
            </div>
            <pre
              style={{
                flex: 1,
                margin: 0,
                padding: 14,
                borderRadius: 10,
                background: "#0d1117",
                border: "1px solid var(--border)",
                fontSize: 11,
                lineHeight: 1.7,
                fontFamily: "'IBM Plex Mono', monospace",
                color: "#e6edf3",
                overflowY: "auto",
                maxHeight: 520,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {yaml}
            </pre>
          </div>
        </div>

        {/* Footer actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 4 }}>
          <button
            style={{ ...S.btnGhost, padding: "8px 18px", fontSize: 13 }}
            onClick={onCancel}
          >
            Discard
          </button>
          <button
            onClick={handlePublishClick}
            disabled={publishing}
            style={{
              background: "#3b82f6", color: "#fff", border: "none",
              borderRadius: 8, padding: "8px 22px", fontSize: 13,
              fontWeight: 700, cursor: "pointer", opacity: publishing ? 0.6 : 1,
            }}
          >
            {publishing ? "Publishing…" : "Publish Rule"}
          </button>
        </div>
      </div>
    </>
  );
}
