// Relative base: in dev Vite proxies /api to the backend; in production Hosting rewrites it.
const BASE = "/api/admin";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

type Unauthorized = () => void;
let onUnauthorized: Unauthorized = () => undefined;
export function setUnauthorizedHandler(fn: Unauthorized) {
  onUnauthorized = fn;
}

// One shared in-flight refresh, so concurrent 401s trigger exactly one /auth/refresh
// (a second would be rejected as token reuse and force a spurious logout).
let refreshing: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

const NO_RETRY = ["/auth/login", "/auth/refresh", "/auth/logout"];

interface Options {
  method?: string;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      method: opts.method ?? (opts.body || opts.formData ? "POST" : "GET"),
      credentials: "include",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
    });

  let res = await doFetch();
  if (res.status === 401 && !NO_RETRY.some((p) => path.startsWith(p))) {
    if (await refreshSession()) {
      res = await doFetch();
    }
    if (res.status === 401) onUnauthorized();
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
