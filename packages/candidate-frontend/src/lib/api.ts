const BASE = "/api/interview";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

// A shared module-level refresh promise: concurrent 401s (e.g. a heartbeat and an answer landing
// together) trigger exactly ONE /auth/refresh. A second would be rejected as token reuse and
// force a spurious mid-interview logout.
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

const NO_RETRY = ["/auth/login", "/auth/refresh"];

export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      method: method ?? (body !== undefined ? "POST" : "GET"),
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch();
  if (res.status === 401 && !NO_RETRY.some((p) => path.startsWith(p)) && (await refreshSession())) {
    res = await doFetch();
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const b = (await res.json()) as { error?: string };
      if (b.error) message = b.error;
    } catch {
      // non-JSON body
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Fire-and-forget violation report; failures never surface to the candidate. */
export function reportViolation(type: string, detail: Record<string, unknown> = {}, snapshotDataUrl: string | null = null) {
  void api("/violation", { type, detail, snapshotDataUrl }).catch(() => undefined);
}
