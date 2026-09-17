import { visit } from "unist-util-visit";

const TYPES = ["note", "tip", "important", "warning", "caution"] as const;

type AnyNode = {
  type: string;
  value?: string;
  data?: Record<string, unknown>;
  children?: AnyNode[];
};

/**
 * GitHub alerts: > [!NOTE] ... becomes a styled callout element.
 */
export function remarkAlerts() {
  return (tree: unknown) => {
    visit(tree as never, "blockquote", (node: AnyNode) => {
      const firstParagraph = node.children?.[0];
      if (!firstParagraph || firstParagraph.type !== "paragraph") return;
      const firstText = firstParagraph.children?.[0];
      if (!firstText || firstText.type !== "text" || typeof firstText.value !== "string") return;

      const match = /^\[!(note|tip|important|warning|caution)\]\s*\n?/i.exec(firstText.value);
      if (!match) return;
      const kind = match[1].toLowerCase() as (typeof TYPES)[number];

      firstText.value = firstText.value.slice(match[0].length);
      if (!firstText.value && firstParagraph.children) {
        firstParagraph.children.shift();
        if (firstParagraph.children[0]?.type === "break") firstParagraph.children.shift();
        if (!firstParagraph.children.length) node.children?.shift();
      }

      node.data = {
        ...(node.data ?? {}),
        hName: "div",
        hProperties: { "data-alert": kind },
      };
    });
  };
}
