import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import type { z, ZodTypeAny } from "zod";
import { env } from "../config/env";
import { apiUsageLogCol, appSettingsCol } from "./collections";
import { logger } from "./logger";

// Pinned explicitly (not a -latest alias for the primary) so an unannounced
// tier/pricing change can't silently affect cost.
export const PRIMARY_MODEL = "gemini-3.5-flash-lite";
export const FALLBACK_MODEL = "gemini-flash-latest";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GENERATION_CONFIG = { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 16384 };
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_LADDER: { model: string; delayMs: number }[] = [
  { model: PRIMARY_MODEL, delayMs: 0 },
  { model: PRIMARY_MODEL, delayMs: 1000 },
  { model: PRIMARY_MODEL, delayMs: 3000 },
  { model: FALLBACK_MODEL, delayMs: 0 },
];
// Free choice (not specified by the PRD): a 108-question generation call can take a while.
const REQUEST_TIMEOUT_MS = 180_000;
const KEY_TEST_TIMEOUT_MS = 5000;
const KEY_CACHE_TTL_MS = 5 * 60 * 1000;

export type GeminiPurpose = "jd-extraction" | "question-generation-set" | "interview-evaluation";

export class GeminiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "GeminiError";
  }
}

// ---------- Key resolution: Firestore appSettings/gemini wins → else env, cached per instance ----------

let cachedKey: { value: string | null; expiresAt: number } | null = null;

export async function getGeminiApiKey(): Promise<string | null> {
  if (cachedKey && cachedKey.expiresAt > Date.now()) return cachedKey.value;
  let value = env.geminiApiKey;
  try {
    const stored = (await appSettingsCol().doc("gemini").get()).data();
    if (stored?.apiKey) value = stored.apiKey;
  } catch (err) {
    logger.warn({ err }, "Could not read Gemini key from Firestore; falling back to env");
  }
  cachedKey = { value, expiresAt: Date.now() + KEY_CACHE_TTL_MS };
  return value;
}

/** Called explicitly whenever the key is saved or cleared via Settings. */
export function invalidateGeminiKeyCache() {
  cachedKey = null;
}

/** Zero-token key check: fetches the primary model's metadata. */
export async function testGeminiKey(apiKey: string): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const res = await fetch(`${BASE_URL}/${PRIMARY_MODEL}?key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(KEY_TEST_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    return { ok: false, detail: await describeErrorBody(res) };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- generateContent with the retry ladder ----------

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function describeErrorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function logUsage(purpose: GeminiPurpose, model: string, usage: GeminiResponse["usageMetadata"]) {
  try {
    await apiUsageLogCol().add({
      purpose,
      promptTokens: usage?.promptTokenCount ?? 0,
      responseTokens: usage?.candidatesTokenCount ?? 0,
      totalTokens: usage?.totalTokenCount ?? 0,
      model,
      streamed: false,
      createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write apiUsageLog row");
  }
}

/** Sends one prompt through the retry ladder; returns the raw response and the model that answered. */
async function generate(prompt: string, purpose: GeminiPurpose): Promise<{ data: GeminiResponse; model: string }> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new GeminiError("No Gemini API key is configured. Set one in Admin → Settings or GEMINI_API_KEY.");

  let lastError = "Gemini request failed.";
  for (const [attempt, { model, delayMs }] of RETRY_LADDER.entries()) {
    if (delayMs > 0) await sleep(delayMs);
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: GENERATION_CONFIG }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network failure / timeout: treated as transient, like a retryable status.
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      lastError = `Gemini request failed: ${err instanceof Error ? err.message : String(err)}${cause ? ` (${cause.code ?? cause.message})` : ""}`;
      logger.warn({ purpose, model, attempt, cause: cause?.code ?? cause?.message }, lastError);
      continue;
    }

    if (res.ok) {
      const data = (await res.json()) as GeminiResponse;
      // Failed calls are NOT logged (no tokens are billed for a rejected request).
      await logUsage(purpose, model, data.usageMetadata);
      return { data, model };
    }

    const detail = await describeErrorBody(res);
    if (!RETRYABLE_STATUSES.has(res.status)) {
      // 400/401/403/404 would fail identically on retry.
      throw new GeminiError(`Gemini rejected the request (${res.status}): ${detail}`, res.status);
    }
    lastError = `Gemini is unavailable right now (${res.status}): ${detail}`;
    logger.warn({ purpose, model, attempt, status: res.status }, "Retryable Gemini error");
  }
  throw new GeminiError(lastError);
}

/** Calls Gemini and returns the response JSON validated against `schema`. */
export async function callGeminiJson<S extends ZodTypeAny>(prompt: string, purpose: GeminiPurpose, schema: S): Promise<z.output<S>> {
  const { data, model } = await generate(prompt, purpose);
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new GeminiError("Gemini returned an empty response — try again.");

  let json: unknown;
  try {
    // Defensive: strip markdown fences in case the model adds them despite the JSON mime type.
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
  } catch {
    const cutOff = candidate?.finishReason === "MAX_TOKENS";
    logger.warn({ purpose, model, finishReason: candidate?.finishReason }, "Gemini returned unparseable JSON");
    throw new GeminiError(cutOff
      ? "Gemini's response was cut off before it finished — try again."
      : "Gemini returned a response that wasn't valid JSON — try again.");
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    logger.warn({ purpose, model, issues: parsed.error.issues.slice(0, 5) }, "Gemini response failed schema validation");
    throw new GeminiError("Gemini returned a response in an unexpected shape — try again.");
  }
  return parsed.data;
}
