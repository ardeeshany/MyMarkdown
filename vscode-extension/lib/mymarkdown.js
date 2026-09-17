// Shared MyMarkdown core logic - UMD so it loads in Node (extension host) and the webview.
//
// GENERATED FILE, DO NOT EDIT. Rebuild it from the project root with:
//     npm run extension
//
// The rules below are copied from src/routes/index.tsx; the helpers after them
// come from lib/manual-helpers.js (extension-only, hand-written).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MyMarkdown = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function slugifyHeading(value) {
      return value
          .toLowerCase()
          .replace(/[`*_~[\]()]/g, "")
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/g, "") || "section";
  }
  /* ---------------------------------------------------------------------------
   * Region scanning.
   *
   * Every rule below has parts of a document it must not touch: fenced code,
   * YAML front matter, HTML blocks and indented code blocks. Finding them once,
   * up front, is what stops Beautify rewriting a bullet inside a shell snippet
   * or dedenting a YAML sequence, and stops the linter reporting a `# comment`
   * in a bash block as a heading.
   * ------------------------------------------------------------------------ */
  // A fence may open on a list-marker line (`- ```js`); the marker is kept as indentation.
  const FENCE_OPEN_RE = /^(\s*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?)(`{3,}|~{3,})(.*)$/;
  const THEMATIC_BREAK_RE = /^\s{0,3}([*_-])(\s*\1){2,}\s*$/;
  const FRONT_MATTER_OPEN_RE = /^---\s*$/;
  const FRONT_MATTER_CLOSE_RE = /^(?:---|\.\.\.)\s*$/;
  // CommonMark allows up to three spaces of indentation before an ATX heading.
  const ATX_HEADING_RE = /^ {0,3}(#{1,6})(?:\s|$)/;
  const TOC_HEADING_RE = /^ {0,3}(#{1,3})\s+(.+?)\s*#*\s*$/;
  const BULLET_RE = /^(\s*)[*+]\s+/;
  // CommonMark HTML block start condition 6.
  const HTML_BLOCK_TAGS = new Set(("address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl " +
      "dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend " +
      "li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td " +
      "tfoot th thead title tr track ul").split(" "));
  // Start condition 7: a complete open or closing tag alone on the line.
  const HTML_TAG_ATTRS = "(?:\\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s\"'=<>`]+))?)*";
  const HTML_OPEN_TAG_RE = new RegExp("^<[A-Za-z][A-Za-z0-9-]*" + HTML_TAG_ATTRS + "\\s*/?>\\s*$");
  const HTML_CLOSE_TAG_RE = /^<\/[A-Za-z][A-Za-z0-9-]*\s*>\s*$/;
  function isThematicBreak(line) {
      return THEMATIC_BREAK_RE.test(line);
  }
  /** The first word of a fence info string, which is the language. */
  function fenceLanguage(info) {
      const trimmed = info.trim();
      return trimmed ? (trimmed.split(/\s+/)[0] ?? "").toLowerCase() : "";
  }
  /** A closing fence is the same character, at least as long, and nothing else. */
  function fenceCloses(line, char, length) {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== char)
          return false;
      for (const ch of trimmed)
          if (ch !== char)
              return false;
      return trimmed.length >= length;
  }
  /**
   * CommonMark HTML block start conditions, approximated a line at a time.
   * Returns the pattern that ends the block, or null when a blank line ends it.
   * Condition 7 cannot interrupt a paragraph; conditions 1-6 can.
   */
  function htmlBlockStart(line, canInterruptParagraph) {
      if (!/^ {0,3}</.test(line))
          return null;
      const rest = line.replace(/^ {0,3}/, "");
      const raw = /^<(script|pre|style|textarea)(?=[\s>]|$)/i.exec(rest);
      if (raw)
          return { closeRe: new RegExp("</" + raw[1] + "\\s*>", "i") };
      if (rest.startsWith("<!--"))
          return { closeRe: /-->/ };
      if (rest.startsWith("<?"))
          return { closeRe: /\?>/ };
      if (rest.startsWith("<![CDATA["))
          return { closeRe: /\]\]>/ };
      if (/^<![A-Za-z]/.test(rest))
          return { closeRe: />/ };
      const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/.exec(rest);
      if (tag && HTML_BLOCK_TAGS.has((tag[1] ?? "").toLowerCase()))
          return { closeRe: null };
      if (canInterruptParagraph && (HTML_OPEN_TAG_RE.test(rest) || HTML_CLOSE_TAG_RE.test(rest)))
          return { closeRe: null };
      return null;
  }
  /** Visual width of a line's leading whitespace, counting a tab as four columns. */
  function indentWidth(line) {
      const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
      let width = 0;
      for (const char of leading)
          width = char === "\t" ? width + 4 - (width % 4) : width + 1;
      return width;
  }
  /**
   * The column where the enclosing list item's content starts, or 0 outside a list.
   * Indented code begins four columns past it, and a fence may sit at most three past it.
   */
  function listContentColumn(lines, index) {
      for (let i = index - 1; i >= 0; i -= 1) {
          const line = lines[i] ?? "";
          if (line.trim() === "")
              continue;
          const marker = /^([ \t]*)((?:[-*+]|\d{1,9}[.)]))([ \t]+)/.exec(line);
          if (marker)
              return indentWidth(marker[1] ?? "") + (marker[2] ?? "").length + (marker[3] ?? "").length;
          if (/^[ \t]/.test(line))
              continue; // an indented continuation keeps the search going
          return 0; // a paragraph at column 0 ends any list
      }
      return 0;
  }
  function scanMarkdownRegions(lines) {
      const regions = [];
      const isProtected = new Array(lines.length).fill(false);
      let i = 0;
      // A document that opens with a `---` thematic break is not front matter: real front
      // matter has its first key on the very next line.
      if (lines.length && FRONT_MATTER_OPEN_RE.test(lines[0] ?? "") && (lines[1] ?? "").trim() !== "") {
          for (let j = 1; j < lines.length; j += 1) {
              if (!FRONT_MATTER_CLOSE_RE.test(lines[j] ?? ""))
                  continue;
              regions.push({ kind: "frontmatter", open: 0, close: j, marker: "---", indent: "", info: "" });
              for (let k = 0; k <= j; k += 1)
                  isProtected[k] = true;
              i = j + 1;
              break;
          }
      }
      while (i < lines.length) {
          const line = lines[i] ?? "";
          const afterBlankLine = i === 0 || (lines[i - 1] ?? "").trim() === "" || isProtected[i - 1] === true;
          const contentColumn = listContentColumn(lines, i);
          const codeIndented = indentWidth(line) >= contentColumn + 4;
          // Indented code first: four columns past the list content column is code, even when
          // the line looks like a fence.
          if (afterBlankLine && line.trim() !== "" && codeIndented) {
              let close = i;
              while (close + 1 < lines.length &&
                  (indentWidth(lines[close + 1] ?? "") >= contentColumn + 4 || (lines[close + 1] ?? "").trim() === "")) {
                  close += 1;
              }
              while (close > i && (lines[close] ?? "").trim() === "")
                  close -= 1;
              regions.push({ kind: "code", open: i, close, marker: "", indent: "", info: "" });
              for (let j = i; j <= close; j += 1)
                  isProtected[j] = true;
              i = close + 1;
              continue;
          }
          const fence = FENCE_OPEN_RE.exec(line);
          const marker = fence?.[2] ?? "";
          const info = (fence?.[3] ?? "").replace(/\s+$/, "");
          // A backtick fence's info string may not itself contain a backtick.
          if (fence && !codeIndented && !(marker.startsWith("`") && info.includes("`"))) {
              const region = { kind: "fence", open: i, close: null, marker, indent: fence[1] ?? "", info };
              isProtected[i] = true;
              for (let j = i + 1; j < lines.length; j += 1) {
                  isProtected[j] = true;
                  if (fenceCloses(lines[j] ?? "", marker[0] ?? "", marker.length)) {
                      region.close = j;
                      break;
                  }
              }
              regions.push(region);
              i = region.close === null ? lines.length : region.close + 1;
              continue;
          }
          const html = htmlBlockStart(line, afterBlankLine);
          if (html) {
              let close = lines.length - 1;
              if (html.closeRe) {
                  for (let j = i; j < lines.length; j += 1) {
                      if (html.closeRe.test(lines[j] ?? "")) {
                          close = j;
                          break;
                      }
                  }
              }
              else {
                  close = i;
                  while (close + 1 < lines.length && (lines[close + 1] ?? "").trim() !== "")
                      close += 1;
              }
              regions.push({ kind: "html", open: i, close, marker: "<", indent: "", info: "" });
              for (let j = i; j <= close; j += 1)
                  isProtected[j] = true;
              i = close + 1;
              continue;
          }
          i += 1;
      }
      return { regions, isProtected };
  }
  /* ---------------------------------------------------------------------------
   * JSON
   * ------------------------------------------------------------------------ */
  // Matches a string (so its contents are skipped) or captures a number literal.
  const JSON_NUMBER_RE = /"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  /**
   * True when every number in the text survives JSON.parse -> JSON.stringify unchanged.
   * Reformatting goes through a double, so without this guard an id past 2^53 is
   * silently rounded, `-0` loses its sign and `1e400` becomes `null`.
   */
  function jsonNumbersRoundTrip(text) {
      const pattern = new RegExp(JSON_NUMBER_RE.source, "g");
      let match;
      while ((match = pattern.exec(text)) !== null) {
          const literal = match[1];
          if (literal === undefined)
              continue;
          const value = Number(literal);
          if (!Number.isFinite(value) || Object.is(value, -0))
              return false;
          if (!/[.eE]/.test(literal) && !Number.isSafeInteger(value))
              return false;
      }
      return true;
  }
  /** Pretty-printed JSON, or null when the text is not JSON or would not survive reformatting. */
  function parseJsonObject(text) {
      try {
          const parsed = JSON.parse(text);
          return parsed && typeof parsed === "object" ? parsed : null;
      }
      catch {
          return null;
      }
  }
  /** Pretty-printed JSON, or null when the text is not JSON or would not survive reformatting. */
  function prettyJson(text) {
      // Parse first: the guard is a full regex scan, and this runs per keystroke on the site.
      const parsed = parseJsonObject(text);
      if (parsed === null || !jsonNumbersRoundTrip(text))
          return null;
      return JSON.stringify(parsed, null, 2);
  }
  /* ---------------------------------------------------------------------------
   * The rules
   * ------------------------------------------------------------------------ */
  function getTocHeadings(source) {
      const lines = source.replace(/\r\n?/g, "\n").split("\n");
      const { isProtected } = scanMarkdownRegions(lines);
      const headings = [];
      const slugCounts = new Map();
      lines.forEach((line, index) => {
          if (isProtected[index])
              return;
          const match = line.match(TOC_HEADING_RE);
          if (!match)
              return;
          const title = (match[2] ?? "").trim();
          const baseSlug = slugifyHeading(title);
          const occurrence = slugCounts.get(baseSlug) ?? 0;
          slugCounts.set(baseSlug, occurrence + 1);
          headings.push({
              id: occurrence ? `${baseSlug}-${occurrence + 1}` : baseSlug,
              level: (match[1]?.length ?? 1),
              line: index + 1,
              title,
          });
      });
      return headings;
  }
  function promoteRawJsonToFences(source) {
      const lines = source.replace(/\r\n?/g, "\n").split("\n");
      const { isProtected } = scanMarkdownRegions(lines);
      const output = [];
      let i = 0;
      while (i < lines.length) {
          const line = lines[i] ?? "";
          if (!isProtected[i] && /^\s*[\{\[]/.test(line)) {
              // Accumulate lines until the JSON candidate parses or we run out. Blank lines
              // are included on purpose, so a pretty-printed value with a blank line in it
              // is still recognised as one block.
              let buffer = "";
              let matchedEnd = -1;
              let pretty = null;
              for (let j = i; j < lines.length; j += 1) {
                  if (isProtected[j])
                      break;
                  buffer += (buffer ? "\n" : "") + (lines[j] ?? "");
                  const trimmed = buffer.trim();
                  if (!/[\}\]]\s*$/.test(trimmed))
                      continue;
                  if (parseJsonObject(trimmed) === null)
                      continue;
                  matchedEnd = j;
                  pretty = prettyJson(trimmed);
              }
              if (matchedEnd >= 0) {
                  if (output.length && output.at(-1) !== "")
                      output.push("");
                  // When the numbers would not survive reformatting, fence the original lines:
                  // it is still JSON, and leaving it as prose lets Markdown eat its punctuation.
                  const body = pretty !== null ? pretty.split("\n") : lines.slice(i, matchedEnd + 1);
                  output.push("```json", ...body, "```", "");
                  i = matchedEnd + 1;
                  continue;
              }
          }
          output.push(line);
          i += 1;
      }
      return output.join("\n");
  }
  function promoteInlineJsonToFences(source) {
      const lines = source.replace(/\r\n?/g, "\n").split("\n");
      const { isProtected } = scanMarkdownRegions(lines);
      const withInline = lines
          .map((line, index) => {
          if (isProtected[index])
              return line;
          return line.replace(/`([^`\n]+)`/g, (match, content) => {
              const trimmed = content.trim();
              if (!/^[\{\[]/.test(trimmed) || !/"[^"]+"\s*:/.test(trimmed))
                  return match;
              try {
                  JSON.parse(trimmed);
                  return `\n\n\`\`\`json\n${trimmed}\n\`\`\`\n\n`;
              }
              catch {
                  return match;
              }
          });
      })
          .join("\n");
      return promoteRawJsonToFences(withInline);
  }
  /** `*` and `+` bullets become `-`, keeping the indentation that carries list nesting. */
  function normalizeBullet(line) {
      if (isThematicBreak(line))
          return line;
      const replaced = line.replace(BULLET_RE, "$1- ");
      // `* - -` must not turn into `- - -`, which is a thematic break, not a list item.
      return isThematicBreak(replaced) ? line : replaced;
  }
  /** Trailing whitespace goes, except the two spaces that make a hard line break. */
  function normalizeTrailingWhitespace(line) {
      const match = /[ \t]+$/.exec(line);
      if (!match)
          return line;
      const body = line.slice(0, match.index);
      if (body === "")
          return "";
      const whitespace = match[0];
      return !whitespace.includes("\t") && whitespace.length >= 2 ? body + "  " : body;
  }
  function formatMarkdown(source) {
      const lines = source.replace(/\r\n?/g, "\n").split("\n");
      // Leading blank lines go before the scan, so front matter is recognised on
      // every pass and running Beautify twice cannot produce a different document.
      while (lines.length && (lines[0] ?? "").trim() === "")
          lines.shift();
      const { regions } = scanMarkdownRegions(lines);
      const regionAt = new Map(regions.map((region) => [region.open, region]));
      const output = [];
      const blankLine = () => {
          if (output.length && output.at(-1) !== "")
              output.push("");
      };
      let i = 0;
      while (i < lines.length) {
          const region = regionAt.get(i);
          // Front matter, HTML blocks and indented code are copied through verbatim.
          if (region && region.kind !== "fence") {
              const close = region.close ?? lines.length - 1;
              for (let j = i; j <= close; j += 1)
                  output.push(lines[j] ?? "");
              i = close + 1;
              continue;
          }
          if (region) {
              // Only at column 0: inserting one inside a list item would make the list loose.
              if (!region.indent)
                  blankLine();
              const language = fenceLanguage(region.info);
              const at = language ? region.info.toLowerCase().indexOf(language) : -1;
              const info = at === -1 ? region.info : region.info.slice(0, at) + language + region.info.slice(at + language.length);
              output.push(region.indent + region.marker + info);
              const end = region.close === null ? lines.length : region.close;
              let content = lines.slice(i + 1, end);
              if (region.close !== null && language === "json") {
                  const pretty = prettyJson(content.join("\n"));
                  if (pretty !== null) {
                      // A list marker in the indentation becomes plain spaces for the body.
                      const pad = region.indent.replace(/\S/g, " ");
                      content = pretty.split("\n").map((bodyLine) => pad + bodyLine);
                  }
              }
              for (const bodyLine of content)
                  output.push(bodyLine);
              if (region.close !== null)
                  output.push((lines[region.close] ?? "").replace(/[ \t]+$/, ""));
              i = end + 1;
              continue;
          }
          const line = lines[i] ?? "";
          if (line.trim() === "") {
              blankLine();
              i += 1;
              continue;
          }
          if (ATX_HEADING_RE.test(line) && !/^[ \t]/.test(line))
              blankLine();
          output.push(normalizeTrailingWhitespace(normalizeBullet(line)));
          i += 1;
      }
      while (output.length && output.at(-1) === "")
          output.pop();
      return output.join("\n");
  }
  function lintMarkdown(source) {
      const lines = source.replace(/\r\n?/g, "\n").split("\n");
      const { regions, isProtected } = scanMarkdownRegions(lines);
      const issues = [];
      const wholeLine = (index) => ({
          line: index + 1,
          column: 1,
          endLine: index + 1,
          endColumn: (lines[index] ?? "").length + 1,
      });
      let previousLevel = 0;
      lines.forEach((line, index) => {
          if (isProtected[index])
              return;
          const heading = ATX_HEADING_RE.exec(line);
          if (!heading)
              return;
          const level = (heading[1] ?? "").length;
          if (previousLevel && level > previousLevel + 1) {
              issues.push({ kind: "warning", message: `Heading level jumps to H${level}`, ...wholeLine(index) });
          }
          previousLevel = level;
      });
      for (const region of regions) {
          if (region.kind !== "fence")
              continue;
          if (region.close === null) {
              issues.push({ kind: "warning", message: "Unclosed code fence", ...wholeLine(region.open) });
              continue;
          }
          if (fenceLanguage(region.info) !== "json")
              continue;
          const body = lines.slice(region.open + 1, region.close);
          if (!body.join("\n").trim())
              continue;
          try {
              JSON.parse(body.join("\n"));
          }
          catch {
              issues.push({
                  kind: "warning",
                  message: "JSON block needs a syntax fix",
                  line: region.open + 2,
                  column: 1,
                  endLine: region.close,
                  endColumn: (lines[region.close - 1] ?? "").length + 1,
              });
          }
      }
      lines.forEach((line, index) => {
          if (isProtected[index])
              return;
          const bullet = BULLET_RE.exec(line);
          if (!bullet)
              return;
          if (isThematicBreak(line) || isThematicBreak(line.replace(BULLET_RE, "$1- ")))
              return;
          const column = (bullet[1] ?? "").length + 1;
          issues.push({
              kind: "fix",
              message: "Mixed bullets can be normalized",
              line: index + 1,
              column,
              endLine: index + 1,
              endColumn: column + 1,
          });
      });
      return issues.sort((a, b) => a.line - b.line || a.column - b.column);
  }
  function expandEscapedNewlines(value) {
      return /\\n/.test(value) ? value.replace(/\\n/g, "\n") : value;
  }
  /**
   * Split on a `\n` escape only. Walking the line two characters at a time past
   * every backslash escape means `\\n` — an escaped backslash followed by the
   * letter n, as in a Windows path — is left alone.
   */
  function splitOnNewlineEscape(line) {
      const parts = [];
      let current = "";
      let i = 0;
      while (i < line.length) {
          const char = line[i] ?? "";
          if (char !== "\\") {
              current += char;
              i += 1;
              continue;
          }
          const next = line[i + 1] ?? "";
          if (next === "n") {
              parts.push(current);
              current = "";
          }
          else {
              current += char + next;
          }
          i += 2;
      }
      parts.push(current);
      return parts;
  }
  function expandEscapedNewlinesInStrings(pretty) {
      // Turn literal \n inside JSON string values into real line breaks, keeping the
      // indentation of the line the string started on.
      return pretty
          .split("\n")
          .flatMap((line) => {
          const parts = splitOnNewlineEscape(line);
          if (parts.length === 1)
              return [line];
          const indent = (line.match(/^\s*/)?.[0] ?? "") + "  ";
          return [parts[0] ?? "", ...parts.slice(1).map((part) => indent + part)];
      })
          .join("\n");
  }

  // Extension-only helpers, kept hand-written and inlined verbatim into
  // lib/mymarkdown.js by sync.js. Anything here is NOT taken from the website.
  // Add a function below and it is exported automatically (names are detected
  // from `function name(` at the start of a line).

  function formatJsonDisplay(value) {
    try {
      return expandEscapedNewlinesInStrings(JSON.stringify(JSON.parse(value), null, 2));
    } catch (e) {
      const expanded = expandEscapedNewlines(value);
      try {
        return expandEscapedNewlinesInStrings(JSON.stringify(JSON.parse(expanded), null, 2));
      } catch (e2) {
        return expanded;
      }
    }
  }

  function minimalEdit(oldText, newText) {
    // The smallest single replacement that turns oldText into newText, so Beautify
    // is one small edit instead of a whole-document rewrite: the cursor, the
    // selection and the scroll position all survive.
    if (oldText === newText) return null;
    const max = Math.min(oldText.length, newText.length);
    let start = 0;
    while (start < max && oldText[start] === newText[start]) start += 1;
    let tail = 0;
    while (
      tail < max - start &&
      oldText[oldText.length - 1 - tail] === newText[newText.length - 1 - tail]
    ) {
      tail += 1;
    }
    return { start, end: oldText.length - tail, text: newText.slice(start, newText.length - tail) };
  }

  return {
    slugifyHeading,
    getTocHeadings,
    promoteRawJsonToFences,
    promoteInlineJsonToFences,
    formatMarkdown,
    lintMarkdown,
    expandEscapedNewlines,
    expandEscapedNewlinesInStrings,
    formatJsonDisplay,
    minimalEdit,
  };
});
