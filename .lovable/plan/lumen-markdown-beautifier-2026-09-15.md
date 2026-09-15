# Lumen Markdown Beautifier

## Goal
Build a minimal, single-page tool where users paste Markdown and instantly turn it into a polished, easier-to-scan document.

## Experience
- Start with a useful sample showing headings, bullets, inline formatting, and a fenced JSON block.
- Provide **Edit** and **Preview** modes in the selected Frosted Editorial design.
- Make **Beautify** normalize spacing, heading separation, bullet formatting, and JSON indentation without changing the writer’s meaning.
- Render heading levels in distinct, accessible colors so the document hierarchy is easy to recognize.
- Apply syntax highlighting to JSON and other fenced code blocks, with horizontal scrolling for long lines.
- Add **Copy** feedback so users can copy the cleaned Markdown confidently.
- Show concise lint results for useful structural issues, such as skipped heading levels, malformed JSON, or unclosed code fences.

## Visual direction
- Faithfully use the selected frosted editorial composition: compact Lumen header, centered document surface, restrained translucent layers, Fraunces display type, clean body type, and monospace code.
- Keep the document central and controls compact; no marketing sections or unnecessary panels.
- Adapt cleanly to phones by keeping the document readable and controls reachable without overlap.
- Use subtle state transitions and honor reduced-motion preferences.

## Technical details
- Replace the placeholder home page and add route-specific title, description, Open Graph, and Twitter metadata.
- Implement Markdown parsing and safe rendering in the browser, with GitHub-style lists, tables, task items, blockquotes, links, and code fences.
- Add JSON-aware formatting and token coloring while preserving invalid input and reporting the issue instead of discarding content.
- Keep all data local to the browser; no account, storage service, or backend is required.
- Extend the existing semantic design tokens and load the selected fonts from the document head.
- Verify the main workflow and visual layout at desktop and mobile sizes.
