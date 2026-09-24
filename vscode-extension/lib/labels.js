// The label sidecar file: reading it, trusting none of it, and keeping its ranges
// pointing at the right text after the document has moved on.
//
// A sidecar holds one or more named lenses, each a set of labelled line ranges over
// one Markdown file. Two things write it — the authoring skill and the extension's own
// on-demand commands — and neither is trusted here. Everything below treats the file as
// something a person may have hand-edited, an older version may have produced, or a
// model may have returned in a contradictory state, exactly as the website's server-side
// sanitiser does before the browser ever sees a range.
"use strict";

const crypto = require("crypto");

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
const FALLBACK_COLOUR = "#6366f1";
const MAX_RANGES_PER_LENS = 40;
const MAX_LABELS_PER_LENS = 12;
const MAX_LENSES = 12;
/**
 * Anchors hold the whole line, not a prefix. Sixty characters looked like plenty until you
 * meet a table: rows routinely share their first sixty characters and differ only at the
 * end, so a prefix anchor cannot tell one row from its neighbours. The cap here only exists
 * to stop a minified-JSON line bloating the sidecar.
 */
const ANCHOR_LENGTH = 500;
/** How far past its expected end a range's closing line is allowed to have drifted. */
const END_SLACK = 50;

const FORMAT_VERSION = 1;

function sha256(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

/** Whitespace and case are noise when matching a line back to itself after an edit. */
function normalizeAnchor(line) {
  return String(line ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, ANCHOR_LENGTH);
}

/** The first line with something on it, searching forward from `from` and not past `to`. */
function firstContentLine(lines, from, to) {
  for (let i = from; i <= to && i < lines.length; i += 1) {
    if (String(lines[i] ?? "").trim()) return i;
  }
  return -1;
}

function lastContentLine(lines, from, to) {
  for (let i = Math.min(to, lines.length - 1); i >= from && i >= 0; i -= 1) {
    if (String(lines[i] ?? "").trim()) return i;
  }
  return -1;
}

/**
 * Anchors for a range, taken from the document it was generated against. Stored in the
 * sidecar so the range can be found again once line numbers no longer line up.
 * @param {string[]} lines
 * @param {number} startLine 1-based, inclusive
 * @param {number} endLine 1-based, inclusive
 */
function anchorsFor(lines, startLine, endLine) {
  const from = startLine - 1;
  const to = endLine - 1;
  const first = firstContentLine(lines, from, to);
  const last = lastContentLine(lines, from, to);
  return {
    anchor: first === -1 ? "" : normalizeAnchor(lines[first]),
    endAnchor: last === -1 ? "" : normalizeAnchor(lines[last]),
  };
}

/**
 * Where a range's text has ended up, or null when it cannot be placed with confidence.
 *
 * Markdown repeats itself constantly — `## Notes`, `\`\`\`js`, a closing fence, a table row —
 * so a lone start anchor is not an identity. When the opening line matches in more than one
 * place, the range is only moved if its closing line agrees about exactly one of them.
 * Anything still ambiguous is dropped: a bar that is missing is a smaller lie than a bar
 * drawn confidently over text it was never generated for.
 *
 * @param {string[]} keys every line of the document, normalised once by the caller
 */
function locateRange(keys, range) {
  if (!range.anchor) return null;
  const span = Math.max(0, range.endLine - range.startLine);
  const wasAt = range.startLine - 1;

  const starts = [];
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i] === range.anchor) starts.push(i);
  }
  if (!starts.length) return null;

  // The closing line is searched forward from the opening one and no further than the span
  // it used to have (plus slack), so a line that moved to the end of the file cannot stretch
  // the range over everything in between.
  // Among the lines matching the closing anchor, the one nearest where the range's own span
  // puts it: a closing line like ``` or --- usually repeats inside the range too, and taking
  // the first match would cut the range short at it.
  const endFor = (start) => {
    if (!range.endAnchor) return start + span;
    const limit = Math.min(keys.length - 1, start + span + END_SLACK);
    let best = -1;
    for (let j = start; j <= limit; j += 1) {
      if (keys[j] !== range.endAnchor) continue;
      if (best === -1 || Math.abs(j - start - span) < Math.abs(best - start - span)) best = j;
    }
    return best;
  };

  // Only one place the opening line could be: there is no ambiguity to resolve, so it is
  // trusted even if the closing line cannot be found (the range's span may just have
  // changed, not its identity).
  if (starts.length === 1) {
    const end = endFor(starts[0]);
    return { start: starts[0], end: end === -1 ? starts[0] + span : end };
  }

  // The opening line repeats, so only a candidate whose closing line also matches can be
  // trusted at all. Among those, the one scores best whose closing line landed nearest
  // where this range's own span predicts it should - that is what tells six identical
  // `## Notes` headings apart: only the right copy has the right body the right distance
  // below it. A tie between two candidates is dropped rather than guessed.
  const candidates = [];
  for (const start of starts) {
    const end = endFor(start);
    if (end === -1) continue;
    const expected = start + span;
    candidates.push({
      start,
      end,
      endDrift: Math.abs(end - expected),
      startDrift: Math.abs(start - wasAt),
    });
  }
  if (!candidates.length) return null;

  candidates.sort((a, b) => a.endDrift - b.endDrift || a.startDrift - b.startDrift);
  const [best, next] = candidates;
  if (next && next.endDrift === best.endDrift && next.startDrift === best.startDrift) return null;
  return { start: best.start, end: best.end };
}

/**
 * Clamp, drop nonsense, sort, then remove overlaps. Earlier ranges keep their lines; a
 * later range starts after the last line already claimed. This is the final authority
 * even when the model returns contradictory ranges.
 */
function sanitizeRanges(rawRanges, lineCount) {
  const colourByLabel = new Map();
  const acceptedLabels = new Set();
  const cleaned = [];

  for (const raw of Array.isArray(rawRanges) ? rawRanges : []) {
    if (!raw || typeof raw !== "object") continue;
    const label = String(raw.label ?? "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(" ");
    if (!label) continue;
    const labelKey = label.toLowerCase();
    if (!acceptedLabels.has(labelKey) && acceptedLabels.size >= MAX_LABELS_PER_LENS) continue;
    acceptedLabels.add(labelKey);

    let start = Math.trunc(Number(raw.startLine));
    let end = Math.trunc(Number(raw.endLine));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    start = Math.max(1, Math.min(start, lineCount));
    end = Math.max(1, Math.min(end, lineCount));
    if (end < start) [start, end] = [end, start];

    const requested = String(raw.color ?? "").trim();
    const known = colourByLabel.get(labelKey);
    const color = known ?? (HEX_COLOUR.test(requested) ? requested : FALLBACK_COLOUR);
    colourByLabel.set(labelKey, color);

    cleaned.push({
      label,
      color,
      startLine: start,
      endLine: end,
      anchor: String(raw.anchor ?? ""),
      endAnchor: String(raw.endAnchor ?? ""),
    });
  }

  cleaned.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  const disjoint = [];
  let lastClaimed = 0;
  for (const range of cleaned) {
    const start = Math.max(range.startLine, lastClaimed + 1);
    if (range.endLine < start) continue;
    disjoint.push({ ...range, startLine: start });
    lastClaimed = range.endLine;
  }
  return disjoint.slice(0, MAX_RANGES_PER_LENS);
}

/**
 * Move a lens's ranges back onto the text they were generated for. A range whose opening
 * line is gone is dropped on its own; the rest of the lens is unaffected.
 *
 * A range with no stored anchor keeps the lines it was written with. Re-anchoring is a
 * recovery mechanism, and a range that was never anchored has nothing to recover from —
 * dropping it would throw away every label written by hand or by the authoring skill.
 */
function reanchorRanges(ranges, lines) {
  const keys = lines.map(normalizeAnchor);
  const moved = [];
  for (const range of ranges) {
    if (!range.anchor) {
      moved.push({ ...range });
      continue;
    }
    const found = locateRange(keys, range);
    if (!found) continue;
    moved.push({ ...range, startLine: found.start + 1, endLine: found.end + 1 });
  }

  // A range whose closing line drifted can end up covering the ones after it. Clipping it
  // back to its neighbour's start keeps the rest of the lens intact; left alone, the
  // overlap pass in sanitizeRanges would delete every range it now swallows instead.
  moved.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  for (let i = 0; i < moved.length - 1; i += 1) {
    const nextStart = moved[i + 1].startLine;
    if (moved[i].endLine >= nextStart) moved[i].endLine = Math.max(moved[i].startLine, nextStart - 1);
  }
  return moved;
}

/**
 * Ranges as stored, with only the checks that do not depend on the current document.
 * Deliberately does no clamping: a range is re-anchored against the new text first, and
 * clamping it to the new line count beforehand would shrink it onto the wrong lines — or
 * collapse it entirely — before it ever got the chance to move.
 */
function storedRanges(rawList) {
  const out = [];
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    if (!raw || typeof raw !== "object") continue;
    const label = String(raw.label ?? "").trim();
    const start = Math.trunc(Number(raw.startLine));
    const end = Math.trunc(Number(raw.endLine));
    if (!label || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({
      label,
      color: String(raw.color ?? ""),
      startLine: start,
      endLine: end,
      anchor: String(raw.anchor ?? ""),
      endAnchor: String(raw.endAnchor ?? ""),
    });
  }
  return out;
}

function sanitizeLens(rawLens, lineCount) {
  if (!rawLens || typeof rawLens !== "object") return null;
  const name = String(rawLens.name ?? "").trim().slice(0, 80);
  if (!name) return null;
  const ranges = sanitizeRanges(rawLens.ranges, lineCount);
  if (!ranges.length) return null;
  return {
    name,
    generatedBy: rawLens.generatedBy === "on-demand" ? "on-demand" : "skill",
    generatedAt: String(rawLens.generatedAt ?? ""),
    ranges,
  };
}

/**
 * Read a sidecar against the document it describes. Ranges are trusted as written while
 * the hash still matches, and re-anchored by their own text when it does not.
 *
 * @param {unknown} raw parsed sidecar JSON, or anything at all
 * @param {string} documentText the document as it is right now
 * @returns {{version: number, lenses: Array<object>, stale: boolean}}
 */
function readLabels(raw, documentText) {
  const text = String(documentText ?? "");
  const lines = text.split("\n");
  const parsed = raw && typeof raw === "object" ? raw : {};
  const stale = String(parsed.sourceHash ?? "") !== sha256(text);

  const lenses = [];
  for (const rawLens of Array.isArray(parsed.lenses) ? parsed.lenses : []) {
    if (!rawLens || typeof rawLens !== "object") continue;
    const name = String(rawLens.name ?? "").trim().slice(0, 80);
    if (!name) continue;

    // Move the ranges onto the current text first, then sanitise the result: re-anchoring
    // can reorder ranges or push two of them into each other, and the sanitiser is what
    // guarantees the preview never receives an overlapping or out-of-bounds set.
    const ranges = stale
      ? sanitizeRanges(reanchorRanges(storedRanges(rawLens.ranges), lines), lines.length)
      : sanitizeRanges(rawLens.ranges, lines.length);
    if (!ranges.length) continue;

    lenses.push({
      name,
      generatedBy: rawLens.generatedBy === "on-demand" ? "on-demand" : "skill",
      generatedAt: String(rawLens.generatedAt ?? ""),
      ranges,
    });
    if (lenses.length >= MAX_LENSES) break;
  }

  return { version: FORMAT_VERSION, lenses, stale };
}

/**
 * Build a sidecar for `documentText`, stamping each range with the anchors that let it be
 * found again later. Existing lenses of the same name are replaced rather than duplicated.
 */
function writeLabels(documentText, lenses, existing) {
  const text = String(documentText ?? "");
  const lines = text.split("\n");
  const byName = new Map();

  // Every lens in the result is stamped against the text being written, incoming or
  // carried over. A lens that keeps stale anchors — or none — would survive this write and
  // then vanish at the first edit, losing work the model was already paid for.
  const stamp = (lens) => {
    const clean = sanitizeLens(lens, lines.length);
    if (!clean) return;
    clean.ranges = clean.ranges.map((range) => ({
      ...range,
      ...anchorsFor(lines, range.startLine, range.endLine),
    }));
    byName.set(clean.name.toLowerCase(), clean);
  };

  for (const lens of Array.isArray(existing?.lenses) ? existing.lenses : []) stamp(lens);
  for (const lens of Array.isArray(lenses) ? lenses : []) stamp(lens);

  return {
    version: FORMAT_VERSION,
    sourceHash: sha256(text),
    lenses: [...byName.values()].slice(0, MAX_LENSES),
  };
}

/** The sidecar path for a document, mirroring its path under a single hidden folder. */
function sidecarPath(relativePath, storageFolder) {
  const clean = String(relativePath ?? "")
    .replace(/\\/g, "/")
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\//, "");
  return `${storageFolder || ".mymd"}/${clean}.json`;
}

/** Prefix every line with its number so a model can name exact lines back to us. */
function numberLines(text) {
  return String(text ?? "")
    .split("\n")
    .map((line, index) => `${index + 1}: ${line}`)
    .join("\n");
}

module.exports = {
  readLabels,
  writeLabels,
  sanitizeRanges,
  reanchorRanges,
  anchorsFor,
  normalizeAnchor,
  sidecarPath,
  numberLines,
  sha256,
  FORMAT_VERSION,
};
