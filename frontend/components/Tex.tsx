import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Renders a LaTeX string with KaTeX. Inputs are our own formula strings, not user content.
 * \htmlClass is allowed so formulas can tag variables (e.g. var-vs) for live highlighting.
 */
export function Tex({ children, block = false }: { children: string; block?: boolean }) {
  const html = useMemo(
    () =>
      katex.renderToString(children, {
        displayMode: block,
        throwOnError: false,
        trust: (ctx) => ctx.command === "\\htmlClass",
        strict: (code: string) => (code === "htmlExtension" ? "ignore" : "warn"),
      }),
    [children, block],
  );
  return <span className={block ? "tex block" : "tex"} dangerouslySetInnerHTML={{ __html: html }} />;
}
