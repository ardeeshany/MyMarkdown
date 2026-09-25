#!/usr/bin/env node
/*
  Checks for the MyMarkdown extension. These are the assertions the sync runs
  before it packages anything: if the rules copied from the website (or the
  renderer) stop behaving, this fails and nothing gets shipped.

  Run directly:  node vscode-extension/check.js
*/
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const MD = require("./lib/mymarkdown.js");
const { mymarkdownPlugin } = require("./lib/preview-plugin.js");
const Labels = require("./lib/labels.js");
const Runner = require("./lib/label-runner.js");

// The preview is VS Code's own, so the checks below drive the real markdown-it the way
// VS Code does: our plugin first, then the source-map rule VS Code appends afterwards.
// Required, not optional: skipping these would report a full green while leaving the
// whole preview untested, and sync.js packages whatever check.js approves.
let MarkdownIt;
try {
  MarkdownIt = require("markdown-it");
} catch {
  console.error(
    "\n  MyMarkdown checks: markdown-it is not installed - run `npm install` (or `bun install`) in the project root first.\n",
  );
  process.exit(1);
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

// A check may return a promise (driving an async command handler end to end rather than
// just confirming it is registered); its pass/fail is then only known once that settles,
// so it goes on `pending` and the final report waits for it below.
const pending = [];

function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(
        result.then(
          () => {
            passed += 1;
          },
          (e) => {
            failures.push(name + "\n      " + (e && e.message ? e.message : String(e)));
          },
        ),
      );
      return;
    }
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
  const md = preview();
  // Already one field per line: the display matches the source, so the range must be
  // exactly what VS Code works out for the same block when we are not involved.
  const document = 'T\n\n```json\n{\n  "a": 1\n}\n```\n';
  const plain = new MarkdownIt({ html: true, highlight: (code) => code });
  plain.core.ruler.push("source_map_data_attribute", (state) => {
    for (const token of state.tokens) {
      if (!token.map || token.type === "inline") continue;
      token.attrSet("data-line", String(token.map[0]));
      token.attrJoin("class", "code-line");
      token.attrSet("dir", "auto");
    }
  });
  const baseline = codeSpan(plain.render(document));
  const exact = codeSpan(md.render(document));
  assert(
    exact && baseline && exact.line === baseline.line && exact.endLine === baseline.endLine,
    "expected " + JSON.stringify(baseline) + ", got " + JSON.stringify(exact),
  );
  // Laying it out adds lines, so the block must not claim to be mapped at all.
  const expanded = md.render('T\n\n```json\n{"a":1,"b":2,"c":3}\n```\n\nAfter.\n');
  assert(codeSpan(expanded) === null, "an expanded JSON block must not carry data-line");
  includes(expanded, '<span class="tok-key">', "it is still coloured");
});

check("every block carries its exact source lines for the label bars", () => {
  const html = preview().render(
    [
      "# Title", //                1
      "", //                       2
      "- one", //                  3
      "- two", //                  4
      "", //                       5
      "| a | b |", //              6
      "|---|---|", //              7
      "| 1 | 2 |", //              8
      "", //                       9
      "> quote line one", //       10
      "> quote line two", //       11
      "", //                       12
      "```js", //                  13
      "x", //                      14
      "```", //                    15
      "", //                       16
      "```mermaid", //             17
      "graph TD", //               18
      "```", //                    19
      "", //                       20
      "> [!NOTE]", //              21
      "> Body.", //                22
      "", //                       23
      "> - quoted one", //         24
      "> - quoted two", //         25
      ">", //                      26
      "> After.", //               27
    ].join("\n") + "\n",
  );
  const spans = (tag, start, end) =>
    new RegExp("<" + tag + '[^>]*data-mymd-start="' + start + '" data-mymd-end="' + end + '"').test(html);
  // Counting newlines in the rendered text gave the list 3..6 and the table 6..20 or so.
  assert(spans("h1", 1, 1), "heading");
  assert(spans("ul", 3, 4), "a list ends on its last item, not the blank line after it");
  assert(spans("li", 4, 4), "the last item ends on its own line");
  assert(spans("table", 6, 8), "table");
  assert(spans("tr", 8, 8), "table row");
  assert(spans("blockquote", 10, 11), "quote");
  assert(spans("code", 13, 15), "a fence covers its own ``` lines");
  assert(spans("div", 17, 19), "a Mermaid diagram keeps its lines though it drops data-line");
  assert(spans("p", 21, 21), "a callout title sits on the [!NOTE] line");
  assert(spans("p", 22, 22), "the callout body starts on the line after it");
  assert(spans("li", 25, 25), "a quoted list's last item does not take the quote's bare > line");
});

check("loose JSON in prose is promoted, without shifting later lines", () => {
  const md = preview();
  const html = md.render('Response:\n\n{"ok":true,"n":3}\n\nDone.\n');
  includes(html, '<pre class="mymd-json">', "a bare JSON paragraph becomes a block");
  assert(/<p [^>]*data-line="4"/.test(html), "the paragraph after it keeps its own line");
  includes(md.render('The default is `{"retries":3}` here.\n'), "mymd-json-inline", "inline JSON");
  assert(md.render("Run `npm run build` now.\n").indexOf("mymd-json") === -1, "plain inline code");
});

check("the preview renders task lists", () => {
  const html = preview().render("- [ ] todo\n- [x] done\n");
  includes(html, 'type="checkbox" disabled>', "an unchecked box");
  includes(html, "checked>", "a checked box");
  assert(html.indexOf("[ ]") === -1, "the marker text should be gone");
});

check("Marketplace artwork and preview-state styles are included", () => {
  const pkg = require("./package.json");
  assert(pkg.icon === "media/icon.png", "the Marketplace icon is not registered");
  for (const file of ["icon.png", "overview.webp"]) {
    assert(fs.existsSync(path.join(__dirname, "media", file)), file + " is missing");
  }
  // The Marketplace only accepts a square icon of at least 128px.
  const icon = fs.readFileSync(path.join(__dirname, "media", "icon.png"));
  const iconWidth = icon.readUInt32BE(16);
  const iconHeight = icon.readUInt32BE(20);
  assert(
    iconWidth === iconHeight && iconWidth >= 128,
    "the Marketplace icon must be a square of at least 128px",
  );
  const css = fs.readFileSync(path.join(__dirname, "media", "preview.css"), "utf8");
  includes(css, "input.mymd-task:checked", "checked task styling");
  includes(css, "blockquote.mymd-alert + blockquote.mymd-alert", "alert spacing");
  includes(css, "color-scheme: light", "light lens dropdown color scheme");
  includes(css, "color-scheme: dark", "dark lens dropdown color scheme");
  includes(css, ".mymd-lens-select option", "lens dropdown option styling");
});

check("Mermaid preview is packaged as one ordered script", () => {
  const pkg = require("./package.json");
  const scripts = (pkg.contributes && pkg.contributes["markdown.previewScripts"]) || [];
  assert(Array.isArray(scripts) && scripts.length > 0, "expected at least one preview script");
  // Mermaid's engine and renderer must stay in one file: two entries could load either way round.
  assert(
    scripts.filter((file) => /mermaid/.test(file)).join() === "./media/mermaid-preview.bundle.js",
    "the ordered Mermaid bundle is not registered exactly once",
  );
  for (const file of scripts) {
    assert(fs.existsSync(path.join(__dirname, file)), "previewScripts points at a missing file: " + file);
  }
  const bundle = fs.readFileSync(path.join(__dirname, "media", "mermaid-preview.bundle.js"), "utf8");
  const engine = bundle.indexOf("globalThis");
  const renderer = bundle.indexOf("Renders ```mermaid blocks");
  assert(engine !== -1 && renderer > engine, "Mermaid must be bundled before its renderer");
});

check("the preview never lets the document inject markup", () => {
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
  for (const body of [
    '{"id": 9007199254740993}',
    '{"v": -0}',
    '{"v": 1e400}',
    '{"v": 1e-400}',
    '{"v": 900719925474099.3}',
    '{"v": 1.2345678901234567890}',
  ]) {
    const fence = "```json\n" + body + "\n```";
    assert(MD.formatMarkdown(fence) === fence, "reformatting changed the value in " + body);
  }
  includes(MD.formatMarkdown('```json\n{"a":1,"b":2}\n```'), '\n  "a": 1', "ordinary JSON");
  includes(MD.formatMarkdown('```json\n{"pi":3.14159}\n```'), "3.14159", "an ordinary decimal");
  // The preview must not show a number the file does not contain either.
  includes(MD.formatJsonDisplay('{"id": 9007199254740993}'), "9007199254740993", "preview display");
  includes(
    MD.formatJsonDisplay('{"v": 900719925474099.3}'),
    "900719925474099.3",
    "preview decimal",
  );
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
    if (edit) {
      assert(
        from.slice(0, edit.start) === to.slice(0, edit.start),
        "the replaced span starts inside text the two strings share",
      );
    }
  }
  // A whole-document replacement would satisfy the round trip above, so pin the span too.
  const settled = "# Title\n\n- one\n- two\n";
  const stray = MD.minimalEdit(settled + "   ", settled);
  assert(stray && stray.end - stray.start <= 3, "one stray space should not rewrite the document");
});

check("the manifest and the extension host agree", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  const host = fs.readFileSync(path.join(__dirname, "extension.js"), "utf8");
  const contributes = manifest.contributes || {};

  // The preview is VS Code's own, so these two are what make the extension do anything at all.
  assert(
    Array.isArray(contributes["markdown.previewStyles"]) &&
      contributes["markdown.previewStyles"].length > 0,
    "markdown.previewStyles is missing, so the preview would not be styled",
  );
  for (const file of contributes["markdown.previewStyles"]) {
    assert(
      fs.existsSync(path.join(__dirname, file)),
      "previewStyles points at a missing file: " + file,
    );
  }
  assert(
    contributes["markdown.markdownItPlugins"] === true,
    "markdown.markdownItPlugins must be true",
  );
  // Regex-matching the source would pass on a host that does not parse, or whose
  // extendMarkdownIt hands back an untouched engine - both of which have happened here.
  const Module = require("module");
  const load = Module._load;
  const off = { dispose() {} };
  const stub = {
    Range: class {},
    Position: class {},
    Selection: class {},
    TextEdit: { replace: () => ({}) },
    Diagnostic: class {},
    WorkspaceEdit: class {},
    EndOfLine: { LF: 1, CRLF: 2 },
    DiagnosticSeverity: { Warning: 1, Information: 2 },
    ThemeIcon: class {},
    ThemeColor: class {},
    TreeItem: class {},
    TreeItemCollapsibleState: { None: 0 },
    TextEditorRevealType: { AtTop: 3 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15 },
    LanguageModelChatMessage: { User: (text) => ({ text }) },
    Uri: {
      joinPath: (base, ...parts) => ({
        fsPath: [base && base.fsPath, ...parts].filter(Boolean).join("/"),
        toString() {
          return this.fsPath;
        },
      }),
    },
    EventEmitter: class {
      constructor() {
        this.event = () => off;
      }
      fire() {}
    },
    languages: {
      createDiagnosticCollection: () => ({ set() {}, delete() {}, clear() {}, dispose() {} }),
      registerDocumentFormattingEditProvider: () => off,
    },
    window: {
      activeTextEditor: undefined,
      registerTreeDataProvider: () => off,
      onDidChangeActiveTextEditor: () => off,
      showInformationMessage() {},
      showWarningMessage() {},
      showErrorMessage() {},
      showQuickPick: async () => undefined,
      showInputBox: async () => undefined,
      setStatusBarMessage() {},
      withProgress: async (_options, work) => work({ onCancellationRequested: () => off }),
      createStatusBarItem: () => ({
        text: "",
        tooltip: "",
        command: "",
        show() {},
        hide() {},
        dispose() {},
      }),
    },
    workspace: {
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      onDidChangeTextDocument: () => off,
      onDidOpenTextDocument: () => off,
      onDidCloseTextDocument: () => off,
      onDidChangeConfiguration: () => off,
      createFileSystemWatcher: () => ({ onDidCreate: () => off, onDidChange: () => off, onDidDelete: () => off, dispose() {} }),
      textDocuments: [],
      applyEdit: async () => true,
      getWorkspaceFolder: () => undefined,
      fs: {
        readFile: async () => {
          throw new Error("no sidecar");
        },
        writeFile: async () => {},
        createDirectory: async () => {},
        delete: async () => {},
      },
    },
    commands: { registerCommand: () => off, executeCommand: async () => undefined },
    lm: { selectChatModels: async () => [] },
  };
  Module._load = (request, ...rest) => (request === "vscode" ? stub : load(request, ...rest));
  let api;
  try {
    const entry = path.join(__dirname, manifest.main);
    delete require.cache[require.resolve(entry)];
    api = require(entry).activate({ subscriptions: [] });
  } finally {
    Module._load = load;
  }
  assert(
    api && typeof api.extendMarkdownIt === "function",
    "activate must return extendMarkdownIt",
  );
  const engine = api.extendMarkdownIt(new MarkdownIt({ html: true, highlight: (code) => code }));
  assert(engine && typeof engine.render === "function", "extendMarkdownIt must return the engine");
  includes(
    engine.render('```json\n{"a":1}\n```\n'),
    "mymd-json",
    "the returned engine colours JSON",
  );

  // A command in the manifest that nothing registers shows up as "command not found".
  const declared = (contributes.commands || []).map((entry) => entry.command);
  const registered = [...host.matchAll(/registerCommand\("([^"]+)"/g)].map((m) => m[1]);
  for (const command of declared) {
    assert(
      registered.includes(command),
      command + " is declared in package.json but never registered",
    );
  }
  for (const group of Object.values(contributes.menus || {})) {
    for (const entry of group) {
      assert(
        declared.includes(entry.command),
        entry.command + " is in a menu but not in contributes.commands",
      );
    }
  }
  for (const entry of contributes.keybindings || []) {
    assert(
      declared.includes(entry.command),
      entry.command + " has a keybinding but is not a declared command",
    );
  }
  assert(
    manifest.main && fs.existsSync(path.join(__dirname, manifest.main)),
    "main points at a missing file",
  );
});

check("a label sidecar is read back as written", () => {
  const lens = { name: "How does this break down?", ranges: [
    { label: "Intro", color: "#2563eb", startLine: 1, endLine: 3 },
    { label: "Setup", color: "#059669", startLine: 5, endLine: 7 },
  ] };
  const doc = "# Title\n\nIntro paragraph.\n\n## Setup\n\nInstall it.\n\n## Usage\n\nRun it.";
  const file = Labels.writeLabels(doc, [lens], null);
  assert(file.sourceHash, "the sidecar should record the document hash");
  const read = Labels.readLabels(file, doc);
  assert(read.stale === false, "a sidecar written for this text is not stale");
  assert(read.lenses.length === 1, "expected one lens, got " + read.lenses.length);
  assert(read.lenses[0].ranges.length === 2, "both ranges should survive");
  assert(read.lenses[0].ranges[0].anchor, "ranges are stamped with an anchor when written");
});

check("ranges follow their text when the document moves", () => {
  const doc = "# Title\n\nIntro paragraph.\n\n## Setup\n\nInstall it.\n\n## Usage\n\nRun it.";
  const file = Labels.writeLabels(doc, [{ name: "L", ranges: [
    { label: "Usage", color: "#8341be", startLine: 9, endLine: 11 },
  ] }], null);
  // Four lines added at the top: the Usage section is now lower down.
  const moved = "x\n\ny\n\n" + doc;
  const read = Labels.readLabels(file, moved);
  assert(read.stale === true, "the hash should no longer match");
  const range = read.lenses[0].ranges[0];
  assert(range.startLine === 13, "expected the range to move to line 13, got " + range.startLine);
  assert(range.endLine === 15, "and to keep its span, got " + range.endLine);
});

check("a range whose text is gone is dropped, the rest of the lens survives", () => {
  const doc = "# Title\n\nIntro paragraph.\n\n## Setup\n\nInstall it.\n\n## Usage\n\nRun it.";
  const file = Labels.writeLabels(doc, [{ name: "L", ranges: [
    { label: "Setup", color: "#059669", startLine: 5, endLine: 7 },
    { label: "Usage", color: "#8341be", startLine: 9, endLine: 11 },
  ] }], null);
  const withoutSetup = doc.replace("## Setup\n\nInstall it.\n\n", "");
  const read = Labels.readLabels(file, withoutSetup);
  assert(read.lenses.length === 1, "the lens should still be there");
  const labels = read.lenses[0].ranges.map((r) => r.label);
  assert(labels.join(",") === "Usage", "expected only Usage to survive, got " + labels.join(","));
});

check("the reader is the authority on a sidecar it did not write", () => {
  const doc = "# Title\n\nIntro paragraph.\n\n## Setup\n\nInstall it.\n\n## Usage\n\nRun it.";
  const hostile = { sourceHash: Labels.sha256(doc), lenses: [{ name: "L", ranges: [
    { label: "Way too many words for a label", color: "not-a-colour", startLine: 900, endLine: -4 },
    { label: "Overlap", color: "#111111", startLine: 1, endLine: 8 },
    { label: "Overlap", color: "#222222", startLine: 3, endLine: 11 },
    { label: "", color: "#333333", startLine: 1, endLine: 2 },
  ] }] };
  const ranges = Labels.readLabels(hostile, doc).lenses[0].ranges;
  for (const range of ranges) {
    assert(range.label.split(" ").length <= 2, "labels are cut to two words: " + range.label);
    assert(/^#[0-9a-f]{6}$/i.test(range.color), "colours are validated: " + range.color);
    assert(range.startLine >= 1 && range.endLine <= 11, "lines stay inside the document");
    assert(range.startLine <= range.endLine, "inverted ranges are corrected");
  }
  for (let i = 1; i < ranges.length; i += 1) {
    assert(ranges[i].startLine > ranges[i - 1].endLine, "ranges must not overlap");
  }
  const overlaps = ranges.filter((r) => r.label === "Overlap");
  if (overlaps.length > 1) {
    assert(overlaps[0].color === overlaps[1].color, "one colour per label");
  }
});

check("the sidecar path mirrors the document path under one folder", () => {
  assert(Labels.sidecarPath("docs/guide.md", ".mymd") === ".mymd/docs/guide.md.json",
    "got " + Labels.sidecarPath("docs/guide.md", ".mymd"));
  assert(Labels.sidecarPath("../outside.md", ".mymd") === ".mymd/outside.md.json",
    "a path climbing out of the workspace is pinned back inside");
});

check("a moved end-anchor line does not swell a range over its neighbours", () => {
  const seven = ["a1", "a2", "END MARKER", "b1", "b2", "c1", "c2"].join("\n");
  const file = Labels.writeLabels(seven, [{ name: "L", ranges: [
    { label: "a", color: "#111111", startLine: 1, endLine: 3 },
    { label: "b", color: "#222222", startLine: 4, endLine: 5 },
    { label: "c", color: "#333333", startLine: 6, endLine: 7 },
  ] }], null);
  // "END MARKER" moves to the end of the file: naively searching forward for it from a's
  // start would stretch a's range over b and c entirely.
  const movedEnd = ["a1", "a2", "b1", "b2", "c1", "c2", "END MARKER"].join("\n");
  const ranges = Labels.readLabels(file, movedEnd).lenses[0].ranges;
  const byLabel = Object.fromEntries(ranges.map((r) => [r.label, r]));
  assert(ranges.length === 3, "all three ranges should survive, got " + ranges.length);
  assert(byLabel.a.startLine === 1 && byLabel.a.endLine === 2, "a should shrink to its own two lines, got " + JSON.stringify(byLabel.a));
  assert(byLabel.b.startLine === 3 && byLabel.b.endLine === 4, "b should keep its own lines, got " + JSON.stringify(byLabel.b));
  assert(byLabel.c.startLine === 5 && byLabel.c.endLine === 6, "c should keep its own lines, got " + JSON.stringify(byLabel.c));
});

check("a range ending on a closing fence is not cut short at an earlier fence inside it", () => {
  const doc = ["## Install", "", "```bash", "npm ci", "```", "", "```bash", "npm test", "```", "", "## Next"].join("\n");
  const file = Labels.writeLabels(doc, [{ name: "L", ranges: [{ label: "Setup", color: "#111111", startLine: 1, endLine: 9 }] }], null);
  // No hash, as the hook leaves a skill-written sidecar, so the range is always re-anchored:
  // its closing ``` also appears on line 5, and matching that first gave 1..5.
  delete file.sourceHash;
  const range = Labels.readLabels(file, doc).lenses[0].ranges[0];
  assert(range.startLine === 1 && range.endLine === 9, "the range should keep 1..9, got " + range.startLine + ".." + range.endLine);
  const moved = Labels.readLabels(file, "Preface.\n\n" + doc).lenses[0].ranges[0];
  assert(moved.startLine === 3 && moved.endLine === 11, "and move whole after an edit above it, got " + moved.startLine + ".." + moved.endLine);
});

check("a range that shrank is not stretched over the next section's identical closing line", () => {
  const install = ["## Install", "p1", "p2", "p3", "p4", "p5", "p6", "```bash", "npm ci", "```"];
  const rest = ["", "## Test", "```bash", "npm test", "```", "", "## End"];
  const file = Labels.writeLabels([...install, ...rest].join("\n"), [{ name: "L", ranges: [{ label: "Install", color: "#111111", startLine: 1, endLine: 10 }] }], null);
  // Four lines of prose deleted inside the range: its real end moved up by four, and the
  // Test section's own closing ``` now sits nearer the old span than that.
  const shrunk = ["## Install", "p5", "p6", "```bash", "npm ci", "```", ...rest].join("\n");
  const range = Labels.readLabels(file, shrunk).lenses[0]?.ranges?.[0];
  assert(range, "the range should survive");
  assert(range.endLine === 6, "the range should end on Install's own closing ```, line 6, got " + range.startLine + ".." + range.endLine);
});

check("a range anchored on a repeated heading follows its own distinct body", () => {
  // Six identical "## Notes" headings; only the body text tells them apart.
  const rep = Array.from({ length: 6 }, (_, i) => ["## Notes", "body " + i, ""].join("\n")).join("\n");
  const lines = rep.split("\n");
  const headingLine = lines.findIndex((l) => l === "body 2"); // 0-based body index == 1-based heading line
  const file = Labels.writeLabels(rep, [{ name: "L", ranges: [
    { label: "Third", color: "#111111", startLine: headingLine, endLine: headingLine + 1 },
  ] }], null);
  // Four lines added at the top: every "## Notes" copy shifts down by four.
  const shifted = "x\ny\nz\nw\n" + rep;
  const wantHeading = shifted.split("\n").findIndex((l) => l === "body 2");
  const range = Labels.readLabels(file, shifted).lenses[0]?.ranges?.[0];
  assert(range, "the range should not be dropped - only one copy has this body");
  assert(range.startLine === wantHeading, "expected line " + wantHeading + ", got " + range.startLine);
  assert(range.endLine === wantHeading + 1, "expected the body line to follow, got " + range.endLine);
});

check("two candidates the document cannot tell apart are dropped, not guessed", () => {
  const lines = [
    "## Same", "SAME BODY", "",
    "mid1", "mid2", "mid3", "mid4", "mid5",
    "## Same", "SAME BODY", "",
  ];
  // Stored exactly halfway between the two identical copies below - both are an equally
  // good guess, so neither is trusted.
  const range = { label: "X", color: "#111111", startLine: 5, endLine: 6, anchor: "## same", endAnchor: "same body" };
  const moved = Labels.reanchorRanges([range], lines);
  assert(moved.length === 0, "an unresolvable tie should drop the range, got " + JSON.stringify(moved));
});

check("a skill-written sidecar with no sourceHash or anchors still yields its lenses", () => {
  // Exactly the shape SKILL.md instructs an authoring agent to write: no sourceHash, no
  // anchor/endAnchor on any range.
  const doc = "# Title\n\nIntro paragraph.\n\n## Setup\n\nInstall it.";
  const skillWritten = { version: 1, lenses: [{
    name: "How does this content break down?",
    generatedBy: "skill",
    generatedAt: "2026-01-01T00:00:00Z",
    ranges: [
      { label: "Intro", color: "#2563eb", startLine: 1, endLine: 3 },
      { label: "Setup", color: "#059669", startLine: 5, endLine: 6 },
    ],
  }] };
  const read = Labels.readLabels(skillWritten, doc);
  assert(read.lenses.length === 1, "the skill's lens should not be discarded, got " + read.lenses.length);
  assert(read.lenses[0].ranges.length === 2, "both of its ranges should survive, got " + read.lenses[0].ranges.length);
});

check("the active lens reaches the preview, and only for a real document", () => {
  if (!MarkdownIt) return;
  const lens = { name: "L", ranges: [{ label: "Intro", color: "#2563eb", startLine: 1, endLine: 3 }] };
  const md = mymarkdownPlugin(new MarkdownIt({ html: true }), { readLens: () => ({ active: "L", lenses: [lens] }) });
  const src = "# Title\n\nIntro.\n";

  // VS Code's real engine calls parse() with env.currentDocument always unset, and only
  // supplies it in the *separate* env object handed to render() afterward - so the two
  // calls must use different env objects here too, or this test cannot catch a marker
  // that only a core rule (which runs during parse) could produce.
  const tokens = md.parse(src, {});
  const withDoc = md.renderer.render(tokens, md.options, { currentDocument: { path: "/x.md" } });
  includes(withDoc, 'id="mymd-labels"', "the marker for the preview script");
  includes(withDoc, "Intro", "the lens content");
  includes(withDoc, "lenses", "the marker carries all lenses for in-preview switching");
  assert(withDoc.indexOf('id="mymd-labels"') > withDoc.indexOf("<h1"), "the marker goes after the document");
  // markdown.api.render passes no document, so nothing may be added to its output.
  const noDoc = md.renderer.render(tokens, md.options, {});
  assert(noDoc.indexOf("mymd-labels") === -1, "a render with no document must not carry a marker");
});

check("a hostile label cannot break out of the data-lens attribute", () => {
  if (!MarkdownIt) return;
  const hostile = {
    name: "L",
    ranges: [{ label: '"><img src=x onerror=alert(1)>&</div>', color: "#2563eb", startLine: 1, endLine: 1 }],
  };
  const md = mymarkdownPlugin(new MarkdownIt({ html: true }), { readLens: () => ({ active: "L", lenses: [hostile] }) });
  const tokens = md.parse("# Title\n", {});
  const html = md.renderer.render(tokens, md.options, { currentDocument: { path: "/x.md" } });

  assert(html.indexOf("<img") === -1, "an unescaped label must not inject a live element");
  assert(!/<\/div>\s*<img/.test(html), "the label text must not be able to close the marker early");

  const match = /data-lens="([^"]*)"/.exec(html);
  assert(match, "the attribute must be found by a naive double-quote-terminated match too");
  const decoded = match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
  assert(
    JSON.parse(decoded).lenses[0].ranges[0].label === hostile.ranges[0].label,
    "escaping must round-trip the label losslessly",
  );
});

check("a model's reply is mined for JSON however it is wrapped", () => {
  const wrapped = 'Sure! Here you go:\n\n```json\n{"items":[{"label":"A","color":"#111111","startLine":1,"endLine":2}]}\n```\n\nHope that helps.';
  const ranges = Runner.parseRanges(wrapped);
  assert(ranges.length === 1, "expected one range out of a fenced reply");
  const braced = '{"items":[{"label":"Brace } inside","color":"#111111","startLine":1,"endLine":2}]}';
  assert(Runner.parseRanges(braced).length === 1, "a brace inside a string must not end the object");
  assert(Runner.parseRanges("no json here at all").length === 0, "a reply with no JSON yields nothing");
});

check("suggestions are held to three short, distinct questions", () => {
  const reply = JSON.stringify({ suggestions: [
    { label: "How does this content break down?" },
    { label: "How does this content break down?" },
    { label: "This question is far too long to be useful as a chip label" },
    { label: "Which parts need work?" },
    { label: "What repeats?" },
    { label: "What is unfinished?" },
  ] });
  const out = Runner.parseSuggestions(reply);
  assert(out.length === 3, "expected three suggestions, got " + out.length);
  assert(new Set(out).size === 3, "duplicates are dropped");
  for (const question of out) {
    assert(question.split(" ").length <= 8, "over-long questions are dropped whole: " + question);
  }
});

/**
 * A minimal, stateful stub for the two label-management flows added after the rest of
 * this file's big shared stub was written: a config store `.get()`/`.update()` actually
 * round-trip through, and a command registry that keeps the real handlers instead of
 * discarding them, so a check can invoke `mymarkdown.toggleLabels` etc. directly rather
 * than only confirming it is *declared*.
 */
function driveLabelCommands(sidecarByPath, activeDocument, openDocuments) {
  const path_ = require("path");
  const Module = require("module");
  const load = Module._load;
  const off = { dispose() {} };
  const configStore = { "labels.enabled": true };
  const commandHandlers = {};
  const quickPickQueue = [];
  const warningAnswers = [];
  const messages = [];
  const written = [];
  const refreshes = [];
  const watchers = [];
  const configListeners = [];
  let statusItem;
  let deleted = false;

  const stub = {
    Range: class {},
    Position: class {},
    Selection: class {},
    TextEdit: { replace: () => ({}) },
    Diagnostic: class {},
    WorkspaceEdit: class {},
    EndOfLine: { LF: 1, CRLF: 2 },
    DiagnosticSeverity: { Warning: 1, Information: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ThemeIcon: class {},
    ThemeColor: class {},
    TreeItem: class {},
    TreeItemCollapsibleState: { None: 0 },
    TextEditorRevealType: { AtTop: 3 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15 },
    LanguageModelChatMessage: { User: (text) => ({ text }) },
    Uri: {
      joinPath: (base, ...parts) => ({
        fsPath: [base && base.fsPath, ...parts].filter(Boolean).join("/"),
        toString() {
          return this.fsPath;
        },
      }),
    },
    EventEmitter: class {
      constructor() {
        this.event = () => off;
      }
      fire() {}
    },
    languages: {
      createDiagnosticCollection: () => ({ set() {}, delete() {}, clear() {}, dispose() {} }),
      registerDocumentFormattingEditProvider: () => off,
    },
    window: {
      activeTextEditor: activeDocument ? { document: activeDocument } : undefined,
      registerTreeDataProvider: () => off,
      onDidChangeActiveTextEditor: () => off,
      showInformationMessage: (text) => {
        messages.push({ kind: "info", text });
      },
      // Each call consumes the next queued answer, like the quick picks below: a check plays
      // the part of whoever presses a modal's button.
      showWarningMessage: async (text) => {
        messages.push({ kind: "warning", text });
        return warningAnswers.shift();
      },
      showErrorMessage: (text) => {
        messages.push({ kind: "error", text });
      },
      // Each call consumes the next queued answer, in the order the code under test asks -
      // the same shape as a person clicking through a chain of quick picks by hand.
      showQuickPick: async () => quickPickQueue.shift(),
      showInputBox: async () => undefined,
      setStatusBarMessage() {},
      withProgress: async (_options, work) => work({ onCancellationRequested: () => off }),
      createStatusBarItem: () =>
        (statusItem = { text: "", tooltip: "", command: "", show() {}, hide() {}, dispose() {} }),
    },
    workspace: {
      getConfiguration: () => ({
        get: (key, fallback) => (key in configStore ? configStore[key] : fallback),
        update: async (key, value) => {
          configStore[key] = value;
        },
      }),
      onDidChangeTextDocument: () => off,
      onDidOpenTextDocument: () => off,
      onDidCloseTextDocument: () => off,
      onDidChangeConfiguration: (listener) => {
        configListeners.push(listener);
        return off;
      },
      // Records each watcher's glob and handlers, so a check can play the part of a file
      // written on disk behind the extension's back.
      createFileSystemWatcher: (glob) => {
        const watcher = { glob, disposed: false, handlers: {} };
        watchers.push(watcher);
        const on = (kind) => (handler) => {
          watcher.handlers[kind] = handler;
          return off;
        };
        return {
          onDidCreate: on("create"),
          onDidChange: on("change"),
          onDidDelete: on("delete"),
          dispose() {
            watcher.disposed = true;
          },
        };
      },
      textDocuments: activeDocument ? [activeDocument] : openDocuments || [],
      openTextDocument: async (uri) => {
        throw new Error("not open: " + uri);
      },
      applyEdit: async () => true,
      getWorkspaceFolder: () => ({ uri: { fsPath: "/ws" } }),
      fs: {
        readFile: async (uri) => {
          const body = sidecarByPath[uri.fsPath];
          if (body === undefined) throw new Error("no sidecar");
          return Buffer.from(JSON.stringify(body), "utf8");
        },
        writeFile: async (uri, contents) => {
          written.push({ path: uri.fsPath, body: JSON.parse(contents.toString("utf8")) });
        },
        createDirectory: async () => {},
        delete: async () => {
          deleted = true;
        },
      },
    },
    commands: {
      registerCommand: (name, handler) => {
        commandHandlers[name] = handler;
        return off;
      },
      executeCommand: async (name) => {
        if (name === "markdown.preview.refresh") refreshes.push(name);
      },
    },
    lm: { selectChatModels: async () => [] },
  };

  Module._load = (request, ...rest) => (request === "vscode" ? stub : load(request, ...rest));
  let handlers;
  let api;
  try {
    const entry = path_.join(__dirname, "extension.js");
    delete require.cache[require.resolve(entry)];
    const extension = require(entry);
    api = extension.activate({ subscriptions: [] });
    handlers = commandHandlers;
  } finally {
    Module._load = load;
  }

  return {
    handlers,
    api,
    configStore,
    queueQuickPick: (...answers) => quickPickQueue.push(...answers),
    queueWarningAnswer: (...answers) => warningAnswers.push(...answers),
    messages,
    vscode: stub,
    written,
    deleted: () => deleted,
    refreshes,
    watchers,
    status: () => statusItem,
    changeConfig: (key, value) => {
      configStore[key] = value;
      for (const listener of configListeners) listener({ affectsConfiguration: (name) => name === "mymarkdown." + key });
    },
  };
}

/** Long enough for the extension's 300 ms label refresh to fire and its disk read to land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

check("toggling labels flips the setting both ways and is reachable with no document open", () => {
  const host = driveLabelCommands({});
  assert(host.configStore["labels.enabled"] === true, "labels start enabled");
  return host.handlers["mymarkdown.toggleLabels"]()
    .then(() => {
      assert(host.configStore["labels.enabled"] === false, "one toggle disables");
      return host.handlers["mymarkdown.toggleLabels"]();
    })
    .then(() => {
      assert(host.configStore["labels.enabled"] === true, "a second toggle re-enables");
    });
});

function fakeMarkdownDocument(fsPath, text) {
  return {
    uri: { fsPath, toString: () => "file://" + fsPath },
    languageId: "markdown",
    isClosed: false,
    version: 1,
    getText: () => text,
  };
}

check("removeLens deletes only the picked lens and keeps the rest", () => {
  const doc = "# A\n\nabc\n\n# B\n\ndef\n";
  const before = Labels.writeLabels(
    doc,
    [
      { name: "First", ranges: [{ label: "One", color: "#111111", startLine: 1, endLine: 3 }] },
      { name: "Second", ranges: [{ label: "Two", color: "#222222", startLine: 5, endLine: 7 }] },
    ],
    null,
  );
  const document = fakeMarkdownDocument("/ws/doc.md", doc);
  const host = driveLabelCommands({ "/ws/.mymd/doc.md.json": before }, document);
  host.queueQuickPick("First");
  return host.handlers["mymarkdown.removeLens"]().then(() => {
    assert(host.written.length === 1, "expected one write, got " + host.written.length);
    const names = host.written[0].body.lenses.map((l) => l.name);
    assert(names.join(",") === "Second", "First should be gone, Second should remain: " + names);
    assert(!host.deleted(), "the sidecar file itself should not be deleted while a lens remains");
  });
});

check("removeLens deletes the sidecar file rather than writing an empty one when nothing is left", () => {
  const doc = "# A\n\nabc\n";
  const before = Labels.writeLabels(
    doc,
    [{ name: "Only", ranges: [{ label: "One", color: "#111111", startLine: 1, endLine: 3 }] }],
    null,
  );
  const document = fakeMarkdownDocument("/ws/doc.md", doc);
  const host = driveLabelCommands({ "/ws/.mymd/doc.md.json": before }, document);
  host.queueQuickPick("Only");
  return host.handlers["mymarkdown.removeLens"]().then(() => {
    assert(host.deleted(), "the sidecar file should be removed, not left holding an empty lens list");
    assert(host.written.length === 0, "nothing should be written once the last lens is gone");
  });
});

check("switchLens's own \"Delete a lens...\" item reaches the same deletion path", () => {
  const doc = "# A\n\nabc\n\n# B\n\ndef\n";
  const before = Labels.writeLabels(
    doc,
    [
      { name: "First", ranges: [{ label: "One", color: "#111111", startLine: 1, endLine: 3 }] },
      { name: "Second", ranges: [{ label: "Two", color: "#222222", startLine: 5, endLine: 7 }] },
    ],
    null,
  );
  const document = fakeMarkdownDocument("/ws/doc.md", doc);
  const host = driveLabelCommands({ "/ws/.mymd/doc.md.json": before }, document);
  // First answer picks the picker's delete item; second answer picks which lens.
  host.queueQuickPick({ label: "$(trash) Delete a lens…" }, "Second");
  return host.handlers["mymarkdown.switchLens"]().then(() => {
    assert(host.written.length === 1, "expected one write, got " + host.written.length);
    const names = host.written[0].body.lenses.map((l) => l.name);
    assert(names.join(",") === "First", "Second should be gone, First should remain: " + names);
  });
});

check("switchLens's own toggle item disables labels without a separate command", () => {
  const doc = "# A\n\nabc\n";
  const before = Labels.writeLabels(
    doc,
    [{ name: "Only", ranges: [{ label: "One", color: "#111111", startLine: 1, endLine: 3 }] }],
    null,
  );
  const document = fakeMarkdownDocument("/ws/doc.md", doc);
  const host = driveLabelCommands({ "/ws/.mymd/doc.md.json": before }, document);
  host.queueQuickPick({ label: "$(circle-slash) Disable labels completely" });
  return host.handlers["mymarkdown.switchLens"]().then(() => {
    assert(host.configStore["labels.enabled"] === false, "the picker's toggle item should flip the setting");
  });
});

const sidecarUri = (fsPath) => ({ fsPath, toString: () => fsPath });

check("a sidecar written outside the extension (by an agent) shows up without editing the document", () => {
  const doc = "# A\n\nabc\n";
  const sidecars = {};
  const host = driveLabelCommands(sidecars, fakeMarkdownDocument("/ws/doc.md", doc));
  const watcher = host.watchers[0];
  assert(watcher && watcher.glob === "**/.mymd/**", "the sidecar folder should be watched, got " + (watcher && watcher.glob));
  return settle()
    .then(() => {
      assert(host.status().text === "$(tag) Label", "no labels before the sidecar exists, got " + host.status().text);
      sidecars["/ws/.mymd/doc.md.json"] = Labels.writeLabels(
        doc,
        [{ name: "Parts", ranges: [{ label: "One", color: "#111111", startLine: 1, endLine: 3 }] }],
        null,
      );
      host.refreshes.length = 0;
      watcher.handlers.create(sidecarUri("/ws/.mymd/doc.md.json"));
      return settle();
    })
    .then(() => {
      assert(host.status().text === "$(tag) Parts", "the new lens should be picked up, got " + host.status().text);
      assert(host.refreshes.length > 0, "the preview should be told to render again");
      delete sidecars["/ws/.mymd/doc.md.json"];
      watcher.handlers.delete(sidecarUri("/ws/.mymd/doc.md.json"));
      return settle();
    })
    .then(() => {
      assert(host.status().text === "$(tag) Label", "a deleted sidecar should take its labels with it, got " + host.status().text);
    });
});

check("changing labels.storagePath re-points the watcher and rereads labels from the new folder", () => {
  const doc = "# A\n\nabc\n";
  const lens = (name) =>
    Labels.writeLabels(doc, [{ name, ranges: [{ label: "One", color: "#111111", startLine: 1, endLine: 3 }] }], null);
  const host = driveLabelCommands(
    { "/ws/.mymd/doc.md.json": lens("Old"), "/ws/.labels/doc.md.json": lens("New") },
    fakeMarkdownDocument("/ws/doc.md", doc),
  );
  return settle()
    .then(() => {
      assert(host.status().text === "$(tag) Old", "starts on the default folder, got " + host.status().text);
      host.changeConfig("labels.storagePath", ".labels");
      return settle();
    })
    .then(() => {
      assert(host.watchers[0].disposed, "the watcher on the old folder should be disposed");
      assert(host.watchers[1] && host.watchers[1].glob === "**/.labels/**", "a watcher should cover the new folder");
      assert(host.status().text === "$(tag) New", "labels should come from the new folder, got " + host.status().text);
    });
});

check("storagePath values like './labels/' still give a watcher that can match", () => {
  const host = driveLabelCommands({});
  host.changeConfig("labels.storagePath", "./labels/");
  const glob = host.watchers[host.watchers.length - 1].glob;
  assert(glob === "**/labels/**", "the glob should be normalised like the sidecar path, got " + glob);
  host.changeConfig("labels.storagePath", "notes[old]");
  const escaped = host.watchers[host.watchers.length - 1].glob;
  assert(escaped === "**/notes[[]old[]]/**", "glob characters should be escaped, got " + escaped);
});

check("a folder-only watcher event (a new sidecar subfolder, a deleted .mymd) reloads the documents under it", () => {
  const doc = "# A\n\nabc\n";
  const sidecars = {};
  const host = driveLabelCommands(sidecars, fakeMarkdownDocument("/ws/docs/doc.md", doc));
  return settle()
    .then(() => {
      sidecars["/ws/.mymd/docs/doc.md.json"] = Labels.writeLabels(
        doc,
        [{ name: "Parts", ranges: [{ label: "One", color: "#111111", startLine: 1, endLine: 3 }] }],
        null,
      );
      // VS Code often reports only the new folder, not the file inside it.
      host.watchers[0].handlers.create(sidecarUri("/ws/.mymd/docs"));
      return settle();
    })
    .then(() => {
      assert(host.status().text === "$(tag) Parts", "a sidecar in a new folder should show, got " + host.status().text);
      delete sidecars["/ws/.mymd/docs/doc.md.json"];
      host.watchers[0].handlers.delete(sidecarUri("/ws/.mymd"));
      return settle();
    })
    .then(() => {
      assert(host.status().text === "$(tag) Label", "deleting the whole folder should clear the labels, got " + host.status().text);
    });
});

check("a preview restored on startup, with no editor for its document, still gets its labels", () => {
  const doc = "# A\n\nabc\n";
  const document = fakeMarkdownDocument("/ws/doc.md", doc);
  const sidecars = {
    "/ws/.mymd/doc.md.json": Labels.writeLabels(
      doc,
      [{ name: "Parts", ranges: [{ label: "One", color: "#111111", startLine: 1, endLine: 3 }] }],
      null,
    ),
  };
  // The document is open (the preview opened it) but no editor has ever been active.
  const host = driveLabelCommands(sidecars, undefined, [document]);
  const engine = host.api.extendMarkdownIt(new MarkdownIt());
  const render = () => engine.render(doc, { currentDocument: document.uri });
  render();
  return settle().then(() => {
    assert(host.refreshes.length > 0, "the preview should be told to render again once its labels are read");
    includes(render(), 'id="mymd-labels"', "the preview's next render");
    assert(host.status().text === "$(tag) Parts", "the status bar should follow the preview, got " + host.status().text);
  });
});

check("a sidecar change to a lens other than the active one still re-renders the preview", () => {
  const doc = "# A\n\nabc\n";
  const lens = (name) => ({ name, ranges: [{ label: "One", color: "#111111", startLine: 1, endLine: 3 }] });
  const sidecars = { "/ws/.mymd/doc.md.json": Labels.writeLabels(doc, [lens("First")], null) };
  const host = driveLabelCommands(sidecars, fakeMarkdownDocument("/ws/doc.md", doc));
  return settle()
    .then(() => {
      // An agent adds a second lens; the first, active one is untouched.
      sidecars["/ws/.mymd/doc.md.json"] = Labels.writeLabels(doc, [lens("First"), lens("Second")], null);
      host.refreshes.length = 0;
      host.watchers[0].handlers.change(sidecarUri("/ws/.mymd/doc.md.json"));
      return settle();
    })
    .then(() => {
      assert(host.refreshes.length > 0, "the preview's lens dropdown needs the new lens, so it must render again");
    });
});

// The agent hook, run the way each agent runs it: a copy dropped into a scratch repo (it
// finds its repo from its own location) and fed that agent's payload shape on stdin. The
// shapes are trimmed from payloads captured from Claude Code, Copilot CLI and Codex, and
// from VS Code's tool schemas.
const REPO = path.join(__dirname, "..");

function hookRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mymd-hook-"));
  const script = path.join(root, ".agents", "hooks", "markdown-labels.cjs");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(path.join(REPO, ".agents", "hooks", "markdown-labels.cjs"), script);
  fs.mkdirSync(path.join(root, "docs"));
  const doc = path.join(root, "docs", "big.md");
  const parts = [1, 2, 3].map((n) => `## Part ${n}\n\n${"word ".repeat(150).trim()}\n`);
  fs.writeFileSync(doc, "# Guide\n\n" + parts.join("\n"));

  const run = (payload, { args = [], env = {} } = {}) => {
    const inherited = { ...process.env };
    delete inherited.COPILOT_CLI;
    delete inherited.CLAUDE_PROJECT_DIR;
    const result = spawnSync(process.execPath, [script, ...args], {
      input: JSON.stringify(payload),
      env: { ...inherited, ...env },
      encoding: "utf8",
    });
    assert(result.status === 0, "the hook must always exit 0, got " + result.status + ": " + result.stderr);
    return result.stdout ? JSON.parse(result.stdout) : null;
  };
  return { root, doc, run, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

check("label hook: each agent's write gets the nudge, in the format that agent reads", () => {
  const repo = hookRepo();
  try {
    const claude = { env: { CLAUDE_PROJECT_DIR: repo.root }, args: ["--claude-settings"] };
    const patch = "*** Begin Patch\n*** Update File: docs/big.md\n@@\n-a\n+b\n*** End Patch";
    const cases = [
      ["Claude Code Write", { tool_name: "Write", tool_input: { file_path: repo.doc, content: "…" }, tool_response: {} }, claude],
      // COPILOT_CLI is inherited by anything started from a Copilot shell; Claude Code's own
      // hook must not mistake itself for Copilot's second run.
      [
        "Claude Code started from a Copilot shell",
        { tool_name: "Edit", tool_input: { file_path: repo.doc }, tool_response: {} },
        { env: { CLAUDE_PROJECT_DIR: repo.root, COPILOT_CLI: "1" }, args: ["--claude-settings"] },
      ],
      ["Copilot CLI edit", { toolName: "edit", toolArgs: { path: repo.doc, old_str: "a", new_str: "b" } }, { env: { COPILOT_CLI: "1" } }],
      ["Copilot CLI str_replace_editor", { toolName: "str_replace_editor", toolArgs: { command: "create", path: repo.doc, file_text: "…" } }, {}],
      ["Copilot CLI apply_patch as a bare patch", { toolName: "apply_patch", toolArgs: patch }, {}],
      ["VS Code create_file", { tool_name: "create_file", tool_input: { filePath: repo.doc, content: "…" } }, {}],
      [
        "VS Code multi_replace_string_in_file",
        { tool_name: "multi_replace_string_in_file", tool_input: { replacements: [{ filePath: repo.doc, oldString: "a", newString: "b" }] } },
        {},
      ],
      // Codex sends patch text with paths relative to its cwd, here a subfolder of the repo.
      [
        "Codex apply_patch",
        { tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Update File: big.md\n@@\n-a\n+b\n*** End Patch" }, cwd: path.join(repo.root, "docs") },
        {},
      ],
    ];
    for (const [name, payload, opts] of cases) {
      const out = repo.run({ hook_event_name: "PostToolUse", cwd: repo.root, ...payload }, opts);
      const context = "toolName" in payload ? out?.additionalContext : out?.hookSpecificOutput?.additionalContext;
      assert(context && context.includes("docs/big.md is now") && context.includes("markdown-labels skill"), name + " got " + JSON.stringify(out));
    }
  } finally {
    repo.cleanup();
  }
});

check("label hook: reads, and a second agent running Claude's hooks, stay quiet", () => {
  const repo = hookRepo();
  try {
    const quiet = [
      ["Claude Code Read", { tool_name: "Read", tool_input: { file_path: repo.doc }, tool_response: {} }, { env: { CLAUDE_PROJECT_DIR: repo.root }, args: ["--claude-settings"] }],
      ["Copilot CLI str_replace_editor view", { toolName: "str_replace_editor", toolArgs: { command: "view", path: repo.doc } }, {}],
      ["Copilot CLI view", { toolName: "view", toolArgs: { path: repo.doc } }, { env: { COPILOT_CLI: "1" } }],
      // Copilot CLI also runs .claude/settings.json (it sets CLAUDE_PROJECT_DIR too) but drops
      // hookSpecificOutput; its .github/hooks entry already spoke.
      [
        "Copilot CLI via .claude/settings.json",
        { tool_name: "Write", tool_input: { path: repo.doc, file_text: "…" }, tool_result: {} },
        { env: { COPILOT_CLI: "1", CLAUDE_PROJECT_DIR: repo.root }, args: ["--claude-settings"] },
      ],
      ["VS Code via chat.useClaudeHooks", { tool_name: "create_file", tool_input: { filePath: repo.doc } }, { args: ["--claude-settings"] }],
    ];
    for (const [name, payload, opts] of quiet) {
      const out = repo.run({ cwd: repo.root, ...payload }, opts);
      assert(out === null, name + " should print nothing, got " + JSON.stringify(out));
    }
    // One real heading; the "# ..." lines are shell comments inside a fence.
    const oneHeading = path.join(repo.root, "docs", "one-heading.md");
    fs.writeFileSync(oneHeading, "# Notes\n\n" + "word ".repeat(450) + "\n\n```bash\n# install\nnpm ci\n# test\nnpm test\n```\n");
    const out = repo.run({ cwd: repo.root, tool_name: "create_file", tool_input: { filePath: oneHeading } });
    assert(out === null, "comments in a code fence are not headings, got " + JSON.stringify(out));
  } finally {
    repo.cleanup();
  }
});

check("label hook: a skill-written sidecar gets anchors on save, follows its text, and ends the nudge", () => {
  const repo = hookRepo();
  try {
    const text = fs.readFileSync(repo.doc, "utf8");
    const lines = text.split("\n");
    const start = lines.indexOf("## Part 2") + 1;
    // Exactly what the skill writes: no sourceHash, no anchors.
    const sidecar = path.join(repo.root, ".mymd", "docs", "big.md.json");
    fs.mkdirSync(path.dirname(sidecar), { recursive: true });
    fs.writeFileSync(
      sidecar,
      JSON.stringify({ version: 1, lenses: [{ name: "Parts", generatedBy: "skill", ranges: [{ label: "Two", color: "#059669", startLine: start, endLine: start + 2 }] }] }),
    );
    const saved = repo.run({ tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Add File: .mymd/docs/big.md.json\n+…\n*** End Patch" }, cwd: repo.root });
    assert(saved === null, "saving a sidecar is not itself worth a nudge: " + JSON.stringify(saved));
    const stamped = JSON.parse(fs.readFileSync(sidecar, "utf8")).lenses[0].ranges[0];
    const expected = Labels.anchorsFor(lines, start, start + 2);
    assert(stamped.anchor === expected.anchor && stamped.endAnchor === expected.endAnchor, "anchors must match the extension's: " + JSON.stringify(stamped));

    // Two lines added above the section push it down two lines.
    const edited = "Preface.\n\n" + text;
    fs.writeFileSync(repo.doc, edited);
    const out = repo.run({ tool_name: "Edit", tool_input: { file_path: repo.doc }, tool_response: {}, cwd: repo.root }, { env: { CLAUDE_PROJECT_DIR: repo.root }, args: ["--claude-settings"] });
    assert(out === null, "an edit to a labelled document should not re-nag: " + JSON.stringify(out));
    const range = Labels.readLabels(JSON.parse(fs.readFileSync(sidecar, "utf8")), edited).lenses[0].ranges[0];
    assert(range.startLine === start + 2, "the label should follow its section to line " + (start + 2) + ", got " + range.startLine);
  } finally {
    repo.cleanup();
  }
});

check("label hook wiring: every agent points at the one script, and both skill copies match", () => {
  const read = (file) => fs.readFileSync(path.join(REPO, file), "utf8");
  const claude = JSON.parse(read(".claude/settings.json")).hooks.PostToolUse[0].hooks[0].command;
  const copilot = JSON.parse(read(".github/hooks/markdown-labels.json")).hooks.postToolUse[0];
  const codex = JSON.parse(read(".codex/hooks.json")).hooks.PostToolUse[0].hooks[0].command;
  for (const [name, command] of [["Claude Code", claude], ["Copilot bash", copilot.bash], ["Copilot powershell", copilot.powershell], ["Codex", codex]]) {
    includes(command, ".agents/hooks/markdown-labels.cjs", name + " command");
  }
  includes(claude, "--claude-settings", "Claude Code command");
  assert(
    read(".claude/skills/markdown-labels/SKILL.md") === read(".agents/skills/markdown-labels/SKILL.md"),
    ".claude/skills/markdown-labels/SKILL.md has drifted from .agents/skills/markdown-labels/SKILL.md",
  );
});

// Installing the hook and skill into other projects: agent-hooks/install.js, shared by the
// extension's command and the mymarkdown-hooks CLI.
const Hooks = require("./agent-hooks/install.js");
const HOOK_CLI = path.join(__dirname, "agent-hooks", "cli.js");

function scratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mymd-install-"));
  const file = (dest) => path.join(root, ...dest.split("/"));
  return {
    root,
    file,
    read: (dest) => fs.readFileSync(file(dest), "utf8"),
    put: (dest, text) => {
      fs.mkdirSync(path.dirname(file(dest)), { recursive: true });
      fs.writeFileSync(file(dest), text);
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

const statuses = (results) => Object.fromEntries(results.map((result) => [result.file, result.status]));
const template = (dest) =>
  fs.readFileSync(path.join(__dirname, "agent-hooks", "files", Hooks.TARGETS.find((t) => t.dest === dest).from), "utf8");

check("agent hooks installer: an empty project gets all six files, and running it again changes nothing", () => {
  const project = scratchProject();
  try {
    const first = Hooks.installAgentHooks(project.root);
    assert(first.length === 6 && first.every((result) => result.status === "created"), JSON.stringify(first));
    for (const target of Hooks.TARGETS) {
      assert(project.read(target.dest) === template(target.dest), target.dest + " should be the template");
    }
    const second = Hooks.installAgentHooks(project.root);
    assert(second.every((result) => result.status === "unchanged"), "a second run should change nothing: " + JSON.stringify(second));

    // The installed hook runs from its new home and nudges about a big unlabelled document.
    project.put("docs/big.md", "# Guide\n\n## One\n\n" + "word ".repeat(420) + "\n\n## Two\n\nend\n");
    const run = spawnSync(process.execPath, [project.file(".agents/hooks/markdown-labels.cjs"), "--claude-settings"], {
      input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: project.file("docs/big.md") }, tool_response: {} }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: project.root, COPILOT_CLI: "" },
      encoding: "utf8",
    });
    includes(run.stdout, "docs/big.md is now", "the installed hook's nudge");
  } finally {
    project.cleanup();
  }
});

check("agent hooks installer: existing agent configs are merged into, never replaced", () => {
  const project = scratchProject();
  try {
    const theirs = { type: "command", command: "npm run lint" };
    project.put(
      ".claude/settings.json",
      JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { PostToolUse: [{ matcher: "Write", hooks: [theirs] }] } }, null, "\t") + "\n",
    );
    project.put(".codex/hooks.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] } }));

    const results = statuses(Hooks.installAgentHooks(project.root));
    assert(results[".claude/settings.json"] === "merged" && results[".codex/hooks.json"] === "merged", JSON.stringify(results));

    const claude = JSON.parse(project.read(".claude/settings.json"));
    assert(claude.permissions.allow[0] === "Bash(ls)", "their permissions must survive");
    assert(JSON.stringify(claude.hooks.PostToolUse[0].hooks[0]) === JSON.stringify(theirs), "their hook must survive, first");
    includes(claude.hooks.PostToolUse[1].hooks[0].command, ".agents/hooks/markdown-labels.cjs", "our hook, added after theirs");
    assert(project.read(".claude/settings.json").startsWith('{\n\t"permissions"'), "their tab indentation should be kept");
    assert(project.read(".claude/settings.json").endsWith("}\n"), "their trailing newline should be kept");

    const codex = JSON.parse(project.read(".codex/hooks.json"));
    assert(codex.hooks.Stop[0].hooks[0].command === "echo done", "their Codex hook must survive");
    includes(codex.hooks.PostToolUse[0].hooks[0].command, "markdown-labels.cjs", "our Codex hook");
    assert(!project.read(".codex/hooks.json").endsWith("\n"), "a file with no trailing newline stays that way");
  } finally {
    project.cleanup();
  }
});

check("agent hooks installer: files that differ are kept unless forced, and forcing keeps what shares our entry", () => {
  const project = scratchProject();
  try {
    Hooks.installAgentHooks(project.root);
    project.put(".agents/hooks/markdown-labels.cjs", "// my own tweaks\n");
    // An entry from the release before this one, sharing its group with someone else's hook.
    const old = { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/markdown-labels.cjs"' };
    const theirs = { type: "command", command: "prettier --write" };
    project.put(".claude/settings.json", JSON.stringify({ hooks: { PostToolUse: [{ matcher: "Write|Edit", hooks: [theirs, old] }] } }, null, 2) + "\n");
    const before = project.read(".claude/settings.json");

    const kept = statuses(Hooks.installAgentHooks(project.root));
    assert(kept[".agents/hooks/markdown-labels.cjs"] === "differs" && kept[".claude/settings.json"] === "differs", JSON.stringify(kept));
    assert(project.read(".agents/hooks/markdown-labels.cjs") === "// my own tweaks\n", "an edited file must not be touched");
    assert(project.read(".claude/settings.json") === before, "a differing entry must not be touched");

    const forced = statuses(Hooks.installAgentHooks(project.root, { force: true }));
    assert(forced[".agents/hooks/markdown-labels.cjs"] === "updated" && forced[".claude/settings.json"] === "updated", JSON.stringify(forced));
    assert(project.read(".agents/hooks/markdown-labels.cjs") === template(".agents/hooks/markdown-labels.cjs"), "forced: the hook is replaced");
    const groups = JSON.parse(project.read(".claude/settings.json")).hooks.PostToolUse;
    assert(groups.length === 2, "ours should move to its own entry, got " + JSON.stringify(groups));
    assert(JSON.stringify(groups[0]) === JSON.stringify({ matcher: "Write|Edit", hooks: [theirs] }), "their hook keeps its entry and matcher");
    includes(groups[1].hooks[0].command, ".agents/hooks/markdown-labels.cjs", "the replacement entry");
    assert(Hooks.installAgentHooks(project.root).every((result) => result.status === "unchanged"), "and then it is up to date");
  } finally {
    project.cleanup();
  }
});

check("agent hooks installer: a config it cannot read is reported and left alone, and the rest still installs", () => {
  const project = scratchProject();
  try {
    project.put(".claude/settings.json", "{ this is not json");
    project.put(".github", "a file where a folder is needed\n");
    const results = Hooks.installAgentHooks(project.root);
    const byFile = statuses(results);
    assert(byFile[".claude/settings.json"] === "invalid", JSON.stringify(results));
    assert(project.read(".claude/settings.json") === "{ this is not json", "an unreadable config must not be touched");
    assert(byFile[".github/hooks/markdown-labels.json"] === "failed", JSON.stringify(results));
    assert(results.find((result) => result.status === "failed").reason, "a failure should say why");
    assert(byFile[".agents/hooks/markdown-labels.cjs"] === "created" && byFile[".codex/hooks.json"] === "created", JSON.stringify(results));
  } finally {
    project.cleanup();
  }
});

/** Run `fn` with a throwaway home folder, so a broken guard can never write into the real one. */
function withFakeHome(fn) {
  const home = scratchProject();
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = process.env.USERPROFILE = home.root;
  try {
    return fn(home, { ...process.env, HOME: home.root, USERPROFILE: home.root });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    home.cleanup();
  }
}

check("agent hooks installer: refuses the home folder, however it is reached", () => {
  withFakeHome((home, env) => {
    const refused = (root) => {
      try {
        Hooks.installAgentHooks(root);
      } catch (error) {
        return /home folder/.test(error.message);
      }
      return false;
    };
    assert(refused(home.root), "the home folder itself must be refused");
    assert(refused(home.root + path.sep), "with a trailing separator too");
    // Through a symlink: the spelling differs, the folder is the same (like a lower-case
    // drive letter from VS Code on Windows).
    const link = path.join(os.tmpdir(), "mymd-homelink-" + process.pid);
    fs.symlinkSync(home.root, link);
    try {
      assert(refused(link), "a symlink to the home folder must be refused");
    } finally {
      fs.unlinkSync(link);
    }
    // The CLI outside any git repo falls back to the folder it runs in: from ~ that is refused.
    const run = spawnSync(process.execPath, [HOOK_CLI, "init"], { cwd: home.root, env, encoding: "utf8" });
    assert(run.status === 1 && /home folder/.test(run.stderr), "the CLI in ~ should refuse: " + run.stderr);
    assert(!fs.existsSync(home.file(".claude/settings.json")) && !fs.existsSync(home.file(".codex")), "nothing written");

    // A dotfiles repository in ~ is not the project for a folder under it that has none.
    fs.mkdirSync(home.file(".git"));
    fs.mkdirSync(home.file("notes"));
    const notes = spawnSync(process.execPath, [HOOK_CLI, "init"], { cwd: home.file("notes"), env, encoding: "utf8" });
    assert(notes.status === 0, "a folder under a dotfiles repo should install: " + notes.stderr);
    assert(fs.existsSync(home.file("notes/.agents/hooks/markdown-labels.cjs")), "into the folder it was run from");
  });
});

check("agent hooks installer: never writes through a symlink out of the project", () => {
  const project = scratchProject();
  const outside = scratchProject();
  try {
    // A symlinked folder (.claude shared with ~/.claude, say).
    fs.symlinkSync(outside.root, project.file(".claude"));
    const results = statuses(Hooks.installAgentHooks(project.root));
    assert(results[".claude/settings.json"] === "failed" && results[".claude/skills/markdown-labels/SKILL.md"] === "failed", JSON.stringify(results));
    assert(results[".codex/hooks.json"] === "created", "the rest still installs: " + JSON.stringify(results));
    // A dangling symlink at a target would otherwise create its target, wherever that is.
    fs.rmSync(project.file(".agents"), { recursive: true });
    fs.mkdirSync(project.file(".agents/hooks"), { recursive: true });
    fs.symlinkSync(outside.file("made-by-installer.cjs"), project.file(".agents/hooks/markdown-labels.cjs"));
    const dangling = statuses(Hooks.installAgentHooks(project.root));
    assert(dangling[".agents/hooks/markdown-labels.cjs"] === "failed", JSON.stringify(dangling));
    assert(fs.readdirSync(outside.root).length === 0, "nothing may appear outside the project: " + fs.readdirSync(outside.root));
  } finally {
    project.cleanup();
    outside.cleanup();
  }
});

check("agent hooks installer: a failed write leaves the old file whole", () => {
  const project = scratchProject();
  const original = JSON.stringify({ permissions: { deny: ["Read(.env)"] } }, null, 2) + "\n";
  project.put(".claude/settings.json", original);
  // Disk full midway through the settings file: half the text lands, then the write fails.
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = (file, text, ...rest) => {
    if (!String(file).includes("settings.json")) return realWrite(file, text, ...rest);
    realWrite(file, String(text).slice(0, 10), ...rest);
    throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
  };
  try {
    const results = statuses(Hooks.installAgentHooks(project.root));
    assert(results[".claude/settings.json"] === "failed", JSON.stringify(results));
  } finally {
    fs.writeFileSync = realWrite;
  }
  try {
    assert(project.read(".claude/settings.json") === original, "the user's settings must survive a failed write");
    assert(!fs.readdirSync(project.file(".claude")).some((name) => name.endsWith(".tmp")), "no temporary file is left behind");
  } finally {
    project.cleanup();
  }
});

check("agent hooks installer: configs are not pointed at a hook script that could not be written", () => {
  const project = scratchProject();
  try {
    project.put(".agents", "a file where the folder should be\n");
    const results = statuses(Hooks.installAgentHooks(project.root));
    assert(results[".agents/hooks/markdown-labels.cjs"] === "failed", JSON.stringify(results));
    for (const config of [".claude/settings.json", ".github/hooks/markdown-labels.json", ".codex/hooks.json"]) {
      assert(results[config] === "skipped" && !fs.existsSync(project.file(config)), config + " must not register a missing script");
    }
    const run = spawnSync(process.execPath, [HOOK_CLI, "init", project.root], { encoding: "utf8" });
    assert(run.status === 1 && !run.stdout.includes("pick the hook up"), "no success line when the hook is not active: " + run.stdout);
  } finally {
    project.cleanup();
  }
});

check("agent hooks installer: replacing clears every copy of our entry, and leaves hooks that only mention it", () => {
  const project = scratchProject();
  try {
    Hooks.installAgentHooks(project.root);
    const current = JSON.parse(project.read(".claude/settings.json")).hooks.PostToolUse[0];
    const old = { matcher: "Write|Edit", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/markdown-labels.cjs"' }] };
    const settings = (groups) => project.put(".claude/settings.json", JSON.stringify({ hooks: { PostToolUse: groups } }) + "\n");
    const groups = () => JSON.parse(project.read(".claude/settings.json")).hooks.PostToolUse;

    settings([current, old]);
    assert(statuses(Hooks.installAgentHooks(project.root))[".claude/settings.json"] === "differs", "a second, older copy is not 'unchanged'");
    Hooks.installAgentHooks(project.root, { force: true });
    assert(groups().length === 1 && JSON.stringify(groups()[0]) === JSON.stringify(current), "forced: exactly one, current: " + JSON.stringify(groups()));

    const lint = { matcher: "Write", hooks: [{ type: "command", command: "npx eslint --fix .agents/hooks/markdown-labels.cjs" }] };
    settings([lint]);
    const forced = Hooks.installAgentHooks(project.root, { force: true }).find((result) => result.file === ".claude/settings.json");
    assert(forced.status === "differs" && /its own way/.test(forced.reason), "a hook that mentions the script is theirs: " + JSON.stringify(forced));
    assert(JSON.stringify(groups()) === JSON.stringify([lint]), "and it is left exactly as it was");
  } finally {
    project.cleanup();
  }
});

check("agent hooks installer: Windows line endings are not a difference", () => {
  const project = scratchProject();
  try {
    Hooks.installAgentHooks(project.root);
    for (const target of Hooks.TARGETS) project.put(target.dest, project.read(target.dest).replace(/\n/g, "\r\n"));
    const results = Hooks.installAgentHooks(project.root);
    assert(results.every((result) => result.status === "unchanged"), "a CRLF checkout is up to date: " + JSON.stringify(results));
  } finally {
    project.cleanup();
  }
});

check("the repo's own agent files are exactly what the installer ships", () => {
  // They are this repo's own install. After editing a template in agent-hooks/files, run
  // `node vscode-extension/agent-hooks/cli.js init --force` from the repo root to refresh them.
  const project = scratchProject();
  try {
    for (const target of Hooks.TARGETS) project.put(target.dest, fs.readFileSync(path.join(REPO, ...target.dest.split("/")), "utf8"));
    const results = Hooks.installAgentHooks(project.root);
    const stale = results.filter((result) => result.status !== "unchanged").map((result) => result.file);
    assert(!stale.length, "out of date with agent-hooks/files: " + stale.join(", "));
  } finally {
    project.cleanup();
  }
});

check("mymarkdown-hooks CLI: init installs at the git root from a subfolder, and reports bad usage and bad configs", () => {
  const project = scratchProject();
  try {
    fs.mkdirSync(path.join(project.root, ".git"));
    fs.mkdirSync(path.join(project.root, "src", "deep"), { recursive: true });
    const cli = (args, cwd = project.root) => spawnSync(process.execPath, [HOOK_CLI, ...args], { cwd, encoding: "utf8" });

    const init = cli(["init"], path.join(project.root, "src", "deep"));
    assert(init.status === 0, "init should succeed: " + init.stderr);
    assert(fs.existsSync(project.file(".agents/hooks/markdown-labels.cjs")), "files belong at the git root");
    assert(!fs.existsSync(path.join(project.root, "src", "deep", ".agents")), "not in the folder it was run from");
    includes(init.stdout, "created", "the report");

    includes(cli(["init"]).stdout, "Already up to date", "a second run");
    const help = cli(["--help"]);
    assert(help.status === 0 && help.stdout.startsWith("Usage: mymarkdown-hooks init"), "--help: " + help.stdout);
    assert(cli([]).status === 1 && cli(["install"]).status === 1 && cli(["init", "--yes"]).status === 1, "bad usage exits 1");

    project.put(".codex/hooks.json", "not json");
    const broken = cli(["init", project.root]);
    assert(broken.status === 1, "an unreadable config should fail the run");
    includes(broken.stdout, "invalid", "the report");
  } finally {
    project.cleanup();
  }
});

check("the mymarkdown-hooks npm package ships everything the installer reads, and the VSIX keeps it", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "agent-hooks", "package.json"), "utf8"));
  assert(pkg.name === "mymarkdown-hooks" && pkg.bin["mymarkdown-hooks"] === "cli.js", "name and bin");
  assert(fs.readFileSync(HOOK_CLI, "utf8").startsWith("#!/usr/bin/env node\n"), "the bin needs a node shebang");
  for (const needed of ["cli.js", "install.js", "files/"]) assert(pkg.files.includes(needed), "package files should include " + needed);
  for (const target of Hooks.TARGETS) assert(fs.existsSync(path.join(__dirname, "agent-hooks", "files", target.from)), target.from);
  // npm packs a LICENSE from the package folder itself, and a symlink is not followed.
  assert(
    fs.readFileSync(path.join(__dirname, "agent-hooks", "LICENSE"), "utf8") === fs.readFileSync(path.join(__dirname, "LICENSE"), "utf8"),
    "agent-hooks/LICENSE should be a copy of the extension's LICENSE",
  );
  const ignored = fs.readFileSync(path.join(__dirname, ".vscodeignore"), "utf8").split("\n").map((line) => line.trim());
  assert(!ignored.some((line) => line.startsWith("agent-hooks")), ".vscodeignore must not drop agent-hooks: the command needs it");
});

check("Install Label Hooks command: installs into the open folder, and replaces changed files only when confirmed", () => {
  const project = scratchProject();
  const other = scratchProject();
  const host = driveLabelCommands({});
  const run = () => host.handlers["mymarkdown.installAgentHooks"]();
  const folder = (p, name) => ({ name, uri: { fsPath: p.root, scheme: "file" } });
  return run()
    .then(() => {
      assert(host.messages.pop().text.includes("open a project folder first"), "no folder: a warning, nothing else");
      host.vscode.workspace.workspaceFolders = [folder(project, "proj")];
      return run();
    })
    .then(() => {
      assert(fs.existsSync(project.file(".agents/hooks/markdown-labels.cjs")), "installed into the only folder");
      includes(host.messages.pop().text, "label hooks installed in proj", "the confirmation");
      project.put(".agents/hooks/markdown-labels.cjs", "// edited\n");
      host.queueWarningAnswer(undefined); // the modal dismissed
      return run();
    })
    .then(() => {
      assert(host.messages.some((m) => m.kind === "warning" && m.text.includes("Replace them?")), "it should ask before replacing");
      assert(project.read(".agents/hooks/markdown-labels.cjs") === "// edited\n", "dismissed: the edit stays");
      host.queueWarningAnswer("Replace");
      return run();
    })
    .then(() => {
      assert(project.read(".agents/hooks/markdown-labels.cjs") === template(".agents/hooks/markdown-labels.cjs"), "confirmed: replaced");
      // Several folders: the one picked, and only that one.
      host.vscode.workspace.workspaceFolders = [folder(project, "proj"), folder(other, "other")];
      host.queueQuickPick({ label: "other", folder: folder(other, "other") });
      return run();
    })
    .then(() => {
      assert(fs.existsSync(other.file(".codex/hooks.json")), "installed into the folder picked");
      includes(host.messages.pop().text, "installed in other", "the confirmation names it");
      // A config it cannot update: a warning that says what to fix, and no claim of success.
      host.messages.length = 0;
      host.vscode.workspace.workspaceFolders = [folder(other, "other")];
      other.put(".claude/settings.json", "{ not json");
      return run();
    })
    .then(() => {
      assert(host.messages.length === 1 && host.messages[0].kind === "warning", "only a warning: " + JSON.stringify(host.messages));
      includes(host.messages[0].text, ".claude/settings.json (not valid JSON)", "the warning");
      // Folders open, none on disk (a virtual workspace).
      host.messages.length = 0;
      host.vscode.workspace.workspaceFolders = [{ name: "vfs", uri: { fsPath: "/x", scheme: "vscode-vfs" } }];
      return run();
    })
    .then(() => {
      includes(host.messages.pop().text, "only be installed into a folder on disk", "a virtual workspace");
    })
    .finally(() => {
      project.cleanup();
      other.cleanup();
    });
});

Promise.all(pending).then(() => {
  if (failures.length) {
    console.error("\n  MyMarkdown checks: " + passed + " passed, " + failures.length + " failed\n");
    failures.forEach((f) => console.error("    - " + f));
    console.error("");
    process.exit(1);
  }
  console.log("  MyMarkdown checks: " + passed + " passed");
});
