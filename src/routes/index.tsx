import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ClipboardPaste, Code2, Github, ListTree, Loader2, PenLine, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { annotateMarkdown, type AnnotationRange } from "@/lib/ai-annotate.functions";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import "katex/dist/katex.min.css";
import { remarkAlerts } from "@/lib/remark-alerts";
import { remarkMark } from "@/lib/remark-mark";


import heroImage from "@/assets/mymarkdown-logo-v2.webp.asset.json";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const SHARE_IMAGE_URL = "https://mymarkdown.site/__l5e/assets-v1/0b1abd2a-d71b-4761-bbcd-e5504709f41f/mymarkdown-share-v2.webp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MyMarkdown — Markdown Beautifier & Formatter" },
      { name: "description", content: "Paste Markdown and turn it into a polished, readable document with colorful headings, formatted JSON, and instant lint suggestions." },
      { property: "og:title", content: "MyMarkdown — Markdown Beautifier & Formatter" },
      { property: "og:description", content: "Beautiful, readable Markdown with colorful headings, formatted JSON, and instant lint suggestions." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://mymarkdown.site" },
      { property: "og:image", content: SHARE_IMAGE_URL },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "MyMarkdown — Markdown Beautifier & Formatter" },
      { name: "twitter:description", content: "Beautiful, readable Markdown with colorful headings, formatted JSON, and instant lint suggestions." },
      { name: "twitter:image", content: SHARE_IMAGE_URL },
    ],
    links: [{ rel: "canonical", href: "https://mymarkdown.site" }],
  }),
  component: Index,
});

const SAMPLE = `# Release 2.4 — Focus

Quiet by default. The editor steps back so your writing can lead; every control sits one gesture away.

## What changed

- Rewrote the parser to preserve your spacing
- Cut cold-start time by forty percent
- Stable, tokenized syntax for embedded JSON

### Sample payload

\`\`\`json
{"version":2,"channel":"stable","focus":true,"features":["lint","format","preview"]}
\`\`\``;

type LintIssue = {
  kind: "fix" | "warning";
  message: string;
  /** 1-based, like TocHeading.line. */
  line: number;
  /** 1-based. */
  column: number;
  endLine: number;
  endColumn: number;
};
type TocHeading = { id: string; level: 1 | 2 | 3; line: number; title: string };
/** A span of the document the rules below must copy through untouched. */
type MarkdownRegion = {
  kind: "fence" | "frontmatter" | "html" | "code";
  open: number;
  /** null for a fence that is never closed. */
  close: number | null;
  marker: string;
  /** Leading whitespace, plus a list marker when the fence opens on one. */
  indent: string;
  info: string;
};

function slugifyHeading(value: string) {
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
const HTML_BLOCK_TAGS = new Set(
  ("address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl " +
    "dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend " +
    "li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td " +
    "tfoot th thead title tr track ul").split(" ")
);
// Start condition 7: a complete open or closing tag alone on the line.
const HTML_TAG_ATTRS = "(?:\\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s\"'=<>`]+))?)*";
const HTML_OPEN_TAG_RE = new RegExp("^<[A-Za-z][A-Za-z0-9-]*" + HTML_TAG_ATTRS + "\\s*/?>\\s*$");
const HTML_CLOSE_TAG_RE = /^<\/[A-Za-z][A-Za-z0-9-]*\s*>\s*$/;

function isThematicBreak(line: string) {
  return THEMATIC_BREAK_RE.test(line);
}

/** The first word of a fence info string, which is the language. */
function fenceLanguage(info: string) {
  const trimmed = info.trim();
  return trimmed ? (trimmed.split(/\s+/)[0] ?? "").toLowerCase() : "";
}

/** A closing fence is the same character, at least as long, and nothing else. */
function fenceCloses(line: string, char: string, length: number) {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== char) return false;
  for (const ch of trimmed) if (ch !== char) return false;
  return trimmed.length >= length;
}

/**
 * CommonMark HTML block start conditions, approximated a line at a time.
 * Returns the pattern that ends the block, or null when a blank line ends it.
 * Condition 7 cannot interrupt a paragraph; conditions 1-6 can.
 */
function htmlBlockStart(line: string, canInterruptParagraph: boolean): { closeRe: RegExp | null } | null {
  if (!/^ {0,3}</.test(line)) return null;
  const rest = line.replace(/^ {0,3}/, "");
  const raw = /^<(script|pre|style|textarea)(?=[\s>]|$)/i.exec(rest);
  if (raw) return { closeRe: new RegExp("</" + raw[1] + "\\s*>", "i") };
  if (rest.startsWith("<!--")) return { closeRe: /-->/ };
  if (rest.startsWith("<?")) return { closeRe: /\?>/ };
  if (rest.startsWith("<![CDATA[")) return { closeRe: /\]\]>/ };
  if (/^<![A-Za-z]/.test(rest)) return { closeRe: />/ };
  const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/.exec(rest);
  if (tag && HTML_BLOCK_TAGS.has((tag[1] ?? "").toLowerCase())) return { closeRe: null };
  if (canInterruptParagraph && (HTML_OPEN_TAG_RE.test(rest) || HTML_CLOSE_TAG_RE.test(rest))) return { closeRe: null };
  return null;
}

/** Visual width of a line's leading whitespace, counting a tab as four columns. */
function indentWidth(line: string) {
  const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
  let width = 0;
  for (const char of leading) width = char === "\t" ? width + 4 - (width % 4) : width + 1;
  return width;
}

/**
 * The column where the enclosing list item's content starts, or 0 outside a list.
 * Indented code begins four columns past it, and a fence may sit at most three past it.
 */
function listContentColumn(lines: string[], index: number) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    const marker = /^([ \t]*)((?:[-*+]|\d{1,9}[.)]))([ \t]+)/.exec(line);
    if (marker) return indentWidth(marker[1] ?? "") + (marker[2] ?? "").length + (marker[3] ?? "").length;
    if (/^[ \t]/.test(line)) continue; // an indented continuation keeps the search going
    return 0; // a paragraph at column 0 ends any list
  }
  return 0;
}

function scanMarkdownRegions(lines: string[]) {
  const regions: MarkdownRegion[] = [];
  const isProtected: boolean[] = new Array(lines.length).fill(false);
  let i = 0;

  // A document that opens with a `---` thematic break is not front matter: real front
  // matter has its first key on the very next line.
  if (lines.length && FRONT_MATTER_OPEN_RE.test(lines[0] ?? "") && (lines[1] ?? "").trim() !== "") {
    for (let j = 1; j < lines.length; j += 1) {
      if (!FRONT_MATTER_CLOSE_RE.test(lines[j] ?? "")) continue;
      regions.push({ kind: "frontmatter", open: 0, close: j, marker: "---", indent: "", info: "" });
      for (let k = 0; k <= j; k += 1) isProtected[k] = true;
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
      while (
        close + 1 < lines.length &&
        (indentWidth(lines[close + 1] ?? "") >= contentColumn + 4 || (lines[close + 1] ?? "").trim() === "")
      ) {
        close += 1;
      }
      while (close > i && (lines[close] ?? "").trim() === "") close -= 1;
      regions.push({ kind: "code", open: i, close, marker: "", indent: "", info: "" });
      for (let j = i; j <= close; j += 1) isProtected[j] = true;
      i = close + 1;
      continue;
    }

    const fence = FENCE_OPEN_RE.exec(line);
    const marker = fence?.[2] ?? "";
    const info = (fence?.[3] ?? "").replace(/\s+$/, "");
    // A backtick fence's info string may not itself contain a backtick.
    if (fence && !codeIndented && !(marker.startsWith("`") && info.includes("`"))) {
      const region: MarkdownRegion = { kind: "fence", open: i, close: null, marker, indent: fence[1] ?? "", info };
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
      } else {
        close = i;
        while (close + 1 < lines.length && (lines[close + 1] ?? "").trim() !== "") close += 1;
      }
      regions.push({ kind: "html", open: i, close, marker: "<", indent: "", info: "" });
      for (let j = i; j <= close; j += 1) isProtected[j] = true;
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

/** A double reliably round-trips a decimal literal of at most this many significant digits. */
const JSON_SAFE_SIGNIFICANT_DIGITS = 15;

/** True when one JSON number literal means the same thing after a parse/stringify round trip. */
function jsonNumberRoundTrips(literal: string) {
  const value = Number(literal);
  if (!Number.isFinite(value) || Object.is(value, -0)) return false;

  const mantissa = literal.replace(/^[+-]/, "").split(/[eE]/)[0] ?? "";
  // An integer is exact up to 2^53, and Number.isSafeInteger says so precisely.
  if (!/[.eE]/.test(literal)) return Number.isSafeInteger(value);
  // Anything else that has collapsed to zero has underflowed, e.g. 1e-400.
  if (value === 0) return !/[1-9]/.test(mantissa);
  const digits = mantissa.replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
  return digits.length <= JSON_SAFE_SIGNIFICANT_DIGITS;
}

/**
 * True when every number in the text survives JSON.parse -> JSON.stringify unchanged.
 * Reformatting goes through a double, so without this guard an id past 2^53 is silently
 * rounded, `-0` loses its sign, `1e400` becomes `null`, `1e-400` becomes `0` and a
 * decimal carrying more digits than a double can hold comes back a different number.
 */
function jsonNumbersRoundTrip(text: string) {
  const pattern = new RegExp(JSON_NUMBER_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const literal = match[1];
    if (literal === undefined) continue;
    if (!jsonNumberRoundTrips(literal)) return false;
  }
  return true;
}

/** Pretty-printed JSON, or null when the text is not JSON or would not survive reformatting. */
function parseJsonObject(text: string) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Pretty-printed JSON, or null when the text is not JSON or would not survive reformatting. */
function prettyJson(text: string) {
  // Parse first: the guard is a full regex scan, and this runs per keystroke on the site.
  const parsed = parseJsonObject(text);
  if (parsed === null || !jsonNumbersRoundTrip(text)) return null;
  return JSON.stringify(parsed, null, 2);
}

/* ---------------------------------------------------------------------------
 * The rules
 * ------------------------------------------------------------------------ */

function getTocHeadings(source: string): TocHeading[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const { isProtected } = scanMarkdownRegions(lines);
  const headings: TocHeading[] = [];
  const slugCounts = new Map<string, number>();

  lines.forEach((line, index) => {
    if (isProtected[index]) return;
    const match = line.match(TOC_HEADING_RE);
    if (!match) return;
    const title = (match[2] ?? "").trim();
    const baseSlug = slugifyHeading(title);
    const occurrence = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, occurrence + 1);
    headings.push({
      id: occurrence ? `${baseSlug}-${occurrence + 1}` : baseSlug,
      level: (match[1]?.length ?? 1) as 1 | 2 | 3,
      line: index + 1,
      title,
    });
  });

  return headings;
}

function promoteRawJsonToFences(source: string) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const { isProtected } = scanMarkdownRegions(lines);
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!isProtected[i] && /^\s*[\{\[]/.test(line)) {
      // Accumulate lines until the JSON candidate parses or we run out. Blank lines
      // are included on purpose, so a pretty-printed value with a blank line in it
      // is still recognised as one block.
      let buffer = "";
      let matchedEnd = -1;
      let pretty: string | null = null;
      for (let j = i; j < lines.length; j += 1) {
        if (isProtected[j]) break;
        buffer += (buffer ? "\n" : "") + (lines[j] ?? "");
        const trimmed = buffer.trim();
        if (!/[\}\]]\s*$/.test(trimmed)) continue;
        if (parseJsonObject(trimmed) === null) continue;
        matchedEnd = j;
        pretty = prettyJson(trimmed);
      }
      if (matchedEnd >= 0) {
        if (output.length && output.at(-1) !== "") output.push("");
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

function promoteInlineJsonToFences(source: string) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const { isProtected } = scanMarkdownRegions(lines);
  const withInline = lines
    .map((line, index) => {
      if (isProtected[index]) return line;
      return line.replace(/`([^`\n]+)`/g, (match: string, content: string) => {
        const trimmed = content.trim();
        if (!/^[\{\[]/.test(trimmed) || !/"[^"]+"\s*:/.test(trimmed)) return match;
        try {
          JSON.parse(trimmed);
          return `\n\n\`\`\`json\n${trimmed}\n\`\`\`\n\n`;
        } catch {
          return match;
        }
      });
    })
    .join("\n");
  return promoteRawJsonToFences(withInline);
}

/** `*` and `+` bullets become `-`, keeping the indentation that carries list nesting. */
function normalizeBullet(line: string) {
  if (isThematicBreak(line)) return line;
  const replaced = line.replace(BULLET_RE, "$1- ");
  // `* - -` must not turn into `- - -`, which is a thematic break, not a list item.
  return isThematicBreak(replaced) ? line : replaced;
}

/** Trailing whitespace goes, except the two spaces that make a hard line break. */
function normalizeTrailingWhitespace(line: string) {
  const match = /[ \t]+$/.exec(line);
  if (!match) return line;
  const body = line.slice(0, match.index);
  if (body === "") return "";
  const whitespace = match[0];
  return !whitespace.includes("\t") && whitespace.length >= 2 ? body + "  " : body;
}

function formatMarkdown(source: string) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  // Leading blank lines go before the scan, so front matter is recognised on
  // every pass and running Beautify twice cannot produce a different document.
  while (lines.length && (lines[0] ?? "").trim() === "") lines.shift();

  const { regions } = scanMarkdownRegions(lines);
  const regionAt = new Map(regions.map((region) => [region.open, region]));
  const output: string[] = [];
  const blankLine = () => {
    if (output.length && output.at(-1) !== "") output.push("");
  };

  let i = 0;
  while (i < lines.length) {
    const region = regionAt.get(i);

    // Front matter, HTML blocks and indented code are copied through verbatim.
    if (region && region.kind !== "fence") {
      const close = region.close ?? lines.length - 1;
      for (let j = i; j <= close; j += 1) output.push(lines[j] ?? "");
      i = close + 1;
      continue;
    }

    if (region) {
      // Only at column 0: inserting one inside a list item would make the list loose.
      if (!region.indent) blankLine();
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
      for (const bodyLine of content) output.push(bodyLine);
      if (region.close !== null) output.push((lines[region.close] ?? "").replace(/[ \t]+$/, ""));
      i = end + 1;
      continue;
    }

    const line = lines[i] ?? "";
    if (line.trim() === "") {
      blankLine();
      i += 1;
      continue;
    }
    if (ATX_HEADING_RE.test(line) && !/^[ \t]/.test(line)) blankLine();
    output.push(normalizeTrailingWhitespace(normalizeBullet(line)));
    i += 1;
  }

  while (output.length && output.at(-1) === "") output.pop();
  return output.join("\n");
}

function lintMarkdown(source: string): LintIssue[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const { regions, isProtected } = scanMarkdownRegions(lines);
  const issues: LintIssue[] = [];
  const wholeLine = (index: number) => ({
    line: index + 1,
    column: 1,
    endLine: index + 1,
    endColumn: (lines[index] ?? "").length + 1,
  });

  let previousLevel = 0;
  lines.forEach((line, index) => {
    if (isProtected[index]) return;
    const heading = ATX_HEADING_RE.exec(line);
    if (!heading) return;
    const level = (heading[1] ?? "").length;
    if (previousLevel && level > previousLevel + 1) {
      issues.push({ kind: "warning", message: `Heading level jumps to H${level}`, ...wholeLine(index) });
    }
    previousLevel = level;
  });

  for (const region of regions) {
    if (region.kind !== "fence") continue;
    if (region.close === null) {
      issues.push({ kind: "warning", message: "Unclosed code fence", ...wholeLine(region.open) });
      continue;
    }
    if (fenceLanguage(region.info) !== "json") continue;
    const body = lines.slice(region.open + 1, region.close);
    if (!body.join("\n").trim()) continue;
    try {
      JSON.parse(body.join("\n"));
    } catch {
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
    if (isProtected[index]) return;
    const bullet = BULLET_RE.exec(line);
    if (!bullet) return;
    if (isThematicBreak(line) || isThematicBreak(line.replace(BULLET_RE, "$1- "))) return;
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

function expandEscapedNewlines(value: string) {
  return /\\n/.test(value) ? value.replace(/\\n/g, "\n") : value;
}

/**
 * Split on a `\n` escape only. Walking the line two characters at a time past
 * every backslash escape means `\\n` — an escaped backslash followed by the
 * letter n, as in a Windows path — is left alone.
 */
function splitOnNewlineEscape(line: string) {
  const parts: string[] = [];
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
    } else {
      current += char + next;
    }
    i += 2;
  }
  parts.push(current);
  return parts;
}

function expandEscapedNewlinesInStrings(pretty: string) {
  // Turn literal \n inside JSON string values into real line breaks, keeping the
  // indentation of the line the string started on.
  return pretty
    .split("\n")
    .flatMap((line) => {
      const parts = splitOnNewlineEscape(line);
      if (parts.length === 1) return [line];
      const indent = (line.match(/^\s*/)?.[0] ?? "") + "  ";
      return [parts[0] ?? "", ...parts.slice(1).map((part) => indent + part)];
    })
    .join("\n");
}

function JsonCode({ value }: { value: string }) {
  let displayedValue = value;
  try {
    displayedValue = expandEscapedNewlinesInStrings(JSON.stringify(JSON.parse(value), null, 2));
  } catch {
    const expanded = expandEscapedNewlines(value);
    try {
      displayedValue = expandEscapedNewlinesInStrings(JSON.stringify(JSON.parse(expanded), null, 2));
    } catch {
      // Not parseable even after expanding \n escapes — show it with real line breaks.
      displayedValue = expanded;
    }
  }

  const tokens: { text: string; type: "key" | "string" | "number" | "literal" | "plain" }[] = [];
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?|\b(?:true|false|null)\b|[^"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(displayedValue)) !== null) {
    const [text, quoted, colon] = match;
    if (quoted) {
      tokens.push({ text: quoted, type: colon ? "key" : "string" });
      if (colon) tokens.push({ text: colon, type: "plain" });
    } else if (/^-?\d/.test(text)) {
      tokens.push({ text, type: "number" });
    } else if (/^(true|false|null)$/.test(text)) {
      tokens.push({ text, type: "literal" });
    } else {
      tokens.push({ text, type: "plain" });
    }
  }

  return (
    <>
      {tokens.map((token, index) => {
        const className = {
          key: "text-code-key font-medium",
          string: "text-code-string",
          number: "text-code-number",
          literal: "text-code-literal",
          plain: "text-foreground/55",
        }[token.type];
        return <span className={className} key={`${index}-${token.text.slice(0, 24)}`}>{token.text}</span>;
      })}
    </>
  );
}

function TruncatedLabel({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setIsTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return <span ref={ref} className={className} title={isTruncated ? text : undefined}>{text}</span>;
}

/** Source lines a rendered block covers, so AI labels can be drawn beside it. */
type MdNode = { position?: { start?: { line?: number }; end?: { line?: number } } | undefined };
function lineAttrs(node?: MdNode) {
  const start = node?.position?.start?.line;
  const end = node?.position?.end?.line;
  if (typeof start !== "number") return {};
  return { "data-line": start, "data-end-line": typeof end === "number" ? end : start };
}

type GutterBar = { key: string; label: string; color: string; top: number; height: number; hasNext: boolean };


function Index() {
  const [markdown, setMarkdown] = useState(SAMPLE);
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [tocOpen, setTocOpen] = useState(true);
  const previewMarkdown = useMemo(() => promoteInlineJsonToFences(markdown), [markdown]);
  const headings = useMemo(() => getTocHeadings(previewMarkdown), [previewMarkdown]);
  const firstH1Id = useMemo(() => headings.find((heading) => heading.level === 1)?.id, [headings]);
  const [activeHeading, setActiveHeading] = useState(headings[0]?.id ?? "");
  const issues = useMemo(() => lintMarkdown(markdown), [markdown]);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiRanges, setAiRanges] = useState<AnnotationRange[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [bars, setBars] = useState<GutterBar[]>([]);
  const articleRef = useRef<HTMLDivElement>(null);
  const runAnnotate = useServerFn(annotateMarkdown);

  // Line numbers stop matching the moment the document changes.
  useEffect(() => {
    setAiRanges([]);
    setAiError("");
  }, [previewMarkdown]);

  const findSections = async () => {
    if (!aiPrompt.trim() || aiLoading) return;
    setMode("preview");
    setAiLoading(true);
    setAiError("");
    try {
      const result = await runAnnotate({ data: { markdown: previewMarkdown, prompt: aiPrompt } });
      setAiRanges(result.ranges);
      if (result.error) setAiError(result.error);
      else if (!result.ranges.length) setAiError("Nothing in this document matched.");
      else setMode("preview");
    } catch {
      setAiError("The AI could not answer just now. Try again.");
    } finally {
      setAiLoading(false);
    }
  };

  const clearAnnotations = () => {
    setAiRanges([]);
    setAiError("");
  };

  /** Map source-line ownership proportionally into rendered blocks. */
  const measureBars = useCallback(() => {
    const container = articleRef.current;
    if (!container || !aiRanges.length) {
      setBars([]);
      return;
    }
    const blocks = Array.from(container.querySelectorAll<HTMLElement>("[data-line]"));
    const base = container.getBoundingClientRect().top;
    const next: GutterBar[] = [];
    const lastIndexByLabel = new Map<string, number>();
    aiRanges.forEach((range, index) => lastIndexByLabel.set(range.label.toLowerCase(), index));
    aiRanges.forEach((range, index) => {
      let top = Infinity;
      let bottom = -Infinity;
      for (const block of blocks) {
        const start = Number(block.dataset["line"]);
        const end = Number(block.dataset["endLine"] ?? block.dataset["line"]);
        if (!Number.isFinite(start)) continue;
        if (end < range.startLine || start > range.endLine) continue;
        const box = block.getBoundingClientRect();
        const lineSpan = Math.max(1, end - start + 1);
        const ownedStart = Math.max(start, range.startLine);
        const ownedEnd = Math.min(end, range.endLine);
        const blockTop = box.top - base;
        const sliceTop = blockTop + ((ownedStart - start) / lineSpan) * box.height;
        const sliceBottom = blockTop + ((ownedEnd - start + 1) / lineSpan) * box.height;
        top = Math.min(top, sliceTop);
        bottom = Math.max(bottom, sliceBottom);
      }
      if (top === Infinity) return;
      next.push({
        key: `${index}-${range.label}-${range.startLine}`,
        label: range.label,
        color: range.color,
        top,
        height: Math.max(4, bottom - top),
        hasNext: lastIndexByLabel.get(range.label.toLowerCase()) !== index,
      });
    });
    setBars(next);
  }, [aiRanges]);

  useLayoutEffect(() => {
    if (mode !== "preview") {
      setBars([]);
      return;
    }
    measureBars();
    const container = articleRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => measureBars());
    observer.observe(container);
    window.addEventListener("resize", measureBars);
    const timer = window.setTimeout(measureBars, 300);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureBars);
      window.clearTimeout(timer);
    };
  }, [measureBars, mode, previewMarkdown]);

  const scrollToLabel = (label: string) => {
    const bar = bars.find((item) => item.label === label);
    const container = articleRef.current;
    if (!bar || !container) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: window.scrollY + container.getBoundingClientRect().top + bar.top - 90,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  const scrollToNextMatch = (barKey: string, label: string) => {
    const currentIndex = bars.findIndex((item) => item.key === barKey);
    const next = bars.slice(currentIndex + 1).find((item) => item.label.toLowerCase() === label.toLowerCase());
    const container = articleRef.current;
    if (!next || !container) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: window.scrollY + container.getBoundingClientRect().top + next.top - 90,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };


  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 150);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const startBlankDocument = () => {
    setMarkdown("");
    setMode("edit");
    window.setTimeout(() => editorRef.current?.focus(), 0);
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      setMarkdown(text);
      setMode("preview");
    } catch {
      // Clipboard permission denied — keep the current document untouched.
    }
  };

  useEffect(() => {
    setActiveHeading((current) => headings.some((heading) => heading.id === current) ? current : (headings[0]?.id ?? ""));
  }, [headings]);

  useEffect(() => {
    if (mode !== "preview" || !headings.length) return;

    const updateActiveHeading = () => {
      const visibleHeadings = headings
        .map((heading) => ({ id: heading.id, element: document.getElementById(heading.id) }))
        .filter((item): item is { id: string; element: HTMLElement } => Boolean(item.element));
      const current = [...visibleHeadings].reverse().find(({ element }) => element.getBoundingClientRect().top <= 150);
      setActiveHeading(current?.id ?? visibleHeadings[0]?.id ?? "");
    };

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    return () => window.removeEventListener("scroll", updateActiveHeading);
  }, [headings, mode]);

  const scrollToHeading = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    setActiveHeading(id);
  };

  return (
    <main className="relative min-h-screen overflow-x-clip bg-background px-5 pb-16 pt-8 text-foreground sm:px-8 sm:pt-10">
      <div className="pointer-events-none fixed -right-32 -top-32 size-[34rem] rounded-full bg-primary/15 blur-[130px]" />
      <div className="pointer-events-none fixed -bottom-40 -left-32 size-[30rem] rounded-full bg-heading-two/12 blur-[130px]" />

      <div className="relative mx-auto max-w-6xl">
        <nav className="mb-6 flex items-center justify-between gap-1 text-sm">
          <Link to="/vscode-extension" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Code2 className="size-4" />VS Code extension
          </Link>
          <div className="flex items-center gap-1">
            <a href="https://github.com/ardeeshany/mymarkdown" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Github className="size-4" />GitHub
            </a>
            <ThemeToggle />
          </div>
        </nav>

        <header className="flex flex-col items-center text-center">
          <img src={heroImage.url} alt="MyMarkdown documents transforming into a polished page" className="mb-4 size-32 object-contain sm:size-40" draggable={false} />
          <h1 className="font-display text-4xl font-bold tracking-tight leading-tight sm:text-5xl">
            Markdown that reads beautifully
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Free and open source. Paste any Markdown and get a polished document in seconds — vivid headings, beautifully formatted JSON, and lint-clean structure.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Button type="button" size="lg" onClick={pasteFromClipboard} className="h-11 rounded-full bg-primary px-7 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90" title="Paste Markdown from your clipboard and preview it">
              <ClipboardPaste />Paste Markdown
            </Button>
            <Button type="button" size="lg" variant="outline" onClick={startBlankDocument} className="h-11 rounded-full border-border bg-card px-7 text-sm font-medium hover:bg-muted" title="Start an empty document and paste it in yourself">
              <PenLine />Write it yourself
            </Button>
          </div>
        </header>

        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0">
            <section className="frosted-surface overflow-hidden rounded-2xl ring-1 ring-card/80">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b border-border/70 bg-glass px-3 py-2.5 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex items-center rounded-lg bg-background/55 p-0.5 ring-1 ring-border/70" aria-label="Document mode">
                    {(["edit", "preview"] as const).map((item) => <Button key={item} type="button" size="sm" variant={mode === item ? "secondary" : "ghost"} onClick={() => setMode(item)} className={`h-7 rounded-md px-2.5 text-xs capitalize ${mode === item ? "bg-foreground text-background hover:bg-foreground/90" : "text-muted-foreground"}`}>{item}</Button>)}
                  </div>
                </div>
                <form onSubmit={(event) => { event.preventDefault(); void findSections(); }} className="ml-auto flex w-full max-w-sm min-w-0 items-center rounded-full border border-border/70 bg-background/55 p-1 pl-3 focus-within:ring-2 focus-within:ring-primary/15">
                  <Wand2 className="mr-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <input value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} aria-label="Ask the AI to label parts of this document" placeholder="Find in document…" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
                  <Button type="submit" size="sm" disabled={aiLoading || !aiPrompt.trim()} className="h-7 rounded-full px-3 text-xs">{aiLoading ? <Loader2 className="size-3.5 animate-spin" /> : null}Find</Button>
                </form>
              </div>
              {aiError && <p className="border-b border-border/60 px-4 py-1.5 text-right text-xs text-muted-foreground">{aiError}</p>}

              {mode === "edit" ? (
                <textarea ref={editorRef} aria-label="Markdown editor" value={markdown} onChange={(event) => setMarkdown(event.target.value)} spellCheck="false" className="min-h-[590px] w-full resize-y bg-transparent px-6 py-8 font-mono text-[13px] leading-7 outline-none placeholder:text-muted-foreground sm:px-9 sm:py-10" placeholder="# Paste your Markdown here…" />
              ) : (
                <article ref={articleRef} className="relative min-h-[590px] px-6 py-8 sm:px-9 sm:py-10">
                  {aiRanges.length > 0 && (
                    <div className="mb-5 flex flex-wrap items-center justify-end gap-1.5">
                      {Array.from(aiRanges.reduce((map, range) => {
                        const entry = map.get(range.label);
                        map.set(range.label, { color: range.color, count: (entry?.count ?? 0) + 1 });
                        return map;
                      }, new Map<string, { color: string; count: number }>())).map(([label, meta]) => (
                        <Button key={label} type="button" size="sm" variant="outline" onClick={() => scrollToLabel(label)} className="h-6 rounded-full px-2 text-[10px] font-medium" style={{ borderColor: `${meta.color}55`, color: meta.color, backgroundColor: `${meta.color}12` }}>
                          {label} <span className="opacity-60">· {meta.count}</span>
                        </Button>
                      ))}
                      <Button type="button" size="icon" variant="ghost" onClick={clearAnnotations} className="size-6 rounded-full text-muted-foreground" title="Clear labels" aria-label="Clear labels"><X className="size-3.5" /></Button>
                    </div>
                  )}
                  {aiLoading && (
                    <div className="preview-scan pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-label="Analyzing document">
                      <div className="preview-scan-line absolute inset-x-0 h-24" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-y-0 right-2 hidden w-1 sm:block">
                    {bars.map((bar) => (
                      <div key={bar.key} className="group absolute right-0 w-1" style={{ top: bar.top, height: bar.height, backgroundColor: bar.color }} title={bar.label}>
                        <span className="absolute bottom-full right-0 z-10 mb-1 whitespace-nowrap rounded bg-popover/90 px-1.5 py-0.5 text-[10px] font-medium leading-none shadow-sm ring-1 ring-border/70 backdrop-blur-sm" style={{ color: bar.color }}>{bar.label}</span>
                        {bar.hasNext && <Button type="button" size="icon" variant="ghost" onClick={() => scrollToNextMatch(bar.key, bar.label)} className="pointer-events-auto absolute left-1/2 top-full z-10 mt-1 size-5 -translate-x-1/2 rounded-full bg-popover text-muted-foreground shadow-sm ring-1 ring-border/70 hover:text-foreground" title={`Next ${bar.label} match`} aria-label={`Go to next ${bar.label} match`}><ArrowDown className="size-3" /></Button>}
                      </div>
                    ))}
                  </div>
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkAlerts, remarkMark]} rehypePlugins={[rehypeKatex]} components={{
                    div: ({ children, ...props }) => {
                      const bag = props as Record<string, unknown> & { node?: { properties?: Record<string, unknown> } };
                      const alert = (bag["data-alert"] ?? bag["dataAlert"] ?? bag.node?.properties?.["dataAlert"] ?? bag.node?.properties?.["data-alert"]) as string | undefined;
                      if (!alert) return <div>{children}</div>;
                      const tone: Record<string, string> = {
                        note: "border-primary/60 bg-primary/5",
                        tip: "border-heading-two/60 bg-heading-two/5",
                        important: "border-heading-three/60 bg-heading-three/5",
                        warning: "border-amber-500/60 bg-amber-500/5",
                        caution: "border-destructive/60 bg-destructive/5",
                      };
                      const label: Record<string, string> = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };
                      return (
                        <div className={`mt-5 max-w-[62ch] rounded-xl border-l-4 px-4 py-3 ${tone[alert] ?? tone["note"]}`}>
                          <p className="text-xs font-semibold uppercase tracking-wide text-foreground/70">{label[alert] ?? alert}</p>
                          <div className="[&>p]:mt-1.5">{children}</div>
                        </div>
                      );
                    },
                    mark: ({ children }) => <mark className="rounded bg-amber-300/50 px-1 py-0.5 text-foreground dark:bg-amber-400/30">{children}</mark>,
                    h1: ({ children, node }) => {
                      const id = headings.find((heading) => heading.line === node?.position?.start.line)?.id;
                      const isFirstH1 = id === firstH1Id;
                      return <h1 id={id} {...lineAttrs(node)} className={`scroll-mt-8 font-display text-4xl font-semibold leading-tight text-heading-one sm:text-5xl ${isFirstH1 ? "" : "pt-10"}`}>{children}</h1>;
                    },
                    h2: ({ children, node }) => <h2 id={headings.find((heading) => heading.line === node?.position?.start.line)?.id} {...lineAttrs(node)} className="scroll-mt-8 mt-9 font-display text-2xl font-semibold leading-tight text-heading-two">{children}</h2>,
                    h3: ({ children, node }) => <h3 id={headings.find((heading) => heading.line === node?.position?.start.line)?.id} {...lineAttrs(node)} className="scroll-mt-8 mt-8 font-display text-xl font-semibold leading-tight text-heading-three">{children}</h3>,
                    h4: ({ children, node }) => <h4 {...lineAttrs(node)} className="mt-7 font-display text-lg font-semibold text-foreground">{children}</h4>,
                    p: ({ children, node }) => <p {...lineAttrs(node)} className="mt-4 max-w-[62ch] text-[15px] leading-7 text-foreground/80">{children}</p>,
                    ul: ({ children, node }) => <ul {...lineAttrs(node)} className="mt-4 max-w-[62ch] list-disc space-y-2 pl-5 text-[15px] leading-7 marker:text-heading-two">{children}</ul>,
                    ol: ({ children, node }) => <ol {...lineAttrs(node)} className="mt-4 max-w-[62ch] list-decimal space-y-2 pl-5 text-[15px] leading-7 marker:font-medium marker:text-heading-one">{children}</ol>,
                    blockquote: ({ children, node }) => <blockquote {...lineAttrs(node)} className="mt-5 border-l-2 border-heading-three bg-heading-three/5 px-4 py-1 italic text-foreground/75">{children}</blockquote>,
                    a: ({ children, href }) => <a className="font-medium text-primary underline decoration-primary/30 underline-offset-4" href={href} target="_blank" rel="noreferrer">{children}</a>,
                    table: ({ children, node }) => <div {...lineAttrs(node)} className="mt-5 overflow-x-auto"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
                    th: ({ children }) => <th className="border-b border-border px-3 py-2 font-semibold text-heading-two">{children}</th>,
                    td: ({ children }) => <td className="border-b border-border/70 px-3 py-2 text-foreground/80">{children}</td>,
                    pre: ({ children, node }) => {
                      const child = (Array.isArray(children) ? children[0] : children) as { props?: { className?: string; children?: unknown } } | undefined;
                      if (child?.props?.className?.includes("language-mermaid")) {
                        return <MermaidDiagram value={String(child.props.children).replace(/\n$/, "")} />;
                      }
                      return <pre {...lineAttrs(node)} className="mt-4 overflow-x-hidden whitespace-pre-wrap break-words rounded-xl bg-foreground/[0.04] p-5 font-mono text-[13px] leading-6 ring-1 ring-border/70">{children}</pre>;
                    },
                    code: ({ className, children }) => {
                      const value = String(children).replace(/\n$/, "");
                      const language = /language-(\w+)/.exec(className ?? "")?.[1];
                      const isFenced = Boolean(className);
                      const looksLikeJson = !isFenced && /"[^"]+"\s*:/.test(value);
                      const isJson = language === "json" || looksLikeJson;
                      if (!isFenced && !isJson) return <code className="rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[0.88em] text-code-inline">{children}</code>;
                      if (!isFenced && isJson) return <code className="font-mono text-[0.88em]"><JsonCode value={value} /></code>;
                      return <code className="bg-transparent">{isJson ? <JsonCode value={value} /> : expandEscapedNewlines(value)}</code>;
                    },
                  }}>{previewMarkdown || "*Your preview will appear here.*"}</ReactMarkdown>
                </article>
              )}
            </section>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-glass px-4 py-2.5 text-xs ring-1 ring-card/80 backdrop-blur-md">
              <span className="text-muted-foreground">{markdown.length.toLocaleString()} characters · {markdown.trim() ? markdown.trim().split(/\s+/).length : 0} words</span>
              <span className={`flex items-center gap-1.5 font-medium ${issues.length ? "text-code-inline" : "text-heading-two"}`}><span className={`size-1.5 rounded-full ${issues.length ? "bg-code-inline" : "bg-heading-two"}`} />{issues.length ? `${issues.length} ${issues.length === 1 ? "suggestion" : "suggestions"}: ${issues[0]?.message}` : "Structure looks good"}</span>
            </div>
          </div>

          <aside className="sticky top-2 z-10 order-first max-h-[min(15rem,45vh)] overflow-y-auto rounded-xl bg-glass ring-1 ring-card/80 backdrop-blur-md lg:order-none lg:top-6 lg:max-h-[calc(100vh-3rem)]" aria-label="Table of contents">
            <div className="flex h-11 items-center justify-between px-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><ListTree className="size-4 text-primary" />Contents</div>
              <Button type="button" size="icon" variant="ghost" className="size-8 text-muted-foreground" onClick={() => setTocOpen((open) => !open)} aria-expanded={tocOpen} aria-label={tocOpen ? "Collapse table of contents" : "Open table of contents"} title={tocOpen ? "Collapse table of contents" : "Open table of contents"}>
                {tocOpen ? <ChevronUp /> : <ChevronDown />}
              </Button>
            </div>
            {tocOpen && (
              <nav className="border-t border-border/70 px-2 py-2" aria-label="Document headings">
                {headings.length ? (() => {
                  let h1Count = 0;
                  return headings.map((heading) => {
                    if (heading.level === 1) h1Count += 1;
                    return (
                      <Button key={`${heading.line}-${heading.id}`} type="button" variant="ghost" onClick={() => scrollToHeading(heading.id)} className={`mb-0.5 h-auto w-full justify-start whitespace-nowrap rounded-md py-2 text-left text-xs leading-5 ${heading.level === 2 ? "pl-5" : heading.level === 3 ? "pl-8" : "pl-2.5"} ${activeHeading === heading.id ? "bg-primary/10 font-semibold text-primary hover:bg-primary/15" : "text-muted-foreground"}`} aria-current={activeHeading === heading.id ? "location" : undefined}>
                        {heading.level === 1 && <span className="mr-1.5 shrink-0 font-semibold text-primary">{h1Count}.</span>}
                        <TruncatedLabel text={heading.title} className="block overflow-hidden text-ellipsis whitespace-nowrap" />
                      </Button>
                    );
                  });
                })() : <p className="px-2.5 py-3 text-xs text-muted-foreground">Add H1, H2, or H3 headings to see them here.</p>}
              </nav>
            )}
          </aside>
        </div>
      </div>

        <footer className="mt-8 text-center text-xs text-muted-foreground">
          Have an idea or found a bug?{" "}
          <a href="https://github.com/ardeeshany/mymarkdown/issues/new" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
            Open an issue on GitHub
          </a>
        </footer>

      {showScrollTop && (
        <Button type="button" size="icon" variant="secondary" onClick={scrollToTop} aria-label="Scroll back to top" title="Back to top" className="fixed bottom-6 left-6 z-20 size-10 rounded-full bg-glass shadow-lg ring-1 ring-border/70 backdrop-blur-md hover:bg-glass">
          <ArrowUp />
        </Button>
      )}
    </main>
  );
}
