import { createFileRoute } from "@tanstack/react-router";
import { Check, Clipboard, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lumen — Markdown Beautifier" },
      { name: "description", content: "Paste Markdown and turn it into a polished, readable document with colorful headings and formatted JSON." },
      { property: "og:title", content: "Lumen — Markdown Beautifier" },
      { property: "og:description", content: "Beautiful, readable Markdown with colorful headings and formatted JSON." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const SAMPLE = `# Release 2.4 — Focus

Quiet by default. The editor steps back so your writing can lead; every control sits one gesture away.

## What changed

- Rewrote the parser to preserve your spacing
- Cut cold-start time by forty percent
- Stable, tokenized syntax for embedded JSON

### Sample payload

\`\`\`json
{"version":2,"channel":"stable","focus":true,"features":["lint","format","preview"]}
\`\`\``;

type LintIssue = { kind: "fix" | "warning"; message: string };

function formatMarkdown(source: string) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let inFence = false;
  let language = "";
  let fenceBuffer: string[] = [];

  const add = (line: string) => {
    if (/^(#{1,6})\s/.test(line) && output.length && output.at(-1) !== "") output.push("");
    output.push(line.replace(/^\s*[-*+]\s+/, "- ").replace(/[ \t]+$/, ""));
  };

  for (const raw of lines) {
    const fence = raw.trim().match(/^```([\w-]*)/);
    if (fence && !inFence) {
      inFence = true;
      language = fence[1]?.toLowerCase() ?? "";
      fenceBuffer = [];
      if (output.length && output.at(-1) !== "") output.push("");
      output.push(`\`\`\`${language}`);
    } else if (fence && inFence) {
      let content = fenceBuffer.join("\n").trim();
      if (language === "json") {
        try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { /* preserve invalid JSON */ }
      }
      if (content) output.push(...content.split("\n"));
      output.push("```");
      inFence = false;
    } else if (inFence) {
      fenceBuffer.push(raw);
    } else {
      add(raw);
    }
  }
  if (inFence) output.push(...fenceBuffer, "```");
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function lintMarkdown(source: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const headings = [...source.matchAll(/^(#{1,6})\s+/gm)].map((match) => match[1]?.length ?? 1);
  headings.forEach((level, index) => {
    if (index > 0 && level > (headings[index - 1] ?? 0) + 1) issues.push({ kind: "warning", message: `Heading level jumps to H${level}` });
  });
  const fences = source.match(/^```/gm)?.length ?? 0;
  if (fences % 2) issues.push({ kind: "warning", message: "Unclosed code fence" });
  for (const match of source.matchAll(/```json\s*\n([\s\S]*?)```/gi)) {
    try { JSON.parse(match[1] ?? ""); } catch { issues.push({ kind: "warning", message: "JSON block needs a syntax fix" }); }
  }
  if (/^\s*[*+]\s+/m.test(source)) issues.push({ kind: "fix", message: "Mixed bullets can be normalized" });
  return issues;
}

function JsonCode({ value }: { value: string }) {
  const tokens = value.split(/("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|\b(?:true|false|null)\b)/g);
  return <>{tokens.map((token, index) => {
    let className = "text-foreground/55";
    if (/^".*"$/.test(token)) className = token.trimEnd().endsWith('"') && value.slice(value.indexOf(token) + token.length).trimStart().startsWith(":") ? "text-code-key" : "text-code-string";
    if (/^-?\d/.test(token)) className = "text-code-number";
    if (/^(true|false|null)$/.test(token)) className = "text-code-literal";
    return <span className={className} key={`${index}-${token}`}>{token}</span>;
  })}</>;
}

function Index() {
  const [markdown, setMarkdown] = useState(SAMPLE);
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [copied, setCopied] = useState(false);
  const issues = useMemo(() => lintMarkdown(markdown), [markdown]);

  const beautify = () => {
    setMarkdown(formatMarkdown(markdown));
    setMode("preview");
  };

  const copy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-5 pb-16 pt-8 text-foreground sm:px-8 sm:pt-10">
      <div className="pointer-events-none fixed -right-32 -top-32 size-[34rem] rounded-full bg-primary/15 blur-[130px]" />
      <div className="pointer-events-none fixed -bottom-40 -left-32 size-[30rem] rounded-full bg-heading-two/12 blur-[130px]" />

      <div className="relative mx-auto max-w-3xl">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-foreground text-[13px] font-semibold text-background">Lm</span>
            <div><p className="font-display text-[17px] font-semibold leading-none">Lumen</p><p className="mt-1 text-[11px] text-muted-foreground">Markdown, made legible</p></div>
          </div>
          <div className="flex items-center rounded-full bg-glass p-1 ring-1 ring-card/80 backdrop-blur-md" aria-label="Document mode">
            {(["edit", "preview"] as const).map((item) => <Button key={item} type="button" size="sm" variant={mode === item ? "secondary" : "ghost"} onClick={() => setMode(item)} className={`h-8 rounded-full px-3.5 capitalize ${mode === item ? "bg-foreground text-background hover:bg-foreground/90" : "text-muted-foreground"}`}>{item}</Button>)}
          </div>
        </header>

        <section className="frosted-surface mt-8 overflow-hidden rounded-2xl ring-1 ring-card/80">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-glass px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-primary" /><span className="text-xs font-medium text-muted-foreground">untitled.md</span></div>
            <div className="flex items-center gap-1.5">
              <Button type="button" size="sm" variant="ghost" onClick={copy} className="text-muted-foreground"><span className="sr-only sm:not-sr-only">{copied ? "Copied" : "Copy"}</span>{copied ? <Check /> : <Clipboard />}</Button>
              <Button type="button" size="sm" onClick={beautify} className="bg-primary text-primary-foreground hover:bg-primary/90"><Sparkles />Beautify</Button>
            </div>
          </div>

          {mode === "edit" ? (
            <textarea aria-label="Markdown editor" value={markdown} onChange={(event) => setMarkdown(event.target.value)} spellCheck="false" className="min-h-[590px] w-full resize-y bg-transparent px-6 py-8 font-mono text-[13px] leading-7 outline-none placeholder:text-muted-foreground sm:px-9 sm:py-10" placeholder="# Paste your Markdown here…" />
          ) : (
            <article className="min-h-[590px] px-6 py-8 sm:px-9 sm:py-10">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                h1: ({ children }) => <h1 className="font-display text-4xl font-semibold leading-tight text-heading-one sm:text-5xl">{children}</h1>,
                h2: ({ children }) => <h2 className="mt-9 font-display text-2xl font-semibold leading-tight text-heading-two">{children}</h2>,
                h3: ({ children }) => <h3 className="mt-8 font-display text-xl font-semibold leading-tight text-heading-three">{children}</h3>,
                h4: ({ children }) => <h4 className="mt-7 font-display text-lg font-semibold text-foreground">{children}</h4>,
                p: ({ children }) => <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-foreground/80">{children}</p>,
                ul: ({ children }) => <ul className="mt-4 max-w-[62ch] list-disc space-y-2 pl-5 text-[15px] leading-7 marker:text-heading-two">{children}</ul>,
                ol: ({ children }) => <ol className="mt-4 max-w-[62ch] list-decimal space-y-2 pl-5 text-[15px] leading-7 marker:font-medium marker:text-heading-one">{children}</ol>,
                blockquote: ({ children }) => <blockquote className="mt-5 border-l-2 border-heading-three bg-heading-three/5 px-4 py-1 italic text-foreground/75">{children}</blockquote>,
                a: ({ children, href }) => <a className="font-medium text-primary underline decoration-primary/30 underline-offset-4" href={href} target="_blank" rel="noreferrer">{children}</a>,
                table: ({ children }) => <div className="mt-5 overflow-x-auto"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
                th: ({ children }) => <th className="border-b border-border px-3 py-2 font-semibold text-heading-two">{children}</th>,
                td: ({ children }) => <td className="border-b border-border/70 px-3 py-2 text-foreground/80">{children}</td>,
                code: ({ className, children }) => {
                  const value = String(children).replace(/\n$/, "");
                  const language = /language-(\w+)/.exec(className ?? "")?.[1];
                  if (!className) return <code className="rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[0.88em] text-heading-three">{children}</code>;
                  return <pre className="mt-4 overflow-x-auto rounded-xl bg-foreground/[0.04] p-5 font-mono text-[13px] leading-6 ring-1 ring-border/70"><code>{language === "json" ? <JsonCode value={value} /> : value}</code></pre>;
                },
              }}>{markdown || "*Your preview will appear here.*"}</ReactMarkdown>
            </article>
          )}
        </section>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-glass px-4 py-2.5 text-xs ring-1 ring-card/80 backdrop-blur-md">
          <span className="text-muted-foreground">{markdown.length.toLocaleString()} characters · {markdown.trim() ? markdown.trim().split(/\s+/).length : 0} words</span>
          <span className={`flex items-center gap-1.5 font-medium ${issues.length ? "text-heading-three" : "text-heading-two"}`}><span className={`size-1.5 rounded-full ${issues.length ? "bg-heading-three" : "bg-heading-two"}`} />{issues.length ? `${issues.length} ${issues.length === 1 ? "suggestion" : "suggestions"}: ${issues[0]?.message}` : "Structure looks good"}</span>
        </div>
      </div>
    </main>
  );
}
