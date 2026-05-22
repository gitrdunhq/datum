import json
import re
import sys
from pathlib import Path

import typer
from rich.console import Console

console = Console()

mcp_app = typer.Typer(
    name="mcp",
    help="Manage MCP configuration and router syncing"
)

@mcp_app.command("sync")
def mcp_sync():
    """Sync Claude, Cursor, and Gemini configs to use the mcp-router proxy."""
    
    router_server = {
        "mcp-router": {
            "command": "npx",
            "args": ["-y", "@mcp_router/cli", "connect"]
        }
    }
    
    console.print("[bold blue]Syncing MCP configurations to 1-to-Many Proxy...[/bold blue]")
    
    # 1. Update Cursor
    cursor_mcp = Path.home() / ".cursor" / "mcp.json"
    if cursor_mcp.exists():
        try:
            data = json.loads(cursor_mcp.read_text())
            data["mcpServers"] = router_server
            cursor_mcp.write_text(json.dumps(data, indent=2))
            console.print("[green]✓ Updated Cursor config (.cursor/mcp.json)[/green]")
        except Exception as e:
            console.print(f"[red]Failed to update Cursor config: {e}[/red]")
            
    # 2. Update Claude CLI
    claude_settings = Path.home() / ".claude" / "settings.json"
    if claude_settings.exists():
        try:
            data = json.loads(claude_settings.read_text())
            data["mcpServers"] = router_server
            claude_settings.write_text(json.dumps(data, indent=2))
            console.print("[green]✓ Updated Claude CLI config (.claude/settings.json)[/green]")
        except Exception as e:
            console.print(f"[red]Failed to update Claude config: {e}[/red]")
            
    # 3. Update Claude Desktop
    claude_desktop = Path.home() / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
    if claude_desktop.exists():
        try:
            data = json.loads(claude_desktop.read_text())
            data["mcpServers"] = router_server
            claude_desktop.write_text(json.dumps(data, indent=2))
            console.print("[green]✓ Updated Claude Desktop config[/green]")
        except Exception as e:
            console.print(f"[red]Failed to update Claude Desktop config: {e}[/red]")

    # 4. Update Gemini CLI
    gemini_settings = Path.home() / ".gemini" / "settings.json"
    if gemini_settings.exists():
        try:
            data = json.loads(gemini_settings.read_text())
            data["mcpServers"] = router_server
            gemini_settings.write_text(json.dumps(data, indent=2))
            console.print("[green]✓ Updated Gemini CLI config (.gemini/settings.json)[/green]")
        except Exception as e:
            console.print(f"[red]Failed to update Gemini config: {e}[/red]")

    # 5. Update Kiro CLI
    kiro_mcp = Path.home() / ".kiro" / "settings" / "mcp.json"
    if kiro_mcp.exists():
        try:
            data = json.loads(kiro_mcp.read_text())
            data["mcpServers"] = router_server
            kiro_mcp.write_text(json.dumps(data, indent=2))
            console.print("[green]✓ Updated Kiro CLI config (.kiro/settings/mcp.json)[/green]")
        except Exception as e:
            console.print(f"[red]Failed to update Kiro config: {e}[/red]")

    # 6. Update Codex CLI (TOML)
    codex_config = Path.home() / ".codex" / "config.toml"
    if codex_config.exists():
        try:
            content = codex_config.read_text()
            # Remove all existing [mcp_servers.*] blocks
            content = re.sub(r'\[mcp_servers\..*?\]\n(?:[^\[]*\n)*', '', content)
            # Append new mcp-router config
            router_toml = '\n[mcp_servers."mcp-router"]\ncommand = "npx"\nargs = ["-y", "@mcp_router/cli", "connect"]\n'
            codex_config.write_text(content.strip() + '\n' + router_toml)
            console.print("[green]✓ Updated Codex CLI config (.codex/config.toml)[/green]")
        except Exception as e:
            console.print(f"[red]Failed to update Codex config: {e}[/red]")
            
    setup_payload = {
        "mcpServers": {
            "datum-state": {
                "type": "sse",
                "url": "http://localhost:8000/sse"
            },
            "gitnexus": {
                "command": "npx",
                "args": ["-y", "gitnexus@latest", "mcp"]
            },
            "context7": {
                "command": "npx",
                "args": ["-y", "@upstash/context7-mcp"]
            }
        }
    }
    
    console.print("\n[bold blue]Next Steps: Configure your master MCP Router[/bold blue]")
    console.print("1. Open the MCP Router Desktop App.")
    console.print("2. Navigate to your DATUM workspace.")
    console.print("3. Ensure these servers are added to your workspace:\n")
    console.print(json.dumps(setup_payload, indent=2))
    console.print("\n[bold green]Success: All background agents and tools are now routed through mcp-router![/bold green]")
