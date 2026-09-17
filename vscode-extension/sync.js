#!/usr/bin/env node
/*
  Refreshes the VS Code extension from the website and packages it.

  Run from the project root:  npm run extension

  What it does, in order:
    1. copies the Markdown rules out of src/routes/index.tsx   -> lib/mymarkdown.js
    2. copies the colour palette out of src/styles.css         -> media/preview.css
    3. runs the checks in check.js                             (aborts on failure)
    4. bumps the patch version and builds the install file

  The website is only ever read, never written.

  Flags: --skip-check  --skip-pack  --no-bump  --version=1.2.3
*/
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const EXT_DIR = __dirname;
const ROOT = path.resolve(EXT_DIR, "..");
const ROUTE_FILE = path.join(ROOT, "src", "routes", "index.tsx");
const STYLES_FILE = path.join(ROOT, "src", "styles.css");
const CORE_FILE = path.join(EXT_DIR, "lib", "mymarkdown.js");
const MANUAL_FILE = path.join(EXT_DIR, "lib", "manual-helpers.js");
const CSS_FILE = path.join(EXT_DIR, "media", "preview.css");
const MERMAID_FILE = path.join(EXT_DIR, "media", "mermaid.min.js");
const MERMAID_PREVIEW_FILE = path.join(EXT_DIR, "media", "mermaid-preview.js");
const MERMAID_BUNDLE_FILE = path.join(EXT_DIR, "media", "mermaid-preview.bundle.js");
const PKG_FILE = path.join(EXT_DIR, "package.json");

// First and last function of the block that is shared with the website.
const BLOCK_START = "function slugifyHeading";
const BLOCK_END = "function expandEscapedNewlinesInStrings";
const EXPECTED = [
  "slugifyHeading",
  "getTocHeadings",
  "promoteRawJsonToFences",
  "promoteInlineJsonToFences",
  "formatMarkdown",
  "lintMarkdown",
  "expandEscapedNewlines",
  "expandEscapedNewlinesInStrings",
];

// website token -> preview variable
const TOKENS = [
  ["--background", "--mm-bg"],
  ["--foreground", "--mm-fg"],
  ["--foreground", "--mm-fg-soft", 0.85],
  ["--foreground", "--mm-fg-mute", 0.6],
  ["--foreground", "--mm-chip", 0.07],
  ["--primary", "--mm-primary"],
  ["--primary", "--mm-primary-soft", 0.35],
  ["--heading-one", "--mm-h1"],
  ["--heading-two", "--mm-h2"],
  ["--heading-three", "--mm-h3"],
  ["--heading-three", "--mm-quote-bg", 0.06],
  ["--muted-foreground", "--mm-muted"],
  ["--border", "--mm-border"],
  ["--code-key", "--mm-key"],
  ["--code-string", "--mm-string"],
  ["--code-number", "--mm-number"],
  ["--code-literal", "--mm-literal"],
];

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const opt = (flag) => {
  const hit = argv.find((a) => a.startsWith(flag + "="));
  return hit ? hit.slice(flag.length + 1) : undefined;
};

function fail(message) {
  console.error("\n  MyMarkdown sync stopped: " + message + "\n");
  process.exit(1);
}

function step(label, detail) {
  console.log("  " + label.padEnd(26, " ") + (detail === undefined ? "" : detail));
}

function read(file, what) {
  if (!fs.existsSync(file)) fail(what + " is missing at " + path.relative(ROOT, file));
  return fs.readFileSync(file, "utf8");
}

/* ---------------- colour conversion (oklch -> hex/rgba) ---------------- */

function oklchToCss(value) {
  const match = value.match(
    /^oklch\(\s*([\d.]+%?)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?)\s*)?\)$/
  );
  if (!match) return null;

  const L = match[1].endsWith("%") ? parseFloat(match[1]) / 100 : parseFloat(match[1]);
  const C = parseFloat(match[2]);
  const H = (parseFloat(match[3]) * Math.PI) / 180;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const linear = [
    4.0767416624 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  const rgb = linear.map((v) => {
    const gamma = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, gamma)) * 255);
  });

  if (match[4] === undefined) {
    return "#" + rgb.map((n) => n.toString(16).padStart(2, "0")).join("");
  }
  const alpha = match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
  return "rgba(" + rgb.join(", ") + ", " + alpha + ")";
}

function toCssColor(value) {
  const trimmed = value.trim();
  if (!/^oklch\(/.test(trimmed)) return trimmed;
  const converted = oklchToCss(trimmed);
  if (!converted) {
    fail('could not convert the colour "' + trimmed + '" — update oklchToCss() in vscode-extension/sync.js');
  }
  return converted;
}

function withAlpha(cssColor, alpha) {
  const hex = cssColor.match(/^#([\da-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return "rgba(" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(", ") + ", " + alpha + ")";
  }
  const rgb = cssColor.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => p.trim());
    return "rgba(" + parts.slice(0, 3).join(", ") + ", " + alpha + ")";
  }
  return cssColor;
}

/* ---------------- 1. the rules ---------------- */

function extractRules(source) {
  const start = source.indexOf(BLOCK_START);
  if (start === -1) {
    fail("cannot find " + BLOCK_START + " in src/routes/index.tsx — the shared rules may have been renamed or moved.");
  }
  const endStart = source.indexOf(BLOCK_END);
  if (endStart === -1) {
    fail("cannot find " + BLOCK_END + " in src/routes/index.tsx — the shared rules may have been renamed or moved.");
  }
  if (endStart < start) {
    fail(BLOCK_END + " now appears before " + BLOCK_START + " — the shared rules are no longer one contiguous block.");
  }

  // A top-level function in this file ends at the first "}" in column 0.
  const openBrace = source.indexOf("{", endStart);
  const closing = openBrace === -1 ? null : source.slice(openBrace).match(/^\}/m);
  if (!closing) fail("cannot find the end of " + BLOCK_END + " in src/routes/index.tsx.");
  const block = source.slice(start, openBrace + closing.index + 1).trim();

  const missing = EXPECTED.filter((name) => !new RegExp("\\b" + name + "\\b").test(block));
  if (missing.length) {
    fail("the shared rules block is incomplete, missing: " + missing.join(", "));
  }
  if (/className=|useState|useMemo|useEffect|React\.|<div|<section/.test(block)) {
    fail("the extracted block contains page code — adjust BLOCK_START / BLOCK_END in vscode-extension/sync.js.");
  }
  return block;
}

function stripTypes(block) {
  let ts;
  try {
    ts = require("typescript");
  } catch (e) {
    fail("the TypeScript compiler is not installed — run `npm install` in the project root first.");
  }
  const out = ts.transpileModule(block, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      removeComments: false,
      newLine: ts.NewLineKind.LineFeed,
    },
  }).outputText;
  const js = out.trim();
  if (!js) fail("stripping the type annotations produced nothing.");
  try {
    // Compiles without running, so a truncated or broken block is caught here.
    new Function(js);
  } catch (e) {
    fail(
      "the extracted rules are not complete JavaScript (" +
        e.message +
        "). Check BLOCK_START / BLOCK_END in vscode-extension/sync.js."
    );
  }
  return js;
}

function indent(text, spaces) {
  return text
    .split("\n")
    .map((line) => (line.trim() ? spaces + line : ""))
    .join("\n");
}

function manualHelpers() {
  const raw = read(MANUAL_FILE, "The extension-only helpers file").trim();
  const names = [...raw.matchAll(/^\s*function\s+(\w+)/gm)].map((m) => m[1]);
  if (!names.length) fail("no helper functions found in vscode-extension/lib/manual-helpers.js.");
  return { code: raw, names };
}

function writeCore(js, manual) {
  const names = EXPECTED.concat(manual.names);
  const file =
    "// Shared MyMarkdown core logic - UMD so it loads in Node (extension host) and the webview.\n" +
    "//\n" +
    "// GENERATED FILE, DO NOT EDIT. Rebuild it from the project root with:\n" +
    "//     npm run extension\n" +
    "//\n" +
    "// The rules below are copied from src/routes/index.tsx; the helpers after them\n" +
    "// come from lib/manual-helpers.js (extension-only, hand-written).\n" +
    "(function (root, factory) {\n" +
    '  if (typeof module === "object" && module.exports) module.exports = factory();\n' +
    "  else root.MyMarkdown = factory();\n" +
    "})(typeof self !== \"undefined\" ? self : this, function () {\n" +
    '  "use strict";\n\n' +
    indent(js, "  ") +
    "\n\n" +
    indent(manual.code, "  ") +
    "\n\n  return {\n" +
    names.map((n) => "    " + n + ",\n").join("") +
    "  };\n});\n";
  fs.writeFileSync(CORE_FILE, file);
  return names;
}

/* ---------------- 2. the colours ---------------- */

function tokensFor(selector, styles) {
  const map = new Map();
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{", "g");
  let match;
  while ((match = re.exec(styles)) !== null) {
    const end = styles.indexOf("}", match.index);
    if (end === -1) break;
    const body = styles.slice(match.index + match[0].length, end);
    for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(decl[1], decl[2].trim());
    re.lastIndex = end;
  }
  if (map.size === 0) fail('no declarations found for "' + selector + '" in src/styles.css.');
  return map;
}

function tokenLines(tokens, indentText, codeBgAlpha) {
  const lines = TOKENS.map(([from, to, alpha]) => {
    const raw = tokens.get(from);
    if (raw === undefined) fail(from + " is missing from src/styles.css but the preview still needs it.");
    const color = toCssColor(raw);
    return indentText + to + ": " + (alpha === undefined ? color : withAlpha(color, alpha)) + ";";
  });
  const fg = toCssColor(tokens.get("--foreground"));
  if (fg === undefined) fail("--foreground is missing from src/styles.css.");
  lines.push(indentText + "--mm-code-bg: " + withAlpha(fg, codeBgAlpha) + ";");
  return lines;
}

function replaceRegion(css, tag, lines) {
  const startMark = "/* MYMARKDOWN:" + tag + ":START */";
  const endMark = "/* MYMARKDOWN:" + tag + ":END */";
  const from = css.indexOf(startMark);
  const to = css.indexOf(endMark);
  if (from === -1 || to === -1 || to < from) {
    fail("the colour markers " + startMark + " / " + endMark + " are missing from media/preview.css.");
  }
  const bodyStart = from + startMark.length;
  return css.slice(0, bodyStart) + "\n" + lines.join("\n") + "\n" + css.slice(to);
}

/* ---------------- 3. checks ---------------- */

function runChecks() {
  const result = spawnSync(process.execPath, [path.join(EXT_DIR, "check.js")], {
    cwd: EXT_DIR,
    encoding: "utf8",
  });
  process.stdout.write(result.stdout || "");
  if (result.status !== 0) {
    fail("the extension checks failed, so nothing was packaged.\n" + (result.stderr || ""));
  }
}

function bundleMermaidPreview() {
  const engine = read(MERMAID_FILE, "The Mermaid engine").trimEnd();
  const preview = read(MERMAID_PREVIEW_FILE, "The Mermaid preview script").trimStart();
  fs.writeFileSync(
    MERMAID_BUNDLE_FILE,
    "// GENERATED by sync.js: Mermaid must load before the preview renderer.\n" +
      engine +
      ";\n" +
      preview,
  );
  step("Mermaid", "engine + renderer bundled in guaranteed order");
}

/* ---------------- 4. version + package ---------------- */

function bumpVersion() {
  const pkg = JSON.parse(read(PKG_FILE, "The extension manifest"));
  const forced = opt("--version");
  if (forced) {
    if (!/^\d+\.\d+\.\d+$/.test(forced)) fail("--version must look like 1.2.3");
    pkg.version = forced;
  } else if (!has("--no-bump")) {
    const parts = pkg.version.split(".").map(Number);
    parts[2] = (parts[2] || 0) + 1;
    pkg.version = parts.join(".");
  }
  fs.writeFileSync(PKG_FILE, JSON.stringify(pkg, null, 2) + "\n");
  return pkg.version;
}

function packageExtension(version) {
  const outFile = "mymarkdown-" + version + ".vsix";
  const result = spawnSync(
    "npx",
    ["--yes", "@vscode/vsce", "package", "--allow-missing-repository", "-o", outFile],
    { cwd: EXT_DIR, encoding: "utf8", stdio: "inherit" }
  );
  if (result.status !== 0) fail("packaging failed — see the output above.");
  return path.join(EXT_DIR, outFile);
}

/* ---------------- main ---------------- */

function main() {
  console.log("\n  MyMarkdown - refresh VS Code extension\n");

  const route = read(ROUTE_FILE, "The website homepage");
  const rules = extractRules(route);
  const js = stripTypes(rules);
  const manual = manualHelpers();
  const names = writeCore(js, manual);
  step("rules", names.length + " functions copied from src/routes/index.tsx");

  const styles = read(STYLES_FILE, "The website stylesheet");
  const light = tokensFor(":root", styles);
  // Keep the extension's light preview neutral even though the website uses a tinted canvas.
  light.set("--background", "oklch(1 0 0)");
  // The website's dark block only redefines some tokens; the rest carry over.
  const dark = new Map([...light, ...tokensFor(".dark", styles)]);
  let css = read(CSS_FILE, "The preview stylesheet");
  css = replaceRegion(css, "TOKENS", tokenLines(light, "  ", 0.045));
  css = replaceRegion(css, "TOKENS-DARK", tokenLines(dark, "    ", 0.05));
  fs.writeFileSync(CSS_FILE, css);
  step("colours", TOKENS.length + " tokens copied from src/styles.css (light + dark)");

  // VS Code marks every contributed preview script as async. Separate files can therefore
  // execute out of order, leaving the renderer unable to see window.mermaid. One file keeps
  // the engine and renderer in deterministic order in VS Code and Cursor.
  bundleMermaidPreview();

  if (has("--skip-check")) {
    step("checks", "skipped");
  } else {
    runChecks();
    step("checks", "passed");
  }

  const version = bumpVersion();
  step("version", version);

  if (has("--skip-pack")) {
    step("install file", "skipped (--skip-pack)");
    console.log("\n  Done. Files refreshed, nothing packaged.\n");
    return;
  }

  const vsix = packageExtension(version);
  step("install file", path.relative(ROOT, vsix));
  console.log("\n  Install it with:  code --install-extension " + path.basename(vsix) + "\n");
}

main();
