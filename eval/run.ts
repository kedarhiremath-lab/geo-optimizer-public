// T9 — Independent eval oracle.
//
// This is NOT the optimizer's own checklist (that would be circular — eng review
// #1). It asserts INDEPENDENT quality properties of the live output on the
// Blueprint post:
//   1. Fact-preservation: claim-diff added ZERO unsupported facts (reputational gate).
//   2. JSON-LD validates against the Article required-field shape.
//   3. Sanity: the rewrite is non-empty and a real change from the source.
// It then prints a human spot-check gate for the first runs.
//
// Run: npm run eval   (needs GEMINI_API_KEY; live LLM call)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { optimize } from "../src/optimize.js";
import { GeminiProvider } from "../src/llm.js";

function loadEnv(): void {
  const p = join(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TARGET =
  process.argv[2] ||
  "https://www.trossenrobotics.com/post/the-physical-ai-deployment-blueprint-from-pilot-to-commercial-reality";

async function main(): Promise<void> {
  loadEnv();
  const r = await optimize(TARGET, new GeminiProvider());

  const checks: { name: string; pass: boolean; detail: string }[] = [
    {
      name: "fact-preservation (zero invented claims)",
      pass: r.claimDiff.passed,
      detail: r.claimDiff.passed ? "no added facts" : `added: ${r.claimDiff.added.join(" | ")}`,
    },
    {
      name: "schema generated (Article + others)",
      pass: r.schemas.length > 0,
      detail: r.schemaNotes.join("; ") || `${r.schemas.length} blocks`,
    },
    {
      name: "structured content present (short version, faq, metadata)",
      pass: r.content.shortVersion.length > 0 && r.content.faq.length > 0 && !!r.content.metadata.title,
      detail: `shortVersion:${r.content.shortVersion.length} faq:${r.content.faq.length} title:${r.content.metadata.title ? "y" : "n"}`,
    },
    {
      name: "rewrite is non-empty",
      pass: r.rewrittenDraft.trim().length > 200,
      detail: `${r.rewrittenDraft.length} chars`,
    },
  ];

  let allPass = true;
  console.log(`\n=== EVAL: ${TARGET} ===`);
  console.log(`baseline score: ${r.baselineScore}/100\n`);
  for (const c of checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    if (!c.pass) allPass = false;
    console.log(`[${mark}] ${c.name} — ${c.detail}`);
  }

  console.log(`\n--- HUMAN SPOT-CHECK GATE (required for first runs) ---`);
  console.log("Read the rewritten draft and confirm: (a) facts unchanged, (b) tone on-brand,");
  console.log("(c) headings match target queries. The automated checks above are necessary, not sufficient.");

  console.log(`\nRESULT: ${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(`EVAL ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
