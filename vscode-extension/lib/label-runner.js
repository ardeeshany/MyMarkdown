// Asking a model for label ranges, and believing none of what comes back.
//
// The website hands Gemini a `responseSchema` and gets JSON by construction. Nothing here
// can do that: `vscode.lm` speaks to whatever model the user has, and a CLI speaks to
// whatever is on their PATH. Both happily wrap JSON in prose, fences, or an apology. So
// the prompt asks for JSON, `extractJson` digs it out of whatever arrives, and the caller
// puts the result through the same sanitiser the sidecar reader uses.
"use strict";

const { numberLines } = require("./labels.js");

/**
 * The first balanced JSON object in a model's reply. Scans rather than regexing so a brace
 * inside a string value cannot end the object early.
 * @returns {object | null}
 */
function extractJson(text) {
  const source = String(text ?? "");
  const start = source.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** The prompt asking for three structural questions about this document. */
function suggestionPrompt(instructions, markdown) {
  const lineCount = String(markdown ?? "").split("\n").length;
  return (
    String(instructions).replaceAll("{{LINE_COUNT}}", String(lineCount)) +
    "\n\nDocument:\n" +
    numberLines(markdown)
  );
}

/** The prompt asking for labelled ranges answering one question. */
function labelPrompt(instructions, markdown, question) {
  const lineCount = String(markdown ?? "").split("\n").length;
  return (
    String(instructions).replaceAll("{{LINE_COUNT}}", String(lineCount)) +
    "\n\nWhat to find: " +
    String(question) +
    "\n\nDocument:\n" +
    numberLines(markdown)
  );
}

/** Up to three short questions, held to the same shape the website enforces. */
function parseSuggestions(reply) {
  const parsed = extractJson(reply);
  const raw = parsed && Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const label = String((item && item.label) ?? item ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const key = label.toLowerCase();
    // Never cut a question mid-sentence: an over-long one is dropped whole.
    if (!label || label.split(" ").length > 8 || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length === 3) break;
  }
  return out;
}

/** The raw range list from a labelling reply; the caller sanitises it. */
function parseRanges(reply) {
  const parsed = extractJson(reply);
  return parsed && Array.isArray(parsed.items) ? parsed.items : [];
}

module.exports = { extractJson, suggestionPrompt, labelPrompt, parseSuggestions, parseRanges };
