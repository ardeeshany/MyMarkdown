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
- Publishing: from this repository, installable straight from GitHub; public listings are
  covered in "Where to publish".

## Layout

`vscode-extension/agent-hooks/plugin/` is the plugin root, and becomes the only copy of the
hook script and the skill in the repository:

```
vscode-extension/agent-hooks/plugin/
  .claude-plugin/plugin.json        read by Claude Code, Copilot CLI, VS Code agent mode
  .codex-plugin/plugin.json         read by Codex
  hooks/hooks.json                  Claude-schema PostToolUse entry, for Claude Code and Codex
  hooks/copilot-hooks.json          the same entry in Copilot's schema
  hooks/markdown-labels.cjs         the hook (moved here from agent-hooks/files/)
  skills/markdown-labels/SKILL.md   the skill (moved here from agent-hooks/files/)
```

Plus two marketplace files at the repository root, so the plugin installs from GitHub:

```
.claude-plugin/marketplace.json     Claude Code and Copilot: plugins[0].source = "./vscode-extension/agent-hooks/plugin"
.agents/plugins/marketplace.json    Codex: its own format, source url = this repository
```

Why inside `agent-hooks/`: the npm package (`files` gains `plugin/`) and the VSIX (which
packs the whole extension folder) then ship the plugin with no copying. The per-repo
installer keeps its three config templates in `agent-hooks/files/` and copies the hook
and skill from `plugin/`. The repository's own `.agents/hooks/markdown-labels.cjs` and the
two `SKILL.md` copies stay what the installer produces; `check.js` already holds them
equal to the templates and keeps doing so against the new location.

The plugin's `version` in both manifests is the npm package's version. `check.js` holds the
three equal, so one bump moves all of them.

### Manifests

`.claude-plugin/plugin.json`:

```json
{
  "name": "mymarkdown",
  "version": "<package version>",
  "description": "Have coding agents label the Markdown they write, for the MyMarkdown VS Code extension.",
  "author": { "name": "MyMarkdown", "url": "https://github.com/ardeeshany/MyMarkdown" },
  "hooks": "./hooks/hooks.json"
}
```

`.codex-plugin/plugin.json`: the same fields plus `"skills": "./skills/"`, `"homepage"`,
`"repository"`, `"license": "MIT"` and an `interface` block (`displayName`,
`shortDescription`, `category`, `capabilities`), the shape the ponytail plugin ships and
Codex's marketplace reads.

`hooks/hooks.json` (Claude schema; Codex reads the same file, as ponytail's shared
`claude-codex-hooks.json` shows):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|apply_patch",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/markdown-labels.cjs\"",
            "commandWindows": "node \"$env:CLAUDE_PLUGIN_ROOT\\hooks\\markdown-labels.cjs\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

`hooks/copilot-hooks.json` (Copilot schema): one `postToolUse` entry with `bash` and
`powershell` commands running the same script via `${PLUGIN_ROOT}`, `timeoutSec: 15`.

The agent substitutes the plugin-root variable itself before the command runs, and Claude
Code takes a separate `commandWindows` for PowerShell (the shape ponytail ships; confirmed
against the hooks docs during implementation). So none of the per-repo configs' launcher
is needed here: a plugin always knows where its own files are.

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
repository is never nudged twice. The existing rule that keeps a second copy quiet under
Copilot (a Claude-format payload carrying `tool_result`) stays.

Thresholds, the stamping of anchors into agent-written sidecars, the dedupe of Copilot's
Claude-format copy, and the nudge text are unchanged. One check during implementation:
Claude Code lists a plugin's skill as `mymarkdown:markdown-labels`; if the nudge's
"markdown-labels skill" is not enough for Claude to invoke it, the hook names it in full
for Claude payloads (it already tells the payload dialects apart).

## Installing

```
Claude Code   claude plugin marketplace add ardeeshany/MyMarkdown
              claude plugin install mymarkdown@mymarkdown
Copilot CLI   copilot plugin install ardeeshany/MyMarkdown:vscode-extension/agent-hooks/plugin
Codex         codex plugin marketplace add ardeeshany/MyMarkdown
              codex plugin add mymarkdown@mymarkdown
VS Code       "chat.pluginLocations": { "<path to a clone of the plugin folder>": true }
```

Codex asks the user to approve the hook once (`/hooks`). VS Code's agent mode detects the
Claude-format folder itself; a clone is the target rather than Claude's install cache,
whose path carries the version. Update and uninstall are each agent's own commands
(`claude plugin update|uninstall`, `copilot plugin update|uninstall`, `codex plugin remove`).

## Verification

Added to `check.js`, all runnable with no agent installed:

- Both manifests parse, carry the required fields, and point at files that exist; both
  marketplace files parse and point at the plugin folder; the three versions agree.
- The hook run from a folder that is not inside the project (plugin mode), fed each
  agent's payload shape: nudges for a big unlabelled document under the root found from
  `CLAUDE_PROJECT_DIR`, from `COPILOT_PROJECT_DIR`, and from `cwd` in a git repository;
  stamps anchors into a sidecar under that root; ignores a file outside it.
- The same run against a project that has its own `.agents/hooks/markdown-labels.cjs`
  prints nothing.
- The existing checks that the installer's output matches the repository's own agent
  files keep passing against the moved templates.

Live, each in an isolated home under a scratch folder, before the PR leaves draft:

- `claude plugin validate` on the plugin folder passes.
- Claude Code with `--plugin-dir` in a scratch repository: the hook fires on a Write, and
  the model invokes the skill from the nudge (one short paid run, cheap model).
- Copilot CLI with `--plugin-dir` and a scratch `COPILOT_HOME`: which hooks file it loads,
  and that the hook fires once.
- Codex with a scratch `CODEX_HOME`: `codex plugin marketplace add <local clone>` and
  `codex plugin add`, then `hooks/list` shows the hook with source `plugin`; the trust
  prompt as a user sees it.

## Open items, settled during implementation

Each has a fallback that keeps the design whole:

- **Copilot's hook file.** Whether Copilot loads `hooks/hooks.json` (Claude schema) or
  `hooks/copilot-hooks.json` from a plugin. Both ship; if both fire, the hook's existing
  dedupe keeps one quiet, and the redundant file is dropped.
- **Codex and a subfolder.** Whether Codex's marketplace entry can point at a folder inside
  the repository. Fallback: users clone the repository and run
  `codex plugin marketplace add <clone>/vscode-extension/agent-hooks/plugin`, documented.
- **`${CLAUDE_PLUGIN_ROOT}` under Codex.** ponytail relies on it; confirmed by the Codex live
  run. Fallback: a `.codex-plugin` hook file of its own.
- **Skill name under Claude Code**, as above.
- Codex's plugin system was verified on 0.155 alpha; the live run uses whatever is current.

## Where to publish

Filled in from the venue research (see the PR description and the issue); summarised
here once settled.

## Out of scope

- A one-shot installer that runs the three agents' install commands (approach B). Add if
  people ask.
- Cursor, Windsurf, Kiro and other agents' plugin systems. Cursor already reads Claude
  Code's per-repo hooks; a Cursor plugin manifest can follow the same pattern later.
- Any change to the extension, the sidecar format, or the skill's content.
