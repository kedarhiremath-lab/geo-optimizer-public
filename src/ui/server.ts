// T8 — One-page local web UI: paste a post URL, see fix-list + draft + JSON-LD.
// Internal tool, runs locally (no auth, no hosting — out of scope for M1).

import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { optimize } from "../optimize.js";
import { GeminiProvider } from "../llm.js";

function loadEnv(): void {
  const p = join(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const app = express();
app.use(express.json());

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>GEO/SEO Optimizer</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
 h1{font-size:1.4rem} input{width:72%;padding:.6rem;font-size:1rem}
 button{padding:.6rem 1rem;font-size:1rem;cursor:pointer}
 .card{border:1px solid #ddd;border-radius:8px;padding:1rem;margin:1rem 0}
 .bad{color:#b00020;font-weight:600} .good{color:#0a7d28;font-weight:600}
 pre{white-space:pre-wrap;background:#f6f6f6;padding:1rem;border-radius:6px;overflow:auto}
 .score{font-size:2rem;font-weight:700} li{margin:.3rem 0} .muted{color:#666}
</style></head><body>
<h1>Trossen GEO/SEO Optimizer <span class="muted">— M1</span></h1>
<p>Paste a trossenrobotics.com post URL.</p>
<input id="url" placeholder="https://www.trossenrobotics.com/post/..." />
<button id="go">Optimize</button>
<div id="status" class="muted"></div>
<div id="out"></div>
<script>
const $=s=>document.querySelector(s);
$("#go").onclick=async()=>{
  const url=$("#url").value.trim(); if(!url)return;
  $("#status").textContent="Rendering + optimizing… (free-tier LLM, ~20-40s)"; $("#out").innerHTML="";
  try{
    const r=await fetch("/api/optimize",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"failed");
    $("#status").textContent="";
    $("#out").innerHTML=render(d);
  }catch(e){$("#status").innerHTML='<span class="bad">'+e.message+'</span>';}
};
function esc(s){return (s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
function render(d){
  let h='<div class="card"><div class="score">'+d.baselineScore+'/100</div>';
  h+='<div>Original GEO/SEO baseline. Safe to use: <span class="'+(d.safe?'good':'bad')+'">'+(d.safe?'YES':'NO')+'</span></div></div>';
  h+='<div class="card"><h3>Prioritized fix-list</h3><ol>'+d.fixList.map(f=>'<li><b>'+esc(f.label)+'</b> — '+esc(f.recommendation)+'</li>').join('')+'</ol></div>';
  if(!d.claimDiff.passed){h+='<div class="card"><h3 class="bad">Fact-preservation FAIL — rewrite added unsupported claims</h3><ul>'+d.claimDiff.added.map(c=>'<li class="bad">'+esc(c)+'</li>').join('')+'</ul></div>';}
  if(d.jsonLdNotes.length){h+='<div class="card"><h3>JSON-LD notes</h3><ul>'+d.jsonLdNotes.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul></div>';}
  h+='<div class="card"><h3>JSON-LD ('+(d.jsonLdValid?'valid':'INVALID')+')</h3><pre>'+esc(JSON.stringify(d.jsonLd,null,2))+'</pre></div>';
  h+='<div class="card"><h3>Rewritten draft</h3><pre>'+esc(d.rewrittenDraft)+'</pre></div>';
  return h;
}
</script></body></html>`;

app.get("/", (_req, res) => res.type("html").send(PAGE));

app.post("/api/optimize", async (req, res) => {
  const url = (req.body?.url ?? "").toString().trim();
  if (!/^https?:\/\//.test(url)) {
    res.status(400).json({ error: "Provide a valid http(s) URL." });
    return;
  }
  try {
    const result = await optimize(url, new GeminiProvider());
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const PORT = Number(process.env.PORT) || 5173;
app.listen(PORT, () => console.log(`GEO/SEO optimizer UI on http://localhost:${PORT}`));
