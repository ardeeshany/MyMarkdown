// Markdown -> HTML renderer for the MyMarkdown preview webview.
// UMD: usable from Node (for tests) and the browser webview.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./mymarkdown.js"));
  } else {
    root.MyMarkdownRender = factory(root.MyMarkdown);
  }
})(typeof self !== "undefined" ? self : this, function (MD) {
  "use strict";

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tokenizeJson(displayedValue) {
    let out = "";
    const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?|\b(?:true|false|null)\b|[^"]/g;
    let match;
    while ((match = pattern.exec(displayedValue)) !== null) {
      const text = match[0];
      const quoted = match[1];
      const colon = match[2];
      if (quoted) {
        out += '<span class="' + (colon ? "tok-key" : "tok-string") + '">' + escapeHtml(quoted) + "</span>";
        if (colon) out += '<span class="tok-plain">' + escapeHtml(colon) + "</span>";
      } else if (/^-?\d/.test(text)) {
        out += '<span class="tok-number">' + escapeHtml(text) + "</span>";
      } else if (/^(true|false|null)$/.test(text)) {
        out += '<span class="tok-literal">' + escapeHtml(text) + "</span>";
      } else {
        out += '<span class="tok-plain">' + escapeHtml(text) + "</span>";
      }
    }
    return out;
  }

  function renderInline(text) {
    let out = escapeHtml(text);
    const stash = [];

    // Inline code first so its contents are not further formatted.
    out = out.replace(/`([^`\n]+)`/g, function (_m, code) {
      const isJson = /^\s*[\{\[]/.test(code) && /&quot;[^&]+&quot;\s*:/.test(code);
      let html;
      try {
        const decoded = code
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
        JSON.parse(decoded);
        html = isJson
          ? '<code class="inline-code json">' + tokenizeJson(MD.formatJsonDisplay(decoded)) + "</code>"
          : '<code class="inline-code">' + code + "</code>";
      } catch (e) {
        html = '<code class="inline-code">' + code + "</code>";
      }
      stash.push(html);
      return "" + (stash.length - 1) + "";
    });

    out = out
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2" />')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>");

    out = out.replace(/(\d+)/g, function (_m, i) {
      return stash[Number(i)];
    });
    return out;
  }

  function renderFencedBlock(language, content) {
    const isJson = language === "json";
    if (isJson) {
      return (
        '<pre class="code-block"><code>' + tokenizeJson(MD.formatJsonDisplay(content)) + "</code></pre>"
      );
    }
    return (
      '<pre class="code-block"><code>' +
      escapeHtml(MD.expandEscapedNewlines(content.replace(/\n$/, ""))) +
      "</code></pre>"
    );
  }

  function renderTable(lines) {
    const rows = lines.map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim())
    );
    const isDivider = (row) => row.every((cell) => /^:?-{3,}:?$/.test(cell));
    let html = '<div class="table-wrap"><table>';
    rows.forEach((row, index) => {
      if (isDivider(row)) return;
      const tag = index === 0 ? "th" : "td";
      html += "<tr>" + row.map((cell) => "<" + tag + ">" + renderInline(cell) + "</" + tag + ">").join("") + "</tr>";
    });
    return html + "</table></div>";
  }

  function renderList(lines, ordered) {
    const tag = ordered ? "ol" : "ul";
    let html = "<" + tag + ">";
    for (const line of lines) {
      const itemMatch = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
      if (!itemMatch) continue;
      let content = itemMatch[1];
      const task = content.match(/^\[( |x|X)\]\s+(.*)$/);
      if (task) {
        const checked = task[1].toLowerCase() === "x";
        html +=
          '<li class="task"><input type="checkbox" disabled' +
          (checked ? " checked" : "") +
          " /> " +
          renderInline(task[2]) +
          "</li>";
      } else {
        html += "<li>" + renderInline(content) + "</li>";
      }
    }
    return html + "</" + tag + ">";
  }

  function renderMarkdown(source) {
    const headings = MD.getTocHeadings(source);
    const headingByLine = new Map(headings.map((h) => [h.line, h]));
    const firstH1 = headings.find((h) => h.level === 1);

    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      out.push("<p>" + paragraph.map(renderInline).join("<br />") + "</p>");
      paragraph = [];
    };

    while (i < lines.length) {
      const line = lines[i];
      const lineNo = i + 1;

      const fence = line.trim().match(/^```([\w-]*)/);
      if (fence) {
        flushParagraph();
        const language = (fence[1] || "").toLowerCase();
        const buffer = [];
        i += 1;
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          buffer.push(lines[i]);
          i += 1;
        }
        i += 1; // skip closing fence (or EOF)
        out.push(renderFencedBlock(language, buffer.join("\n")));
        continue;
      }

      const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        flushParagraph();
        const level = heading[1].length;
        const info = headingByLine.get(lineNo);
        const idAttr = info ? ' id="' + info.id + '"' : "";
        const cls = level === 1 && info && firstH1 && info.id === firstH1.id ? "h1 first" : "h" + level;
        out.push("<h" + level + ' class="' + cls + '"' + idAttr + ">" + renderInline(heading[2]) + "</h" + level + ">");
        i += 1;
        continue;
      }

      if (/^\s*$/.test(line)) {
        flushParagraph();
        i += 1;
        continue;
      }

      if (/^\s*>/.test(line)) {
        flushParagraph();
        const quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ""));
          i += 1;
        }
        out.push("<blockquote>" + quote.map(renderInline).join("<br />") + "</blockquote>");
        continue;
      }

      if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
        flushParagraph();
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const items = [];
        while (i < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i])) {
          items.push(lines[i]);
          i += 1;
        }
        out.push(renderList(items, ordered));
        continue;
      }

      if (/^\s*\|.*\|\s*$/.test(line)) {
        flushParagraph();
        const tableLines = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          tableLines.push(lines[i]);
          i += 1;
        }
        out.push(renderTable(tableLines));
        continue;
      }

      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushParagraph();
        out.push("<hr />");
        i += 1;
        continue;
      }

      paragraph.push(line);
      i += 1;
    }
    flushParagraph();
    return out.join("\n");
  }

  return { renderMarkdown, tokenizeJson, escapeHtml };
});
