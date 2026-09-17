// Renders ```mermaid blocks inside VS Code's Markdown preview.
//
// The markdown-it plugin leaves a placeholder for each diagram carrying its
// source; everything here turns those into SVG. The preview replaces its DOM
// whenever the document changes and does not re-run this script, so an
// observer picks up the blocks that arrive with each update.
(function () {
  "use strict";

  var mermaid = window.mermaid;
  if (!mermaid) return;

  var counter = 0;
  var scheduled = false;

  function isDark() {
    var cls = document.body.className || "";
    return /vscode-dark|vscode-high-contrast(?!-light)/.test(cls);
  }

  function init() {
    mermaid.initialize({
      startOnLoad: false,
      // Labels come from the open file, but a preview is still untrusted input.
      securityLevel: "strict",
      theme: isDark() ? "dark" : "default",
      fontFamily: "var(--vscode-editor-font-family, monospace)",
    });
  }

  function renderAll() {
    scheduled = false;
    var nodes = document.querySelectorAll(".mymd-mermaid:not([data-mymd-state])");
    for (var i = 0; i < nodes.length; i += 1) {
      renderOne(nodes[i]);
    }
  }

  function renderOne(node) {
    var source = node.getAttribute("data-mermaid") || "";
    node.setAttribute("data-mymd-state", "pending");
    counter += 1;
    var id = "mymd-mermaid-" + counter;
    try {
      // v10 returns a promise; older signatures took a callback.
      var result = mermaid.render(id, source);
      Promise.resolve(result).then(
        function (out) {
          node.innerHTML = out && out.svg ? out.svg : String(out || "");
          node.setAttribute("data-mymd-state", "done");
          if (out && typeof out.bindFunctions === "function") out.bindFunctions(node);
        },
        function (error) {
          showError(node, error);
        },
      );
    } catch (error) {
      showError(node, error);
    }
  }

  /** A broken diagram must still show its source, never an empty gap. */
  function showError(node, error) {
    node.setAttribute("data-mymd-state", "error");
    var pre = document.createElement("pre");
    pre.className = "mymd-mermaid-error";
    pre.textContent =
      (error && (error.str || error.message)) ||
      "Diagram could not be drawn.\n\n" + (node.getAttribute("data-mermaid") || "");
    node.innerHTML = "";
    node.appendChild(pre);
    // Mermaid leaves its failed attempt behind in the body.
    var orphan = document.getElementById("d" + node.getAttribute("data-mymd-id"));
    if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(renderAll, 50);
  }

  init();
  schedule();

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

  // Switching VS Code's colour theme re-renders every diagram in the new palette.
  var theme = isDark();
  new MutationObserver(function () {
    if (isDark() === theme) return;
    theme = isDark();
    init();
    var nodes = document.querySelectorAll(".mymd-mermaid[data-mymd-state]");
    for (var i = 0; i < nodes.length; i += 1) nodes[i].removeAttribute("data-mymd-state");
    schedule();
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
})();
