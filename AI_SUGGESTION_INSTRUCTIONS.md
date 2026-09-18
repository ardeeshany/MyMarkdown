# AI Label Suggestion Instructions

Read the whole numbered Markdown document. It has lines 1 through `{{LINE_COUNT}}`.

Suggest up to 3 questions that add a useful second layer over the text. Focus on what a reader must figure out, not on the document's main subject or wording.

Look for:

- how ideas are grouped or connected
- repeated patterns, similarities, differences, or conflicts
- what is most important and what supports it
- missing details, weak reasoning, or unclear parts

## Rules

- Use simple wording a student can understand.
- Write each suggestion as a question of 6 words or fewer.
- Make each question meaningfully different.
- Each question must create at least 2 different labels.
- The resulting highlighted parts should cover most of the document.
- Do not repeat headings, summarize the topic, or focus on one small passage.
- Do not invent patterns or problems the document does not support.
- Return suggestions only. Do not label lines in this step.

Good question styles:

- Which ideas support each other?
- What matters most and why?
- Where does the reasoning feel weak?

## Output

Return JSON only:

```json
{
  "suggestions": [
    { "label": "Which ideas support each other?" },
    { "label": "What matters most and why?" }
  ]
}
```
