# MyMarkdown — VS Code Extension (local)

Beautiful Markdown preview with colorful headings, formatted/syntax-highlighted JSON, a one-click Beautify command, and a clickable table of contents.

## Features

- **MyMarkdown: Open Styled Preview** — side panel with the MyMarkdown look: colorful H1–H3, pretty JSON blocks, tables, task lists. Updates live as you type. Also available as an icon in the editor title bar when a Markdown file is open.
- **MyMarkdown: Beautify Markdown** — normalizes spacing, bullets, heading separation, and JSON indentation in the open file. Undoable with Cmd/Ctrl+Z.
- **MyMarkdown Contents** — H1–H3 outline in the Explorer sidebar; click an entry to jump to that heading. H1 entries are numbered.

## Install locally

```sh
cd vscode-extension
npx @vscode/vsce package --allow-missing-repository -o mymarkdown-0.1.0.vsix
code --install-extension mymarkdown-0.1.0.vsix
```

(For Cursor, replace `code` with `cursor`.)

Then open any `.md` file and run **MyMarkdown: Open Styled Preview** from the Command Palette (Cmd/Ctrl+Shift+P) or the editor title bar.

## Update

Bump `version` in `package.json`, re-run the two commands above, and reload the window.
