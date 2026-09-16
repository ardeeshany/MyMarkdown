/* MyMarkdown preview webview script. */
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const docEl = document.getElementById("mm-doc");
  const lintEl = document.getElementById("mm-lint");

  function update(markdown) {
    const promoted = MyMarkdown.promoteInlineJsonToFences(markdown);
    docEl.innerHTML = MyMarkdownRender.renderMarkdown(promoted) || "<p><em>Your preview will appear here.</em></p>";

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
    }
  });

  vscode.postMessage({ type: "ready" });
})();
