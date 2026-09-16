#!/usr/bin/env node
/*
  Checks for the MyMarkdown extension. These are the assertions the sync runs
  before it packages anything: if the rules copied from the website (or the
  renderer) stop behaving, this fails and nothing gets shipped.

  Run directly:  node vscode-extension/check.js
*/
"use strict";

const MD = require("./lib/mymarkdown.js");
const Render = require("./lib/render.js");

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failures.push(name + "\n      " + (e && e.message ? e.message : String(e)));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "expected a truthy value");
}

function includes(haystack, needle, label) {
  assert(haystack.indexOf(needle) !== -1, (label || "output") + ' should contain "' + needle + '"');
}

const NESTED_JSON = [
  "{",
  '  "actions": [',
  "    {",
  '      "chat": { "thought": "first", "desc": "second" }',
  "    },",
  "    {",
  '      "story": { "op": "create", "withDesign": true, "skill_ids": [24], "theme": 42 }',
  "    }",
  "  ]",
  "}",
].join("\n");

check("core exposes every helper", () => {
  const names = [
    "slugifyHeading",
    "getTocHeadings",
    "promoteRawJsonToFences",
    "promoteInlineJsonToFences",
    "formatMarkdown",
    "lintMarkdown",
    "expandEscapedNewlines",
    "expandEscapedNewlinesInStrings",
    "formatJsonDisplay",
  ];
  names.forEach((name) => assert(typeof MD[name] === "function", name + " is not a function"));
});

check("raw JSON becomes a fenced block with one field per line", () => {
  const promoted = MD.promoteRawJsonToFences(NESTED_JSON);
  includes(promoted, "```json", "promotion");
  includes(promoted, '\n      "chat"', "nesting");
  includes(promoted, '\n        "desc": "second"', "depth");
  includes(promoted, "\n```", "closing fence");
});

check("backtick JSON becomes a fenced block", () => {
  const promoted = MD.promoteInlineJsonToFences('Config is `{"a":1,"b":[2,3]}` here.');
  includes(promoted, "```json", "inline promotion");
  includes(promoted, '{"a":1,"b":[2,3]}', "the JSON itself");
  assert(!/`{/.test(promoted), "the inline code should be gone");
  includes(MD.formatMarkdown(promoted), '\n  "b": [', "pretty printing");
});

check("ordinary inline code stays inline", () => {
  const source = "Run `npm run build` now.";
  assert(MD.promoteInlineJsonToFences(source) === source, "plain inline code was changed");
});

check("literal \\n inside JSON text becomes a real line break", () => {
  const displayed = MD.formatJsonDisplay('{"content":"line one\\nline two"}');
  includes(displayed, "line one\nline two", "newline expansion");
  const rendered = Render.renderMarkdown('```json\n{"content":"a\\nb"}\n```');
  includes(rendered, "a\nb", "rendered block");
});

check("contents list keeps ids unique and lines accurate", () => {
  const source = "# Setup\n\ntext\n\n# Setup\n\n## Details\n\n### Deeper\n";
  const headings = MD.getTocHeadings(source);
  assert(headings.length === 4, "expected 4 headings, got " + headings.length);
  assert(headings[0].id === "setup", "first id should be setup");
  assert(headings[1].id === "setup-2", "duplicate should be setup-2");
  assert(headings[2].level === 2 && headings[3].level === 3, "levels should be kept");
  assert(headings[3].line === 9, "line number should point at the heading, got " + headings[3].line);
});

check("headings inside a code block are not listed", () => {
  const headings = MD.getTocHeadings("# Real\n\n```\n# Fake\n```\n");
  assert(headings.length === 1, "fenced heading leaked into the contents list");
});

check("beautify normalises bullets and JSON, and is stable", () => {
  const messy = "# Title\n* one\n* two\n\n```json\n{\"a\":1,\"b\":2}\n```\n\n## Next";
  const once = MD.formatMarkdown(messy);
  includes(once, "- one", "bullet style");
  includes(once, '\n  "a": 1', "JSON indentation");
  assert(MD.formatMarkdown(once) === once, "running beautify twice changed the result");
});

check("lint reports the problems we can see", () => {
  const messages = MD.lintMarkdown("# A\n\n### C\n\n```json\n{bad}\n```\n\n* mixed\n+ bullets\n").map((i) => i.message);
  includes(messages.join("|"), "Heading level jumps to H3", "heading jump");
  includes(messages.join("|"), "JSON block needs a syntax fix", "invalid JSON");
  includes(messages.join("|"), "Mixed bullets can be normalized", "mixed bullets");
});

check("lint notices an unclosed code fence", () => {
  const messages = MD.lintMarkdown("text\n\n```json\n{\"a\":1}\n").map((i) => i.message);
  includes(messages.join("|"), "Unclosed code fence", "unclosed fence");
});

check("preview renders headings, colours, tables and tasks", () => {
  const html = Render.renderMarkdown(
    "# Alpha\n\n## Beta\n\n- [x] done\n- [ ] open\n\n| k | v |\n| - | - |\n| a | 1 |\n\n" +
      "```json\n{\"key\":\"value\",\"n\":3,\"ok\":true}\n```"
  );
  includes(html, '<h1 class="h1 first" id="alpha">', "first heading");
  includes(html, '<h2 id="beta">', "second heading");
  includes(html, '<span class="tok-key">', "JSON field colour");
  includes(html, '<span class="tok-number">', "JSON number colour");
  includes(html, '<span class="tok-literal">', "JSON true/false/null colour");
  includes(html, '<table>', "table");
  includes(html, 'type="checkbox" disabled checked', "task list");
});

check("preview never lets the document inject markup", () => {
  const html = Render.renderMarkdown("<script>alert(1)</script> and <img src=x onerror=alert(1)>");
  assert(html.indexOf("<script>") === -1, "a script tag was rendered as markup");
  includes(html, "&lt;script&gt;", "escaped script");
});

check("numbers in ordinary text survive rendering", () => {
  const html = Render.renderMarkdown("Release 2.4 shipped 12 fixes in 2026.");
  includes(html, "Release 2.4 shipped 12 fixes in 2026.", "plain text");
});

if (failures.length) {
  console.error("\n  MyMarkdown checks: " + passed + " passed, " + failures.length + " failed\n");
  failures.forEach((f) => console.error("    - " + f));
  console.error("");
  process.exit(1);
}
console.log("  MyMarkdown checks: " + passed + " passed");
