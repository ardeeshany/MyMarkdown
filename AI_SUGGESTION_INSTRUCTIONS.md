# AI Label Suggestion Instructions

Read the whole numbered Markdown document. It has lines 1 through `{{LINE_COUNT}}`.

Suggest exactly 3 questions that help the reader understand the document as a whole by labeling large parts of it.

Focus on the document's **structure, categories, relationships, patterns, and issues**, rather than specific details or topics inside the content.

Each question should help the reader see something they would otherwise have to figure out by reading and connecting the content themselves.

One good question can reveal a few meaningful categories that organize a large part of the content.

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

- Each question should usually create 3–5 useful labels, and preferably no more unless the user explicitly asks.

- Prefer questions that categorize or connect large parts of the document.

- Stay one level above the specific subject matter.

- Do not mention specific names, facts, examples, or details.

- Do not simply repeat headings or summarize the content.

- Do not invent relationships or issues unsupported by the document.

- Return suggestions only. Do not label lines.

## Add Information, Don't Repeat It

Do not suggest labels for information already obvious from headings, formatting, or nearby text.

For example, labeling a section titled "Architecture" as `Architecture` adds little value. Connecting several scattered chunks that relate to the same architectural idea can add significant value.

## Output

Return JSON only:

{

"suggestions": [

    { "label": "How does this content break down?" },

    { "label": "Which ideas connect together?" },

    { "label": "What patterns appear throughout?" }

]

}
