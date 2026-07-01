// Local web UI: paste URL -> analyze (baseline + skills interview) -> answer ->
// optimize (LLM rewrite weaving in answers) -> before/after score + draft.
// Internal tool, runs locally (no auth, no hosting — out of scope for M1).

import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { analyze, optimize, suggestInterviewAnswers } from "../optimize.js";
import { createProvider } from "../llm.js";
import { INTERVIEW_LENSES } from "../interview.js";
import { getLearnings, addLearnings, clearLearnings } from "../learnings.js";
import { saveResult, loadResultById, loadResultByUrl, listResults, resultIdFor, repoIsDurable } from "../repo.js";
import { generateImage } from "../imageGen.js";

// Article repository (#6): every optimization is stored, keyed by source URL, so
// re-optimizing the same article OVERWRITES the previous version (latest only —
// no duplicates). Storage is DURABLE when Upstash is configured (persists forever
// across restarts), else the local file cache. See src/repo.ts.

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
 <p>Score a post, answer a short skills interview, get an optimized draft tuned to your answers. <a href="/dashboard" style="color:var(--accent)">Saved articles →</a></p>
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
// Saved-article viewer bootstrap (/r/:id)
const _view=location.pathname.match(/^\\/r\\/([a-f0-9]{16})$/);
if(_view) bootView(_view[1]);

async function doAnalyze(){
  const url=$("#url").value.trim(); if(!url)return;
  CTX.url=url;
  $("#analyze").disabled=true; $("#status").className="status";
  $("#status").innerHTML='<span class="spinner"></span>Scoring the post and drafting suggested answers…';
  $("#baseline").innerHTML=""; $("#interview").innerHTML=""; $("#out").innerHTML="";
  try{
    const r=await fetch("/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||"failed");
    CTX.lenses=d.lenses;
    CTX.provider=d.provider||"the configured model";
    $("#status").innerHTML="";
    $("#baseline").innerHTML=renderBaseline(d);
    $("#interview").innerHTML=renderInterview(d.lenses,d.suggestions||{});
    $("#gen").onclick=doOptimize;
    const skip=$("#gen-skip"); if(skip) skip.onclick=doOptimize;
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

function renderInterview(lenses,suggestions){
  suggestions=suggestions||{};
  let h='<div class="step">Step 2 · Skills interview <span style="color:var(--accent);font-weight:600">(optional — but it makes the rewrite sharper)</span></div>';
  h+='<div class="card full"><p class="hint" style="margin:.1rem 0 1rem"><b>Optional.</b> You can skip this entirely and still get a full GEO-optimized article. Included is suggested answers to sharpen the GEO result, which you can edit and add to. Each section maps to a gstack expert lens.</p>'+
     '<div style="margin:0 0 1rem"><button id="gen-skip" style="background:transparent;border:1px solid var(--line);color:var(--muted);padding:.5rem 1rem;font-weight:600;border-radius:8px;cursor:pointer">Skip — optimize without answers</button></div>';
  for(const lens of lenses){
    h+='<div class="lens"><div class="lenshead"><span class="lensname">'+esc(lens.label)+
       '</span><span class="skilltag">/'+esc(lens.skill)+'</span></div>'+
       '<div class="lensintent">'+esc(lens.intent)+'</div>';
    for(const q of lens.questions){
      h+='<div class="q"><label for="'+q.id+'">'+esc(q.q)+'</label>'+
         '<textarea id="'+q.id+'" placeholder="'+esc(q.placeholder)+'">'+esc(suggestions[q.id]||"")+'</textarea></div>';
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
    bindCopies(); bindFigDownloads(); bindFigRegen(); bindWixCopy(); bindSeoRecs();
    $("#out").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){$("#status").className="status err";$("#status").textContent=e.message;}
  finally{$("#gen").disabled=false;}
}

function mdToHtml(md){
  const inline=s=>esc(s)
    .replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>")
    .replace(/\\[([^\\]]+)\\]\\((https?:[^)]+)\\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  const cells=r=>r.trim().replace(/^\\|/,"").replace(/\\|$/,"").split("|").map(c=>inline(c.trim()));
  const lines=md.split(/\\r?\\n/);
  let html="",list=null,para=[];
  const flushP=()=>{ if(para.length){ html+="<p>"+inline(para.join(" "))+"</p>"; para=[]; } };
  const flushL=()=>{ if(list){ html+="</"+list+">"; list=null; } };
  for(let i=0;i<lines.length;i++){
    const raw=lines[i], line=raw.trim();
    if(!line){ flushP(); flushL(); continue; }
    // raw HTML passthrough (e.g. <figure>, inline <svg>): output as-is, do not escape
    if(line.charAt(0)==="<"){ flushP(); flushL(); html+=raw; continue; }
    // table: a "| ... |" row followed by a "|---|---|" separator row
    if(line.charAt(0)==="|" && i+1<lines.length && /-/.test(lines[i+1]) && /^\\s*\\|?[\\s:|-]+\\|/.test(lines[i+1])){
      flushP(); flushL();
      let t="<table><thead><tr>"+cells(line).map(c=>"<th>"+c+"</th>").join("")+"</tr></thead><tbody>";
      i+=2;
      while(i<lines.length && lines[i].trim().charAt(0)==="|"){ t+="<tr>"+cells(lines[i]).map(c=>"<td>"+c+"</td>").join("")+"</tr>"; i++; }
      i--; html+=t+"</tbody></table>"; continue;
    }
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
let FIGS=[]; // generated figures (with inline svg) for the download buttons
function copyBtn(id,label){ return '<button class="copy" data-c="'+id+'">'+(label||"Copy")+'</button>'; }
function renderResult(d){
  RAW={full:d.rewrittenDraft, schema:JSON.stringify(d.schemas,null,2)};
  const c=d.content||{}, m=c.metadata||{};
  FIGS=c.imageSuggestions||[];
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
  // Shareable permalink (saved to the repository; latest version of this URL)
  if(d.savedUrl){
    h+='<div class="card full"><div class="codehead"><h3>Shareable link (saved to repository)</h3>'+copyBtn("perma","Copy link")+'</div>'+
       '<p class="hint" style="margin:.1rem 0 .4rem">Re-optimizing this same URL overwrites this saved version (latest only). <a href="/dashboard" style="color:var(--accent)">View all saved →</a></p>'+
       '<div><a id="perma" href="'+esc(d.savedUrl)+'" target="_blank" rel="noopener">'+esc(location.origin+d.savedUrl)+'</a></div></div>';
  }
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
  h+='<div class="card full"><div class="codehead"><h3>Optimized article</h3>'+
     '<span style="display:flex;gap:.5rem"><button class="copy" data-cwix="1">Copy for Wix (formatted)</button>'+copyBtn("full","Copy Markdown")+'</span></div>'+
     '<p class="hint" style="margin:.1rem 0 .4rem">“Copy for Wix” copies the whole article as rich text — paste straight into the Wix editor and headings, bold, lists, tables &amp; links keep their formatting. (Figures: use Download PNG above and Insert → Image.)</p>'+
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
         '<p class="hint" style="margin:.2rem 0 .6rem">These are metadata suggestions kept OUT of the article body. Accept to use one (it applies to the page’s SEO metadata, not the visible article — your title, subtitles, and URL slug never change). Decline to leave it.</p>'+
         '<ul style="list-style:none;padding-left:0;margin:.2rem 0">'+
         ed.optionalSeoRecs.map((r,ri)=>'<li style="margin:.6rem 0;border-left:3px solid var(--line);padding-left:.7rem">'+
           '<div>'+esc(r)+'</div>'+
           '<div style="display:flex;gap:.5rem;align-items:center;margin:.35rem 0 0">'+
             '<button class="copy seorec" data-seo="'+ri+'" data-act="accept">Accept</button>'+
             '<button class="copy seorec" data-seo="'+ri+'" data-act="decline">Decline</button>'+
             '<span class="seostat" id="seostat-'+ri+'" style="font-size:.85rem"></span>'+
           '</div></li>').join('')+
         '</ul></div>';
    }
  }
  // Recommended figures (machine-readable) — only when the source had no images
  if((c.imageSuggestions||[]).length){
    h+='<div class="card full"><h3>Generated figures</h3>'+
       '<p class="hint" style="margin:.2rem 0 .6rem">The source had no images, so these figures were generated and embedded in the optimized article (under their section) as &lt;figure&gt; blocks with alt text + captions. If you do not like one, hit <b>Re-generate image</b> for a fresh take. Download to save it, then Insert → Image in Wix.</p>';
    c.imageSuggestions.forEach((s,fi)=>{
      const vis=s.image?('<img src="'+esc(s.image)+'" alt="'+esc(s.alt)+'" style="width:100%;height:auto;border-radius:14px">'):(s.svg||"");
      h+='<figure style="margin:1rem 0 1.3rem">'+
         '<div style="max-width:560px" id="figvis-'+fi+'">'+vis+'</div>'+
         '<figcaption class="hint" style="margin:.4rem 0 .4rem">'+esc(s.caption)+'</figcaption>'+
         '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin:.2rem 0 .5rem">'+
           '<button class="copy figregen" data-fig="'+fi+'">Re-generate image</button>'+
           '<button class="copy figdl" data-fig="'+fi+'" data-kind="png">Download PNG</button>'+
           '<button class="copy figdl" data-fig="'+fi+'" data-kind="svg">Download SVG</button>'+
         '</div>'+
         '<div class="meta">'+
         '<div class="metarow"><span class="metak">Alt text</span><span class="metav">'+esc(s.alt)+'</span></div>'+
         '<div class="metarow"><span class="metak">Section</span><span class="metav">'+esc(s.section||"")+'</span></div>'+
         '<div class="metarow"><span class="metak">Generation prompt</span><span class="metav">'+esc(s.prompt)+'</span></div>'+
         '</div></figure>';
    });
    h+='</div>';
  }
  // Downloadable assets preserved from the source
  if((d.sourceDownloads||[]).length){
    h+='<div class="card full"><h3>Downloadable assets preserved</h3>'+
       '<p class="hint" style="margin:.2rem 0 .6rem">Carried over from the original article into a Downloads section of the optimized draft. Consider gating the most valuable one as a lead-capture conversion asset.</p>'+
       '<div class="prose"><ul>'+d.sourceDownloads.map(u=>'<li><a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(u)+'</a></li>').join('')+'</ul></div></div>';
  }
  // Score explainer — what the number measures + highest-leverage changes
  if(d.scoreExplain){
    const se=d.scoreExplain;
    h+='<div class="card full"><h3>Score explainer — what the '+d.optimizedScore+'/100 measures</h3>'+
       '<p class="hint" style="margin:.2rem 0 .6rem">A deterministic on-page GEO/SEO rubric — not an AI opinion and not live ranking data. Each signal earns fixed points; the total is capped at 100.</p>'+
       '<div class="meta">'+
       se.signals.map(s=>'<div class="metarow"><span class="metak">'+esc(s.label)+'</span><span class="metav">'+s.earned+' / '+s.max+' <span class="hint">'+esc(s.note)+'</span></span></div>').join('')+
       '</div>';
    if((se.topImprovements||[]).length){
      h+='<h4 style="margin:.9rem 0 .3rem;font-size:.95rem">Highest-leverage changes left</h4>'+
         '<ul style="margin:.2rem 0;padding-left:1.2rem">'+
         se.topImprovements.map(t=>'<li style="margin:.25rem 0"><b>+'+t.gain+' pts</b> — '+esc(t.how)+'</li>').join('')+'</ul>';
    }
    if((se.sourceLimited||[]).length){
      h+='<p class="hint" style="margin:.5rem 0 0">Source-limited (ceiling depends on how rich the original article is): '+se.sourceLimited.map(esc).join(', ')+'. A first-attempt 90s score needs a substantial source — the engine guarantees the structural signals; thin posts legitimately land lower.</p>';
    }
    h+='</div>';
  }
  // Skills interview traceability (incl. the CEO review lens)
  if(d.interviewTrace){
    const used=d.interviewTrace.filter(l=>l.used);
    h+='<div class="card full"><h3>Skills interview traceability</h3>';
    if(!used.length){
      h+='<p class="hint" style="margin:.2rem 0 0">No interview answers were provided this run — so no lens (including the CEO review lens) steered the rewrite. Answer the interview to add traceable editorial direction; each answer is then tracked as applied / partial / not applied below.</p>';
    } else {
      h+='<p class="hint" style="margin:.2rem 0 .6rem">The context you supplied, and whether it landed in the optimized article. The CEO review lens is highlighted.</p>';
      for(const lens of used){
        const isCeo=lens.skill==='plan-ceo-review';
        h+='<div style="margin:.7rem 0;'+(isCeo?'border-left:3px solid var(--accent);padding-left:.7rem':'')+'">'+
           '<div><b>'+esc(lens.label)+'</b> <span class="skilltag">/'+esc(lens.skill)+'</span>'+(isCeo?' <span class="hint">— CEO skill</span>':'')+'</div>'+
           '<ul style="list-style:none;padding-left:0;margin:.3rem 0">'+
           lens.items.map(it=>{
             const badge=it.applied==='yes'?'<span style="color:#39d98a">✓ applied</span>':it.applied==='partial'?'<span style="color:#e0b341">◐ partial</span>':it.applied==='no'?'<span style="color:#ff6b6b">✗ not applied</span>':'<span class="hint">↪ directional</span>';
             return '<li style="margin:.4rem 0"><div class="hint">'+esc(it.q)+'</div><div>“'+esc(it.answer)+'” — '+badge+'</div><div class="hint">'+esc(it.note)+'</div></li>';
           }).join('')+
           '</ul></div>';
      }
    }
    h+='</div>';
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
  document.querySelectorAll(".copy[data-c]").forEach(b=>b.onclick=async()=>{
    const key=b.dataset.c;
    const text=(RAW&&RAW[key]!==undefined)?RAW[key]:(($("#"+key)&&$("#"+key).textContent)||"");
    await navigator.clipboard.writeText(text);
    const o=b.textContent;b.textContent="Copied ✓";setTimeout(()=>b.textContent=o,1200);
  });
}
async function copyHtml(html){
  try{
    const item=new ClipboardItem({"text/html":new Blob([html],{type:"text/html"}),"text/plain":new Blob([html.replace(/<[^>]+>/g," ")],{type:"text/plain"})});
    await navigator.clipboard.write([item]);
  }catch(e){ await navigator.clipboard.writeText(html); }
}
function bindWixCopy(){
  document.querySelectorAll("[data-cwix]").forEach(b=>b.onclick=async()=>{
    await copyHtml(mdToHtml(RAW.full||""));
    const o=b.textContent;b.textContent="Copied ✓";setTimeout(()=>b.textContent=o,1200);
  });
}
function bindSeoRecs(){
  document.querySelectorAll(".seorec").forEach(b=>b.onclick=()=>{
    const stat=$("#seostat-"+b.dataset.seo); if(!stat)return;
    if(b.dataset.act==="accept") stat.innerHTML='<span style="color:#39d98a">✓ Accepted — apply in your Wix SEO settings (title tag / meta description).</span>';
    else stat.innerHTML='<span class="hint">No changes.</span>';
  });
}
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function svgToPng(svg,filename){
  const W=820,H=460,scale=2;
  const sized=svg.replace("<svg ","<svg width='"+W+"' height='"+H+"' ");
  const url=URL.createObjectURL(new Blob([sized],{type:"image/svg+xml;charset=utf-8"}));
  const img=new Image();
  img.onload=function(){
    const cv=document.createElement("canvas");cv.width=W*scale;cv.height=H*scale;
    cv.getContext("2d").drawImage(img,0,0,W*scale,H*scale);
    URL.revokeObjectURL(url);
    cv.toBlob(function(b){ if(b) downloadBlob(b,filename); else alert("PNG export failed — use Download SVG."); },"image/png");
  };
  img.onerror=function(){ URL.revokeObjectURL(url); alert("PNG export failed — use Download SVG."); };
  img.src=url;
}
function bindFigDownloads(){
  document.querySelectorAll(".figdl").forEach(b=>b.onclick=async()=>{
    const i=+b.dataset.fig, f=FIGS[i]; if(!f)return;
    if(b.dataset.kind==="svg"){ if(f.svg) downloadBlob(new Blob([f.svg],{type:"image/svg+xml;charset=utf-8"}),"figure-"+(i+1)+".svg"); }
    else if(f.image){ try{ const bl=await (await fetch(f.image)).blob(); downloadBlob(bl,"figure-"+(i+1)+".png"); }catch(e){ alert("Download failed."); } }
    else if(f.svg){ svgToPng(f.svg,"figure-"+(i+1)+".png"); }
    const o=b.textContent;b.textContent="Saved ✓";setTimeout(()=>b.textContent=o,1200);
  });
}
function bindFigRegen(){
  document.querySelectorAll(".figregen").forEach(b=>b.onclick=async()=>{
    const i=+b.dataset.fig, f=FIGS[i]; if(!f)return;
    const o=b.textContent; b.textContent="Generating…"; b.disabled=true;
    try{
      const r=await fetch("/api/regenerate-image",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:f.prompt,kind:f.kind||"image"})});
      const d=await r.json();
      if(!r.ok||!d.image) throw new Error(d.error||"failed");
      f.image=d.image;
      const vis=$("#figvis-"+i); if(vis) vis.innerHTML='<img src="'+d.image+'" alt="'+esc(f.alt||"")+'" style="width:100%;height:auto;border-radius:14px">';
    }catch(e){ alert("Could not re-generate image: "+e.message); }
    finally{ b.textContent=o; b.disabled=false; }
  });
}
async function bootView(id){
  const bar=$(".bar"); if(bar) bar.style.display="none";
  $("#status").className="status"; $("#status").innerHTML='<span class="spinner"></span>Loading saved article…';
  try{
    const r=await fetch("/api/result/"+id); const d=await r.json();
    if(!r.ok||d.error) throw new Error(d.error||"Not found");
    $("#status").innerHTML="";
    $("#out").innerHTML='<div class="step">Saved optimized article</div>'+renderResult(d);
    bindCopies(); bindFigDownloads(); bindFigRegen(); bindWixCopy(); bindSeoRecs();
  }catch(e){ $("#status").className="status err"; $("#status").textContent="Could not load saved article: "+e.message; }
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
    if (!res.headersSent) res.status(504).json({ error: "Analyze timed out (>150s). Try again or check the URL." });
  }, 150_000);
  try {
    const a = await analyze(url);
    // #3: draft suggested interview answers now, so the interview renders pre-filled.
    let suggestions: Record<string, string> = {};
    try {
      suggestions = await suggestInterviewAnswers(url, createProvider());
    } catch {
      /* non-fatal — interview just renders with empty (placeholder) fields */
    }
    clearTimeout(timeout);
    if (!res.headersSent) res.json({ ...a, lenses: INTERVIEW_LENSES, provider: providerLabel(), suggestions });
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
    if (!res.headersSent) res.status(504).json({ error: "Optimization timed out (>5min). Try again." });
  }, 300_000);
  try {
    const result = await optimize(url, createProvider(), { answers });
    clearTimeout(timeout);
    // Store a lightweight copy: strip heavy base64 images (keep the SVG fallback +
    // prompt) so the durable store stays small; the live response keeps the images.
    const imgs = result.content?.imageSuggestions;
    const stored = imgs
      ? { ...result, content: { ...result.content, imageSuggestions: imgs.map((s) => ({ ...s, image: undefined })) } }
      : result;
    await saveResult(url, stored); // repository (overwrites the prior version of this URL)
    if (!res.headersSent) res.json({ ...result, savedUrl: "/r/" + resultIdFor(url) });
  } catch (err) {
    clearTimeout(timeout);
    const raw = err instanceof Error ? err.message : String(err);
    // Demo safety net: on quota/credit/transient failure, serve the last good result.
    if (/429|quota|rate.?limit|resource.?exhausted|overloaded|529|credit balance|billing|all gemini models failed/i.test(raw)) {
      const cached = (await loadResultByUrl(url)) as Record<string, unknown> | null;
      if (cached) {
        if (!res.headersSent) res.json({ ...cached, servedFromCache: true, savedUrl: "/r/" + resultIdFor(url) });
        return;
      }
    }
    if (!res.headersSent) res.status(500).json({ error: quotaMessage(raw) });
  }
});

// #3 — pre-fill the skills interview with AI-suggested answers (one LLM call).
app.post("/api/suggest", async (req, res) => {
  const url = (req.body?.url ?? "").toString().trim();
  if (badUrl(url)) {
    res.status(400).json({ error: "Provide a valid http(s) URL." });
    return;
  }
  try {
    const suggestions = await suggestInterviewAnswers(url, createProvider());
    res.json({ suggestions });
  } catch {
    res.json({ suggestions: {} }); // non-fatal — interview just stays blank
  }
});

// #2 — re-generate a single figure image on demand (Re-generate button).
app.post("/api/regenerate-image", async (req, res) => {
  const prompt = (req.body?.prompt ?? "").toString().trim();
  const kind = (req.body?.kind ?? "image").toString();
  if (!prompt) {
    res.status(400).json({ error: "missing prompt" });
    return;
  }
  try {
    const image = await generateImage(prompt, kind);
    if (!image) {
      res.status(503).json({ error: "Image generation isn't enabled — set IMAGE_API + the provider key." });
      return;
    }
    res.json({ image });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// #7 — house-style learnings (view / add / clear).
app.get("/api/learnings", (_req, res) => res.json({ learnings: getLearnings() }));
app.post("/api/learn", (req, res) => {
  const text = (req.body?.text ?? "").toString().trim();
  res.json({ learnings: text ? addLearnings([text]) : getLearnings() });
});
app.post("/api/learn/clear", (_req, res) => {
  clearLearnings();
  res.json({ learnings: [] });
});

// #6 — article repository: fetch a stored result, view it, and the dashboard.
app.get("/api/result/:id", async (req, res) => {
  const id = req.params.id;
  if (!/^[a-f0-9]{16}$/.test(id)) {
    res.status(400).json({ error: "bad id" });
    return;
  }
  const r = await loadResultById(id);
  if (!r) {
    res.status(404).json({ error: "Not found — it may have been overwritten or the server restarted." });
    return;
  }
  res.json({ ...(r as Record<string, unknown>), savedUrl: "/r/" + id });
});
app.get("/r/:id", (_req, res) => res.type("html").send(PAGE)); // client bootstraps via /api/result/:id
app.get("/dashboard", async (_req, res) => res.type("html").send(await renderDashboard()));

async function renderDashboard(): Promise<string> {
  const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const rows = await listResults();
  const body = rows.length
    ? rows
        .map(
          (r) =>
            `<tr><td><a href="/r/${r.id}">${esc(r.title)}</a></td><td class="sc" style="color:${r.score >= 70 ? "#39d98a" : r.score >= 45 ? "#e0b341" : "#ff6b6b"}">${r.score}</td><td>${new Date(r.savedAt).toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" })}</td><td><a href="${esc(r.url)}" target="_blank" rel="noopener">source</a></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4" style="color:#9aa6bb">No optimized articles yet. Optimize one, then it appears here.</td></tr>';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GEO Optimizer — Saved Articles</title>
<style>body{background:#0b0f17;color:#e8ebf0;font-family:system-ui,Segoe UI,Arial;max-width:1000px;margin:0 auto;padding:2rem}
a{color:#4f8cff;text-decoration:none}a:hover{text-decoration:underline}h1{font-size:1.5rem}
table{width:100%;border-collapse:collapse;margin-top:1rem}th,td{text-align:left;padding:.6rem .5rem;border-bottom:1px solid #1c2433}
th{color:#9aa6bb;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}.sc{font-weight:700}</style></head>
<body><h1>Saved GEO-optimized articles</h1><p style="color:#9aa6bb">Latest version of each article (re-optimizing overwrites the older one). <a href="/">← Back to optimizer</a></p>
<table><thead><tr><th>Title</th><th>Score</th><th>Saved</th><th>Original</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}

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
app.listen(PORT, () =>
  console.log(
    `GEO/SEO optimizer UI on http://localhost:${PORT} — repository: ${repoIsDurable() ? "DURABLE (Upstash)" : "ephemeral file cache (set UPSTASH_REDIS_REST_URL/_TOKEN to persist)"}`,
  ),
);
