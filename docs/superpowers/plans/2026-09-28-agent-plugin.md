# Agent Plugin Implementation Plan

> Some decisions here were revised by the fix wave of 2026-09-29 after the PR audit; the design spec describes the shipped result.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the label hook and skill once per machine, through each agent's own plugin system, so every project gets labelled with no per-repo files.

**Architecture:** One plugin folder in the Claude plugin layout (`vscode-extension/agent-hooks/plugin/`) plus a root Agent Plugins 1.0 manifest covers Claude Code, Codex, Copilot, VS Code, Cursor, Windsurf/Devin, Augment and Qoder; the hook learns to find the project from the agent's context and to speak each agent's payload dialect. OpenCode gets a JS adapter in the same npm package, Antigravity a sibling folder with its own hook schema, Kiro a hook file. The extension stamps anchors into unanchored sidecars so hookless labels survive edits.

**Tech Stack:** Node 18+ (CommonJS for the hook and installer, one ES module for OpenCode), VS Code extension API, `check.js` (the repo's own zero-dependency check runner), git.

**Spec:** `docs/superpowers/specs/2026-09-25-agent-plugin-design.md`

## Global Constraints

- Plugin name `mymarkdown`; marketplace name `mymarkdown-plugins`; install id `mymarkdown@mymarkdown-plugins`. Never rename after publishing.
- One version for everything: `vscode-extension/agent-hooks/package.json`'s `version`, mirrored in every manifest. Never in a Claude marketplace entry.
- No `hooks` key in `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json` or `.qoder-plugin/plugin.json` (those agents load `hooks/hooks.json` by location; Claude Code ≥ 2.1.255 refuses a plugin that declares that file twice).
- Every hook command ends in `; exit 0` and the description says "Requires Node.js 18 or later".
- `hooks/hooks.json` matcher: `Write|Edit|write|edit|apply_patch|save-file|str-replace-editor`. Timeout 15 (seconds). Copilot file: `timeoutSec: 15`. Antigravity file: `timeout: 15`.
- The plugin folder is the only copy of the hook and skill, apart from the repo's own per-repo install (`.agents/hooks`, `.agents/skills`, `.claude/skills`) and `plugin-antigravity/`, all held byte-equal by `check.js`.
- `check.js` runs with `node vscode-extension/check.js` from the repo root and must end with `MyMarkdown checks: N passed` and exit 0 after every task. Every new check must fail against the code before its task (say how in the step).
- Never write into the real home folder from checks: use `withFakeHome`, `scratchProject()` and `hookRepo()` (all in `check.js`).
- Commit after every task with a message in the repo's style (a sentence saying what and why; end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`). Never push; the last task pushes.
- Work on branch `feat/agent-plugin` in `/mnt/fast/python_projects/MyMarkdown-fork`. The untracked `vscode-extension/mymarkdown-0.2.2.vsix` is a local build; leave it alone and never commit it.

## Review Focus

1. A Cursor plugin hook runs with the plugin's install folder as `cwd`, not the project. A relative `file_path` or a root taken from `process.cwd()` would put sidecars in `~/.cursor/plugins/...`. Test in Task 4 (Cursor dialect: root from the payload's `workspace_roots[0]` and `cwd`, never `process.cwd()`).
2. Devin's `apply_patch` payload may carry the patch as a bare string or under a key nobody has confirmed; a wrong guess makes every Devin patch silent. Test in Task 4 (both shapes).
3. Antigravity's `PostToolUse` fires with `toolCall: null` on non-tool steps; a crash there prints an error on every step. Test in Task 5.
4. Two copies of the plugin can run in one Cursor session (imported from Claude Code and installed natively); the anchor stamping must be idempotent so the second run changes nothing. Test in Task 3 (stamp twice, file identical).
5. The extension's new stamp-on-read must not loop with the watcher: stamp → watcher event → reread → (already anchored) → stop. Test in Task 8 (exactly one write).

---

### Task 1: The plugin folder, its manifests, and the installer reading from it

**Files:**
- Create: `vscode-extension/agent-hooks/plugin/plugin.json`
- Create: `vscode-extension/agent-hooks/plugin/.claude-plugin/plugin.json`
- Create: `vscode-extension/agent-hooks/plugin/.cursor-plugin/plugin.json`
- Create: `vscode-extension/agent-hooks/plugin/.qoder-plugin/plugin.json`
- Create: `vscode-extension/agent-hooks/plugin/README.md`
- Create: `vscode-extension/agent-hooks/plugin/LICENSE` (copy of `vscode-extension/agent-hooks/LICENSE`)
- Move: `vscode-extension/agent-hooks/files/markdown-labels.cjs` → `vscode-extension/agent-hooks/plugin/hooks/markdown-labels.cjs`
- Move: `vscode-extension/agent-hooks/files/SKILL.md` → `vscode-extension/agent-hooks/plugin/skills/markdown-labels/SKILL.md`
- Modify: `vscode-extension/agent-hooks/install.js` (TARGETS `from` values; template lookup)
- Modify: `vscode-extension/agent-hooks/package.json` (`files`, `description`, `keywords`)
- Modify: `vscode-extension/check.js` (the `template()` helper and the "npm package ships everything" check; new manifest check)

**Interfaces:**
- Produces: `install.js` exports `TARGETS` entries whose `from` is a path relative to `agent-hooks/` (e.g. `plugin/hooks/markdown-labels.cjs`), and a new export `PLUGIN_DIR` (absolute path of `agent-hooks/plugin`). `check.js` gains `readJson(relPathFromExtensionDir)`.

- [ ] **Step 1: Write the failing check for the manifests**

Add to `vscode-extension/check.js`, just before the line `const Hooks = require("./agent-hooks/install.js");`:

```js
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, rel), "utf8"));
const PLUGIN = "agent-hooks/plugin";
const PKG_VERSION = readJson("agent-hooks/package.json").version;

check("plugin manifests: one name, one version, every field the listings ask for, and no hooks key where it would double", () => {
  const root = readJson(PLUGIN + "/plugin.json");
  assert(root.$schema === "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "root manifest schema");
  assert(root.name === "mymarkdown" && root.version === PKG_VERSION, "root name/version");
  for (const key of ["description", "author", "homepage", "repository", "license", "keywords"]) assert(root[key], "root manifest lacks " + key);
  assert(/Node\.js 18/.test(root.description), "the description must say Node.js 18 or later is required");
  assert(root.extensions && root.extensions["com.openai"] && root.extensions["com.openai"].hooks === "./hooks/hooks.json", "Codex reads hooks through extensions.com.openai");
  for (const file of [".claude-plugin/plugin.json", ".cursor-plugin/plugin.json", ".qoder-plugin/plugin.json"]) {
    const m = readJson(PLUGIN + "/" + file);
    assert(m.name === "mymarkdown" && m.version === PKG_VERSION, file + " name/version");
    assert(!("hooks" in m), file + " must not declare hooks: hooks/hooks.json is loaded by its location");
    for (const key of ["description", "author", "license"]) assert(m[key], file + " lacks " + key);
  }
  for (const file of ["README.md", "LICENSE", "hooks/markdown-labels.cjs", "skills/markdown-labels/SKILL.md"]) {
    assert(fs.existsSync(path.join(__dirname, PLUGIN, file)), "plugin folder lacks " + file);
  }
  assert(fs.readFileSync(path.join(__dirname, PLUGIN, "LICENSE"), "utf8") === fs.readFileSync(path.join(__dirname, "LICENSE"), "utf8"), "plugin LICENSE is a copy of the extension's");
});
```

- [ ] **Step 2: Run the checks to see it fail**

Run: `cd /mnt/fast/python_projects/MyMarkdown-fork && node vscode-extension/check.js 2>&1 | tail -4`
Expected: `1 failed` naming "plugin manifests" (ENOENT on `agent-hooks/plugin/plugin.json`).

- [ ] **Step 3: Move the hook and skill, create the manifests**

```bash
cd /mnt/fast/python_projects/MyMarkdown-fork/vscode-extension/agent-hooks
mkdir -p plugin/hooks plugin/skills/markdown-labels plugin/.claude-plugin plugin/.cursor-plugin plugin/.qoder-plugin
git mv files/markdown-labels.cjs plugin/hooks/markdown-labels.cjs
git mv files/SKILL.md plugin/skills/markdown-labels/SKILL.md
cp LICENSE plugin/LICENSE
```

`plugin/plugin.json`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "mymarkdown",
  "version": "0.1.0",
  "description": "Have coding agents label the Markdown they write, for the MyMarkdown VS Code extension. Runs a Node hook after each Markdown write; nothing leaves your machine. Requires Node.js 18 or later.",
  "author": { "name": "MyMarkdown", "url": "https://github.com/ardeeshany/MyMarkdown" },
  "homepage": "https://github.com/ardeeshany/MyMarkdown/tree/main/vscode-extension/agent-hooks/plugin",
  "repository": "https://github.com/ardeeshany/MyMarkdown",
  "license": "MIT",
  "keywords": ["markdown", "labels", "vscode", "mymarkdown"],
  "extensions": {
    "com.openai": {
      "hooks": "./hooks/hooks.json",
      "interface": {
        "displayName": "MyMarkdown labels",
        "shortDescription": "Label the Markdown you write, for the MyMarkdown preview",
        "category": "Developer Tools",
        "capabilities": ["Skills", "Lifecycle hooks"]
      }
    }
  }
}
```

`plugin/.claude-plugin/plugin.json`, `plugin/.cursor-plugin/plugin.json` and `plugin/.qoder-plugin/plugin.json` are identical:

```json
{
  "name": "mymarkdown",
  "displayName": "MyMarkdown labels",
  "version": "0.1.0",
  "description": "Have coding agents label the Markdown they write, for the MyMarkdown VS Code extension. Runs a Node hook after each Markdown write; nothing leaves your machine. Requires Node.js 18 or later.",
  "author": { "name": "MyMarkdown", "url": "https://github.com/ardeeshany/MyMarkdown" },
  "homepage": "https://github.com/ardeeshany/MyMarkdown/tree/main/vscode-extension/agent-hooks/plugin",
  "repository": "https://github.com/ardeeshany/MyMarkdown",
  "license": "MIT",
  "keywords": ["markdown", "labels", "vscode", "mymarkdown"]
}
```

`plugin/README.md`:

```markdown
# MyMarkdown labels

Have coding agents label the Markdown they write, for the
[MyMarkdown](https://marketplace.visualstudio.com/items?itemName=mymarkdown.mymarkdown) VS Code
extension. After an agent saves a document of 400 or more words with at least two headings and no
labels yet, a hook tells it to run the `markdown-labels` skill, which writes label lenses to
`.mymd/` for the preview to draw. Nothing leaves your machine. Requires Node.js 18 or later.

Install once, and it runs in every project (each agent's own plugin command; see the extension
README's "Labels from your coding agent" section for the full list):

    claude plugin marketplace add ardeeshany/MyMarkdown && claude plugin install mymarkdown@mymarkdown-plugins
    copilot plugin marketplace add ardeeshany/MyMarkdown && copilot plugin install mymarkdown@mymarkdown-plugins
    codex plugin marketplace add ardeeshany/MyMarkdown && codex plugin add mymarkdown@mymarkdown-plugins
    devin plugins install ardeeshany/MyMarkdown#vscode-extension/agent-hooks/plugin

In a project that has the per-repo install (`npx mymarkdown-hooks init`), this plugin stays quiet.
```

- [ ] **Step 4: Point the installer and the package at the plugin folder**

In `install.js`, replace the `TEMPLATES` constant and the two moved `from` values:

```js
const TEMPLATES = __dirname;
/** The plugin folder: the only copy of the hook and skill, and what the installer copies from. */
const PLUGIN_DIR = path.join(__dirname, "plugin");
```

and in `TARGETS`:

```js
  { dest: HOOK, from: "plugin/hooks/markdown-labels.cjs" },
  { dest: ".agents/skills/markdown-labels/SKILL.md", from: "plugin/skills/markdown-labels/SKILL.md" },
  { dest: ".claude/skills/markdown-labels/SKILL.md", from: "plugin/skills/markdown-labels/SKILL.md" },
  { dest: ".claude/settings.json", from: "files/claude-settings.json", merge: true, runsHook: true },
  { dest: ".github/hooks/markdown-labels.json", from: "files/copilot-hooks.json", runsHook: true },
  { dest: ".codex/hooks.json", from: "files/codex-hooks.json", merge: true, runsHook: true },
```

Every `path.join(TEMPLATES, target.from)` now resolves against `agent-hooks/`. Add `PLUGIN_DIR` to `module.exports`.

In `package.json`: `"files": ["cli.js", "install.js", "files/", "plugin/"]`; description → `"Set up coding agents (Claude Code, GitHub Copilot, Cursor, Codex, Windsurf, OpenCode and more) to label the Markdown they write, for the MyMarkdown VS Code extension."`; add `"windsurf", "opencode", "plugin"` to keywords.

In `check.js`, change the `template` helper (search `const template = (dest) =>`) to:

```js
const template = (dest) => fs.readFileSync(path.join(__dirname, "agent-hooks", Hooks.TARGETS.find((t) => t.dest === dest).from), "utf8");
```

and in the check "the mymarkdown-hooks npm package ships everything the installer reads, and the VSIX keeps it", replace the two lines that check `pkg.files` and template existence with:

```js
  for (const needed of ["cli.js", "install.js", "files/", "plugin/"]) assert(pkg.files.includes(needed), "package files should include " + needed);
  for (const target of Hooks.TARGETS) assert(fs.existsSync(path.join(__dirname, "agent-hooks", target.from)), target.from);
```

- [ ] **Step 5: Run the checks**

Run: `node vscode-extension/check.js`
Expected: `MyMarkdown checks: 85 passed` (84 before + the manifests check). The repo's own `.agents/hooks/markdown-labels.cjs` is unchanged, so "the repo's own agent files are exactly what the installer ships" still passes.

- [ ] **Step 6: Commit**

```bash
cd /mnt/fast/python_projects/MyMarkdown-fork && git add -A vscode-extension/agent-hooks vscode-extension/check.js && git commit -m "$(cat <<'EOF'
Plugin folder: the hook and skill move to agent-hooks/plugin, with manifests

The folder is laid out as a Claude Code plugin (which Cursor, Windsurf, Augment
and Qoder also read) with a root Agent Plugins 1.0 manifest for Copilot, Codex
and VS Code. The per-repo installer and the npm package now read the hook and
skill from it, so it is the only copy in the repository.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Marketplace files at the repository root

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `.agents/plugins/marketplace.json`
- Create: `.augment-plugin/marketplace.json`
- Modify: `vscode-extension/check.js`

**Interfaces:**
- Consumes: `PKG_VERSION`, `readJson` from Task 1.

- [ ] **Step 1: Write the failing check**

Add after the manifests check in `check.js`:

```js
check("marketplace files: each reader's format, the same plugin name and path, no version in Claude's entry", () => {
  const rel = "./vscode-extension/agent-hooks/plugin";
  const claude = JSON.parse(fs.readFileSync(path.join(REPO, ".claude-plugin", "marketplace.json"), "utf8"));
  assert(claude.name === "mymarkdown-plugins" && claude.owner && claude.owner.name, "Claude marketplace name/owner");
  assert(claude.plugins.length === 1 && claude.plugins[0].name === "mymarkdown" && claude.plugins[0].source === rel, "Claude entry");
  assert(!("version" in claude.plugins[0]), "Claude's validate complains when the version is in both the manifest and the entry");
  const codex = JSON.parse(fs.readFileSync(path.join(REPO, ".agents", "plugins", "marketplace.json"), "utf8"));
  assert(codex.name === "mymarkdown-plugins", "Codex marketplace name");
  const entry = codex.plugins[0];
  assert(entry.name === "mymarkdown" && entry.source && entry.source.source === "local" && entry.source.path === rel, "Codex entry: a local source for a subfolder plugin: " + JSON.stringify(entry));
  const augment = JSON.parse(fs.readFileSync(path.join(REPO, ".augment-plugin", "marketplace.json"), "utf8"));
  assert(augment.name === "mymarkdown-plugins" && augment.plugins[0].name === "mymarkdown" && augment.plugins[0].source === rel, "Augment entry");
  assert(augment.version === PKG_VERSION && augment.plugins[0].version === PKG_VERSION, "Augment carries the version");
  assert(fs.existsSync(path.join(REPO, rel, "plugin.json")), "every source points at the plugin folder");
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node vscode-extension/check.js 2>&1 | tail -3` — Expected: `1 failed` (ENOENT `.claude-plugin/marketplace.json`).

- [ ] **Step 3: Create the three files**

`.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "mymarkdown-plugins",
  "description": "Plugins for the MyMarkdown VS Code extension.",
  "owner": { "name": "MyMarkdown", "url": "https://github.com/ardeeshany/MyMarkdown" },
  "plugins": [
    {
      "name": "mymarkdown",
      "description": "Have coding agents label the Markdown they write, for the MyMarkdown VS Code extension. Runs a Node hook after each Markdown write; nothing leaves your machine. Requires Node.js 18 or later.",
      "source": "./vscode-extension/agent-hooks/plugin",
      "category": "productivity"
    }
  ]
}
```

`.agents/plugins/marketplace.json`:

```json
{
  "name": "mymarkdown-plugins",
  "interface": { "displayName": "MyMarkdown plugins" },
  "plugins": [
    {
      "name": "mymarkdown",
      "source": { "source": "local", "path": "./vscode-extension/agent-hooks/plugin" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_USE" },
      "category": "Developer Tools"
    }
  ]
}
```

`.augment-plugin/marketplace.json`:

```json
{
  "name": "mymarkdown-plugins",
  "description": "Plugins for the MyMarkdown VS Code extension.",
  "version": "0.1.0",
  "plugins": [
    { "name": "mymarkdown", "version": "0.1.0", "source": "./vscode-extension/agent-hooks/plugin" }
  ]
}
```

- [ ] **Step 4: Run the checks** — Expected: `86 passed`.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin .agents/plugins .augment-plugin vscode-extension/check.js && git commit -m "$(cat <<'EOF'
Marketplace files, so the plugin installs from GitHub

.claude-plugin/marketplace.json for Claude Code, Copilot and Cursor; .agents/plugins/
marketplace.json for Codex, with a local source since the plugin is in a subfolder;
.augment-plugin/marketplace.json for Augment.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The hook runs as a plugin: root from the agent's context, yield to a per-repo install, the shared hook files

**Files:**
- Modify: `vscode-extension/agent-hooks/plugin/hooks/markdown-labels.cjs` (the `ROOT` constant and `main()`)
- Create: `vscode-extension/agent-hooks/plugin/hooks/hooks.json`
- Create: `vscode-extension/agent-hooks/plugin/com.github.copilot/hooks/hooks.json`
- Modify: `vscode-extension/check.js`
- Modify (regenerated): `.agents/hooks/markdown-labels.cjs` via `node vscode-extension/agent-hooks/cli.js init --force` from the repo root (the check "the repo's own agent files are exactly what the installer ships" enforces this).

**Interfaces:**
- Produces in the hook: `function projectRoot(payload)` returning `{ root, inProject }`; `function skillName(dialect, inProject)`; the hook reads `payload.cwd` only, never `process.cwd()`, for resolving relative paths when running as a plugin.
- Produces in `check.js`: `pluginRepo()` helper: like `hookRepo()` but runs the hook from a copy OUTSIDE the project (in `<tmp>/plugin-home/plugin/hooks/`), returning `{ root, doc, run(payload, {env, args}), cleanup }` where `run` never sets `CLAUDE_PROJECT_DIR` unless asked.

- [ ] **Step 1: Write the failing checks**

Add to `check.js` after `hookRepo()`'s definition:

```js
/** The hook as a plugin: installed outside the project, told about it only by the agent. */
function pluginRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mymd-plugin-"));
  const root = path.join(base, "project");
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, ".git"));
  const script = path.join(base, "plugin-home", "plugin", "hooks", "markdown-labels.cjs");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(path.join(REPO, "vscode-extension", "agent-hooks", "plugin", "hooks", "markdown-labels.cjs"), script);
  const doc = path.join(root, "docs", "big.md");
  fs.writeFileSync(doc, "# Guide\n\n## One\n\n" + "word ".repeat(420) + "\n\n## Two\n\nend\n");
  const run = (payload, { args = [], env = {} } = {}) => {
    const inherited = { ...process.env };
    for (const key of ["CLAUDE_PROJECT_DIR", "DEVIN_PROJECT_DIR", "COPILOT_PROJECT_DIR", "AUGMENT_PROJECT_DIR", "CURSOR_PROJECT_DIR", "COPILOT_CLI"]) delete inherited[key];
    const result = spawnSync(process.execPath, [script, ...args], { input: JSON.stringify(payload), env: { ...inherited, ...env }, cwd: path.dirname(script), encoding: "utf8" });
    assert(result.status === 0, "the hook must always exit 0, got " + result.status + ": " + result.stderr);
    return result.stdout ? JSON.parse(result.stdout) : null;
  };
  return { base, root, doc, script, run, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

check("plugin hook: finds the project from the agent's context, never from where the script lives", () => {
  const p = pluginRepo();
  try {
    const claudeContext = (out) => out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext;
    const write = { tool_name: "Write", tool_input: { file_path: p.doc }, tool_response: {} };
    // Root from each environment variable an agent sets.
    for (const name of ["CLAUDE_PROJECT_DIR", "DEVIN_PROJECT_DIR", "COPILOT_PROJECT_DIR", "AUGMENT_PROJECT_DIR"]) {
      const out = p.run(write, { env: { [name]: p.root } });
      includes(claudeContext(out) || "", "docs/big.md is now", "root from " + name);
    }
    // No variable: the git top above the payload's cwd (a subfolder here).
    includes(claudeContext(p.run({ ...write, cwd: path.join(p.root, "docs") })) || "", "docs/big.md is now", "root from the git top above cwd");
    // A file outside that root is ignored.
    const outside = path.join(p.base, "elsewhere.md");
    fs.copyFileSync(p.doc, outside);
    assert(p.run({ tool_name: "Write", tool_input: { file_path: outside }, tool_response: {}, cwd: p.root }) === null, "a file outside the project is ignored");
    // The nudge names the plugin's skill the way Claude Code lists it.
    includes(claudeContext(p.run(write, { env: { CLAUDE_PROJECT_DIR: p.root } })), "mymarkdown:markdown-labels", "the skill name under a Claude plugin");
    // Stamping lands under the project, and stamping twice changes nothing (two copies may run).
    const sidecar = path.join(p.root, ".mymd", "docs", "big.md.json");
    fs.mkdirSync(path.dirname(sidecar), { recursive: true });
    fs.writeFileSync(sidecar, JSON.stringify({ version: 1, lenses: [{ name: "L", ranges: [{ label: "One", color: "#111111", startLine: 1, endLine: 3 }] }] }));
    p.run({ tool_name: "Write", tool_input: { file_path: sidecar }, tool_response: {}, cwd: p.root });
    const once = fs.readFileSync(sidecar, "utf8");
    assert(JSON.parse(once).lenses[0].ranges[0].anchor === "# guide", "stamped under the project root");
    p.run({ tool_name: "Write", tool_input: { file_path: sidecar }, tool_response: {}, cwd: p.root });
    assert(fs.readFileSync(sidecar, "utf8") === once, "a second stamping run changes nothing");
  } finally {
    p.cleanup();
  }
});

check("plugin hook: yields to a project that has its own per-repo install", () => {
  const p = pluginRepo();
  try {
    fs.mkdirSync(path.join(p.root, ".agents", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(p.root, ".agents", "hooks", "markdown-labels.cjs"), "// the project's own copy\n");
    const out = p.run({ tool_name: "Write", tool_input: { file_path: p.doc }, tool_response: {} }, { env: { CLAUDE_PROJECT_DIR: p.root } });
    assert(out === null, "the project's own hook speaks for it; the plugin must stay quiet, got " + JSON.stringify(out));
  } finally {
    p.cleanup();
  }
});

check("plugin hook files: the shared Claude-schema entry and Copilot's flat one run the same script", () => {
  const shared = readJson(PLUGIN + "/hooks/hooks.json");
  const group = shared.hooks.PostToolUse[0];
  assert(group.matcher === "Write|Edit|write|edit|apply_patch|save-file|str-replace-editor", "the matcher names every reader's write tools, got " + group.matcher);
  const hook = group.hooks[0];
  assert(hook.type === "command" && hook.timeout === 15, "command hook, 15 s");
  includes(hook.command, '${CLAUDE_PLUGIN_ROOT}/hooks/markdown-labels.cjs', "the shared command");
  assert(/; exit 0$/.test(hook.command), "a machine without node must not see an error after every write");
  const copilot = readJson(PLUGIN + "/com.github.copilot/hooks/hooks.json");
  const entry = copilot.hooks.postToolUse[0];
  assert(copilot.version === 1 && entry.type === "command" && entry.timeoutSec === 15, "Copilot's own schema");
  for (const key of ["bash", "powershell"]) includes(entry[key], "${PLUGIN_ROOT}/hooks/markdown-labels.cjs", "Copilot " + key);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node vscode-extension/check.js 2>&1 | grep -E "checks:|^    - "` — Expected: 3 failed (the plugin hook resolves `ROOT` two folders above its own location, which is `plugin-home`, so nothing nudges; the hook files do not exist).

- [ ] **Step 3: Rework the hook's root and output**

In `plugin/hooks/markdown-labels.cjs`, replace the `ROOT` block (the comment and `const ROOT = path.resolve(__dirname, "..", "..");`) with:

```js
// Installed in a project, this file lives at <root>/.agents/hooks/ and the root is two folders
// up. Installed as a plugin it lives wherever the agent keeps plugins, and the project can only
// come from what the agent tells the hook: an environment variable, the payload's workspace, or
// the git repository around the folder the agent runs in.
const IN_PROJECT = /[\\/]\.agents[\\/]hooks$/.test(__dirname);
const OWN_ROOT = path.resolve(__dirname, "..", "..");

/** The top of the git repository `dir` is in, or `dir` itself outside one. */
function gitTop(dir) {
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    if (fs.existsSync(path.join(at, ".git"))) return at;
    if (path.dirname(at) === at) return path.resolve(dir);
  }
}

/** The project root for this run, and whether this copy of the hook lives inside it. */
function projectRoot(payload) {
  if (IN_PROJECT) return { root: OWN_ROOT, inProject: true };
  const env = process.env;
  const fromEnv = env.CLAUDE_PROJECT_DIR || env.DEVIN_PROJECT_DIR || env.COPILOT_PROJECT_DIR || env.AUGMENT_PROJECT_DIR || env.CURSOR_PROJECT_DIR;
  const workspace = (Array.isArray(payload.workspace_roots) && payload.workspace_roots[0]) || (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]);
  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : null;
  return { root: path.resolve(fromEnv || workspace || (cwd ? gitTop(cwd) : process.cwd())), inProject: false };
}

/** How the agent lists the skill: a plugin's skill is namespaced in some agents. */
function skillName(dialect, inProject) {
  if (inProject) return "markdown-labels";
  if (dialect === "cursor") return "/markdown-labels";
  if (dialect === "claude" || dialect === "devin") return "mymarkdown:markdown-labels";
  return "markdown-labels";
}
```

Change `nudge(root, file, relative)` to take the skill's name: signature `nudge(root, file, relative, skill)`, and its return text to:

```js
  return (
    `${shown} is now ${words} words across ${headings} headings, past the markdown-labels ` +
    `threshold, and has no MyMarkdown labels. Run the ${skill} skill now, before you finish, ` +
    `to write label lenses for it.`
  );
```

In `main(payload)`, after the `--claude-settings` early return, replace everything from `const copilot = "toolName" in payload;` to the end of the function with:

```js
  const copilot = "toolName" in payload;
  const dialect = copilot ? "copilot" : "claude";
  const tool = copilot ? payload.toolName : payload.tool_name;
  if (!WRITE_TOOLS.has(tool)) return;
  let input = copilot ? payload.toolArgs : payload.tool_input;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      // Not JSON: keep it as patch text.
    }
  }
  if (typeof input === "string") input = { input };
  if (!input || typeof input !== "object") return;
  if (tool === "str_replace_editor" && input.command === "view") return;

  const { root: ROOT, inProject } = projectRoot(payload);
  // A project with its own per-repo install is that copy's business; two nudges help nobody.
  if (!inProject && fs.existsSync(path.join(ROOT, ".agents", "hooks", "markdown-labels.cjs"))) return;
  // Relative paths are relative to where the agent works, which as a plugin is never here.
  const base = (typeof payload.cwd === "string" && payload.cwd) || (inProject ? process.cwd() : ROOT);

  const notes = [];
  for (const file of writtenFiles(input, base)) {
    let relative = path.relative(ROOT, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    // A Claude Code worktree (.claude/worktrees/<name>/) is a checkout of its own, with its own
    // .mymd, though the hook is still run from the main one.
    const worktree = /^\.claude[\\/]worktrees[\\/][^\\/]+[\\/]/.exec(relative);
    const root = worktree ? path.join(ROOT, worktree[0]) : ROOT;
    if (worktree) relative = path.relative(root, file);
    const parts = relative.split(path.sep);
    if (parts[0] === STORAGE) {
      if (/\.json$/i.test(relative) && MARKDOWN.test(relative.slice(0, -".json".length))) {
        stamp(file, path.join(root, ...parts.slice(1)).slice(0, -".json".length));
      }
      continue;
    }
    if (!MARKDOWN.test(relative) || parts.includes("node_modules") || parts.includes(".git")) continue;
    const note = nudge(root, file, relative, skillName(dialect, inProject));
    if (note) notes.push(note);
  }
  if (!notes.length) return;
  respond(dialect, notes.join("\n"));
}

/** Each agent reads the nudge from a different place in the hook's output. */
function respond(dialect, additionalContext) {
  const out =
    dialect === "copilot"
      ? { additionalContext }
      : dialect === "cursor"
        ? { additional_context: additionalContext }
        : { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } };
  process.stdout.write(JSON.stringify(out));
}
```

(The `cursor` branch of `respond` and `skillName` is wired to a dialect Task 4 detects; here every non-Copilot payload is `claude`.)

The two references `nudge(root, file, relative)` in the old code are now the single call above. `stamp()` is unchanged: it rewrites through a temporary file, so a second run reads the same anchors it wrote and writes nothing.

- [ ] **Step 4: Create the two hook files**

`plugin/hooks/hooks.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|write|edit|apply_patch|save-file|str-replace-editor",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/markdown-labels.cjs\"; exit 0",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

`plugin/com.github.copilot/hooks/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "postToolUse": [
      {
        "type": "command",
        "bash": "node \"${PLUGIN_ROOT}/hooks/markdown-labels.cjs\"; exit 0",
        "powershell": "node \"${PLUGIN_ROOT}/hooks/markdown-labels.cjs\"; exit 0",
        "timeoutSec": 15
      }
    ]
  }
}
```

- [ ] **Step 5: Refresh the repo's own copy and run the checks**

```bash
cd /mnt/fast/python_projects/MyMarkdown-fork && node vscode-extension/agent-hooks/cli.js init --force && node vscode-extension/check.js
```

Expected: the CLI reports `updated .agents/hooks/markdown-labels.cjs`, everything else unchanged; then `89 passed`. In particular the existing "label hook: each agent's write gets the nudge" check (per-repo mode, `hookRepo()`) still passes, because `IN_PROJECT` is true there and the root is unchanged.

- [ ] **Step 6: Commit**

```bash
git add vscode-extension/agent-hooks/plugin .agents/hooks/markdown-labels.cjs vscode-extension/check.js && git commit -m "$(cat <<'EOF'
The hook runs as a plugin: the project comes from the agent's context

Outside a project the root is the agent's project variable, else the payload's
workspace, else the git repository around the agent's working folder. A project
with its own per-repo install is left to that copy, so nothing is nudged twice.
The shared Claude-schema hook file and Copilot's flat one run the same script.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Payload dialects: Devin, Cursor, Augment, Qoder and Kiro's save event

**Files:**
- Modify: `vscode-extension/agent-hooks/plugin/hooks/markdown-labels.cjs` (`WRITE_TOOLS`, `writtenFiles`, `main`)
- Modify: `vscode-extension/check.js`
- Regenerate: `.agents/hooks/markdown-labels.cjs` (`cli.js init --force`)

**Interfaces:**
- Consumes: `pluginRepo()`, `projectRoot`, `respond`, `skillName` from Task 3.
- Produces: `function detect(payload)` → `{ dialect, tool, input, files }` where `dialect` ∈ `claude|copilot|cursor|devin|augment|kiro`, and `writtenFiles(input, base)` also reads `input.raw_patch` and `input.patch`.

- [ ] **Step 1: Write the failing check**

```js
check("plugin hook: every agent's payload shape reaches the nudge, in that agent's output format", () => {
  const p = pluginRepo();
  try {
    const patch = "*** Begin Patch\n*** Update File: docs/big.md\n@@\n-a\n+b\n*** End Patch";
    const cases = [
      // Devin: lowercase tool names, no cwd, the root from its own variable; apply_patch as text or under a key.
      ["Devin write", { hook_event_name: "PostToolUse", tool_name: "write", tool_input: { file_path: p.doc }, tool_response: { success: true } }, { DEVIN_PROJECT_DIR: p.root }, "hookSpecificOutput", "mymarkdown:markdown-labels"],
      ["Devin apply_patch (string)", { hook_event_name: "PostToolUse", tool_name: "apply_patch", tool_input: patch, tool_response: { success: true } }, { DEVIN_PROJECT_DIR: p.root }, "hookSpecificOutput", "mymarkdown:markdown-labels"],
      ["Devin apply_patch (raw_patch)", { hook_event_name: "PostToolUse", tool_name: "apply_patch", tool_input: { raw_patch: patch }, tool_response: { success: true } }, { DEVIN_PROJECT_DIR: p.root }, "hookSpecificOutput", "mymarkdown:markdown-labels"],
      // Cursor: camelCase event, the root from workspace_roots, a flat answer, and cwd is NOT the project.
      ["Cursor", { hook_event_name: "postToolUse", cursor_version: "3.21.18", conversation_id: "c1", workspace_roots: [p.root], cwd: path.dirname(p.script), tool_name: "Write", tool_input: { file_path: p.doc, content: "x" }, tool_output: "{}" }, {}, "additional_context", "/markdown-labels"],
      // Augment: paths relative to the workspace, listed in file_changes.
      ["Augment", { hook_event_name: "PostToolUse", tool_name: "save-file", tool_input: {}, file_changes: [{ path: "docs/big.md" }], workspace_roots: [p.root] }, { AUGMENT_PROJECT_DIR: p.root }, "hookSpecificOutput", "markdown-labels"],
      // Qoder CLI: Claude's shape.
      ["Qoder CLI", { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: p.doc }, cwd: p.root }, {}, "hookSpecificOutput", "markdown-labels"],
    ];
    for (const [name, payload, env, field, skill] of cases) {
      const out = p.run(payload, { env });
      const text = out && (field === "hookSpecificOutput" ? out.hookSpecificOutput && out.hookSpecificOutput.additionalContext : out[field]);
      assert(text && text.includes("docs/big.md is now") && text.includes(skill), name + " got " + JSON.stringify(out));
      if (field === "additional_context") assert(!("hookSpecificOutput" in out), "Cursor gets the flat field only");
    }
    // A Devin write that failed is not a document to label.
    assert(p.run({ hook_event_name: "PostToolUse", tool_name: "write", tool_input: { file_path: p.doc }, tool_response: { success: false } }, { env: { DEVIN_PROJECT_DIR: p.root } }) === null, "a failed write");
    // Kiro's PostFileSave (its command action stamps sidecars; a .md save carries no answer worth sending).
    const sidecar = path.join(p.root, ".mymd", "docs", "big.md.json");
    fs.mkdirSync(path.dirname(sidecar), { recursive: true });
    fs.writeFileSync(sidecar, JSON.stringify({ version: 1, lenses: [{ name: "L", ranges: [{ label: "One", color: "#111111", startLine: 1, endLine: 3 }] }] }));
    p.run({ hook_event_name: "PostFileSave", session_id: "s", cwd: p.root, file_path: sidecar });
    assert(JSON.parse(fs.readFileSync(sidecar, "utf8")).lenses[0].ranges[0].anchor === "# guide", "Kiro's save event stamps the sidecar");
    // Cursor's cwd (the plugin folder) never becomes the root: no sidecar folder appears there.
    assert(!fs.existsSync(path.join(path.dirname(p.script), ".mymd")), "nothing written next to the plugin");
  } finally {
    p.cleanup();
  }
});
```

- [ ] **Step 2: Run to see it fail** — Expected: `1 failed` (Devin's lowercase `write` is not in `WRITE_TOOLS`, Cursor gets `hookSpecificOutput`, Augment finds no path).

- [ ] **Step 3: Implement the dialects**

In `WRITE_TOOLS` add a line `"write", "notebook_edit", // Devin (edit and apply_patch are above)` and `"save-file", "str-replace-editor", // Augment` and `"Write", // Kiro's PostFileSave is mapped to this below`. (Keep the existing entries.)

In `writtenFiles`, change the patch line to read every key an agent uses:

```js
  const patch = String(input.input ?? input.raw_patch ?? input.patch ?? input.command ?? "");
```

Add before `main`:

```js
/**
 * Which agent sent this payload, and the write it describes, in one shape. Agents differ in
 * case (Devin), casing of the event name (Cursor), where the paths sit (Augment lists them in
 * file_changes; Kiro's save event names one file), and how a patch is carried.
 */
function detect(payload) {
  if ("toolName" in payload) return { dialect: "copilot", tool: payload.toolName, input: payload.toolArgs };
  if (payload.hook_event_name === "PostFileSave" && typeof payload.file_path === "string") {
    return { dialect: "kiro", tool: "Write", input: { file_path: payload.file_path } };
  }
  const tool = payload.tool_name;
  let input = payload.tool_input;
  if (Array.isArray(payload.file_changes)) {
    // Augment: relative to the first workspace root.
    const base = (Array.isArray(payload.workspace_roots) && payload.workspace_roots[0]) || process.env.AUGMENT_PROJECT_DIR || "";
    const paths = payload.file_changes.map((change) => change && change.path).filter((p) => typeof p === "string" && p);
    return { dialect: "augment", tool, input: { paths: paths.map((p) => path.resolve(base, p)) } };
  }
  if (payload.hook_event_name === "postToolUse" || "cursor_version" in payload) return { dialect: "cursor", tool, input };
  if (typeof tool === "string" && /^(write|edit|apply_patch|notebook_edit)$/.test(tool)) {
    if (payload.tool_response && payload.tool_response.success === false) return { dialect: "devin", tool: null, input };
    return { dialect: "devin", tool, input };
  }
  return { dialect: "claude", tool, input };
}
```

In `writtenFiles`, the first line becomes `const found = [input.file_path, input.path, input.filePath, ...(Array.isArray(input.paths) ? input.paths : [])];`.

In `main`, replace the four lines from `const copilot = "toolName" in payload;` to `let input = copilot ? payload.toolArgs : payload.tool_input;` with:

```js
  const detected = detect(payload);
  const { dialect } = detected;
  const tool = detected.tool;
  if (!WRITE_TOOLS.has(tool)) return;
  let input = detected.input;
```

`respond` already answers `cursor` with the flat field and `copilot` with `additionalContext`; the rest get `hookSpecificOutput`.

- [ ] **Step 4: Refresh the repo copy, run the checks**

```bash
node vscode-extension/agent-hooks/cli.js init --force && node vscode-extension/check.js
```

Expected: `90 passed`.

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/agent-hooks/plugin/hooks/markdown-labels.cjs .agents/hooks/markdown-labels.cjs vscode-extension/check.js && git commit -m "$(cat <<'EOF'
Hook: the payload dialects of Windsurf, Cursor, Augment, Qoder and Kiro

Devin names its tools in lowercase and carries a patch as text or under raw_patch;
Cursor sends a camelCase event, runs the hook from the plugin folder and reads a
flat additional_context; Augment lists written files in file_changes relative to
the workspace; Kiro's save event names one file. Each is read into one shape and
answered the way that agent expects.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Antigravity: its own folder, hook schema and the two-hook bridge

**Files:**
- Modify: `vscode-extension/agent-hooks/plugin/hooks/markdown-labels.cjs` (Antigravity dialect)
- Create: `vscode-extension/agent-hooks/plugin-antigravity/plugin.json`
- Create: `vscode-extension/agent-hooks/plugin-antigravity/hooks.json`
- Create (copies): `vscode-extension/agent-hooks/plugin-antigravity/hooks/markdown-labels.cjs`, `vscode-extension/agent-hooks/plugin-antigravity/skills/markdown-labels/SKILL.md`
- Modify: `vscode-extension/agent-hooks/package.json` (`files` gains `plugin-antigravity/`)
- Modify: `vscode-extension/check.js`
- Regenerate: `.agents/hooks/markdown-labels.cjs`

**Interfaces:**
- Consumes: `detect`, `respond`, `projectRoot` from Tasks 3–4.
- Produces: the hook handles `dialect === "antigravity"` with two events: a `toolCall` payload (PostToolUse) prints `{}` and leaves a marker; an `invocationNum` payload (PostInvocation) prints `{"injectSteps":[{"userMessage":…}]}` or `{}`. Marker path: `path.join(os.tmpdir(), "mymarkdown-labels-" + sanitised conversationId)`.

- [ ] **Step 1: Write the failing checks**

```js
check("Antigravity: PostToolUse stamps and leaves a marker, PostInvocation delivers the nudge once, non-tool steps are harmless", () => {
  const p = pluginRepo();
  const marker = path.join(os.tmpdir(), "mymarkdown-labels-conv-1");
  try {
    fs.rmSync(marker, { force: true });
    const write = { stepIdx: 3, toolCall: { name: "write_to_file", args: { TargetFile: p.doc, CodeContent: "x" } }, conversationId: "conv-1", workspacePaths: [p.root], error: "" };
    assert(JSON.stringify(p.run(write)) === "{}", "PostToolUse must answer {} and nothing else");
    assert(fs.existsSync(marker), "a marker for this conversation");
    const inject = p.run({ invocationNum: 2, initialNumSteps: 3, conversationId: "conv-1", workspacePaths: [p.root] });
    assert(inject && inject.injectSteps && inject.injectSteps[0].userMessage.includes("docs/big.md is now"), "PostInvocation carries the nudge: " + JSON.stringify(inject));
    includes(inject.injectSteps[0].userMessage, "mymarkdown:markdown-labels", "the skill as Antigravity lists it");
    assert(JSON.stringify(p.run({ invocationNum: 3, initialNumSteps: 3, conversationId: "conv-1" })) === "{}", "delivered once");
    assert(JSON.stringify(p.run({ stepIdx: 4, toolCall: null, conversationId: "conv-1" })) === "{}", "a non-tool step");
    // The root comes from the written file's repository when workspacePaths is empty.
    assert(JSON.stringify(p.run({ stepIdx: 5, toolCall: { name: "replace_file_content", args: { TargetFile: p.doc } }, conversationId: "conv-1", workspacePaths: [] })) === "{}");
    assert(fs.existsSync(marker), "nudged again after a second write");
  } finally {
    fs.rmSync(marker, { force: true });
    p.cleanup();
  }
});

check("Antigravity folder: its own manifest and hook schema, copies of the hook and skill held equal", () => {
  const dir = "agent-hooks/plugin-antigravity";
  const manifest = readJson(dir + "/plugin.json");
  assert(manifest.name === "mymarkdown" && manifest.version === PKG_VERSION && manifest.description, "manifest");
  const hooks = readJson(dir + "/hooks.json").mymarkdown;
  assert(hooks.PostToolUse[0].matcher === "write_to_file|replace_file_content|multi_replace_file_content", "tool matcher");
  for (const entry of [hooks.PostToolUse[0].hooks[0], hooks.PostInvocation[0]]) {
    assert(entry.type === "command" && entry.command === "node hooks/markdown-labels.cjs" && entry.timeout === 15, "relative command, 15 s: " + JSON.stringify(entry));
  }
  for (const file of ["hooks/markdown-labels.cjs", "skills/markdown-labels/SKILL.md"]) {
    assert(fs.readFileSync(path.join(__dirname, dir, file), "utf8") === fs.readFileSync(path.join(__dirname, PLUGIN, file), "utf8"), file + " has drifted from the plugin's copy");
  }
  assert(!fs.existsSync(path.join(__dirname, dir, "hooks", "hooks.json")), "no Claude-schema hook file here: agy would fail to parse it");
  assert(readJson("agent-hooks/package.json").files.includes("plugin-antigravity/"), "shipped in the npm package");
});
```

- [ ] **Step 2: Run to see them fail** — Expected: 2 failed.

- [ ] **Step 3: The Antigravity dialect in the hook**

Add `const os = require("os");` next to the other requires. In `detect`, before the Copilot line:

```js
  if ("conversationId" in payload && ("toolCall" in payload || "invocationNum" in payload)) {
    const call = payload.toolCall;
    const target = call && call.args && typeof call.args.TargetFile === "string" ? call.args.TargetFile : null;
    return { dialect: "antigravity", tool: call ? call.name : null, input: target ? { file_path: target } : {}, event: call ? "tool" : "invocation" };
  }
```

Add `"write_to_file", "replace_file_content", "multi_replace_file_content", // Antigravity` to `WRITE_TOOLS`.

Add a helper:

```js
/** Antigravity can only inject context from PostInvocation, so PostToolUse leaves the nudge here. */
function markerFor(payload) {
  return path.join(os.tmpdir(), "mymarkdown-labels-" + String(payload.conversationId).replace(/[^\w.-]/g, "_"));
}
```

In `main`, right after `const detected = detect(payload);`, add:

```js
  if (detected.dialect === "antigravity") {
    if (detected.event === "invocation") {
      const marker = markerFor(payload);
      let note = null;
      try {
        note = fs.readFileSync(marker, "utf8");
        fs.rmSync(marker, { force: true });
      } catch {
        // No write since the last invocation.
      }
      process.stdout.write(note ? JSON.stringify({ injectSteps: [{ userMessage: note }] }) : "{}");
      return;
    }
    // A tool step: answer {} whatever happens, and keep the nudge for PostInvocation.
    if (!detected.tool || !WRITE_TOOLS.has(detected.tool)) return void process.stdout.write("{}");
  }
```

Then, so `projectRoot` finds the repository from the file when `workspacePaths` is empty, change its `cwd` line to:

```js
  const written = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : (payload.toolCall && payload.toolCall.args && payload.toolCall.args.TargetFile ? path.dirname(payload.toolCall.args.TargetFile) : null);
  return { root: path.resolve(fromEnv || workspace || (written ? gitTop(written) : process.cwd())), inProject: false };
```

In `respond`, add the Antigravity branch: when `dialect === "antigravity"`, write the notes to `markerFor(payload)` and print `{}`. That needs the payload: change the call to `respond(dialect, notes.join("\n"), payload)` and the signature to `respond(dialect, additionalContext, payload)`:

```js
  if (dialect === "antigravity") {
    fs.writeFileSync(markerFor(payload), additionalContext);
    process.stdout.write("{}");
    return;
  }
```

And at the end of `main`, the early `if (!notes.length) return;` must still print `{}` for Antigravity tool steps: change it to

```js
  if (!notes.length) return void (dialect === "antigravity" && process.stdout.write("{}"));
```

`skillName`: return `"mymarkdown:markdown-labels"` for `antigravity` too (add it to the `claude || devin` test).

- [ ] **Step 4: The Antigravity folder**

```bash
cd vscode-extension/agent-hooks && mkdir -p plugin-antigravity/hooks plugin-antigravity/skills/markdown-labels
cp plugin/hooks/markdown-labels.cjs plugin-antigravity/hooks/ && cp plugin/skills/markdown-labels/SKILL.md plugin-antigravity/skills/markdown-labels/
```

`plugin-antigravity/plugin.json`:

```json
{
  "name": "mymarkdown",
  "version": "0.1.0",
  "description": "Have coding agents label the Markdown they write, for the MyMarkdown VS Code extension. Runs a Node hook after each Markdown write; nothing leaves your machine. Requires Node.js 18 or later."
}
```

`plugin-antigravity/hooks.json`:

```json
{
  "mymarkdown": {
    "PostToolUse": [
      {
        "matcher": "write_to_file|replace_file_content|multi_replace_file_content",
        "hooks": [{ "type": "command", "command": "node hooks/markdown-labels.cjs", "timeout": 15 }]
      }
    ],
    "PostInvocation": [{ "type": "command", "command": "node hooks/markdown-labels.cjs", "timeout": 15 }]
  }
}
```

Add `"plugin-antigravity/"` to `package.json` `files`.

- [ ] **Step 5: Refresh copies and run**

```bash
cd /mnt/fast/python_projects/MyMarkdown-fork && cp vscode-extension/agent-hooks/plugin/hooks/markdown-labels.cjs vscode-extension/agent-hooks/plugin-antigravity/hooks/ && node vscode-extension/agent-hooks/cli.js init --force && node vscode-extension/check.js
```

Expected: `92 passed`. (Repeat the `cp` whenever the hook changes; the folder check catches drift.)

- [ ] **Step 6: Commit**

```bash
git add vscode-extension/agent-hooks .agents/hooks/markdown-labels.cjs vscode-extension/check.js && git commit -m "$(cat <<'EOF'
Antigravity: a plugin folder of its own, and a two-hook bridge for the nudge

Antigravity's hook schema differs from Claude's and its PostToolUse cannot inject
context, so the folder carries its own manifest and hook file; the tool hook does
the checks and stamping and leaves the nudge in a marker, which the next
PostInvocation hook delivers as an injected user message. Copies of the hook and
skill are held equal to the plugin's by check.js.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The OpenCode adapter in the npm package

**Files:**
- Create: `vscode-extension/agent-hooks/plugin/opencode/mymarkdown.mjs`
- Modify: `vscode-extension/agent-hooks/package.json` (`main`, keywords)
- Modify: `vscode-extension/check.js`

**Interfaces:**
- Produces: the module's default export `{ id: "mymarkdown", server, setup }`; `server({ directory, worktree })` returns `{ config, "tool.execute.after" }`; `setup(ctx)` registers on `ctx.tool.hook("execute.after", …)` and `ctx.skill.transform(editor => editor.add({ id, name, description, path, content }))`.

- [ ] **Step 1: Write the failing check**

```js
check("OpenCode adapter: registers the skill and appends the nudge to a write's result, in both API generations", () => {
  const p = pluginRepo();
  try {
    const mjs = path.join(__dirname, "agent-hooks", "plugin", "opencode", "mymarkdown.mjs");
    return import(mjs).then(async (mod) => {
      const plugin = mod.default;
      assert(plugin.id === "mymarkdown" && typeof plugin.server === "function" && typeof plugin.setup === "function", "the dual-generation shape");
      // 1.x: a hooks object; the nudge lands in output.output.
      const hooks = await plugin.server({ directory: p.root, worktree: p.root });
      const config = {};
      await hooks.config(config);
      assert(config.skills.paths.some((dir) => fs.existsSync(path.join(dir, "markdown-labels", "SKILL.md"))), "1.x: the skill folder is registered");
      const output = { title: "write", output: "Wrote docs/big.md", metadata: {} };
      await hooks["tool.execute.after"]({ tool: "write", sessionID: "s", callID: "c", args: { filePath: p.doc, content: "x" } }, output);
      includes(output.output, "docs/big.md is now", "1.x: the nudge in the tool result");
      const untouched = { title: "read", output: "…", metadata: {} };
      await hooks["tool.execute.after"]({ tool: "read", sessionID: "s", callID: "c", args: { filePath: p.doc } }, untouched);
      assert(untouched.output === "…", "1.x: a read is left alone");
      // 2.x: ctx hooks; the nudge lands in event.result.content, the skill through the editor.
      const added = [];
      let after;
      await plugin.setup({
        location: { directory: p.root },
        tool: { hook: async (name, fn) => { if (name === "execute.after") after = fn; } },
        skill: { transform: async (fn) => fn({ add: (skill) => added.push(skill) }) },
      });
      assert(added.length === 1 && added[0].id === "markdown-labels" && /label/i.test(added[0].description) && added[0].content.length > 100, "2.x: the skill: " + JSON.stringify(added[0] && added[0].id));
      const event = { tool: "write", status: "completed", input: { path: p.doc, content: "x" }, result: { output: "ok", content: "Wrote docs/big.md" } };
      await after(event);
      includes(String(event.result.content), "docs/big.md is now", "2.x: the nudge in the result");
      assert(event.result.output === "ok", "2.x: the rest of the result is kept");
    }).finally(() => p.cleanup());
  } catch (error) {
    p.cleanup();
    throw error;
  }
});
```

- [ ] **Step 2: Run to see it fail** — Expected: `1 failed` (cannot find module).

- [ ] **Step 3: Write the adapter**

`plugin/opencode/mymarkdown.mjs`:

```js
// The label hook as an OpenCode plugin, for both API generations: 1.x calls server() for a
// hooks object, 2.x calls setup(ctx). Either way a write runs the same hook script with a
// Claude-shaped payload and the nudge is appended to the tool result the model reads, and the
// skill folder is registered so the model can open it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(here, "..", "hooks", "markdown-labels.cjs");
const SKILLS = path.resolve(here, "..", "skills");
// OpenCode's tool names, and the payload each becomes: write/edit carry a path, patches text.
const WRITES = { write: "Write", edit: "Edit", apply_patch: "apply_patch", patch: "apply_patch" };

/** The hook's nudge for one tool call, or "" when there is nothing to say. */
function nudge(tool, args, cwd) {
  const name = WRITES[tool];
  if (!name || !args || typeof args !== "object") return Promise.resolve("");
  const tool_input = name === "apply_patch" ? { input: args.patchText } : { file_path: args.filePath ?? args.path };
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(process.execPath.includes("node") ? process.execPath : "node", [HOOK], { cwd, stdio: ["pipe", "pipe", "ignore"] });
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", () => {
      try {
        resolve(JSON.parse(out).hookSpecificOutput?.additionalContext ?? "");
      } catch {
        resolve("");
      }
    });
    child.on("error", () => resolve(""));
    child.stdin.end(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: name, tool_input, cwd }));
  });
}

/** Every skill in the plugin, in the shape 2.x's editor takes. */
function skills() {
  return fs.readdirSync(SKILLS).flatMap((id) => {
    const file = path.join(SKILLS, id, "SKILL.md");
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    const description = match && /^description:\s*(.+)$/m.exec(match[1])?.[1]?.trim();
    return [{ id, name: id, ...(description && { description }), path: file, content: match ? match[2] : text }];
  });
}

async function server({ directory, worktree }) {
  const cwd = worktree || directory;
  return {
    config: async (config) => {
      config.skills ??= {};
      config.skills.paths ??= [];
      if (!config.skills.paths.includes(SKILLS)) config.skills.paths.push(SKILLS);
    },
    "tool.execute.after": async (input, output) => {
      const note = await nudge(input.tool, input.args, cwd);
      if (note) output.output = `${output.output ?? ""}\n\n${note}`;
    },
  };
}

async function setup(ctx) {
  if (!ctx?.tool?.hook || !ctx.skill?.transform) return; // 1.x calls setup too, with its own ctx
  const cwd = ctx.location?.directory;
  await ctx.skill.transform((editor) => {
    for (const skill of skills()) {
      try {
        editor.add(skill);
      } catch {
        // A skill the host rejects must not take the hook down with it.
      }
    }
  });
  await ctx.tool.hook("execute.after", async (event) => {
    if (event.status !== "completed") return;
    const note = await nudge(event.tool, event.input, cwd);
    if (!note) return;
    const content = event.result?.content;
    event.result = {
      ...event.result,
      content: Array.isArray(content) ? [...content, { type: "text", text: note }] : `${content ?? ""}\n\n${note}`,
    };
  });
}

export default { id: "mymarkdown", server, setup };
```

In `package.json`: `"main": "plugin/opencode/mymarkdown.mjs"` and add `"opencode-plugin"` to keywords. (`cli.js` requires `./install.js` directly, so `main` is free; the package stays CommonJS with one `.mjs` entry, as ponytail ships.)

Note for the `process.execPath` line: under OpenCode's Bun runtime `process.execPath` is Bun, which also runs the CommonJS hook; under Node it is Node. Keep the expression as written.

- [ ] **Step 4: Run** — Expected: `93 passed`.

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/agent-hooks vscode-extension/check.js && git commit -m "$(cat <<'EOF'
OpenCode: the npm package doubles as the plugin

One ES module in the shape both OpenCode generations accept: after a write it runs
the hook with a Claude-shaped payload and appends the nudge to the tool result,
and it registers the skill folder. The package's main points at it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Kiro: the hook file, globally and as the installer's seventh target

**Files:**
- Create: `vscode-extension/agent-hooks/plugin/kiro/markdown-labels.json` (global form)
- Create: `vscode-extension/agent-hooks/files/kiro-hooks.json` (per-repo form)
- Modify: `vscode-extension/agent-hooks/install.js` (TARGETS)
- Modify: `vscode-extension/agent-hooks/cli.js` (the "New … sessions pick the hook up" line mentions Kiro)
- Modify: `vscode-extension/check.js` (the six-files checks become seven; a Kiro file check)
- Regenerate: `.kiro/hooks/markdown-labels.json` in the repo (`cli.js init --force`)

**Interfaces:**
- Produces: TARGETS entry `{ dest: ".kiro/hooks/markdown-labels.json", from: "files/kiro-hooks.json", runsHook: true }`.

- [ ] **Step 1: Write the failing check, and update the counts**

In `check.js`, the check "an empty project gets all six files" asserts `first.length === 6`: change to `7` (and its title to "seven files"). The README-facing check "the repo's own agent files are exactly what the installer ships" needs no change. Add:

```js
check("Kiro hook files: a prompt nudge on Markdown saves, a command that stamps sidecars, the global and per-repo forms", () => {
  for (const [file, command] of [["agent-hooks/plugin/kiro/markdown-labels.json", 'node "$HOME/.kiro/hooks/markdown-labels.cjs"; exit 0'], ["agent-hooks/files/kiro-hooks.json", 'node "${WORKSPACE_ROOT}/.agents/hooks/markdown-labels.cjs"; exit 0']]) {
    const data = readJson(file);
    assert(data.version === "v1" && data.hooks.length === 2, file + " shape");
    const [prompt, stamp] = data.hooks;
    assert(prompt.trigger === "PostFileSave" && new RegExp(prompt.matcher).test("docs/guide.md") && !new RegExp(prompt.matcher).test("a.txt"), file + ": the nudge fires on Markdown saves");
    assert(prompt.action.type === "agent" && /markdown-labels/.test(prompt.action.prompt) && /400/.test(prompt.action.prompt), file + ": a fixed prompt naming the skill and the threshold");
    assert(stamp.trigger === "PostFileSave" && new RegExp(stamp.matcher).test("/p/.mymd/docs/guide.md.json") && !new RegExp(stamp.matcher).test("/p/docs/guide.md"), file + ": stamping matches sidecars only");
    assert(stamp.action.type === "command" && stamp.action.command === command && stamp.timeout === 15, file + ": the stamping command: " + stamp.action.command);
  }
});
```

- [ ] **Step 2: Run to see it fail** — Expected: 2 failed (the six-files count, the Kiro files).

- [ ] **Step 3: Create the files and the target**

`plugin/kiro/markdown-labels.json`:

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "markdown-labels nudge",
      "description": "After the agent saves a Markdown file, ask it to run the markdown-labels skill when the document is long and has no label sidecar.",
      "trigger": "PostFileSave",
      "matcher": "\\.(md|mkd|mkdn|mdwn|mdown|markdown|markdn|mdtxt|mdtext)$",
      "action": {
        "type": "agent",
        "prompt": "You just saved the Markdown file named in file_path below. If it has 400 or more words and at least two headings, and no label sidecar exists at <project root>/.mymd/<path of the file relative to the project root>.json, run the markdown-labels skill on it now. Otherwise ignore this instruction."
      }
    },
    {
      "name": "markdown-labels anchors",
      "description": "Stamp text anchors into a label sidecar the agent just wrote, so its labels survive later edits.",
      "trigger": "PostFileSave",
      "matcher": "[\\\\/]\\.mymd[\\\\/].+\\.json$",
      "action": { "type": "command", "command": "node \"$HOME/.kiro/hooks/markdown-labels.cjs\"; exit 0" },
      "timeout": 15
    }
  ]
}
```

`files/kiro-hooks.json`: the same, with the command `node "${WORKSPACE_ROOT}/.agents/hooks/markdown-labels.cjs"; exit 0`.

In `install.js` TARGETS, append:

```js
  { dest: ".kiro/hooks/markdown-labels.json", from: "files/kiro-hooks.json", runsHook: true },
```

and in `SHIPPED` add `'node "${WORKSPACE_ROOT}/.agents/hooks/markdown-labels.cjs"; exit 0'` (harmless: the file is never merged, but the set documents every command we have shipped). Update the `TARGETS` doc comment: "Kiro reads any file in .kiro/hooks, so ours is a file of its own, never merged."

In `cli.js`, change the pick-up line to `"New Claude Code, Copilot, Cursor and Kiro sessions in this project pick the hook up. Codex needs\n"`.

- [ ] **Step 4: Refresh the repo's own install and run**

```bash
node vscode-extension/agent-hooks/cli.js init --force && git status --short && node vscode-extension/check.js
```

Expected: a new `.kiro/hooks/markdown-labels.json` at the repo root; `94 passed`.

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/agent-hooks .kiro vscode-extension/check.js && git commit -m "$(cat <<'EOF'
Kiro: a hook file whose nudge is a fixed prompt

Kiro's plugins carry no hooks and it discards a command's output after a write,
so a PostFileSave hook with an agent action asks the agent to run the skill when
the saved document is long and unlabelled, and a second, command hook stamps
anchors into sidecars. Global by copying the file to ~/.kiro/hooks, per project
as the installer's seventh target.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The extension stamps anchors into an unanchored sidecar on read

**Files:**
- Modify: `vscode-extension/extension.js` (`lensesFor`)
- Modify: `vscode-extension/check.js`

**Interfaces:**
- Consumes: `driveLabelCommands`, `fakeMarkdownDocument`, `settle`, `sidecarUri` helpers in `check.js`; `writeSidecar(document, lenses)` in `extension.js`.

- [ ] **Step 1: Write the failing check**

```js
check("an unanchored sidecar (written by an agent without a hook) is stamped on read, once", () => {
  const doc = "# A\n\nabc\n\n## B\n\ndef\n";
  const sidecars = { "/ws/.mymd/doc.md.json": { version: 1, lenses: [{ name: "Parts", ranges: [{ label: "One", color: "#111111", startLine: 5, endLine: 7 }] }] } };
  const host = driveLabelCommands(sidecars, fakeMarkdownDocument("/ws/doc.md", doc));
  return settle().then(() => {
    assert(host.written.length === 1, "exactly one write, got " + host.written.length);
    const range = host.written[0].body.lenses[0].ranges[0];
    assert(range.anchor === "## b" && host.written[0].body.sourceHash, "the write carries anchors and a hash: " + JSON.stringify(range));
    // The watcher sees the file it just wrote: no second write.
    sidecars["/ws/.mymd/doc.md.json"] = host.written[0].body;
    host.watchers[0].handlers.change(sidecarUri("/ws/.mymd/doc.md.json"));
    return settle();
  }).then(() => {
    assert(host.written.length === 1, "a stamped sidecar is not written again");
  });
});
```

- [ ] **Step 2: Run to see it fail** — Expected: `1 failed` ("exactly one write, got 0").

- [ ] **Step 3: Implement**

In `extension.js`, replace `lensesFor`:

```js
/** Documents whose unanchored sidecar is being written back with anchors. */
const stamping = new Set();

/** Every lens for a document, re-anchored against its current text. */
async function lensesFor(document) {
  const key = document.uri.toString();
  const cached = lensCache.get(key);
  if (cached && cached.version === document.version) return cached.lenses;
  const raw = await readSidecar(document);
  const { lenses } = Labels.readLabels(raw, document.getText());
  lensCache.set(key, { version: document.version, lenses });
  // A sidecar written by hand or by an agent with no hook has no anchors, and a range without
  // one stays on its line numbers as the text moves. Stamp it now, the way a hook would have.
  const unanchored = Array.isArray(raw?.lenses) && raw.lenses.some((lens) => Array.isArray(lens?.ranges) && lens.ranges.some((range) => range && !range.anchor));
  if (unanchored && lenses.length && !stamping.has(key)) {
    stamping.add(key);
    writeSidecar(document, []).finally(() => stamping.delete(key));
  }
  return lenses;
}
```

`writeSidecar(document, [])` merges `[]` into the already re-anchored lenses and writes them with anchors and a hash; its `lensCache.delete` then makes the next read see the anchored file, which has nothing unanchored, so the chain stops.

- [ ] **Step 4: Run** — Expected: `95 passed`.

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/extension.js vscode-extension/check.js && git commit -m "$(cat <<'EOF'
Stamp anchors into an unanchored sidecar when the extension reads it

Labels written by an agent that has no hook (skills-only agents, Kiro's prompt)
would otherwise stay on their line numbers and drift at the first edit above
them. The extension now writes such a sidecar back with anchors and a hash once,
through the path its own commands use.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Documentation: the extension README, the npm README, the skill copies

**Files:**
- Modify: `vscode-extension/README.md` (a new subsection after the per-project setup)
- Modify: `vscode-extension/agent-hooks/README.md`
- Modify: `vscode-extension/check.js` (a doc/version consistency check)

- [ ] **Step 1: Write the failing check**

```js
check("docs: the README's install lines name the marketplace, the version is one everywhere, and copies are in step", () => {
  const readme = fs.readFileSync(path.join(__dirname, "README.md"), "utf8");
  for (const line of ["claude plugin install mymarkdown@mymarkdown-plugins", "copilot plugin install mymarkdown@mymarkdown-plugins", "codex plugin add mymarkdown@mymarkdown-plugins", "devin plugins install ardeeshany/MyMarkdown#vscode-extension/agent-hooks/plugin", "opencode plugin add mymarkdown-hooks", "plugin-antigravity", "~/.kiro/hooks", "~/.agents/skills"]) {
    includes(readme, line, "extension README");
  }
  includes(readme, "Install once for every project", "the section");
  const npm = fs.readFileSync(path.join(__dirname, "agent-hooks", "README.md"), "utf8");
  includes(npm, "not affiliated", "the npm README disowns the unrelated mymarkdown-* packages");
  includes(npm, "opencode plugin add mymarkdown-hooks", "the npm README says it is the OpenCode plugin");
  for (const copy of [".agents/skills/markdown-labels/SKILL.md", ".claude/skills/markdown-labels/SKILL.md"]) {
    assert(fs.readFileSync(path.join(REPO, copy), "utf8") === fs.readFileSync(path.join(__dirname, PLUGIN, "skills/markdown-labels/SKILL.md"), "utf8"), copy + " drifted from the plugin's skill");
  }
});
```

- [ ] **Step 2: Run to see it fail** — Expected: `1 failed`.

- [ ] **Step 3: Write the docs**

In `vscode-extension/README.md`, after the paragraph ending "You need Node.js on your `PATH`." and before "Then each agent may need one step of its own:", insert:

```markdown
#### Install once for every project

Instead of setting up each project, install the hook and skill once as a plugin, through
each agent's own plugin command. It then runs in every project, and stays quiet in a project
that has the per-project setup above. Requires Node.js 18 or later.

```
Claude Code   claude plugin marketplace add ardeeshany/MyMarkdown
              claude plugin install mymarkdown@mymarkdown-plugins
Cursor        nothing more once installed in Claude Code (Cursor imports it); or Customize →
              From GitHub Repository → ardeeshany/MyMarkdown
Copilot CLI   copilot plugin marketplace add ardeeshany/MyMarkdown
              copilot plugin install mymarkdown@mymarkdown-plugins
Codex         codex plugin marketplace add ardeeshany/MyMarkdown
              codex plugin add mymarkdown@mymarkdown-plugins
              then in the terminal app, /hooks: trust the hook once
Windsurf      devin plugins install ardeeshany/MyMarkdown#vscode-extension/agent-hooks/plugin
Augment       auggie plugin marketplace add ardeeshany/MyMarkdown
              auggie plugin install mymarkdown@mymarkdown-plugins
Qoder CLI     qoder plugins marketplace add ardeeshany/MyMarkdown
              qoder plugins install mymarkdown
OpenCode      opencode plugin add mymarkdown-hooks
Antigravity   agy plugin install https://github.com/ardeeshany/MyMarkdown/vscode-extension/agent-hooks/plugin-antigravity
Kiro          copy plugin/kiro/markdown-labels.json and plugin/hooks/markdown-labels.cjs to ~/.kiro/hooks/,
              and plugin/skills/markdown-labels to ~/.kiro/skills/
Any other     cp -r plugin/skills/markdown-labels ~/.agents/skills/   (the skill only, no nudge)
```

The plugin folder is `vscode-extension/agent-hooks/plugin` in the repository. Adding a
marketplace clones the repository (Claude Code users can pass
`--sparse vscode-extension/agent-hooks/plugin .claude-plugin`). Labels land in `.mymd/` at the
top of the git repository the agent works in, so open that folder in VS Code. Cursor's Cloud
Agents and Windsurf's cloud sessions do not run user plugins; the per-project setup covers
them. Update and uninstall are each agent's own plugin commands. The install lines for
Windsurf, Augment, Qoder, OpenCode, Antigravity and Kiro follow each tool's documentation and
have not yet been run end to end; please report what you find.
```

In `agent-hooks/README.md`, append:

```markdown
## As a plugin

The same folder is a plugin for Claude Code, Codex, Copilot, Cursor, Windsurf and others,
installed once per machine; see the extension README's "Install once for every project".
This package is also the OpenCode plugin: `opencode plugin add mymarkdown-hooks`.

Not affiliated with the `mymarkdown-cli` or `mymarkdown-mcp` packages on npm.
```

- [ ] **Step 4: Run** — Expected: `96 passed`.

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/README.md vscode-extension/agent-hooks/README.md vscode-extension/check.js && git commit -m "$(cat <<'EOF'
Document installing the label hook once, per agent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Live verification and the pull request

**Files:**
- No source changes unless a live check finds a defect (then fix, add a check, commit).
- Modify: the PR #8 description (via `gh pr edit`), the PR checklist.

- [ ] **Step 1: Claude Code validates the plugin and the marketplace**

```bash
cd /mnt/fast/python_projects/MyMarkdown-fork
claude plugin validate --strict ./vscode-extension/agent-hooks/plugin
claude plugin validate .
```

Expected: both report no errors. If `--strict` wants a field, add it to the manifests (Task 1's check enforces the required ones).

- [ ] **Step 2: Claude Code runs the plugin in a scratch repository (paid, cheap model)**

```bash
S=$(mktemp -d); mkdir -p $S/proj/docs && cd $S/proj && git init -q
claude -p "Write docs/tea.md: a practical guide to brewing loose-leaf tea, about 550 words, with an H1 title and four H2 sections. Plain Markdown only." \
  --model haiku --permission-mode acceptEdits --allowedTools "Skill Read Write Edit Glob Grep" \
  --plugin-dir /mnt/fast/python_projects/MyMarkdown-fork/vscode-extension/agent-hooks/plugin \
  --output-format stream-json --verbose --max-turns 25 < /dev/null > run.jsonl 2> run.err
grep -o '"hook_name":"[^"]*"' run.jsonl | sort | uniq -c
grep -c "mymarkdown:markdown-labels" run.jsonl
ls .mymd/docs 2>/dev/null
```

Expected: a `PostToolUse` hook from the plugin fired after the Write; the nudge text appears; ideally `.mymd/docs/tea.md.json` exists. If the model did not invoke the skill under the name `mymarkdown:markdown-labels`, note the exact skill name Claude listed (grep `run.jsonl` for `markdown-labels`) and adjust `skillName` for `claude`.

- [ ] **Step 3: Copilot CLI with the plugin folder, isolated home**

```bash
S=$(mktemp -d); mkdir -p $S/home $S/proj/docs && cd $S/proj && git init -q
COPILOT_HOME=$S/home COPILOT_AUTO_UPDATE=false COPILOT_ALLOW_ALL=true copilot -p "Write docs/tea.md: a practical guide to brewing loose-leaf tea, about 550 words, with an H1 title and four H2 sections. Plain Markdown only." \
  --no-auto-update --plugin-dir /mnt/fast/python_projects/MyMarkdown-fork/vscode-extension/agent-hooks/plugin --log-level debug --log-dir $S/logs < /dev/null > run.out 2> run.err
grep -h "hook stdout" $S/logs/*.log | head
```

Expected: one `[hook stdout] {"additionalContext":"docs/tea.md is now …"}` line per write (the Copilot-schema file), and no second nudge from the Claude-schema file. If the Claude-schema file also fires, record it: the hook's dedupe returns nothing for that copy only when `--claude-settings` is passed, which a plugin does not; in that case add to `hooks/hooks.json`'s command a `--plugin` flag and make the hook stay quiet on a Copilot-format payload when it carries `tool_result`.

- [ ] **Step 4: Codex sees the plugin's hook**

```bash
S=$(mktemp -d); mkdir -p $S/home $S/proj && cd $S/proj && git init -q
C=$(ls ~/.vscode-server/extensions/openai.chatgpt-*/bin/linux-x86_64/codex | tail -1)
CODEX_HOME=$S/home HOME=$S/home $C plugin marketplace add /mnt/fast/python_projects/MyMarkdown-fork
CODEX_HOME=$S/home HOME=$S/home $C plugin add mymarkdown@mymarkdown-plugins
CODEX_HOME=$S/home HOME=$S/home $C plugin list --json
```

Then the `hooks/list` JSON-RPC probe from the earlier session (`printf` the initialize/initialized/hooks.list lines into `$C app-server --listen stdio://` with `cwds=[$S/proj]`) — expected: the hook appears with source `plugin`. Record the trust status shown.

- [ ] **Step 5: Record, and update the PR**

Write the results into the PR body's checklist (`gh pr edit 8 -R ardeeshany/MyMarkdown --body-file …`): tick what ran, note what did not (Cursor, Devin, Augment, Qoder, OpenCode, Antigravity, Kiro are not installed here), and keep the PR a draft until the maintainer or a machine with those tools has run them. Push the branch:

```bash
git push origin feat/agent-plugin
```

---

## Self-review

**Spec coverage.** Layout (Tasks 1, 5, 6, 7); marketplace files (2); names and versions (1, 2); manifests (1); shared and Copilot hook files (3); adapters: OpenCode (6), Antigravity (5), Kiro (7), skills-only line (9); the hook: root, yield, dialects, skill naming (3–5); the extension (8); installing lines and README (9); verification (each task's check; live in 10); "Where to publish" is in the spec and issue, not code. Gap: the spec's `.qoder-plugin` manifest and `.cursor-plugin` manifest are in Task 1; Qoder's marketplace file format is an open item and no file is created (the README's Qoder line uses the marketplace-add form the docs show; if the maintainer finds Qoder needs a file, it is one more marketplace JSON).

**Placeholders.** None: every file has its content, every check its code.

**Type consistency.** `pluginRepo()` returns `{ base, root, doc, script, run, cleanup }` and Tasks 4–6 use exactly those. `detect()` returns `{ dialect, tool, input, event? }`; `main` reads `dialect`, `tool`, `input`; Task 5 adds `event`. `respond(dialect, text, payload)` is the Task 5 signature; Task 3 introduces it with two parameters and Task 5 adds the third (an implementer doing Task 5 sees the note). `TARGETS[].from` is relative to `agent-hooks/` from Task 1 on, and `check.js`'s `template()` follows.

**Review Focus.** 1 → Task 4's last assertion (no `.mymd` next to the plugin) and the Cursor case's `cwd`; 2 → Task 4's two Devin patch shapes; 3 → Task 5's `toolCall: null` case; 4 → Task 3's stamp-twice assertion; 5 → Task 8's "exactly one write".
