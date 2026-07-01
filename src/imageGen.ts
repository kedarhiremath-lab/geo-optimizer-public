// Real AI image generation (feedback #2). Provider-agnostic: uses OpenAI's image
// API or Google's Gemini image model, chosen by IMAGE_API. Returns a base64
// data URL (self-contained, embeddable, downloadable). No image hosting needed.
//
// Enable by setting:
//   IMAGE_API=openai   + OPENAI_API_KEY=sk-...            (gpt-image-1)
//   IMAGE_API=google   + GEMINI_IMAGE_API_KEY=...  (or reuse GEMINI_API_KEY)
// Optional: IMAGE_SIZE (default 1024x1024), IMAGE_QUALITY (openai: low|medium|high).

export function imageGenAvailable(): boolean {
  const p = (process.env.IMAGE_API || "").toLowerCase();
  if (p === "openai") return !!process.env.OPENAI_API_KEY;
  if (p === "google") return !!(process.env.GEMINI_IMAGE_API_KEY || process.env.GEMINI_API_KEY);
  return false;
}

export function imageProviderName(): string {
  const p = (process.env.IMAGE_API || "").toLowerCase();
  if (p === "openai") return "OpenAI gpt-image-1";
  if (p === "google") return "Google Gemini image";
  return "none (inline SVG)";
}

/**
 * Style wrapper every image prompt passes through. Enforces the two things AI
 * image models get wrong: (1) NO text — models misspell and clip words; (2)
 * composition — keep the whole subject inside the frame with margins so nothing
 * is cut off at the edges.
 */
function stylePrompt(prompt: string): string {
  return (
    `${prompt}\n\n` +
    "STYLE: clean, modern, professional editorial illustration for a robotics/AI company blog; " +
    "cohesive muted palette; technical but approachable; flat vector look.\n" +
    "COMPOSITION: the entire subject sits fully inside the frame with generous margins on ALL sides — " +
    "nothing cropped, cut off, zoomed-in, or touching the edges; centered and balanced; single clear focal subject.\n" +
    "STRICT — NO TEXT: the image must contain absolutely no text, words, letters, numbers, labels, captions, " +
    "titles, callouts, annotations, watermarks, or logos of any kind. It is a purely visual illustration — " +
    "zero typography. (Text is described separately in the alt/caption, never rendered in the image.)"
  );
}

async function viaOpenAI(prompt: string): Promise<string | null> {
  const size = process.env.IMAGE_SIZE || "1024x1024";
  const quality = process.env.IMAGE_QUALITY || "medium";
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt: stylePrompt(prompt), size, quality, n: 1 }),
  });
  if (!r.ok) throw new Error("openai image " + r.status + " " + (await r.text()).slice(0, 200));
  const d = (await r.json()) as { data?: { b64_json?: string; url?: string }[] };
  const b64 = d.data?.[0]?.b64_json;
  if (b64) return "data:image/png;base64," + b64;
  return d.data?.[0]?.url ?? null;
}

async function viaGoogle(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_IMAGE_API_KEY || process.env.GEMINI_API_KEY;
  const model = process.env.IMAGE_MODEL || "gemini-2.5-flash-image";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "Generate an image. " + stylePrompt(prompt) }] }] }),
  });
  if (!r.ok) throw new Error("google image " + r.status + " " + (await r.text()).slice(0, 200));
  const d = (await r.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  for (const pt of parts) {
    if (pt.inlineData?.data) return `data:${pt.inlineData.mimeType || "image/png"};base64,` + pt.inlineData.data;
  }
  return null;
}

/** Generate a real image; returns a base64 data URL, or null on any failure. */
export async function generateImage(prompt: string): Promise<string | null> {
  const p = (process.env.IMAGE_API || "").toLowerCase();
  try {
    if (p === "openai" && process.env.OPENAI_API_KEY) return await viaOpenAI(prompt);
    if (p === "google" && (process.env.GEMINI_IMAGE_API_KEY || process.env.GEMINI_API_KEY)) return await viaGoogle(prompt);
  } catch {
    /* fall through to null — the SVG figure remains as fallback */
  }
  return null;
}
