/* MyMarkdown label bars.
 *
 * Draws the active lens as thin coloured bars down the right edge of the preview, the way
 * mymarkdown.site draws them beside the rendered document. The extension embeds the lens
 * as JSON in a hidden element; everything here is measurement and painting.
 *
 * Positions come from the exact source lines the preview plugin stamps on every block
 * (data-mymd-start / data-mymd-end, 1-based and inclusive), so a bar is placed by where
 * its lines actually ended up on screen rather than by guessing. VS Code's own data-line
 * gives only a block's first line, and counting newlines in the rendered text to find
 * the last one overcounts every list, quote and table.
 */
(function () {
  "use strict";

  var MARKER_ID = "mymd-labels";
  var LAYER_ID = "mymd-label-layer";
  var CHIPS_ID = "mymd-label-chips";
  // Sentinels, not real lens names: this preview script has no channel back to the
  // extension host (acquireVsCodeApi() is already claimed by VS Code's own preview
  // script, and command: links are silently dropped by its click handler - verified
  // against the installed bundle, not assumed), so picking either of these cannot
  // itself delete a lens or flip a setting. They exist so the same choices you would
  // reach for in the picker are visible here too, with an honest note on how to act
  // on them, rather than being missing from this dropdown entirely.
  var DELETE_SENTINEL = "\u0000delete-a-lens";
  var TOGGLE_SENTINEL = "\u0000disable-labels";
  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** @returns {{active: string, lenses: Array<object>} | null} */
  function readPayload() {
    var marker = document.getElementById(MARKER_ID);
    if (!marker) return null;
    try {
      var parsed = JSON.parse(marker.getAttribute("data-lens") || "null");
      if (!parsed) return null;
      if (parsed.ranges && parsed.ranges.length) return { active: parsed.name, lenses: [parsed] };
      if (parsed.lenses && parsed.lenses.length) return parsed;
      return null;
    } catch (e) {
      return null;
    }
  }

  function body() {
    return document.querySelector(".markdown-body") || document.body;
  }

  var MAPPED = "[data-mymd-start]";
  var HTML_END =
    MAPPED + ", .code-line, .footnotes-sep, .katex-block, #" + MARKER_ID + ", #" + LAYER_ID + ", #" + CHIPS_ID;

  /** Every block the plugin mapped to its source lines, in document order. */
  function mappedBlocks(root) {
    var blocks = [];
    var nodes = root.querySelectorAll(MAPPED);
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.closest("#" + LAYER_ID)) continue;
      // Footnote definitions are drawn at the foot of the page but keep their source lines:
      // measured there, a range holding one would stretch to the end of the document.
      if (node.closest(".footnotes")) continue;
      var start = Number(node.getAttribute("data-mymd-start"));
      var end = Number(node.getAttribute("data-mymd-end"));
      if (!isFinite(start) || !isFinite(end)) continue;
      blocks.push({ el: node, start: start, end: end, child: node.querySelector(MAPPED) });
    }
    return blocks;
  }

  /** A block's full box. A fence's ``` lines are the padding of its <pre>, not its <code>. */
  function outerBox(el) {
    if (el.tagName === "CODE" && el.parentElement && el.parentElement.tagName === "PRE") {
      el = el.parentElement;
    }
    var box = el.getBoundingClientRect();
    if (box.height) return { top: box.top, bottom: box.bottom };
    // VS Code draws an HTML block as an empty mapped marker followed by the raw HTML. The
    // raw HTML ends at the next mapped block, or at whatever follows the last one (VS Code's
    // end-of-document line, the footnotes, a math block, this script's own elements);
    // without that stop, HTML at the end of a document would claim the whole page.
    var top = Infinity;
    var bottom = -Infinity;
    for (var next = el.nextElementSibling; next && !next.matches(HTML_END); next = next.nextElementSibling) {
      var part = next.getBoundingClientRect();
      if (!part.height) continue;
      top = Math.min(top, part.top);
      bottom = Math.max(bottom, part.bottom);
    }
    return top === Infinity ? null : { top: top, bottom: bottom };
  }

  /** The slice of `box` that lines first..last take, sharing its height out evenly. */
  function slice(box, start, end, first, last) {
    var per = (box.bottom - box.top) / Math.max(1, end - start + 1);
    return { top: box.top + (first - start) * per, bottom: box.top + (last - start + 1) * per };
  }

  /**
   * Where text lines first..last (0-based, split at the newlines in the element's text)
   * actually sit on screen, wrapping included. Null when those lines have nothing drawn.
   */
  function textLines(el, first, last) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var range = document.createRange();
    var line = 0;
    var started = first === 0;
    var node = walker.nextNode();
    if (!node) return null;
    if (started) range.setStart(node, 0);
    var ended = false;
    for (; node && !ended; node = walker.nextNode()) {
      var text = node.nodeValue || "";
      for (var i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
        if (line === last) {
          // A newline opening a text node follows a <br> or an inline element; ending at
          // offset 0 of that node would pull in an empty box on the next row.
          if (i === 0) range.setEndBefore(node);
          else range.setEnd(node, i);
          ended = true;
          break;
        }
        line += 1;
        if (line === first) {
          range.setStart(node, i + 1);
          started = true;
        }
      }
    }
    if (!started) return null;
    // The last line runs to the end of the block, taking in an image or link that ends it.
    if (!ended) range.setEnd(el, el.childNodes.length);
    // Code text boxes are taller than the code's line pitch, so neighbouring lines' boxes
    // overlap; trim each to its line box so adjacent one-line bars meet instead.
    var lineHeight = /^(CODE|PRE)$/.test(el.tagName)
      ? parseFloat(getComputedStyle((el.tagName === "PRE" && el.firstElementChild) || el).lineHeight)
      : 0;
    var rects = range.getClientRects();
    var top = Infinity;
    var bottom = -Infinity;
    for (var r = 0; r < rects.length; r += 1) {
      if (!rects[r].height) continue;
      var trim = lineHeight ? Math.max(0, (rects[r].height - lineHeight) / 2) : 0;
      top = Math.min(top, rects[r].top + trim);
      bottom = Math.max(bottom, rects[r].bottom - trim);
    }
    return top === Infinity ? null : { top: top, bottom: bottom };
  }

  /** The part of a block a range covers only some of the lines of. */
  function partOf(block, range, box) {
    var first = Math.max(block.start, range.startLine);
    var last = Math.min(block.end, range.endLine);
    // A list, quote or table holding other mapped blocks owns only the lines before its
    // first one (a list item's own text, say); the blocks inside place themselves.
    if (block.child) {
      var childStart = Number(block.child.getAttribute("data-mymd-start"));
      var headEnd = Math.min(last, childStart - 1);
      if (headEnd < first) return null;
      var childBox = outerBox(block.child);
      var head = { top: box.top, bottom: childBox ? childBox.top : box.bottom };
      return slice(head, block.start, childStart - 1, first, headEnd);
    }
    // Some blocks are drawn as one piece that does not follow its source line by line: a
    // reflowed JSON fence or Mermaid diagram (they drop data-line), raw HTML (an empty
    // marker), a two-line setext heading. A range touching any of their lines takes all of it.
    // ponytail: two ranges splitting one such block would both draw over all of it.
    if (!block.el.hasAttribute("data-line") || !block.el.hasChildNodes() || /^H[1-6]$/.test(block.el.tagName)) {
      return box;
    }

    var el = block.el;
    var sourceLines = block.end - block.start + 1;
    var shown = ((el.textContent || "").replace(/\n$/, "").match(/\n/g) || []).length + 1;
    // A fence's ``` lines are in its extent but not its text: two of them, or one for a
    // fence left open at the end of the document. Promoted JSON has none.
    var delimiters = el.tagName === "CODE" ? sourceLines - shown : 0;
    // Anything else shows as many text lines as it has source lines, unless rendering joined
    // some (a code span broken across lines, a list item whose marker line is empty). Then
    // text lines no longer name source lines, and sharing the block out beats wrong rows.
    if (delimiters < 0 || delimiters > 2 || (el.tagName !== "CODE" && sourceLines !== shown)) {
      return slice(box, block.start, block.end, first, last);
    }
    var contentStart = delimiters ? block.start + 1 : block.start;
    var contentEnd = contentStart + shown - 1;
    var from = Math.max(first, contentStart);
    var to = Math.min(last, contentEnd);
    if (from > to) {
      // Only a fence's own ``` line: the padding of the <pre> above or below the code.
      var opening = last < contentStart;
      var edge = textLines(el, opening ? 0 : shown - 1, opening ? 0 : shown - 1);
      if (edge) return opening ? { top: box.top, bottom: edge.top } : { top: edge.bottom, bottom: box.bottom };
    }
    var lines = from <= to ? textLines(el, from - contentStart, to - contentStart) : null;
    if (!lines) return slice(box, block.start, block.end, first, last);
    // A range that takes in a fence's own ``` lines reaches the edge of the <pre>.
    return {
      top: first < contentStart ? box.top : lines.top,
      bottom: last > contentEnd ? box.bottom : lines.bottom,
    };
  }

  /** Map a range's source lines onto pixels, relative to the preview root. */
  function measure(range, blocks, baseTop) {
    var top = Infinity;
    var bottom = -Infinity;
    for (var i = 0; i < blocks.length; i += 1) {
      var block = blocks[i];
      if (block.end < range.startLine || block.start > range.endLine) continue;
      var box = outerBox(block.el);
      if (!box) continue;
      var whole = range.startLine <= block.start && block.end <= range.endLine;
      var part = whole ? box : partOf(block, range, box);
      if (!part) continue;
      top = Math.min(top, part.top - baseTop);
      bottom = Math.max(bottom, part.bottom - baseTop);
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

  function chips(root) {
    var existing = document.getElementById(CHIPS_ID);
    if (existing) return existing;
    var node = document.createElement("div");
    node.id = CHIPS_ID;
    node.setAttribute("role", "toolbar");
    node.setAttribute("aria-label", "Document labels");
    root.insertBefore(node, root.firstChild);
    return node;
  }

  function activeLens(payload) {
    if (!payload || !payload.lenses.length) return null;
    var wanted = state.activeLensName || payload.active;
    for (var i = 0; i < payload.lenses.length; i += 1) {
      if (payload.lenses[i].name === wanted) return payload.lenses[i];
    }
    state.activeLensName = payload.active || payload.lenses[0].name;
    return payload.lenses[0];
  }

  /** One chip per distinct label, in first-seen order, each counting its own ranges. */
  function renderChips(root, payload, lens) {
    var host = document.getElementById(CHIPS_ID);
    if (!lens || !lens.ranges.length) {
      if (host) host.remove();
      return;
    }
    host = chips(root);
    var order = [];
    var counts = Object.create(null);
    var colors = Object.create(null);
    for (var i = 0; i < lens.ranges.length; i += 1) {
      var range = lens.ranges[i];
      if (!(range.label in counts)) {
        order.push(range.label);
        colors[range.label] = range.color;
        counts[range.label] = 0;
      }
      counts[range.label] += 1;
    }

    host.textContent = "";
    // Shown even for a single lens: it's the one place the active question is named, and
    // keeping it present (not just appearing once a second lens exists) means asking for
    // one more lens later doesn't make a dropdown suddenly appear where there was none.
    var switcher = document.createElement("label");
    switcher.className = "mymd-lens-chip";
    var select = document.createElement("select");
    select.className = "mymd-lens-select";
    select.setAttribute("aria-label", "Switch label lens");
    for (var optionIndex = 0; optionIndex < payload.lenses.length; optionIndex += 1) {
      var optionLens = payload.lenses[optionIndex];
      var option = document.createElement("option");
      option.value = optionLens.name;
      option.textContent = optionLens.name;
      option.selected = optionLens.name === lens.name;
      select.appendChild(option);
    }

    var deleteOption = document.createElement("option");
    deleteOption.value = DELETE_SENTINEL;
    deleteOption.textContent = "Delete a lens…";
    select.appendChild(deleteOption);

    var toggleOption = document.createElement("option");
    toggleOption.value = TOGGLE_SENTINEL;
    toggleOption.textContent = "Disable labels completely";
    select.appendChild(toggleOption);

    switcher.appendChild(select);
    host.appendChild(switcher);

    if (state.hint) {
      var hint = document.createElement("span");
      hint.className = "mymd-lens-hint";
      hint.setAttribute("role", "status");
      hint.textContent = state.hint;
      host.appendChild(hint);
    }

    for (var j = 0; j < order.length; j += 1) {
      var label = order[j];
      var color = colors[label];
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "mymd-label-chip";
      chip.dataset.label = label;
      chip.style.color = color;
      chip.style.borderColor = color + "66";
      chip.style.backgroundColor = color + "1f";

      var dot = document.createElement("span");
      dot.className = "mymd-label-chip-dot";
      dot.style.backgroundColor = color;
      chip.appendChild(dot);

      chip.appendChild(document.createTextNode(label));

      if (counts[label] > 1) {
        var count = document.createElement("span");
        count.className = "mymd-label-chip-count";
        count.textContent = String(counts[label]);
        chip.appendChild(count);
      }

      host.appendChild(chip);
    }
  }

  var state = { bars: [], activeKey: null, activeLensName: "", hint: null };
  var hintTimer = null;

  /** Neither sentinel can be acted on here; show where to actually do it, then repaint
   *  the select back onto the real active lens so it never looks stuck on a fake entry. */
  function showHint(message) {
    state.hint = message;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = window.setTimeout(function () {
      hintTimer = null;
      state.hint = null;
      repaint();
    }, 4000);
    repaint();
  }

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
    var payload = readPayload();
    var lens = activeLens(payload);
    var host = document.getElementById(LAYER_ID);

    renderChips(root, payload, lens);

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

    // Measure every range before adding any bar: reading layout after each write would
    // force the browser to lay the page out again once per range.
    var boxes = [];
    for (var m = 0; m < lens.ranges.length; m += 1) boxes.push(measure(lens.ranges[m], blocks, baseTop));

    host.textContent = "";
    for (var i = 0; i < lens.ranges.length; i += 1) {
      var range = lens.ranges[i];
      var box = boxes[i];
      if (!box) continue;

      var key = i + ":" + range.label + ":" + range.startLine;
      var bar = document.createElement("button");
      bar.type = "button";
      bar.className = "mymd-label-bar";
      bar.style.top = box.top + "px";
      bar.style.height = box.height + "px";
      bar.style.color = range.color;
      bar.title = range.label;
      bar.setAttribute("aria-label", range.label);
      bar.dataset.label = range.label;
      bar.dataset.key = key;

      var fill = document.createElement("span");
      fill.className = "mymd-label-fill";
      bar.appendChild(fill);

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

  // Chips, the lens picker and bars are rebuilt on every paint, and VS Code's own updates
  // remove them, so keyboard focus on one would drop to the page. Remember which one had
  // it (the element being removed does not count as focus moving away) and give it back.
  var focusKey = null;
  function keyOf(el) {
    if (!el || !el.closest || !el.closest("#" + CHIPS_ID + ", #" + LAYER_ID)) return null;
    return el.className + "|" + (el.dataset.key || el.dataset.label || "");
  }
  document.addEventListener("focusin", function (event) {
    focusKey = keyOf(event.target);
  });
  document.addEventListener("focusout", function (event) {
    if (event.target.isConnected) focusKey = keyOf(event.relatedTarget);
  });
  function restoreFocus() {
    if (!focusKey || (document.activeElement && document.activeElement !== document.body)) return;
    var candidates = document.querySelectorAll(
      "#" + CHIPS_ID + " button, #" + CHIPS_ID + " select, #" + LAYER_ID + " button",
    );
    for (var i = 0; i < candidates.length; i += 1) {
      if (keyOf(candidates[i]) !== focusKey) continue;
      candidates[i].focus({ preventScroll: true });
      return;
    }
  }

  /** The page size the last paint left, so a resize report of that same size is skipped. */
  var painted = { width: -1, height: -1 };

  function repaint() {
    paint();
    // Putting the chip row and bar layer back is itself a DOM mutation; left queued, it
    // would schedule a second, identical paint for every update.
    observer.takeRecords();
    var size = document.body.getBoundingClientRect();
    painted = { width: size.width, height: size.height };
    restoreFocus();
  }

  var frame = null;
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      repaint();
    });
  }

  // One listener for every bar: they are replaced on each paint, so per-bar handlers would
  // have to be rebound constantly.
  document.addEventListener("click", function (event) {
    var target =
      event.target &&
      event.target.closest &&
      event.target.closest(".mymd-label-bar, .mymd-label-chip");
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    cycle(target.dataset.label);
  });

  document.addEventListener("change", function (event) {
    var select = event.target && event.target.closest && event.target.closest(".mymd-lens-select");
    if (!select) return;
    if (select.value === DELETE_SENTINEL) {
      showHint('To delete a lens, use the status bar item or "MyMarkdown: Switch Label Lens".');
      return;
    }
    if (select.value === TOGGLE_SENTINEL) {
      showHint('To disable labels everywhere, run "MyMarkdown: Toggle Labels" (Ctrl+Shift+P).');
      return;
    }
    if (hintTimer) {
      clearTimeout(hintTimer);
      hintTimer = null;
    }
    state.hint = null;
    state.activeLensName = select.value;
    state.activeKey = null;
    repaint();
  });

  // The preview swaps its content in place when the document changes, so redraw on any
  // mutation of the body rather than only on load. Attribute changes count for two cases:
  // a rewritten sidecar arrives as a new data-lens on the marker, and <details> opening
  // moves everything below it.
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i += 1) {
      var target = records[i].target;
      if (target && target.closest && (target.closest("#" + LAYER_ID) || target.closest("#" + CHIPS_ID))) {
        continue;
      }
      schedule();
      return;
    }
  });

  function start() {
    repaint();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-lens", "open"],
    });
    window.addEventListener("resize", schedule, { passive: true });
    // Fired by VS Code's preview after every content update, including edits that only
    // shift line numbers and so change no text the observer above would see.
    window.addEventListener("vscode.markdown.updateContent", schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    // Images, fonts, Mermaid and math settle whenever they settle, and move everything
    // below them without touching the DOM; the page changing size is the one signal.
    // Painting cannot loop through this (the bar layer is absolutely positioned), but the
    // chip row appearing does resize the page, and that paint has already been done.
    if (window.ResizeObserver) {
      new ResizeObserver(function (entries) {
        var size = entries[0].borderBoxSize && entries[0].borderBoxSize[0];
        if (
          size &&
          Math.abs(size.inlineSize - painted.width) < 0.5 &&
          Math.abs(size.blockSize - painted.height) < 0.5
        ) {
          return;
        }
        schedule();
      }).observe(document.body);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
