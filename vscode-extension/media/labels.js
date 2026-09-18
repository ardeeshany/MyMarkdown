/* MyMarkdown label bars.
 *
 * Draws the active lens as thin coloured bars down the right edge of the preview, the way
 * mymarkdown.site draws them beside the rendered document. The extension embeds the lens
 * as JSON in a hidden element; everything here is measurement and painting.
 *
 * Positions come from the `data-line` attributes VS Code stamps on every mapped block, so
 * a bar is placed by where its lines actually ended up on screen rather than by guessing.
 * Blocks that deliberately carry no mapping — a reflowed JSON fence, a drawn Mermaid
 * diagram — simply do not contribute, and a range covering one is bounded by its mapped
 * neighbours instead.
 */
(function () {
  "use strict";

  var MARKER_ID = "mymd-labels";
  var LAYER_ID = "mymd-label-layer";
  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** @returns {{lens: {name: string, ranges: Array<object>}} | null} */
  function readLens() {
    var marker = document.getElementById(MARKER_ID);
    if (!marker) return null;
    try {
      var parsed = JSON.parse(marker.getAttribute("data-lens") || "null");
      if (!parsed || !parsed.ranges || !parsed.ranges.length) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function body() {
    return document.querySelector(".markdown-body") || document.body;
  }

  /**
   * The source line a mapped block starts at. markdown-it's `data-line` is `token.map[0]`,
   * which is 0-based; every line number in the sidecar format (and thus every range here)
   * is 1-based, so this is where the two get reconciled.
   */
  function sourceLineOf(node) {
    return Number(node.getAttribute("data-line")) + 1;
  }

  /** Every block the preview has mapped back to a source line, in document order. */
  function mappedBlocks(root) {
    var blocks = [];
    var nodes = root.querySelectorAll("[data-line]");
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.closest("#" + LAYER_ID)) continue;
      var start = sourceLineOf(node);
      if (!isFinite(start)) continue;
      var text = node.textContent || "";
      var span = (text.match(/\n/g) || []).length;
      blocks.push({ el: node, start: start, end: start + span });
    }
    return blocks;
  }

  /**
   * Map a range's source lines onto pixels. A block that only partly overlaps the range
   * contributes the matching slice of its own height, so a bar can start mid-paragraph.
   */
  function measure(range, blocks, baseTop) {
    var top = Infinity;
    var bottom = -Infinity;
    for (var i = 0; i < blocks.length; i += 1) {
      var block = blocks[i];
      if (block.end < range.startLine || block.start > range.endLine) continue;
      var box = block.el.getBoundingClientRect();
      if (!box.height) continue;
      var span = Math.max(1, block.end - block.start + 1);
      var ownedStart = Math.max(block.start, range.startLine);
      var ownedEnd = Math.min(block.end, range.endLine);
      var blockTop = box.top - baseTop;
      top = Math.min(top, blockTop + ((ownedStart - block.start) / span) * box.height);
      bottom = Math.max(bottom, blockTop + ((ownedEnd - block.start + 1) / span) * box.height);
    }
    if (top === Infinity) return null;
    return { top: top, height: Math.max(4, bottom - top) };
  }

  function layer(root) {
    var existing = document.getElementById(LAYER_ID);
    if (existing) return existing;
    var node = document.createElement("div");
    node.id = LAYER_ID;
    node.setAttribute("aria-hidden", "true");
    root.appendChild(node);
    return node;
  }

  var state = { bars: [], activeKey: null };

  /** Scroll to a label's next occurrence, wrapping at the end, the way the site's chips do. */
  function cycle(label) {
    var matches = state.bars.filter(function (bar) {
      return bar.label === label;
    });
    if (!matches.length) return;
    var index = 0;
    for (var i = 0; i < matches.length; i += 1) {
      if (matches[i].key === state.activeKey) {
        index = (i + 1) % matches.length;
        break;
      }
    }
    var target = matches[index];
    state.activeKey = target.key;
    window.scrollTo({
      top: Math.max(0, target.documentTop - 80),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  function paint() {
    var root = body();
    var lens = readLens();
    var host = document.getElementById(LAYER_ID);

    if (!lens) {
      if (host) host.remove();
      state.bars = [];
      return;
    }

    host = layer(root);
    var baseTop = root.getBoundingClientRect().top;
    var scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    var blocks = mappedBlocks(root);
    var bars = [];

    host.textContent = "";
    for (var i = 0; i < lens.ranges.length; i += 1) {
      var range = lens.ranges[i];
      var box = measure(range, blocks, baseTop);
      if (!box) continue;

      var key = i + ":" + range.label + ":" + range.startLine;
      var bar = document.createElement("button");
      bar.type = "button";
      bar.className = "mymd-label-bar";
      bar.style.top = box.top + "px";
      bar.style.height = box.height + "px";
      bar.style.backgroundColor = range.color;
      bar.title = range.label;
      bar.setAttribute("aria-label", range.label);
      bar.dataset.label = range.label;

      var tag = document.createElement("span");
      tag.className = "mymd-label-tag";
      tag.style.color = range.color;
      tag.textContent = range.label;
      bar.appendChild(tag);

      host.appendChild(bar);
      bars.push({
        key: key,
        label: range.label,
        documentTop: box.top + baseTop + scrollTop,
      });
    }
    state.bars = bars;
  }

  var frame = null;
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      paint();
    });
  }

  // One listener for every bar: they are replaced on each paint, so per-bar handlers would
  // have to be rebound constantly.
  document.addEventListener("click", function (event) {
    var bar = event.target && event.target.closest && event.target.closest(".mymd-label-bar");
    if (!bar) return;
    event.preventDefault();
    event.stopPropagation();
    cycle(bar.dataset.label);
  });

  // The preview swaps its content in place when the document changes, so redraw on any
  // mutation of the body rather than only on load.
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i += 1) {
      var target = records[i].target;
      if (target && target.closest && target.closest("#" + LAYER_ID)) continue;
      schedule();
      return;
    }
  });

  function start() {
    paint();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    // Images and Mermaid diagrams settle after first paint and move everything below them.
    window.setTimeout(schedule, 300);
    window.setTimeout(schedule, 1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
