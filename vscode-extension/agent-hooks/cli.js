#!/usr/bin/env node
// `npx mymarkdown-hooks init`: the command-line way into install.js, for projects worked on
// with Claude Code, Copilot, Cursor or Codex and no VS Code open.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { installAgentHooks, brokenResults, sameFolder } = require("./install.js");

const USAGE = `Usage: mymarkdown-hooks init [project-dir] [--force]

Sets up coding agents (Claude Code, GitHub Copilot CLI and VS Code agent mode, Cursor,
Codex) to label the Markdown they write, for the MyMarkdown VS Code extension.

With no project-dir it installs at the top of the git repository you are in, or in the
current folder outside one. Existing files are never overwritten: the hook entry is merged
into .claude/settings.json and .codex/hooks.json, and a file that differs is left alone.
After an update, run it again with --force to bring the files up to date.

  --force   also replace files and entries that differ from this version
            (ones from an older release, and ones you edited)
`;

/** The top of the git repository `dir` is in, or `dir` itself outside one: agents run hooks
 * from the project root, so that is where the files belong. A repository in the home folder
 * (dotfiles) does not count: it holds every project on the machine, not one. */
function projectRoot(dir) {
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    if (sameFolder(at, os.homedir())) return path.resolve(dir);
    if (fs.existsSync(path.join(at, ".git"))) return at;
    if (path.dirname(at) === at) return path.resolve(dir);
  }
}

function main(argv) {
  const words = argv.filter((arg) => !arg.startsWith("-"));
  const flags = argv.filter((arg) => arg.startsWith("-"));
  if (flags.includes("--help") || flags.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (words[0] !== "init" || words.length > 2 || flags.some((flag) => flag !== "--force")) {
    process.stderr.write(USAGE);
    return 1;
  }

  const root = words[1] ? path.resolve(words[1]) : projectRoot(process.cwd());
  let results;
  try {
    results = installAgentHooks(root, { force: flags.includes("--force") });
  } catch (error) {
    process.stderr.write(`mymarkdown-hooks: ${error.message}\n`);
    return 1;
  }

  const count = (status) => results.filter((result) => result.status === status).length;
  process.stdout.write(`MyMarkdown label hooks in ${root}\n\n`);
  for (const result of results) {
    const reason = result.reason ? `  (${result.reason})` : "";
    process.stdout.write(`  ${result.status.padEnd(9)}  ${result.file}${reason}\n`);
  }
  process.stdout.write("\n");
  if (count("differs")) {
    process.stdout.write(
      `${count("differs")} differ from this version (edited, or from an older release) and were ` +
        "left as they are. Run again with --force to replace them.\n",
    );
  }
  const broken = brokenResults(results).length;
  if (broken) {
    process.stdout.write(
      "The agents that read the files marked invalid, skipped or failed will not run the hook\n" +
        "until you fix what is noted next to them and run this again.\n",
    );
  } else if (count("created") + count("merged") + count("updated")) {
    process.stdout.write(
      "New Claude Code, Copilot and Cursor sessions in this project pick the hook up. Codex needs\n" +
        "the project trusted and the hook approved once, in /hooks.\n",
    );
  } else if (count("unchanged") === results.length) {
    process.stdout.write("Already up to date.\n");
  }
  return broken ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
