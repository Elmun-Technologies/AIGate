import {
  INTEGRATIONS_REGISTRY,
  type ConfigField,
  type Integration,
  type IntegrationCapability,
  type IntegrationStatus,
} from "@/src/config/integrations";

export type IntegrationConfigValues = Record<string, string | boolean>;

type PersistedIntegrationState = {
  id: string;
  status: IntegrationStatus;
  connected_at: string | null;
  last_sync_at: string | null;
  event_count_24h: number;
  capability_enabled: Record<string, boolean>;
};

const STATE_KEY = "agentgate_integrations_state_v1";
const CONFIG_KEY = "agentgate_integrations_config_v1";

function cloneRegistry(): Integration[] {
  return INTEGRATIONS_REGISTRY.map((integration) => ({
    ...integration,
    capabilities: integration.capabilities.map((capability) => ({ ...capability })),
    config_schema: integration.config_schema.map((field) => ({ ...field })),
  }));
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function defaultsFromSchema(schema: ConfigField[]): IntegrationConfigValues {
  const defaults: IntegrationConfigValues = {};
  for (const field of schema) {
    if (field.default_value !== undefined) {
      defaults[field.key] = field.default_value;
    } else if (field.type === "toggle") {
      defaults[field.key] = false;
    } else {
      defaults[field.key] = "";
    }
  }
  return defaults;
}

function toPersistedState(integration: Integration): PersistedIntegrationState {
  const capability_enabled: Record<string, boolean> = {};
  for (const capability of integration.capabilities) {
    capability_enabled[capability.id] = capability.enabled;
  }

  return {
    id: integration.id,
    status: integration.status,
    connected_at: integration.connected_at,
    last_sync_at: integration.last_sync_at,
    event_count_24h: integration.event_count_24h,
    capability_enabled,
  };
}

function mergeRegistryWithState(
  registry: Integration[],
  persisted: PersistedIntegrationState[],
): Integration[] {
  const persistedMap = new Map(persisted.map((item) => [item.id, item]));

  return registry.map((integration) => {
    const state = persistedMap.get(integration.id);
    if (!state) return integration;

    const mergedCapabilities: IntegrationCapability[] = integration.capabilities.map((capability) => ({
      ...capability,
      enabled: state.capability_enabled[capability.id] ?? capability.enabled,
    }));

    return {
      ...integration,
      status: state.status,
      connected_at: state.connected_at,
      last_sync_at: state.last_sync_at,
      event_count_24h: state.event_count_24h,
      capabilities: mergedCapabilities,
    };
  });
}

function saveIntegrationStates(integrations: Integration[]): void {
  const states = integrations.map(toPersistedState);
  writeJson(STATE_KEY, states);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("agentgate:integrations-updated"));
  }
}

function loadConfigMap(): Record<string, IntegrationConfigValues> {
  return readJson<Record<string, IntegrationConfigValues>>(CONFIG_KEY, {});
}

function saveConfigMap(map: Record<string, IntegrationConfigValues>): void {
  writeJson(CONFIG_KEY, map);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("agentgate:integrations-updated"));
  }
}

export function loadIntegrations(): Integration[] {
  const registry = cloneRegistry();
  const persisted = readJson<PersistedIntegrationState[]>(STATE_KEY, []);
  return mergeRegistryWithState(registry, persisted);
}

export function getIntegrationById(integrationId: string): Integration | null {
  const integration = loadIntegrations().find((item) => item.id === integrationId);
  return integration ?? null;
}

export function loadIntegrationConfig(integrationId: string): IntegrationConfigValues {
  const integration = getIntegrationById(integrationId);
  if (!integration) return {};

  const configMap = loadConfigMap();
  return {
    ...defaultsFromSchema(integration.config_schema),
    ...(configMap[integrationId] ?? {}),
  };
}

export function saveIntegrationConfig(
  integrationId: string,
  config: IntegrationConfigValues,
): void {
  const existing = loadConfigMap();
  existing[integrationId] = config;
  saveConfigMap(existing);
}

export function setIntegrationCapabilityEnabled(
  integrationId: string,
  capabilityId: string,
  enabled: boolean,
): Integration[] {
  const next = loadIntegrations().map((integration) => {
    if (integration.id !== integrationId) return integration;
    return {
      ...integration,
      capabilities: integration.capabilities.map((capability) =>
        capability.id === capabilityId ? { ...capability, enabled } : capability,
      ),
    };
  });
  saveIntegrationStates(next);
  return next;
}

export function upsertIntegrationState(
  integrationId: string,
  patch: Partial<Pick<Integration, "status" | "connected_at" | "last_sync_at" | "event_count_24h">>,
): Integration[] {
  const next = loadIntegrations().map((integration) => {
    if (integration.id !== integrationId) return integration;
    return {
      ...integration,
      status: patch.status ?? integration.status,
      connected_at: patch.connected_at ?? integration.connected_at,
      last_sync_at: patch.last_sync_at ?? integration.last_sync_at,
      event_count_24h: patch.event_count_24h ?? integration.event_count_24h,
    };
  });
  saveIntegrationStates(next);
  return next;
}

export function incrementIntegrationEvents(
  integrationId: string,
  incrementBy = 1,
): Integration[] {
  const now = new Date().toISOString();
  const next = loadIntegrations().map((integration) => {
    if (integration.id !== integrationId) return integration;
    return {
      ...integration,
      last_sync_at: now,
      event_count_24h: Math.max(0, integration.event_count_24h + incrementBy),
      status: integration.status === "ERROR" ? "CONNECTED" : integration.status,
    };
  });
  saveIntegrationStates(next);
  return next;
}

export function connectIntegration(integrationId: string): Integration[] {
  const now = new Date().toISOString();
  return upsertIntegrationState(integrationId, {
    status: "CONNECTED",
    connected_at: now,
    last_sync_at: now,
  });
}

export function disconnectIntegration(integrationId: string): Integration[] {
  return upsertIntegrationState(integrationId, {
    status: "DISCONNECTED",
    connected_at: null,
  });
}

export function markIntegrationError(integrationId: string): Integration[] {
  return upsertIntegrationState(integrationId, {
    status: "ERROR",
    last_sync_at: new Date().toISOString(),
  });
}
