# Fix the empty preview on Cmd/Ctrl+Alt+V

## What's wrong

Opening the preview moves focus to the new panel. The extension only ever reads "the Markdown file that is currently focused", so at that moment there is no Markdown file focused and nothing gets sent to the preview — you see a blank page. Clicking back on the .md file re-focuses it and the content finally appears.

## The fix

1. Remember the Markdown file the preview was opened for, instead of relying on what is focused right now. That document stays the preview's source until you switch to another Markdown file.
2. Open the preview without stealing focus, so your cursor stays in the Markdown file and you can keep typing immediately.
3. Send the content as soon as the panel is created, and again when the panel reports it is ready, so the first paint is never empty.
4. Same treatment for the Contents sidebar: keep showing the last Markdown file's headings instead of going empty when focus moves elsewhere.
5. If no Markdown file has been opened at all, the preview shows a short "Open a Markdown file to see it here" note rather than a blank panel.

## Technical details

In `vscode-extension/extension.js`:
- Add a module-level `lastMarkdownDocument`, updated by `onDidChangeActiveTextEditor` and by `openPreview`; add a `currentMarkdownDocument()` helper that returns the active Markdown editor's document, falling back to `lastMarkdownDocument` (skipping closed documents).
- `pushPreviewUpdate()` uses `currentMarkdownDocument()` instead of `activeMarkdownEditor()`, sets the panel title from it, and posts the text.
- `createWebviewPanel` gains `{ preserveFocus: true }` in its show-options, and `reveal(ViewColumn.Beside, true)` for the already-open case; call `pushPreviewUpdate()` right after assigning `webview.html` (the existing `ready` handler stays as a second chance), plus `retainContextWhenHidden: true` so a hidden panel keeps its content.
- `onDidChangeTextDocument` compares against `currentMarkdownDocument()`; `TocProvider.getChildren()` and `beautify()` use the same helper.

Then re-run `npm run extension` to package the new .vsix, copy it into `public/`, and bump the version shown on the `/vscode-extension` page and in the extension README.
