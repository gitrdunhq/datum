# Cross-Cutting Skill: Visual Explainers (wfc-visual)

**Goal:** Automatically generate visual diagrams (Mermaid, HTML) whenever presenting complex architectures, diffs, plans, or comparisons.

## Context
This is a cross-cutting capability available across both the Product and Engineering pipelines. Whenever you find yourself outputting an ASCII table with >3 columns, or attempting to describe a complex data flow in paragraphs, STOP. Generate an HTML visual explainer instead.

## Process
1. Recognize when the content is dense (e.g., system architecture, state machines, database schemas).
2. Write a single-file HTML document using Mermaid.js (`<div class="mermaid">`) or HTML `<table>` for structured grids.
3. Save the diagram to `.datum/diagrams/<descriptive-name>.html`.
4. Share the path with the user in your response so they can open it in their browser.

**No ASCII Art:** Never fall back to ASCII art for complex topology. Use Mermaid.js or CSS grid.
