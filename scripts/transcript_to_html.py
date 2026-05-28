import sys
import json
import html
import re


def extract_text(content):
    """Extracts text from Claude-style content which can be a string or a list of blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


def main():
    if len(sys.argv) < 2:
        print("Usage: python transcript_to_html.py <input_file.jsonl> [output.html]")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else "transcript.html"

    messages_html = []

    try:
        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)

                    # Claude Code JSONL nests role inside message
                    msg = data.get("message", data)
                    role = msg.get("role") or data.get("type")
                    if role == "human":
                        role = "user"

                    if role not in ["user", "assistant"]:
                        continue

                    content = extract_text(msg.get("content", data.get("content", "")))
                    if not content:
                        continue

                    safe_content = html.escape(content)
                    safe_content = re.sub(
                        r"```(?:\w+)?\s*\n?(.*?)\n?```",
                        r"<pre><code>\1</code></pre>",
                        safe_content,
                        flags=re.DOTALL,
                    )
                    safe_content = re.sub(
                        r"`([^`]+)`", r"<code>\1</code>", safe_content
                    )

                    timestamp = data.get("timestamp") or data.get("created_at") or ""
                    ts_html = (
                        f'<span class="timestamp">{html.escape(str(timestamp))}</span>'
                        if timestamp
                        else ""
                    )

                    role_class = "user" if role == "user" else "assistant"
                    role_label = "User" if role == "user" else "Assistant"

                    msg_html = f"""
                    <div class="message {role_class}">
                        <span class="role-label">{role_label}</span>
                        {ts_html}
                        <div class="content">{safe_content}</div>
                    </div>
                    """
                    messages_html.append(msg_html)

                except json.JSONDecodeError:
                    continue
    except FileNotFoundError:
        print(f"Error: File '{input_file}' not found.")
        sys.exit(1)

    html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Code Session Transcript</title>
    <style>
        body {{
            background-color: #1a1a2e;
            color: #e0e0e0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            padding: 20px;
            max-width: 900px;
            margin: auto;
        }}
        h1 {{
            text-align: center;
            color: #ffffff;
            margin-bottom: 40px;
        }}
        .message-container {{
            display: flex;
            flex-direction: column;
            gap: 20px;
        }}
        .message {{
            padding: 15px 20px;
            border-radius: 10px;
            max-width: 85%;
            word-wrap: break-word;
        }}
        .user {{
            background-color: #16213e;
            align-self: flex-end;
            border-bottom-right-radius: 2px;
        }}
        .assistant {{
            background-color: #2a2a3e;
            align-self: flex-start;
            border-bottom-left-radius: 2px;
        }}
        .role-label {{
            font-weight: bold;
            font-size: 0.8rem;
            display: block;
            opacity: 0.7;
            margin-bottom: 5px;
        }}
        .timestamp {{
            font-size: 0.75rem;
            color: #888;
            display: block;
            margin-bottom: 5px;
        }}
        .content {{
            white-space: pre-wrap;
        }}
        pre {{
            background-color: #0f3460;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
            margin: 10px 0;
        }}
        code {{
            font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace;
        }}
        pre code {{
            white-space: pre;
        }}
    </style>
</head>
<body>
    <h1>Claude Code Session Transcript</h1>
    <div class="message-container">
        {"".join(messages_html)}
    </div>
</body>
</html>
"""
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(html_template)

    print(f"Generated: {output_file}")


if __name__ == "__main__":
    main()
