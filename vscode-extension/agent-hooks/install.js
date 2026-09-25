// Installing the label hook and skill into a project, for every coding agent the hook
// supports. One implementation behind both ways in: the extension's "Install Label Hooks
// for Coding Agents" command, and the mymarkdown-hooks command line (npx).
//
// Nothing a person wrote is lost. A file that is entirely ours is only replaced when it
// already matches, or when the caller passes `force`. The two config files agents share
// with other tools (.claude/settings.json, .codex/hooks.json) get our one hook entry merged
// in, and everything else in them is left exactly as it was.
"use strict";

const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual } = require("util");

const TEMPLATES = path.join(__dirname, "files");

/**
 * Where each file goes, relative to the project root, and the template it comes from.
 * Claude Code reads only .claude/skills; Copilot, VS Code and Codex read .agents/skills.
 * Cursor reads both, and reads Claude Code's hooks from .claude/settings.json.
 */
const TARGETS = [
  { dest: ".agents/hooks/markdown-labels.cjs", from: "markdown-labels.cjs" },
  { dest: ".agents/skills/markdown-labels/SKILL.md", from: "SKILL.md" },
  { dest: ".claude/skills/markdown-labels/SKILL.md", from: "SKILL.md" },
  { dest: ".claude/settings.json", from: "claude-settings.json", merge: true },
  { dest: ".github/hooks/markdown-labels.json", from: "copilot-hooks.json" },
  { dest: ".codex/hooks.json", from: "codex-hooks.json", merge: true },
];

/** Our entry in a shared hooks file is the one that runs this script, at any path. */
const isOurs = (hook) => String(hook?.command ?? "").includes("markdown-labels.cjs");
const holdsOurs = (group) => Array.isArray(group?.hooks) && group.hooks.some(isOurs);

function write(file, text, status) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { status };
}

/** The indentation a JSON file already uses, so merging into it does not reformat it all. */
function indentOf(text) {
  const match = /\n([ \t]+)\S/.exec(text);
  return match ? match[1] : 2;
}

function installOwn(file, template, force) {
  if (!fs.existsSync(file)) return write(file, template, "created");
  if (fs.readFileSync(file, "utf8") === template) return { status: "unchanged" };
  return force ? write(file, template, "updated") : { status: "differs" };
}

/** Add our entry to a Claude-shaped hooks file ({hooks: {Event: [{matcher, hooks}]}}). */
function mergeInto(file, templateText, force) {
  if (!fs.existsSync(file)) return write(file, templateText, "created");
  const text = fs.readFileSync(file, "utf8");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { status: "invalid", reason: "not valid JSON" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { status: "invalid", reason: "not a JSON object" };
  }
  data.hooks ??= {};
  if (typeof data.hooks !== "object" || Array.isArray(data.hooks)) {
    return { status: "invalid", reason: '"hooks" is not an object' };
  }

  let added = false;
  let replaced = false;
  let differs = false;
  for (const [event, groups] of Object.entries(JSON.parse(templateText).hooks)) {
    const list = (data.hooks[event] ??= []);
    if (!Array.isArray(list)) return { status: "invalid", reason: `"hooks.${event}" is not a list` };
    for (const group of groups) {
      const at = list.findIndex(holdsOurs);
      if (at === -1) {
        list.push(group);
        added = true;
      } else if (!isDeepStrictEqual(list[at], group)) {
        differs = true;
        if (!force) continue;
        // Anything else sharing that entry stays where it is; ours moves to its own entry.
        const others = list[at].hooks.filter((hook) => !isOurs(hook));
        if (others.length) {
          list[at].hooks = others;
          list.push(group);
        } else {
          list[at] = group;
        }
        replaced = true;
      }
    }
  }

  if (!added && !replaced) return { status: differs ? "differs" : "unchanged" };
  fs.writeFileSync(file, JSON.stringify(data, null, indentOf(text)) + (text.endsWith("\n") ? "\n" : ""));
  return { status: replaced ? "updated" : "merged" };
}

/**
 * Install into the project at `root`. Returns one result per file, in TARGETS order:
 *   created    the file did not exist and was written
 *   merged     our hook entry was added to an existing shared config file
 *   unchanged  already exactly this version
 *   differs    present but different (edited, or from an older release); left alone
 *   updated    differed and was replaced, because `force` was set
 *   invalid    a shared config file that could not be read as JSON; left alone
 *   failed     could not be written (`reason` says why)
 *
 * @param {string} root the project root: agents run hooks from there
 * @param {{force?: boolean}} [options]
 * @returns {Array<{file: string, status: string, reason?: string}>}
 */
function installAgentHooks(root, { force = false } = {}) {
  if (!fs.statSync(root).isDirectory()) throw new Error(`${root} is not a folder`);
  return TARGETS.map((target) => {
    const file = path.join(root, ...target.dest.split("/"));
    const template = fs.readFileSync(path.join(TEMPLATES, target.from), "utf8");
    try {
      return { file: target.dest, ...(target.merge ? mergeInto : installOwn)(file, template, force) };
    } catch (error) {
      return { file: target.dest, status: "failed", reason: error.message };
    }
  });
}

module.exports = { installAgentHooks, TARGETS };
