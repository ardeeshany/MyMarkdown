# mymarkdown-hooks

Sets up coding agents to label the Markdown they write, for the
[MyMarkdown](https://marketplace.visualstudio.com/items?itemName=mymarkdown.mymarkdown) VS Code
extension. After an agent saves a document of 400 or more words with at least two headings and no
labels yet, a small hook tells it to run the `markdown-labels` skill, which writes three label
lenses to `.mymd/` for the preview to draw.

```bash
npx mymarkdown-hooks init
```

Run it anywhere inside a project. It installs at the top of the git repository (or in the current
folder outside one), for Claude Code, GitHub Copilot CLI and VS Code agent mode, Cursor and Codex:

- `.agents/hooks/markdown-labels.cjs` — the hook, shared by every agent
- `.agents/skills/markdown-labels/SKILL.md` and `.claude/skills/markdown-labels/SKILL.md` — the skill
- `.claude/settings.json` — the hook entry for Claude Code and Cursor
- `.github/hooks/markdown-labels.json` — for Copilot CLI and VS Code agent mode
- `.codex/hooks.json` — for Codex

Nothing you have is overwritten. The hook entry is merged into an existing `.claude/settings.json`
or `.codex/hooks.json`, and a file that differs from this version is left alone unless you pass
`--force`. After an update, run it again with `--force` to bring the files up to date; that also
replaces any edits you made to them.

Needs Node.js 18 or later. Codex also asks you to trust the project and approve the hook once, in
`/hooks`. The same install is one command inside VS Code: **MyMarkdown: Install Label Hooks for
Coding Agents**.
