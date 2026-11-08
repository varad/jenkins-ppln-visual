import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { StreamLanguage } from '@codemirror/language';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import type { Diagnostic, SourceRange } from '@jpv/core';

export interface EditorHandle {
  reveal: (r: SourceRange) => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onCursor: (offset: number) => void;
  diagnostics: Diagnostic[];
  highlight?: SourceRange;
  handleRef: React.MutableRefObject<EditorHandle | null>;
}

const setMarks = StateEffect.define<{ diags: Diagnostic[]; highlight?: SourceRange }>();

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue;
      const doc = tr.state.doc;
      const items: { from: number; to: number; d: Decoration }[] = [];
      const clamp = (n: number) => Math.max(0, Math.min(doc.length, n));
      if (e.value.highlight) {
        const h = e.value.highlight;
        for (let l = h.line; l <= Math.min(h.endLine, doc.lines); l++) {
          const line = doc.line(l);
          items.push({ from: line.from, to: line.from, d: Decoration.line({ class: 'cm-stage-hl' }) });
        }
      }
      for (const d of e.value.diags) {
        const from = clamp(d.loc.start);
        const to = clamp(Math.max(d.loc.end, d.loc.start + 1));
        if (to > from) items.push({ from, to, d: Decoration.mark({ class: `cm-diag cm-diag-${d.severity}`, attributes: { title: d.message } }) });
      }
      items.sort((a, b) => a.from - b.from || (a.d.startSide ?? 0) - (b.d.startSide ?? 0));
      const b = new RangeSetBuilder<Decoration>();
      for (const it of items) b.add(it.from, it.to, it.d);
      deco = b.finish();
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function Editor({ value, onChange, onCursor, diagnostics, highlight, handleRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onCursor });
  cb.current = { onChange, onCursor };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          StreamLanguage.define(groovy),
          marksField,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
            const userSelect = u.transactions.some((t) => t.isUserEvent('select.pointer'));
            if (userSelect) cb.current.onCursor(u.state.selection.main.head);
          }),
        ],
      }),
    });
    view.current = v;
    handleRef.current = {
      reveal: (r) => {
        const len = v.state.doc.length;
        const from = Math.min(r.start, len);
        v.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
      },
    };
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (sample picker, file open)
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setMarks.of({ diags: diagnostics, highlight }) });
  }, [diagnostics, highlight]);

  return <div className="editor" ref={host} />;
}
