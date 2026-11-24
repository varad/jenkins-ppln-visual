import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LOCALES, applyEdit, buildGraph, formatMessage, layoutGraph, parseJenkinsfile, toMermaid, toSvg, translator, type Locale, type PipelineLayout, type SourceRange, type StageEdit, type TextEdit } from '@jpv/core';
import { Canvas } from './Canvas';
import { Details } from './Details';
import { Editor, type EditorHandle } from './Editor';
import { SAMPLES } from './samples';
import { indexStages, innermostStage } from './stages';
import { LocaleContext, initialLocale, saveLocale } from './i18n';

/** Host bridge, so IDE plugins (IntelliJ via JCEF, VS Code webview) can drive the viewer. */
declare global {
  interface Window {
    jpv?: { setSource: (text: string) => void };
    jpvHost?: {
      onSelect?: (range: SourceRange) => void;
      onCursor?: (cursor: HostCursor) => void;
      /**
       * A stage was moved or renamed in the diagram: apply `edit` to the document if it is still at `version`,
       * then select the stage at `select`. `label` names the undoable command.
       */
      onEdit?: (edit: TextEdit & { version: number; select: number; label: string }) => void;
      /** A stage name box opened in the diagram, so the page needs keyboard focus. */
      onFocus?: () => void;
      /** An uncaught error in the page, for the host's log. */
      onError?: (message: string) => void;
    };
  }
  type HostCursor = 'default' | 'pointer' | 'grab' | 'grabbing' | 'text';
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
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const tr = useMemo(() => translator(locale), [locale]);
  const editor = useRef<EditorHandle | null>(null);
  /** Source offset of a stage just moved or renamed in the diagram, to select once the new text is parsed. */
  const movedTo = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = tr('ui.title');
  }, [locale, tr]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(source), 250);
    return () => clearTimeout(t);
  }, [source]);

  const result = useMemo(() => parseJenkinsfile(debounced), [debounced]);
  const stages = useMemo(() => indexStages(result.pipeline?.stages ?? []), [result]);
  /** The diagnostics with their messages in the viewer's language. */
  const diagnostics = useMemo(() => result.diagnostics.map((d) => ({ ...d, message: formatMessage(d, locale) })), [result, locale]);

  useEffect(() => {
    let cancelled = false;
    if (!result.pipeline) {
      setLayout(null);
      return;
    }
    layoutGraph(buildGraph(result.pipeline, { locale }))
      .then((l) => !cancelled && setLayout(l))
      .catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, [result, locale]);

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

  useEffect(() => {
    if (movedTo.current === null) return;
    const st = innermostStage(stages, movedTo.current);
    movedTo.current = null;
    if (st) select(st.id);
  }, [stages, select]);

  const onEdit = useCallback(
    (m: StageEdit) => {
      // The edit was computed against the parsed text; drop it if typing has moved on since.
      if (source !== debounced || !editor.current) return;
      editor.current.replace(m.edit.start, m.edit.end, m.edit.text);
      movedTo.current = m.stageOffset;
      setDebounced(applyEdit(debounced, m.edit));
    },
    [source, debounced],
  );

  const onCursor = useCallback(
    (offset: number) => {
      setSelected(innermostStage(stages, offset)?.id);
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
    <LocaleContext.Provider value={locale}>
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
          {tr('ui.title')}
        </div>
        <label className="sample">
          {tr('ui.sample')}
          <select
            value={sampleName}
            onChange={(e) => {
              const s = SAMPLES.find((x) => x.name === e.target.value);
              setSampleName(e.target.value);
              if (s) loadText(s.text, s.name.split('/').pop()!);
            }}
          >
            <option value="">{tr('ui.yourFile')}</option>
            {SAMPLES.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => fileInput.current?.click()}>{tr('ui.openFile')}</button>
        <input ref={fileInput} type="file" hidden onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} />
        <span className="spacer" />
        <span className={`status ${errors ? 'err' : warnings ? 'warn' : 'ok'}`}>
          {result.kind === 'scripted' ? tr('ui.scripted') : errors ? tr('ui.errors', { n: errors }) : warnings ? tr('ui.warnings', { n: warnings }) : tr('ui.stages', { n: stages.size })}
        </span>
        <label className="sample" title={tr('ui.wrapTitle')}>
          <input
            type="checkbox"
            checked={wrap}
            onChange={(e) => {
              setWrap(e.target.checked);
              saveWrap(e.target.checked);
            }}
          />
          {tr('ui.wrap')}
        </label>
        <button
          disabled={!result.pipeline}
          onClick={async () => {
            const mm = toMermaid(result.pipeline!, { locale });
            try {
              await navigator.clipboard.writeText('```mermaid\n' + mm + '```\n');
              flash(tr('ui.mermaidCopied'));
            } catch {
              download(`${base}.mmd`, mm, 'text/plain');
            }
          }}
        >
          {tr('ui.copyMermaid')}
        </button>
        <button disabled={!layout} onClick={() => layout && download(`${base}.svg`, toSvg(layout), 'image/svg+xml')}>
          {tr('ui.downloadSvg')}
        </button>
        <label className="sample">
          <select
            value={locale}
            title={tr('ui.language')}
            aria-label={tr('ui.language')}
            onChange={(e) => {
              const l = e.target.value as Locale;
              setLocale(l);
              saveLocale(l);
            }}
          >
            {LOCALES.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="panes">
        <section className="pane-editor">
          <Editor value={source} onChange={setSource} onCursor={onCursor} diagnostics={diagnostics} highlight={selectedStage?.loc} handleRef={editor} />
          {diagnostics.length > 0 && (
            <ul className="diagnostics">
              {diagnostics.map((d, i) => (
                <li key={i} className={d.severity} onClick={() => reveal(d.loc)}>
                  <span className="sev">{tr(`ui.severity.${d.severity}`)}</span>
                  <span className="ln">{tr('ui.lineShort', { line: d.loc.line })}</span>
                  {d.message}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="pane-canvas">
          {result.pipeline ? (
            <Canvas
              pipeline={result.pipeline}
              source={debounced}
              wrap={wrap}
              selectedStageId={selected}
              onSelect={select}
              onPostClick={() => result.pipeline?.post && reveal(result.pipeline.post.loc)}
              onEdit={onEdit}
            />
          ) : (
            <div className="empty">
              <h2>{result.kind === 'scripted' ? tr('ui.scriptedTitle') : tr('ui.noneTitle')}</h2>
              <p>{result.kind === 'scripted' ? tr('ui.scriptedBody') : tr('ui.noneBody')}</p>
            </div>
          )}
        </section>
        <aside className="pane-details">
          <Details result={result} stage={selectedStage} onReveal={reveal} />
        </aside>
      </main>
      {toast && <div className="toast">{toast}</div>}
      {dragging && <div className="drop">{tr('ui.dropHint')}</div>}
    </div>
    </LocaleContext.Provider>
  );
}
