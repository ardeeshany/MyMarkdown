# Simplify AI suggestions and stabilize the panel width

## What will change

- Rewrite the suggestion instructions into a short, direct set of rules.
- Ask for plain, student-friendly questions with no specialist wording.
- Focus suggestions on the document’s deeper semantic layer: structure, relationships, patterns, importance, and weaknesses.
- Avoid suggestions that merely repeat the document’s topic, headings, or obvious content.
- Keep the existing safeguards: up to three suggestions, six words maximum, multiple resulting labels, and broad document coverage.
- Keep the JSON response format explicit but compact.

## Suggestion panel

- Give the AI bar one stable width shared by the default input and the stacked suggestion state.
- Keep stacked questions inside that width without narrowing or causing text overflow.
- Preserve the existing close action and click-to-apply behavior.

## Verification

- Confirm the default and suggestion states have the same width on desktop and mobile.
- Confirm generated questions are short, clear, student-friendly, and focused on semantic understanding rather than the document’s main subject.
