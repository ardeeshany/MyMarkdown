import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, ListTree, Palette, Sparkles } from "lucide-react";

import heroImage from "@/assets/mymarkdown-logo-v2.webp.asset.json";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const VSIX = "/mymarkdown-0.1.6.vsix";

export const Route = createFileRoute("/vscode-extension")({
  head: () => ({
    meta: [
      { title: "MyMarkdown for VS Code — Styled Markdown Preview Extension" },
      { name: "description", content: "Download the MyMarkdown VS Code extension: colorful headings, formatted JSON, a beautify command, and a clickable table of contents, all offline." },
      { property: "og:title", content: "MyMarkdown for VS Code — Styled Markdown Preview Extension" },
      { property: "og:description", content: "Colorful headings, formatted JSON, beautify, and a clickable table of contents right inside VS Code." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://mymarkdown.site/vscode-extension" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "MyMarkdown for VS Code" },
      { name: "twitter:description", content: "Colorful headings, formatted JSON, beautify, and a clickable table of contents right inside VS Code." },
    ],
    links: [{ rel: "canonical", href: "https://mymarkdown.site/vscode-extension" }],
  }),
  component: ExtensionPage,
});

const FEATURES = [
  { icon: Palette, title: "Styled live preview", body: "The same look as the website: vivid H1–H3 headings, JSON one field per line with coloured field names, and calm code blocks. Updates as you type." },
  { icon: Sparkles, title: "Beautify command", body: "Rewrites the open file — tidy spacing, indented JSON, and bare or backtick-wrapped JSON promoted into proper code blocks. One undo reverses it all." },
  { icon: ListTree, title: "Clickable contents", body: "Every H1, H2, and H3 in a sidebar. Click to jump, collapse a section you are done with." },
];

const STEPS = [
  { title: "Download the file", body: "Grab the .vsix file above and save it anywhere on your computer." },
  { title: "Install it in VS Code", body: "Open VS Code, press Cmd/Ctrl + Shift + P, run “Extensions: Install from VSIX…”, and pick the file you just downloaded." },
  { title: "Reload the window", body: "Run “Developer: Reload Window” from the same menu, or just restart VS Code." },
  { title: "Open any .md file", body: "Press Cmd/Ctrl + Alt + V for the styled preview (the tab reads “MyMarkdown: …”), click the sparkle button to beautify, and open the MyMarkdown icon in the sidebar for Contents. Cmd/Ctrl + Shift + V is VS Code’s own plain preview — not this one." },
];

function ExtensionPage() {
  return (
    <main className="relative min-h-screen overflow-x-clip bg-background px-5 pb-20 pt-6 text-foreground sm:px-8">
      <div className="pointer-events-none fixed -right-32 -top-32 size-[34rem] rounded-full bg-primary/15 blur-[130px]" />

      <div className="relative mx-auto max-w-3xl">
        <nav className="flex items-center justify-between text-sm">
          <Link to="/" className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" />Back to MyMarkdown
          </Link>
          <ThemeToggle />
        </nav>

        <header className="mt-10 flex flex-col items-center text-center">
          <img src={heroImage.url} alt="MyMarkdown logo" className="mb-4 size-24 object-contain" draggable={false} />
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            MyMarkdown, inside VS Code
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            The same beautiful reading experience while you edit. Everything runs on your machine — no account, no internet, nothing leaves your computer.
          </p>
          <div className="mt-6">
            <Button asChild size="lg" className="h-11 rounded-full bg-primary px-7 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90">
              <a href={VSIX} download target="_blank" rel="noopener noreferrer">
                <Download />Download for VS Code
              </a>
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Version 0.1.6 · about 13 KB · works with VS Code 1.85+</p>
        </header>

        <section className="mt-12 grid gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="frosted-surface rounded-2xl p-5 ring-1 ring-card/80">
              <feature.icon className="size-5 text-primary" />
              <h2 className="mt-3 text-sm font-semibold">{feature.title}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{feature.body}</p>
            </article>
          ))}
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold tracking-tight">Setting it up</h2>
          <ol className="mt-5 space-y-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3.5">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                <div>
                  <h3 className="text-sm font-medium">{step.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-xs text-muted-foreground">
            Prefer the terminal? Run <code className="rounded bg-muted px-1.5 py-0.5">code --install-extension mymarkdown-0.1.6.vsix</code> from the folder you saved it in.
          </p>
        </section>

        <footer className="mt-14 text-center text-xs text-muted-foreground">
          Something not working, or an idea to make it better?{" "}
          <a href="mailto:ardalan@mylens.ai?subject=MyMarkdown%20VS%20Code%20extension" className="underline underline-offset-4 hover:text-foreground">
            Contact me
          </a>
        </footer>
      </div>
    </main>
  );
}
