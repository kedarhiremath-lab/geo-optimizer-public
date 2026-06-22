// T5 — LLM provider abstraction + Gemini 2.5 Flash implementation.
//
// The provider interface keeps the pipeline model-agnostic; swapping in
// Anthropic later means one new file, no pipeline changes.
//
// Free-tier reality (eng review): Gemini free tier ~10 RPM, no Search grounding.
// We don't need grounding (pure analysis/rewrite). We DO need 429 backoff.

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LlmProvider } from "./types.js";

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 2_000;

// Fallback chain. Each model has its OWN daily free-tier quota bucket, so when
// the primary hits its daily cap we fall through to the next. This is the
// "fallback behavior" the boss asked about (feedback #1). Primary is set via
// GEMINI_MODEL (default: the strongest, gemini-2.5-pro); the chain degrades to
// the current-generation Flash models so generation never hard-fails.
const DEFAULT_FALLBACKS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const isRetryable = (msg: string) =>
  /429|rate|quota|resource.exhausted|503|unavailable|overloaded|high demand/i.test(msg);
const isQuota = (msg: string) => /quota|resource.exhausted|free_tier|per.?day/i.test(msg);

export class GeminiProvider implements LlmProvider {
  readonly name: string;
  private genAI: GoogleGenerativeAI;
  private models: string[];

  constructor(apiKey = process.env.GEMINI_API_KEY, modelName = process.env.GEMINI_MODEL || "gemini-2.5-pro") {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and add your free-tier key.");
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Primary model first, then fallbacks (deduped).
    this.models = Array.from(new Set([modelName, ...DEFAULT_FALLBACKS]));
    this.name = this.models.join(" -> ");
  }

  async complete(prompt: string, opts?: { json?: boolean }): Promise<string> {
    const request = opts?.json
      ? {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          // Large output budget so structured JSON isn't truncated.
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 32768 },
        }
      : prompt;

    let lastErr: unknown;
    for (let m = 0; m < this.models.length; m++) {
      const model = this.genAI.getGenerativeModel({ model: this.models[m] });
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await model.generateContent(request as Parameters<typeof model.generateContent>[0]);
          return res.response.text();
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          // Daily-quota exhaustion: don't waste retries — jump to the next model.
          if (isQuota(msg) && m < this.models.length - 1) break;
          if (!isRetryable(msg) || attempt === MAX_RETRIES) break;
          await sleep(BASE_BACKOFF_MS * 2 ** attempt);
        }
      }
      // This model's retry loop ended without returning. Fall through to the
      // next model ONLY if it failed on quota and another model remains;
      // otherwise stop and throw.
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      if (!(isQuota(msg) && m < this.models.length - 1)) break;
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`All Gemini models failed (${this.models.join(", ")}). Last error: ${msg}`);
  }
}

/**
 * Run a long article through the model in chunks when it exceeds a safe size,
 * so we never silently truncate (eng review failure mode).
 *
 * Gemini 2.5 Flash has a ~1M-token context, so a typical blog post fits in a
 * SINGLE call. We set the limit at ~180k chars (~45k tokens) — generous enough
 * that real posts never chunk (one call, no quality seams, half the free-tier
 * quota), while still guarding against a pathologically huge document.
 */
const SINGLE_CALL_CHAR_LIMIT = 180_000;

export async function completeLong(
  provider: LlmProvider,
  instruction: string,
  body: string,
): Promise<string> {
  if (body.length <= SINGLE_CALL_CHAR_LIMIT) {
    return provider.complete(`${instruction}\n\n---\nCONTENT:\n${body}`);
  }
  // Split on paragraph boundaries; process sequentially and concatenate.
  const parts = splitByChars(body, SINGLE_CALL_CHAR_LIMIT);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const note = `(This is chunk ${i + 1} of ${parts.length}. Process only this chunk; preserve all facts.)`;
    out.push(await provider.complete(`${instruction}\n${note}\n\n---\nCONTENT:\n${parts[i]}`));
  }
  return out.join("\n\n");
}

function splitByChars(text: string, limit: number): string[] {
  const paras = text.split(/\n\n+/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > limit && cur) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
