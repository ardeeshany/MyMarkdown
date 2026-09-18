import { createServerFn } from "@tanstack/react-start";
import annotationInstructions from "../../AI_INSTRUCTIONS.md?raw";
import suggestionInstructions from "../../AI_SUGGESTION_INSTRUCTIONS.md?raw";

export type AnnotationRange = {
  label: string;
  color: string;
  startLine: number;
  endLine: number;
};

export type LabelSuggestion = {
  label: string;
};

type AnnotationOperation = "label" | "suggest";

type RawItem = Partial<Record<"label" | "color", unknown>> &
  Partial<Record<"startLine" | "endLine", unknown>>;

const MODEL = "gemini-3.8-flash";
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Lines the model can point at, prefixed so it can name exact numbers. */
function numberLines(markdown: string) {
  return markdown
    .split("\n")
    .map((line, index) => `${index + 1}: ${line}`)
    .join("\n");
}

/**
 * The model is asked for disjoint ranges but cannot be trusted to deliver them:
 * clamp, drop nonsense, sort, then remove overlaps. Earlier ranges keep their
 * lines; a later range starts after the last line already claimed. This is the
 * final authority even when the model returns contradictory ranges.
 */
function sanitize(items: RawItem[], lineCount: number): AnnotationRange[] {
  const colorByLabel = new Map<string, string>();
  const cleaned: AnnotationRange[] = [];

  for (const item of items) {
    const label = String(item.label ?? "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(" ");
    if (!label) continue;
    let start = Math.trunc(Number(item.startLine));
    let end = Math.trunc(Number(item.endLine));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    start = Math.max(1, Math.min(start, lineCount));
    end = Math.max(1, Math.min(end, lineCount));
    if (end < start) [start, end] = [end, start];

    const raw = String(item.color ?? "").trim();
    const known = colorByLabel.get(label.toLowerCase());
    const color = known ?? (HEX.test(raw) ? raw : "#6366f1");
    colorByLabel.set(label.toLowerCase(), color);

    cleaned.push({ label, color, startLine: start, endLine: end });
  }

  cleaned.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  const disjoint: AnnotationRange[] = [];
  let lastClaimedLine = 0;
  for (const range of cleaned) {
    const start = Math.max(range.startLine, lastClaimedLine + 1);
    if (range.endLine < start) continue;
    disjoint.push({ ...range, startLine: start });
    lastClaimedLine = range.endLine;
  }
  return disjoint.slice(0, 40);
}

export const annotateMarkdown = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { markdown: string; prompt?: string; operation?: AnnotationOperation }) => {
      const markdown = String(input?.markdown ?? "");
      const prompt = String(input?.prompt ?? "").trim();
      const operation: AnnotationOperation = input?.operation === "suggest" ? "suggest" : "label";
      if (!markdown.trim()) throw new Error("There is nothing in the document to look at.");
      if (operation === "label" && !prompt)
        throw new Error("Describe what you want to find first.");
      return { markdown: markdown.slice(0, 120_000), prompt: prompt.slice(0, 2_000), operation };
    },
  )
  .handler(
    async ({
      data,
    }): Promise<{ ranges: AnnotationRange[]; suggestions: LabelSuggestion[]; error?: string }> => {
      const apiKey = process.env["GEMINI_API_KEY"];
      if (!apiKey) return { ranges: [], suggestions: [], error: "The AI key is not set up yet." };

      const lineCount = data.markdown.split("\n").length;
      const isSuggesting = data.operation === "suggest";
      const body = {
        systemInstruction: {
          parts: [
            {
              text: (isSuggesting ? suggestionInstructions : annotationInstructions).replaceAll(
                "{{LINE_COUNT}}",
                String(lineCount),
              ),
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: isSuggesting
                  ? `Document:\n${numberLines(data.markdown)}`
                  : `What to find: ${data.prompt}\n\nDocument:\n${numberLines(data.markdown)}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: isSuggesting
            ? {
                type: "object",
                properties: {
                  suggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                      },
                      required: ["label"],
                    },
                     minItems: 1,
                     maxItems: 3,
                  },
                },
                required: ["suggestions"],
              }
            : {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        color: { type: "string" },
                        startLine: { type: "integer" },
                        endLine: { type: "integer" },
                      },
                      required: ["label", "color", "startLine", "endLine"],
                    },
                  },
                },
                required: ["items"],
              },
        },
      };

      try {
        // No client-side timeout: generation takes as long as the model needs.
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body),
          },
        );

        if (!response.ok) {
          console.error("Gemini annotate failed", response.status, await response.text());
          return {
            ranges: [],
            suggestions: [],
            error: "The AI could not answer just now. Try again.",
          };
        }

        const payload = (await response.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text =
          payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
        const parsed = JSON.parse(text) as {
          items?: RawItem[];
          suggestions?: { label?: unknown }[];
        };
        if (isSuggesting) {
          const seen = new Set<string>();
          const suggestions = (parsed.suggestions ?? [])
            .map((value) => ({
              label: String(value.label ?? "").trim().split(/\s+/).slice(0, 10).join(" "),
            }))
            .filter((value) => {
              const key = value.label.toLowerCase();
              const wordCount = value.label.split(/\s+/).length;
              if (!value.label || wordCount < 6 || seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(0, 3);
          return { ranges: [], suggestions };
        }
        return { ranges: sanitize(parsed.items ?? [], lineCount), suggestions: [] };
      } catch (error) {
        console.error("Gemini annotate error", error);
        return {
          ranges: [],
          suggestions: [],
          error: "The AI could not answer just now. Try again.",
        };
      }
    },
  );
