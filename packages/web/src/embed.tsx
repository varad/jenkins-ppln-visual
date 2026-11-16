import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { applyEdit, parseJenkinsfile, toSvg, type StageEdit } from '@jpv/core';
import { indexStages, innermostStage } from './stages';
import { RELEASE_POINTER, useStageDrag } from './useStageDrag';
import { useStageRename } from './useStageRename';
import { useWrappedLayout } from './useWrappedLayout';
import './embed.css';

/** Diagram page for IDE plugins: the IDE owns the editor, pushes text and theme in, and hears about stage clicks. */
declare global {
  interface Window {
    jpvView: {
      /** `version` (the IDE's document stamp) comes back with stage moves, so edits to stale text are dropped. */
      setSource: (text: string, version?: number) => void;
      setTheme: (dark: boolean, background: string) => void;
      setWrap: (wrap: boolean) => void;
      setCaret: (offset: number | null) => void;
      /**
       * The host saw the mouse button go up while the page was still dragging a stage: the page missed the release
       * (an IDE popup took it, say). `drop` when it was let go over the diagram, so the drag drops; otherwise it is cancelled.
       */
      releasePointer: (drop: boolean) => void;
    };
  }
}

let source: string | null = null;
let version = 0;
let wrap = true;
let caret: number | null = null;
const listeners = new Set<() => void>();

// Defined at module scope so it exists by the time the host sees the page's load event.
window.jpvView = {
  setSource(text, v = 0) {
    source = text;
    version = v;
    listeners.forEach((l) => l());
  },
  setTheme(dark, background) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.setProperty('--bg', background);
  },
  setWrap(value) {
    wrap = value;
    listeners.forEach((l) => l());
  },
  setCaret(offset) {
    caret = offset;
    listeners.forEach((l) => l());
  },
  releasePointer(drop) {
    window.dispatchEvent(new CustomEvent(RELEASE_POINTER, { detail: { drop } }));
  },
};

// Errors in an IDE's embedded browser are otherwise invisible; hand them to the host's log.
window.addEventListener('error', (e) => window.jpvHost?.onError?.(String(e.error?.stack ?? e.message)));
window.addEventListener('unhandledrejection', (e) => window.jpvHost?.onError?.(String(e.reason?.stack ?? e.reason)));

let cursor: HostCursor = 'default';
let dragging = false;

/** Out-of-process JCEF drops CSS cursor changes, so the IDE has to set the pointer itself. */
function reportCursor(next: HostCursor) {
  if (dragging && next !== 'grabbing') return;
  if (next === cursor) return;
  cursor = next;
  window.jpvHost?.onCursor?.(next);
}

/** Applies a stage move, rename or removal locally right away, and asks the IDE to make the same edit to its document. */
function applyStageEdit(m: StageEdit, label: string) {
  if (source === null) return;
  window.jpvHost?.onEdit?.({ ...m.edit, version, select: m.stageOffset, label });
  source = applyEdit(source, m.edit);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function Viewer() {
  const text = useSyncExternalStore(subscribe, () => source);
  const result = useMemo(() => parseJenkinsfile(text ?? ''), [text]);
  const wrapped = useSyncExternalStore(subscribe, () => wrap);
  const { container, setContainer, layout } = useWrappedLayout(result.pipeline, wrapped);
  useStageDrag({
    container,
    layout,
    pipeline: result.pipeline,
    source: text ?? '',
    onMove: (m) => applyStageEdit(m, 'Move Stage'),
    onRemove: (m) => applyStageEdit(m, 'Remove Stage'),
    onDragChange: (d) => {
      dragging = d;
      reportCursor(d ? 'grabbing' : 'default');
    },
  });
  useStageRename({
    container,
    layout,
    pipeline: result.pipeline,
    source: text ?? '',
    onRename: (m) => applyStageEdit(m, 'Rename Stage'),
    // The clicks before a double-click hand focus to the IDE's text editor; take it back for typing.
    onEditStart: () => window.jpvHost?.onFocus?.(),
  });
  const svg = useMemo(() => (layout ? toSvg(layout) : ''), [layout]);
  const stages = useMemo(() => indexStages(result.pipeline?.stages ?? []), [result]);
  const caretOffset = useSyncExternalStore(subscribe, () => caret);
  const selected = useMemo(() => (caretOffset === null ? undefined : innermostStage(stages, caretOffset)?.id), [stages, caretOffset]);

  useEffect(() => {
    container?.querySelectorAll('[data-stage-id]').forEach((el) => {
      el.classList.toggle('selected', el.getAttribute('data-stage-id') === selected);
    });
  }, [container, svg, selected]);

  if (text === null) return null;
  if (!result.pipeline) {
    return (
      <div className="empty">
        <h2>{result.kind === 'scripted' ? 'This is a scripted pipeline' : 'No declarative pipeline found'}</h2>
        <p>
          {result.kind === 'scripted'
            ? 'Scripted pipelines (node { … }) are plain Groovy programs, so their stages are only known when they run. Only declarative pipelines (pipeline { … }) can be drawn.'
            : 'Only files with a declarative pipeline { … } block can be drawn.'}
        </p>
      </div>
    );
  }
  // toSvg escapes all text taken from the Jenkinsfile.
  return (
    <div
      ref={setContainer}
      className="svg-preview"
      dangerouslySetInnerHTML={{ __html: svg }}
      onMouseOver={(e) => {
        const t = e.target as Element;
        reportCursor(
          t.matches('[data-stage-id].renamable > text:not(.jpv-quiet)')
            ? 'text'
            : t.closest('[data-stage-id].movable')
              ? 'grab'
              : t.closest('[data-stage-id], [data-post]')
                ? 'pointer'
                : 'default',
        );
      }}
      onMouseLeave={() => reportCursor('default')}
      onClick={(e) => {
        const target = e.target as Element;
        const id = target.closest('[data-stage-id]')?.getAttribute('data-stage-id');
        const range = id ? stages.get(id)?.headerLoc : target.closest('[data-post]') ? result.pipeline?.post?.loc : undefined;
        if (range) window.jpvHost?.onSelect?.(range);
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Viewer />);
