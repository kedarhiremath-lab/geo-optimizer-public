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

// Trossen Robotics' ACTUAL arm aesthetic — injected whenever a generated image
// depicts a robotic arm, so the model renders THEIR hardware instead of the
// generic white/grey industrial cobot it defaults to. Describes the real arms:
// matte-black, 3D-printed carbon-fiber-textured links with truss/lattice cut-outs,
// black servo joints, a black parallel gripper on a linear rail, TROSSEN wordmark.
const TROSSEN_ARM =
  "TROSSEN ARM — match this exactly when a robotic arm appears: a matte-black research " +
  "robotic arm whose links are 3D-printed with a carbon-fiber texture and visible triangular " +
  "truss/lattice cut-outs and exposed hex bolts; chunky black servo actuators at every joint; " +
  "a black two-finger parallel gripper; mounted on a black linear rail on a light maple-wood " +
  "workbench in a real robotics lab. The white 'TROSSEN' wordmark is clearly printed on the " +
  "side of the largest link. This is NOT a smooth white or grey industrial cobot — it is a " +
  "rugged, black, 3D-printed research arm.";

// Does the described subject involve a robotic arm? (Then force the Trossen look.)
function looksLikeArm(s: string): boolean {
  return /\b(arm|robot|gripper|manipulator|end[-\s]?effector|actuator|joint|servo|payload|cobot)\b/i.test(s);
}

/**
 * Style wrapper every image prompt passes through. Forces AI-REALISTIC, real-
 * photograph-quality visuals (never clipart/cartoon/generic-cobot), in one of
 * three formats — a photoreal image, a polished graphic, or a data graph — and
 * enforces the things the model gets wrong: composition (nothing cut off),
 * legible non-garbled text, and rendering Trossen's actual arm when one appears.
 */
function stylePrompt(prompt: string, kind = "image"): string {
  const k = (kind || "image").toLowerCase();
  const arm = looksLikeArm(prompt);
  const parts: string[] = [prompt, ""];
  if (k === "graph") {
    parts.push(
      "FORMAT — DATA GRAPH: a clean, modern, professional data chart (bar or line) on a dark " +
        "background that visualizes the described numbers. Keep labels to a few short, correctly-" +
        "spelled words; axis titles and category labels fully inside the frame.",
    );
  } else if (k === "graphic") {
    parts.push(
      "FORMAT — GRAPHIC: a polished, high-production, PHOTOREALISTIC graphic — real materials, " +
        "depth, cinematic lighting, magazine quality. NOT flat clipart, NOT a cartoon, NOT a line " +
        "drawing. Do NOT add callout labels (small text renders garbled) — let the caption explain " +
        "it; at most 0-3 short, correctly-spelled words.",
    );
    if (arm) parts.push(TROSSEN_ARM);
  } else {
    parts.push(
      "FORMAT — PHOTOREALISTIC IMAGE: a real, high-fidelity DSLR-style PHOTOGRAPH — true-to-life " +
        "materials, textures, reflections and shadows, shallow depth of field, natural lab lighting. " +
        "It must look like a real photo shot in a robotics lab — NOT a 3D cartoon, NOT clipart, NOT a " +
        "stock illustration, NOT a clean studio render on a plain grey gradient.",
    );
    if (arm) parts.push(TROSSEN_ARM);
  }
  parts.push(
    "STYLE: premium, AI-realistic visual for the Trossen Robotics blog — maximum realism and production value.",
    "COMPOSITION: keep the entire subject and any text fully inside the frame with generous margins on " +
      "all sides — nothing cropped, cut off, or running off the edges; centered and balanced.",
    "TEXT: any words must be minimal, large, correctly spelled, and fully legible inside the frame (the " +
      "only long word allowed is the 'TROSSEN' logo). No garbled or misspelled text, no watermarks.",
  );
  return parts.join("\n");
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
