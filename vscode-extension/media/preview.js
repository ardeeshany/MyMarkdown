/* MyMarkdown preview webview script. */
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const docEl = document.getElementById("mm-doc");
  const lintEl = document.getElementById("mm-lint");
  const statsEl = document.getElementById("mm-stats");
  const tocEl = document.getElementById("mm-toc");
  const tocListEl = document.getElementById("mm-toc-list");
  const tocToggleEl = document.getElementById("mm-toc-toggle");

  let headingEls = [];
  let activeId = "";

  tocToggleEl.addEventListener("click", () => {
    const open = tocEl.classList.toggle("collapsed") === false;
    tocToggleEl.setAttribute("aria-expanded", String(open));
  });

  // Click any block in the preview to jump to that line in the Markdown editor.
  docEl.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    const selection = window.getSelection();
    if (selection && String(selection).trim().length) return;
    const block = event.target.closest("[data-line]");
    if (!block) return;
    const line = parseInt(block.getAttribute("data-line"), 10);
    if (!line) return;
    block.classList.remove("mm-jumped");
    void block.offsetWidth;
    block.classList.add("mm-jumped");
    setTimeout(() => block.classList.remove("mm-jumped"), 700);
    vscode.postMessage({ type: "revealLine", line, text: (block.textContent || "").trim().slice(0, 60) });
  });

  function renderToc(headings) {
    if (!headings.length) {
      tocEl.classList.add("empty");
      tocListEl.innerHTML = "";
      return;
    }
    tocEl.classList.remove("empty");
    let h1 = 0;
    tocListEl.innerHTML = headings
      .map((heading) => {
        if (heading.level === 1) h1 += 1;
        const label = heading.level === 1 ? h1 + ". " + heading.title : heading.title;
        return (
          '<button type="button" class="mm-toc-item level-' +
          heading.level +
          '" data-id="' +
          MyMarkdownRender.escapeHtml(heading.id) +
          '" title="' +
          MyMarkdownRender.escapeHtml(heading.title) +
          '">' +
          MyMarkdownRender.escapeHtml(label) +
          "</button>"
        );
      })
      .join("");

    Array.prototype.forEach.call(tocListEl.querySelectorAll(".mm-toc-item"), (button) => {
      button.addEventListener("click", () => {
        const target = document.getElementById(button.getAttribute("data-id"));
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        setActive(button.getAttribute("data-id"));
      });
    });

    headingEls = headings
      .map((heading) => document.getElementById(heading.id))
      .filter(Boolean);
    updateActive();
  }

  function setActive(id) {
    if (id === activeId) return;
    activeId = id;
    Array.prototype.forEach.call(tocListEl.querySelectorAll(".mm-toc-item"), (button) => {
      button.classList.toggle("active", button.getAttribute("data-id") === id);
    });
  }

  function updateActive() {
    if (!headingEls.length) return;
    let current = headingEls[0];
    for (const el of headingEls) {
      if (el.getBoundingClientRect().top <= 96) current = el;
    }
    setActive(current.id);
  }

  window.addEventListener("scroll", updateActive, { passive: true });

  function update(markdown) {
    const promoted = MyMarkdown.promoteInlineJsonToFences(markdown);
    docEl.innerHTML = MyMarkdownRender.renderMarkdown(promoted) || "<p><em>Your preview will appear here.</em></p>";
    renderToc(MyMarkdown.getTocHeadings(promoted));

    const trimmed = markdown.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    statsEl.textContent = markdown.length.toLocaleString() + " characters · " + words.toLocaleString() + " words";

    const issues = MyMarkdown.lintMarkdown(markdown);
    if (!issues.length) {
      lintEl.innerHTML = '<span class="ok">● Structure looks good</span>';
    } else {
      lintEl.innerHTML =
        '<span class="warn">● ' +
        issues.length +
        (issues.length === 1 ? " suggestion" : " suggestions") +
        ": " +
        MyMarkdownRender.escapeHtml(issues[0].message) +
        "</span>";
    }
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message) return;
    if (message.type === "update") update(message.markdown);
    if (message.type === "empty") {
      docEl.innerHTML = "<p><em>Open a Markdown file to see it here.</em></p>";
      lintEl.innerHTML = "";
      statsEl.textContent = "";
      renderToc([]);
    }
  });

  vscode.postMessage({ type: "ready" });
})();
