/**
 * lib/env.ts
 *
 * Single source of truth for all environment variables.
 *
 * Rules:
 *  - NEXT_PUBLIC_* vars are available in the browser (baked in at build time).
 *  - Non-prefixed vars (e.g. RESEND_API_KEY) are server-only and must only
 *    be accessed inside Next.js API routes / Server Components.
 *  - validate() is called at module load time so misconfiguration fails fast
 *    during `next build` rather than silently at runtime.
 *
 * NOTE: prompt requested VITE_ prefix, but this project uses Next.js which
 * requires NEXT_PUBLIC_ for browser-accessible vars.  The variable names are
 * otherwise identical.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type AppEnv = "development" | "staging" | "production";

export interface ClientEnv {
  SLACK_WEBHOOK_URL: string;
  APPROVER_EMAIL: string;
  APP_ENV: AppEnv;
  API_URL: string;
  IS_DEV: boolean;
  IS_PROD: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function get(key: string): string {
  const value =
    typeof process !== "undefined" ? process.env[key] ?? "" : "";
  return value.trim();
}

function requireServer(key: string): string {
  if (typeof window !== "undefined") {
    // Should never be called in browser code — fail loudly in dev.
    if (get("NEXT_PUBLIC_APP_ENV") === "development") {
      throw new Error(
        `[env] "${key}" is a server-only variable and must not be accessed in browser code.`
      );
    }
    return ""; // silent in prod for safety
  }
  const value = get(key);
  if (!value) {
    throw new Error(
      `[env] Required server-side environment variable "${key}" is missing.\n` +
        `Add it to .env.local (for local dev) or your deployment secrets.`
    );
  }
  return value;
}

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validates that all required environment variables are present.
 * Called at build time (in next.config.js) and optionally at runtime.
 *
 * @param strict  When true, throw on missing optional vars too (use in CI).
 */
export function validateEnv(strict = false): void {
  const missing: string[] = [];

  // Required in all environments
  const required: string[] = ["NEXT_PUBLIC_APP_ENV", "NEXT_PUBLIC_API_URL"];

  for (const key of required) {
    if (!get(key)) missing.push(key);
  }

  if (missing.length > 0) {
    throw new Error(
      `[env] Missing required environment variables:\n` +
        missing.map((k) => `  • ${k}`).join("\n") +
        `\n\nCopy .env.local.example to .env.local and fill in the values.`
    );
  }

  // Warn (not throw) about optional-but-important vars
  const recommended: string[] = [
    "NEXT_PUBLIC_SLACK_WEBHOOK_URL",
    "NEXT_PUBLIC_APPROVER_EMAIL",
    "RESEND_API_KEY",
  ];

  if (strict) {
    const missingOptional = recommended.filter((k) => !get(k));
    if (missingOptional.length > 0) {
      throw new Error(
        `[env] strict=true — missing recommended variables:\n` +
          missingOptional.map((k) => `  • ${k}`).join("\n")
      );
    }
  } else {
    const missingOptional = recommended.filter((k) => !get(k));
    if (missingOptional.length > 0 && get("NEXT_PUBLIC_APP_ENV") !== "production") {
      console.warn(
        `[env] Optional variables not set (notifications will be disabled):\n` +
          missingOptional.map((k) => `  • ${k}`).join("\n")
      );
    }
  }
}

// ── Public (browser-safe) env object ──────────────────────────────────────────

function parseAppEnv(raw: string): AppEnv {
  if (raw === "staging") return "staging";
  if (raw === "production") return "production";
  return "development";
}

export const env: ClientEnv = {
  SLACK_WEBHOOK_URL: get("NEXT_PUBLIC_SLACK_WEBHOOK_URL"),
  APPROVER_EMAIL: get("NEXT_PUBLIC_APPROVER_EMAIL"),
  APP_ENV: parseAppEnv(get("NEXT_PUBLIC_APP_ENV")),
  API_URL: get("NEXT_PUBLIC_API_URL") || "http://localhost:8000",
  get IS_DEV() {
    return this.APP_ENV === "development";
  },
  get IS_PROD() {
    return this.APP_ENV === "production";
  },
};

// ── Server-only accessors ──────────────────────────────────────────────────────
// Import and call these only inside Next.js API routes or Server Components.

export const serverEnv = {
  get RESEND_API_KEY() {
    return requireServer("RESEND_API_KEY");
  },
};
