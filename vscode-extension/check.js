#!/usr/bin/env node
/*
  Checks for the MyMarkdown extension. These are the assertions the sync runs
  before it packages anything: if the rules copied from the website (or the
  renderer) stop behaving, this fails and nothing gets shipped.

  Run directly:  node vscode-extension/check.js
*/
"use strict";

const MD = require("./lib/mymarkdown.js");
const { mymarkdownPlugin } = require("./lib/preview-plugin.js");

// The preview is VS Code's own, so the checks below drive the real markdown-it the way
// VS Code does: our plugin first, then the source-map rule VS Code appends afterwards.
let MarkdownIt = null;
try {
  MarkdownIt = require("markdown-it");
} catch {
  /* not installed: the preview checks below are skipped rather than failing the build */
}

function preview() {
  const md = mymarkdownPlugin(new MarkdownIt({ html: true, highlight: (code) => code }));
  md.core.ruler.push("source_map_data_attribute", (state) => {
    for (const token of state.tokens) {
      if (!token.map || token.type === "inline") continue;
      token.attrSet("data-line", String(token.map[0]));
      token.attrJoin("class", "code-line");
      token.attrSet("dir", "auto");
    }
  });
  return md;
}

/** Newlines in a code block's text are how the preview works out its last source line. */
function codeSpan(html) {
  const open = /<code([^>]*)>/.exec(html);
  const body = /<code[^>]*>([\s\S]*?)<\/code>/.exec(html);
  const line = /data-line="(\d+)"/.exec(open ? open[1] : "");
  if (!line) return null;
  const text = (body ? body[1] : "").replace(/<[^>]+>/g, "");
  return { line: Number(line[1]), endLine: Number(line[1]) + (text.match(/\n/g) || []).length };
}

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
  assert(
    /line one\n\s*line two/.test(displayed),
    "the literal \\n should become a real break, got:\n" + displayed,
  );
  if (!MarkdownIt) return;
  const rendered = preview().render('```json\n{"content":"a\\nb"}\n```');
  assert(/a\n\s*b/.test(rendered), "the rendered block should break the line, got:\n" + rendered);
});

check("contents list keeps ids unique and lines accurate", () => {
  const source = "# Setup\n\ntext\n\n# Setup\n\n## Details\n\n### Deeper\n";
  const headings = MD.getTocHeadings(source);
  assert(headings.length === 4, "expected 4 headings, got " + headings.length);
  assert(headings[0].id === "setup", "first id should be setup");
  assert(headings[1].id === "setup-2", "duplicate should be setup-2");
  assert(headings[2].level === 2 && headings[3].level === 3, "levels should be kept");
  assert(
    headings[3].line === 9,
    "line number should point at the heading, got " + headings[3].line,
  );
});

check("headings inside a code block are not listed", () => {
  const headings = MD.getTocHeadings("# Real\n\n```\n# Fake\n```\n");
  assert(headings.length === 1, "fenced heading leaked into the contents list");
});

check("beautify normalises bullets and JSON, and is stable", () => {
  const messy = '# Title\n* one\n* two\n\n```json\n{"a":1,"b":2}\n```\n\n## Next';
  const once = MD.formatMarkdown(messy);
  includes(once, "- one", "bullet style");
  includes(once, '\n  "a": 1', "JSON indentation");
  assert(MD.formatMarkdown(once) === once, "running beautify twice changed the result");
});

check("lint reports the problems we can see", () => {
  const messages = MD.lintMarkdown(
    "# A\n\n### C\n\n```json\n{bad}\n```\n\n* mixed\n+ bullets\n",
  ).map((i) => i.message);
  includes(messages.join("|"), "Heading level jumps to H3", "heading jump");
  includes(messages.join("|"), "JSON block needs a syntax fix", "invalid JSON");
  includes(messages.join("|"), "Mixed bullets can be normalized", "mixed bullets");
});

check("lint notices an unclosed code fence", () => {
  const messages = MD.lintMarkdown('text\n\n```json\n{"a":1}\n').map((i) => i.message);
  includes(messages.join("|"), "Unclosed code fence", "unclosed fence");
});

check("the preview colours JSON fences and leaves other languages alone", () => {
  if (!MarkdownIt) return;
  const md = preview();
  const html = md.render('# A\n\n```json\n{"key":"value","n":3,"ok":true}\n```\n');
  includes(html, '<pre class="mymd-json">', "the JSON block");
  includes(html, '<span class="tok-key">', "field name colour");
  includes(html, '<span class="tok-number">', "number colour");
  includes(html, '<span class="tok-literal">', "true/false/null colour");
  const other = md.render("```python\nx = 1\n```\n");
  assert(other.indexOf("mymd-json") === -1, "a python fence should be left to VS Code");
});

check("a JSON block only claims source lines it really covers", () => {
  if (!MarkdownIt) return;
  const md = preview();
  // Already one field per line: the display matches the source, so mapping is exact.
  const exact = codeSpan(md.render('T\n\n```json\n{\n  "a": 1\n}\n```\n'));
  assert(
    exact && exact.line === 2 && exact.endLine === 4,
    "expected lines 2-4, got " + JSON.stringify(exact),
  );
  // Laying it out adds lines, so the block must not claim to be mapped at all.
  const expanded = md.render('T\n\n```json\n{"a":1,"b":2,"c":3}\n```\n\nAfter.\n');
  assert(codeSpan(expanded) === null, "an expanded JSON block must not carry data-line");
  includes(expanded, '<span class="tok-key">', "it is still coloured");
});

check("loose JSON in prose is promoted, without shifting later lines", () => {
  if (!MarkdownIt) return;
  const md = preview();
  const html = md.render('Response:\n\n{"ok":true,"n":3}\n\nDone.\n');
  includes(html, '<pre class="mymd-json">', "a bare JSON paragraph becomes a block");
  includes(html, '<p data-line="4"', "the paragraph after it keeps its own line");
  includes(md.render('The default is `{"retries":3}` here.\n'), "mymd-json-inline", "inline JSON");
  assert(md.render("Run `npm run build` now.\n").indexOf("mymd-json") === -1, "plain inline code");
});

check("the preview renders task lists", () => {
  if (!MarkdownIt) return;
  const html = preview().render("- [ ] todo\n- [x] done\n");
  includes(html, 'type="checkbox" disabled>', "an unchecked box");
  includes(html, "checked>", "a checked box");
  assert(html.indexOf("[ ]") === -1, "the marker text should be gone");
});

check("the preview never lets the document inject markup", () => {
  if (!MarkdownIt) return;
  const html = preview().render('```json\n{"x":"<script>alert(1)</script>"}\n```\n');
  assert(html.indexOf("<script>") === -1, "a script tag was rendered as markup");
  includes(html, "&lt;script&gt;", "escaped script");
});

check("nested lists keep their indentation", () => {
  assert(
    MD.formatMarkdown("- top\n  - mid\n    - deep") === "- top\n  - mid\n    - deep",
    "indentation was dropped",
  );
  assert(
    MD.formatMarkdown("* top\n  * mid") === "- top\n  - mid",
    "markers should normalise without flattening",
  );
});

check("tilde and long fences are protected like backtick fences", () => {
  const tilde = "~~~\n* not a bullet\n~~~";
  assert(MD.formatMarkdown(tilde) === tilde, "a ~~~ fence was rewritten");
  const long = "````\n```\n* inside\n```\n````";
  assert(
    MD.formatMarkdown(long) === long,
    "a four-backtick fence was broken apart by its inner fence",
  );
  assert(
    MD.getTocHeadings("# Real\n\n~~~\n# Fake\n~~~\n").length === 1,
    "a heading inside a ~~~ fence was listed",
  );
});

check("front matter, HTML blocks and indented code are left alone", () => {
  const front = "---\ntags:\n  - a\n  - b\n---\n\n# Title";
  assert(MD.formatMarkdown(front) === front, "front matter was rewritten");
  const html = "<div>\n* not a bullet\n</div>";
  assert(MD.formatMarkdown(html) === html, "an HTML block was rewritten");
  const code = "para\n\n    * code\n    + code";
  assert(MD.formatMarkdown(code) === code, "an indented code block was rewritten");
});

check("a leading --- rule is a thematic break, not front matter", () => {
  // Real front matter puts its first key on the very next line; a deck or changelog
  // that opens with a rule leaves a blank line there.
  const deck = "---\n\n# Slide one\n\n* point a\n\n---\n\n# Slide two\n";
  assert(
    MD.getTocHeadings(deck).length === 2,
    "a heading was swallowed by a false front matter block",
  );
  includes(MD.formatMarkdown(deck), "- point a", "bullets after a leading rule");
  const real = "---\ntitle: x\ntags:\n  * a\n---\n# H\n";
  includes(MD.formatMarkdown(real), "  * a", "real front matter is still protected");
});

check("a fence indented four columns is code, not a fence", () => {
  const indented = "    ```JS\n    x\n    ```";
  assert(MD.formatMarkdown(indented) === indented, "an indented code block was treated as a fence");
  assert(
    MD.lintMarkdown("Example:\n\n    ```\n    code\n\n# Next\n").length === 0,
    "false unclosed-fence warning",
  );
  const inList = "- item\n  ```js\n  x\n  ```";
  assert(
    MD.formatMarkdown(inList) === inList,
    "a fence at a list content column should still be a fence",
  );
  const deep = "- item\n\n      * not a bullet";
  assert(MD.formatMarkdown(deep) === deep, "indented code inside a list item was rewritten");
});

check("hard line breaks and thematic breaks survive beautify", () => {
  assert(
    MD.formatMarkdown("one  \ntwo") === "one  \ntwo",
    "a two-space hard line break was stripped",
  );
  assert(MD.formatMarkdown("* * *") === "* * *", "a thematic break became a list item");
  assert(MD.formatMarkdown("* - -") === "* - -", "a list item became a thematic break");
});

check("beautify does not make a tight list loose", () => {
  const fence = "- item\n  ```js\n  x\n  ```";
  assert(MD.formatMarkdown(fence) === fence, "a blank line was inserted inside a list item");
  assert(MD.formatMarkdown("- item\n  # sub") === "- item\n  # sub", "same for a heading");
  assert(
    MD.formatMarkdown("text\n# H") === "text\n\n# H",
    "a top-level heading still gets its blank line",
  );
});

check("JSON that would not survive reformatting is left as written", () => {
  for (const body of ['{"id": 9007199254740993}', '{"v": -0}', '{"v": 1e400}']) {
    const fence = "```json\n" + body + "\n```";
    assert(MD.formatMarkdown(fence) === fence, "reformatting changed the value in " + body);
  }
  includes(MD.formatMarkdown('```json\n{"a":1,"b":2}\n```'), '\n  "a": 1', "ordinary JSON");
  // Still JSON, so it is still fenced: as prose, Markdown would eat its punctuation.
  const promoted = MD.promoteInlineJsonToFences(
    'Payload:\n\n{"id": 1088174639906766899, "note": "use *bold*"}\n',
  );
  includes(promoted, "```json", "a big-id payload is still promoted");
  includes(promoted, "1088174639906766899", "with its id untouched");
});

check("a backslash before n is not a newline escape", () => {
  const display = MD.formatJsonDisplay(JSON.stringify({ path: "C:\\new" }));
  includes(display, "C:\\\\new", "a Windows path");
  assert(
    /a\n\s+b/.test(MD.formatJsonDisplay(JSON.stringify({ s: "a\nb" }))),
    "a real newline escape should still split",
  );
});

check("lint skips protected regions and reports a position", () => {
  assert(
    MD.lintMarkdown("# Title\n\n```bash\n# comment\n* item\n```\n").length === 0,
    "lint fired inside a fence",
  );
  const jump = MD.lintMarkdown("# A\n\n### C\n");
  assert(jump.length === 1, "expected one issue, got " + jump.length);
  assert(jump[0].line === 3 && jump[0].column === 1, "wrong position: " + JSON.stringify(jump[0]));
  const bullet = MD.lintMarkdown("- a\n  * b\n");
  assert(
    bullet[0].line === 2 && bullet[0].column === 3,
    "bullet should point at the marker: " + JSON.stringify(bullet[0]),
  );
});

check("beautify is idempotent on a document that mixes everything", () => {
  const messy =
    '\n---\ntags:\n  * a\n---\n# H\n* b\n  * c\n~~~\n* d\n~~~\n<div>\n* e\n</div>\n\n    * f\n\n```json\n{"n":9007199254740993}\n```\n';
  const once = MD.formatMarkdown(messy);
  assert(MD.formatMarkdown(once) === once, "running beautify twice changed the result");
});

check("minimalEdit reproduces the new text with the smallest span", () => {
  assert(MD.minimalEdit("same", "same") === null, "an unchanged document should need no edit");
  for (const [from, to] of [
    ["", "x"],
    ["x", ""],
    ["abc", "axc"],
    ["a", "aaa"],
    ["aaa", "a"],
    ["hello world", "hello  world"],
  ]) {
    const edit = MD.minimalEdit(from, to);
    const applied =
      edit === null ? from : from.slice(0, edit.start) + edit.text + from.slice(edit.end);
    assert(
      applied === to,
      "minimalEdit(" +
        JSON.stringify(from) +
        ", " +
        JSON.stringify(to) +
        ") did not reproduce the text",
    );
  }
});

if (failures.length) {
  console.error("\n  MyMarkdown checks: " + passed + " passed, " + failures.length + " failed\n");
  failures.forEach((f) => console.error("    - " + f));
  console.error("");
  process.exit(1);
}
console.log("  MyMarkdown checks: " + passed + " passed");
