import { useMemo, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { parseJenkinsfile, toSvg } from '@jpv/core';
import { indexStages } from './stages';
import { useWrappedLayout } from './useWrappedLayout';
import './embed.css';

/** Diagram page for IDE plugins: the IDE owns the editor, pushes text and theme in, and hears about stage clicks. */
declare global {
  interface Window {
    jpvView: {
      setSource: (text: string) => void;
      setTheme: (dark: boolean, background: string) => void;
      setWrap: (wrap: boolean) => void;
    };
  }
}

let source: string | null = null;
let wrap = true;
const listeners = new Set<() => void>();

// Defined at module scope so it exists by the time the host sees the page's load event.
window.jpvView = {
  setSource(text) {
    source = text;
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
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function Viewer() {
  const text = useSyncExternalStore(subscribe, () => source);
  const result = useMemo(() => parseJenkinsfile(text ?? ''), [text]);
  const wrapped = useSyncExternalStore(subscribe, () => wrap);
  const { setContainer, layout } = useWrappedLayout(result.pipeline, wrapped);
  const svg = useMemo(() => (layout ? toSvg(layout) : ''), [layout]);
  const stages = useMemo(() => indexStages(result.pipeline?.stages ?? []), [result]);

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
