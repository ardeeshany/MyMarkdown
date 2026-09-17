# MyMarkdown for VS Code

Beautifies Markdown the same way [MyMarkdown](https://mymarkdown.site) does: colourful
headings, JSON laid out one field per line with each field name coloured, and a
clickable Contents list.

Everything runs inside VS Code — no account, no internet, nothing leaves your machine.

## Features

- **The Markdown preview you already use.** MyMarkdown styles VS Code's own preview, so
  `Ctrl+Shift+V` / `Cmd+Shift+V` (or **Markdown: Open Preview to the Side**) is the
  MyMarkdown preview. There is no second preview to learn, and everything the built-in
  one does keeps working: scroll stays in step with the editor, double-click jumps back
  to the source, images and links resolve against your workspace, find works, and any
  other Markdown extension you have — Mermaid, maths — still renders.
- **JSON that reads.** A ` ```json ` block is laid out one field per line and coloured by
  what each piece is: field names, strings, numbers, and `true` / `false` / `null`. JSON
  sitting bare in prose, or inside a backtick span, is picked up too.
- **MyMarkdown: Beautify Markdown** (`Ctrl+Alt+B` / `Cmd+Alt+B`, or the sparkle button)
  rewrites the open file: tidy spacing, JSON one field per line, bullets unified. One
  `Ctrl+Z` / `Cmd+Z` undoes it, and it is applied as the smallest possible edit, so the
  cursor, the selection and the scroll position stay where they were.

  Beautify never touches the inside of YAML front matter, HTML blocks or indented code,
  and the only things it changes inside a fence are the two it is for: the language in the
  info string is lower-cased, and a `json` body is laid out one field per line. It keeps
  the indentation that nests a list and preserves two-space hard line breaks.

  It declines to lay out a JSON block whose numbers a double cannot hold — an id past
  2^53, `-0`, `1e400`, `1e-400`, or a decimal carrying more than 15 significant digits —
  and leaves that block exactly as written rather than showing you a different number.
  The preview does the same.
- **Structure problems.** Heading level jumps, unclosed fences, invalid JSON blocks and
  mixed bullets appear in the Problems panel, each pointing at the line and column it is
  about. Code inside fences, front matter and HTML blocks is never reported.
- **Contents** — the MyMarkdown activity bar lists every H1, H2 and H3 in the open file.
  Click one to jump to it. It works whether or not the preview is open.
- **Your preview settings still apply.** MyMarkdown restyles the built-in preview rather
  than replacing it, so `markdown.preview.fontSize`, `markdown.preview.lineHeight`,
  `markdown.styles` and the preview security levels all keep working.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `mymarkdown.lint` | `true` | Report structure problems in the Problems panel. |
| `mymarkdown.registerFormatter` | `false` | Register Beautify as the Markdown formatter, so **Format Document** (`Shift+Alt+F`) and `editor.formatOnSave` run it. |

Both settings take effect as soon as you change them; neither needs a window reload.

`mymarkdown.registerFormatter` is off by default on purpose. VS Code will not choose
between two formatters for the same language on its own, so turning this on while you
also have Prettier or markdownlint installed means you need to say which one wins:

```jsonc
"[markdown]": {
  "editor.defaultFormatter": "local.mymarkdown",
  "editor.formatOnSave": true
}
```

## Install

From the project root, after building (see below):

```bash
code --install-extension vscode-extension/mymarkdown-<version>.vsix
```

The exact filename is printed by `npm run extension` (for example
`mymarkdown-0.1.15.vsix`).

Then restart VS Code (or run `Developer: Reload Window`). Open any `.md` file and press
`Ctrl+Shift+V` / `Cmd+Shift+V`.

To uninstall: run `Developer: Show Running Extensions`, or remove the folder
`~/.vscode/extensions/local.mymarkdown-<version>`.

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
`formatJsonDisplay` and `minimalEdit` in `lib/manual-helpers.js`. Add an extension-only
helper there and the sync inlines it automatically.

## Layout

```text
extension.js            VS Code wiring: commands, Contents tree, problems, formatter
lib/mymarkdown.js       GENERATED — shared rules, copied from the website
lib/manual-helpers.js   extension-only helpers, inlined into the file above
lib/preview-plugin.js   what MyMarkdown adds to VS Code's markdown-it: JSON colouring,
                        loose-JSON promotion, task lists
media/preview.css       preview styling (colour regions are synced)
sync.js                 the one-command build (run `npm run extension`)
check.js                the checks the build runs before packaging
```

Local only. Nothing is published to a marketplace.
