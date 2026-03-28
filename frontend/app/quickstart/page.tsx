"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useBudget } from "@/lib/useBudget";
import InfoTooltip from "@/components/InfoTooltip";

type Step = {
  id: number;
  title: string;
  description: string;
  status: "completed" | "current" | "todo";
  actionPrimary?: string;
  actionSecondary?: string;
  href?: string;
};

const stepsSeed: Step[] = [
  {
    id: 1,
    title: "Connect Identity Provider",
    description: "Enable SSO and map runtime roles (admin, security_approver, developer, viewer).",
    status: "completed",
  },
  {
    id: 2,
    title: "Import AI Models",
    description: "Connect your LLM providers (OpenAI, Anthropic, Gemini) and shadow usage discovery hooks.",
    status: "current",
    actionPrimary: "Import Models",
    actionSecondary: "Skip for now",
    href: "/spend",
  },
  {
    id: 3,
    title: "Set Baseline Policies",
    description: "Deploy default security guardrails to prevent data exfiltration and prompt-injection attacks.",
    status: "todo",
    actionPrimary: "Configure Policies",
    href: "/policies",
  },
  {
    id: 4,
    title: "Invite Team",
    description: "Add approvers and auditors to operationalize enforcement and remediation workflows.",
    status: "todo",
    actionPrimary: "Manage Team",
    href: "/settings",
  },
];

export default function QuickstartPage() {
  const router = useRouter();
  const [steps] = useState(stepsSeed);
  const { providers } = useBudget();
  
  const providerNames = useMemo(() => 
    providers.map(p => p.provider.toLowerCase()), 
  [providers]);
  
  const hasOpenAI = useMemo(() => 
    providerNames.some(n => n.includes('openai') || n.includes('gpt')), 
  [providerNames]);
  
  const hasAnthropic = useMemo(() => 
    providerNames.some(n => n.includes('anthropic') || n.includes('claude')), 
  [providerNames]);
  
  const hasAnyProvider = hasOpenAI || hasAnthropic;

  const progress = useMemo(() => {
    let completed = steps.filter((s) => s.status === "completed").length;
    if (hasAnyProvider && steps[1].status === "current") {
      completed += 1;
    }
    return {
      completed,
      total: steps.length,
      percent: Math.round((completed / steps.length) * 100),
    };
  }, [steps, hasAnyProvider]);

  return (
    <main className="container-page space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight section-title">
          Admin Quickstart Guide
          <InfoTooltip text="Complete onboarding steps to secure and govern enterprise AI runtime operations." />
        </h1>
        <p className="text-sm text-slate-600 mono">Complete these steps to secure and govern your enterprise AI environment.</p>
      </div>

      <section className="card">
        <div className="flex items-center justify-between mb-2">
          <p className="font-semibold">Onboarding Progress</p>
          <span className="badge badge-pending">{progress.percent}% complete</span>
        </div>
        <div className="risk-progress-track"><div className="risk-progress-fill" style={{ width: `${progress.percent}%` }} /></div>
        <p className="text-sm text-slate-600 mono mt-2">{progress.completed} of {progress.total} steps completed</p>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-3">
        <div className="space-y-3">
          {steps.map((step) => {
            const isStep2Completed = step.id === 2 && hasAnyProvider;
            return (
            <article key={step.id} className={`card quickstart-step ${isStep2Completed ? 'completed' : step.status}`}>
              <div className="quickstart-step-icon">
                {isStep2Completed || step.status === "completed" ? "✓" : step.status === "current" ? "◉" : "○"}
              </div>
              <div className="quickstart-step-content">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold">{step.id}. {step.title}</h2>
                  <span className={isStep2Completed || step.status === "completed" ? "badge badge-allow" : step.status === "current" ? "badge badge-pending" : "badge"}>
                    {isStep2Completed || step.status === "completed" ? "COMPLETED" : step.status === "current" ? "CURRENT STEP" : "TO-DO"}
                  </span>
                </div>
                <p className="text-sm text-slate-600">{step.description}</p>
                {step.actionPrimary && !isStep2Completed ? (
                  <div className="flex gap-2 mt-2">
                    <button className="btn-primary" onClick={() => step.href && router.push(step.href)}>{step.actionPrimary}</button>
                    {step.actionSecondary ? <button className="btn-secondary" onClick={() => router.push("/dashboard")}>{step.actionSecondary}</button> : null}
                  </div>
                ) : null}
              </div>
            </article>
          );})}
        </div>

        <div className="space-y-3">
          <section className="card resource-panel">
            <h2 className="font-semibold">Learning Resources</h2>
            <div className="resource-video">▶</div>
            <p className="font-semibold">How to connect AI Models</p>
            <p className="text-sm text-slate-600">Best practices for onboarding providers and enforcing runtime controls.</p>
          </section>

          <section className="card resource-panel">
            <h2 className="font-semibold">Documentation</h2>
            <ul className="resource-list">
              <li>📄 Setup Guide (PDF)</li>
              <li>📘 Security Whitepaper</li>
              <li>❔ FAQ & Troubleshooting</li>
            </ul>
          </section>

          <section className="card resource-panel">
            <h2 className="font-semibold">Pro Tip</h2>
            <p className="text-sm text-slate-600">
              Automate model importing and policy rollout using Terraform + CI workflows.
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
