// Extension-only helpers, kept hand-written and inlined verbatim into
// lib/mymarkdown.js by sync.js. Anything here is NOT taken from the website.
// Add a function below and it is exported automatically (names are detected
// from `function name(` at the start of a line).

function formatJsonDisplay(value) {
  // Laying the value out means reparsing it, which rounds anything a double cannot
  // hold. Beautify already refuses to rewrite such a block; the preview must not show
  // a different number from the one in the file either, so it shows the text as is.
  const layOut = (text) => {
    if (!jsonNumbersRoundTrip(text)) return null;
    try {
      return expandEscapedNewlinesInStrings(JSON.stringify(JSON.parse(text), null, 2));
    } catch (e) {
      return null;
    }
  };
  const direct = layOut(value);
  if (direct !== null) return direct;
  const expanded = expandEscapedNewlines(value);
  const repaired = expanded === value ? null : layOut(expanded);
  return repaired !== null ? repaired : expanded;
}

function minimalEdit(oldText, newText) {
  // The smallest single replacement that turns oldText into newText, so Beautify
  // is one small edit instead of a whole-document rewrite: the cursor, the
  // selection and the scroll position all survive.
  if (oldText === newText) return null;
  const max = Math.min(oldText.length, newText.length);
  let start = 0;
  while (start < max && oldText[start] === newText[start]) start += 1;
  let tail = 0;
  while (
    tail < max - start &&
    oldText[oldText.length - 1 - tail] === newText[newText.length - 1 - tail]
  ) {
    tail += 1;
  }
  return { start, end: oldText.length - tail, text: newText.slice(start, newText.length - tail) };
}
