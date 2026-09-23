# MyMarkdown

**Markdown that reads beautifully.** Paste messy Markdown — the kind AI tools and agents
produce all day — and get a polished, readable document: colourful headings, JSON laid
out one field per line with coloured field names, a clickable table of contents, and
lint hints for the rough edges.

**Live app:** https://mymarkdown.site

Markdown stays local unless you explicitly generate AI labels, in which case the document
is sent to your selected AI provider. Otherwise: no account, no upload, everything runs in
your browser.

![MyMarkdown showing tables, a Mermaid diagram, and math in VS Code](https://raw.githubusercontent.com/ardeeshany/mymarkdown/main/vscode-extension/media/preview-dark.png)

![Formatted JSON wrapping cleanly in the MyMarkdown preview](https://raw.githubusercontent.com/ardeeshany/mymarkdown/main/vscode-extension/media/json-light.png)

## Features

- **Colourful headings** — H1, H2, and H3 each get their own colour, so structure is
  visible at a glance.
- **Readable JSON** — valid JSON is re-indented one field per line and syntax-coloured,
  including field names. Bare or backtick-wrapped JSON is promoted into proper code
  blocks automatically, and literal `\n` inside strings becomes a real line break.
- **Beautify** — one click normalises spacing, list markers, and JSON formatting.
- **Table of contents** — collapsible, click to jump, highlights the section you are
  reading, truncates long titles with a tooltip.
- **AI labelling** — ask MyMarkdown to label parts of a document, or let it suggest a
  few questions worth asking; matching sections get coloured chips you can jump between.
- **Paste & go** — a single button reads your clipboard and shows the rendered result.
- **VS Code extension** — the same preview, beautify command, and contents list inside
  your editor, plus labels saved beside the file so you can switch between several
  question-and-answer lenses instead of re-asking every time. See
  [`vscode-extension/`](vscode-extension/README.md) or the
  [extension page](https://mymarkdown.site/vscode-extension).

## Tech stack

- [TanStack Start](https://tanstack.com/start) (React 19, file-based routing, SSR)
- [Vite 7](https://vite.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/) with semantic design tokens in
  `src/styles.css`
- [shadcn/ui](https://ui.shadcn.com/) components
- `react-markdown` + `remark-gfm` for parsing

There is no backend and no database — the whole app is static.

## Getting started

Requires Node.js 20+ (or [Bun](https://bun.sh/)).

```sh
git clone https://github.com/ardeeshany/mymarkdown.git
cd mymarkdown
npm install
npm run dev
```

The dev server runs on http://localhost:8080.

| Command | What it does |
| --- | --- |
| `npm run dev` | start the dev server |
| `npm run build` | production build |
| `npm run extension` | rebuild and package the VS Code extension |
| `npm run extension:check` | run the extension's checks only |

## Manual Markdown fixture

When you change the renderer, beautify rules, lint, or TOC, open
[`samples/markdown-feature-test.md`](samples/markdown-feature-test.md) and compare
output on the website and in the VS Code extension.

- **Website:** copy the file contents, paste into the editor, and switch to Preview.
- **VS Code:** open the file and use the MyMarkdown preview (`Ctrl+Shift+V` /
  `Cmd+Shift+V`).

The fixture covers math, tables, footnotes, task lists, highlights, strikethrough,
definition lists, alerts, emoji shortcodes, chart/ABC/GeoJSON fences, Mermaid, plus
common regression cases (headings, lists, JSON fences, HTML, lint edge cases). It does
not change the app’s default sample.

## Project layout

```text
src/
  routes/
    __root.tsx             root layout, global head metadata
    index.tsx              the editor, preview, TOC, and all formatting rules
    vscode-extension.tsx   landing page for the VS Code extension
  components/ui/           shadcn/ui components
  styles.css               Tailwind v4 theme and design tokens
public/                    favicon, robots.txt, the downloadable .vsix
samples/                   manual Markdown fixtures for renderer checks
vscode-extension/          the VS Code extension and its one-command build
```

The formatting rules (`promoteRawJsonToFences`, `formatMarkdown`, `lintMarkdown`,
`getTocHeadings`, …) live at the top of `src/routes/index.tsx` and are the single source
of truth — `npm run extension` copies them into the extension.

## VS Code extension

The extension keeps its own copy of the rules and colours, so it does not update on its
own. From the project root:

```sh
npm run extension
code --install-extension vscode-extension/mymarkdown-<version>.vsix
```

`npm run extension` copies the rules from `src/routes/index.tsx`, copies the light and
dark colour values from `src/styles.css`, runs the checks, bumps the patch version, and
packages a new `.vsix`. If a check fails nothing is packaged and the reason is printed.
Full details in [`vscode-extension/README.md`](vscode-extension/README.md).

## Contributing

Issues and pull requests are welcome. A few things worth knowing:

- Never hardcode colours in components — use the semantic tokens in `src/styles.css`.
- Formatting rules belong in `src/routes/index.tsx`; extension-only helpers go in
  `vscode-extension/lib/manual-helpers.js`. `vscode-extension/lib/mymarkdown.js` is
  generated — do not edit it.
- Run `npm run extension:check` after touching any formatting rule.

## Contact

Ideas, bugs, or requests: [Ardalan](mailto:ardalan@mylens.ai)

## License

[MIT](LICENSE)
