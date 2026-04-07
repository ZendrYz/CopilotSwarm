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
          let authModels: vscode.LanguageModelChat[] = [];
          try { authModels = await vscode.lm.selectChatModels({ vendor: 'copilot' }); } catch (e) {}
          const authIds = authModels.map(m => m.id);
          const availableModels = COPILOT_MODELS.filter(m => authIds.some(aid => aid.toLowerCase().includes(m.id.toLowerCase()) || m.id.toLowerCase().includes(aid.toLowerCase())));
          const modelItems = availableModels.length > 0 ? availableModels.map(m => ({ label: m.id, description: `${m.provider} (${m.status})`, id: m.id })) : authModels.map(m => ({ label: m.id, description: `${m.vendor} - ${m.family}`, id: m.id }));
          const name = await vscode.window.showInputBox({ prompt: 'Enter Agent Name', value: `Agent ${this._store.all().length + 1}` });
          if (!name) return;
          const selectedModel = await vscode.window.showQuickPick(modelItems, { placeHolder: 'Select model' });
          if (selectedModel) {
            const systemPrompt = await vscode.window.showInputBox({ prompt: 'Set Agent Role', value: 'Be a helpful assistant.' }) || '';
            this._store.add({ name, modelId: selectedModel.id, systemPrompt });
          }
          break;
        }
        case 'removeAgent': this._store.remove(msg.agentId); break;
        case 'updateAgentPrompt': this._store.patch(msg.agentId, { systemPrompt: msg.systemPrompt }); break;
        case 'updateLimit': this._store.setTokenLimit(msg.limit); break; // Guardar nuevo límite
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

  private async _handleOAuth() {
    try {
      const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true });
      if (session) this._updateState();
    } catch {}
  }

  private async _updateState() {
    let authModels: vscode.LanguageModelChat[] = [];
    try { authModels = await vscode.lm.selectChatModels({ vendor: 'copilot' }); } catch {}
    const authIds = authModels.map(m => m.id);
    const filteredModels = COPILOT_MODELS.filter(m => authIds.some(aid => aid.toLowerCase().includes(m.id.toLowerCase()) || m.id.toLowerCase().includes(aid.toLowerCase())));
    
    const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: false });
    const quota = session ? { 
      user: session.account.label, 
      used: this._store.getTotalTokens(), 
      limit: this._store.getTokenLimit(), 
      unit: 'tokens' 
    } : null;

    const state: SwarmState = { 
      agents: this._store.all(), 
      objective: '', 
      quota 
    };

    this._panel.webview.postMessage({ type: 'state', state, models: filteredModels.length > 0 ? filteredModels : authModels.map(m => ({ id: m.id })), aliases: ALIAS_MAP });
  }

  public static createOrShow(extensionUri: vscode.Uri, store: AgentStore, engine: SwarmEngine) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
    if (SwarmPanel.currentPanel) { SwarmPanel.currentPanel._panel.reveal(column); return SwarmPanel.currentPanel; }
    const panel = vscode.window.createWebviewPanel('swarmControl', 'Copilot Swarm', column || vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] });
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
  <title>Copilot Swarm Control</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
    :root { --bg-main: #0d1117; --bg-card: #161b22; --border: #30363d; --accent: #2f81f7; --accent-hover: #1f6feb; --success: #238636; --error: #da3633; --text-pri: #c9d1d9; --text-sec: #8b949e; --radius: 6px; --font-main: 'Inter', system-ui, sans-serif; --font-mono: 'JetBrains Mono', monospace; }
    body { font-family: var(--font-main); background: var(--bg-main); color: var(--text-pri); margin: 0; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
    .swarm-objective { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .objective-input { width: 100%; background: var(--bg-main); border: 1px solid var(--border); border-radius: var(--radius); color: #fff; padding: 12px; font-family: inherit; resize: none; outline: none; box-sizing: border-box; }
    .btn { padding: 8px 16px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-card); color: var(--text-pri); font-size: 13px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s; }
    .btn:hover { background: #21262d; border-color: var(--text-sec); }
    .btn-success { background: var(--success); color: #fff; border: none; }
    .agents-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
    .agent-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    .agent-header { display: flex; justify-content: space-between; align-items: flex-start; }
    .agent-name { font-weight: 600; color: #fff; font-size: 15px; }
    .agent-model { font-family: var(--font-mono); font-size: 11px; color: var(--text-sec); margin-top: 4px; }
    .agent-status { font-size: 10px; padding: 3px 8px; border-radius: 12px; text-transform: uppercase; font-weight: 600; background: rgba(255,255,255,0.05); }
    .status-running { color: var(--accent); background: rgba(47,129,247,0.1); }
    .status-success { color: #3fb950; background: rgba(56,185,80,0.1); }
    .agent-prompt { font-family: var(--font-mono); font-size: 11px; background: rgba(13,17,23,0.5); padding: 8px; border: 1px dashed var(--border); border-radius: 4px; color: var(--text-sec); width: 100%; box-sizing: border-box; resize: vertical; }
    .agent-response { font-size: 12px; background: var(--bg-main); padding: 10px; border-radius: var(--radius); max-height: 120px; overflow-y: auto; white-space: pre-wrap; border: 1px solid var(--border); }
    .add-agent-card { border: 2px dashed var(--border); display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 40px; color: var(--text-sec); cursor: pointer; transition: all 0.2s; }
    .tokens-pill { font-size: 10px; color: var(--text-sec); background: var(--bg-main); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); }
    .security-bar { display: flex; align-items: center; border-radius: var(--radius); background: rgba(218,54,51,0.05); border: 1px solid rgba(218,54,51,0.2); padding: 12px; margin-top: -12px; gap: 15px; }
    .limit-input { background: var(--bg-main); border: 1px solid var(--border); color: #fff; padding: 4px 8px; border-radius: 4px; width: 80px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>Copilot Swarm Control</h1><button class="btn" id="btn-oauth">Connect GitHub</button></div>
    <div class="security-bar">
      <span style="font-size:12px; color:var(--error); font-weight:600;">Security System (Budget):</span>
      <div style="display:flex; align-items:center; gap:8px;">
        <input type="number" id="limitInput" class="limit-input" placeholder="0 (disabled)">
        <span style="font-size:11px; color:var(--text-sec);">max tokens before auto-stop</span>
      </div>
    </div>
    <div class="swarm-objective">
      <textarea id="objectiveInput" class="objective-input" rows="3" placeholder="Objective..."></textarea>
      <div style="display:flex; gap:12px;"><button class="btn btn-success" id="btn-runall">Run Hierarchy</button><button class="btn" id="btn-stopall">Stop</button></div>
    </div>
    <div class="agents-grid" id="agentsGrid"><div class="agent-card add-agent-card" id="btn-addagent"><span>+ Add Swarm Agent</span></div></div>
  </div>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      let state = { agents: [] };
      const agentsGrid = document.getElementById('agentsGrid');
      const limitInput = document.getElementById('limitInput');

      limitInput.addEventListener('change', (e) => vscode.postMessage({ type: 'updateLimit', limit: parseInt(e.target.value) || 0 }));
      document.getElementById('btn-addagent').addEventListener('click', () => vscode.postMessage({ type: 'requestAddAgent' }));
      document.getElementById('btn-runall').addEventListener('click', () => vscode.postMessage({ type: 'runAll', objective: document.getElementById('objectiveInput').value }));
      document.getElementById('btn-stopall').addEventListener('click', () => vscode.postMessage({ type: 'stopAll' }));
      document.getElementById('btn-oauth').addEventListener('click', () => vscode.postMessage({ type: 'oauthRequest' }));

      window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'state') { 
          state = msg.state; render();
          if (msg.state.quota) {
            limitInput.value = msg.state.quota.limit || 0;
            document.getElementById('btn-oauth').innerHTML = \`<img src="https://github.com/fluidicon.png" width="14" style="border-radius:50%; vertical-align:middle;"> \${msg.state.quota.user} [\${msg.state.quota.used.toLocaleString()}]\`;
          }
        }
      });

      function render() {
        const activeElem = document.activeElement;
        const activeId = activeElem && activeElem.dataset ? activeElem.dataset.id : null;
        const items = Array.from(agentsGrid.children).filter(c => c.id !== 'btn-addagent');
        items.forEach(c => agentsGrid.removeChild(c));
        state.agents.forEach((a, index) => {
          const card = document.createElement('div');
          card.className = 'agent-card';
          card.innerHTML = \`
            <div class="agent-header"><div><div class="agent-name">\${index+1}. \${a.name}</div><div class="agent-model">\${a.modelId}</div></div><div class="agent-status status-\${a.status}">\${a.status}</div></div>
            <textarea class="agent-prompt" data-id="\${a.id}" rows="2">\${a.systemPrompt || ''}</textarea>
            \${a.lastResponse ? \`<div class="agent-response">\${a.lastResponse}</div>\` : ''}
            <div style="margin-top:auto; padding-top:8px; display:flex; justify-content:space-between; align-items:center;"><div class="tokens-pill">\${(a.tokensUsed || 0).toLocaleString()} tokens</div><button class="btn btn-remove" data-id="\${a.id}">Remove</button></div>
          \`;
          agentsGrid.insertBefore(card, document.getElementById('btn-addagent'));
          if (activeId === a.id) setTimeout(() => card.querySelector('.agent-prompt').focus(), 0);
        });
      }
      vscode.postMessage({ type: 'requestState' });
    })();
  </script>
</body>
</html>`;
  }
}
