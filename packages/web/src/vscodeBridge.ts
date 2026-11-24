/**
 * Connects the diagram page to a VS Code webview. IntelliJ injects `window.jpvHost` and calls `window.jpvView` directly;
 * a VS Code webview can only exchange messages, so this turns those messages into the same calls. Does nothing outside VS Code.
 */
declare global {
  function acquireVsCodeApi(): { postMessage(message: unknown): void };
}

/** Messages from the extension: each one names a `window.jpvView` method and its arguments. */
type ViewMessage =
  | { type: 'setSource'; text: string; version: number }
  | { type: 'setWrap'; wrap: boolean }
  | { type: 'setCaret'; offset: number | null }
  | { type: 'setLocale'; locale: string };

if (typeof acquireVsCodeApi === 'function') {
  const vscode = acquireVsCodeApi();

  window.jpvHost = {
    onSelect: (range) => vscode.postMessage({ type: 'select', offset: range.start }),
    onEdit: (edit) => vscode.postMessage({ type: 'edit', edit }),
    onError: (message) => vscode.postMessage({ type: 'error', message }),
    // A webview shows CSS cursors itself and keeps the keyboard after a click, so these need nothing from the host.
    onCursor: () => {},
    onFocus: () => {},
  };

  window.addEventListener('message', (e: MessageEvent<ViewMessage>) => {
    const m = e.data;
    if (m.type === 'setSource') window.jpvView.setSource(m.text, m.version);
    else if (m.type === 'setWrap') window.jpvView.setWrap(m.wrap);
    else if (m.type === 'setCaret') window.jpvView.setCaret(m.offset);
    else if (m.type === 'setLocale') window.jpvView.setLocale(m.locale);
  });

  /** VS Code marks the theme with a class on body and exposes its colours as CSS variables. */
  const applyTheme = () => {
    const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
    const background = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
    window.jpvView.setTheme(dark, background || (dark ? '#1e1e1e' : '#ffffff'));
  };

  // window.jpvView is defined by embed.tsx after this module runs, so wait a turn before using it.
  setTimeout(() => {
    applyTheme();
    new MutationObserver(applyTheme).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    vscode.postMessage({ type: 'ready' });
  });
}

export {};
