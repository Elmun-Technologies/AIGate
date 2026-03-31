"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldAlert, Workflow, FileCheck2, Hand, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const capabilities = [
  {
    icon: Workflow,
    title: "Execution Gateway",
    endpoint: "POST /gateway/tool-call",
    value: "All agent actions are forced through one enforcement point before execution.",
  },
  {
    icon: ShieldAlert,
    title: "Deterministic Policy Engine",
    endpoint: "GET/POST /policies",
    value: "YAML rules evaluate top-to-bottom with predictable ALLOW / BLOCK / REQUIRE_APPROVAL outcomes.",
  },
  {
    icon: Hand,
    title: "Runtime Approvals",
    endpoint: "GET /approvals, POST /approvals/{id}/approve",
    value: "High-risk actions are paused until security approver decision is recorded.",
  },
  {
    icon: FileCheck2,
    title: "Immutable Audit + Evidence",
    endpoint: "GET /audit, GET /audit/export, GET /audit/export-pack",
    value: "Every decision is chain-hashed and exportable as compliance-ready evidence.",
  },
  {
    icon: Wallet,
    title: "AI Spend Governance",
    endpoint: "GET /spend/summary, POST /spend/alerts",
    value: "Track provider usage and trigger thresholds before monthly surprises grow.",
  },
  {
    icon: CheckCircle2,
    title: "Deterministic Simulator",
    endpoint: "POST /sim/run",
    value: "Reproducible session demonstrates block, approval, execution, and evidence flow.",
  },
];

const flow = [
  {
    step: "1) Agent sends request",
    detail: "Tool call arrives at AgentGate via /gateway/tool-call with prompt, tool and args.",
    output: "Normalized request",
  },
  {
    step: "2) Policy is evaluated",
    detail: "Active YAML template is matched with first-hit semantics (top-to-bottom).",
    output: "Decision candidate",
  },
  {
    step: "3) Risk is scored",
    detail: "Deterministic 0-100 scoring from tool type, classification, destination and patterns.",
    output: "Risk score + factors",
  },
  {
    step: "4) Runtime enforcement",
    detail: "ALLOW executes, BLOCK denies, REQUIRE_APPROVAL creates pending request.",
    output: "System action",
  },
  {
    step: "5) Proof is written",
    detail: "Decision, reason, redacted payload and hash chain are appended to audit stream.",
    output: "Verifiable evidence",
  },
];

const outcomes = [
  "No direct tool execution outside policy gate.",
  "Confidential/PII outbound calls are blocked or approval-gated.",
  "Security can prove who approved what, when, and why.",
  "Audit pack export is ready for SOC/compliance evidence requests.",
];

export default function SalesPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-[#071126] to-[#030913] text-slate-100">
      <section className="mx-auto max-w-7xl px-6 py-10 md:py-14">
        <header className="mb-8 flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 font-bold text-white">AG</div>
            <div>
              <p className="text-2xl font-bold leading-tight">AgentGate</p>
              <p className="mono text-xs uppercase tracking-[0.12em] text-slate-400">Runtime Enforcement Control Plane</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild>
              <Link href="/simulators">
                Run Live Simulation <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <Card className="border-blue-500/20 bg-slate-950/70">
            <CardHeader className="space-y-4">
              <Badge variant="success" className="w-fit">Enterprise AI Runtime Security</Badge>
              <CardTitle className="text-4xl leading-tight md:text-5xl">Nothing executes unless policy allows it</CardTitle>
              <CardDescription className="text-base text-slate-300">
                AgentGate is the enforcement authority between AI agents and tools/APIs. We do not just monitor events,
                we actively decide execution before side effects happen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {outcomes.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
                  <span className="mt-1 inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <p className="text-sm text-slate-200">{item}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Business Clarity</CardTitle>
              <CardDescription>Built for teams handling sensitive data and real approval workflows.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <p className="mono text-xs uppercase text-slate-400">Core guarantee</p>
                <p className="mt-2 text-sm text-slate-200">An agent action cannot exist in production unless AgentGate authorizes it.</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <p className="mono text-xs uppercase text-slate-400">Audit integrity</p>
                <p className="mt-2 text-sm text-emerald-300">Hash chain + redacted payload + decision reason.</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <p className="mono text-xs uppercase text-slate-400">Latency target</p>
                <p className="mt-2 text-3xl font-bold text-blue-300">&lt; 200ms</p>
                <p className="mt-1 text-xs text-slate-400">for policy evaluation path in local demo stack</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <section className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">What You Can Use Right Now</CardTitle>
              <CardDescription>Every block below maps to existing product pages and backend endpoints.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {capabilities.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                      <div className="mb-3 inline-flex rounded-lg border border-slate-700 bg-slate-800/70 p-2">
                        <Icon className="h-4 w-4 text-blue-300" />
                      </div>
                      <p className="text-base font-semibold text-slate-100">{item.title}</p>
                      <p className="mono mt-1 text-xs text-blue-300">{item.endpoint}</p>
                      <p className="mt-2 text-sm text-slate-300">{item.value}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">How Runtime Decision Works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {flow.map((item) => (
                <div key={item.step} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-100">{item.step}</p>
                    <Badge variant="blue">{item.output}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-300">{item.detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Try the Full Flow in 2 Minutes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <p className="font-semibold text-slate-100">1) Sign in</p>
                <p className="mt-1">Use seeded admin credentials to access control plane pages.</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <p className="font-semibold text-slate-100">2) Run Simulation</p>
                <p className="mt-1">Generate allow/block/approval events with deterministic risk scores.</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <p className="font-semibold text-slate-100">3) Approve high-risk action</p>
                <p className="mt-1">Security approver resolves pending requests and execution continues.</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <p className="font-semibold text-slate-100">4) Export evidence</p>
                <p className="mt-1">Audit Logs / Evidence Locker provide chain-based compliance package.</p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button asChild>
                  <Link href="/login">Open Control Plane</Link>
                </Button>
                <Button variant="secondary" asChild>
                  <Link href="/quickstart">Developer Quickstart</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </section>
    </main>
  );
}
