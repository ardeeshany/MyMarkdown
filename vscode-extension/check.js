#!/usr/bin/env node
/*
  Checks for the MyMarkdown extension. These are the assertions the sync runs
  before it packages anything: if the rules copied from the website (or the
  renderer) stop behaving, this fails and nothing gets shipped.

  Run directly:  node vscode-extension/check.js
*/
"use strict";

const fs = require("fs");
const path = require("path");
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

check("loose JSON in prose is promoted, without shifting later lines", () => {
  const md = preview();
  const html = md.render('Response:\n\n{"ok":true,"n":3}\n\nDone.\n');
  includes(html, '<pre class="mymd-json">', "a bare JSON paragraph becomes a block");
  includes(html, '<p data-line="4"', "the paragraph after it keeps its own line");
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
  for (const file of ["icon.png", "preview-dark.png", "json-light.png"]) {
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

if (failures.length) {
  console.error("\n  MyMarkdown checks: " + passed + " passed, " + failures.length + " failed\n");
  failures.forEach((f) => console.error("    - " + f));
  console.error("");
  process.exit(1);
}
console.log("  MyMarkdown checks: " + passed + " passed");
