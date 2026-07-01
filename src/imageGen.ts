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
 * Style wrapper every image prompt passes through. Produces AI-forward, high-
 * production visuals (NOT flat clipart), in one of three formats — a photoreal
 * image, a polished graphic/infographic, or a data graph — and enforces the two
 * things models get wrong: composition (nothing cut off) and legible text.
 */
function stylePrompt(prompt: string, kind = "image"): string {
  const k = (kind || "image").toLowerCase();
  let kindStyle: string;
  if (k === "graph")
    kindStyle =
      "FORMAT — DATA GRAPH: render a clean, professional data chart (bar, line, or similar) that visualizes the described data. Axis titles and category labels must be correctly spelled, legible, and fully inside the frame.";
  else if (k === "graphic")
    kindStyle =
      "FORMAT — GRAPHIC/INFOGRAPHIC: render a polished, modern, high-production graphic — depth, subtle gradients, refined iconography, magazine quality. NOT flat clipart, NOT a simple cartoon.";
  else
    kindStyle =
      "FORMAT — PHOTOREALISTIC IMAGE: render a high-fidelity, studio-quality photograph or realistic 3D render. Cinematic lighting, real materials and textures, sharp detail. NOT an illustration, NOT clipart.";
  return (
    `${prompt}\n\n` +
    "STYLE: modern, premium, AI-forward visual for a robotics/AI company blog — high production value.\n" +
    kindStyle +
    "\nCOMPOSITION: keep the entire subject AND any text fully inside the frame with generous margins on all " +
    "sides — nothing cropped, cut off, zoomed past, or running off the edges; centered and balanced.\n" +
    "TEXT: any words in the image must be minimal (roughly 0-6 words), correctly spelled, large, and fully " +
    "legible well inside the frame — never clipped at an edge. No watermarks."
  );
}

async function viaOpenAI(prompt: string, kind: string): Promise<string | null> {
  const size = process.env.IMAGE_SIZE || "1024x1024";
  const quality = process.env.IMAGE_QUALITY || "medium";
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt: stylePrompt(prompt, kind), size, quality, n: 1 }),
  });
  if (!r.ok) throw new Error("openai image " + r.status + " " + (await r.text()).slice(0, 200));
  const d = (await r.json()) as { data?: { b64_json?: string; url?: string }[] };
  const b64 = d.data?.[0]?.b64_json;
  if (b64) return "data:image/png;base64," + b64;
  return d.data?.[0]?.url ?? null;
}

async function viaGoogle(prompt: string, kind: string): Promise<string | null> {
  const key = process.env.GEMINI_IMAGE_API_KEY || process.env.GEMINI_API_KEY;
  const model = process.env.IMAGE_MODEL || "gemini-2.5-flash-image";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "Generate an image. " + stylePrompt(prompt, kind) }] }] }),
  });
  if (!r.ok) throw new Error("google image " + r.status + " " + (await r.text()).slice(0, 200));
  const d = (await r.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  for (const pt of parts) {
    if (pt.inlineData?.data) return `data:${pt.inlineData.mimeType || "image/png"};base64,` + pt.inlineData.data;
  }
  return null;
}

/** Generate a real image; returns a base64 data URL, or null on any failure.
 * `kind` selects the format: "image" (photoreal), "graphic", or "graph". */
export async function generateImage(prompt: string, kind = "image"): Promise<string | null> {
  const p = (process.env.IMAGE_API || "").toLowerCase();
  try {
    if (p === "openai" && process.env.OPENAI_API_KEY) return await viaOpenAI(prompt, kind);
    if (p === "google" && (process.env.GEMINI_IMAGE_API_KEY || process.env.GEMINI_API_KEY)) return await viaGoogle(prompt, kind);
  } catch {
    /* fall through to null — the SVG figure remains as fallback */
  }
  return null;
}
