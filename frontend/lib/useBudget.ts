"use client";

import { useEffect, useState, useCallback } from "react";
import { apiRequestWithRetry } from "@/lib/api";

export type SpendSummary = {
  total_usd: number;
  by_day: Array<{ day: string; usd: number }>;
  top_agents: Array<{ agent_id: string; agent_name?: string; usd: number; tool_calls: number }>;
  top_tools: Array<{ tool: string; usd: number }>;
  alerts_triggered: Array<{ id: string; status: string; message?: string }>;
};

export type ProviderSpend = {
  provider: string;
  usd: number;
  tokens_in: number;
  tokens_out: number;
  events: number;
  shadow_events: number;
};

export function useBudget() {
  const [spend, setSpend] = useState<SpendSummary>({
    total_usd: 0,
    by_day: [],
    top_agents: [],
    top_tools: [],
    alerts_triggered: [],
  });
  const [providers, setProviders] = useState<ProviderSpend[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const to = new Date();
      const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });

      const [spendData, providerData] = await Promise.all([
        apiRequestWithRetry(`/spend/summary?${params.toString()}`),
        apiRequestWithRetry(`/spend/providers?${params.toString()}`),
      ]);

      setSpend((spendData as SpendSummary) || {
        total_usd: 0,
        by_day: [],
        top_agents: [],
        top_tools: [],
        alerts_triggered: [],
      });

      setProviders(
        Array.isArray((providerData as { providers?: ProviderSpend[] })?.providers)
          ? (providerData as { providers: ProviderSpend[] }).providers
          : [],
      );
    } catch {
      // intentionally silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { spend, providers, loading, reload: load };
}

export function formatBudget(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

export function formatBudgetShort(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${value.toFixed(2)}`;
}
