#!/usr/bin/env node
/*
  Trigger for the markdown-labels skill, shared by every coding agent this repo wires up:

    Claude Code         .claude/settings.json
    GitHub Copilot CLI  .github/hooks/markdown-labels.json
    VS Code agent mode  .github/hooks/markdown-labels.json (VS Code reads Copilot's format)
    Codex               .codex/hooks.json

  A skill only runs when the agent remembers to reach for it. This hook makes the trigger
  the harness's job instead: after any write to a Markdown file, it checks whether the
  document is big enough to be worth labelling and whether it already has labels, and if
  not it says so in the agent's context. The agent then invokes the skill, which is where
  all the actual judgement lives.

  After a write to a sidecar (.mymd/<path>.md.json) it stamps every range that has no
  anchors with the document's own text, the way the extension stamps the ranges it writes.
  Unanchored ranges keep their line numbers, so a skill-written label would otherwise slide
  off its section at the first edit above it.

  Deliberately self-contained, so it keeps working when copied into another repo.
*/
"use strict";

const fs = require("fs");
const path = require("path");

const MIN_WORDS = 400;
const MIN_HEADINGS = 2;
// ponytail: the extension's default mymarkdown.labels.storagePath; a custom one is not followed.
const STORAGE = ".mymd";
// This file lives at <root>/.agents/hooks/. Agents report the cwd their session started in,
// which may be a subfolder, so the root comes from here instead.
const ROOT = path.resolve(__dirname, "..", "..");

// Names each agent gives a tool that writes files. Reads (Read, view, read_file) are left
// out on purpose: opening an old document is not a reason to label it.
const WRITE_TOOLS = new Set([
  "Write", "Edit", "MultiEdit", // Claude Code
  "create", "edit", "str_replace_editor", "str_replace", // Copilot CLI
  "create_file", "replace_string_in_file", "multi_replace_string_in_file", "insert_edit_into_file", // VS Code
  "apply_patch", // Codex, VS Code
]);

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
  for (let i = Math.max(0, startLine - 1); i <= endLine - 1 && i < lines.length; i += 1) {
    if (!String(lines[i] ?? "").trim()) continue;
    if (first === -1) first = i;
    last = i;
  }
  return {
    anchor: first === -1 ? "" : normalizeAnchor(lines[first]),
    endAnchor: last === -1 ? "" : normalizeAnchor(lines[last]),
  };
}

/** Every file a tool call wrote, as absolute paths, whichever agent described it. */
function writtenFiles(input, cwd) {
  const found = [input.file_path, input.path, input.filePath];
  for (const r of Array.isArray(input.replacements) ? input.replacements : []) found.push(r?.filePath);
  // apply_patch keeps its paths in the patch text: tool_input.input in VS Code, .command in
  // Codex, .patch (or the bare string) in Copilot CLI.
  const patch = String(input.input ?? input.patch ?? input.command ?? "");
  for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm)) found.push(m[1].trim());
  return [...new Set(found.filter((f) => typeof f === "string" && f).map((f) => path.resolve(cwd, f)))];
}

/**
 * Whether the preview would still draw something for this document: a range with no anchor
 * stays on its lines, and an anchored one survives while its opening line is still there.
 * ponytail: a cheap stand-in for readLabels in lib/labels.js, which also checks end lines
 * and repeated openings; good enough to decide whether to nag.
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
  if (changed) fs.writeFileSync(sidecar, JSON.stringify(data, null, 2) + "\n");
}

/** The nudge for one Markdown file, or null when it is small or already labelled. */
function nudge(file, relative) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null; // Deleted or moved since the write; nothing to label.
  }
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  // A "# comment" in a fenced shell block is not a heading.
  const prose = text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, "");
  const headings = (prose.match(/^ {0,3}#{1,6}\s/gm) || []).length;
  if (words < MIN_WORDS || headings < MIN_HEADINGS) return null;
  if (isLabelled(path.join(ROOT, STORAGE, relative + ".json"), text)) return null;
  const shown = relative.split(path.sep).join("/");
  // Worded as an instruction: put as a suggestion, models skip it as "not requested".
  return (
    `${shown} is now ${words} words across ${headings} headings, past the markdown-labels ` +
    `threshold, and has no MyMarkdown labels. Run the markdown-labels skill now, before you ` +
    `finish, to write label lenses for it.`
  );
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
  const copilot = "toolName" in payload;
  const tool = copilot ? payload.toolName : payload.tool_name;
  if (!WRITE_TOOLS.has(tool)) return;
  let input = copilot ? payload.toolArgs : payload.tool_input;
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

  const notes = [];
  for (const file of writtenFiles(input, payload.cwd || process.cwd())) {
    const relative = path.relative(ROOT, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const parts = relative.split(path.sep);
    if (parts[0] === STORAGE) {
      if (/\.md\.json$/i.test(relative)) stamp(file, path.join(ROOT, ...parts.slice(1)).slice(0, -".json".length));
      continue;
    }
    if (!/\.md$/i.test(relative) || parts.includes("node_modules") || parts.includes(".git")) continue;
    const note = nudge(file, relative);
    if (note) notes.push(note);
  }
  if (!notes.length) return;

  const additionalContext = notes.join("\n");
  process.stdout.write(
    JSON.stringify(
      copilot ? { additionalContext } : { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } },
    ),
  );
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
