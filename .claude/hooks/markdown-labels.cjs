#!/usr/bin/env node
/*
  Trigger for the markdown-labels skill.

  A skill only runs when the agent remembers to reach for it. This hook makes the trigger
  the harness's job instead: after any write to a Markdown file, it checks whether the
  document is big enough to be worth labelling and whether it already has labels, and if
  so it says so in the transcript. The agent then invokes the skill, which is where all
  the actual judgement lives.

  Wired up by .claude/settings.json as a PostToolUse hook on Write and Edit.
*/
"use strict";

const fs = require("fs");
const path = require("path");

const MIN_WORDS = 400;
const MIN_HEADINGS = 2;

function main(payload) {
  const name = payload?.tool_name;
  if (name !== "Write" && name !== "Edit" && name !== "MultiEdit") return;

  const file = payload?.tool_input?.file_path;
  if (typeof file !== "string" || !/\.md$/i.test(file)) return;
  if (/\/(node_modules|\.git|\.mymd)\//.test(file)) return;

  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return; // Deleted or moved since the write; nothing to label.
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const headings = (text.match(/^ {0,3}#{1,6}\s/gm) || []).length;
  if (words < MIN_WORDS || headings < MIN_HEADINGS) return;

  // Labels already covering this exact text need no rewrite.
  const root = payload?.cwd || process.cwd();
  const relative = path.relative(root, file);
  if (!relative.startsWith("..")) {
    const sidecar = path.join(root, ".mymd", relative + ".json");
    try {
      const existing = JSON.parse(fs.readFileSync(sidecar, "utf8"));
      const hash = require("crypto").createHash("sha256").update(text, "utf8").digest("hex");
      if (existing.sourceHash === hash && (existing.lenses || []).length) return;
    } catch {
      // No usable sidecar, so it is worth labelling.
    }
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          `${relative} is now ${words} words across ${headings} headings and has no current ` +
          `MyMarkdown labels. Use the markdown-labels skill to write label lenses for it.`,
      },
    }),
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
