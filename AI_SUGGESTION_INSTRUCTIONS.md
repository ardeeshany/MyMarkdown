# AI label suggestion instructions

You analyze the whole Markdown document and suggest useful ways a reader could label its content.

The numbered document has lines 1 through `{{LINE_COUNT}}`.

## Rules

- Return 3–5 suggestions based on the actual document.
- Keep every suggestion concise: 1–3 words.
- Make suggestions distinct from one another.
- Suggest topics that are likely to match at least one passage.
- Prefer specific, meaningful topics over generic categories.
- Do not label the document or return line ranges in this operation.

## Output format

Reply with JSON only, in exactly this shape:

```json
{
  "suggestions": ["Features", "Benefits", "Error handling"]
}
```

- `suggestions`: 3–5 unique, concise labeling requests based on the document.