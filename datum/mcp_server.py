import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from mcp.server.fastmcp import FastMCP
import uvicorn
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

class APIKeyAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, api_key: str):
        super().__init__(app)
        self.api_key = api_key

    async def dispatch(self, request, call_next):
        auth_header = request.headers.get("Authorization")
        if not auth_header or auth_header != f"Bearer {self.api_key}":
            return JSONResponse({"error": "Unauthorized", "message": "Invalid or missing API Key"}, status_code=401)
        return await call_next(request)

from datum.state import load_state, save_state, PHASES

# Initialize FastMCP server
mcp = FastMCP("datum")

# -----------------------------------------------------------------------------
# Resources (The Context Layer)
# -----------------------------------------------------------------------------

@mcp.resource("datum://state/current")
def get_current_state() -> str:
    """Get the live DATUM pipeline state and token telemetry."""
    state = load_state()
    if not state:
        return json.dumps({"error": "No active state found."})
    return json.dumps(state, indent=2)

@mcp.resource("datum://epic/ticket")
def get_epic_ticket() -> str:
    """Get the current TICKET.md (Product Requirements)."""
    path = Path("docs/TICKET.md")
    return path.read_text() if path.exists() else "No TICKET.md found."

@mcp.resource("datum://epic/spec")
def get_epic_spec() -> str:
    """Get the current SPEC.md (Engineering Specifications)."""
    state = load_state()
    branch = state.get("git", {}).get("work_branch")
    if branch:
        path = Path(f"docs/epics/{branch}/SPEC.md")
        if path.exists():
            return path.read_text()
    
    # Fallback to wildcard search if branch is unknown or missing
    specs = list(Path("docs/epics").glob("*/SPEC.md"))
    if specs:
        return specs[0].read_text()
        
    return "No SPEC.md found."

@mcp.resource("datum://epic/properties")
def get_epic_properties() -> str:
    """Get the current PROPERTIES.md (Formal System Invariants)."""
    state = load_state()
    branch = state.get("git", {}).get("work_branch")
    if branch:
        path = Path(f"docs/epics/{branch}/PROPERTIES.md")
        if path.exists():
            return path.read_text()
            
    # Fallback to wildcard search
    props = list(Path("docs/epics").glob("*/PROPERTIES.md"))
    if props:
        return props[0].read_text()
        
    return "No PROPERTIES.md found."

@mcp.resource("datum://global/roadmap")
def get_global_roadmap() -> str:
    """Get the strategic ROADMAP.md to evaluate upcoming features and leap-risk."""
    path = Path("docs/ROADMAP.md")
    return path.read_text() if path.exists() else "No ROADMAP.md found."

@mcp.resource("datum://global/current-state")
def get_global_current_state() -> str:
    """Get CURRENT_STATE.md to instantly orient agents on what shipped, what's next, and what's in flight."""
    path = Path("CURRENT_STATE.md")
    return path.read_text() if path.exists() else "No CURRENT_STATE.md found."

# -----------------------------------------------------------------------------
# Tools (The Factory Floor)
# -----------------------------------------------------------------------------

@mcp.tool()
def datum_transition_phase(to_phase: str) -> str:
    """Transition the DATUM pipeline to a new phase.
    
    Args:
        to_phase: The name of the phase to transition to (e.g., 'plan', 'act', 'review').
    """
    state = load_state()
    if not state:
        return json.dumps({"error": "no_state", "message": "Run datum init first."})
        
    if to_phase not in PHASES:
        return json.dumps({"error": "unknown_phase", "message": f"Phase must be one of {PHASES}"})
        
    state["current_phase"] = to_phase
    save_state(state)
    return json.dumps({"ok": True, "current_phase": to_phase})

@mcp.tool()
def datum_log_telemetry(phase: str, model: str, input_tokens: int, output_tokens: int) -> str:
    """Log LLM token usage for efficiency telemetry and model tracking.
    
    Args:
        phase: The DATUM phase this work was performed in (e.g., 'act', 'review')
        model: The model identifier (e.g., 'claude-3-5-sonnet-20241022')
        input_tokens: Number of input/prompt tokens consumed
        output_tokens: Number of output/completion tokens consumed
    """
    state = load_state()
    if not state:
        return json.dumps({"error": "no_state", "message": "Cannot log tokens without active state."})
        
    if "model_log" not in state:
        state["model_log"] = []
        
    state["model_log"].append({
        "phase": phase,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    
    save_state(state)
    return json.dumps({"ok": True, "message": f"Logged {input_tokens + output_tokens} tokens for {model}"})

@mcp.tool()
def datum_update_roadmap(content: str) -> str:
    """Update the global ROADMAP.md file after slotting a new feature during Triage.
    
    Args:
        content: The complete markdown content to overwrite docs/ROADMAP.md with.
    """
    path = Path("docs/ROADMAP.md")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return json.dumps({"ok": True, "message": "ROADMAP.md successfully updated."})

def main():
    api_key = os.environ.get("DATUM_API_KEY")
    if not api_key:
        print("Starting in UNSECURE mode (no DATUM_API_KEY set)...")
        mcp.run(transport="sse", host="0.0.0.0", port=8000)
    else:
        print("Starting in SECURE mode with API Key auth on HTTP/SSE port 8000...")
        app = mcp.sse_app()
        app.add_middleware(APIKeyAuthMiddleware, api_key=api_key)
        uvicorn.run(app, host="0.0.0.0", port=8000)

if __name__ == "__main__":
    main()
