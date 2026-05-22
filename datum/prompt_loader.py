#!/usr/bin/env python3
"""
prompt_loader.py — Progressive disclosure of prompt sub-documents.
Injects context into prompts only when triggers are met, avoiding token bloat.
Supports .local.md overrides and falls back to centrally packaged importlib assets.
"""

import argparse
import sys
import re
from pathlib import Path
from importlib import resources

def resolve_resource_path(doc_path: str) -> str:
    """Resolve a relative doc_path (like 'references/02-plan.md' or 'assets/schema.md')
    by checking `.datum/` for local overrides first, then falling back to packaged assets."""
    
    local_target = Path(".datum") / doc_path
    if local_target.exists():
        return local_target.read_text()
        
    # Check if we can find it in the datum package
    try:
        if doc_path.startswith("references/"):
            resource_name = doc_path.replace("references/", "")
            return resources.files("datum.references").joinpath(resource_name).read_text()
        elif doc_path.startswith("assets/"):
            resource_name = doc_path.replace("assets/", "")
            return resources.files("datum.assets").joinpath(resource_name).read_text()
    except Exception:
        pass
        
    return None

def load_prompt_with_injection(base_file_content: str) -> str:
    def replacer(match):
        doc_path = match.group(1)
        content = resolve_resource_path(doc_path)
        if content is not None:
            return f"\n\n--- INJECTED CONTEXT: {doc_path} ---\n" + content + "\n-----------------------------------\n"
        return f"\n\n<!-- WARNING: Inject target {doc_path} not found locally or in packaged datum assets -->\n"

    # Replace <!-- inject: path/to/file.md -->
    pattern = re.compile(r'<!--\s*inject:\s*(.*?)\s*-->')
    return pattern.sub(replacer, base_file_content)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", help="Phase name to load (e.g., 02-plan)")
    parser.add_argument("--file", help="Explicit file path to load (legacy)")
    args = parser.parse_args()
    
    content = None
    if args.phase:
        # Check local override first
        local_override = Path(".datum") / f"{args.phase}.local.md"
        if local_override.exists():
            content = local_override.read_text()
        else:
            try:
                content = resources.files("datum.references").joinpath(f"{args.phase}.md").read_text()
            except Exception:
                print(f"Phase reference {args.phase}.md not found in packaged datum.references", file=sys.stderr)
                sys.exit(1)
    elif args.file:
        target = Path(args.file)
        if not target.exists():
            print(f"File not found: {args.file}", file=sys.stderr)
            sys.exit(1)
        content = target.read_text()
    else:
        print("Must provide either --phase or --file", file=sys.stderr)
        sys.exit(1)
        
    print(load_prompt_with_injection(content))

if __name__ == "__main__":
    main()
