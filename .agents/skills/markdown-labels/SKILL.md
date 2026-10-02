---
name: markdown-labels
description: Use after writing or substantially editing a Markdown document, to generate MyMarkdown label lenses for it. Reads the finished document, works out the few questions worth asking about how it is organised, answers each as a set of labelled line ranges, and saves them beside the file so the MyMarkdown VS Code extension can draw them in the preview. Skip for short documents.
---

# Markdown labels

A reader opening a long document cannot see its shape. MyMarkdown draws that shape as
coloured bars down the edge of the preview: each bar is a range of lines, each label names
what that range is about. This skill writes those labels for a document you just finished,
so they are already there the first time anyone opens it.

You are labelling a document **you have just written**, so you already know what is in it.
Do not re-read it line by line unless you need exact line numbers.

## When to run

Run after you create or substantially rewrite a `.md` file, once the file is final.

**Skip entirely** when the document is under ~400 words or has fewer than two headings.
Three ways of looking at a four-line note is noise, and the bars have nothing to separate.

## What to produce

Three **lenses**. A lens is one question about the document plus the labelled ranges that
answer it. Three different questions give a reader three different ways to see the same
document, which is the whole point — one lens showing "what are the main areas", another
showing "which parts are unfinished", another showing "what does a newcomer read first".

### 1. Choose the questions

Write three short questions about the document's **structure, categories, relationships,
patterns, or problems** — not about its subject matter. Each must be 8 words or fewer, and
all three meaningfully different.

Good: `How does this content break down?` · `Which parts need more work?` ·
`What would a newcomer read first?`

Bad: `What is the auth flow?` (that is subject matter, not structure) ·
`What is in the Architecture section?` (the heading already says so)

Do not suggest a lens whose answer is already obvious from the headings. Labelling a
section titled "Architecture" as `Architecture` adds nothing. Connecting four scattered
paragraphs that all turn out to be about the same risk adds a great deal.

### 2. Answer each question with ranges

For each question, produce 3–5 labelled ranges covering the parts of the document that
answer it:

- Each range is one contiguous run of lines, using the document's **real 1-based line
  numbers**. Count them; do not estimate.
- **Ranges within one lens must never overlap.** A line belongs to at most one range of
  that lens. Lines may belong to no range at all.
- Label each range with 1–2 words.
- Reuse the same label and the same colour when several ranges are about the same thing.
- Give each distinct label a `#rrggbb` colour that suits it — warm red for problems, calm
  blue for setup, and so on.
- Cover the parts that genuinely answer the question. Do not stretch a range to swallow
  unrelated lines just to make it bigger.

Ranges from *different* lenses are free to overlap. Only one lens is ever shown at a time.

## Where it goes

Write `.mymd/<path to the document>.json`, relative to the workspace root, mirroring the
document's own path. A file at `docs/guide.md` gets `.mymd/docs/guide.md.json`.

```json
{
  "version": 1,
  "lenses": [
    {
      "name": "How does this content break down?",
      "generatedBy": "skill",
      "generatedAt": "2026-09-18T12:00:00Z",
      "ranges": [
        { "label": "Setup", "color": "#2563eb", "startLine": 12, "endLine": 28 },
        { "label": "Daily use", "color": "#059669", "startLine": 30, "endLine": 71 }
      ]
    }
  ]
}
```

Do not write or change `sourceHash`. With no hash, the extension checks every range against
the current text each time it opens the document. A wrong hash is worse than none: it
claims the ranges match text they were never checked against.

Do not write `anchor` or `endAnchor` for your ranges either. This repo's markdown-labels
hook stamps them from the document as soon as the file is saved, and they are what keep
each range on its section after later edits. Save the file with your file-writing or
patch tool (Write, Edit, create, apply_patch and the like), not a shell command: the hook
only sees those tools.

If the file already exists, keep the lenses in it whose names you are not replacing,
exactly as they are, anchors included.

## After writing

Tell the person in one line that you labelled the document and what the three lenses are.
They switch between them from the dropdown chip above the preview, or from the MyMarkdown
item in the VS Code status bar.

Nothing here validates itself. The extension sanitises whatever it reads — clamping lines,
dropping inverted ranges, enforcing non-overlap, checking colours — so a mistake degrades
to a missing bar rather than a broken preview. Get it right anyway; the sanitiser is a
safety net, not a plan.
