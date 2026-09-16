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
  function getTocHeadings(source) {
      const headings = [];
      const slugCounts = new Map();
      let inFence = false;
      source.replace(/\r\n/g, "\n").split("\n").forEach((line, index) => {
          if (/^\s*```/.test(line)) {
              inFence = !inFence;
              return;
          }
          if (inFence)
              return;
          const match = line.match(/^\s*(#{1,3})\s+(.+?)\s*#*\s*$/);
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
      const lines = source.replace(/\r\n/g, "\n").split("\n");
      const output = [];
      let inFence = false;
      let i = 0;
      while (i < lines.length) {
          const line = lines[i] ?? "";
          if (/^\s*```/.test(line)) {
              inFence = !inFence;
              output.push(line);
              i += 1;
              continue;
          }
          if (!inFence && /^\s*[\{\[]/.test(line)) {
              // Accumulate lines until the JSON candidate parses or we run out.
              let buffer = "";
              let matchedEnd = -1;
              for (let j = i; j < lines.length; j += 1) {
                  const candidate = lines[j] ?? "";
                  if (/^\s*```/.test(candidate))
                      break;
                  buffer += (buffer ? "\n" : "") + candidate;
                  const trimmed = buffer.trim();
                  if (!/[\}\]]\s*$/.test(trimmed))
                      continue;
                  try {
                      const parsed = JSON.parse(trimmed);
                      if (parsed && typeof parsed === "object")
                          matchedEnd = j;
                  }
                  catch {
                      /* keep scanning */
                  }
              }
              if (matchedEnd >= 0) {
                  const raw = lines.slice(i, matchedEnd + 1).join("\n").trim();
                  const pretty = JSON.stringify(JSON.parse(raw), null, 2);
                  if (output.length && output.at(-1) !== "")
                      output.push("");
                  output.push("```json", ...pretty.split("\n"), "```", "");
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
      const withInline = source.replace(/`([^`\n]+)`/g, (match, content) => {
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
      return promoteRawJsonToFences(withInline);
  }
  function formatMarkdown(source) {
      const lines = source.replace(/\r\n/g, "\n").split("\n");
      const output = [];
      let inFence = false;
      let language = "";
      let fenceBuffer = [];
      const add = (line) => {
          if (/^(#{1,6})\s/.test(line) && output.length && output.at(-1) !== "")
              output.push("");
          output.push(line.replace(/^\s*[-*+]\s+/, "- ").replace(/[ \t]+$/, ""));
      };
      for (const raw of lines) {
          const fence = raw.trim().match(/^```([\w-]*)/);
          if (fence && !inFence) {
              inFence = true;
              language = fence[1]?.toLowerCase() ?? "";
              fenceBuffer = [];
              if (output.length && output.at(-1) !== "")
                  output.push("");
              output.push(`\`\`\`${language}`);
          }
          else if (fence && inFence) {
              let content = fenceBuffer.join("\n").trim();
              if (language === "json") {
                  try {
                      content = JSON.stringify(JSON.parse(content), null, 2);
                  }
                  catch { /* preserve invalid JSON */ }
              }
              if (content)
                  output.push(...content.split("\n"));
              output.push("```");
              inFence = false;
          }
          else if (inFence) {
              fenceBuffer.push(raw);
          }
          else {
              add(raw);
          }
      }
      if (inFence)
          output.push(...fenceBuffer, "```");
      return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function lintMarkdown(source) {
      const issues = [];
      const headings = [...source.matchAll(/^(#{1,6})\s+/gm)].map((match) => match[1]?.length ?? 1);
      headings.forEach((level, index) => {
          if (index > 0 && level > (headings[index - 1] ?? 0) + 1)
              issues.push({ kind: "warning", message: `Heading level jumps to H${level}` });
      });
      const fences = source.match(/^```/gm)?.length ?? 0;
      if (fences % 2)
          issues.push({ kind: "warning", message: "Unclosed code fence" });
      for (const match of source.matchAll(/```json\s*\n([\s\S]*?)```/gi)) {
          try {
              JSON.parse(match[1] ?? "");
          }
          catch {
              issues.push({ kind: "warning", message: "JSON block needs a syntax fix" });
          }
      }
      if (/^\s*[*+]\s+/m.test(source))
          issues.push({ kind: "fix", message: "Mixed bullets can be normalized" });
      return issues;
  }
  function expandEscapedNewlines(value) {
      return /\\n/.test(value) ? value.replace(/\\n/g, "\n") : value;
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
  };
});
