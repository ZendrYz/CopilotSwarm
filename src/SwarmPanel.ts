import * as vscode from 'vscode';
import { AgentStore } from './AgentStore';
import { SwarmEngine } from './SwarmEngine';
import { TaskType, SwarmMode, PipelineState, TASK_TYPE_META } from './types';

export class SwarmPanel {
  public static currentPanel: SwarmPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    private readonly _store: AgentStore,
    private readonly _engine: SwarmEngine,
  ) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'run': {
          // Budget warning check
          const resolvedMode = this._engine.resolveMode(msg.objective, msg.mode as SwarmMode);
          if (resolvedMode === 'deep' && this._engine.shouldWarnBudget()) {
            const pick = await vscode.window.showWarningMessage(
              'You\'ve used Deep Mode several times. Switch to Quick Mode to save requests?',
              'Use Quick Mode', 'Keep Deep Mode'
            );
            if (pick === 'Use Quick Mode') {
              msg.mode = 'quick';
            } else if (!pick) {
              this._panel.webview.postMessage({
                type: 'pipelineUpdate',
                pipeline: { phase: 'error', summary: 'Run cancelled by user.', activeAgents: [], completedAgents: [] }
              });
              return; // User dismissed the dialog, cancel the run
            }
          }
          this._panel.webview.postMessage({ type: 'clearLogs' });
          this._engine.run(
            msg.objective,
            msg.taskType as TaskType,
            msg.mode as SwarmMode,
            (agentId, chunk) => this._panel.webview.postMessage({ type: 'streamChunk', agentId, chunk }),
            (action) => this._panel.webview.postMessage({ type: 'fileAction', action }),
            (pipeline) => this._panel.webview.postMessage({ type: 'pipelineUpdate', pipeline }),
          );
          break;
        }
        case 'stopAll': this._engine.stopAll(); break;
        case 'applyChanges': {
          await this._engine.applyEdits(msg.edits);
          this._panel.webview.postMessage({ type: 'clearLogs' });
          break;
        }
        case 'confirmApply': {
          // window.confirm doesn't work in webviews - use native VSCode dialog
          const answer = await vscode.window.showWarningMessage(
            `Apply all ${msg.count} proposed changes to your workspace?`,
            { modal: true },
            'Apply All'
          );
          if (answer === 'Apply All') {
            await this._engine.applyEdits(msg.edits);
            this._panel.webview.postMessage({ type: 'changesApplied' });
          }
          break;
        }
        case 'compareFile': {
          const ws = vscode.workspace.workspaceFolders;
          if (ws) {
            const normalizedPath = msg.path.replace(/\\/g, '/');
            const originalUri = vscode.Uri.joinPath(ws[0].uri, normalizedPath);
            const doc = await vscode.workspace.openTextDocument({
              content: msg.content,
              language: originalUri.path.split('.').pop() || 'typescript'
            });
            try {
              await vscode.workspace.fs.stat(originalUri);
              await vscode.commands.executeCommand('vscode.diff', originalUri, doc.uri, `${msg.path} ↔ Swarm Proposal`);
            } catch {
              await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
              vscode.window.showInformationMessage(`New file: ${msg.path}`);
            }
          }
          break;
        }
        case 'openFile': {
          const ws = vscode.workspace.workspaceFolders;
          if (ws) {
            const normalizedPath = msg.path.replace(/\\/g, '/');
            vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(ws[0].uri, normalizedPath));
          }
          break;
        }
        case 'updateConfig': {
          this._store.updateConfig(msg.config);
          this._updateState();
          break;
        }
        case 'oauthRequest': {
          try { await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true }); this._updateState(); } catch {}
          break;
        }
        case 'requestState': this._updateState(); break;
      }
    }, null, this._disposables);

    this._store.onDidChange(() => this._updateState(), null, this._disposables);
    this.render();
    this._updateState();
  }

  private async _updateState() {
    const authModels = await this._getAuthModels();
    let quota = null;
    try {
      const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: false });
      if (session) {
        quota = {
          user: session.account.label,
          used: this._store.getTotalTokens(),
          limit: this._store.getTokenLimit(),
          unit: 'tokens'
        };
      }
    } catch {}

    this._panel.webview.postMessage({
      type: 'state',
      state: {
        agents: this._store.all(),
        config: this._store.getConfig(),
        quota,
      },
      availableModels: authModels.map(m => m.id),
    });
  }

  private async _getAuthModels() {
    try { return await vscode.lm.selectChatModels({ vendor: 'copilot' }); } catch { return []; }
  }

  public static createOrShow(extensionUri: vscode.Uri, store: AgentStore, engine: SwarmEngine) {
    if (SwarmPanel.currentPanel) { SwarmPanel.currentPanel._panel.reveal(); return SwarmPanel.currentPanel; }
    const panel = vscode.window.createWebviewPanel('swarmControl', 'CopilotSwarm', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    SwarmPanel.currentPanel = new SwarmPanel(panel, extensionUri, store, engine);
    return SwarmPanel.currentPanel;
  }

  public dispose() {
    SwarmPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) { const x = this._disposables.pop(); if (x) x.dispose(); }
  }

  public render() { this._updateHtml(); }

  private async _updateHtml() {
    this._panel.webview.html = await this._getHtml();
  }

  private async _getHtml(): Promise<string> {
    try {
      const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'swarm.html');
      const htmlBuffer = await vscode.workspace.fs.readFile(htmlPath);
      return new TextDecoder().decode(htmlBuffer);
    } catch (e) {
      return `<h1>Error loading webview</h1><p>${e}</p>`;
    }
  }
}
