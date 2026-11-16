import * as vscode from 'vscode';
import { PipelinePreview } from './preview';

const WRAP_KEY = 'jpv.wrap';

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Jenkinsfile Visualizer');
  const previews = new Map<string, PipelinePreview>();
  const host = {
    extensionUri: context.extensionUri,
    log,
    /** Whether diagrams wrap to the panel width. Shared by every preview and kept across restarts. */
    wrap: () => context.globalState.get(WRAP_KEY, true),
  };

  context.subscriptions.push(
    log,
    vscode.commands.registerCommand('jpv.openPreviewToSide', async (uri?: vscode.Uri) => {
      const document = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
      if (!document) return;
      const key = document.uri.toString();
      const existing = previews.get(key);
      if (existing) return existing.reveal();
      const code = vscode.window.visibleTextEditors.find((e) => e.document === document);
      const below = code && vscode.workspace.getConfiguration('jenkinsfileVisualizer').get('previewPosition') === 'below';
      // There's no column below, so open the preview in the code's group, then move it into the group below,
      // which the move creates if there isn't one. The move needs the preview to be the active editor.
      const preview = new PipelinePreview(
        document,
        host,
        () => previews.delete(key),
        below ? { viewColumn: code.viewColumn ?? vscode.ViewColumn.Active, preserveFocus: false } : { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      );
      previews.set(key, preview);
      if (below) {
        await vscode.commands.executeCommand('workbench.action.moveEditorToBelowGroup');
        await vscode.window.showTextDocument(document, { viewColumn: code.viewColumn, preserveFocus: false });
      }
    }),
    vscode.commands.registerCommand('jpv.toggleWrap', async () => {
      await context.globalState.update(WRAP_KEY, !host.wrap());
      previews.forEach((p) => p.refresh());
    }),
    { dispose: () => previews.forEach((p) => p.panel.dispose()) },
  );
}

export function deactivate() {}
