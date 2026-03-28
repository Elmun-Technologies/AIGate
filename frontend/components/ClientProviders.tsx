"use client";

// ── Client-side Providers ──────────────────────────────────────────────────────
// Wraps the application in all client-side context providers.
// Needed because Next.js layout.tsx is a server component.

import React from "react";
import { AuthProvider } from "@/src/contexts/AuthContext";

export default function ClientProviders({ children }: { children: React.ReactNode }) {
    return <AuthProvider>{children}</AuthProvider>;
}
