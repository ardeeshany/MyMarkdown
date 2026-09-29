#!/usr/bin/env node
/*
  Trigger for the markdown-labels skill, shared by every coding agent this repo wires up.
  It is installed one of two ways.

  Per repo, at .agents/hooks/, run from each agent's own config:

    Claude Code, Cursor  .claude/settings.json
    GitHub Copilot CLI   .github/hooks/markdown-labels.json
    VS Code agent mode   .github/hooks/markdown-labels.json (VS Code reads Copilot's format)
    Codex                .codex/hooks.json
    Kiro                 .kiro/hooks/markdown-labels.json

  Each config runs it through the same one-line `node -e` launcher, which finds this file
  from $CLAUDE_PROJECT_DIR, or else by walking up from wherever the agent runs it. A path
  written the usual way would need one shell's syntax, and the agents use bash, sh,
  PowerShell or cmd depending on the platform; some start in a subfolder.

  As a plugin, once per machine: one folder that each agent's plugin system reads. The
  project then comes from what the agent tells the hook, and the hook stays quiet wherever
  a per-repo copy already runs for that agent.

  A skill only runs when the agent remembers to reach for it. This hook makes the trigger
  the harness's job instead: after any write to a Markdown file, it checks whether the
  document is big enough to be worth labelling and whether it already has labels, and if
  not it says so in the agent's context. The agent then invokes the skill, which is where
  all the actual judgement lives.

  After a write to a sidecar (.mymd/<document path>.json) it stamps every range that has no
  anchors with the document's own text, the way the extension stamps the ranges it writes.
  Unanchored ranges keep their line numbers, so a skill-written label would otherwise slide
  off its section at the first edit above it.

  Deliberately self-contained, so it keeps working when copied into another repo.
*/
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const MIN_WORDS = 400;
const MIN_HEADINGS = 2;
// The extension's default mymarkdown.labels.storagePath. A custom one is not followed.
const STORAGE = ".mymd";
// The file extensions VS Code opens as Markdown (its markdown-basics list, less .litcoffee,
// .ron, .ronn and .workbook, which are usually something else).
const MARKDOWN = /\.(md|mkd|mkdn|mdwn|mdown|markdown|markdn|mdtxt|mdtext)$/i;
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
function projectRoot(payload, dialect) {
  if (IN_PROJECT) return { root: OWN_ROOT, inProject: true };
  // Kiro sets none of the variables below, and its cwd is always the first workspace root,
  // which is where the skill writes .mymd/ even when the git top sits above it.
  if (dialect === "kiro" && typeof payload.cwd === "string" && payload.cwd) return { root: path.resolve(payload.cwd), inProject: false };
  const env = process.env;
  const fromEnv = env.CLAUDE_PROJECT_DIR || env.QODER_PROJECT_DIR || env.DEVIN_PROJECT_DIR || env.COPILOT_PROJECT_DIR || env.AUGMENT_PROJECT_DIR || env.CURSOR_PROJECT_DIR;
  const workspace = (Array.isArray(payload.workspace_roots) && typeof payload.workspace_roots[0] === "string" && payload.workspace_roots[0]) || (Array.isArray(payload.workspacePaths) && typeof payload.workspacePaths[0] === "string" && payload.workspacePaths[0]);
  const written = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : (payload.toolCall && payload.toolCall.args && typeof payload.toolCall.args.TargetFile === "string" && payload.toolCall.args.TargetFile ? path.dirname(payload.toolCall.args.TargetFile) : null);
  return { root: path.resolve(fromEnv || workspace || (written ? gitTop(written) : process.cwd())), inProject: false };
}

/**
 * Antigravity can only inject context from PostInvocation, so PostToolUse leaves the nudge
 * here. Lives in a per-user folder, not a name any local user could predict and plant ahead of
 * us: null when there is no conversation to key it on, so nothing is ever read or written.
 */
function markerFor(payload) {
  if (typeof payload.conversationId !== "string" || !payload.conversationId) return null;
  const owner = typeof process.getuid === "function" ? String(process.getuid()) : os.userInfo().username;
  const dir = path.join(os.tmpdir(), "mymarkdown-labels-" + owner);
  // Prefixed, so an id such as CON or NUL never names a Windows device.
  return { dir, file: path.join(dir, "c-" + payload.conversationId.replace(/[^\w.-]/g, "_")) };
}

/** True once `dir` exists, owned by us and not a symlink - never throws. */
function ownedDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink()) return false;
    if (typeof process.getuid !== "function") return true;
    if (stat.uid !== process.getuid()) return false;
    // Ours, but maybe made earlier under a looser umask: close it before trusting it.
    if (stat.mode & 0o077) fs.chmodSync(dir, 0o700);
    return true;
  } catch {
    return false;
  }
}

/** True when `file` does not exist or is not a symlink - the only cases safe to read or append. */
function notASymlink(file) {
  try {
    return !fs.lstatSync(file).isSymbolicLink();
  } catch {
    return true; // Doesn't exist yet: safe either way.
  }
}

/** How the agent lists the skill: a plugin's skill is namespaced in some agents. */
function skillName(dialect, inProject) {
  if (inProject) return "markdown-labels";
  if (dialect === "cursor") return "/markdown-labels";
  // Qoder's Skill tool matches the plugin-qualified name exactly; a bare name costs a failed call.
  if (["claude", "devin", "antigravity", "qoder", "augment"].includes(dialect)) return "mymarkdown:markdown-labels";
  return "markdown-labels";
}

// Names each agent gives a tool that writes files. Reads (Read, view, read_file) are left
// out on purpose: opening an old document is not a reason to label it.
const WRITE_TOOLS = new Set([
  "Write", "Edit", "MultiEdit", // Claude Code
  "create", "edit", "str_replace_editor", "str_replace", // Copilot CLI
  "create_file", "replace_string_in_file", "multi_replace_string_in_file", "insert_edit_into_file", // VS Code
  "apply_patch", // Codex, VS Code
  "write", "notebook_edit", // Devin (edit and apply_patch are above)
  "save-file", "str-replace-editor", // Augment
  "write_to_file", "replace_file_content", "multi_replace_file_content", // Antigravity
]);

// These are the dialects whose per-repo config the installer writes, or that run it anyway:
// Cursor loads .claude/settings.json too, setting CLAUDE_PROJECT_DIR for Claude compatibility.
// Devin, Augment, Qoder (it loads hooks only from .qoder/settings*.json) and Antigravity have
// no per-repo copy running, so they never yield to one.
const YIELDS = new Set(["claude", "copilot", "cursor", "kiro"]);

// Same anchors as anchorsFor in vscode-extension/lib/labels.js; check.js holds them equal.
const ANCHOR_LENGTH = 500;

function normalizeAnchor(line) {
  return String(line ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, ANCHOR_LENGTH);
}

function anchorsFor(lines, startLine, endLine) {
  let first = -1;
  let last = -1;
  let before = -1;
  for (let i = Math.max(0, startLine - 1); i <= endLine - 1 && i < lines.length; i += 1) {
    if (!String(lines[i] ?? "").trim()) continue;
    if (first === -1) first = i;
    else before = last;
    last = i;
  }
  return {
    anchor: first === -1 ? "" : normalizeAnchor(lines[first]),
    endAnchor: last === -1 ? "" : normalizeAnchor(lines[last]),
    prevAnchor: before === -1 ? "" : normalizeAnchor(lines[before]),
  };
}

/** Every file a tool call wrote, as absolute paths, whichever agent described it. */
function writtenFiles(input, cwd) {
  const found = [input.file_path, input.path, input.filePath, ...(Array.isArray(input.paths) ? input.paths : [])];
  for (const r of Array.isArray(input.replacements) ? input.replacements : []) found.push(r?.filePath);
  // apply_patch keeps its paths in the patch text: tool_input.input in VS Code, .command in
  // Codex, .patch (or the bare string) in Copilot CLI, .raw_patch in Devin.
  const patch = String(input.input ?? input.raw_patch ?? input.patch ?? input.command ?? "");
  for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm)) found.push(m[1].trim());
  return [...new Set(found.filter((f) => typeof f === "string" && f).map((f) => path.resolve(cwd, f)))];
}

/**
 * Whether the preview would still draw something for this document: a range with no anchor
 * stays on its lines, and an anchored one survives while its opening line is still there.
 * A cheap stand-in for readLabels in lib/labels.js, which also checks end lines and
 * repeated openings; good enough to decide whether to nag.
 */
function isLabelled(sidecar, text) {
  let lenses;
  try {
    lenses = JSON.parse(fs.readFileSync(sidecar, "utf8")).lenses;
  } catch {
    return false;
  }
  const lines = new Set(text.split("\n").map(normalizeAnchor));
  return (Array.isArray(lenses) ? lenses : []).some((lens) =>
    (Array.isArray(lens?.ranges) ? lens.ranges : []).some((r) => r && (!r.anchor || lines.has(r.anchor))),
  );
}

/** Give each unanchored range the anchors of the text it covers right now. */
function stamp(sidecar, doc) {
  let data;
  let lines;
  try {
    data = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    lines = fs.readFileSync(doc, "utf8").split("\n");
  } catch {
    return;
  }
  let changed = false;
  for (const lens of Array.isArray(data?.lenses) ? data.lenses : []) {
    for (const range of Array.isArray(lens?.ranges) ? lens.ranges : []) {
      if (!range || range.anchor) continue;
      const anchors = anchorsFor(lines, Math.trunc(Number(range.startLine)), Math.trunc(Number(range.endLine)));
      if (!anchors.anchor) continue;
      Object.assign(range, anchors);
      changed = true;
    }
  }
  if (!changed) return;
  // Through a temporary file, as the installer writes: a write that fails midway (a full
  // disk) must not leave the agent's sidecar cut short and every lens in it lost.
  const temp = `${sidecar}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
    fs.renameSync(temp, sidecar);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** Headings outside fenced code: a "# comment" in a fenced shell block is not a heading.
 * One pass over the lines; a regex over the whole text backtracks on long fence runs. */
function countHeadings(text) {
  let fence = "";
  let headings = 0;
  for (const line of text.split("\n")) {
    const run = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (run && run[0] === fence[0] && run.length >= fence.length) fence = "";
    } else if (run) {
      fence = run;
    } else if (/^ {0,3}#{1,6}(\s|$)/.test(line)) {
      headings += 1;
    }
  }
  return headings;
}

/** The nudge for one Markdown file, or null when it is small or already labelled. */
function nudge(root, file, relative, skill) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null; // Deleted or moved since the write; nothing to label.
  }
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const headings = countHeadings(text);
  if (words < MIN_WORDS || headings < MIN_HEADINGS) return null;
  if (isLabelled(path.join(root, STORAGE, relative + ".json"), text)) return null;
  const shown = relative.split(path.sep).join("/");
  // Worded as an instruction: put as a suggestion, models skip it as "not requested".
  return (
    `${shown} is now ${words} words across ${headings} headings, past the markdown-labels ` +
    `threshold, and has no MyMarkdown labels. Run the ${skill} skill now, before you finish, ` +
    `to write label lenses for it.`
  );
}

/**
 * Which agent sent this payload, and the write it describes, in one shape. Agents differ in
 * case (Devin), casing of the event name (Cursor), where the paths sit (Augment lists them in
 * file_changes; Kiro's save event names one file), and how a patch is carried.
 */
function detect(payload) {
  if ("conversationId" in payload && ("toolCall" in payload || "invocationNum" in payload)) {
    const call = payload.toolCall;
    const target = call && call.args && typeof call.args.TargetFile === "string" ? call.args.TargetFile : null;
    return { dialect: "antigravity", tool: call ? call.name : null, input: target ? { file_path: target } : {}, event: "invocationNum" in payload ? "invocation" : "tool" };
  }
  if ("toolName" in payload) return { dialect: "copilot", tool: payload.toolName, input: payload.toolArgs };
  // Copilot CLI running the plugin's Claude-schema hooks.json: Claude Code, Codex and VS Code
  // send tool_response, Cursor tool_output; only Copilot sends tool_result.
  if ("tool_result" in payload && !("tool_response" in payload)) return { dialect: "copilot", tool: payload.tool_name, input: payload.tool_input };
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
  // OpenCode's adapter builds a Claude-shaped payload (it has a cwd, like Codex and Claude
  // Code), but it runs no per-repo hook of its own, so it must never yield to one and must
  // get its own skill name - both keyed off a dialect of its own, not the claude fall-through.
  if (payload.agent === "opencode") return { dialect: "opencode", tool, input };
  // Qoder CLI's payload is byte-identical to Claude Code's, so the variables it sets only in
  // hook subprocesses are the one way to tell it apart.
  if (process.env.QODER_HOOK_SOURCE || process.env.QODER_PROJECT_DIR) return { dialect: "qoder", tool, input };
  // Devin never sends a cwd; Codex and Claude Code always do. Without that check, a shared
  // tool name (apply_patch) would call Codex Devin, and Codex's own per-repo copy in
  // .codex/hooks.json would never get the chance to yield to it.
  if (typeof tool === "string" && /^(write|edit|apply_patch|notebook_edit)$/.test(tool) && typeof payload.cwd !== "string") {
    if (payload.tool_response && payload.tool_response.success === false) return { dialect: "devin", tool: null, input };
    return { dialect: "devin", tool, input };
  }
  return { dialect: "claude", tool, input };
}

function main(payload) {
  // Copilot CLI, and VS Code with chat.useClaudeHooks on, run Claude's hooks as well as
  // their own. Their own entry in .github/hooks speaks for them, so this copy stays quiet.
  // Told apart by the payload, not the environment: Copilot's Claude-format payload carries
  // tool_result (Claude Code sends tool_response, Cursor tool_output), while the COPILOT_CLI
  // variable is inherited by anything started from a Copilot shell, Claude Code included.
  if (
    process.argv.includes("--claude-settings") &&
    ("tool_result" in payload || !process.env.CLAUDE_PROJECT_DIR)
  ) {
    return;
  }

  // Copilot CLI's own format is camelCase and takes its context at the top level; Claude
  // Code, VS Code and Codex send snake_case and read hookSpecificOutput.
  const detected = detect(payload);
  if (detected.dialect === "antigravity") {
    if (detected.event === "invocation") {
      let raw = null;
      try {
        const marker = markerFor(payload);
        if (marker && ownedDir(marker.dir) && notASymlink(marker.file)) {
          raw = fs.readFileSync(marker.file, "utf8");
          fs.rmSync(marker.file, { force: true });
        }
      } catch {
        // No write since the last invocation, no conversation to key it on, or the marker
        // (or the folder it lives in) was refused as unsafe.
      }
      // One or more writes may have appended their own nudge since the last invocation;
      // repeats (the same file nudged twice) collapse to one line.
      const lines = raw ? [...new Set(raw.split("\n").map((line) => line.trim()).filter(Boolean))] : [];
      // PreInvocation runs with --ephemeral: PostInvocation may fire before its invocation's
      // tools finish, and PreInvocation's ephemeralMessage is the slot known to reach the model.
      // Whichever runs first consumes the marker, so the nudge still arrives once.
      const key = process.argv.includes("--ephemeral") ? "ephemeralMessage" : "userMessage";
      process.stdout.write(lines.length ? JSON.stringify({ injectSteps: [{ [key]: lines.join("\n") }] }) : "{}");
      return;
    }
    // PostToolUse cannot inject context, so it must always answer {} - printed once, up
    // front, before anything below gets a chance to return early or throw (main's own
    // top-level catch would otherwise swallow the error and leave stdout empty).
    process.stdout.write("{}");
  }
  const { dialect } = detected;
  const tool = detected.tool;
  // WRITE_TOOLS.has(null) is false, so a non-tool or non-write Antigravity step (already
  // answered {} above) is caught here too, same as every other dialect.
  if (!WRITE_TOOLS.has(tool)) return;
  let input = detected.input;
  // Arguments may arrive JSON-encoded, or as a bare patch (Copilot's apply_patch).
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

  const { root: ROOT, inProject } = projectRoot(payload, dialect);
  // A project with its own per-repo install is that copy's business; two nudges help nobody.
  // Only true when a per-repo copy actually runs for this dialect (see YIELDS above).
  if (!inProject && YIELDS.has(dialect) && fs.existsSync(path.join(ROOT, ".agents", "hooks", "markdown-labels.cjs"))) return;
  // The older per-repo layout runs from .claude/settings.json, which only Claude Code and Cursor read with CLAUDE_PROJECT_DIR set.
  if (!inProject && (dialect === "claude" || dialect === "cursor") && process.env.CLAUDE_PROJECT_DIR && fs.existsSync(path.join(ROOT, ".claude", "hooks", "markdown-labels.cjs"))) return;
  // Relative paths are relative to where the agent works. Cursor has run plugin hooks with the
  // plugin folder as cwd (and older builds with the project), so its cwd is trusted only
  // inside the project.
  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : null;
  const fromRoot = cwd && path.relative(ROOT, cwd);
  const base = cwd && (dialect !== "cursor" || !(fromRoot.startsWith("..") || path.isAbsolute(fromRoot))) ? cwd : inProject ? process.cwd() : ROOT;

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
  respond(dialect, notes.join("\n"), payload);
}

/** Each agent reads the nudge from a different place in the hook's output. */
function respond(dialect, additionalContext, payload) {
  if (dialect === "antigravity") {
    // Antigravity already got its {} from the tool-step print above; this only leaves the
    // nudge behind. Appended, not overwritten: a second write before the next PostInvocation
    // must not erase the first one's nudge.
    try {
      const marker = markerFor(payload);
      if (marker && ownedDir(marker.dir) && notASymlink(marker.file)) {
        fs.appendFileSync(marker.file, additionalContext + "\n");
      }
    } catch {
      // A hook must never be the reason a tool call fails; the marker is best-effort.
    }
    return;
  }
  const out =
    dialect === "copilot"
      ? { additionalContext }
      : dialect === "cursor"
        ? { additional_context: additionalContext }
        : { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } };
  process.stdout.write(JSON.stringify(out));
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    main(JSON.parse(input || "{}"));
  } catch {
    // A hook must never be the reason a tool call fails.
  }
  process.exit(0);
});
