"""workflow-dashboard.py — Real-time web dashboard for datum TDD workflows.

Serves a single-page dashboard on port 10001 that shows inflight workflow
progress by scanning Claude Code's workflow transcript directories.

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


def find_workflow_dirs() -> list[dict]:
    """Scan all Claude project dirs for workflow transcript directories."""
    runs = []
    if not CLAUDE_PROJECTS.exists():
        return runs
    for project in CLAUDE_PROJECTS.iterdir():
        if not project.is_dir():
            continue
        for session in project.iterdir():
            wf_base = session / "subagents" / "workflows"
            if not wf_base.exists():
                continue
            for wf_dir in sorted(wf_base.iterdir(), reverse=True):
                if wf_dir.is_dir() and wf_dir.name.startswith("wf_"):
                    runs.append(
                        {
                            "id": wf_dir.name,
                            "path": str(wf_dir),
                            "project": project.name[:40],
                            "mtime": wf_dir.stat().st_mtime,
                        }
                    )
    runs.sort(key=lambda r: r["mtime"], reverse=True)
    return runs[:20]


def scan_workflow(wf_path: str) -> dict:
    """Read agent meta files and transcript sizes for a workflow."""
    wf = Path(wf_path)
    agents = []
    for meta_file in sorted(wf.glob("agent-*.meta.json")):
        agent_id = meta_file.stem.replace(".meta", "")
        transcript = wf / f"{agent_id}.jsonl"
        meta = {}
        try:
            meta = json.loads(meta_file.read_text())
        except Exception:
            pass

        prompt_preview = ""
        try:
            with open(transcript) as f:
                first = json.loads(f.readline())
                content = first.get("message", {}).get("content", "")
                if isinstance(content, str):
                    prompt_preview = content[:120]
        except Exception:
            pass

        t_size = transcript.stat().st_size if transcript.exists() else 0
        t_mtime = transcript.stat().st_mtime if transcript.exists() else 0
        is_active = (time.time() - t_mtime) < 30 if t_mtime else False

        agents.append(
            {
                "id": agent_id,
                "type": meta.get("agentType", "unknown"),
                "size_kb": round(t_size / 1024, 1),
                "active": is_active,
                "prompt": prompt_preview,
                "mtime": t_mtime,
            }
        )

    agents.sort(key=lambda a: a["mtime"])
    total_kb = sum(a["size_kb"] for a in agents)
    active_count = sum(1 for a in agents if a["active"])

    return {
        "id": wf.name,
        "agents": agents,
        "total_agents": len(agents),
        "active_agents": active_count,
        "total_kb": round(total_kb, 1),
    }


DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>datum workflow dashboard</title>
<style>
@layer reset, tokens, layout, components, states;

@layer reset {
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { min-height: 100dvh; }
}

@layer tokens {
  :root {
    --bg: #0a0a0f;
    --bg-card: #12121a;
    --bg-hover: #1a1a28;
    --border: #2a2a3a;
    --text: #e0e0e8;
    --text-dim: #808090;
    --text-bright: #f0f0ff;
    --accent: #6c8cff;
    --green: #4cda8c;
    --yellow: #e8c94a;
    --red: #e84a5a;
    --orange: #e89a4a;
    --font-mono: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace;
    --font-sans: 'Inter', -apple-system, system-ui, sans-serif;
    --radius: 8px;
    --radius-sm: 4px;
    --ease: cubic-bezier(0.4, 0, 0.2, 1);
  }
}

@layer layout {
  body {
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
  }

  .shell {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.5rem;
    display: grid;
    gap: 1.5rem;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
  }

  header h1 {
    font-family: var(--font-mono);
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-bright);
    letter-spacing: -0.02em;
  }

  .meta {
    font-size: 0.75rem;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }
}

@layer components {
  .runs {
    display: grid;
    gap: 0.75rem;
  }

  .run-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    cursor: pointer;
    transition: border-color 0.15s var(--ease), background 0.15s var(--ease);
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    align-items: center;
  }

  .run-card:hover { border-color: var(--accent); background: var(--bg-hover); }
  .run-card[data-selected] { border-color: var(--accent); background: var(--bg-hover); }

  .run-id {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--text-bright);
    font-weight: 500;
  }

  .run-project {
    font-size: 0.7rem;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .run-stats {
    display: flex;
    gap: 0.75rem;
    font-size: 0.75rem;
    font-family: var(--font-mono);
  }

  .stat { display: flex; align-items: center; gap: 0.25rem; }
  .stat .dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    display: inline-block;
  }

  .agent-grid {
    display: grid;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .agent-row {
    display: grid;
    grid-template-columns: 2fr 1fr 0.7fr 4fr;
    gap: 0.75rem;
    align-items: center;
    padding: 0.6rem 0.75rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.78rem;
    font-family: var(--font-mono);
    transition: border-color 0.15s var(--ease);
  }

  .agent-row:hover { border-color: var(--accent); }

  .agent-id { color: var(--text-dim); font-size: 0.7rem; }
  .agent-type { font-weight: 500; }
  .agent-size { color: var(--text-dim); text-align: right; }

  .agent-prompt {
    color: var(--text-dim);
    font-size: 0.7rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.5rem;
    border-radius: 100px;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .badge--active { background: color-mix(in srgb, var(--green) 15%, transparent); color: var(--green); }
  .badge--done { background: color-mix(in srgb, var(--text-dim) 10%, transparent); color: var(--text-dim); }
  .badge--cli { color: var(--yellow); }
  .badge--reader { color: var(--orange); }
  .badge--subagent { color: var(--accent); }

  .bar-track {
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 0.5rem;
  }

  .bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.3s var(--ease);
  }

  .totals {
    display: flex;
    gap: 1.5rem;
    padding: 0.75rem 1rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .totals dt { color: var(--text-dim); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; }
  .totals dd { color: var(--text-bright); font-weight: 600; font-size: 1.1rem; }

  .empty {
    text-align: center;
    padding: 3rem;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
}

@layer states {
  [data-active="true"] .dot { background: var(--green); animation: pulse 1.5s infinite; }
  [data-active="false"] .dot { background: var(--text-dim); }
}
</style>
</head>
<body>
<div class="shell">
  <header>
    <h1>datum workflows</h1>
    <span class="meta" id="clock"></span>
  </header>
  <div class="totals" id="totals" hidden>
    <dl><dt>Agents</dt><dd id="t-agents">0</dd></dl>
    <dl><dt>Active</dt><dd id="t-active">0</dd></dl>
    <dl><dt>Tokens (est)</dt><dd id="t-tokens">0</dd></dl>
  </dl></div>
  <div id="runs" class="runs"></div>
  <div id="detail"></div>
</div>

<script>
const API = '';
let selectedRun = null;

async function fetchJson(url) {
  const r = await fetch(url);
  return r.ok ? r.json() : null;
}

function badge(type) {
  const cls = type === 'datum-cli' ? 'cli' : type === 'datum-reader' ? 'reader' : 'subagent';
  return `<span class="badge badge--${cls}">${type.replace('workflow-','').replace('datum-','')}</span>`;
}

function statusBadge(active) {
  return active
    ? '<span class="badge badge--active">running</span>'
    : '<span class="badge badge--done">done</span>';
}

function timeAgo(ts) {
  const s = Math.floor((Date.now()/1000) - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

async function renderRuns() {
  const data = await fetchJson('/api/runs');
  if (!data || !data.length) {
    document.getElementById('runs').innerHTML = '<div class="empty">No workflows found. Run a datum-tdd-act workflow to see it here.</div>';
    return;
  }

  document.getElementById('runs').innerHTML = data.map(r => `
    <div class="run-card" data-path="${r.path}" onclick="selectRun(this)" ${selectedRun === r.path ? 'data-selected' : ''}>
      <div>
        <div class="run-id">${r.id}</div>
        <div class="run-project">${r.project}</div>
      </div>
      <div class="run-stats">
        <span class="meta">${timeAgo(r.mtime)}</span>
      </div>
    </div>
  `).join('');

  if (selectedRun) loadDetail(selectedRun);
  else if (data.length) selectRun(document.querySelector('.run-card'));
}

function selectRun(el) {
  document.querySelectorAll('.run-card').forEach(c => c.removeAttribute('data-selected'));
  el.setAttribute('data-selected', '');
  selectedRun = el.dataset.path;
  loadDetail(selectedRun);
}

async function loadDetail(path) {
  const data = await fetchJson(`/api/workflow?path=${encodeURIComponent(path)}`);
  if (!data) return;

  const tot = document.getElementById('totals');
  tot.hidden = false;
  document.getElementById('t-agents').textContent = data.total_agents;
  document.getElementById('t-active').textContent = data.active_agents;
  document.getElementById('t-tokens').textContent = `~${Math.round(data.total_kb * 2.5)}K`;

  const pct = data.total_agents ? Math.round((data.total_agents - data.active_agents) / data.total_agents * 100) : 0;

  document.getElementById('detail').innerHTML = `
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    <div class="agent-grid">
      ${data.agents.map(a => `
        <div class="agent-row" data-active="${a.active}">
          <div>
            ${badge(a.type)}
            ${statusBadge(a.active)}
          </div>
          <div class="agent-size">${a.size_kb}K</div>
          <div class="agent-id">${a.id.slice(-8)}</div>
          <div class="agent-prompt">${escHtml(a.prompt)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function tick() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString();
}

setInterval(tick, 1000);
setInterval(renderRuns, 2000);
tick();
renderRuns();
</script>
</body>
</html>"""


class DashboardHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/" or parsed.path == "/index.html":
            self._send_html(DASHBOARD_HTML)
        elif parsed.path == "/api/runs":
            self._send_json(find_workflow_dirs())
        elif parsed.path == "/api/workflow":
            qs = parse_qs(parsed.query)
            path = qs.get("path", [""])[0]
            if path:
                self._send_json(scan_workflow(path))
            else:
                self._send_json({"error": "missing path"})
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
