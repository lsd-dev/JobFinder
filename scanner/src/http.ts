/**
 * Polite HTTP client: one request at a time per host with a minimum gap,
 * timeouts, and exponential backoff on 429/5xx that honours Retry-After.
 * Career sites rate-limit aggressively (Workday and Microsoft returned 429 to
 * back-to-back calls during the probe), so every adapter goes through here.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface HttpOptions {
  method?: "GET" | "POST";
  json?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Retry on 429? Off for sources whose throttling gets worse with retries (Workday). */
  retryOn429?: boolean;
  /** Share one queue across hosts, e.g. every *.myworkdayjobs.com tenant. */
  queueKey?: string;
  /** Gap after each request in this queue (default HTTP_MIN_GAP_MS or 1500 ms). */
  minGapMs?: number;
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly url: string, body: string) {
    // Error pages are often full HTML documents: keep the log line short and readable.
    const snippet = body.trimStart().startsWith("<")
      ? (/<title>([^<]*)/i.exec(body)?.[1]?.trim() || "HTML error page")
      : body.slice(0, 200);
    super(`HTTP ${status} for ${redact(url)}: ${snippet}`);
  }
}

const MIN_GAP_MS = Number(process.env.HTTP_MIN_GAP_MS ?? 1500);
const hostQueues = new Map<string, Promise<unknown>>();

/** Strip query strings from logged URLs; they can be long and add nothing. */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serialize requests per queue key (host by default), with a gap between them. */
function enqueue<T>(host: string, gapMs: number, task: () => Promise<T>): Promise<T> {
  const prev = hostQueues.get(host) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    try {
      return await task();
    } finally {
      await sleep(gapMs);
    }
  });
  hostQueues.set(host, next);
  return next;
}

async function once(url: string, opts: HttpOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: "application/json, text/html;q=0.9, */*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...opts.headers,
    };
    let body: string | undefined;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers["Content-Type"] = "application/json";
    }
    return await fetch(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function request(url: string, opts: HttpOptions = {}): Promise<string> {
  const key = opts.queueKey ?? new URL(url).host;
  const retries = opts.retries ?? 3;
  return enqueue(key, opts.minGapMs ?? MIN_GAP_MS, async () => {
    let attempt = 0;
    for (;;) {
      let res: Response | undefined;
      let err: unknown;
      try {
        res = await once(url, opts);
      } catch (e) {
        err = e; // network error / timeout: retryable
      }
      if (res && res.ok) return await res.text();
      const retryable = !res || (res.status === 429 ? opts.retryOn429 !== false : res.status >= 500);
      if (!retryable || attempt >= retries) {
        if (res) throw new HttpError(res.status, url, await res.text().catch(() => ""));
        throw err instanceof Error ? err : new Error(String(err));
      }
      const retryAfter = Number(res?.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : 2000 * 2 ** attempt;
      await sleep(wait);
      attempt++;
    }
  });
}

export async function getJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const text = await request(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON from ${redact(url)}, got: ${text.slice(0, 120)}`);
  }
}
