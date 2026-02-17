"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("Admin123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        },
        false,
      );
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("user", JSON.stringify(data.user));
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container-page min-h-screen flex items-center justify-center">
      <div className="card w-full max-w-md">
        <h1 className="text-2xl font-semibold mb-2">Agent Proxy Gateway</h1>
        <p className="text-sm text-slate-600 mb-6">Login to manage inline enforcement and approvals.</p>

        <form className="space-y-3" onSubmit={onSubmit}>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" required />
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" required />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button className="btn-primary w-full" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="mt-4 text-xs text-slate-500">
          Seeded admin: <code>admin@example.com / Admin123!</code>
        </div>
      </div>
    </main>
  );
}
