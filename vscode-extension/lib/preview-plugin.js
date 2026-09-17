// MyMarkdown's contribution to VS Code's built-in Markdown preview.
//
// VS Code renders Markdown with its own markdown-it; an extension may hand it a
// plugin rather than build a second preview. Everything here is therefore a
// change to how a few token types render, never a Markdown parser of our own.
//
// One constraint shapes the whole file: the preview keeps the editor and the
// preview in step by reading `data-line` off elements carrying `code-line`, and
// for a code block it works out the last line by counting newlines in the
// rendered text. So a rule that renders more lines than the source has must not
// claim to be source-mapped, or scrolling and double-click-to-source land in the
// wrong place. See keepsSourceMapping below.
"use strict";

const MD = require("./mymarkdown.js");

const JSON_LOOKS_LIKE_RE = /^\s*[{[]/;
const JSON_HAS_KEY_RE = /"[^"]+"\s*:/;
const TASK_ITEM_RE = /^\[([ xX])\]\s+/;

function isJson(text) {
  try {
    const parsed = JSON.parse(text);
    return !!parsed && typeof parsed === "object";
  } catch {
    return false;
  }
}

/** A fence we colour: tagged `json`, or untagged but unmistakably JSON. */
function qualifiesAsJson(info, content) {
  if (info === "json") return true;
  if (info) return false;
  return (
    JSON_LOOKS_LIKE_RE.test(content) && JSON_HAS_KEY_RE.test(content) && isJson(content.trim())
  );
}

/** Colour JSON text: field names, strings, numbers and true/false/null. */
function tokenizeJson(text, escapeHtml) {
  const pattern =
    /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[^"]|"/g;
  let out = "";
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const whole = match[0];
    const quoted = match[1];
    const colon = match[2];
    if (quoted) {
      out +=
        '<span class="tok-' + (colon ? "key" : "string") + '">' + escapeHtml(quoted) + "</span>";
      if (colon) out += '<span class="tok-plain">' + escapeHtml(colon) + "</span>";
    } else if (/^-?\d/.test(whole)) {
      out += '<span class="tok-number">' + escapeHtml(whole) + "</span>";
    } else if (whole === "true" || whole === "false" || whole === "null") {
      out += '<span class="tok-literal">' + escapeHtml(whole) + "</span>";
    } else {
      out += '<span class="tok-plain">' + escapeHtml(whole) + "</span>";
    }
  }
  return out;
}

function countLines(text) {
  return text.replace(/\n$/, "").split("\n").length;
}

/**
 * The preview derives a code block's last source line from the newlines in its
 * rendered text, so source mapping is only truthful while the display has as
 * many lines as the source. Laying JSON out one field per line usually adds
 * lines; when it does we drop `code-line` and `data-line`, which makes the
 * preview skip the block instead of letting it claim lines that belong to the
 * content after it. Beautify (or format on save) reflows the file itself, and
 * then the display matches the source again and full mapping comes back.
 */
function codeAttributes(token, escapeHtml, keepsSourceMapping) {
  const attrs = (token.attrs || []).map((pair) => [pair[0], pair[1]]);
  if (!keepsSourceMapping) {
    for (let i = attrs.length - 1; i >= 0; i -= 1) {
      const name = attrs[i][0];
      if (name === "data-line") {
        attrs.splice(i, 1);
      } else if (name === "class") {
        const kept = String(attrs[i][1])
          .split(/\s+/)
          .filter((cls) => cls && cls !== "code-line");
        if (kept.length) attrs[i][1] = kept.join(" ");
        else attrs.splice(i, 1);
      }
    }
  }
  return attrs.map((pair) => " " + pair[0] + '="' + escapeHtml(String(pair[1])) + '"').join("");
}

function renderJsonFence(token, escapeHtml) {
  const content = token.content || "";
  const display = MD.formatJsonDisplay(content);
  const attrs = codeAttributes(token, escapeHtml, countLines(display) === countLines(content));
  return (
    '<pre class="mymd-json"><code' +
    attrs +
    ">" +
    tokenizeJson(display, escapeHtml) +
    "</code></pre>\n"
  );
}

/**
 * The site previews `promoteInlineJsonToFences(markdown)`, so JSON sitting bare
 * in prose reads as a formatted block. Doing that by rewriting the source would
 * renumber every line after it and break the preview's source mapping, so it is
 * done here on the token stream instead, keeping each paragraph's own map.
 */
function promoteJsonParagraphs(state) {
  const tokens = state.tokens;
  const lines = state.src.split("\n");

  for (let i = 0; i < tokens.length; i += 1) {
    const open = tokens[i];
    const inline = tokens[i + 1];
    const close = tokens[i + 2];
    if (open.type !== "paragraph_open" || !inline || inline.type !== "inline") continue;
    if (!close || close.type !== "paragraph_close" || !open.map) continue;

    // Read the source rather than the inline children: this rule runs straight
    // after the block pass, before markdown-it has parsed any inline content.
    const raw = lines.slice(open.map[0], open.map[1]).join("\n").trim();
    let content = null;
    if (JSON_LOOKS_LIKE_RE.test(raw) && isJson(raw)) {
      content = raw;
    } else {
      // A paragraph that is nothing but one inline code span holding JSON.
      const span = /^`+[ \t]*([\s\S]+?)[ \t]*`+$/.exec(raw);
      const candidate = span ? span[1].trim() : "";
      if (candidate && JSON_LOOKS_LIKE_RE.test(candidate) && isJson(candidate)) content = candidate;
    }
    if (content === null) continue;

    const fence = new state.Token("fence", "code", 0);
    fence.info = "json";
    fence.content = content + "\n";
    fence.markup = "```";
    fence.map = [open.map[0], open.map[1]];
    fence.block = true;
    tokens.splice(i, 3, fence);
  }
}

/** GitHub-style task lists, which markdown-it does not implement. */
function renderTaskLists(state) {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i += 1) {
    const inline = tokens[i];
    if (inline.type !== "inline") continue;
    if (tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open")
      continue;
    const match = TASK_ITEM_RE.exec(inline.content);
    if (!match) continue;

    const children = inline.children || [];
    const first = children[0];
    if (!first || first.type !== "text" || !TASK_ITEM_RE.test(first.content)) continue;

    first.content = first.content.replace(TASK_ITEM_RE, "");
    inline.content = inline.content.replace(TASK_ITEM_RE, "");
    const box = new state.Token("html_inline", "", 0);
    box.content =
      '<input class="mymd-task" type="checkbox" disabled' +
      (match[1].toLowerCase() === "x" ? " checked" : "") +
      "> ";
    children.unshift(box);
    tokens[i - 2].attrJoin("class", "mymd-task-item");
  }
}

/**
 * @param {import("markdown-it")} md
 * @returns {import("markdown-it")} the same instance, so VS Code can chain plugins
 */
function mymarkdownPlugin(md) {
  const escapeHtml = (md.utils && md.utils.escapeHtml) || String;

  md.core.ruler.after("block", "mymarkdown_promote_json", promoteJsonParagraphs);
  md.core.ruler.after("inline", "mymarkdown_task_lists", renderTaskLists);

  const originalFence = md.renderer.rules.fence;
  md.renderer.rules.fence = function (tokens, idx, options, env, slf) {
    const token = tokens[idx];
    const info = (token.info || "").trim().split(/\s+/)[0].toLowerCase();
    if (!qualifiesAsJson(info, token.content || "")) {
      return originalFence(tokens, idx, options, env, slf);
    }
    try {
      return renderJsonFence(token, escapeHtml);
    } catch {
      // Never lose the block to a bug in here.
      return originalFence(tokens, idx, options, env, slf);
    }
  };

  const originalCodeInline = md.renderer.rules.code_inline;
  md.renderer.rules.code_inline = function (tokens, idx, options, env, slf) {
    const text = (tokens[idx].content || "").trim();
    if (JSON_LOOKS_LIKE_RE.test(text) && JSON_HAS_KEY_RE.test(text) && isJson(text)) {
      return '<code class="mymd-json-inline">' + tokenizeJson(text, escapeHtml) + "</code>";
    }
    return originalCodeInline(tokens, idx, options, env, slf);
  };

  return md;
}

module.exports = { mymarkdownPlugin, tokenizeJson, qualifiesAsJson, countLines };
