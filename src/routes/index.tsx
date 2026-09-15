import { createFileRoute } from "@tanstack/react-router";
import { ArrowUp, Check, ChevronDown, ChevronUp, Clipboard, ClipboardPaste, ListTree, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BeautifyMD — Markdown Beautifier & Formatter" },
      { name: "description", content: "Paste Markdown and turn it into a polished, readable document with colorful headings, formatted JSON, and instant lint suggestions." },
      { property: "og:title", content: "BeautifyMD — Markdown Beautifier & Formatter" },
      { property: "og:description", content: "Beautiful, readable Markdown with colorful headings, formatted JSON, and instant lint suggestions." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/" }],
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
type TocHeading = { id: string; level: 1 | 2 | 3; line: number; title: string };

function slugifyHeading(value: string) {
  return value
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "") || "section";
}

function getTocHeadings(source: string): TocHeading[] {
  const headings: TocHeading[] = [];
  const slugCounts = new Map<string, number>();
  let inFence = false;

  source.replace(/\r\n/g, "\n").split("\n").forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const match = line.match(/^\s*(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (!match) return;
    const title = (match[2] ?? "").trim();
    const baseSlug = slugifyHeading(title);
    const occurrence = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, occurrence + 1);
    headings.push({
      id: occurrence ? `${baseSlug}-${occurrence + 1}` : baseSlug,
      level: (match[1]?.length ?? 1) as 1 | 2 | 3,
      line: index + 1,
      title,
    });
  });

  return headings;
}

function promoteRawJsonToFences(source: string) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let inFence = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      output.push(line);
      i += 1;
      continue;
    }
    if (!inFence && /^\s*[\{\[]/.test(line)) {
      // Accumulate lines until the JSON candidate parses or we run out.
      let buffer = "";
      let matchedEnd = -1;
      for (let j = i; j < lines.length; j += 1) {
        const candidate = lines[j] ?? "";
        if (/^\s*```/.test(candidate)) break;
        buffer += (buffer ? "\n" : "") + candidate;
        const trimmed = buffer.trim();
        if (!/[\}\]]\s*$/.test(trimmed)) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === "object") matchedEnd = j;
        } catch {
          /* keep scanning */
        }
      }
      if (matchedEnd >= 0) {
        const raw = lines.slice(i, matchedEnd + 1).join("\n").trim();
        const pretty = JSON.stringify(JSON.parse(raw), null, 2);
        if (output.length && output.at(-1) !== "") output.push("");
        output.push("```json", ...pretty.split("\n"), "```", "");
        i = matchedEnd + 1;
        continue;
      }
    }
    output.push(line);
    i += 1;
  }

  return output.join("\n");
}

function promoteInlineJsonToFences(source: string) {
  const withInline = source.replace(/`([^`\n]+)`/g, (match, content) => {
    const trimmed = content.trim();
    if (!/^[\{\[]/.test(trimmed) || !/"[^"]+"\s*:/.test(trimmed)) return match;
    try {
      JSON.parse(trimmed);
      return `\n\n\`\`\`json\n${trimmed}\n\`\`\`\n\n`;
    } catch {
      return match;
    }
  });
  return promoteRawJsonToFences(withInline);
}


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

function expandEscapedNewlines(value: string) {
  return /\\n/.test(value) ? value.replace(/\\n/g, "\n") : value;
}

function expandEscapedNewlinesInStrings(pretty: string) {
  // Turn literal \n inside JSON string values into real line breaks, keeping the
  // indentation of the line the string started on.
  return pretty
    .split("\n")
    .flatMap((line) => {
      if (!/\\n/.test(line)) return [line];
      const indent = (line.match(/^\s*/)?.[0] ?? "") + "  ";
      const [head, ...rest] = line.split(/\\n/);
      return [head ?? "", ...rest.map((part) => indent + part)];
    })
    .join("\n");
}

function JsonCode({ value }: { value: string }) {
  let displayedValue = value;
  try {
    displayedValue = expandEscapedNewlinesInStrings(JSON.stringify(JSON.parse(value), null, 2));
  } catch {
    const expanded = expandEscapedNewlines(value);
    try {
      displayedValue = expandEscapedNewlinesInStrings(JSON.stringify(JSON.parse(expanded), null, 2));
    } catch {
      // Not parseable even after expanding \n escapes — show it with real line breaks.
      displayedValue = expanded;
    }
  }

  const tokens: { text: string; type: "key" | "string" | "number" | "literal" | "plain" }[] = [];
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?|\b(?:true|false|null)\b|[^"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(displayedValue)) !== null) {
    const [text, quoted, colon] = match;
    if (quoted) {
      tokens.push({ text: quoted, type: colon ? "key" : "string" });
      if (colon) tokens.push({ text: colon, type: "plain" });
    } else if (/^-?\d/.test(text)) {
      tokens.push({ text, type: "number" });
    } else if (/^(true|false|null)$/.test(text)) {
      tokens.push({ text, type: "literal" });
    } else {
      tokens.push({ text, type: "plain" });
    }
  }

  return (
    <>
      {tokens.map((token, index) => {
        const className = {
          key: "text-code-key font-medium",
          string: "text-code-string",
          number: "text-code-number",
          literal: "text-code-literal",
          plain: "text-foreground/55",
        }[token.type];
        return <span className={className} key={`${index}-${token.text.slice(0, 24)}`}>{token.text}</span>;
      })}
    </>
  );
}

function TruncatedLabel({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setIsTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return <span ref={ref} className={className} title={isTruncated ? text : undefined}>{text}</span>;
}

function Index() {
  const [markdown, setMarkdown] = useState(SAMPLE);
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [copied, setCopied] = useState(false);
  const [tocOpen, setTocOpen] = useState(true);
  const previewMarkdown = useMemo(() => promoteInlineJsonToFences(markdown), [markdown]);
  const headings = useMemo(() => getTocHeadings(previewMarkdown), [previewMarkdown]);
  const firstH1Id = useMemo(() => headings.find((heading) => heading.level === 1)?.id, [headings]);
  const [activeHeading, setActiveHeading] = useState(headings[0]?.id ?? "");
  const issues = useMemo(() => lintMarkdown(markdown), [markdown]);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 150);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      setMarkdown(text);
      setMode("preview");
    } catch {
      // Clipboard permission denied — keep the current document untouched.
    }
  };

  useEffect(() => {
    setActiveHeading((current) => headings.some((heading) => heading.id === current) ? current : (headings[0]?.id ?? ""));
  }, [headings]);

  useEffect(() => {
    if (mode !== "preview" || !headings.length) return;

    const updateActiveHeading = () => {
      const visibleHeadings = headings
        .map((heading) => ({ id: heading.id, element: document.getElementById(heading.id) }))
        .filter((item): item is { id: string; element: HTMLElement } => Boolean(item.element));
      const current = [...visibleHeadings].reverse().find(({ element }) => element.getBoundingClientRect().top <= 150);
      setActiveHeading(current?.id ?? visibleHeadings[0]?.id ?? "");
    };

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    return () => window.removeEventListener("scroll", updateActiveHeading);
  }, [headings, mode]);

  const beautify = () => {
    setMarkdown(formatMarkdown(markdown));
    setMode("preview");
  };

  const copy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const scrollToHeading = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    setActiveHeading(id);
  };

  return (
    <main className="relative min-h-screen overflow-x-clip bg-background px-5 pb-16 pt-8 text-foreground sm:px-8 sm:pt-10">
      <div className="pointer-events-none fixed -right-32 -top-32 size-[34rem] rounded-full bg-primary/15 blur-[130px]" />
      <div className="pointer-events-none fixed -bottom-40 -left-32 size-[30rem] rounded-full bg-heading-two/12 blur-[130px]" />

      <div className="relative mx-auto max-w-6xl">
        <header className="flex flex-col items-center text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight leading-tight sm:text-5xl">
            Markdown that reads beautifully
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Paste any Markdown and get a polished document in seconds — vivid headings, beautifully formatted JSON, and lint-clean structure.
          </p>
          <Button type="button" size="lg" onClick={pasteFromClipboard} className="mt-6 h-11 rounded-full bg-primary px-7 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90" title="Paste Markdown from your clipboard and preview it">
            <ClipboardPaste />Paste Markdown
          </Button>
        </header>

        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0">
            <section className="frosted-surface overflow-hidden rounded-2xl ring-1 ring-card/80">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-glass px-3 py-2.5 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex items-center rounded-lg bg-background/55 p-0.5 ring-1 ring-border/70" aria-label="Document mode">
                    {(["edit", "preview"] as const).map((item) => <Button key={item} type="button" size="sm" variant={mode === item ? "secondary" : "ghost"} onClick={() => setMode(item)} className={`h-7 rounded-md px-2.5 text-xs capitalize ${mode === item ? "bg-foreground text-background hover:bg-foreground/90" : "text-muted-foreground"}`}>{item}</Button>)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button type="button" size="sm" variant="ghost" onClick={copy} className="text-muted-foreground" title={copied ? "Copied" : "Copy to clipboard"} aria-label={copied ? "Copied" : "Copy to clipboard"}>{copied ? <Check /> : <Clipboard />}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={beautify} className="text-primary hover:text-primary hover:bg-transparent"><Sparkles className="text-primary" />Beautify</Button>
                </div>
              </div>

              {mode === "edit" ? (
                <textarea aria-label="Markdown editor" value={markdown} onChange={(event) => setMarkdown(event.target.value)} spellCheck="false" className="min-h-[590px] w-full resize-y bg-transparent px-6 py-8 font-mono text-[13px] leading-7 outline-none placeholder:text-muted-foreground sm:px-9 sm:py-10" placeholder="# Paste your Markdown here…" />
              ) : (
                <article className="min-h-[590px] px-6 py-8 sm:px-9 sm:py-10">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                    h1: ({ children, node }) => {
                      const id = headings.find((heading) => heading.line === node?.position?.start.line)?.id;
                      const isFirstH1 = id === firstH1Id;
                      return <h1 id={id} className={`scroll-mt-8 font-display text-4xl font-semibold leading-tight text-heading-one sm:text-5xl ${isFirstH1 ? "" : "pt-10"}`}>{children}</h1>;
                    },
                    h2: ({ children, node }) => <h2 id={headings.find((heading) => heading.line === node?.position?.start.line)?.id} className="scroll-mt-8 mt-9 font-display text-2xl font-semibold leading-tight text-heading-two">{children}</h2>,
                    h3: ({ children, node }) => <h3 id={headings.find((heading) => heading.line === node?.position?.start.line)?.id} className="scroll-mt-8 mt-8 font-display text-xl font-semibold leading-tight text-heading-three">{children}</h3>,
                    h4: ({ children }) => <h4 className="mt-7 font-display text-lg font-semibold text-foreground">{children}</h4>,
                    p: ({ children }) => <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-foreground/80">{children}</p>,
                    ul: ({ children }) => <ul className="mt-4 max-w-[62ch] list-disc space-y-2 pl-5 text-[15px] leading-7 marker:text-heading-two">{children}</ul>,
                    ol: ({ children }) => <ol className="mt-4 max-w-[62ch] list-decimal space-y-2 pl-5 text-[15px] leading-7 marker:font-medium marker:text-heading-one">{children}</ol>,
                    blockquote: ({ children }) => <blockquote className="mt-5 border-l-2 border-heading-three bg-heading-three/5 px-4 py-1 italic text-foreground/75">{children}</blockquote>,
                    a: ({ children, href }) => <a className="font-medium text-primary underline decoration-primary/30 underline-offset-4" href={href} target="_blank" rel="noreferrer">{children}</a>,
                    table: ({ children }) => <div className="mt-5 overflow-x-auto"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
                    th: ({ children }) => <th className="border-b border-border px-3 py-2 font-semibold text-heading-two">{children}</th>,
                    td: ({ children }) => <td className="border-b border-border/70 px-3 py-2 text-foreground/80">{children}</td>,
                    pre: ({ children }) => <pre className="mt-4 overflow-x-auto rounded-xl bg-foreground/[0.04] p-5 font-mono text-[13px] leading-6 ring-1 ring-border/70">{children}</pre>,
                    code: ({ className, children }) => {
                      const value = String(children).replace(/\n$/, "");
                      const language = /language-(\w+)/.exec(className ?? "")?.[1];
                      const isFenced = Boolean(className);
                      const looksLikeJson = !isFenced && /"[^"]+"\s*:/.test(value);
                      const isJson = language === "json" || looksLikeJson;
                      if (!isFenced && !isJson) return <code className="rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[0.88em] text-heading-three">{children}</code>;
                      if (!isFenced && isJson) return <code className="font-mono text-[0.88em]"><JsonCode value={value} /></code>;
                      return <code className="bg-transparent">{isJson ? <JsonCode value={value} /> : expandEscapedNewlines(value)}</code>;
                    },
                  }}>{previewMarkdown || "*Your preview will appear here.*"}</ReactMarkdown>
                </article>
              )}
            </section>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-glass px-4 py-2.5 text-xs ring-1 ring-card/80 backdrop-blur-md">
              <span className="text-muted-foreground">{markdown.length.toLocaleString()} characters · {markdown.trim() ? markdown.trim().split(/\s+/).length : 0} words</span>
              <span className={`flex items-center gap-1.5 font-medium ${issues.length ? "text-heading-three" : "text-heading-two"}`}><span className={`size-1.5 rounded-full ${issues.length ? "bg-heading-three" : "bg-heading-two"}`} />{issues.length ? `${issues.length} ${issues.length === 1 ? "suggestion" : "suggestions"}: ${issues[0]?.message}` : "Structure looks good"}</span>
            </div>
          </div>

          <aside className="sticky top-2 z-10 order-first max-h-[min(15rem,45vh)] overflow-y-auto rounded-xl bg-glass ring-1 ring-card/80 backdrop-blur-md lg:order-none lg:top-6 lg:max-h-[calc(100vh-3rem)]" aria-label="Table of contents">
            <div className="flex h-11 items-center justify-between px-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><ListTree className="size-4 text-primary" />Contents</div>
              <Button type="button" size="icon" variant="ghost" className="size-8 text-muted-foreground" onClick={() => setTocOpen((open) => !open)} aria-expanded={tocOpen} aria-label={tocOpen ? "Collapse table of contents" : "Open table of contents"} title={tocOpen ? "Collapse table of contents" : "Open table of contents"}>
                {tocOpen ? <ChevronUp /> : <ChevronDown />}
              </Button>
            </div>
            {tocOpen && (
              <nav className="border-t border-border/70 px-2 py-2" aria-label="Document headings">
                {headings.length ? (() => {
                  let h1Count = 0;
                  return headings.map((heading) => {
                    if (heading.level === 1) h1Count += 1;
                    return (
                      <Button key={`${heading.line}-${heading.id}`} type="button" variant="ghost" onClick={() => scrollToHeading(heading.id)} className={`mb-0.5 h-auto w-full justify-start whitespace-nowrap rounded-md py-2 text-left text-xs leading-5 ${heading.level === 2 ? "pl-5" : heading.level === 3 ? "pl-8" : "pl-2.5"} ${activeHeading === heading.id ? "bg-primary/10 font-semibold text-primary hover:bg-primary/15" : "text-muted-foreground"}`} aria-current={activeHeading === heading.id ? "location" : undefined}>
                        {heading.level === 1 && <span className="mr-1.5 shrink-0 font-semibold text-primary">{h1Count}.</span>}
                        <TruncatedLabel text={heading.title} className="block overflow-hidden text-ellipsis whitespace-nowrap" />
                      </Button>
                    );
                  });
                })() : <p className="px-2.5 py-3 text-xs text-muted-foreground">Add H1, H2, or H3 headings to see them here.</p>}
              </nav>
            )}
          </aside>
        </div>
      </div>

      {showScrollTop && (
        <Button type="button" size="icon" variant="secondary" onClick={scrollToTop} aria-label="Scroll back to top" title="Back to top" className="fixed bottom-6 left-6 z-20 size-10 rounded-full bg-glass shadow-lg ring-1 ring-border/70 backdrop-blur-md hover:bg-glass">
          <ArrowUp />
        </Button>
      )}
    </main>
  );
}
