# Self-contained AI instructions + scan blur polish

## 1. AI_INSTRUCTIONS.md becomes the complete instruction source
- Rewrite `AI_INSTRUCTIONS.md` so it contains everything the AI is told, in plain readable Markdown:
  - The full labeling rules already there (line ranges, no overlap, 1–2 word labels, reusable labels, contextual hex colors, empty result when nothing matches, never invent line numbers).
  - The exact JSON output structure, written out as a fenced example inside the file, e.g. `{ "items": [{ "label": "Error handling", "color": "#e11d48", "startLine": 12, "endLine": 20 }] }`, with a one-line note per field (label = 1–2 words, color = #rrggbb hex, startLine/endLine = inclusive line numbers from the numbered document).
- `src/lib/ai-annotate.functions.ts` keeps sending the file as the system instruction; no instruction text remains hard-coded outside the file. The `{{LINE_COUNT}}` placeholder stays so the file stays readable while the line limit is filled in at run time. (The strict JSON schema enforcement stays in code as a safety net — that's a transport guarantee, not an instruction.)

## 2. Whole-preview blur during the scan
- While Find runs, the entire Preview area gets a very subtle, slowly drifting blur/soft-focus layer in addition to the existing scanning line:
  - A second overlay layer with a faint backdrop blur (about 1.5–2px) whose blurred region gently moves/breathes across the page, so the document feels like it's being scanned without becoming unreadable.
  - Kept light: the text stays legible underneath; the moving scan line stays as-is.
  - Reduced motion: no moving blur — a static, near-imperceptible softening only.

## Technical notes
- Only `AI_INSTRUCTIONS.md`, `src/styles.css`, and the scan overlay markup in `src/routes/index.tsx` change; the Gemini call, sanitizing, and label rendering are untouched.
- Verified in the browser afterwards: a live Find run returns labels, and the blur layer is visible during loading and gone on completion.
