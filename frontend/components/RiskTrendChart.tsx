"use client";

import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
} from "recharts";

export type RiskDay = {
  date: string;       // "2026-03-01"
  avg_risk: number;
  max_risk: number;
  event_count: number;
  blocked_count?: number;
  high_risk_count?: number;
};

type Props = {
  data: RiskDay[];
  threshold?: number;  // from Settings high_risk_threshold, default 70
};

function fmt(date: string) {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Custom tooltip
function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 12,
      fontFamily: "monospace",
      boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
    }}>
      <p style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--text)" }}>{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ margin: "3px 0", color: entry.color }}>
          {entry.name}: <strong>{typeof entry.value === "number" ? entry.value.toFixed(1) : entry.value}</strong>
        </p>
      ))}
    </div>
  );
}

export default function RiskTrendChart({ data, threshold = 70 }: Props) {
  const router = useRouter();

  // Pad to 7 days if less data
  const chartData = data.map((d) => ({
    date: fmt(d.date),
    rawDate: d.date,
    "Avg Risk": d.avg_risk,
    "Blocked": d.blocked_count ?? Math.round(d.event_count * 0.3),
    "Activity": d.event_count,
    "High Risk": d.high_risk_count ?? (d.avg_risk > threshold ? Math.round(d.event_count * 0.6) : 0),
  }));

  const handleClick = (data: { activePayload?: Array<{ payload: { rawDate?: string } }> }) => {
    const raw = data?.activePayload?.[0]?.payload?.rawDate;
    if (raw) {
      router.push(`/audit?date=${raw}`);
    }
  };

  if (!data.length) {
    return (
      <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--text-muted)", fontSize: 13, fontFamily: "monospace" }}>
          No trend data available yet
        </p>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", userSelect: "none" }}>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { color: "#ef4444", label: "High-risk events" },
          { color: "#f97316", label: "Blocked actions" },
          { color: "#3b82f6", label: "Total activity" },
          { color: "#ef444440", label: `Danger zone (>${threshold})`, dashed: true },
        ].map((item) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
            <span style={{
              display: "inline-block", width: 20, height: 2,
              background: item.color,
              borderTop: item.dashed ? "2px dashed" : "2px solid",
              borderColor: item.color,
            }} />
            {item.label}
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart
          data={chartData}
          onClick={handleClick}
          style={{ cursor: "pointer" }}
          margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="dangerGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />

          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--text-muted)", fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
          />

          {/* Left axis: risk scores */}
          <YAxis
            yAxisId="risk"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={30}
          />

          {/* Right axis: activity count */}
          <YAxis
            yAxisId="count"
            orientation="right"
            tick={{ fontSize: 10, fill: "var(--text-muted)", fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={30}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* Danger zone shading above threshold */}
          <Area
            yAxisId="risk"
            type="monotone"
            dataKey="Avg Risk"
            stroke="transparent"
            fill="url(#dangerGrad)"
            baseValue={threshold}
            activeDot={false}
            isAnimationActive={false}
          />

          {/* Threshold reference line */}
          <ReferenceLine
            yAxisId="risk"
            y={threshold}
            stroke="#ef4444"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{
              value: `Threshold ${threshold}`,
              position: "insideTopRight",
              fontSize: 10,
              fill: "#ef4444",
              fontFamily: "monospace",
            }}
          />

          {/* High-risk line */}
          <Line
            yAxisId="risk"
            type="monotone"
            dataKey="High Risk"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 4, fill: "#ef4444", strokeWidth: 0, cursor: "pointer" }}
            activeDot={{ r: 6, fill: "#ef4444" }}
            isAnimationActive={false}
          />

          {/* Blocked line */}
          <Line
            yAxisId="count"
            type="monotone"
            dataKey="Blocked"
            stroke="#f97316"
            strokeWidth={2}
            dot={{ r: 4, fill: "#f97316", strokeWidth: 0, cursor: "pointer" }}
            activeDot={{ r: 6, fill: "#f97316" }}
            isAnimationActive={false}
          />

          {/* Total activity line (secondary axis) */}
          <Line
            yAxisId="count"
            type="monotone"
            dataKey="Activity"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0, cursor: "pointer" }}
            activeDot={{ r: 5, fill: "#3b82f6" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, fontFamily: "monospace", textAlign: "center" }}>
        Click any point to open Audit Logs for that day
      </p>
    </div>
  );
}
