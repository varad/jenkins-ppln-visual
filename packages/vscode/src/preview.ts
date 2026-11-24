import * as vscode from 'vscode';

const DEBOUNCE_MS = 200;
export const VIEW_TYPE = 'jpv.preview';

/** A stage move, rename or removal from the diagram, as one replacement made against the document at `version`. */
interface StageEdit {
  start: number;
  end: number;
  text: string;
  version: number;
  /** Where the stage starts after the edit, to put the caret there; -1 for a removal. */
  select: number;
}

type PageMessage =
  | { type: 'ready' }
  | { type: 'select'; offset: number }
  | { type: 'edit'; edit: StageEdit }
  | { type: 'error'; message: string };

export interface PreviewHost {
  extensionUri: vscode.Uri;
  log: vscode.OutputChannel;
  wrap(): boolean;
}

/** The pipeline drawing for one document, in a webview panel. Redraws as the document changes. */
export class PipelinePreview {
  readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private pageReady = false;

  constructor(
    readonly document: vscode.TextDocument,
    private readonly host: PreviewHost,
    onDispose: () => void,
    showOptions: { viewColumn: vscode.ViewColumn; preserveFocus: boolean },
  ) {
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      vscode.l10n.t('Pipeline: {0}', document.uri.path.split('/').pop() ?? ''),
      showOptions,
      { enableScripts: true, localResourceRoots: [] },
    );

    this.panel.onDidDispose(() => {
      this.disposables.forEach((d) => d.dispose());
      clearTimeout(this.renderTimer);
      onDispose();
    });

    this.panel.webview.onDidReceiveMessage((m: PageMessage) => this.onMessage(m), null, this.disposables);

    vscode.workspace.onDidChangeTextDocument(
      (e) => e.document === this.document && this.scheduleRender(DEBOUNCE_MS),
      null,
      this.disposables,
    );
    vscode.workspace.onDidCloseTextDocument((d) => d === this.document && this.panel.dispose(), null, this.disposables);
    vscode.window.onDidChangeTextEditorSelection(
      (e) => e.textEditor.document === this.document && this.postCaret(e.textEditor),
      null,
      this.disposables,
    );

    // The page reloads whenever the panel is shown again, and asks for the source with 'ready' each time.
    this.panel.onDidChangeViewState(() => !this.panel.visible && (this.pageReady = false), null, this.disposables);

    void this.loadPage();
  }

  reveal() {
    this.panel.reveal(undefined, true);
  }

  refresh() {
    this.scheduleRender(0);
  }

  private async loadPage() {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.host.extensionUri, 'media', 'embed.html'));
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const csp =
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
      `script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;
    // Only the page's own script tag: the inlined bundle contains '<script' in string literals too.
    this.panel.webview.html = new TextDecoder()
      .decode(bytes)
      .replace('<head>', `<head>${csp}`)
      .replace('<script type="module"', `<script nonce="${nonce}" type="module"`);
  }

  private onMessage(m: PageMessage) {
    switch (m.type) {
      case 'ready':
        this.pageReady = true;
        this.render();
        break;
      case 'select':
        this.moveCaretTo(m.offset);
        break;
      case 'edit':
        void this.applyEdit(m.edit);
        break;
      case 'error':
        this.host.log.appendLine(`Jenkinsfile preview: ${m.message}`);
        break;
    }
  }

  /** The text editor showing this document, if one is on screen. */
  private editor(): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find((e) => e.document === this.document);
  }

  private moveCaretTo(offset: number) {
    const editor = this.editor();
    if (!editor) return;
    // The diagram can lag behind the text by the redraw delay, so the offset may be past the end; positionAt clamps it.
    const pos = this.document.positionAt(offset);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  /** Makes a stage edit from the diagram an undoable edit to the document, unless the document changed meanwhile. */
  private async applyEdit(edit: StageEdit) {
    const doc = this.document;
    const valid =
      typeof edit.text === 'string' &&
      edit.version === doc.version &&
      0 <= edit.start &&
      edit.start <= edit.end &&
      edit.end <= doc.getText().length;
    if (valid) {
      const change = new vscode.WorkspaceEdit();
      change.replace(doc.uri, new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end)), edit.text);
      if ((await vscode.workspace.applyEdit(change)) && edit.select >= 0) this.moveCaretTo(edit.select);
    }
    // The diagram already shows the edit; redraw from the document either way so they agree.
    this.scheduleRender(0);
  }

  private postCaret(editor: vscode.TextEditor) {
    if (this.pageReady) {
      void this.panel.webview.postMessage({ type: 'setCaret', offset: this.document.offsetAt(editor.selection.active) });
    }
  }

  private scheduleRender(delayMs: number) {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.render(), delayMs);
  }

  private render() {
    if (!this.pageReady) return;
    const editor = this.editor();
    const post = (m: object) => void this.panel.webview.postMessage(m);
    post({ type: 'setLocale', locale: vscode.env.language });
    post({ type: 'setWrap', wrap: this.host.wrap() });
    post({ type: 'setCaret', offset: editor ? this.document.offsetAt(editor.selection.active) : null });
    post({ type: 'setSource', text: this.document.getText(), version: this.document.version });
  }
}
