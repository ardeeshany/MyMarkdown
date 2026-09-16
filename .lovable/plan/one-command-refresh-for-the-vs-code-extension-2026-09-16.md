# One-command refresh for the VS Code extension

## What you will run

One command from the project root, any time the website changes:

```sh
npm run extension
```

It refreshes the extension from the website, runs its checks, bumps the version, and writes a fresh install file (e.g. `mymarkdown-0.1.1.vsix`) that you install with `code --install-extension mymarkdown-0.1.1.vsix` (then reload the window).

## How it fits together

```text
website                              extension (self-contained)
src/routes/index.tsx  ---extract--->  lib/mymarkdown.js   (rules: TOC, JSON, beautify, lint)
src/styles.css        ---tokens--->  media/preview.css   (colors)
                                              |
                                              +-> extension.js / render.js / preview.js  (hand-written, not synced)
```

## What syncs automatically

- **The rules** — the block of helper functions in the website's homepage (heading slugs, contents extraction with numbered H1s, raw and inline JSON promotion into fenced blocks, beautify, lint, and the `\n` line-wrap handling). These are copied over and stripped of their type annotations so they run in VS Code.
- **The colors** — heading one/two/three, JSON field/string/number/value colors, background, text, borders and the muted tone, read live from the website's stylesheet and written into the preview's token block. The website's modern color format is converted to plain hex so it renders identically everywhere.
- **The version** — patch bump on every successful run.

## What stays manual (be aware)

- **The preview's shape** — the extension renders its panel with its own HTML/CSS, while the website renders with React. Layout, spacing and new page features (hero, Paste button, scroll-to-top) do not carry over automatically.
- **The extension's own additions** — its JSON display helper sits on top of the synced rules and is preserved, not overwritten.
- **Reinstalling** — a new install file still needs the one install command and a window reload.

## Build steps

1. **New sync script** — `vscode-extension/sync.js`, plain Node, no new packages. Uses the TypeScript compiler already in the project to strip type annotations.
   - Reads the website homepage and takes the contiguous block of helpers from `slugifyHeading` through `expandEscapedNewlinesInStrings`.
   - Fails loudly with a readable message if those names are not found (in case the code is reorganised), rather than writing a broken extension.
   - Wraps the result in the same dual-purpose format the extension already uses, and re-appends the extension-only helper so nothing is lost.
2. **Token block markers** — add start/end comment markers around the color block in `vscode-extension/media/preview.css`; the sync replaces only what is between them and leaves all other styling untouched. Small oklch-to-hex conversion lives in the sync script.
3. **Permanent checks** — new `vscode-extension/check.js` holding the assertions used to validate the extension today: nested JSON promoted and indented, inline JSON promoted, escaped newlines wrapped, contents numbering and duplicate-title handling, beautify output stable when run twice, lint flags expected issues. The sync runs these and stops before packaging if any fail.
4. **Wire it up** — add `"extension": "node vscode-extension/sync.js"` to the root scripts, and update the extension's README so its instructions start with `npm run extension` instead of the manual two-command flow.

## Verification

- Run the sync twice: second run changes nothing in the extension beyond the version number (idempotent).
- Deliberately rename a helper in a throwaway copy and confirm the sync aborts with a clear message.
- Confirm the packaged install file opens in VS Code, the panel shows colored headings and formatted JSON, and the contents list still jumps to headings.
- Confirm the website still type-checks and the homepage is unchanged (the sync reads it, never writes to it).

## Notes

- The website is only ever read by this script; nothing in it is modified.
- The preview panel is currently light-theme only; the sync keeps it that way and can pick up a dark block later if one is added.
- Packaging uses the official VS Code packaging tool via `npx`, fetched on demand.
