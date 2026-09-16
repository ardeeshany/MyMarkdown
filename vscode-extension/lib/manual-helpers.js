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
