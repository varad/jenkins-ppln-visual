import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { buildGraph, layoutGraph, parseJenkinsfile, toSvg, type PipelineLayout } from '@jpv/core';
import './embed.css';

/** View-only page for IDE plugins: the IDE owns the editor and pushes text and theme in. */
declare global {
  interface Window {
    jpvView: {
      setSource: (text: string) => void;
      setTheme: (dark: boolean, background: string) => void;
    };
  }
}

let source: string | null = null;
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
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function Viewer() {
  const text = useSyncExternalStore(subscribe, () => source);
  const result = useMemo(() => parseJenkinsfile(text ?? ''), [text]);
  const [layout, setLayout] = useState<PipelineLayout | null>(null);

  useEffect(() => {
    if (!result.pipeline) {
      setLayout(null);
      return;
    }
    let cancelled = false;
    layoutGraph(buildGraph(result.pipeline))
      .then((l) => !cancelled && setLayout(l))
      .catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, [result]);

  const svg = useMemo(() => (layout ? toSvg(layout) : ''), [layout]);

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
  return <div className="svg-preview" dangerouslySetInnerHTML={{ __html: svg }} />;
}

createRoot(document.getElementById('root')!).render(<Viewer />);
