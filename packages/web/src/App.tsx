import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph, layoutGraph, parseJenkinsfile, toMermaid, toSvg, type PipelineLayout, type SourceRange, type Stage } from '@jpv/core';
import { Canvas } from './Canvas';
import { Details } from './Details';
import { Editor, type EditorHandle } from './Editor';
import { SAMPLES } from './samples';

/** Host bridge, so IDE plugins (IntelliJ via JCEF, VS Code webview) can drive the viewer. */
declare global {
  interface Window {
    jpv?: { setSource: (text: string) => void };
    jpvHost?: { onSelect?: (range: SourceRange) => void };
  }
}

function indexStages(stages: Stage[], map = new Map<string, Stage>()) {
  for (const s of stages) {
    map.set(s.id, s);
    if (s.body.kind === 'stages') indexStages(s.body.stages, map);
    if (s.body.kind === 'parallel') indexStages(s.body.branches, map);
    if (s.body.kind === 'matrix') indexStages(s.body.matrix.stages, map);
  }
  return map;
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const WRAP_KEY = 'jpv.wrap';

function readWrap() {
  try {
    return localStorage.getItem(WRAP_KEY) !== 'false';
  } catch {
    return true;
  }
}

function saveWrap(wrap: boolean) {
  try {
    localStorage.setItem(WRAP_KEY, String(wrap));
  } catch {
    // Storage can be blocked; the choice then just lasts until reload.
  }
}

const initialSample = SAMPLES.find((s) => s.name.includes('kitchen-sink')) ?? SAMPLES[0];

export function App() {
  const [source, setSource] = useState(initialSample?.text ?? '');
  const [debounced, setDebounced] = useState(source);
  const [sampleName, setSampleName] = useState(initialSample?.name ?? '');
  const [fileName, setFileName] = useState('Jenkinsfile');
  const [layout, setLayout] = useState<PipelineLayout | null>(null);
  const [selected, setSelected] = useState<string | undefined>();
  const [toast, setToast] = useState('');
  const [dragging, setDragging] = useState(false);
  const [wrap, setWrap] = useState(readWrap);
  const editor = useRef<EditorHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(source), 250);
    return () => clearTimeout(t);
  }, [source]);

  const result = useMemo(() => parseJenkinsfile(debounced), [debounced]);
  const stages = useMemo(() => indexStages(result.pipeline?.stages ?? []), [result]);

  useEffect(() => {
    let cancelled = false;
    if (!result.pipeline) {
      setLayout(null);
      return;
    }
    layoutGraph(buildGraph(result.pipeline))
      .then((l) => !cancelled && setLayout(l))
      .catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, [result]);

  useEffect(() => {
    if (selected && !stages.has(selected)) setSelected(undefined);
  }, [stages, selected]);

  const reveal = useCallback((r: SourceRange) => {
    editor.current?.reveal(r);
    window.jpvHost?.onSelect?.(r);
  }, []);

  const select = useCallback(
    (id: string | undefined) => {
      setSelected(id);
      const st = id ? stages.get(id) : undefined;
      if (st) reveal(st.headerLoc);
    },
    [stages, reveal],
  );

  const onCursor = useCallback(
    (offset: number) => {
      // innermost stage containing the cursor
      let best: Stage | undefined;
      for (const s of stages.values()) if (offset >= s.loc.start && offset <= s.loc.end && (!best || s.loc.end - s.loc.start < best.loc.end - best.loc.start)) best = s;
      setSelected(best?.id);
    },
    [stages],
  );

  const loadText = useCallback((text: string, name: string) => {
    setSource(text);
    setDebounced(text);
    setFileName(name);
    setSelected(undefined);
  }, []);

  useEffect(() => {
    window.jpv = { setSource: (t: string) => loadText(t, 'Jenkinsfile') };
  }, [loadText]);

  const openFile = async (f: File) => {
    loadText(await f.text(), f.name);
    setSampleName('');
  };

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  };

  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning').length;
  const selectedStage = selected ? stages.get(selected) : undefined;
  const base = fileName.replace(/\.[^.]*$/, '') || 'Jenkinsfile';

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) openFile(f);
      }}
    >
      <header className="toolbar">
        <div className="brand">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
            <circle cx="3" cy="10" r="2.5" fill="currentColor" />
            <rect x="7" y="3" width="6" height="5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="7" y="12" width="6" height="5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="17" cy="10" r="2.5" fill="currentColor" />
          </svg>
          Jenkinsfile Visualizer
        </div>
        <label className="sample">
          Sample
          <select
            value={sampleName}
            onChange={(e) => {
              const s = SAMPLES.find((x) => x.name === e.target.value);
              setSampleName(e.target.value);
              if (s) loadText(s.text, s.name.split('/').pop()!);
            }}
          >
            <option value="">(your file)</option>
            {SAMPLES.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => fileInput.current?.click()}>Open file…</button>
        <input ref={fileInput} type="file" hidden onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} />
        <span className="spacer" />
        <span className={`status ${errors ? 'err' : warnings ? 'warn' : 'ok'}`}>
          {result.kind === 'scripted' ? 'Scripted pipeline' : errors ? `${errors} error${errors > 1 ? 's' : ''}` : warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : `${stages.size} stages`}
        </span>
        <label className="sample" title="Wrap the diagram to the width of the preview">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(e) => {
              setWrap(e.target.checked);
              saveWrap(e.target.checked);
            }}
          />
          Wrap
        </label>
        <button
          disabled={!result.pipeline}
          onClick={async () => {
            const mm = toMermaid(result.pipeline!);
            try {
              await navigator.clipboard.writeText('```mermaid\n' + mm + '```\n');
              flash('Mermaid copied to clipboard');
            } catch {
              download(`${base}.mmd`, mm, 'text/plain');
            }
          }}
        >
          Copy Mermaid
        </button>
        <button disabled={!layout} onClick={() => layout && download(`${base}.svg`, toSvg(layout), 'image/svg+xml')}>
          Download SVG
        </button>
      </header>

      <main className="panes">
        <section className="pane-editor">
          <Editor value={source} onChange={setSource} onCursor={onCursor} diagnostics={result.diagnostics} highlight={selectedStage?.loc} handleRef={editor} />
          {result.diagnostics.length > 0 && (
            <ul className="diagnostics">
              {result.diagnostics.map((d, i) => (
                <li key={i} className={d.severity} onClick={() => reveal(d.loc)}>
                  <span className="sev">{d.severity}</span>
                  <span className="ln">L{d.loc.line}</span>
                  {d.message}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="pane-canvas">
          {result.pipeline ? (
            <Canvas pipeline={result.pipeline} wrap={wrap} selectedStageId={selected} onSelect={select} />
          ) : (
            <div className="empty">
              <h2>{result.kind === 'scripted' ? 'This is a scripted pipeline' : 'No declarative pipeline found'}</h2>
              <p>
                {result.kind === 'scripted'
                  ? 'Scripted pipelines (node { … }) are plain Groovy programs, so their stages are only known when they run. Only declarative pipelines (pipeline { … }) can be drawn.'
                  : 'Paste a Jenkinsfile that starts with pipeline { … }, open a file, or drop one here.'}
              </p>
            </div>
          )}
        </section>
        <aside className="pane-details">
          <Details result={result} stage={selectedStage} onReveal={reveal} />
        </aside>
      </main>
      {toast && <div className="toast">{toast}</div>}
      {dragging && <div className="drop">Drop a Jenkinsfile to visualize it</div>}
    </div>
  );
}
