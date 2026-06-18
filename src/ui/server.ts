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

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trossen GEO/SEO Optimizer</title>
<style>
 :root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--ink:#e7e9ee;--muted:#8b93a3;
   --accent:#4f8cff;--good:#2ec28a;--bad:#ff5d6c;--warn:#f6b73c}
 *{box-sizing:border-box}
 body{font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
   margin:0;background:var(--bg);color:var(--ink)}
 .wrap{max-width:920px;margin:0 auto;padding:2.2rem 1.2rem 4rem}
 header h1{font-size:1.45rem;margin:0 0 .2rem}
 header p{color:var(--muted);margin:0 0 1.4rem}
 .bar{display:flex;gap:.5rem}
 input{flex:1;padding:.7rem .85rem;font-size:1rem;background:var(--panel);
   border:1px solid var(--line);border-radius:9px;color:var(--ink)}
 input:focus{outline:none;border-color:var(--accent)}
 button{padding:.7rem 1.2rem;font-size:1rem;font-weight:600;cursor:pointer;
   background:var(--accent);color:#fff;border:0;border-radius:9px}
 button:disabled{opacity:.5;cursor:default}
 .status{color:var(--muted);margin:.9rem 0;min-height:1.2em}
 .status.err{color:var(--bad)}
 .grid{display:grid;grid-template-columns:170px 1fr;gap:1rem;margin-top:1.2rem}
 @media(max-width:680px){.grid{grid-template-columns:1fr}}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1.1rem 1.2rem}
 .card h3{margin:.1rem 0 .8rem;font-size:.95rem;letter-spacing:.02em;color:var(--muted);text-transform:uppercase}
 .ring{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.3rem}
 .score{font-size:2.6rem;font-weight:800;line-height:1}
 .score small{font-size:1rem;color:var(--muted);font-weight:500}
 .badge{display:inline-flex;align-items:center;gap:.4rem;padding:.25rem .6rem;border-radius:999px;font-weight:600;font-size:.85rem}
 .badge.ok{background:rgba(46,194,138,.15);color:var(--good)}
 .badge.no{background:rgba(255,93,108,.15);color:var(--bad)}
 ol.fixes{margin:0;padding-left:1.1rem} ol.fixes li{margin:.45rem 0}
 ol.fixes b{color:var(--ink)} ol.fixes span{color:var(--muted)}
 .flag{background:rgba(246,183,60,.08);border:1px solid rgba(246,183,60,.3)}
 .flag h3{color:var(--warn)} .flag ul{margin:0;padding-left:1.1rem} .flag li{margin:.3rem 0;color:#f0d9a8}
 .codehead{display:flex;justify-content:space-between;align-items:center}
 .copy{background:transparent;border:1px solid var(--line);color:var(--muted);padding:.3rem .7rem;font-size:.8rem;font-weight:600}
 pre{white-space:pre-wrap;word-break:break-word;background:#0c0e13;border:1px solid var(--line);
   border-radius:9px;padding:.9rem;margin:.6rem 0 0;max-height:480px;overflow:auto;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}
 .full{grid-column:1/-1}
 .spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--line);
   border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:.5rem}
 @keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><div class="wrap">
<header>
 <h1>Trossen GEO/SEO Optimizer</h1>
 <p>Score a blog post for search + AI-assistant visibility, get a prioritized fix-list and an optimized draft.</p>
</header>
<div class="bar">
 <input id="url" placeholder="https://www.trossenrobotics.com/post/…"
   value="https://www.trossenrobotics.com/post/the-physical-ai-deployment-blueprint-from-pilot-to-commercial-reality"/>
 <button id="go">Optimize</button>
</div>
<div id="status" class="status"></div>
<div id="out"></div>
</div>
<script>
const $=s=>document.querySelector(s);
function esc(s){return (s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
function scoreColor(n){return n>=70?"var(--good)":n>=45?"var(--warn)":"var(--bad)";}
$("#go").onclick=run;
$("#url").addEventListener("keydown",e=>{if(e.key==="Enter")run();});
async function run(){
  const url=$("#url").value.trim(); if(!url)return;
  $("#go").disabled=true;
  $("#status").className="status";
  $("#status").innerHTML='<span class="spinner"></span>Rendering page, scoring, and rewriting via free-tier LLM (~20–50s)…';
  $("#out").innerHTML="";
  try{
    const r=await fetch("/api/optimize",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"failed");
    $("#status").innerHTML="";
    $("#out").innerHTML=render(d);
    bindCopies();
  }catch(e){$("#status").className="status err";$("#status").textContent=e.message;}
  finally{$("#go").disabled=false;}
}
function codeCard(title,id,text,cls){
  return '<div class="card full '+(cls||"")+'"><div class="codehead"><h3>'+title+
    '</h3><button class="copy" data-c="'+id+'">Copy</button></div><pre id="'+id+'">'+esc(text)+'</pre></div>';
}
function render(d){
  const safe=d.safe;
  let h='<div class="grid">';
  h+='<div class="card ring"><h3>Baseline</h3><div class="score" style="color:'+scoreColor(d.baselineScore)+'">'+
     d.baselineScore+'<small>/100</small></div><div class="badge '+(safe?"ok":"no")+'">'+
     (safe?"✓ safe to use":"⚠ needs review")+'</div></div>';
  h+='<div class="card"><h3>Prioritized fix-list</h3><ol class="fixes">'+
     d.fixList.map(f=>'<li><b>'+esc(f.label)+'</b> <span>— '+esc(f.recommendation)+'</span></li>').join('')+
     (d.fixList.length?'':'<li>No gaps found — content already strong.</li>')+'</ol></div>';
  h+='</div>';
  if(!d.claimDiff.passed){
    h+='<div class="card full flag"><h3>⚠ Claims to verify before publishing</h3>'+
       '<p style="color:var(--muted);margin:.2rem 0 .6rem">These appear in the rewrite but were not clearly grounded in the source. Confirm each is true (or remove it) — the optimizer will not invent facts for you.</p>'+
       '<ul>'+d.claimDiff.added.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul></div>';
  }
  if(d.jsonLdNotes.length){
    h+='<div class="card full"><h3>JSON-LD notes</h3><ul style="margin:0;padding-left:1.1rem;color:var(--muted)">'+
       d.jsonLdNotes.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul></div>';
  }
  h+=codeCard('Structured data — JSON-LD ('+(d.jsonLdValid?'valid':'INVALID')+')','jsonld',JSON.stringify(d.jsonLd,null,2));
  h+=codeCard('Optimized draft (Markdown)','draft',d.rewrittenDraft);
  return h;
}
function bindCopies(){
  document.querySelectorAll(".copy").forEach(b=>b.onclick=async()=>{
    await navigator.clipboard.writeText($("#"+b.dataset.c).textContent);
    const o=b.textContent;b.textContent="Copied ✓";setTimeout(()=>b.textContent=o,1200);
  });
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
