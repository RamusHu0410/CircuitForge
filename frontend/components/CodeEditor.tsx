import { useEffect, useRef } from "react";
import { basicSetup, EditorView, minimalSetup } from "codemirror";
import { lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { cpp } from "@codemirror/lang-cpp";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** Colours come from the app's CSS variables, so the editor follows the chosen theme. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.modifier], color: "var(--code-keyword)", fontWeight: "600" },
  { tag: [t.typeName, t.standard(t.typeName)], color: "var(--code-type)" },
  { tag: [t.number, t.bool], color: "var(--code-number)" },
  { tag: [t.string], color: "var(--code-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--dim)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--brand)" },
  { tag: [t.processingInstruction, t.macroName], color: "var(--code-macro)" },
]);

const theme = EditorView.theme({
  "&": { fontSize: "12.5px", backgroundColor: "var(--code-bg)", color: "var(--text)", borderRadius: "var(--radius)" },
  ".cm-content": { fontFamily: "var(--mono)", caretColor: "var(--brand)" },
  ".cm-gutters": { backgroundColor: "var(--code-bg)", color: "var(--dim)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--brand) 7%, transparent)" },
  "&.cm-focused": { outline: "1px solid color-mix(in srgb, var(--brand) 50%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--brand) 25%, transparent) !important" },
  ".cm-cursor": { borderLeftColor: "var(--brand)" },
});

/** C++ editor (CodeMirror 6). Controlled: `value` resets the document when it changes from outside. */
export function CodeEditor({ value, onChange, height = 420, readOnly = false, firstLine = 1 }: { value: string; onChange?: (v: string) => void; height?: number | "auto"; readOnly?: boolean; firstLine?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          // Read-only excerpts number their lines like the full sketch (firstLine).
          readOnly ? [minimalSetup, lineNumbers({ formatNumber: (n) => String(n + firstLine - 1) })] : basicSetup,
          cpp(),
          theme,
          syntaxHighlighting(highlight),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.updateListener.of((u) => u.docChanged && changeRef.current?.(u.state.doc.toString())),
        ],
      }),
    });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className={`code-editor${readOnly ? " readonly" : ""}`} style={{ height }} />;
}
