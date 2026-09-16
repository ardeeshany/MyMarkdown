// Shared MyMarkdown core logic — UMD so it loads in Node (extension host) and the webview.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MyMarkdown = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function slugifyHeading(value) {
    return (
      value
        .toLowerCase()
        .replace(/[`*_~[\]()]/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "") || "section"
    );
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
      if (inFence) return;
      const match = line.match(/^\s*(#{1,3})\s+(.+?)\s*#*\s*$/);
      if (!match) return;
      const title = (match[2] || "").trim();
      const baseSlug = slugifyHeading(title);
      const occurrence = slugCounts.get(baseSlug) || 0;
      slugCounts.set(baseSlug, occurrence + 1);
      headings.push({
        id: occurrence ? baseSlug + "-" + (occurrence + 1) : baseSlug,
        level: match[1].length,
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
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        output.push(line);
        i += 1;
        continue;
      }
      if (!inFence && /^\s*[\{\[]/.test(line)) {
        let buffer = "";
        let matchedEnd = -1;
        for (let j = i; j < lines.length; j += 1) {
          const candidate = lines[j];
          if (/^\s*```/.test(candidate)) break;
          buffer += (buffer ? "\n" : "") + candidate;
          const trimmed = buffer.trim();
          if (!/[\}\]]\s*$/.test(trimmed)) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === "object") matchedEnd = j;
          } catch (e) {
            /* keep scanning */
          }
        }
        if (matchedEnd >= 0) {
          const raw = lines.slice(i, matchedEnd + 1).join("\n").trim();
          const pretty = JSON.stringify(JSON.parse(raw), null, 2);
          if (output.length && output[output.length - 1] !== "") output.push("");
          output.push("```json");
          output.push.apply(output, pretty.split("\n"));
          output.push("```", "");
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
    const withInline = source.replace(/`([^`\n]+)`/g, function (match, content) {
      const trimmed = content.trim();
      if (!/^[\{\[]/.test(trimmed) || !/"[^"]+"\s*:/.test(trimmed)) return match;
      try {
        JSON.parse(trimmed);
        return "\n\n```json\n" + trimmed + "\n```\n\n";
      } catch (e) {
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
      if (/^(#{1,6})\s/.test(line) && output.length && output[output.length - 1] !== "") output.push("");
      output.push(line.replace(/^\s*[-*+]\s+/, "- ").replace(/[ \t]+$/, ""));
    };

    for (const raw of lines) {
      const fence = raw.trim().match(/^```([\w-]*)/);
      if (fence && !inFence) {
        inFence = true;
        language = (fence[1] || "").toLowerCase();
        fenceBuffer = [];
        if (output.length && output[output.length - 1] !== "") output.push("");
        output.push("```" + language);
      } else if (fence && inFence) {
        let content = fenceBuffer.join("\n").trim();
        if (language === "json") {
          try {
            content = JSON.stringify(JSON.parse(content), null, 2);
          } catch (e) {
            /* preserve invalid JSON */
          }
        }
        if (content) output.push.apply(output, content.split("\n"));
        output.push("```");
        inFence = false;
      } else if (inFence) {
        fenceBuffer.push(raw);
      } else {
        add(raw);
      }
    }
    if (inFence) output.push.apply(output, fenceBuffer.concat(["```"]));
    return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function lintMarkdown(source) {
    const issues = [];
    const headings = [];
    const headingRe = /^(#{1,6})\s+/gm;
    let m;
    while ((m = headingRe.exec(source)) !== null) headings.push(m[1].length);
    headings.forEach((level, index) => {
      if (index > 0 && level > headings[index - 1] + 1) {
        issues.push({ kind: "warning", message: "Heading level jumps to H" + level });
      }
    });
    const fences = (source.match(/^```/gm) || []).length;
    if (fences % 2) issues.push({ kind: "warning", message: "Unclosed code fence" });
    const jsonRe = /```json\s*\n([\s\S]*?)```/gi;
    while ((m = jsonRe.exec(source)) !== null) {
      try {
        JSON.parse(m[1]);
      } catch (e) {
        issues.push({ kind: "warning", message: "JSON block needs a syntax fix" });
      }
    }
    if (/^\s*[*+]\s+/m.test(source)) issues.push({ kind: "fix", message: "Mixed bullets can be normalized" });
    return issues;
  }

  function expandEscapedNewlines(value) {
    return /\\n/.test(value) ? value.replace(/\\n/g, "\n") : value;
  }

  function expandEscapedNewlinesInStrings(pretty) {
    return pretty
      .split("\n")
      .flatMap((line) => {
        if (!/\\n/.test(line)) return [line];
        const indent = (line.match(/^\s*/) || [""])[0] + "  ";
        const parts = line.split(/\\n/);
        const head = parts.shift();
        return [head].concat(parts.map((part) => indent + part));
      })
      .join("\n");
  }

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
