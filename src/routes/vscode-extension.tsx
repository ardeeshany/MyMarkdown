import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  Download,
  ListTree,
  Palette,
  Sparkles,
  Tags,
  Terminal,
} from "lucide-react";
import { useState } from "react";

import heroImage from "@/assets/mymarkdown-logo-v2.webp.asset.json";
import overviewImage from "@/assets/vscode-overview.webp.asset.json";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const VERSION = "0.2.0";

const INSTALL_COMMAND = `code --install-extension mymarkdown-${VERSION}.vsix`;

const VSIX = `/mymarkdown-${VERSION}.vsix`;

export const Route = createFileRoute("/vscode-extension")({
  head: () => ({
    meta: [
      { title: "MyMarkdown for VS Code — Read, Label, and Navigate Markdown" },
      {
        name: "description",
        content:
          "A clearer Markdown preview for VS Code with AI label lenses, colorful headings, formatted JSON, beautify, and a clickable table of contents.",
      },
      {
        property: "og:title",
        content: "MyMarkdown for VS Code — Read, Label, and Navigate Markdown",
      },
      {
        property: "og:description",
        content:
          "Ask a question about a Markdown document and see the answer as colored labels, right inside VS Code.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://mymarkdown.site/vscode-extension" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "MyMarkdown for VS Code" },
      {
        name: "twitter:description",
        content:
          "AI label lenses, colorful previews, beautify, and a clickable table of contents inside VS Code.",
      },
    ],
    links: [{ rel: "canonical", href: "https://mymarkdown.site/vscode-extension" }],
  }),
  component: ExtensionPage,
});

const FEATURES = [
  {
    icon: Tags,
    title: "AI label lenses",
    body: "Ask a question such as “Which parts need work?” and see matching sections marked with colored labels. Keep several lenses and switch between them without asking again.",
  },
  {
    icon: Palette,
    title: "A preview made for reading",
    body: "Colorful headings, formatted JSON, task lists, Mermaid diagrams, calm code blocks, scroll sync, and click-to-source — all inside VS Code’s own preview.",
  },
  {
    icon: Sparkles,
    title: "One-key beautify",
    body: "Press Cmd/Ctrl + Alt + B to normalize spacing, lists, and JSON with the smallest possible edit. One undo reverses the whole change.",
  },
  {
    icon: ListTree,
    title: "Contents and live checks",
    body: "Jump through H1–H3 headings from the sidebar. Heading jumps, unclosed fences, mixed bullets, and invalid JSON appear in Problems as you type.",
  },
];

const STEPS = [
  {
    title: "Download the file",
    body: "Grab the .vsix file above and save it anywhere on your computer.",
  },
  {
    title: "Install it in VS Code",
    body: "Open VS Code, press Cmd/Ctrl + Shift + P, run “Extensions: Install from VSIX…”, and pick the file you just downloaded.",
  },
  {
    title: "Reload the window",
    body: "Run “Developer: Reload Window” from the same menu, or just restart VS Code.",
  },
  {
    title: "Open any .md file",
    body: "Press Cmd/Ctrl + Shift + V for the styled preview. Use the MyMarkdown sidebar for Contents, or Cmd/Ctrl + Alt + B to beautify.",
  },
];

const LENS_STEPS = [
  {
    title: "Open the Markdown source",
    body: "Keep the .md editor focused — label commands are hidden while the Preview tab has focus.",
  },
  {
    title: "Ask for ideas",
    body: "Open the Command Palette and run “MyMarkdown: Suggest Label Lenses”.",
  },
  {
    title: "Pick a question",
    body: "Choose one of the three suggestions, or run “MyMarkdown: Label Document…” to ask your own.",
  },
  {
    title: "Explore the answer",
    body: "The preview shows colored chips and bars. Click a chip to jump through its matches; use the first chip to switch lenses.",
  },
];

function ExtensionPage() {
  const [copied, setCopied] = useState(false);
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <main className="relative min-h-screen overflow-x-clip bg-background px-5 pb-20 pt-6 text-foreground sm:px-8">
      <div className="pointer-events-none fixed -right-32 -top-32 size-[34rem] rounded-full bg-primary/15 blur-[130px]" />

      <div className="relative mx-auto max-w-4xl">
        <nav className="flex items-center justify-between text-sm">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to MyMarkdown
          </Link>
          <ThemeToggle />
        </nav>

        <header className="mt-10 flex flex-col items-center text-center">
          <img
            src={heroImage.url}
            alt="MyMarkdown logo"
            className="mb-4 size-24 object-contain"
            draggable={false}
          />
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Understand Markdown,
            <br className="hidden sm:block" /> without leaving VS Code
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            A beautiful preview for everyday reading, plus AI lenses that reveal how a long document
            is organized, connected, or unfinished.
          </p>
          <div className="mt-6">
            <Button
              asChild
              size="lg"
              className="h-12 gap-2.5 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90"
            >
              <a href={VSIX} download target="_blank" rel="noopener noreferrer">
                <Download />
                Download for VS Code
              </a>
            </Button>
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground">
            Version {VERSION} · about 1 MB · works with VS Code 1.85+
          </p>
        </header>

        <figure className="mt-10 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xl shadow-foreground/10">
          <img
            src={overviewImage.url}
            alt="MyMarkdown showing a support report in the Markdown editor and formatted VS Code preview with AI label lenses"
            className="block h-auto w-full"
            draggable={false}
          />
        </figure>

        <section className="mt-12 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <article
              key={feature.title}
              className="frosted-surface rounded-2xl p-5 ring-1 ring-card/80"
            >
              <feature.icon className="size-5 text-primary" />
              <h2 className="mt-3 text-sm font-semibold">{feature.title}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{feature.body}</p>
            </article>
          ))}
        </section>

        <section className="mt-14 overflow-hidden rounded-3xl border border-border/70 bg-card/55 shadow-sm">
          <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[1.05fr_.95fr] md:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Tags className="size-3.5" /> AI label lenses
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">
                Ask the document a question
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                A lens turns one useful question into a visual map of the document. Labels are saved
                beside your workspace, so you can return to them or keep several views of the same
                file.
              </p>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Example: ask{" "}
                <span className="font-medium text-foreground">“Which parts need more work?”</span>{" "}
                and the preview can mark sections as Complete, Needs decision, or Missing detail.
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4 shadow-inner">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Which parts need more work?
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  ● Complete · 3
                </span>
                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  ● Needs decision · 2
                </span>
                <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                  ● Missing detail · 1
                </span>
              </div>
              <div className="mt-5 space-y-2.5">
                <div className="h-2 w-4/5 rounded-full bg-foreground/10" />
                <div className="flex gap-2">
                  <span className="w-1 rounded-full bg-amber-500" />
                  <div className="h-12 flex-1 rounded-lg bg-foreground/[.055]" />
                </div>
                <div className="h-2 w-3/5 rounded-full bg-foreground/10" />
                <div className="flex gap-2">
                  <span className="w-1 rounded-full bg-rose-500" />
                  <div className="h-8 flex-1 rounded-lg bg-foreground/[.055]" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-14">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold tracking-tight">Create your first lens</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing is generated just by opening a file. You stay in control.
            </p>
          </div>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {LENS_STEPS.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-border/70 bg-card/45 p-5">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <h3 className="mt-3 text-sm font-medium">{step.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14 rounded-3xl border border-border/70 bg-card/45 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <Bot className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Use the AI you already have</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                MyMarkdown stores no AI key. Choose a model available through VS Code, or connect a
                trusted command-line AI. AI runs only when you request a lens.
              </p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-background/70 p-5 ring-1 ring-border/60">
              <h3 className="text-sm font-medium">VS Code model</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                The default <code className="text-foreground">auto</code> mode uses an authorized
                provider such as GitHub Copilot when VS Code exposes one.
              </p>
            </div>
            <div className="rounded-2xl bg-background/70 p-5 ring-1 ring-border/60">
              <h3 className="text-sm font-medium">CLI provider</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                For Cursor or a local workflow, set the provider to{" "}
                <code className="text-foreground">cli</code> and use a command such as{" "}
                <code className="text-foreground">claude -p</code>.
              </p>
            </div>
          </div>
          <details className="group mt-5 rounded-xl border border-border/60 bg-background/50 px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">
              Using Cursor or seeing “No AI provider available”?
            </summary>
            <div className="mt-3 space-y-3 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
              <p>
                Open{" "}
                <span className="font-medium text-foreground">
                  Preferences: Open User Settings (JSON)
                </span>
                , then add:
              </p>
              <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] leading-5 text-zinc-100">
                <code>{`"mymarkdown.labels.provider": "cli",
"mymarkdown.labels.cliCommand": "claude -p --output-format text --max-turns 1"`}</code>
              </pre>
              <p>
                Reload the window, focus the Markdown source tab, and run{" "}
                <span className="font-medium text-foreground">
                  MyMarkdown: Suggest Label Lenses
                </span>
                .
              </p>
            </div>
          </details>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Privacy note: previews, beautify, contents, and lint stay local. When you request AI
            labels, the document is sent to the provider you selected.
          </p>
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold tracking-tight">Install the extension</h2>
          <ol className="mt-5 space-y-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3.5">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-medium">{step.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-6">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Prefer the terminal?</p>
            <div className="flex items-center gap-3 rounded-xl bg-zinc-900 px-4 py-3.5 ring-1 ring-zinc-800 dark:bg-zinc-950">
              <Terminal className="size-4 shrink-0 text-zinc-500" />
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-100 sm:text-sm">
                {INSTALL_COMMAND}
              </code>
              <button
                type="button"
                onClick={copyCommand}
                aria-label={copied ? "Copied" : "Copy command"}
                title={copied ? "Copied" : "Copy command"}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-zinc-800 px-3 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Run it from the folder where you saved the file.
            </p>
          </div>
        </section>

        <footer className="mt-14 text-center text-xs text-muted-foreground">
          Something not working, or an idea to make it better?{" "}
          <a
            href="mailto:ardalan@mylens.ai?subject=MyMarkdown%20VS%20Code%20extension"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Contact me
          </a>
        </footer>
      </div>
    </main>
  );
}
