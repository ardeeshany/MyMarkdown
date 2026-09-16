# Click preview to jump to the matching line in the editor

## Idea

In VS Code / Cursor, when you scroll the MyMarkdown preview and see a paragraph, heading, list or JSON block you want to work on, click it. The Markdown file next to it scrolls to that exact line and puts the cursor there.

Small, familiar, no new panel: the whole preview becomes clickable navigation back to the source.

## What the user sees

- Hovering any block in the preview shows a subtle highlight and a "jump to line" cursor.
- A single click scrolls the Markdown editor to that block's line, selects it briefly, and leaves the cursor there ready to type.
- Clicking a link inside the text still opens the link, not the jump.
- Nothing changes when no Markdown editor is open next to the preview.

## Technical notes

- `vscode-extension/lib/render.js`: the renderer already tracks the source line number while walking lines (headings use it for TOC ids). Emit `data-line="<n>"` on each top-level block it pushes (headings, paragraphs, lists, blockquotes, fenced blocks, tables).
- `vscode-extension/media/preview.js`: one delegated click handler on `#mm-doc`. Walk up from `event.target` to the nearest `[data-line]`, ignore clicks on `a` elements and text selections, then `vscode.postMessage({ type: "revealLine", line })`.
- `vscode-extension/extension.js`: handle `revealLine` in the existing `onDidReceiveMessage` — find the visible editor for `lastMarkdownDocument` (or show it in its column without stealing the preview's), set the selection to that line and `revealRange` with `InCenterIfOutsideViewport`.
- `vscode-extension/media/preview.css`: hover style on `[data-line]` (soft `--mm-chip` background, rounded) plus a brief flash class after a click.
- Rebuild with `npm run extension`, bump to the next patch version, copy the new `.vsix` into `public/`, and update the version strings on `src/routes/vscode-extension.tsx` and `vscode-extension/README.md`.

## Out of scope

- Scroll-position syncing in both directions while scrolling (bigger, easy to get wrong).
- Any change to the website preview.
