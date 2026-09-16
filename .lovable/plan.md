# MyMarkdown as a Local VS Code Extension

## Goal
Reuse the existing beautify/preview logic from the web app as a private VS Code extension (local install only, no marketplace): styled preview panel, Beautify command, and a collapsible H1–H3 table of contents.

## What you'll get
- A **MyMarkdown Preview** command that opens your styled preview in a side panel for the active Markdown file: colorful H1–H3, formatted and syntax-highlighted JSON, inline-JSON promotion, live updates as you type.
- A **Beautify Markdown** command that cleans up the current document in place (same normalization as the web app).
- A **TOC view** in the sidebar listing H1/H2/H3 from the open file, collapsible, clickable to jump to that heading in the editor.

## How it works
- New folder `vscode-extension/` in this project, plain JavaScript (no build step needed) so it stays easy to tweak.
- The core logic (beautify, JSON promotion/formatting, heading extraction) is copied from `src/routes/index.tsx` into a shared module inside the extension, so the extension is self-contained and doesn't depend on the web app running.
- The preview panel is a VS Code webview reusing the existing markdown rendering + styles, refreshed on document changes.
- Distribution is local: package with `vsce` into a `.vsix` file, then install with one command (`code --install-extension mymarkdown-0.1.0.vsix`). Works in VS Code, Cursor, and other compatible editors.

## Technical details
- `vscode-extension/package.json` — extension manifest: commands (`mymarkdown.openPreview`, `mymarkdown.beautify`), a TOC tree view contribution, activation on Markdown files.
- `vscode-extension/extension.js` — registers commands, the webview panel, and the TOC TreeDataProvider; wires document-change events.
- `vscode-extension/media/` — preview HTML/CSS/JS (adapted from the web app's rendering code and design tokens).
- Beautify edits the document via a `WorkspaceEdit` so it's undoable with Cmd/Ctrl+Z.
- Verify by launching an Extension Development Host is not possible in this sandbox; instead I'll validate the logic with unit-style runs under bun, then give you the packaged `.vsix` plus install instructions to try on your machine.

## Notes
- No accounts, no publishing, no cost — the `.vsix` installs locally.
- Future updates: rebuild the `.vsix` and reinstall.
