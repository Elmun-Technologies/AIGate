/**
 * POST /api/send-email
 *
 * Server-side proxy for Resend API.
 * Keeps RESEND_API_KEY out of the browser bundle.
 */
import { NextRequest, NextResponse } from "next/server";

interface SendEmailBody {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY ?? "";

  if (!apiKey) {
    return NextResponse.json(
      { error: "RESEND_API_KEY is not configured on this server." },
      { status: 503 }
    );
  }

  let body: SendEmailBody;
  try {
    body = (await req.json()) as SendEmailBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { to, subject, html, text } = body;
  if (!to || !subject || !html) {
    return NextResponse.json(
      { error: "Missing required fields: to, subject, html" },
      { status: 400 }
    );
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "AI Governance <alerts@notifications.yourdomain.com>",
      to: [to],
      subject,
      html,
      text: text || subject,
    }),
  });

  const data = (await response.json()) as unknown;

  if (!response.ok) {
    return NextResponse.json(
      { error: "Resend API error", details: data },
      { status: response.status }
    );
  }

  return NextResponse.json({ success: true, data });
}
