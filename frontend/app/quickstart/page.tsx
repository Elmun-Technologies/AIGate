"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const installSnippet = `pip install agentgate-sdk`;
const registerSnippet = `from agentgate import AgentGate\n\nag = AgentGate(api_key=\"ag_your_key_here\")\nagent = ag.register(\n    name=\"my-agent\",\n    owner=\"team@company.com\",\n    classification=\"confidential\"\n)`;
const enforceSnippet = `@ag.enforce(agent=\"my-agent\")\ndef call_external_api(endpoint: str, payload: dict):\n    return requests.post(endpoint, json=payload)`;

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <Card className="bg-slate-950/80">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(code)}>Copy</Button>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="mono overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">{code}</pre>
      </CardContent>
    </Card>
  );
}

export default function QuickstartPage() {
  return (
    <section className="page-shell">
      <div>
        <h1 className="page-title">Developer Quickstart</h1>
        <p className="page-subtitle">Integrate runtime enforcement in 3 steps.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <CodeBlock title="Step 1 — Install" code={installSnippet} />
          <CodeBlock title="Step 2 — Register agent" code={registerSnippet} />
          <CodeBlock title="Step 3 — Enforce policy on tool calls" code={enforceSnippet} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Implementation Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-300">
            <p>✓ API key configured</p>
            <p>✓ Agent classified (Public / Internal / PII / Confidential)</p>
            <p>✓ Tool calls routed through AgentGate gateway</p>
            <p>✓ Approval queue connected for high-risk actions</p>
            <p>✓ Audit export wired to compliance evidence</p>
            <p className="mono text-xs text-slate-500">Your API key is in Settings → API Keys</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
