export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiRequest(path: string, options: RequestInit = {}, withAuth = true) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.headers && typeof options.headers === "object" && !Array.isArray(options.headers)) {
    Object.assign(headers, options.headers as Record<string, string>);
  }

  if (withAuth && typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    // Auto-logout on 401: token expired or invalid
    if (response.status === 401 && withAuth && typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
      throw new Error("Session expired. Please log in again.");
    }
    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      message = data.detail || JSON.stringify(data);
    } catch {
      // no-op
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiRequestWithRetry(
  path: string,
  options: RequestInit = {},
  withAuth = true,
  retries = 3,
  delayMs = 1000,
) {
  for (let i = 0; i < retries; i += 1) {
    try {
      return await apiRequest(path, options, withAuth);
    } catch {
      if (i < retries - 1) {
        await sleep(delayMs * (i + 1));
      }
    }
  }
  return null;
}
