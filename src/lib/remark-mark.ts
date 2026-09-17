import { visit } from "unist-util-visit";

type TextNode = { type: "text"; value: string };
type ParentNode = { type: string; children?: unknown[] };

/**
 * Turns ==highlighted text== into a <mark> element.
 */
export function remarkMark() {
  return (tree: unknown) => {
    visit(tree as never, "text", (node: TextNode, index: number | undefined, parent: ParentNode | undefined) => {
      if (!parent || index === undefined || !parent.children) return;
      const value = node.value;
      if (!value.includes("==")) return;

      const parts: unknown[] = [];
      const pattern = /==([^=]+)==/g;
      let last = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(value)) !== null) {
        if (match.index > last) parts.push({ type: "text", value: value.slice(last, match.index) });
        parts.push({
          type: "mark",
          data: { hName: "mark" },
          children: [{ type: "text", value: match[1] }],
        });
        last = match.index + match[0].length;
      }
      if (!parts.length) return;
      if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
      parent.children.splice(index, 1, ...parts);
    });
  };
}
