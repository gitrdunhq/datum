"""workflow-dashboard.py — Real-time web dashboard for datum TDD workflows.

Serves a single-page dashboard on port 10001 that shows inflight workflow
progress by scanning Claude Code's workflow state files.

Usage:
    python scripts/workflow-dashboard.py [--port 10001]
"""

from __future__ import annotations

import json
import os
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"
PORT = int(os.environ.get("DASHBOARD_PORT", "10001"))


def find_workflow_runs() -> list[dict]:
    """Scan all Claude project dirs for workflow state files."""
    runs = []
    if not CLAUDE_PROJECTS.exists():
        return runs
    for project in CLAUDE_PROJECTS.iterdir():
        if not project.is_dir():
            continue
        for session in project.iterdir():
            wf_base = session / "workflows"
            if not wf_base.exists():
                continue
            for wf_file in sorted(wf_base.glob("wf_*.json"), reverse=True):
                try:
                    data = json.loads(wf_file.read_text())
                except Exception:
                    continue
                progress = data.get("workflowProgress", [])
                agents = [p for p in progress if p.get("type") == "workflow_agent"]
                active = sum(
                    1 for a in agents if a.get("state") in ("running", "queued")
                )
                done = sum(1 for a in agents if a.get("state") == "done")
                phases = [p for p in progress if p.get("type") == "workflow_phase"]
                current_phase = phases[-1]["title"] if phases else ""
                status = data.get("status", "unknown")
                run_id = data.get("runId", wf_file.stem)
                if status != "running":
                    sa_dir = session / "subagents" / "workflows"
                    for sa in sa_dir.iterdir() if sa_dir.exists() else []:
                        if sa.is_dir() and run_id in sa.name:
                            for jl in sa.glob("*.jsonl"):
                                if (time.time() - jl.stat().st_mtime) < 30:
                                    status = "running"
                                    break
                            break
                runs.append(
                    {
                        "id": run_id,
                        "path": str(wf_file),
                        "name": data.get("workflowName", "unknown"),
                        "status": status,
                        "project": project.name[:40],
                        "mtime": wf_file.stat().st_mtime,
                        "total_agents": len(agents),
                        "active": active,
                        "done": done,
                        "phase": current_phase,
                        "tokens": data.get("totalTokens", 0),
                        "duration_ms": data.get("durationMs", 0),
                        "model": data.get("defaultModel", ""),
                    }
                )
    runs.sort(key=lambda r: r["mtime"], reverse=True)
    return runs[:30]


def _parse_agent_tokens(transcript_dir: Path, agent_id: str) -> dict:
    """Parse JSONL transcript to extract per-agent token breakdown."""
    jsonl = transcript_dir / f"agent-{agent_id}.jsonl"
    if not jsonl.exists():
        return {}
    input_t = output_t = cache_read = cache_create = 0
    model = ""
    try:
        with open(jsonl) as fh:
            for line in fh:
                msg = json.loads(line).get("message", {})
                if msg.get("role") != "assistant":
                    continue
                if not model and "model" in msg:
                    model = msg["model"]
                u = msg.get("usage", {})
                input_t += u.get("input_tokens", 0)
                output_t += u.get("output_tokens", 0)
                cache_read += u.get("cache_read_input_tokens", 0)
                cache_create += u.get("cache_creation_input_tokens", 0)
    except Exception:
        return {}
    return {
        "input_tokens": input_t,
        "output_tokens": output_t,
        "cache_read": cache_read,
        "cache_create": cache_create,
        "model_full": model,
    }


def get_workflow_detail(wf_path: str) -> dict:
    """Read full workflow state for detail view."""
    try:
        data = json.loads(Path(wf_path).read_text())
    except Exception:
        return {"error": "cannot read workflow state"}

    progress = data.get("workflowProgress", [])
    phases_raw = [p for p in progress if p.get("type") == "workflow_phase"]
    agents_raw = [p for p in progress if p.get("type") == "workflow_agent"]

    # Find transcript directory (sibling: workflows/wf_xxx.json → subagents/workflows/wf_xxx/)
    wf_file = Path(wf_path)
    run_id = wf_file.stem
    transcript_dir = wf_file.parent.parent / "subagents" / "workflows" / run_id

    phases = []
    for ph in phases_raw:
        ph_agents = [a for a in agents_raw if a.get("phaseIndex") == ph.get("index")]
        agents = []
        for a in ph_agents:
            agent_id = a.get("agentId", "")
            tok_detail = (
                _parse_agent_tokens(transcript_dir, agent_id) if agent_id else {}
            )
            agents.append(
                {
                    "label": a.get("label", ""),
                    "state": a.get("state", "unknown"),
                    "model": (a.get("model") or "")
                    .replace("claude-", "")
                    .replace("-4-6", "")
                    .replace("-4-5-20251001", ""),
                    "tokens": a.get("tokens", 0),
                    "input_tokens": tok_detail.get("input_tokens", 0),
                    "output_tokens": tok_detail.get("output_tokens", 0),
                    "cache_read": tok_detail.get("cache_read", 0),
                    "cache_create": tok_detail.get("cache_create", 0),
                    "tool_calls": a.get("toolCalls", 0),
                    "duration_s": round((a.get("durationMs") or 0) / 1000, 1),
                    "last_tool": a.get("lastToolName", ""),
                    "last_summary": (a.get("lastToolSummary") or "")[:80],
                    "prompt_preview": (a.get("promptPreview") or "")[:200],
                    "result_preview": (a.get("resultPreview") or "")[:200],
                    "attempt": a.get("attempt", 1),
                }
            )
        phases.append(
            {
                "title": ph.get("title", ""),
                "index": ph.get("index", 0),
                "agents": agents,
            }
        )

    return {
        "id": data.get("runId", ""),
        "name": data.get("workflowName", ""),
        "status": data.get("status", "unknown"),
        "total_agents": len(agents_raw),
        "total_tokens": data.get("totalTokens", 0),
        "total_tool_calls": data.get("totalToolCalls", 0),
        "duration_ms": data.get("durationMs", 0),
        "model": data.get("defaultModel", ""),
        "logs": data.get("logs", []),
        "phases": phases,
        "summary": data.get("summary", ""),
    }


def get_metrics() -> dict:
    """Aggregate metrics across all workflow runs."""
    runs = []
    if not CLAUDE_PROJECTS.exists():
        return {}
    for project in CLAUDE_PROJECTS.iterdir():
        if not project.is_dir():
            continue
        for session in project.iterdir():
            wf_base = session / "workflows"
            if not wf_base.exists():
                continue
            for wf_file in wf_base.glob("wf_*.json"):
                try:
                    runs.append(json.loads(wf_file.read_text()))
                except Exception:
                    continue

    if not runs:
        return {"total_runs": 0}

    model_stats: dict[str, dict] = {}
    phase_stats: dict[str, dict] = {}
    agent_tokens: list[int] = []
    agent_durations: list[float] = []
    retries = 0
    total_agents = 0
    total_tokens = 0
    total_duration = 0
    status_counts: dict[str, int] = {}

    for run in runs:
        status = run.get("status", "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
        total_tokens += run.get("totalTokens", 0)
        total_duration += run.get("durationMs", 0)

        for entry in run.get("workflowProgress", []):
            if entry.get("type") != "workflow_agent":
                continue
            total_agents += 1
            model = (entry.get("model") or "unknown").replace("claude-", "")
            tokens = entry.get("tokens", 0)
            dur = entry.get("durationMs", 0)
            attempt = entry.get("attempt", 1)
            state = entry.get("state", "unknown")
            phase = entry.get("phaseTitle", "unknown")

            if tokens > 0:
                agent_tokens.append(tokens)
            if dur > 0:
                agent_durations.append(dur / 1000)
            if attempt > 1:
                retries += 1

            if model not in model_stats:
                model_stats[model] = {
                    "agents": 0,
                    "tokens": 0,
                    "duration_ms": 0,
                    "successes": 0,
                    "failures": 0,
                    "retries": 0,
                }
            model_stats[model]["agents"] += 1
            model_stats[model]["tokens"] += tokens
            model_stats[model]["duration_ms"] += dur
            if state == "done":
                model_stats[model]["successes"] += 1
            elif state in ("error", "failed"):
                model_stats[model]["failures"] += 1
            if attempt > 1:
                model_stats[model]["retries"] += 1

            if phase not in phase_stats:
                phase_stats[phase] = {
                    "agents": 0,
                    "tokens": 0,
                    "duration_ms": 0,
                    "retries": 0,
                }
            phase_stats[phase]["agents"] += 1
            phase_stats[phase]["tokens"] += tokens
            phase_stats[phase]["duration_ms"] += dur
            if attempt > 1:
                phase_stats[phase]["retries"] += 1

    models = []
    for name, s in sorted(model_stats.items(), key=lambda x: -x[1]["tokens"]):
        total = s["successes"] + s["failures"]
        models.append(
            {
                "model": name,
                "agents": s["agents"],
                "tokens": s["tokens"],
                "duration_ms": s["duration_ms"],
                "avg_tokens": round(s["tokens"] / s["agents"]) if s["agents"] else 0,
                "avg_duration_s": (
                    round(s["duration_ms"] / s["agents"] / 1000, 1)
                    if s["agents"]
                    else 0
                ),
                "success_rate": round(s["successes"] / total * 100) if total else 0,
                "retries": s["retries"],
            }
        )

    phases_out = []
    for name, s in sorted(phase_stats.items(), key=lambda x: -x[1]["tokens"]):
        phases_out.append(
            {
                "phase": name,
                "agents": s["agents"],
                "tokens": s["tokens"],
                "avg_tokens": round(s["tokens"] / s["agents"]) if s["agents"] else 0,
                "retries": s["retries"],
                "retry_rate": (
                    round(s["retries"] / s["agents"] * 100, 1) if s["agents"] else 0
                ),
            }
        )

    sorted_tokens = sorted(agent_tokens)
    median_tokens = sorted_tokens[len(sorted_tokens) // 2] if sorted_tokens else 0
    sorted_dur = sorted(agent_durations)
    median_dur = sorted_dur[len(sorted_dur) // 2] if sorted_dur else 0

    return {
        "total_runs": len(runs),
        "status_counts": status_counts,
        "total_agents": total_agents,
        "total_tokens": total_tokens,
        "total_duration_ms": total_duration,
        "total_retries": retries,
        "retry_rate": round(retries / total_agents * 100, 1) if total_agents else 0,
        "median_tokens": median_tokens,
        "median_duration_s": round(median_dur, 1),
        "models": models,
        "phases": phases_out,
        "token_distribution": sorted_tokens[:500],
        "duration_distribution": [round(d, 1) for d in sorted_dur[:500]],
    }


DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>datum workflows</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  darkMode: 'class',
  theme: { extend: {
    colors: {
      bg: '#0d1117', 'bg-card': '#161b22', 'bg-hover': '#1c2128',
      'bg-phase': '#0d1117', 'bg-expand': '#1c2128', bdr: '#30363d',
      dim: '#8b949e', bright: '#e6edf3', accent: '#58a6ff',
      ok: '#3fb950', warn: '#d29922', err: '#f85149',
    },
    fontFamily: {
      mono: ["'SF Mono'","'Cascadia Code'","'JetBrains Mono'","monospace"],
      sans: ["'Inter'","-apple-system","system-ui","sans-serif"],
    },
  }},
}
</script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3/dist/chartjs-plugin-annotation.min.js"></script>
<style>
.ax{display:grid;grid-template-rows:0fr;transition:grid-template-rows .25s cubic-bezier(.4,0,.2,1)}
.ax[data-open]{grid-template-rows:1fr}
.ax>.ad{overflow:hidden;padding:0 .75rem;transition:padding .25s}
.ax[data-open]>.ad{padding:.6rem .75rem}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{display:inline-block;width:8px;height:8px;border:2px solid #3fb950;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
[data-ps="running"] .pd{animation:pulse 1.5s infinite}
</style>
</head>
<body class="font-sans bg-bg text-[#c9d1d9] leading-normal min-h-dvh">
<div class="max-w-[1400px] mx-auto p-6 grid grid-cols-[320px_1fr] max-[900px]:grid-cols-1 gap-6 min-h-dvh">

  <header class="col-span-full flex items-baseline gap-4 flex-wrap">
    <h1 class="font-mono text-lg font-semibold text-bright">datum workflows</h1>
    <div class="flex gap-1" id="tabs"></div>
    <span class="text-xs text-dim font-mono ml-auto" id="clock"></span>
  </header>

  <div class="flex flex-col gap-2 overflow-y-auto max-h-[calc(100dvh-5rem)]" id="sidebar-panel">
    <div class="flex gap-1 mb-2 flex-wrap" id="filters"></div>
    <div id="runs"></div>
  </div>

  <div class="overflow-y-auto max-h-[calc(100dvh-5rem)]" id="detail">
    <div class="text-center p-12 text-dim font-mono text-sm">Select a workflow run</div>
  </div>

  <div class="col-span-full grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4 content-start" id="metrics-page" hidden></div>
</div>

<script>
let selectedPath = null, activeFilter = 'all', allRuns = [];
const expanded = new Set();
let lastHash = '', tokenChart = null;

async function F(u){const r=await fetch(u);return r.ok?r.json():null}
function E(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function ago(ts){const s=Math.floor(Date.now()/1000-ts);return s<60?s+'s':s<3600?Math.floor(s/60)+'m':s<86400?Math.floor(s/3600)+'h':Math.floor(s/86400)+'d'}
function dur(ms){if(!ms)return'-';const s=Math.round(ms/1000);return s<60?s+'s':Math.floor(s/60)+'m '+s%60+'s'}
function tok(n){if(!n)return'-';return n>1e6?(n/1e6).toFixed(1)+'M':n>1e3?Math.round(n/1e3)+'K':''+n}

function badge(st){
  const m={running:'bg-ok/15 text-ok',completed:'bg-ok/15 text-ok',failed:'bg-err/15 text-err',queued:'bg-warn/15 text-warn'};
  return `<span class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[0.6rem] font-semibold uppercase tracking-wider ${m[st]||'bg-dim/10 text-dim'}">${st}</span>`;
}

function switchTab(t){
  document.querySelectorAll('#tabs button').forEach((b,i)=>{
    const a=(t==='runs'&&i===0)||(t==='metrics'&&i===1);
    b.className='font-mono text-xs px-3 py-1 rounded border cursor-pointer transition-all font-semibold '+(a?'border-accent bg-accent/15 text-accent':'border-bdr text-dim hover:border-accent hover:text-bright');
  });
  document.getElementById('sidebar-panel').hidden=t!=='runs';
  document.getElementById('detail').hidden=t!=='runs';
  document.getElementById('metrics-page').hidden=t!=='metrics';
  if(t==='metrics')loadMetrics();
}

function setFilter(f){activeFilter=f;renderSidebar()}
function toggleAgent(id){expanded.has(id)?expanded.delete(id):expanded.add(id);const el=document.getElementById('ax-'+id);if(el)el.toggleAttribute('data-open')}

async function renderSidebar(){
  allRuns=await F('/api/runs')||[];
  if(!allRuns.length){document.getElementById('runs').innerHTML='<div class="text-center p-8 text-dim font-mono text-sm">No workflows found</div>';return}

  const ct={all:allRuns.length,running:0,completed:0,failed:0};
  allRuns.forEach(r=>{if(ct[r.status]!==undefined)ct[r.status]++});

  document.getElementById('tabs').innerHTML=
    `<button class="font-mono text-xs px-3 py-1 rounded border border-accent bg-accent/15 text-accent cursor-pointer transition-all font-semibold" onclick="switchTab('runs')">Runs</button>`+
    `<button class="font-mono text-xs px-3 py-1 rounded border border-bdr text-dim cursor-pointer transition-all font-semibold hover:border-accent hover:text-bright" onclick="switchTab('metrics')">Metrics</button>`;

  document.getElementById('filters').innerHTML=['all','running','failed','completed'].map(f=>{
    const a=activeFilter===f;
    return `<button class="font-mono text-[0.65rem] px-2.5 py-1 rounded-full border cursor-pointer transition-all uppercase tracking-wider font-semibold ${a?'border-accent bg-accent/15 text-accent':'border-bdr text-dim hover:border-accent hover:text-bright'}" onclick="setFilter('${f}')">${f} <span class="opacity-60 ml-0.5">${ct[f]}</span></button>`;
  }).join('');

  document.getElementById('runs').innerHTML=allRuns.map(r=>{
    const sel=selectedPath===r.path;
    const hide=activeFilter!=='all'&&r.status!==activeFilter;
    return `<div class="bg-bg-card border rounded-lg px-4 py-3 cursor-pointer transition-colors ${sel?'border-accent bg-bg-hover':'border-bdr hover:border-accent hover:bg-bg-hover'}" data-path="${E(r.path)}" data-status="${r.status}" onclick="selectRun(this)" ${hide?'hidden':''}>
      <div class="font-mono text-sm text-bright font-medium">${E(r.name)} ${badge(r.status)}</div>
      <div class="text-[0.65rem] text-dim font-mono mt-0.5">${E(r.id)}</div>
      <div class="flex gap-3 mt-1.5 text-[0.7rem] font-mono text-dim">
        <span>${r.done}/${r.total_agents}</span><span>${tok(r.tokens)}</span><span>${ago(r.mtime)}</span>
      </div>
    </div>`;
  }).join('');

  if(selectedPath)loadDetail(selectedPath);
  else if(allRuns.length){const f=document.querySelector('[data-path]:not([hidden])');if(f)selectRun(f)}
}

function selectRun(el){selectedPath=el.dataset.path;renderSidebar();loadDetail(selectedPath)}

async function loadDetail(path){
  const d=await F('/api/detail?path='+encodeURIComponent(path));
  if(!d||d.error){document.getElementById('detail').innerHTML='<div class="text-center p-8 text-dim font-mono">Cannot load</div>';return}

  const aa=d.phases.flatMap(p=>p.agents);
  const pct=aa.length?Math.round(aa.filter(a=>a.state==='done').length/aa.length*100):0;
  const h=`${d.status}:${d.total_agents}:${d.total_tokens}:${d.total_tool_calls}`;
  if(h===lastHash&&d.status!=='running')return;
  lastHash=h;

  let html=`<div class="flex gap-6 px-4 py-3 bg-bg-card border border-bdr rounded-lg font-mono text-sm mb-4 flex-wrap">
    <dl><dt class="text-dim text-[0.6rem] uppercase tracking-widest">Status</dt><dd class="text-bright font-semibold text-base">${badge(d.status)}</dd></dl>
    <dl><dt class="text-dim text-[0.6rem] uppercase tracking-widest">Agents</dt><dd class="text-bright font-semibold text-base">${d.total_agents}</dd></dl>
    <dl><dt class="text-dim text-[0.6rem] uppercase tracking-widest">Tokens</dt><dd class="text-bright font-semibold text-base">${tok(d.total_tokens)}</dd></dl>
    <dl><dt class="text-dim text-[0.6rem] uppercase tracking-widest">Tools</dt><dd class="text-bright font-semibold text-base">${d.total_tool_calls}</dd></dl>
    <dl><dt class="text-dim text-[0.6rem] uppercase tracking-widest">Duration</dt><dd class="text-bright font-semibold text-base">${dur(d.duration_ms)}</dd></dl>
    <dl><dt class="text-dim text-[0.6rem] uppercase tracking-widest">Progress</dt><dd class="text-bright font-semibold text-base">${pct}%</dd></dl>
  </div>`;

  let ai=0;
  for(const ph of d.phases){
    const pd=ph.agents.filter(a=>a.state==='done').length;
    const pa=ph.agents.filter(a=>a.state==='running').length;
    const ps=pa>0?'running':pd===ph.agents.length&&ph.agents.length>0?'completed':'pending';
    const dotClr=ps==='running'?'bg-ok':ps==='completed'?'bg-ok':'bg-bdr';

    html+=`<div class="mb-4" data-ps="${ps}">
      <div class="flex items-center gap-2 px-3 py-2 bg-bg-phase rounded mb-1.5 font-mono text-sm font-semibold text-accent">
        <span class="w-2 h-2 rounded-full pd ${dotClr}"></span> ${E(ph.title)} <span class="text-xs text-dim font-normal ml-auto">${pd}/${ph.agents.length}</span>
      </div>`;

    for(const a of ph.agents){
      const id=ai++;
      const isOpen=expanded.has(id);
      const bl=a.state==='running'?'border-l-ok':a.state==='queued'?'border-l-warn':'border-l-bdr';
      const act=a.state==='running'?(a.last_tool?a.last_tool+': '+a.last_summary:'working...'):a.state==='done'?(a.result_preview||'done').slice(0,80):a.prompt_preview.slice(0,80);

      html+=`<div class="grid grid-cols-[2fr_80px_110px_60px_3fr] gap-2 items-center px-3 py-2 border-l-[3px] ${bl} ml-2 text-xs font-mono cursor-pointer transition-colors hover:border-l-accent hover:bg-bg-hover" onclick="toggleAgent(${id})">
        <div class="text-bright font-medium">${a.state==='running'?'<span class="spinner"></span> ':''}${E(a.label)}${a.attempt>1?' <span class="text-dim">x'+a.attempt+'</span>':''}</div>
        <div class="text-dim text-[0.65rem]">${E(a.model)}</div>
        <div class="text-dim text-right text-[0.7rem]">${a.input_tokens?tok(a.input_tokens)+'→'+tok(a.output_tokens):tok(a.tokens)}</div>
        <div class="text-dim text-right text-[0.7rem]">${a.duration_s?a.duration_s+'s':'-'}</div>
        <div class="text-dim text-[0.68rem] overflow-hidden text-ellipsis whitespace-nowrap" title="${E(act)}">${E(act)}</div>
      </div>
      <div class="ax ml-2" id="ax-${id}" ${isOpen?'data-open':''}>
        <div class="ad bg-bg-expand border-l-[3px] border-l-accent font-mono text-[0.7rem]">
          <div class="flex gap-4 flex-wrap mb-2">
            <span class="text-dim">Model: <strong class="text-bright font-medium">${E(a.model)}</strong></span>
            <span class="text-dim">In: <strong class="text-bright font-medium">${tok(a.input_tokens)}</strong></span>
            <span class="text-dim">Out: <strong class="text-bright font-medium">${tok(a.output_tokens)}</strong></span>
            <span class="text-dim">Cache: <strong class="text-bright font-medium">${tok(a.cache_read)}</strong>r / <strong class="text-bright font-medium">${tok(a.cache_create)}</strong>w</span>
            <span class="text-dim">Total: <strong class="text-bright font-medium">${tok(a.tokens)}</strong></span>
            <span class="text-dim">Tools: <strong class="text-bright font-medium">${a.tool_calls}</strong></span>
            <span class="text-dim">Duration: <strong class="text-bright font-medium">${a.duration_s}s</strong></span>
            ${a.attempt>1?'<span class="text-dim">Attempt: <strong class="text-bright font-medium">'+a.attempt+'</strong></span>':''}
          </div>
          ${a.prompt_preview?'<div class="mb-2"><div class="text-accent text-[0.6rem] uppercase tracking-wide mb-0.5">Prompt</div><div class="text-dim whitespace-pre-wrap break-words leading-relaxed max-h-[150px] overflow-y-auto">'+E(a.prompt_preview)+'</div></div>':''}
          ${a.last_summary?'<div class="mb-2"><div class="text-accent text-[0.6rem] uppercase tracking-wide mb-0.5">Activity</div><div class="text-dim">'+E(a.last_summary)+'</div></div>':''}
          ${a.result_preview?'<div class="mb-2"><div class="text-accent text-[0.6rem] uppercase tracking-wide mb-0.5">Result</div><div class="text-dim whitespace-pre-wrap break-words leading-relaxed max-h-[150px] overflow-y-auto">'+E(a.result_preview)+'</div></div>':''}
        </div>
      </div>`;
    }
    html+='</div>';
  }

  if(d.logs&&d.logs.length){
    html+=`<div class="mt-4 p-3 bg-bg-card border border-bdr rounded-lg font-mono text-[0.7rem] text-dim max-h-[200px] overflow-y-auto">${d.logs.map(l=>'<div class="py-0.5 border-b border-bdr/30 last:border-b-0">'+E(l)+'</div>').join('')}</div>`;
  }

  const el=document.getElementById('detail');
  const st=el.scrollTop;
  el.innerHTML=html;
  el.scrollTop=st;
}

function renderTokenChart(canvasId,values){
  const canvas=document.getElementById(canvasId);
  if(!canvas||!values.length)return;
  if(tokenChart){tokenChart.destroy();tokenChart=null}

  const sorted=[...values].sort((a,b)=>a-b);
  const median=sorted[Math.floor(sorted.length/2)];
  const mean=sorted.reduce((s,v)=>s+v,0)/sorted.length;
  const min=sorted[0],max=sorted[sorted.length-1],range=max-min||1;
  const bins=30,bw=range/bins;
  const counts=new Array(bins).fill(0);
  const labels=[];
  for(let i=0;i<bins;i++)labels.push(tok(Math.round(min+i*bw)));
  for(const v of sorted){const b=Math.min(Math.floor((v-min)/range*bins),bins-1);counts[b]++}

  const kdeBw=range/10,kde=[];
  for(let i=0;i<bins;i++){
    const val=min+(i+0.5)*bw;let d=0;
    for(const v of sorted){const z=(val-v)/kdeBw;d+=Math.exp(-0.5*z*z)}
    kde.push(d/(sorted.length*kdeBw*2.507));
  }
  const mx=Math.max(...counts),md=Math.max(...kde);
  const kdeScaled=kde.map(d=>md>0?(d/md)*mx:0);

  tokenChart=new Chart(canvas,{
    type:'bar',
    data:{labels,datasets:[
      {label:'Count',data:counts,backgroundColor:'rgba(88,166,255,0.25)',borderColor:'rgba(88,166,255,0.4)',borderWidth:1,barPercentage:1,categoryPercentage:1,order:2},
      {label:'Density',data:kdeScaled,type:'line',borderColor:'#58a6ff',borderWidth:2,pointRadius:0,fill:false,tension:0.4,order:1},
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      scales:{
        x:{grid:{display:false},ticks:{color:'#8b949e',font:{family:"'SF Mono',monospace",size:10},maxTicksLimit:6},border:{color:'#30363d'}},
        y:{grid:{color:'rgba(48,54,61,0.3)'},ticks:{color:'#8b949e',font:{family:"'SF Mono',monospace",size:10}},border:{color:'#30363d'}},
      },
      plugins:{
        legend:{display:false},
        tooltip:{backgroundColor:'#161b22',borderColor:'#30363d',borderWidth:1,titleFont:{family:"'SF Mono',monospace"},bodyFont:{family:"'SF Mono',monospace"}},
        annotation:{annotations:{
          med:{type:'line',xMin:(median-min)/bw,xMax:(median-min)/bw,borderColor:'#3fb950',borderWidth:2,borderDash:[4,3],
            label:{display:true,content:'Median: '+tok(median),position:'start',backgroundColor:'rgba(63,185,80,0.15)',color:'#3fb950',font:{family:"'SF Mono',monospace",size:10}}},
          avg:{type:'line',xMin:(mean-min)/bw,xMax:(mean-min)/bw,borderColor:'#d29922',borderWidth:1,borderDash:[2,2],
            label:{display:true,content:'Mean: '+tok(Math.round(mean)),position:'end',backgroundColor:'rgba(210,153,34,0.15)',color:'#d29922',font:{family:"'SF Mono',monospace",size:10}}},
        }},
      },
    },
  });
}

async function loadMetrics(){
  const m=await F('/api/metrics');
  if(!m||!m.total_runs){document.getElementById('metrics-page').innerHTML='<div class="text-center p-12 text-dim font-mono">No data</div>';return}

  let html=`
    <div class="bg-bg-card border border-bdr rounded-lg p-5">
      <h3 class="font-mono text-sm text-accent mb-3 font-semibold">Runs</h3>
      <div class="font-mono text-3xl font-bold text-bright">${m.total_runs}</div>
      <div class="font-mono text-xs text-dim mt-1">${Object.entries(m.status_counts).map(([k,v])=>v+' '+k).join(' / ')}</div>
    </div>
    <div class="bg-bg-card border border-bdr rounded-lg p-5">
      <h3 class="font-mono text-sm text-accent mb-3 font-semibold">Agents</h3>
      <div class="font-mono text-3xl font-bold text-bright">${m.total_agents.toLocaleString()}</div>
      <div class="font-mono text-xs text-dim mt-1">${m.total_retries} retries (${m.retry_rate}%)</div>
    </div>
    <div class="bg-bg-card border border-bdr rounded-lg p-5">
      <h3 class="font-mono text-sm text-accent mb-3 font-semibold">Tokens</h3>
      <div class="font-mono text-3xl font-bold text-bright">${tok(m.total_tokens)}</div>
      <div class="font-mono text-xs text-dim mt-1">median ${tok(m.median_tokens)}/agent</div>
    </div>
    <div class="bg-bg-card border border-bdr rounded-lg p-5">
      <h3 class="font-mono text-sm text-accent mb-3 font-semibold">Duration</h3>
      <div class="font-mono text-3xl font-bold text-bright">${dur(m.total_duration_ms)}</div>
      <div class="font-mono text-xs text-dim mt-1">median ${m.median_duration_s}s/agent</div>
    </div>

    <div class="bg-bg-card border border-bdr rounded-lg p-5 col-span-full">
      <h3 class="font-mono text-sm text-accent mb-3 font-semibold">Model Performance</h3>
      <table class="w-full border-collapse font-mono text-xs">
        <tr>
          <th class="text-left text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Model</th>
          <th class="text-right text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Agents</th>
          <th class="text-right text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Tokens</th>
          <th class="text-right text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Avg Tok</th>
          <th class="text-right text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Avg Time</th>
          <th class="text-right text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Success</th>
          <th class="text-right text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Retries</th>
        </tr>
        ${m.models.map(mod=>`<tr>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-bright font-medium">${E(mod.model)}</td>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-right tabular-nums">${mod.agents}</td>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-right tabular-nums">${tok(mod.tokens)}</td>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-right tabular-nums">${tok(mod.avg_tokens)}</td>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-right tabular-nums">${mod.avg_duration_s}s</td>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-right tabular-nums">${mod.success_rate}%</td>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-right tabular-nums">${mod.retries}</td>
        </tr>`).join('')}
      </table>
    </div>

    <div class="bg-bg-card border border-bdr rounded-lg p-5 col-span-full">
      <h3 class="font-mono text-sm text-accent mb-3 font-semibold">Phase Breakdown</h3>
      <table class="w-full border-collapse font-mono text-xs">
        <tr>
          <th class="text-left text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Phase</th>
          <th class="text-right text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Agents</th>
          <th class="text-right text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Tokens</th>
          <th class="text-right text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Avg Tok</th>
          <th class="text-right text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Retries</th>
          <th class="text-right text-dim text-[0.6rem] uppercase tracking-wide px-2 py-1.5 border-b border-bdr font-semibold">Retry %</th>
        </tr>
        ${m.phases.map(ph=>`<tr>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-bright font-medium">${E(ph.phase)}</td>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-right tabular-nums">${ph.agents}</td>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-right tabular-nums">${tok(ph.tokens)}</td>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-right tabular-nums">${tok(ph.avg_tokens)}</td>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-right tabular-nums">${ph.retries}</td>
          <td class="px-2 py-1.5 border-b border-bdr/40 text-right tabular-nums">${ph.retry_rate}%</td>
        </tr>`).join('')}
      </table>
    </div>

    <div class="bg-bg-card border border-bdr rounded-lg p-5 col-span-full">
      <h3 class="font-mono text-sm text-accent mb-3 font-semibold">Token Distribution (per agent)</h3>
      <div class="h-44"><canvas id="bell-tokens"></canvas></div>
      <div class="flex gap-4 mt-2 font-mono text-[0.6rem] text-dim">
        <span><span class="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle bg-accent/30"></span>histogram</span>
        <span><span class="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle bg-ok"></span>median</span>
        <span><span class="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle bg-warn"></span>mean</span>
      </div>
    </div>
  `;
  document.getElementById('metrics-page').innerHTML=html;
  if(m.token_distribution&&m.token_distribution.length>2)renderTokenChart('bell-tokens',m.token_distribution);
}

function tick(){document.getElementById('clock').textContent=new Date().toLocaleTimeString()}
setInterval(tick,1000);
setInterval(renderSidebar,2000);
tick();renderSidebar();
</script>
</body>
</html>"""


class DashboardHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            self._send_html(DASHBOARD_HTML)
        elif parsed.path == "/api/runs":
            self._send_json(find_workflow_runs())
        elif parsed.path == "/api/detail":
            qs = parse_qs(parsed.query)
            path = qs.get("path", [""])[0]
            if path:
                self._send_json(get_workflow_detail(path))
            else:
                self._send_json({"error": "missing path"})
        elif parsed.path == "/api/metrics":
            self._send_json(get_metrics())
        else:
            self.send_error(404)

    def _send_json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html):
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *a):
        pass


if __name__ == "__main__":
    import sys

    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    server = HTTPServer(("0.0.0.0", port), DashboardHandler)
    print(f"datum workflow dashboard → http://0.0.0.0:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutdown")
