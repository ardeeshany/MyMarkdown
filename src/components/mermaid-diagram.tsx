import { useEffect, useRef, useState } from "react";

let counter = 0;

/** Renders a ```mermaid block as a diagram; falls back to the source plus the error. */
export function MermaidDiagram({ value }: { value: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mymd-mermaid-${(counter += 1)}`);

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = document.documentElement.classList.contains("dark");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
        const { svg: out } = await mermaid.render(`${idRef.current}-${dark ? "d" : "l"}`, value);
        if (cancelled) return;
        setSvg(out);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setSvg(null);
        setError(cause instanceof Error ? cause.message : "This diagram could not be drawn.");
      }
    };

    void render();

    const observer = new MutationObserver(() => void render());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [value]);

  if (error) {
    return (
      <div className="mt-4 rounded-xl bg-foreground/[0.04] p-5 ring-1 ring-border/70">
        <p className="text-xs font-medium text-code-inline">{error}</p>
        <pre className="mt-3 overflow-x-hidden whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-foreground/80">{value}</pre>
      </div>
    );
  }

  if (!svg) {
    return <div className="mt-4 rounded-xl bg-foreground/[0.04] p-5 text-xs text-muted-foreground ring-1 ring-border/70">Drawing diagram…</div>;
  }

  return (
    <div
      className="mymd-mermaid mt-4 flex justify-center overflow-x-auto rounded-xl bg-foreground/[0.04] p-5 ring-1 ring-border/70"
      // eslint-disable-next-line react/no-danger -- Mermaid renders with securityLevel "strict".
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
