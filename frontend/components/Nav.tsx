"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/agents", label: "Agents" },
  { href: "/policies", label: "Policies" },
  { href: "/approvals", label: "Approvals" },
  { href: "/audit", label: "Audit" },
  { href: "/spend", label: "Spend" },
  { href: "/simulators", label: "Simulators" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(Boolean(localStorage.getItem("token")));
  }, [pathname]);

  if (!authed && pathname !== "/login") {
    return null;
  }

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/login");
  };

  return (
    <nav className="bg-white border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname === link.href ? "text-accent font-semibold" : "text-slate-700 hover:text-accent"}
            >
              {link.label}
            </Link>
          ))}
        </div>
        {authed ? (
          <button className="btn-secondary" onClick={logout}>
            Logout
          </button>
        ) : null}
      </div>
    </nav>
  );
}
