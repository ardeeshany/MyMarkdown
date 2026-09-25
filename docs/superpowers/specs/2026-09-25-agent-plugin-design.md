# One plugin for the label hook: Claude Code, Codex, Copilot

**Status:** design, for review before implementation. Branch `feat/agent-plugin`, stacked on PR #6.

## Why

The label hook and skill (PR #6) live in each project. A project nobody set up gets no
labels, and nothing says why. PR #6 makes the setup one command, but it is still one
command per project. This design installs the hook once per machine, through each
agent's own plugin system, and it then runs in every project.

Decided with the user:

- **Global, every project.** Once installed, the hook nudges in any project where an agent
  writes a long Markdown file. No opt-in marker.
- **Each agent's own plugin command** installs it. No installer of our own writes into the
  agents' global config files.
- The per-repo installer from PR #6 stays, for teams that commit the hook. The two must
  not nudge twice in the same project.
- Installable straight from this repository. Public listings: see "Where to publish".

## Layout

`vscode-extension/agent-hooks/plugin/` is the plugin root, and becomes the only copy of the
hook script and the skill in the repository:

```
vscode-extension/agent-hooks/plugin/
  plugin.json                       Agent Plugins 1.0 manifest: read by Copilot CLI, Codex and VS Code agent mode
  .claude-plugin/plugin.json        Claude Code's manifest
  hooks/hooks.json                  Claude-schema PostToolUse entry; Claude Code loads it by its location, Codex through the root manifest
  hooks/markdown-labels.cjs         the hook (moved here from agent-hooks/files/)
  com.github.copilot/hooks/hooks.json   the same entry in Copilot's own flat schema
  skills/markdown-labels/SKILL.md   the skill (moved here from agent-hooks/files/)
  README.md, LICENSE                copied into the install cache with the plugin; files outside the folder are not
```

Two marketplace files at the repository root make it installable from GitHub:

```
.claude-plugin/marketplace.json     Claude Code and Copilot CLI (Copilot reads this file too): source "./vscode-extension/agent-hooks/plugin"
.agents/plugins/marketplace.json    Codex: source {"source": "local", "path": "./vscode-extension/agent-hooks/plugin"}
```

Both use only fields every reader accepts (a relative-path source, kebab-case names, an
owner name), and the same plugin name and path, since Codex reads both files.

Why inside `agent-hooks/`: the npm package (`files` gains `plugin/`) and the VSIX (which
packs the whole extension folder) ship the plugin with no copying. The per-repo installer
keeps its three config templates in `agent-hooks/files/` and copies the hook and skill
from `plugin/`. The repository's own `.agents/hooks/markdown-labels.cjs` and the two
`SKILL.md` copies stay what the installer produces; `check.js` already holds them equal to
the templates and keeps doing so against the new location.

### Names

- Plugin: `mymarkdown`. Marketplace: `mymarkdown-plugins`, so users install
  `mymarkdown@mymarkdown-plugins` in every agent. A plugin's name can never change once
  published (installed copies would be lost), so the display name carries any wording.
- Version: the npm package's version, in both manifests and nowhere else (not in the
  marketplace entries). `check.js` holds the three equal. A release bumps it; without a
  bump, `claude plugin update` reports "already at the latest version" and users keep the
  old copy.

### Manifests

`plugin.json` (Agent Plugins 1.0; only its own fields at the top level):

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "mymarkdown",
  "version": "<package version>",
  "description": "Have coding agents label the Markdown they write, for the MyMarkdown VS Code extension. Runs a Node hook after each Markdown write; nothing leaves your machine.",
  "author": { "name": "MyMarkdown", "url": "https://github.com/ardeeshany/MyMarkdown" },
  "homepage": "https://github.com/ardeeshany/MyMarkdown/tree/main/vscode-extension/agent-hooks/plugin",
  "repository": "https://github.com/ardeeshany/MyMarkdown",
  "license": "MIT",
  "keywords": ["markdown", "labels", "vscode", "mymarkdown"],
  "extensions": {
    "com.openai": { "hooks": "./hooks/hooks.json", "interface": { "displayName": "MyMarkdown labels", "shortDescription": "…", "category": "Developer Tools", "capabilities": ["Skills", "Lifecycle hooks"] } }
  }
}
```

`.claude-plugin/plugin.json`: `name`, `version`, `description`, `author`, `homepage`,
`repository`, `license`, `keywords`; **no `hooks` key**, because Claude Code loads
`hooks/hooks.json` by its location and, from 2.1.255, refuses a plugin that declares the
same file twice.

`hooks/hooks.json` (Claude schema; Codex reads the same shape and matches `Write|Edit`
as its `apply_patch`):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/markdown-labels.cjs\"; exit 0", "timeout": 15 }
        ]
      }
    ]
  }
}
```

`com.github.copilot/hooks/hooks.json` (Copilot's schema): one flat `postToolUse` entry
with `bash` and `powershell` commands running the same script via `${PLUGIN_ROOT}`,
`timeoutSec: 15`.

Both agents set the plugin-root variable, and `; exit 0` keeps a machine without Node from
seeing an error after every write (documented: "Requires Node.js 18 or later").

## The hook

Two behaviours change in `markdown-labels.cjs`; nothing else.

**Finding the project.** Today the root is two folders above the script, which is right
only when the script is inside the project. The hook decides by its own location:

- Its folder ends in `.agents/hooks` (installed in a project): root is two folders up, as
  today, with the existing Claude Code worktree remap.
- Otherwise (running as a plugin): root is `CLAUDE_PROJECT_DIR`, else `COPILOT_PROJECT_DIR`,
  else the nearest folder at or above the payload's `cwd` that contains `.git`, else `cwd`.

Files outside the root are ignored, as now. Sidecars go to `<root>/.mymd/`, which is where
the extension reads them when that root is the folder open in VS Code. In a monorepo where
VS Code is opened on a subfolder, the root found this way is the git top, the same caveat
the npx installer documents; the README says so.

**Yielding to a per-repo install.** Running as a plugin, if `<root>/.agents/hooks/markdown-labels.cjs`
exists the hook returns at once. The project's own hook handles that project, so a team
repository is never nudged twice.

Thresholds, the stamping of anchors into agent-written sidecars, the payload dialects, and
the nudge text are unchanged. One check during implementation: Claude Code lists a
plugin's skill as `mymarkdown:markdown-labels`; if the nudge's "markdown-labels skill" is
not enough for Claude to invoke it, the hook names it in full for Claude payloads (it
already tells the payload dialects apart).

## Installing

```
Claude Code   claude plugin marketplace add ardeeshany/MyMarkdown
              claude plugin install mymarkdown@mymarkdown-plugins
Copilot CLI   copilot plugin marketplace add ardeeshany/MyMarkdown
              copilot plugin install mymarkdown@mymarkdown-plugins
Codex         codex plugin marketplace add ardeeshany/MyMarkdown
              codex plugin add mymarkdown@mymarkdown-plugins
              then, in the terminal app, /hooks: trust the hook once (the desktop app cannot)
VS Code       listed under Agent Plugins in the Extensions view once the plugin is on awesome-copilot (below);
              until then "chat.pluginLocations": { "<path to a clone of the plugin folder>": true }
```

The marketplace route comes first everywhere: Copilot's docs mark installing from a bare
repository path as deprecated. Adding the marketplace clones this repository (about 10 MB;
Claude Code users can pass `--sparse vscode-extension/agent-hooks/plugin .claude-plugin`).
Codex skips the hook until the user trusts it in `/hooks`, and again after any change to
`hooks/hooks.json`. Update and uninstall are each agent's own commands
(`claude plugin update|uninstall`, `copilot plugin update|uninstall`, `codex plugin remove`).

## Where to publish

Self-hosting is publishing: once the two marketplace files are on `main`, every agent
installs from GitHub with no review. The public listings come after, and every one of
them is bound to an account, so the maintainer (ardeeshany) submits; a contributor can
prepare files and tags.

| Channel | Where | What it takes | Note |
| --- | --- | --- | --- |
| Copilot CLI and VS Code | `github/awesome-copilot`, the default marketplace in both | The "[External Plugin]" issue form: repo, plugin path, an immutable tag or commit, semver version equal to `plugin.json`, license, keywords. Automated gates need the root `plugin.json`. | Approvals have closed in 0–9 days (median 1). This is the only way the plugin appears in VS Code's Extensions view; VS Code has no gallery of its own. `github/copilot-plugins` is GitHub's own catalogue and takes no submissions. |
| Claude Code | Anthropic's community marketplace, via `platform.claude.com/plugins/submit` from a Console org | Public repo, `claude plugin validate --strict` clean. Submissions are reviewed against a published rubric. | **Decision:** the rubric fails a `PostToolUse` hook "without a project-relevance gate", and we chose global-everywhere. Plan: self-host now (also picked up by the independent directories that crawl marketplace files), submit once v0.1 is out with the description stating exactly what the hook does, and add an opt-in gate only if it is rejected for scope. `claude-plugins-official` is Anthropic-only. |
| Codex | Self-hosted only | — | OpenAI's directory would strip the hook (its validator rejects a `hooks` field) and needs a verified business identity; `openai/plugins` takes no outside submissions. |
| `mymarkdown-hooks` (npm) | npmjs.com, from the maintainer's account | A person with 2FA runs `npm publish` once (a first publish cannot be done from CI), then a Trusted Publisher for later releases. Before #6 merges, since its README tells people to run it. | Add "not affiliated with the `mymarkdown-cli` or `mymarkdown-mcp` packages" to the README. |
| The extension | Open VSX (the extension is already on the VS Code Marketplace) | Eclipse account, publisher agreement, `ovsx create-namespace mymarkdown`, `ovsx publish <vsix>`; then the "Claim namespace ownership" issue for the verified badge, filed by the repository owner. | Claims close in 0–9 days. Suggested in issue #5. |

## Verification

Added to `check.js`, all runnable with no agent installed:

- Both manifests and both marketplace files parse, carry the fields above, point at files
  that exist, and agree on the plugin name and path; the three versions agree; the Claude
  manifest has no `hooks` key.
- The hook run from a folder that is not inside the project (plugin mode), fed each
  agent's payload shape: nudges for a big unlabelled document under the root found from
  `CLAUDE_PROJECT_DIR`, from `COPILOT_PROJECT_DIR`, and from `cwd` in a git repository;
  stamps anchors into a sidecar under that root; ignores a file outside it.
- The same run against a project that has its own `.agents/hooks/markdown-labels.cjs`
  prints nothing.
- The existing checks that the installer's output matches the repository's own agent
  files keep passing against the moved templates.

Live, each in an isolated home under a scratch folder, before the PR leaves draft:

- `claude plugin validate --strict` on the plugin folder and `claude plugin validate .` on
  the repository pass.
- Claude Code with `--plugin-dir` in a scratch repository: the hook fires once on a Write,
  and the model invokes the skill from the nudge (one short paid run, cheap model).
- Copilot CLI with `--plugin-dir` and a scratch `COPILOT_HOME`: the hook fires once, from
  the Copilot-schema file.
- Codex with a scratch `CODEX_HOME`: `codex plugin marketplace add <local clone>`,
  `codex plugin add`, `hooks/list` shows the hook with source `plugin`; the trust prompt as
  a user sees it; `apply_patch`'s payload on the current release reaches the hook's parser.
- An awesome-copilot dry run of its quality gates against the plugin folder, if its
  tooling can be run locally.

## Open items, settled during implementation

Each has a fallback that keeps the design whole:

- **The plugin-root variable in the command.** Both agents document substituting it; if
  either passes the string to a shell unsubstituted on Windows, Claude Code gets the
  documented `command` + `args` form and Codex a file of its own.
- **Codex and a `local` source in a Git marketplace:** whether `codex plugin marketplace
  upgrade` alone picks up a new version. Fallback: `codex plugin remove` and `add`,
  documented.
- **Skill name under Claude Code**, as above.
- Codex's plugin system was verified on 0.155 alpha; the live run uses whatever is current
  (0.157 at the time of writing).

## Out of scope

- A one-shot installer that runs the three agents' install commands (approach B). Add if
  people ask.
- Cursor, Windsurf, Kiro and other agents' plugin systems. Cursor already reads Claude
  Code's per-repo hooks; a Cursor plugin manifest can follow the same pattern later.
- Any change to the extension, the sidecar format, or the skill's content.
