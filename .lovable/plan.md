# AI section labels in Preview

Add a small AI box where you describe what to look for ("all parts about error handling"). The AI reads the whole document and returns labelled ranges of lines. Each range shows in Preview as a thin colored vertical line in the right margin with a short 1–2 word label beside it.

## What you'll see

- A compact input row above the document: a single-line prompt field, a "Find" button, and a subtle "Clear" when results exist.
- In Preview, a narrow margin strip on the right side of the text. Each found chunk gets a 2px vertical line in its own color, with its label in that color at the top of the line.
- Repeated labels reuse the same color; chunks never overlap.
- Above the document, small colored chips listing the labels found, with a count. Clicking a chip scrolls to its first chunk.
- While thinking: the button shows a quiet spinner. On failure: one short line of plain text, no popups.
- Styling stays Notion-like — thin lines, muted type, lots of whitespace, no heavy boxes.

## Behaviour

- Always analyzes the whole document, not a selection.
- Labels only appear in Preview (Edit stays clean). Switching to Edit hides them; switching back shows them again.
- Editing the document clears the labels, since line numbers would no longer match.

## Your Gemini key

Stored securely as a project secret and only used from the server, so it never reaches the browser. After you approve this plan I'll ask for it through the secure form.

## Technical notes

- New `src/lib/ai-annotate.functions.ts`: a `createServerFn` POST that reads `GEMINI_API_KEY` inside the handler and calls the Gemini `generateContent` REST endpoint with `responseMimeType: application/json` and a response schema of `{ items: [{ label, color, startLine, endLine }] }`. No Lovable AI, no client-side key. No artificial timeout on the fetch.
- Server-side sanitising: clamp lines to the document length, drop invalid/inverted ranges, sort by `startLine` and trim any overlap so chunks are disjoint, validate `color` as `#rrggbb`, and force one consistent color per label (first one wins).
- The prompt sends the document with line numbers prefixed so the model can reference exact lines.
- Preview mapping: the existing ReactMarkdown component overrides already receive `node.position`; each top-level block renderer gains a `data-line`/`data-end-line` attribute. The article is wrapped in a relative container with a right gutter; after render (and on resize, via `ResizeObserver`) the gutter measures the top/bottom offsets of the blocks covered by each range and positions the colored bars absolutely.
- State lives in the existing page component: `aiPrompt`, `aiRanges`, `aiLoading`, `aiError`; `setMarkdown` clears `aiRanges`.
- Nothing in the VS Code extension changes; `sync.js` stays untouched.
