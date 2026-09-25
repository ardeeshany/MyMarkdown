// Installing the label hook and skill into a project, for every coding agent the hook
// supports. One implementation behind both ways in: the extension's "Install Label Hooks
// for Coding Agents" command, and the mymarkdown-hooks command line (npx).
//
// Nothing a person wrote is lost. A file that is entirely ours is only replaced when it
// already matches, or when the caller passes `force`. The two config files agents share
// with other tools (.claude/settings.json, .codex/hooks.json) get our one hook entry merged
// in, and everything else in them is left exactly as it was. Every write goes to a temporary
// file first, so a full disk cannot leave a config half-written.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { isDeepStrictEqual } = require("util");

const TEMPLATES = path.join(__dirname, "files");
const HOOK = ".agents/hooks/markdown-labels.cjs";

/**
 * Where each file goes, relative to the project root, and the template it comes from.
 * Claude Code reads only .claude/skills; Copilot, VS Code and Codex read .agents/skills.
 * Cursor reads both, and reads Claude Code's hooks from .claude/settings.json.
 * `runsHook`: the file registers the hook script, so it is only worth writing with it.
 */
const TARGETS = [
  { dest: HOOK, from: "markdown-labels.cjs" },
  { dest: ".agents/skills/markdown-labels/SKILL.md", from: "SKILL.md" },
  { dest: ".claude/skills/markdown-labels/SKILL.md", from: "SKILL.md" },
  { dest: ".claude/settings.json", from: "claude-settings.json", merge: true, runsHook: true },
  { dest: ".github/hooks/markdown-labels.json", from: "copilot-hooks.json", runsHook: true },
  { dest: ".codex/hooks.json", from: "codex-hooks.json", merge: true, runsHook: true },
];

/**
 * A hook entry we wrote: node running the script, and nothing else. A command that only
 * mentions the script (a linter over it, a wrapper chaining more commands) is the user's.
 */
const RUNS_OURS = /(^|\s)node\s+["']?[^"'\s]*markdown-labels\.cjs["']?(\s+--[\w-]+)*\s*$/;
const isOurs = (hook) => RUNS_OURS.test(String(hook?.command ?? ""));
const mentionsOurs = (hook) => String(hook?.command ?? "").includes("markdown-labels.cjs");
const hooksOf = (group) => (Array.isArray(group?.hooks) ? group.hooks : []);

/** Whether two paths are the same folder on disk, however they are spelled: drive-letter
 * case, symlinks. By file identity where the file system has one. */
function sameFolder(a, b) {
  try {
    const x = fs.statSync(a, { bigint: true });
    const y = fs.statSync(b, { bigint: true });
    if (x.ino && y.ino) return x.dev === y.dev && x.ino === y.ino;
    const real = (p) => {
      const resolved = fs.realpathSync.native(p);
      return process.platform === "linux" ? resolved : resolved.toLowerCase();
    };
    return real(a) === real(b);
  } catch {
    return false;
  }
}

/** Why `file` must not be written, if a symlink would carry the write out of the project. */
function symlinkProblem(root, file) {
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) return "a symlink; left alone";
  let dir = path.dirname(file);
  while (!fs.lstatSync(dir, { throwIfNoEntry: false })) dir = path.dirname(dir);
  const inside = path.relative(fs.realpathSync(root), fs.realpathSync(dir));
  if (inside.startsWith("..") || path.isAbsolute(inside)) return "a symlinked folder leads out of the project; left alone";
  return null;
}

/** Write through a temporary file, so a failure midway leaves the old file whole. */
function write(file, text, status) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.statSync(file, { throwIfNoEntry: false });
  // Renaming over a read-only file would succeed; the user made it read-only for a reason.
  if (existing) fs.accessSync(file, fs.constants.W_OK);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text);
    if (existing) fs.chmodSync(temp, existing.mode);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return { status };
}

/** The indentation a JSON file already uses, so merging into it does not reformat it all. */
function indentOf(text) {
  const match = /\n([ \t]+)\S/.exec(text);
  return match ? match[1] : 2;
}

// A Windows checkout (core.autocrlf) has CRLF line endings; that is not a difference.
const lf = (text) => text.replace(/\r\n/g, "\n");

function installOwn(file, template, force) {
  if (!fs.existsSync(file)) return write(file, template, "created");
  if (lf(fs.readFileSync(file, "utf8")) === lf(template)) return { status: "unchanged" };
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

  let changed = false;
  let differs = false;
  let custom = false;
  for (const [event, [group]] of Object.entries(JSON.parse(templateText).hooks)) {
    const list = data.hooks[event] ?? [];
    if (!Array.isArray(list)) return { status: "invalid", reason: `"hooks.${event}" is not a list` };
    const ours = list.filter((g) => hooksOf(g).some(isOurs));
    // Runs the script its own way; replacing it could run the hook twice, or drop theirs.
    if (list.some((g) => hooksOf(g).some((hook) => mentionsOurs(hook) && !isOurs(hook)))) custom = true;
    if (!ours.length && !custom) {
      data.hooks[event] = [...list, group];
      changed = true;
    } else if (custom || ours.length > 1 || !isDeepStrictEqual(ours[0], group)) {
      differs = true;
      if (!force || custom) continue;
      // Every copy of ours goes (an older release's included); whatever shared an entry
      // with one keeps it. Then ours goes back once.
      const kept = [];
      for (const g of list) {
        if (!hooksOf(g).some(isOurs)) kept.push(g);
        else if (hooksOf(g).some((hook) => !isOurs(hook))) kept.push({ ...g, hooks: g.hooks.filter((hook) => !isOurs(hook)) });
      }
      data.hooks[event] = [...kept, group];
      changed = true;
    }
  }

  if (custom && !changed) {
    return { status: "differs", reason: "another hook here runs markdown-labels.cjs its own way; left alone" };
  }
  if (!changed) return { status: differs ? "differs" : "unchanged" };
  const out = JSON.stringify(data, null, indentOf(text)) + (text.endsWith("\n") ? "\n" : "");
  return write(file, out, differs ? "updated" : "merged");
}

/**
 * Install into the project at `root`. Returns one result per file, in TARGETS order:
 *   created    the file did not exist and was written
 *   merged     our hook entry was added to an existing shared config file
 *   unchanged  already exactly this version
 *   differs    present but different (edited, or from an older release); left alone
 *   updated    differed and was replaced, because `force` was set
 *   invalid    a shared config file that could not be read as JSON; left alone
 *   skipped    registers the hook script, which could not be installed; left alone
 *   failed     could not be written (`reason` says why)
 *
 * @param {string} root the project root: agents run hooks from there
 * @param {{force?: boolean}} [options]
 * @returns {Array<{file: string, status: string, reason?: string}>}
 */
function installAgentHooks(root, { force = false } = {}) {
  if (!fs.statSync(root).isDirectory()) throw new Error(`${root} is not a folder`);
  // In the home folder these paths are every agent's *global* config (~/.claude/settings.json,
  // ~/.codex/hooks.json), and the hook commands in them name a project-relative script, so
  // every session in every other project would run a hook that is not there.
  if (sameFolder(root, os.homedir())) {
    throw new Error(`${root} is your home folder; run this in a project folder instead`);
  }
  const results = [];
  for (const target of TARGETS) {
    const file = path.join(root, ...target.dest.split("/"));
    const template = fs.readFileSync(path.join(TEMPLATES, target.from), "utf8");
    if (target.runsHook && results[0].status === "failed") {
      results.push({ file: target.dest, status: "skipped", reason: "the hook script could not be installed" });
      continue;
    }
    try {
      const problem = symlinkProblem(root, file);
      const result = problem
        ? { status: "failed", reason: problem }
        : (target.merge ? mergeInto : installOwn)(file, template, force);
      results.push({ file: target.dest, ...result });
    } catch (error) {
      results.push({ file: target.dest, status: "failed", reason: error.message });
    }
  }
  return results;
}

/** Results that leave some agent without the hook: the ones to tell the user about. */
const brokenResults = (results) => results.filter((result) => ["invalid", "skipped", "failed"].includes(result.status));

module.exports = { installAgentHooks, brokenResults, sameFolder, TARGETS };
