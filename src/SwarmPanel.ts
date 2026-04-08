import * as vscode from 'vscode';
import { AgentStore } from './AgentStore';
import { SwarmEngine } from './SwarmEngine';
import { COPILOT_MODELS, ALIAS_MAP } from './aliases';
import { SwarmState } from './types';

export class SwarmPanel {
  public static currentPanel: SwarmPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri, private readonly _store: AgentStore, private readonly _engine: SwarmEngine) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'requestAddAgent': {
          const authModels = await this._getAuthModels();
          const name = await vscode.window.showInputBox({ prompt: 'Agent Name', value: `Agent ${this._store.all().length + 1}` });
          if (!name) return;
          const selectedModel = await vscode.window.showQuickPick(authModels.map(m => ({ label: m.id, id: m.id })), { placeHolder: 'Init model' });
          if (selectedModel) this._store.add({ name, modelId: selectedModel.id, systemPrompt: 'Be a professional assistant.' });
          break;
        }
        case 'removeAgent': this._store.remove(msg.agentId); break;
        case 'updateAgentPrompt': this._store.patch(msg.agentId, { systemPrompt: msg.systemPrompt }); break;
        case 'updateAgentModel': this._store.patch(msg.agentId, { modelId: msg.modelId }); break;
        case 'updateLimit': this._store.setTokenLimit(msg.limit); break;
        case 'runAll': this._engine.runAll(msg.objective); break;
        case 'stopAll': this._engine.stopAll(); break;
        case 'oauthRequest': this._handleOAuth(); break;
        case 'requestState': this._updateState(); break;
      }
    }, null, this._disposables);
    this._store.onDidChange(() => this._updateState(), null, this._disposables);
    this.render();
    this._updateState();
  }

  private async _getAuthModels() {
    try { return await vscode.lm.selectChatModels({ vendor: 'copilot' }); } catch { return []; }
  }

  private async _handleOAuth() {
    try { if (await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true })) this._updateState(); } catch {}
  }

  private async _updateState() {
    const authModels = await this._getAuthModels();
    const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: false });
    const quota = session ? { user: session.account.label, used: this._store.getTotalTokens(), limit: this._store.getTokenLimit(), unit: 'tokens' } : null;
    this._panel.webview.postMessage({ 
      type: 'state', 
      state: { agents: this._store.all(), quota },
      availableModels: authModels.map(m => m.id)
    });
  }

  public static createOrShow(extensionUri: vscode.Uri, store: AgentStore, engine: SwarmEngine) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
    if (SwarmPanel.currentPanel) { SwarmPanel.currentPanel._panel.reveal(column); return SwarmPanel.currentPanel; }
    const panel = vscode.window.createWebviewPanel('swarmControl', 'CopilotSwarm', column || vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] });
    SwarmPanel.currentPanel = new SwarmPanel(panel, extensionUri, store, engine);
    return SwarmPanel.currentPanel;
  }
  public dispose() { SwarmPanel.currentPanel = undefined; this._panel.dispose(); while (this._disposables.length) { const x = this._disposables.pop(); if (x) x.dispose(); } }
  public render() { this._panel.webview.html = this.getWebviewHtml(); }
  public getWebviewHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline';">
  <title>CopilotSwarm</title>
  <style>
    :root { --bg: #0d1117; --card: #161b22; --border: #30363d; --text: #c9d1d9; --sub: #8b949e; --accent: #2188ff; --error: #f85149; --success: #3fb950; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 32px; font-size: 13px; }
    .container { max-width: 1000px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 32px; }
    .btn { background: #21262d; border: 1px solid var(--border); color: #c9d1d9; padding: 5px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; }
    .btn-primary { background: #238636; color: white; border: 1px solid rgba(240,246,252,0.1); }
    .input { background: var(--bg); border: 1px solid var(--border); color: #fff; padding: 10px; border-radius: 6px; width: 100%; box-sizing: border-box; font-family: inherit; font-size: 13px; }
    .select { background: #21262d; border: 1px solid var(--border); color: #fff; padding: 4px 8px; border-radius: 6px; font-size: 11px; outline: none; }
    .agent-step { background: var(--card); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 16px; }
    .agent-head { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); }
    .agent-body { padding: 16px; }
    .label { font-size: 10px; font-weight: 600; color: var(--sub); text-transform: uppercase; margin-bottom: 6px; display: block; }
    .agent-prompt { width: 100%; min-height: 40px; background: transparent; border: 1px solid var(--border); border-radius: 4px; color: var(--sub); padding: 8px; font-family: monospace; font-size: 11px; resize: vertical; box-sizing: border-box; }
    .agent-output { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 16px; min-height: 100px; max-height: 600px; overflow-y: auto; font-family: monospace; font-size: 12px; color: #d1d5db; white-space: pre-wrap; line-height: 1.6; margin-top: 12px; }
    .agent-foot { padding: 8px 16px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; color: var(--sub); font-size: 11px; }
    .status-badge { font-size: 10px; padding: 1px 6px; border-radius: 12px; font-weight: 600; text-transform: uppercase; border: 1px solid transparent; margin-left: 8px; }
    .status-running { color: var(--accent); border-color: var(--accent); }
    .status-success { color: var(--success); border-color: var(--success); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="font-size:18px;">CopilotSwarm</h1>
      <div id="quota-display" style="color:var(--sub); font-size:12px;">Not Connected</div>
    </div>

    <div style="margin-bottom:32px;">
      <label class="label">Main Objective</label>
      <textarea id="obj-input" class="input" rows="2" placeholder="Task for the swarm..."></textarea>
    </div>

    <div id="chain"></div>
    <button class="btn" id="btn-add" style="width:100%; border-style:dashed; margin:16px 0; padding:12px;">+ Add Stage</button>

    <div style="display:flex; gap:12px; align-items:center; border-top: 1px solid var(--border); padding-top:24px;">
      <button class="btn btn-primary" id="btn-run" style="flex:1; padding:10px;">Run Swarm</button>
      <button class="btn" id="btn-stop">Stop</button>
      <input type="number" id="limit-input" class="input" style="width:80px;" placeholder="Limit">
      <button class="btn" id="btn-oauth">Account</button>
    </div>
  </div>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      const chain = document.getElementById('chain');
      let availableModels = [];

      document.getElementById('btn-run').onclick = () => vscode.postMessage({ type: 'runAll', objective: document.getElementById('obj-input').value });
      document.getElementById('btn-stop').onclick = () => vscode.postMessage({ type: 'stopAll' });
      document.getElementById('btn-add').onclick = () => vscode.postMessage({ type: 'requestAddAgent' });
      document.getElementById('btn-oauth').onclick = () => vscode.postMessage({ type: 'oauthRequest' });
      document.getElementById('limit-input').onchange = (e) => vscode.postMessage({ type: 'updateLimit', limit: parseInt(e.target.value) || 0 });

      window.addEventListener('message', e => {
        if (e.data.type === 'state') {
          availableModels = e.data.availableModels || [];
          render(e.data.state);
        }
      });

      function render(state) {
        if (state.quota) {
          document.getElementById('quota-display').innerText = state.quota.user + ' (' + state.quota.used.toLocaleString() + ' tokens)';
          document.getElementById('limit-input').value = state.quota.limit || '';
        }
        chain.innerHTML = '';
        state.agents.forEach((a, i) => {
          const step = document.createElement('div');
          step.className = 'agent-step';
          
          let options = availableModels.map(m => \`<option value="\${m}" \${m === a.modelId ? 'selected' : ''}>\${m}</option>\`).join('');
          if (!availableModels.includes(a.modelId)) {
            options = \`<option value="\${a.modelId}" selected>\${a.modelId} (Not Auth)</option>\` + options;
          }

          step.innerHTML = \`
            <div class="agent-head">
              <div><strong>\${i+1}. \${a.name}</strong><span class="status-badge status-\${a.status}">\${a.status}</span></div>
              <select class="select" data-id="\${a.id}">\${options}</select>
            </div>
            <div class="agent-body">
              <label class="label">Role Instruction</label>
              <textarea class="agent-prompt" data-id="\${a.id}">\${a.systemPrompt}</textarea>
              \${a.lastResponse ? \`<div class="agent-output">\${a.lastResponse}</div>\` : ''}
            </div>
            <div class="agent-foot">
              <span>\${(a.tokensUsed || 0).toLocaleString()} tks</span>
              <span style="cursor:pointer; color:var(--error);" data-remove="\${a.id}">Delete</span>
            </div>\`;
          chain.appendChild(step);
          step.querySelector('.agent-prompt').onchange = (e) => vscode.postMessage({ type: 'updateAgentPrompt', agentId: a.id, systemPrompt: e.target.value });
          step.querySelector('.select').onchange = (e) => vscode.postMessage({ type: 'updateAgentModel', agentId: a.id, modelId: e.target.value });
          step.querySelector('[data-remove]').onclick = () => vscode.postMessage({ type: 'removeAgent', agentId: a.id });
        });
      }
      vscode.postMessage({ type: 'requestState' });
    })();
  </script>
</body>
</html>`;
  }
}
