"use client";

import { useCallback, useEffect, useState } from "react";

import { apiRequestWithRetry } from "@/lib/api";

type SpendSummary = {
  total_usd: number;
  by_day: Array<{ day: string; usd: number }>;
  top_agents: Array<{ agent_id: string; agent_name?: string; usd: number; tool_calls: number }>;
  top_tools: Array<{ tool: string; usd: number }>;
  alerts_triggered: Array<Record<string, unknown>>;
};

type ProviderRow = {
  provider: string;
  usd: number;
};

const fallbackSummary: SpendSummary = {
  total_usd: 0,
  by_day: [],
  top_agents: [],
  top_tools: [],
  alerts_triggered: [],
};

export function formatBudgetShort(value: number) {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

export function useBudget() {
  const [spend, setSpend] = useState<SpendSummary>(fallbackSummary);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const [summaryData, providerData] = await Promise.all([
      apiRequestWithRetry(`/spend/summary?${params.toString()}`),
      apiRequestWithRetry("/spend/providers"),
    ]);

    setSpend((summaryData as SpendSummary) || fallbackSummary);
    setProviders(Array.isArray(providerData) ? (providerData as ProviderRow[]) : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { spend, providers, loading, refresh: load };
}
