# MyMarkdown for VS Code

Beautifies Markdown the same way [MyMarkdown](https://mymarkdown.site) does: colourful
headings, JSON laid out one field per line with each field name coloured, and a
clickable Contents list.

Everything runs inside VS Code — no account, no internet, nothing leaves your machine.

## Features

- **MyMarkdown preview** — a live, styled preview of the Markdown file you are editing
  (`Ctrl+Alt+V` / `Cmd+Alt+V`, or the button in the editor toolbar). It updates as
  you type. Its tab is labelled `MyMarkdown: <filename>`. Note that `Ctrl+Shift+V` /
  `Cmd+Shift+V` is VS Code's **built-in** preview, which has none of this styling.
- **MyMarkdown: Beautify Markdown** — rewrites the open file: normalises whitespace,
  puts every JSON block one field per line, and promotes bare or backtick-wrapped JSON
  into proper fenced blocks. A single `Ctrl+Z` / `Cmd+Z` undoes the whole thing.
- **Contents** — the MyMarkdown activity bar shows every H1/H2/H3. Click one to jump
  to it; collapse or expand a section from its own row.

## Install

From the project root, after building (see below):

```bash
code --install-extension vscode-extension/mymarkdown-<version>.vsix
```

The exact filename is printed by `npm run extension` (for example
`mymarkdown-0.1.9.vsix`).

Then restart VS Code (or run `Developer: Reload Window`). Open any `.md` file and press
`Ctrl+Alt+V` / `Cmd+Alt+V`, or click the sparkle button in the top-right of the editor.

To uninstall: run `Developer: Show Running Extensions`, or remove the folder
`~/.vscode/extensions/mymarkdown.mymarkdown-vscode-<version>`.

## Refreshing it after the website changes

The extension keeps its own copy of the rules, so it does **not** update on its own.
From the project root, run:

```bash
npm run extension
```

That single command:

1. copies the shared rules out of `src/routes/index.tsx` into
   `vscode-extension/lib/mymarkdown.js` (a generated file — do not edit it),
2. copies the colour values from `src/styles.css` into the marked regions of
   `vscode-extension/media/preview.css`,
3. runs the checks in `vscode-extension/check.js` and stops if anything broke,
4. bumps the patch version and packages a new `.vsix`.

Install the new file and reload the window. If the checks fail, nothing is packaged and
the reason is printed — fix the website rule or the extension and run it again.

Two rules live only here, because the website does not have them:
`formatJsonDisplay` in `lib/manual-helpers.js`. Add an extension-only helper there and
the sync inlines it automatically.

Still manual (deliberately): the preview layout is hand-written HTML/CSS while the
website is React, so a pure copy cannot carry over page layout, the paste button, or the
scroll-to-top control.

## Layout

```text
extension.js            VS Code wiring: commands, preview, tree view
lib/mymarkdown.js       GENERATED — shared rules, copied from the website
lib/manual-helpers.js   extension-only helpers, inlined into the file above
lib/render.js           the hand-written Markdown renderer for the preview
media/preview.css       preview styling (colour regions are synced)
media/preview.js        keeps the preview in sync with the editor
sync.js                 the one-command build (run `npm run extension`)
check.js                the checks the build runs before packaging
```

Local only. Nothing is published to a marketplace.
