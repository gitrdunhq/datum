#!/usr/bin/env python3
"""
prompt_loader.py — Progressive disclosure of prompt sub-documents.
Injects context into prompts only when triggers are met, avoiding token bloat.
"""

import argparse
import sys
import re
from pathlib import Path

# Fix relative imports
sys.path.insert(0, str(Path(__file__).parent))
from datum.path_utils import assets_dir

def load_prompt_with_injection(base_file: Path) -> str:
    content = base_file.read_text()
    
    def replacer(match):
        doc_path = match.group(1)
        target = Path(doc_path)
        if target.exists():
            return f"\n\n--- INJECTED CONTEXT: {doc_path} ---\n" + target.read_text() + "\n-----------------------------------\n"
        return f"\n\n<!-- WARNING: Inject target {doc_path} not found -->\n"

    # Replace <!-- inject: path/to/file.md -->
    pattern = re.compile(r'<!--\s*inject:\s*(.*?)\s*-->')
    return pattern.sub(replacer, content)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, help="Base prompt file to load")
    args = parser.parse_args()
    
    target = Path(args.file)
    if not target.exists():
        print(f"File not found: {args.file}", file=sys.stderr)
        sys.exit(1)
        
    print(load_prompt_with_injection(target))

if __name__ == "__main__":
    main()
