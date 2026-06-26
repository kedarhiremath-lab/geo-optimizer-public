// Local web UI: paste URL -> analyze (baseline + skills interview) -> answer ->
// optimize (LLM rewrite weaving in answers) -> before/after score + draft.
// Internal tool, runs locally (no auth, no hosting — out of scope for M1).

import express from "express";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { analyze, optimize } from "../optimize.js";
import { createProvider } from "../llm.js";
import { INTERVIEW_LENSES } from "../interview.js";

// Demo safety net: cache the last successful optimization per URL. If the live
// quota is exhausted, we serve the cached result instead of a red error.
const RESULT_CACHE = join(process.cwd(), "cache", "results");
function resultPath(url: string): string {
  return join(RESULT_CACHE, createHash("sha256").update(url).digest("hex").slice(0, 16) + ".json");
}
function saveResult(url: string, result: unknown): void {
  try {
    mkdirSync(RESULT_CACHE, { recursive: true });
    writeFileSync(resultPath(url), JSON.stringify(result), "utf8");
  } catch {
    /* cache write is best-effort */
  }
}
function loadResult(url: string): unknown | null {
  try {
    const p = resultPath(url);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
}

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

// Unauthenticated health check (so the host's probe passes even with the
// password gate enabled).
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// Optional password gate (HTTP Basic). Enabled only when APP_PASSWORD is set —
// so local dev stays open, but a public cloud deploy is protected (and your
// API quota isn't burned by strangers). Any username; password must match.
const APP_PASSWORD = process.env.APP_PASSWORD;
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString();
      const password = decoded.slice(decoded.indexOf(":") + 1);
      if (password === APP_PASSWORD) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="geo-optimizer"').status(401).send("Authentication required.");
  });
}

app.use(express.json({ limit: "1mb" }));

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
 input:focus,textarea:focus{outline:none;border-color:var(--accent)}
 button{padding:.7rem 1.2rem;font-size:1rem;font-weight:600;cursor:pointer;
   background:var(--accent);color:#fff;border:0;border-radius:9px}
 button:disabled{opacity:.5;cursor:default}
 button.secondary{background:transparent;border:1px solid var(--line);color:var(--muted)}
 .status{color:var(--muted);margin:.9rem 0;min-height:1.2em}
 .status.err{color:var(--bad);white-space:pre-wrap}
 .grid{display:grid;grid-template-columns:170px 1fr;gap:1rem;margin-top:1.2rem}
 @media(max-width:680px){.grid{grid-template-columns:1fr}}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1.1rem 1.2rem}
 .card h3{margin:.1rem 0 .8rem;font-size:.95rem;letter-spacing:.02em;color:var(--muted);text-transform:uppercase}
 .ring{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.3rem}
 .score{font-size:2.6rem;font-weight:800;line-height:1}
 .score small{font-size:1rem;color:var(--muted);font-weight:500}
 .beforeafter{display:flex;align-items:baseline;justify-content:center;gap:.4rem}
 .beforeafter .b4{font-size:1.5rem;font-weight:700;color:var(--muted)}
 .beforeafter .arrow{color:var(--muted);font-size:1.2rem}
 .beforeafter .after{font-size:2.6rem;font-weight:800;line-height:1}
 .beforeafter .after small{font-size:.9rem;color:var(--muted);font-weight:500}
 .delta{margin-top:.35rem;font-weight:700;font-size:.9rem}
 .delta.up{color:var(--good)} .delta.down{color:var(--bad)}
 .stages{display:flex;flex-direction:column;align-items:center;gap:.15rem}
 .stages .arrow{color:var(--muted);transform:rotate(90deg);font-size:1rem;line-height:1}
 .stage{display:flex;flex-direction:column;align-items:center}
 .stage .sv{font-size:1.5rem;font-weight:800;line-height:1.1}
 .stage .sv.big{font-size:2.4rem}
 .stage .sv small{font-size:.8rem;color:var(--muted);font-weight:500}
 .stage .sl{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
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
 .prose{margin:.7rem 0 0;max-height:560px;overflow:auto;padding-right:.4rem}
 .prose h1{font-size:1.3rem;margin:1.1rem 0 .5rem;color:var(--ink)}
 .prose h2{font-size:1.08rem;margin:1.3rem 0 .4rem;color:var(--accent)}
 .prose h3{font-size:.98rem;margin:1rem 0 .35rem;color:var(--ink)}
 .prose h1:first-child,.prose h2:first-child{margin-top:.2rem}
 .prose p{margin:.55rem 0;color:#cdd2dc}
 .prose ul,.prose ol{margin:.5rem 0;padding-left:1.3rem}
 .prose li{margin:.3rem 0;color:#cdd2dc}
 .prose strong{color:var(--ink)}
 .prose .tldr{background:rgba(79,140,255,.08);border-left:3px solid var(--accent);
   border-radius:6px;padding:.7rem .9rem;margin:.2rem 0 .4rem;color:#dfe6f5}
 .full{grid-column:1/-1}
 .meta{display:flex;flex-direction:column;gap:.5rem}
 .metarow{display:grid;grid-template-columns:150px 1fr;gap:.8rem;align-items:start}
 .metak{color:var(--muted);font-size:.85rem}
 .metav{color:#cdd2dc;word-break:break-word}
 @media(max-width:680px){.metarow{grid-template-columns:1fr}}
 .lens{margin:.2rem 0 1rem}
 .lens .lenshead{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap}
 .lens .lensname{font-weight:700;color:var(--ink)}
 .lens .skilltag{font-size:.72rem;color:var(--accent);background:rgba(79,140,255,.1);padding:.1rem .45rem;border-radius:5px}
 .lens .lensintent{color:var(--muted);font-size:.85rem;margin:.15rem 0 .6rem}
 .q{margin:.7rem 0}
 .q label{display:block;color:#cdd2dc;margin-bottom:.3rem;font-size:.92rem}
 .q textarea{width:100%;min-height:48px;resize:vertical;padding:.55rem .7rem;font:14px/1.45 inherit;
   background:#0c0e13;border:1px solid var(--line);border-radius:8px;color:var(--ink)}
 .interview-actions{display:flex;gap:.6rem;align-items:center;margin-top:.6rem}
 .hint{color:var(--muted);font-size:.85rem}
 .spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--line);
   border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:.5rem}
 @keyframes spin{to{transform:rotate(360deg)}}
 .step{font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:1.6rem 0 .4rem}
</style></head><body><div class="wrap">
<header>
 <h1>Trossen GEO/SEO Optimizer</h1>
 <p>Score a post, answer a short skills interview, get an optimized draft tuned to your answers.</p>
</header>
<div class="bar">
 <input id="url" placeholder="https://www.trossenrobotics.com/post/…"/>
 <button id="analyze">Analyze</button>
</div>
<div id="status" class="status"></div>
<div id="baseline"></div>
<div id="interview"></div>
<div id="out"></div>
</div>
<script>
const $=s=>document.querySelector(s);
let CTX={url:"",lenses:[]};
function esc(s){return (s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
function scoreColor(n){return n>=70?"var(--good)":n>=45?"var(--warn)":"var(--bad)";}

$("#analyze").onclick=doAnalyze;
$("#url").addEventListener("keydown",e=>{if(e.key==="Enter")doAnalyze();});

async function doAnalyze(){
  const url=$("#url").value.trim(); if(!url)return;
  CTX.url=url;
  $("#analyze").disabled=true; $("#status").className="status";
  $("#status").innerHTML='<span class="spinner"></span>Rendering and scoring the post (no AI call yet)…';
  $("#baseline").innerHTML=""; $("#interview").innerHTML=""; $("#out").innerHTML="";
  try{
    const r=await fetch("/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||"failed");
    CTX.lenses=d.lenses;
    CTX.provider=d.provider||"the configured model";
    $("#status").innerHTML="";
    $("#baseline").innerHTML=renderBaseline(d);
    $("#interview").innerHTML=renderInterview(d.lenses);
    $("#gen").onclick=doOptimize;
  }catch(e){$("#status").className="status err";$("#status").textContent=e.message;}
  finally{$("#analyze").disabled=false;}
}

function renderBaseline(d){
  let h='<div class="step">Step 1 · Baseline</div><div class="grid">';
  h+='<div class="card ring"><h3>GEO/SEO score</h3><div class="score" style="color:'+scoreColor(d.baselineScore)+'">'+
     d.baselineScore+'<small>/100</small></div><div class="hint">original</div></div>';
  h+='<div class="card"><h3>Gaps found</h3><ol class="fixes">'+
     d.fixList.map(f=>'<li><b>'+esc(f.label)+'</b> <span>— '+esc(f.recommendation)+'</span></li>').join('')+
     (d.fixList.length?'':'<li>No gaps — content already strong.</li>')+'</ol></div></div>';
  return h;
}

function renderInterview(lenses){
  let h='<div class="step">Step 2 · Skills interview</div>';
  h+='<div class="card full"><p class="hint" style="margin:.1rem 0 1rem">Answer what you can — blanks are skipped. Each section is a gstack skill lens. Your answers steer the rewrite.</p>';
  for(const lens of lenses){
    h+='<div class="lens"><div class="lenshead"><span class="lensname">'+esc(lens.label)+
       '</span><span class="skilltag">/'+esc(lens.skill)+'</span></div>'+
       '<div class="lensintent">'+esc(lens.intent)+'</div>';
    for(const q of lens.questions){
      h+='<div class="q"><label for="'+q.id+'">'+esc(q.q)+'</label>'+
         '<textarea id="'+q.id+'" placeholder="'+esc(q.placeholder)+'"></textarea></div>';
    }
    h+='</div>';
  }
  h+='<div class="interview-actions"><button id="gen">Generate optimized article</button>'+
     '<span class="hint">Uses one AI call.</span></div></div>';
  return h;
}

function collectAnswers(){
  const a={};
  for(const lens of CTX.lenses) for(const q of lens.questions){
    const el=document.getElementById(q.id); if(el&&el.value.trim())a[q.id]=el.value.trim();
  }
  return a;
}

async function doOptimize(){
  const answers=collectAnswers();
  $("#gen").disabled=true;
  $("#status").className="status";
  $("#status").innerHTML='<span class="spinner"></span>Rewriting in the voice of the original author, using '+esc(CTX.provider||"the configured model")+' (~30–90s)…';
  $("#out").innerHTML="";
  try{
    const r=await fetch("/api/optimize",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({url:CTX.url,answers})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||"failed");
    $("#status").innerHTML="";
    $("#out").innerHTML='<div class="step">Step 3 · Optimized result</div>'+renderResult(d);
    bindCopies();
    $("#out").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){$("#status").className="status err";$("#status").textContent=e.message;}
  finally{$("#gen").disabled=false;}
}

function mdToHtml(md){
  const inline=s=>esc(s).replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>");
  const lines=md.split(/\\r?\\n/);
  let html="",list=null,para=[];
  const flushP=()=>{ if(para.length){ html+="<p>"+inline(para.join(" "))+"</p>"; para=[]; } };
  const flushL=()=>{ if(list){ html+="</"+list+">"; list=null; } };
  for(let raw of lines){
    const line=raw.trim();
    if(!line){ flushP(); flushL(); continue; }
    let m;
    if(m=line.match(/^#\\s+(.*)/)){ flushP();flushL(); html+="<h1>"+inline(m[1])+"</h1>"; }
    else if(m=line.match(/^##\\s+(.*)/)){ flushP();flushL(); html+="<h2>"+inline(m[1])+"</h2>"; }
    else if(m=line.match(/^###\\s+(.*)/)){ flushP();flushL(); html+="<h3>"+inline(m[1])+"</h3>"; }
    else if(m=line.match(/^[-*]\\s+(.*)/)){ flushP(); if(list!=="ul"){flushL();list="ul";html+="<ul>";} html+="<li>"+inline(m[1])+"</li>"; }
    else if(m=line.match(/^\\d+\\.\\s+(.*)/)){ flushP(); if(list!=="ol"){flushL();list="ol";html+="<ol>";} html+="<li>"+inline(m[1])+"</li>"; }
    else { flushL(); para.push(line); }
  }
  flushP(); flushL();
  return html;
}
let RAW={};  // id -> raw text for copy buttons
function copyBtn(id,label){ return '<button class="copy" data-c="'+id+'">'+(label||"Copy")+'</button>'; }
function renderResult(d){
  RAW={full:d.rewrittenDraft, schema:JSON.stringify(d.schemas,null,2)};
  const c=d.content||{}, m=c.metadata||{};
  const safe=d.safe, delta=d.optimizedScore-d.baselineScore, ds=(delta>=0?"+":"")+delta;
  const ms=(d.modelScore!==undefined)?d.modelScore:d.optimizedScore;
  const ed=d.editorial;
  let h='';
  if(d.servedFromCache){ h+='<div class="hint" style="margin:.2rem 0 .6rem;color:var(--warn)">Showing the last saved result for this URL (live AI quota is exhausted right now).</div>'; }
  h+='<div class="grid">';
  h+='<div class="card ring"><h3>GEO/SEO score</h3>'+
     '<div class="stages">'+
       '<div class="stage"><span class="sv" style="color:'+scoreColor(d.baselineScore)+'">'+d.baselineScore+'</span><span class="sl">original</span></div>'+
       '<span class="arrow">→</span>'+
       '<div class="stage"><span class="sv" style="color:'+scoreColor(ms)+'">'+ms+'</span><span class="sl">model rewrite</span></div>'+
       '<span class="arrow">→</span>'+
       '<div class="stage"><span class="sv big" style="color:'+scoreColor(d.optimizedScore)+'">'+d.optimizedScore+'<small>/100</small></span><span class="sl">fully optimized</span></div>'+
     '</div>'+
     '<div class="delta '+(delta>=0?"up":"down")+'">'+ds+' points overall</div>'+
     '<div class="badge '+(safe?"ok":"no")+'">'+(safe?"✓ safe to use":"⚠ needs review")+'</div></div>';
  h+='<div class="card"><h3>Fixes applied</h3><ol class="fixes">'+
     d.fixList.map(f=>'<li><b>'+esc(f.label)+'</b></li>').join('')+'</ol></div></div>';
  // Editorial Preservation Mode — publish-readiness banner
  if(ed){
    if(!ed.publishReady){
      h+='<div class="card full flag"><h3>⛔ Do not publish yet — '+ed.doNotPublishReasons.length+' editorial gate(s) failed</h3>'+
         '<p class="hint" style="margin:.2rem 0 .6rem">Fix these before publishing (or re-run). Title/subtitle preservation and voice are non-negotiable.</p>'+
         '<ul>'+ed.doNotPublishReasons.map(r=>'<li>'+esc(r)+'</li>').join('')+'</ul></div>';
    } else {
      h+='<div class="card full"><h3>✅ Publish-ready — all editorial gates passed</h3>'+
         '<p class="hint" style="margin:.2rem 0 0">Title + subtitles preserved, voice intact, easier to read than the original.</p></div>';
    }
  }
  if(!d.claimDiff.passed){
    h+='<div class="card full flag"><h3>⚠ Claims to verify before publishing</h3>'+
       '<p class="hint" style="margin:.2rem 0 .6rem">In the rewrite but not clearly grounded in the source — confirm or remove each.</p>'+
       '<ul>'+d.claimDiff.added.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul></div>';
  }
  // Short Version
  if((c.shortVersion||[]).length){
    h+='<div class="card full"><h3>The Short Version</h3><ol class="fixes">'+
       c.shortVersion.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ol></div>';
  }
  // Who this is for
  if((c.whoThisIsFor||[]).length){
    h+='<div class="card full"><h3>Who this is for</h3><div class="prose"><ul>'+
       c.whoThisIsFor.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></div></div>';
  }
  // Optimized article — the ORIGINAL title prints first (verbatim, never rewritten),
  // then the optimized body.
  const titleMd=d.title?('# '+d.title+'\\n\\n'):'';
  h+='<div class="card full"><div class="codehead"><h3>Optimized article</h3>'+copyBtn("full","Copy full article (Markdown)")+'</div>'+
     '<div class="prose">'+mdToHtml(titleMd+(c.articleMarkdown||""))+'</div></div>';
  // Editorial Preservation Mode — readability, change budget, QA checklist
  if(ed){
    const b=ed.budget, bf=ed.before, af=ed.after;
    const arrow=(x,y,unit)=>x+(unit||'')+' → '+y+(unit||'');
    h+='<div class="card full"><h3>Readability — before → after</h3><div class="meta">'+
       metaRow("Reading friction (lower = easier)", arrow(bf.readingFriction,af.readingFriction))+
       metaRow("Cognitive load (lower = easier)", arrow(bf.cognitiveLoad,af.cognitiveLoad))+
       metaRow("Estimated reading time", arrow(bf.readingTimeMin,af.readingTimeMin,' min'))+
       metaRow("Avg paragraph length", arrow(bf.avgParagraphLength,af.avgParagraphLength,' words'))+
       metaRow("Dense paragraphs", arrow(bf.paragraphDensityPct,af.paragraphDensityPct,'%'))+
       '</div></div>';
    h+='<div class="card full"><h3>Editorial Change Budget</h3><div class="meta">'+
       metaRow("Sentences rewritten", b.sentencesRewrittenPct+'%')+
       metaRow("Original wording preserved", b.wordingPreservedPct+'%')+
       metaRow("Voice preservation score", b.voicePreservationScore+'/100')+
       metaRow("Paragraphs split", String(b.paragraphsSplit))+
       metaRow("Headings preserved", String(b.headingsPreserved))+
       metaRow("Headings changed", String(b.headingsChanged))+
       metaRow("Duplicate headings removed", String(b.duplicateHeadingsRemoved))+
       metaRow("Claims added", String(b.claimsAdded))+
       metaRow("Claims removed", String(b.claimsRemoved))+
       '</div></div>';
    h+='<div class="card full"><h3>QA checklist</h3><ul style="list-style:none;padding-left:0;margin:.4rem 0">'+
       ed.gates.map(g=>'<li style="margin:.32rem 0">'+(g.pass?'<span style="color:#39d98a">✓</span>':'<span style="color:#ff6b6b">✗</span>')+' '+esc(g.label)+(g.detail?' <span class="hint">— '+esc(g.detail)+'</span>':'')+'</li>').join('')+
       '</ul></div>';
    if((ed.optionalSeoRecs||[]).length){
      h+='<div class="card full"><h3>Optional SEO/GEO recommendations (not applied — title &amp; subtitles preserved)</h3>'+
         '<p class="hint" style="margin:.2rem 0 .6rem">Apply these in your CMS metadata if you want; they were intentionally kept OUT of the article body.</p>'+
         '<div class="prose"><ul>'+ed.optionalSeoRecs.map(r=>'<li>'+esc(r)+'</li>').join('')+'</ul></div></div>';
    }
  }
  // FAQ
  if((c.faq||[]).length){
    h+='<div class="card full"><h3>FAQ</h3><div class="prose">'+
       c.faq.map(f=>'<p><strong>'+esc(f.q)+'</strong><br>'+esc(f.a)+'</p>').join('')+'</div></div>';
  }
  // Metadata
  h+='<div class="card full"><h3>SEO/GEO metadata</h3><div class="meta">'+
     metaRow("Title tag",m.title)+metaRow("Meta description",m.metaDescription)+metaRow("URL slug",m.slug)+
     metaRow("Tags",(m.tags||[]).join(", "))+metaRow("Social copy",m.socialCopy)+
     ((m.imageAltText||[]).length?metaRow("Image alt text",m.imageAltText.join(" | ")):"")+'</div></div>';
  // Asset recommendations
  if((c.assetRecommendations||[]).length){
    h+='<div class="card full"><h3>Asset recommendations</h3><div class="prose"><ul>'+
       c.assetRecommendations.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></div></div>';
  }
  // Schema (JSON-LD)
  h+='<div class="card full"><div class="codehead"><h3>Structured data — JSON-LD ('+(d.schemas||[]).length+' blocks)</h3>'+copyBtn("schema","Copy JSON-LD")+'</div>';
  if((d.schemaNotes||[]).length){ h+='<ul class="hint" style="margin:.2rem 0 .5rem;padding-left:1.1rem">'+d.schemaNotes.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul>'; }
  h+='<pre>'+esc(RAW.schema)+'</pre></div>';
  return h;
}
function metaRow(k,v){ return '<div class="metarow"><span class="metak">'+esc(k)+'</span><span class="metav">'+esc(v||"—")+'</span></div>'; }
function bindCopies(){
  document.querySelectorAll(".copy").forEach(b=>b.onclick=async()=>{
    const key=b.dataset.c;
    const text=(RAW&&RAW[key]!==undefined)?RAW[key]:(($("#"+key)&&$("#"+key).textContent)||"");
    await navigator.clipboard.writeText(text);
    const o=b.textContent;b.textContent="Copied ✓";setTimeout(()=>b.textContent=o,1200);
  });
}
</script></body></html>`;

app.get("/", (_req, res) => res.type("html").send(PAGE));

function badUrl(url: string): boolean {
  return !/^https?:\/\//.test(url);
}

// Friendly name of the model the rewrite will actually use (so the UI never
// claims "free-tier AI" when it's really running on paid Claude Opus, or vice
// versa). Mirrors createProvider()'s selection logic without constructing a client.
function providerLabel(): string {
  const pref = (process.env.LLM_PROVIDER || "").toLowerCase();
  const useAnthropic = pref === "anthropic" || (pref !== "gemini" && !!process.env.ANTHROPIC_API_KEY);
  if (useAnthropic) {
    const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
    const friendly: Record<string, string> = {
      "claude-opus-4-8": "Claude Opus 4.8",
      "claude-opus-4-7": "Claude Opus 4.7",
      "claude-sonnet-4-6": "Claude Sonnet 4.6",
    };
    return friendly[model] || `Claude (${model})`;
  }
  return "Gemini (free tier)";
}

function quotaMessage(raw: string): string {
  // Anthropic: low/empty credit balance.
  if (/credit balance|billing|insufficient|payment/i.test(raw)) {
    return (
      "The Anthropic account is out of credits. Add credits at https://console.anthropic.com " +
      "(Billing) to keep using Claude Opus, or set GEMINI_API_KEY + LLM_PROVIDER=gemini to fall back."
    );
  }
  // Gemini free-tier daily quota / rate limits / either-provider overload.
  if (/429|quota|rate.?limit|resource.?exhausted|overloaded|529|all gemini models failed/i.test(raw)) {
    return (
      "The model is rate-limited or the free-tier daily quota is exhausted. Wait a moment and retry, " +
      "or add billing to remove the cap (Anthropic: console.anthropic.com; Google: aistudio.google.com)."
    );
  }
  return raw;
}

app.post("/api/analyze", async (req, res) => {
  const url = (req.body?.url ?? "").toString().trim();
  if (badUrl(url)) {
    res.status(400).json({ error: "Provide a valid http(s) URL." });
    return;
  }
  // Hard timeout: if the browser hangs, return a proper error rather than
  // dropping the connection (which gives the client "Unexpected end of JSON input").
  const timeout = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ error: "Page render timed out (>90s). Try again or check the URL." });
  }, 90_000);
  try {
    const a = await analyze(url);
    clearTimeout(timeout);
    if (!res.headersSent) res.json({ ...a, lenses: INTERVIEW_LENSES, provider: providerLabel() });
  } catch (err) {
    clearTimeout(timeout);
    if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/optimize", async (req, res) => {
  const url = (req.body?.url ?? "").toString().trim();
  const answers = (req.body?.answers ?? {}) as Record<string, string>;
  if (badUrl(url)) {
    res.status(400).json({ error: "Provide a valid http(s) URL." });
    return;
  }
  const timeout = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ error: "Optimization timed out (>3min). Try again." });
  }, 180_000);
  try {
    const result = await optimize(url, createProvider(), { answers });
    clearTimeout(timeout);
    saveResult(url, result); // cache the latest good result for the demo safety net
    if (!res.headersSent) res.json(result);
  } catch (err) {
    clearTimeout(timeout);
    const raw = err instanceof Error ? err.message : String(err);
    // Demo safety net: on quota/credit/transient failure, serve the last good result.
    if (/429|quota|rate.?limit|resource.?exhausted|overloaded|529|credit balance|billing|all gemini models failed/i.test(raw)) {
      const cached = loadResult(url) as Record<string, unknown> | null;
      if (cached) {
        if (!res.headersSent) res.json({ ...cached, servedFromCache: true });
        return;
      }
    }
    if (!res.headersSent) res.status(500).json({ error: quotaMessage(raw) });
  }
});

// Prevent unhandled promise rejections / uncaught exceptions from silently
// killing the process mid-request (which gives the client an empty body /
// "Unexpected end of JSON input" instead of a real error message).
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const PORT = Number(process.env.PORT) || 5173;
app.listen(PORT, () => console.log(`GEO/SEO optimizer UI on http://localhost:${PORT}`));
