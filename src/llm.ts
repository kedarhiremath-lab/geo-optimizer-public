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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class GeminiProvider implements LlmProvider {
  readonly name: string;
  private model;

  constructor(apiKey = process.env.GEMINI_API_KEY, modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash") {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and add your free-tier key.");
    }
    this.name = modelName;
    this.model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: modelName });
  }

  async complete(prompt: string, opts?: { json?: boolean }): Promise<string> {
    let lastErr: unknown;
    const request = opts?.json
      ? {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          // Large output budget: the structured rewrite returns a full article
          // inside JSON; the default ~8k cap truncates it (→ invalid JSON).
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 32768 },
        }
      : prompt;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await this.model.generateContent(request as Parameters<typeof this.model.generateContent>[0]);
        return res.response.text();
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const rateLimited = /429|rate|quota|resource.exhausted/i.test(msg);
        if (!rateLimited || attempt === MAX_RETRIES) break;
        // Exponential backoff for free-tier 10 RPM limits.
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`Gemini completion failed after ${MAX_RETRIES + 1} attempts: ${msg}`);
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
