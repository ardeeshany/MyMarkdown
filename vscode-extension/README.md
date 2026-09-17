# MyMarkdown for VS Code

Make Markdown easier to scan without leaving the editor. MyMarkdown adds colourful
headings, readable JSON, Mermaid diagrams, callouts, highlights, footnotes, linting, and
a clickable Contents view to VS Code's own Markdown preview.

**Private by design:** no account, no network requests, and nothing leaves your computer.

![MyMarkdown showing tables, a Mermaid diagram, and math in VS Code](https://raw.githubusercontent.com/ardeeshany/mymarkdown/main/vscode-extension/media/preview-dark.png)

## What you get

### A clearer preview

Open any `.md` file and press `Ctrl+Shift+V` or `Cmd+Shift+V`. MyMarkdown styles the
preview you already know, so scroll sync, links, images, search, and click-to-source keep
working.

- Distinct colours for H1, H2, and H3
- Responsive tables and code blocks
- Mermaid diagrams that follow your light or dark theme
- Task lists with clear checked and unchecked states
- GitHub callouts, highlights, strikethrough, math, and footnotes

### JSON that is easy to read

JSON is formatted one field per line and coloured by type. Long values wrap inside the
preview, and `\n` inside strings becomes a visible line break. Bare and inline JSON are
recognized too.

![Formatted JSON wrapping cleanly in the MyMarkdown preview](https://raw.githubusercontent.com/ardeeshany/mymarkdown/main/vscode-extension/media/json-light.png)

### Beautify with one command

Run **MyMarkdown: Beautify Markdown**, click the sparkle button, or press
`Ctrl+Alt+B` / `Cmd+Alt+B`.

Beautify tidies spacing, normalizes bullets, and formats JSON as one undoable edit. It
preserves your cursor and scroll position, and leaves YAML front matter, HTML, indented
code, and precision-sensitive numbers untouched.

### Contents and linting

The MyMarkdown activity-bar view lists H1, H2, and H3 headings. Select one to jump to it.
Heading jumps, unclosed fences, invalid JSON, and mixed bullet styles appear in the
Problems panel as you type.

## Settings

### `mymarkdown.lint`

Default: `true`

Reports Markdown structure problems in the Problems panel.

### `mymarkdown.registerFormatter`

Default: `false`

Lets **Format Document** and `editor.formatOnSave` run Beautify. It stays off by default
to avoid conflicting with Prettier or markdownlint. If you enable it, choose MyMarkdown
for Markdown files:

```jsonc
"[markdown]": {
  "editor.defaultFormatter": "mymarkdown.mymarkdown",
  "editor.formatOnSave": true
}
```

Settings apply immediately; no reload is needed.

## Install and use

Install from the VS Code Marketplace, reload the window, open a Markdown file, and press
`Ctrl+Shift+V` / `Cmd+Shift+V`.

For a local package:

```bash
code --install-extension vscode-extension/mymarkdown-0.1.21.vsix
```

## Open source

Source, release notes, and contribution instructions are on
[GitHub](https://github.com/ardeeshany/mymarkdown). Ideas and bug reports are welcome in
[Issues](https://github.com/ardeeshany/mymarkdown/issues).

## License

[MIT](LICENSE)
