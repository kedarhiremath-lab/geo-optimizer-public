// T5 — LLM provider abstraction + Gemini 2.5 Flash implementation.
//
// The provider interface keeps the pipeline model-agnostic; swapping in
// Anthropic later means one new file, no pipeline changes.
//
// Free-tier reality (eng review): Gemini free tier ~10 RPM, no Search grounding.
// We don't need grounding (pure analysis/rewrite). We DO need 429 backoff.

import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
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

// Per-day quota exhaustion: retrying the same model won't help — move on.
const isQuota = (msg: string) => /quota|resource.exhausted|free_tier|per.?day/i.test(msg);
// Transient server-side issues worth a backoff retry on the SAME model.
const isTransient = (msg: string) =>
  !isQuota(msg) && /429|rate|503|unavailable|overloaded|high demand|timeout|temporar/i.test(msg);

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
    // Try each model in the chain. We fall through to the next model on ANY
    // persistent failure of the current one (quota, model-unavailable/404,
    // permission/403, etc.) — not just quota — so e.g. a key without Pro access
    // degrades to Flash instead of hard-failing. Only transient errors trigger
    // a same-model backoff retry. Throw only after the LAST model fails.
    for (const modelName of this.models) {
      const model = this.genAI.getGenerativeModel({ model: modelName });
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await model.generateContent(request as Parameters<typeof model.generateContent>[0]);
          return res.response.text();
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          if (isTransient(msg) && attempt < MAX_RETRIES) {
            await sleep(BASE_BACKOFF_MS * 2 ** attempt);
            continue;
          }
          break; // quota / permanent / out-of-retries -> move to the next model
        }
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`All Gemini models failed (${this.models.join(", ")}). Last error: ${msg}`);
  }
}

/**
 * Anthropic Claude provider. This is the strongest option for the voice-preserving
 * rewrite — Opus 4.8 follows the "sound like the original author, don't paraphrase"
 * instructions far more faithfully than a free-tier Flash model.
 *
 * Design notes (per the Claude API guidance):
 *  - Model: claude-opus-4-8 (configurable via ANTHROPIC_MODEL).
 *  - Adaptive thinking ON — the rewrite is a nuanced editorial task; letting the
 *    model reason before writing improves voice fidelity.
 *  - STREAMING — the article body is long output; streaming avoids the SDK's
 *    non-streaming HTTP-timeout guard at high max_tokens.
 *  - We extract only the text blocks (thinking blocks are ignored).
 */
export class AnthropicProvider implements LlmProvider {
  readonly name: string;
  private client: Anthropic;
  private model: string;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8") {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env (get a key with credits at https://console.anthropic.com).");
    }
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.name = `anthropic:${model}`;
  }

  async complete(prompt: string, opts?: { json?: boolean }): Promise<string> {
    // For JSON requests, a system instruction keeps the model from wrapping the
    // object in prose; the downstream extractJson() still strips any stray fences.
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: prompt }],
    };
    if (opts?.json) {
      params.system =
        "Output ONLY the JSON value requested — no markdown fences, no commentary, no leading or trailing prose.";
    }
    // Cast to whatever the installed SDK's stream() expects (keeps us version-proof
    // even if the local types don't yet know the "adaptive" thinking variant).
    const messages = this.client.messages;
    const stream = messages.stream(params as Parameters<typeof messages.stream>[0]);
    const msg = await stream.finalMessage();
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    if (!text.trim()) {
      const reason = msg.stop_reason ? ` (stop_reason: ${msg.stop_reason})` : "";
      throw new Error(`Anthropic returned no text content${reason}.`);
    }
    return text;
  }
}

/**
 * Pick the LLM provider. Prefers Anthropic (Claude Opus 4.8 — the strongest
 * rewrite, best at voice preservation) when ANTHROPIC_API_KEY is set; otherwise
 * falls back to Gemini. Force one explicitly with LLM_PROVIDER=anthropic|gemini.
 */
export function createProvider(): LlmProvider {
  const pref = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (pref === "gemini") return new GeminiProvider();
  if (pref === "anthropic") return new AnthropicProvider();
  if (process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
  return new GeminiProvider();
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
