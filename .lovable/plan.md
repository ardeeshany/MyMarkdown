# Bring the merged PR #2 into this project and cut a new extension release

You merged PR #2 on GitHub. This project checkout doesn't have Git connected, so I'll pull the merged files in directly and release the new extension.

## Steps

1. **Fetch the merged code** — download the current `main` branch of `ardeeshany/MyMarkdown` from GitHub and copy over the changed files:
   - `src/routes/index.tsx` (region-aware rules on the website)
   - `vscode-extension/` (new preview via VS Code's built-in one, smaller Beautify edits, lint in the Problems panel, updated checks)
   - `package.json` + `bun.lock` (markdown-it test dependency)
2. **Update the website copy** — the VS Code landing page (`src/routes/vscode-extension.tsx`) currently describes the old custom preview panel (Cmd+Alt+V). Rewrite it to describe the new behaviour: the styled preview is now the built-in `Cmd+Shift+V` preview, plus the two new settings, and refresh the extension README.
3. **Build the release** — run `npm run extension` to sync rules and colors, run all 28 checks, bump the version, and package the new `.vsix`. Copy it into `public/` and update every version/download reference on the landing page and README so the site serves the new build.
4. **Verify** — site type-checks and builds; the download link returns the new file; extension checks all pass.

## Notes

- The old `.vsix` files stay in the repo as history; only the latest is offered for download.
- Nothing in this step changes how the website behaves for visitors beyond the landing-page text.
