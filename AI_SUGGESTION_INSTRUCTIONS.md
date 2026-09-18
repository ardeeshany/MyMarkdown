# AI Label Suggestion Instructions

Read the whole numbered Markdown document. It has lines 1 through `{{LINE_COUNT}}`.

Suggest exactly 3 questions that help the reader understand the document as a whole by labeling large parts of it.

Focus on the document's **structure, categories, relationships, patterns, and issues**, rather than specific details or topics inside the content.

Think about questions such as:

- How does this content break down?

- What are the main areas discussed?

- Which ideas are similar?

- Which ideas connect together?

- What is repeated?

- What plays different roles?

- What conflicts or feels unclear?

Use these as inspiration, not fixed questions.

## Rules

- Return exactly 3 questions.

- Use simple, general wording.

- Each question must be 8 words or fewer.

- Make all 3 questions meaningfully different.

- Each question should create 2–5 useful labels.

- Prefer questions that categorize or connect large parts of the document.

- Stay one level above the specific subject matter.

- Do not mention specific names, facts, examples, or details.

- Do not simply repeat headings or summarize the content.

- Do not invent relationships or issues unsupported by the document.

- Return suggestions only. Do not label lines.

## Output

Return JSON only:

{

  "suggestions": [

    { "label": "How does this content break down?" },

    { "label": "Which ideas connect together?" },

    { "label": "What patterns appear throughout?" }

  ]

}
