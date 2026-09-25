# One plugin for the label hook, for every coding agent that can run it

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
- **Agents in scope:** Claude Code, Codex, Copilot CLI and VS Code agent mode, Cursor,
  Windsurf (now Devin Desktop), Augment and Qoder CLI, which all read the Claude plugin
  layout or something close; OpenCode and Antigravity, which need an adapter each; Kiro,
  which cannot run a nudging script and gets a hook file that asks the agent instead. Every
  other agent that loads skills from `~/.agents/skills` gets the skill alone, documented
  as one copy command. Gemini CLI (retired for consumers in June 2026), Continue
  (discontinued) and Aider (no hooks or skills) are out.

## What the research settled

The Claude plugin layout is the common currency. Cursor imports Claude Code's installed
plugins and reads `.claude-plugin/plugin.json` itself; Devin loads that manifest and
`hooks/hooks.json`; Augment and Qoder CLI too; Positron installs the same bundle (skills
only). So one folder in that layout, plus a root Agent Plugins 1.0 `plugin.json` for
Copilot, Codex and VS Code, covers nine agents. Two agents parse `hooks/hooks.json` with
a different schema and fail visibly (Antigravity's `agy`, Gemini CLI), so an agent with an
incompatible schema gets a folder of its own rather than a file in the shared one.

## Layout

`vscode-extension/agent-hooks/plugin/` is the plugin root and the only copy of the hook
script and the skill in the repository, apart from the repository's own per-repo install
and the Antigravity folder, which `check.js` holds equal to it:

```
vscode-extension/agent-hooks/plugin/
  plugin.json                       Agent Plugins 1.0: Copilot CLI, Codex, VS Code agent mode (also tolerated by Cursor, Devin, Antigravity)
  .claude-plugin/plugin.json        Claude Code; also read by Cursor, Devin, Augment, Positron
  .cursor-plugin/plugin.json        Cursor's own manifest, so it never files the folder as a skills-only Agent Plugin
  .qoder-plugin/plugin.json         Qoder CLI
  hooks/hooks.json                  Claude-schema PostToolUse entry: Claude Code loads it by location; Codex via the root manifest;
                                    Devin, Cursor (converted), Augment and Qoder by location
  hooks/markdown-labels.cjs         the hook
  com.github.copilot/hooks/hooks.json   the same entry in Copilot's flat schema
  opencode/mymarkdown.mjs           OpenCode plugin: wraps the hook (see Adapters)
  kiro/markdown-labels.json         Kiro hook file (see Adapters)
  skills/markdown-labels/SKILL.md   the skill
  README.md, LICENSE                copied with the plugin into install caches; files outside the folder are not

vscode-extension/agent-hooks/plugin-antigravity/
  plugin.json, hooks.json           Antigravity's own manifest and hook schema
  hooks/markdown-labels.cjs         copy of the hook, held equal by check.js
  skills/markdown-labels/SKILL.md   copy of the skill, held equal by check.js
```

Marketplace files at the repository root, so the plugin installs from GitHub:

```
.claude-plugin/marketplace.json     Claude Code, Copilot CLI, Cursor, Devin: source "./vscode-extension/agent-hooks/plugin"
.agents/plugins/marketplace.json    Codex: source {"source": "local", "path": "./vscode-extension/agent-hooks/plugin"}
.augment-plugin/marketplace.json    Augment: same relative source
```

All three use only fields every reader accepts and the same plugin name and path, since
several agents read more than one of them.

Why inside `agent-hooks/`: the npm package (`files` gains `plugin/`) and the VSIX (which
packs the whole extension folder) ship the plugin with no copying, and the npm package
doubles as the OpenCode plugin. The per-repo installer keeps its per-repo config
templates in `agent-hooks/files/` (gaining a Kiro one, whose command names the project's
own copy of the script) and copies the hook and the skill from `plugin/`.

### Names and versions

- Plugin: `mymarkdown`. Marketplace: `mymarkdown-plugins`, so users install
  `mymarkdown@mymarkdown-plugins` wherever a marketplace name is typed. A published plugin's
  name never changes (installed copies would be lost); display names carry any wording.
- One version: the npm package's, in every manifest and nowhere else (not in marketplace
  entries). `check.js` holds them all equal. A release bumps it; without a bump, agents
  that compare versions keep the old copy.

### Manifests

`plugin.json` (Agent Plugins 1.0; only its own fields at the top level):

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "mymarkdown",
  "version": "<package version>",
  "description": "Have coding agents label the Markdown they write, for the MyMarkdown VS Code extension. Runs a Node hook after each Markdown write; nothing leaves your machine. Requires Node.js 18 or later.",
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

`.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json` and `.qoder-plugin/plugin.json`:
`name`, `displayName`, `version`, `description`, `author`, `homepage`, `repository`,
`license`, `keywords`. **No `hooks` key** in any of them: each of these agents loads
`hooks/hooks.json` by its location, and Claude Code from 2.1.255 refuses a plugin that
declares that file twice.

`hooks/hooks.json` (Claude schema). One entry, whose matcher names every agent's write
tools, since the file is shared: Claude Code and Cursor `Write|Edit`; Codex matches
`Edit|Write` as its `apply_patch`; Devin `write|edit|apply_patch`; Augment
`save-file|str-replace-editor`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|write|edit|apply_patch|save-file|str-replace-editor",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/markdown-labels.cjs\"; exit 0", "timeout": 15 }
        ]
      }
    ]
  }
}
```

Every agent that reads this file sets `CLAUDE_PLUGIN_ROOT` (Cursor and Devin alongside
their own names), and `; exit 0` keeps a machine without Node from seeing an error after
every write. If any reader objects to the widened matcher, or reads `timeout` in
milliseconds (Augment's documentation suggests it might), that agent gets a hooks file of
its own declared in its manifest; the shared file stays as it is for the others.

`com.github.copilot/hooks/hooks.json` (Copilot's schema): one flat `postToolUse` entry with
`bash` and `powershell` commands running the same script via `${PLUGIN_ROOT}`,
`timeoutSec: 15`.

### Adapters

**OpenCode** (`opencode/mymarkdown.mjs`, and the npm package's `main` points at it). One ES
module in the shape both OpenCode generations accept: `server()` for 1.x returns a
`tool.execute.after` hook and pushes the skill folder onto `config.skills.paths`;
`setup(ctx)` for 2.x registers `ctx.tool.hook("execute.after")` and
`ctx.skill.transform`. After a `write`, `edit` or patch tool, it runs the hook script with
a Claude-shaped payload (path from the tool's arguments, `cwd` from the plugin's
`directory`), and appends the nudge to the tool result the model reads. Installed with
`opencode plugin add mymarkdown-hooks` (2.x) or a `plugin` entry in the global config (1.x),
the same npm package the CLI installer ships in.

**Antigravity** (`plugin-antigravity/`). Its hook schema has hook names as top-level keys
and `timeout` in seconds, its `PostToolUse` cannot inject context (its output must be
`{}`), and its `PostInvocation` can, through `injectSteps[].userMessage`. So two entries
run the same script: `PostToolUse` (matcher
`write_to_file|replace_file_content|multi_replace_file_content`) reads
`toolCall.args.TargetFile`, does the usual checks and stamping, and leaves a marker file
under the temp folder keyed by `conversationId`; `PostInvocation` reads and removes the
marker and prints the nudge as an injected user message. Hook commands run with the
folder holding `hooks.json` as their working directory and no plugin-root variable, so the
command is the relative `node hooks/markdown-labels.cjs`. Installed with
`agy plugin install https://github.com/ardeeshany/MyMarkdown/vscode-extension/agent-hooks/plugin-antigravity`,
which also serves the IDE (they share `~/.gemini/config/plugins/`); IDE-only users copy the
folder there.

**Kiro** (`kiro/markdown-labels.json`). Kiro's plugin format carries no hooks, and its
hooks discard a command's output after a write, so the nudge is a fixed prompt: a
`PostFileSave` hook (IDE) matching `*.md` with an `agent` action whose prompt says to run
the markdown-labels skill if the saved file is long and unlabelled, and a second
`PostFileSave` hook matching `.mymd/**/*.json` with a `command` action that runs the
script to stamp anchors. It is the per-repo installer's seventh target
(`.kiro/hooks/markdown-labels.json`), and globally the README says to copy it and the
script to `~/.kiro/hooks/` and the skill to `~/.kiro/skills/`, the only global locations
Kiro reads. Kiro CLI has no `PostFileSave`; it is IDE-only for now.

**Everything else.** Roo Code, Zed, Warp, Positron, Kilo, Amp, Pi and any agent that reads
`~/.agents/skills` get the skill from one command:
`cp -r <plugin>/skills/markdown-labels ~/.agents/skills/`. The agent then labels when the
skill's description matches, with no nudge.

## The hook

Changes in `markdown-labels.cjs`, and nothing else:

**Finding the project.** Today the root is two folders above the script, which is right
only when the script is inside the project. The hook decides by its own location:

- Its folder ends in `.agents/hooks` (installed in a project): root is two folders up, as
  today, with the existing Claude Code worktree remap.
- Otherwise (running as a plugin): the first of `CLAUDE_PROJECT_DIR`, `DEVIN_PROJECT_DIR`,
  `COPILOT_PROJECT_DIR`, `AUGMENT_PROJECT_DIR`, the payload's `workspace_roots[0]` or
  `workspacePaths[0]`, the nearest folder at or above the payload's `cwd` (or the written
  file) that contains `.git`, else `cwd`.

Files outside the root are ignored, as now. Sidecars go to `<root>/.mymd/`, which is where
the extension reads them when that root is the folder open in VS Code. In a monorepo where
VS Code is opened on a subfolder, the root found this way is the git top, the same caveat
the npx installer documents; the README says so.

**Yielding to a per-repo install.** Running as a plugin, if `<root>/.agents/hooks/markdown-labels.cjs`
exists the hook returns at once. The project's own hook handles that project, so a team
repository is never nudged twice. (Cursor may run both an imported Claude copy and a
Cursor-installed copy of the plugin; its documentation says a second `additional_context`
replaces the first, and the anchor stamping is idempotent.)

**Payload dialects.** Beside the existing Claude, Copilot and Codex shapes: Devin
(lowercase tool names; `apply_patch` as patch text; no `cwd`, so the root comes from the
environment), Cursor (`hook_event_name: "postToolUse"`; answer with a flat
`additional_context`), Augment (`file_changes[].path` under `workspace_roots[0]`), Qoder
CLI (Claude shape), Antigravity (`toolCall.args.TargetFile`, the marker bridge above, and
`{}` as the `PostToolUse` answer), Kiro (`PostFileSave`'s `file_path` and `cwd`, stamping
only), OpenCode (Claude shape, from the adapter).

**Naming the skill.** Agents list a plugin's skill differently: Claude Code and Devin as
`mymarkdown:markdown-labels`, Cursor as `/markdown-labels`. The nudge names it the way the
agent the payload came from lists it.

Thresholds, the stamping of anchors into agent-written sidecars, and the nudge text are
otherwise unchanged.

## The extension

One addition, so labels written without a hook survive edits: when `lensesFor` reads a
sidecar whose ranges carry no anchors, it writes the sidecar back through the existing
`writeSidecar` path, which stamps anchors and the hash. The watcher then sees a file that
is already anchored and does nothing more. Skills-only agents, Kiro's prompt-driven skill
runs and any hookless write are covered; the hook's own stamping stays, since it happens
sooner.

## Installing

```
Claude Code   claude plugin marketplace add ardeeshany/MyMarkdown
              claude plugin install mymarkdown@mymarkdown-plugins
Cursor        nothing more once installed in Claude Code (Cursor imports it); otherwise
              Customize → From GitHub Repository → ardeeshany/MyMarkdown, or agent → /plugin
Copilot CLI   copilot plugin marketplace add ardeeshany/MyMarkdown
              copilot plugin install mymarkdown@mymarkdown-plugins
VS Code       listed under Agent Plugins in the Extensions view once the plugin is on awesome-copilot (below);
              until then "chat.pluginLocations": { "<path to a clone of the plugin folder>": true }
Codex         codex plugin marketplace add ardeeshany/MyMarkdown
              codex plugin add mymarkdown@mymarkdown-plugins
              then, in the terminal app, /hooks: trust the hook once (the desktop app cannot)
Windsurf      devin plugins install ardeeshany/MyMarkdown#vscode-extension/agent-hooks/plugin
Augment       auggie plugin marketplace add ardeeshany/MyMarkdown
              auggie plugin install mymarkdown@mymarkdown-plugins
Qoder CLI     qoder plugins marketplace add ardeeshany/MyMarkdown
              qoder plugins install mymarkdown
OpenCode      opencode plugin add mymarkdown-hooks            (1.x: "plugin": ["mymarkdown-hooks"] in the global config)
Antigravity   agy plugin install https://github.com/ardeeshany/MyMarkdown/vscode-extension/agent-hooks/plugin-antigravity
Kiro          copy kiro/markdown-labels.json and hooks/markdown-labels.cjs to ~/.kiro/hooks/, skills/markdown-labels to ~/.kiro/skills/
Any other     cp -r skills/markdown-labels ~/.agents/skills/   (skill only, no nudge)
```

The marketplace route comes first where one exists. Adding a marketplace clones this
repository (about 10 MB; Claude Code users can pass
`--sparse vscode-extension/agent-hooks/plugin .claude-plugin`). Cursor's Cloud Agents and
Devin's cloud sessions never run user-scope plugin hooks; the per-repo install covers
them. Update and uninstall are each agent's own commands.

## Where to publish

Self-hosting is publishing: once the marketplace files are on `main`, every agent installs
from GitHub with no review. The public listings come after, each bound to an account, so
the maintainer (ardeeshany) submits; a contributor can prepare files and tags.

| Channel | Where | What it takes | Note |
| --- | --- | --- | --- |
| Copilot CLI and VS Code | `github/awesome-copilot`, the default marketplace in both | The "[External Plugin]" issue form: repo, plugin path, an immutable tag or commit, semver version equal to `plugin.json`, license, keywords. Automated gates need the root `plugin.json`. | Approvals close in 0–9 days (median 1). The only way the plugin appears in VS Code's Extensions view. `github/copilot-plugins` takes no submissions. |
| Claude Code | Anthropic's community marketplace, via `platform.claude.com/plugins/submit` from a Console org | Public repo, `claude plugin validate --strict` clean, reviewed against a published rubric. | **Decision:** the rubric fails a `PostToolUse` hook "without a project-relevance gate", and we chose global-everywhere. Self-host now, submit once v0.1 is out with the description stating exactly what the hook does, and add an opt-in gate only if rejected. `claude-plugins-official` is Anthropic-only. |
| Cursor | Self-hosted, and the Claude import | — | `cursor.com/marketplace` is curated and partner-oriented; every listing and update is reviewed by hand. |
| Windsurf (Devin) | `github.com/CognitionAI/devin-marketplace`, by pull request | An entry pinned to a commit. | Accepts third-party entries. |
| Codex, Augment, Qoder, Antigravity, Kiro | Self-hosted only | — | OpenAI's directory would strip the hook and needs a verified business identity; the others have no registry for hooks. |
| OpenCode | npm (the same `mymarkdown-hooks` package), and a pull request to the docs' Ecosystem list | — | No review of hooks. |
| `mymarkdown-hooks` (npm) | npmjs.com, from the maintainer's account | A person with 2FA runs `npm publish` once (a first publish cannot be done from CI), then a Trusted Publisher for later releases. Before #6 merges, since its README tells people to run it. | Add "not affiliated with the `mymarkdown-cli` or `mymarkdown-mcp` packages" to the README. |
| The extension | Open VSX (the extension is already on the VS Code Marketplace) | Eclipse account, publisher agreement, `ovsx create-namespace mymarkdown`, `ovsx publish <vsix>`; then the "Claim namespace ownership" issue, filed by the repository owner. | Claims close in 0–9 days. Suggested in issue #5. |

## Verification

Added to `check.js`, all runnable with no agent installed:

- Every manifest and marketplace file parses, carries the fields above, points at files
  that exist, and agrees on the plugin name, path and version; no Claude-family manifest
  declares `hooks`; the Antigravity copies of the hook and skill match the plugin's.
- The hook run from a folder that is not inside the project (plugin mode), fed each
  agent's payload shape (Claude, Copilot, Codex, Devin, Cursor, Augment, Qoder,
  Antigravity's two events, Kiro's `PostFileSave`): nudges for a big unlabelled document
  under the root found from each environment variable and from `cwd` in a git repository,
  in that agent's output format; stamps anchors into a sidecar under that root; ignores a
  file outside it; Antigravity's marker round-trip.
- The same run against a project that has its own `.agents/hooks/markdown-labels.cjs`
  prints nothing.
- The OpenCode adapter, loaded in a stub of each API generation, forwards a write and
  appends the nudge to the tool result.
- The extension stamps anchors into an unanchored sidecar on read, once.
- The existing checks that the installer's output matches the repository's own agent
  files keep passing against the moved templates, with the Kiro target added.

Live, each in an isolated home under a scratch folder, before the PR leaves draft:

- `claude plugin validate --strict` on the plugin folder and `claude plugin validate .` on
  the repository pass.
- Claude Code with `--plugin-dir` in a scratch repository: the hook fires once on a Write,
  and the model invokes the skill from the nudge (one short paid run, cheap model).
- Copilot CLI with `--plugin-dir` and a scratch `COPILOT_HOME`: the hook fires once, from
  the Copilot-schema file.
- Codex with a scratch `CODEX_HOME`: marketplace add from a local clone, `codex plugin add`,
  `hooks/list` shows the hook with source `plugin`; the trust prompt; `apply_patch`'s
  payload on the current release reaches the hook's parser.
- Cursor CLI `agent --plugin-dir` in a scratch home: the converted hook fires and
  `additional_context` reaches the model. Cursor is not installed on this machine; this
  needs the maintainer or a machine with it.
- Devin, OpenCode, Antigravity (`agy plugin validate` and an install), Augment, Qoder and
  Kiro are not installed here, and Devin needs an account. Their adapters are verified by
  replaying documented payloads and by the schema checks; the PR says so, and their
  install lines are marked as untested until someone runs them.

## Open items, settled during implementation

Each has a fallback that keeps the design whole:

- **The shared matcher and timeout unit.** Whether Cursor's converter, Augment and Devin
  accept the widened matcher, and whether Augment reads `timeout` in milliseconds.
  Fallback: that agent's own hooks file, declared in its manifest.
- **The plugin-root variable in the command.** Documented by every reader; if one passes
  it to a shell unsubstituted on Windows, that agent gets a file of its own.
- **Codex and a `local` source in a Git marketplace:** whether `codex plugin marketplace
  upgrade` alone picks up a new version. Fallback: `codex plugin remove` and `add`.
- **Qoder's marketplace file format** is undocumented; fallback: install from the plugin
  path.
- **Antigravity's nested GitHub subpath** in `agy plugin install`; fallback: install from a
  clone.
- **Skill names** per agent, as above.
- Codex's plugin system was verified on 0.155 alpha; the live run uses whatever is current.

## Out of scope

- A one-shot installer that runs every agent's install command (approach B). Add if people
  ask.
- Adapters for Gemini CLI, Pi, Kilo, Amp, Trae, Cline and Junie; they get the skills-only
  line where they read `~/.agents/skills`. Continue and Aider are discontinued or hookless.
- Any change to the sidecar format or the skill's content.
