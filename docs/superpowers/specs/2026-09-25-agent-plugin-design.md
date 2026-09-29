# One plugin for the label hook, for every coding agent that can run it

Revised 2026-09-29 after the PR audit: this describes the shipped design.

**Status:** implemented. Branch `feat/agent-plugin`, stacked on PR #6.

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
  which cannot pass a script's output on and gets a hook file that asks the agent instead. Every
  other agent that loads skills from `~/.agents/skills` gets the skill alone, documented
  as one copy command. Gemini CLI (retired for consumers in June 2026), Continue
  (discontinued) and Aider (no hooks or skills) are out.

## What the research settled

The Claude plugin layout is the common currency. Claude Code, Copilot CLI, Codex, Devin,
Augment and Qoder CLI all load `.claude-plugin/plugin.json` (or a manifest of their own
beside it) and the shared `hooks/hooks.json`; Cursor reads its own manifest first and is
pointed at a hooks file in its own format. The first draft also shipped an Agent Plugins
1.0 root `plugin.json` for Copilot, Codex and VS Code; the audit showed that Codex discards
every hook of a plugin whose root manifest is in that format, and VS Code does not
substitute its plugin root in it, so it is gone. An agent whose hook schema is incompatible
with the shared file (Antigravity's `agy`) gets a folder of its own.

## Layout

`vscode-extension/agent-hooks/plugin/` is the plugin root and the only copy of the hook
script and the skill in the repository, apart from the repository's own per-repo install
and the Antigravity folder, which `check.js` holds equal to it:

```
vscode-extension/agent-hooks/plugin/
  .claude-plugin/plugin.json        Claude Code; also read by Copilot CLI (a legacy plugin), Devin, Augment, Positron
  .codex-plugin/plugin.json         Codex: the same fields plus its install-surface `interface`
  .cursor-plugin/plugin.json        Cursor, read before the others; its `hooks` key points at cursor/hooks.json
  .qoder-plugin/plugin.json         Qoder CLI
  hooks/hooks.json                  the shared Claude-schema PostToolUse entry, loaded by its location
  hooks/markdown-labels.cjs         the hook
  cursor/hooks.json                 Cursor's own format (outside hooks/, see below)
  opencode/mymarkdown.mjs           OpenCode plugin: wraps the hook (see Adapters)
  kiro/markdown-labels.json         Kiro hook file (see Adapters)
  skills/markdown-labels/SKILL.md   the skill
  README.md, LICENSE                copied with the plugin into install caches; files outside the folder are not

vscode-extension/agent-hooks/plugin-antigravity/
  plugin.json, hooks.json           Antigravity's own manifest and hook schema
  hooks/markdown-labels.cjs         copy of the hook, held equal by check.js
  skills/markdown-labels/SKILL.md   copy of the skill, held equal by check.js
```

What is not there, and why:

- **No Agent Plugins 1.0 root `plugin.json`.** Codex discards the hooks of a plugin in that
  format, and VS Code neither sets nor substitutes a plugin root for it, so the command
  could not find the script (audit; Codex's shipped binary). Codex's `interface` metadata
  moved to `.codex-plugin/plugin.json`, which Codex reads before `.claude-plugin`.
- **No `com.github.copilot/hooks/hooks.json`.** Copilot CLI reads that file only for an
  Agent Plugins plugin; for a legacy plugin it reads `hooks/hooks.json` in the Claude
  schema (live probe).
- **Cursor's file is not under `hooks/`.** Augment ignores manifest `hooks` keys and loads
  every `*.json` under `hooks/`, so a second file there would run twice for Augment
  (Augment's shipped code). Cursor finds `cursor/hooks.json` through its manifest's
  `hooks` key, which replaces its default discovery (Cursor's docs and shipped CLI).

Marketplace files at the repository root, so the plugin installs from GitHub:

```
.claude-plugin/marketplace.json     Claude Code, Copilot CLI, Devin: source "./vscode-extension/agent-hooks/plugin"
.cursor-plugin/marketplace.json     Cursor: source "vscode-extension/agent-hooks/plugin", owner name only
.agents/plugins/marketplace.json    Codex: source {"source": "local", "path": "./vscode-extension/agent-hooks/plugin"}
.augment-plugin/marketplace.json    Augment: same relative source, with the version
```

All use the same marketplace name, plugin name and path, since several agents read more
than one of them. Cursor reads `.cursor-plugin/marketplace.json` before Claude's, and its
official schema allows only `name` and `email` in `owner` and only `name`, `source` and
`description` in an entry, so it keeps a file of its own (cursor/plugins schemas).

Why inside `agent-hooks/`: the npm package (`files` gains `plugin/`) and the VSIX (which
packs the whole extension folder) ship the plugin with no copying, and the npm package
doubles as the OpenCode plugin. The per-repo installer keeps its per-repo config
templates in `agent-hooks/files/` (gaining a Kiro one, whose command names the project's
own copy of the script) and copies the hook and the skill from `plugin/`.

### Names and versions

- Plugin: `mymarkdown`. Marketplace: `mymarkdown-plugins`, so users install
  `mymarkdown@mymarkdown-plugins` wherever a marketplace name is typed. A published plugin's
  name never changes (installed copies would be lost); display names carry any wording.
- One version: the npm package's, in every manifest. Marketplace entries carry none,
  except that Augment's marketplace format itself carries it, at the top and in its entry;
  `check.js` holds every copy equal. A release bumps it; without a bump, agents that
  compare versions keep the old copy.

### Manifests

`.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json` and `.qoder-plugin/plugin.json`:
`name`, `displayName`, `version`, `description`, `author`, `homepage`, `repository`,
`license`, `keywords`. Cursor's `author` has no `url`, which its schema forbids.
`.codex-plugin/plugin.json`: `name`, `version`, `description`, `keywords` and Codex's
`interface` (`displayName`, `shortDescription`, `category: "Developer Tools"`,
`capabilities: ["Skills", "Lifecycle hooks"]`).

Only Cursor's manifest has a `hooks` key (`"./cursor/hooks.json"`). Every other agent loads
`hooks/hooks.json` by its location, and Claude Code from 2.1.255 refuses a plugin that
declares that file twice.

`hooks/hooks.json` (Claude schema). One entry, whose matcher names every reader's write
tools, since the file is shared: Claude Code `Write|Edit`; Codex matches `Edit|Write` as its
`apply_patch`; Devin `write|edit|apply_patch`; Augment `save-file|str-replace-editor`;
Copilot CLI `create|str_replace_editor` (and `edit`):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|write|edit|apply_patch|save-file|str-replace-editor|create|str_replace_editor",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/markdown-labels.cjs\"; exit 0" }
        ]
      }
    ]
  }
}
```

No `timeout`: Augment reads it in milliseconds, so 15 killed the hook before Node started,
and every reader has a sane default (Augment's shipped code). `; exit 0` keeps a machine
without Node from seeing an error after every write.

Every agent that reads this file sets `CLAUDE_PLUGIN_ROOT`: Claude Code and Codex document
it; Copilot CLI sets it for plugin hooks; Qoder CLI sets it in its shipped code, though its
docs name only `QODER_PLUGIN_ROOT`; Augment documents it as an alias of its own names; Devin
sets it since CLI v3000.5.20, the release that also made it run plugin hooks.

`cursor/hooks.json` (Cursor's schema): `version: 1`, one `postToolUse` entry with matcher
`Write` (the one tool name Cursor gives every agent write and edit),
`node "${CURSOR_PLUGIN_ROOT}/hooks/markdown-labels.cjs"` and `timeout: 15` (seconds). Cursor
substitutes the placeholder before the shell runs, and the native file does not depend on
its undocumented conversion of Claude-format plugin hooks, which older builds lacked
(Cursor's shipped CLI and IDE; superpowers #709).

### Adapters

**OpenCode** (`opencode/mymarkdown.mjs`, and the npm package's `main` points at it). One ES
module in the shape both OpenCode lines accept: 1.x (the `opencode-ai` package) calls
`server()`, which returns a `tool.execute.after` hook and pushes the skill folder onto
`config.skills.paths`; 2.x (`@opencode/cli`, with the `@opencode/plugin` API) calls
`setup(ctx)`, which registers `ctx.tool.hook("execute.after")` and adds the skill through
`ctx.skill.transform`, named from its front matter. After a `write`, `edit`, `apply_patch`
or `patch` tool, it runs the hook script with a Claude-shaped payload and appends the nudge
to the tool result the model reads. The payload's `cwd` is the instance `directory`
(`ctx.location.directory` in 2.x), not `worktree`: both lines resolve a relative path
against the directory, and 1.x's `worktree` is the git root, or `/` outside git (OpenCode's
shipped code). The hook is spawned beside itself, with the other agents' six
`*_PROJECT_DIR` variables removed, so a project-local `node` on Windows is never picked up
and an OpenCode started inside another agent's session does not inherit that agent's
project. Installed with `"plugin": ["mymarkdown-hooks"]` in `~/.config/opencode/opencode.json`
or a project's `opencode.json` (both lines read it; 2.x folds `plugin` into `plugins`), or
with `opencode plugin -g mymarkdown-hooks` (1.x) or `opencode plugin add mymarkdown-hooks`
(2.x): the same npm package the CLI installer ships in.

**Antigravity** (`plugin-antigravity/`). Its hook schema has hook names as top-level keys
and `timeout` in seconds, and its `PostToolUse` cannot inject context (its output must be
`{}`). So three entries run the same script: `PostToolUse` (matcher
`write_to_file|replace_file_content|multi_replace_file_content`) reads
`toolCall.args.TargetFile`, does the usual checks and stamping, and appends the nudge to a
marker file keyed by `conversationId` in a per-user folder under the temp directory;
`PreInvocation` (run with `--ephemeral`) answers `injectSteps[].ephemeralMessage`, the slot
known to reach the model, and `PostInvocation` answers `injectSteps[].userMessage`, since
the docs disagree on when it fires. Whichever runs first consumes the marker, so the nudge
arrives once. Hook commands run with the folder holding `hooks.json` as their working
directory and no plugin-root variable, so the command is the relative
`node hooks/markdown-labels.cjs`. Installed with
`agy plugin install https://github.com/ardeeshany/MyMarkdown/vscode-extension/agent-hooks/plugin-antigravity`
(which needs git), or by copying the folder to `~/.gemini/config/plugins/mymarkdown/`,
which the IDE shares; then Antigravity is restarted.

**Kiro** (`kiro/markdown-labels.json`). Kiro's plugin format carries no hooks, and on
`PostFileSave` it discards a command's output and exit code, so the nudge is a fixed prompt
(Kiro IDE 1.1.70 and kiro-cli 2.25.0, shipped code). The shipped payload is
`{session_id, hook_event_name: "PostFileSave", cwd, file_path}`: `cwd` is the first
workspace root and `file_path` is the path as the model passed it, often absolute but
possibly relative to that root. Two `PostFileSave` hooks: one matching Markdown files with
an `agent` action whose prompt says to run the markdown-labels skill if the saved file is
long and unlabelled (Kiro appends the payload, so the prompt says where `file_path` and
`cwd` come from), and one matching a sidecar under `.mymd/` with a `command` action that runs the
script to stamp anchors. Kiro compiles matchers with no flags, so they are case-sensitive:
the Markdown matcher spells each extension with character classes, and the sidecar matcher
also matches a path that starts with `.mymd`. Commands run through `/bin/sh` or, on
Windows, cmd.exe, which expands no `$HOME` and treats `;` as text, so the global command is
a `node -e` launcher that finds the home folder itself. Kiro reads skills only from
`.kiro/skills` and `~/.kiro/skills`, never `.agents/skills` or `.claude/skills`. So the
per-repo installer writes `.kiro/hooks/markdown-labels.json` and
`.kiro/skills/markdown-labels/SKILL.md` (eight files in all), and globally the README says
to copy the hook file and the script to `~/.kiro/hooks/` and the skill to `~/.kiro/skills/`,
as copies rather than symlinks. The Kiro IDE runs them; kiro-cli only on its v3 engine
(`kiro-cli --v3`), whose shipped code fires the same post-file hooks.

**Everything else.** Roo Code, Zed, Warp, Positron, Kilo, Amp, Pi and any agent that reads
`~/.agents/skills` get the skill from one command:
`cp -r <plugin>/skills/markdown-labels ~/.agents/skills/`. The agent then labels when the
skill's description matches, with no nudge.

## The hook

Changes in `markdown-labels.cjs`, and nothing else:

**Finding the project.** The hook decides by its own location:

- Its folder ends in `.agents/hooks` (installed in a project): root is two folders up, with
  the existing Claude Code worktree remap.
- Kiro: its `cwd`, which is always its first workspace root and where the skill writes
  `.mymd/`, even when the git top sits above it.
- Otherwise (running as a plugin): the first of `CLAUDE_PROJECT_DIR`, `QODER_PROJECT_DIR`,
  `DEVIN_PROJECT_DIR`, `COPILOT_PROJECT_DIR`, `AUGMENT_PROJECT_DIR`, `CURSOR_PROJECT_DIR`,
  the payload's `workspace_roots[0]` or `workspacePaths[0]`, else the top of the git
  repository around the payload's `cwd` (or the written file), else the working folder.

Files outside the root are ignored. Sidecars go to `<root>/.mymd/`, which is where the
extension reads them when that root is the folder open in VS Code; the README says to open
that folder.

**Relative paths** resolve against the payload's `cwd`. Cursor has run plugin hooks with the
plugin folder as `cwd` (and 2.5.x with the project), so its `cwd` is trusted only when it is
inside the project; otherwise the root is the base.

**Yielding to a per-repo install.** Running as a plugin, if `<root>/.agents/hooks/markdown-labels.cjs`
exists the hook stays quiet, for the agents that also run those per-project files: Claude
Code, Codex, Copilot CLI and VS Code agent mode, Cursor and Kiro. Devin, Augment, Qoder
(which loads hooks only from `.qoder/settings*.json`), Antigravity and OpenCode run no
per-repo copy and never yield. Next to the older `.claude/hooks` per-repo layout, which
Claude Code and Cursor run and which nudges but never stamps, the plugin leaves only the
nudge to it and still stamps sidecars.

**Payload dialects.** Beside the existing Claude, Copilot and Codex shapes: Copilot CLI
running the shared Claude-schema file (told apart by `tool_result`, which only it sends;
answered with a top-level `additionalContext`, the only field it passes on), Devin
(lowercase tool names; `apply_patch` as patch text; no `cwd`), Cursor
(`hook_event_name: "postToolUse"` or `cursor_version`; answered with a flat
`additional_context`), Augment (`file_changes[].path` under `workspace_roots[0]`), Qoder CLI
(a payload identical to Claude Code's, told apart by `QODER_HOOK_SOURCE` or
`QODER_PROJECT_DIR`, which it sets only for hook subprocesses), Antigravity
(`toolCall.args.TargetFile`, the marker bridge above, and `{}` as the `PostToolUse`
answer), Kiro (`PostFileSave`'s `file_path` and `cwd`, stamping only), OpenCode (Claude
shape with `agent: "opencode"`, from the adapter).

**Naming the skill.** Agents list a plugin's skill differently: Claude Code, Devin, Qoder,
Augment and Antigravity as `mymarkdown:markdown-labels` (Qoder's Skill tool matches only
that exact name), Cursor as `/markdown-labels`, and the others, and every per-repo copy, as
`markdown-labels`. The nudge names it the way the agent the payload came from lists it.

Thresholds, the stamping of anchors into agent-written sidecars, and the nudge text are
otherwise unchanged.

## The extension

One addition, so labels written without a hook survive edits: when `lensesFor` reads a
sidecar with a range that can gain an anchor on the current text, `Labels.stampAnchors`
adds anchors to the raw sidecar exactly as the hook's `stamp()` does and changes nothing
else. The first draft rewrote the file from the reader's sanitised view, which deleted
stale ranges, lenses past the caps and unknown fields from the agent's file; the audit
removed that. The stamp runs only while labels are enabled, re-reads the file first and
leaves it alone if the agent changed it since, keeps the lens cache (the stamped file reads
back at the same positions), and never runs from a label command's own read, whose write
would otherwise be undone. Skills-only agents, Kiro's prompt-driven skill runs and any
hookless write are covered; the hook's own stamping stays, since it happens sooner.

## Installing

```
Claude Code   claude plugin marketplace add ardeeshany/MyMarkdown
              claude plugin install mymarkdown@mymarkdown-plugins
Cursor        Customize → Browse Marketplace → + Add Marketplace → Import from GitHub →
              https://github.com/ardeeshany/MyMarkdown (needs a signed-in account)
              Already installed in Claude Code? Skip this: Cursor imports it and runs the same hook.
Copilot CLI   copilot plugin marketplace add ardeeshany/MyMarkdown
              copilot plugin install mymarkdown@mymarkdown-plugins
VS Code       listed under Agent Plugins in the Extensions view once the plugin is on awesome-copilot (below);
              until then "chat.pluginLocations": { "<path to a clone of the plugin folder>": true }
Codex         codex plugin marketplace add ardeeshany/MyMarkdown
              codex plugin add mymarkdown@mymarkdown-plugins
              then, in the terminal app, /hooks: trust the hook once (the desktop app cannot)
Windsurf      devin plugins install ardeeshany/MyMarkdown#vscode-extension/agent-hooks/plugin
              (Devin CLI v3000.5.20 or later runs a plugin's hooks)
Augment       auggie plugin marketplace add ardeeshany/MyMarkdown
              auggie plugin install mymarkdown@mymarkdown-plugins
Qoder CLI     qoder plugins marketplace add ardeeshany/MyMarkdown
              qoder plugins install mymarkdown
OpenCode      add "plugin": ["mymarkdown-hooks"] to ~/.config/opencode/opencode.json (or a project's opencode.json);
              or run opencode plugin -g mymarkdown-hooks (1.x) or opencode plugin add mymarkdown-hooks (2.x)
Antigravity   agy plugin install https://github.com/ardeeshany/MyMarkdown/vscode-extension/agent-hooks/plugin-antigravity
              (needs git), or copy that folder to ~/.gemini/config/plugins/mymarkdown/; then restart Antigravity
Kiro          copy kiro/markdown-labels.json and hooks/markdown-labels.cjs to ~/.kiro/hooks/, and
              skills/markdown-labels to ~/.kiro/skills/ (copies, not symlinks); kiro-cli only with --v3
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
| Copilot CLI and VS Code | `github/awesome-copilot`, the default marketplace in both | The "[External Plugin]" issue form: repo, plugin path, an immutable tag or commit, semver version equal to the manifests', license, keywords. The listing now points at a Claude-layout plugin: there is no Agent Plugins root `plugin.json` (see Layout), so any gate that expects one needs the maintainer to say so in the issue. | Approvals close in 0–9 days (median 1). The only way the plugin appears in VS Code's Extensions view. `github/copilot-plugins` takes no submissions. |
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
  that exist, and agrees on the plugin name, path and version; only Cursor's manifest
  declares `hooks`; there is no root `plugin.json` or `com.github.copilot/`;
  `hooks/hooks.json` has no `timeout` and is the only JSON file under `hooks/`; the
  Antigravity copies of the hook and skill match the plugin's.
- The hook run from a folder that is not inside the project (plugin mode), fed each
  agent's payload shape (Claude, Copilot in both formats, Codex, Devin, Cursor, Augment,
  Qoder, Antigravity's three events, Kiro's `PostFileSave`): nudges for a big unlabelled document
  under the root found from each environment variable and from `cwd` in a git repository,
  in that agent's output format; stamps anchors into a sidecar under that root; ignores a
  file outside it; Antigravity's marker round-trip.
- The same run against a project that has its own `.agents/hooks/markdown-labels.cjs`
  prints nothing.
- The OpenCode adapter, loaded in a stub of each API generation, forwards a write and
  appends the nudge to the tool result.
- The extension stamps anchors into an unanchored sidecar on read, once, adding only the
  anchors, and not while labels are disabled.
- The existing checks that the installer's output matches the repository's own agent
  files keep passing against the moved templates, with the Kiro target added.

Live, each in an isolated home under a scratch folder, before the PR leaves draft:

- `claude plugin validate --strict` on the plugin folder and `claude plugin validate .` on
  the repository pass.
- Claude Code with `--plugin-dir` in a scratch repository: the hook fires once on a Write,
  and the model invokes the skill from the nudge (one short paid run, cheap model).
- Copilot CLI with `--plugin-dir` and a scratch `COPILOT_HOME`: the hook fires once, from
  the shared `hooks/hooks.json`.
- Codex with a scratch `CODEX_HOME`: marketplace add from a local clone, `codex plugin add`,
  `hooks/list` shows the hook with source `plugin`; the trust prompt; `apply_patch`'s
  payload on the current release reaches the hook's parser.
- Cursor CLI `agent --plugin-dir` in a scratch home: the `cursor/hooks.json` hook fires and
  `additional_context` reaches the model. Cursor is not installed on this machine; this
  needs the maintainer or a machine with it.
- Devin, OpenCode, Antigravity (`agy plugin validate` and an install), Augment, Qoder and
  Kiro are not installed here, and Devin needs an account. Their adapters are verified by
  replaying documented payloads and by the schema checks; the PR says so, and their
  install lines are marked as untested until someone runs them.

## Open items, settled during implementation

Each has a fallback that keeps the design whole:

- **The shared matcher and timeout unit.** Settled: Augment reads `timeout` in
  milliseconds, so the shared file has none; Cursor gets its own file through its manifest.
  Augment ignores manifest hooks and loads every JSON file under `hooks/`, so a per-agent
  file for it would have to replace the shared one.
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
