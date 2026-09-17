// Extension-only helpers, kept hand-written and inlined verbatim into
// lib/mymarkdown.js by sync.js. Anything here is NOT taken from the website.
// Add a function below and it is exported automatically (names are detected
// from `function name(` at the start of a line).

function formatJsonDisplay(value) {
  try {
    return expandEscapedNewlinesInStrings(JSON.stringify(JSON.parse(value), null, 2));
  } catch (e) {
    const expanded = expandEscapedNewlines(value);
    try {
      return expandEscapedNewlinesInStrings(JSON.stringify(JSON.parse(expanded), null, 2));
    } catch (e2) {
      return expanded;
    }
  }
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
