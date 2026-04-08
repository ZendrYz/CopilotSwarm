import * as vscode from 'vscode';
import { AgentStore } from './AgentStore';
import { SwarmEngine } from './SwarmEngine';
import { COPILOT_MODELS } from './aliases';

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
          const name = await vscode.window.showInputBox({ prompt: 'Stage Name', value: `Stage ${this._store.all().length + 1}` });
          if (!name) return;
          const selectedModel = await vscode.window.showQuickPick(authModels.map(m => ({ label: m.id, id: m.id })), { placeHolder: 'Select model' });
          if (selectedModel) this._store.add({ name, modelId: selectedModel.id, systemPrompt: 'Analyze and execute.' });
          break;
        }
        case 'removeAgent': this._store.remove(msg.agentId); break;
        case 'updateAgentPrompt': this._store.patch(msg.agentId, { systemPrompt: msg.systemPrompt }); break;
        case 'updateAgentModel': this._store.patch(msg.agentId, { modelId: msg.modelId }); break;
        case 'updateLimit': this._store.setTokenLimit(msg.limit); break;
        case 'runAll': 
          this._panel.webview.postMessage({ type: 'clearLogs' });
          this._engine.runAll(
            msg.objective, 
            (agentId, chunk) => this._panel.webview.postMessage({ type: 'streamChunk', agentId, chunk }),
            (action) => this._panel.webview.postMessage({ type: 'fileAction', action })
          );
          break;
        case 'stopAll': this._engine.stopAll(); break;
        case 'oauthRequest': this._handleOAuth(); break;
        case 'requestState': this._updateState(); break;
        case 'openFile': {
          const ws = vscode.workspace.workspaceFolders;
          if (ws) vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(ws[0].uri, msg.path));
          break;
        }
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
    try { await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true }); this._updateState(); } catch {}
  }

  private async _updateState() {
    const authModels = await this._getAuthModels();
    let quota = null;
    try {
      const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: false });
      if (session) {
        quota = { 
          user: session.account.label, 
          used: this._store.getTotalTokens().toLocaleString(), 
          limit: this._store.getTokenLimit() 
        };
      }
    } catch {}
    
    this._panel.webview.postMessage({ 
      type: 'state', 
      state: { agents: this._store.all(), quota }, 
      availableModels: authModels.map(m => m.id) 
    });
  }

  public static createOrShow(extensionUri: vscode.Uri, store: AgentStore, engine: SwarmEngine) {
    if (SwarmPanel.currentPanel) { SwarmPanel.currentPanel._panel.reveal(); return SwarmPanel.currentPanel; }
    const panel = vscode.window.createWebviewPanel('swarmControl', 'CopilotSwarm', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    SwarmPanel.currentPanel = new SwarmPanel(panel, extensionUri, store, engine);
    return SwarmPanel.currentPanel;
  }
  public dispose() { SwarmPanel.currentPanel = undefined; this._panel.dispose(); while (this._disposables.length) { const x = this._disposables.pop(); if (x) x.dispose(); } }
  public render() { this._panel.webview.html = this.getWebviewHtml(); }
  public getWebviewHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --sidebar-bg: var(--vscode-sideBar-background);
      --border: var(--vscode-widget-border);
      --text: var(--vscode-foreground);
      --text-muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-button-background);
      --accent-hover: var(--vscode-button-hoverBackground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --list-hover: var(--vscode-list-hoverBackground);
      --list-active: var(--vscode-list-activeSelectionBackground);
      --list-active-fg: var(--vscode-list-activeSelectionForeground);
      --success: var(--vscode-testing-iconPassedColor);
    }
    
    body { margin: 0; padding: 0; display: flex; height: 100vh; overflow: hidden; font-family: var(--vscode-font-family); color: var(--text); background: var(--bg); font-size: 13px; }
    
    /* LEFT: CONTROL PANEL */
    .sidebar { width: 320px; min-width: 320px; background: var(--sidebar-bg); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
    .sidebar-header { padding: 15px; border-bottom: 1px solid var(--border); }
    .sidebar-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
    .auth-badge { font-size: 10px; color: var(--text-muted); }
    
    .input { width: 100%; box-sizing: border-box; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); padding: 8px; font-family: inherit; font-size: 12px; border-radius: 2px; }
    .input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
    textarea.input { resize: vertical; min-height: 60px; }
    
    .btn { background: var(--accent); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; border-radius: 2px; font-size: 12px; display: inline-block; text-align: center; }
    .btn:hover { background: var(--accent-hover); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid transparent; }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-outline { background: transparent; border: 1px dashed var(--border); color: var(--text); }
    .btn-outline:hover { background: rgba(255,255,255,0.05); }

    .stages-list { flex: 1; overflow-y: auto; padding: 10px; }
    .stage-item { padding: 10px; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 8px; cursor: pointer; background: var(--bg); transition: background 0.1s; }
    .stage-item:hover { background: var(--list-hover); }
    .stage-item.selected { border-color: var(--vscode-focusBorder); background: rgba(255,255,255,0.02); box-shadow: inset 2px 0 0 var(--vscode-focusBorder); }
    .stage-item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .stage-item-title { font-weight: 600; font-size: 12px; }
    .stage-item-status { font-size: 10px; font-weight: 600; text-transform: uppercase; }
    .status-running { color: var(--vscode-charts-blue); }
    .status-success { color: var(--success); }
    
    .sidebar-footer { border-top: 1px solid var(--border); padding: 15px; }
    .control-row { display: flex; gap: 8px; margin-bottom: 10px; }

    /* RIGHT: VISOR */
    .main { flex: 1; display: flex; flex-direction: column; background: var(--bg); min-width: 0; min-height: 0; }
    
    .log-panel { background: var(--sidebar-bg); border-bottom: 1px solid var(--border); padding: 10px 20px; display: none; max-height: 150px; overflow-y: auto; }
    .log-title { font-size: 10px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; letter-spacing: 0.5px; }
    .log-item { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; padding: 4px 0; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; }
    .log-item:last-child { border-bottom: none; }

    .visor-header { padding: 15px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--sidebar-bg); }
    .visor-title { font-weight: 600; font-size: 14px; }
    
    .visor-content { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 20px; min-height: 0; }
    .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px; }
    
    .prompt-editor { width: 100%; min-height: 80px; box-sizing: border-box; font-family: var(--vscode-editor-font-family, monospace); }
    .output-viewer { flex: 1; background: var(--input-bg); border: 1px solid var(--border); border-radius: 4px; padding: 15px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: pre-wrap; overflow-y: auto; line-height: 1.5; color: var(--vscode-editor-foreground); min-height: 0; }
    
    .empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); flex-direction: column; opacity: 0.6; }
  </style>
</head>
<body>

  <!-- LEFT: SIDEBAR -->
  <div class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-title">
        <span>CopilotSwarm</span>
        <span id="auth-badge" class="auth-badge">Connecting...</span>
      </div>
      <div style="font-size: 11px; margin-bottom: 6px; color: var(--text-muted);">GLOBAL OBJECTIVE</div>
      <textarea id="obj-input" class="input" placeholder="What should the swarm build?"></textarea>
    </div>

    <div class="stages-list" id="stages-list"></div>

    <div class="sidebar-footer">
      <button class="btn btn-outline" id="btn-add" style="width: 100%; margin-bottom: 15px;">+ Add Stage</button>
      <div class="control-row">
        <button class="btn" id="btn-run" style="flex: 2;">Run Swarm</button>
        <button class="btn btn-secondary" id="btn-stop" style="flex: 1;">Stop</button>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; color: var(--text-muted);">Budget Limit:</span>
        <input type="number" id="limit-input" class="input" style="width: 80px; padding: 4px;">
      </div>
      <button class="btn btn-secondary" id="btn-login" style="width: 100%; margin-top: 10px; display: none;">Login to GitHub</button>
    </div>
  </div>

  <!-- RIGHT: MAIN VISOR -->
  <div class="main">
    <div id="log-panel" class="log-panel">
      <div class="log-title">FILESYSTEM ACTIONS</div>
      <div id="log-items"></div>
    </div>

    <div id="main-visor" style="display: flex; flex-direction: column; flex: 1;">
      <!-- Populated via JS -->
      <div class="empty-state">
        <h2 style="margin:0 0 10px 0; font-weight: 500;">No Stage Selected</h2>
        <p style="margin:0;">Select a stage from the sidebar to view details</p>
      </div>
    </div>
  </div>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      const stagesList = document.getElementById('stages-list');
      const mainVisor = document.getElementById('main-visor');
      const authBadge = document.getElementById('auth-badge');
      const btnLogin = document.getElementById('btn-login');
      const logPanel = document.getElementById('log-panel');
      const logItems = document.getElementById('log-items');
      
      let currentState = { agents: [] };
      let availableModels = [];
      let selectedAgentId = null;

      // Ensure first agent is selected by default if available
      function ensureSelection() {
        if (!selectedAgentId && currentState.agents.length > 0) {
          selectedAgentId = currentState.agents[0].id;
        } else if (selectedAgentId && !currentState.agents.find(a => a.id === selectedAgentId)) {
           selectedAgentId = currentState.agents.length > 0 ? currentState.agents[0].id : null;
        }
      }

      window.addEventListener('message', e => {
        const msg = e.data;
        if (msg.type === 'state') {
          availableModels = msg.availableModels || [];
          currentState = msg.state;
          ensureSelection();
          renderSidebar();
          renderMain();
        } else if (msg.type === 'streamChunk') {
          // Update internal states
          const agent = currentState.agents.find(a => a.id === msg.agentId);
          if (agent) agent.lastResponse = (agent.lastResponse || '') + msg.chunk;
          
          // Fast UI update
          if (selectedAgentId === msg.agentId) {
            const out = document.getElementById('visor-output');
            if (out) out.innerText += msg.chunk;
          }
        } else if (msg.type === 'fileAction') {
          logPanel.style.display = 'block';
          const item = document.createElement('div');
          item.className = 'log-item';
          item.innerHTML = \`<span style="color:var(--success)">✔ \${msg.action.path}</span> <a href="#" style="color:var(--vscode-textLink-foreground)" onclick="vscode.postMessage({type:'openFile',path:'\${msg.action.path}'})">Open File</a>\`;
          logItems.appendChild(item);
        } else if (msg.type === 'clearLogs') {
          logItems.innerHTML = '';
          logPanel.style.display = 'none';
        }
      });

      window.selectStage = (id) => {
        selectedAgentId = id;
        renderSidebar();
        renderMain();
      };

      function renderSidebar() {
        if (currentState.quota) {
          authBadge.innerText = currentState.quota.user + ' (' + currentState.quota.used + 'tks)';
          btnLogin.style.display = 'none';
        } else {
          authBadge.innerText = 'Not Connected';
          btnLogin.style.display = 'block';
        }
        document.getElementById('limit-input').value = currentState.quota?.limit || 0;

        stagesList.innerHTML = '';
        currentState.agents.forEach((a, index) => {
          const item = document.createElement('div');
          item.className = 'stage-item' + (a.id === selectedAgentId ? ' selected' : '');
          item.onclick = () => selectStage(a.id);
          
          // Model Select block click to propagation
          const modelSelect = \`
            <select class="input" style="padding:2px; font-size:10px; margin-top:6px;" onclick="event.stopPropagation()" onchange="vscode.postMessage({type:'updateAgentModel',agentId:'\${a.id}',modelId:this.value})">
              \${availableModels.map(m => \`<option value="\${m}" \${m===a.modelId ? 'selected':''}>\${m}</option>\`).join('')}
              \${!availableModels.includes(a.modelId) ? \`<option value="\${a.modelId}" selected>\${a.modelId} (Offline)</option>\` : ''}
            </select>
          \`;

          item.innerHTML = \`
            <div class="stage-item-header">
              <span class="stage-item-title">\${index + 1}. \${a.name}</span>
              <span class="stage-item-status \${a.status === 'running' ? 'status-running' : (a.status === 'success' ? 'status-success' : '')}">\${a.status}</span>
            </div>
            <div style="font-size:10px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              \${a.systemPrompt.substring(0, 40)}...
            </div>
            \${modelSelect}
          \`;
          stagesList.appendChild(item);
        });
      }

      function renderMain() {
        const agent = currentState.agents.find(a => a.id === selectedAgentId);
        if (!agent) {
          mainVisor.innerHTML = '<div class="empty-state"><h2 style="margin:0 0 10px 0; font-weight: 500;">No Stage Selected</h2><p style="margin:0;">Select a stage from the sidebar to view details</p></div>';
          return;
        }

        mainVisor.innerHTML = \`
          <div class="visor-header">
            <div class="visor-title">\${agent.name} <span style="font-weight:normal; font-size:11px; color:var(--text-muted); margin-left:10px;">ID: \${agent.id}</span></div>
            <button class="btn btn-secondary" style="color:var(--vscode-testing-iconFailedColor)" onclick="vscode.postMessage({type:'removeAgent',agentId:'\${agent.id}'})">Delete Stage</button>
          </div>
          <div class="visor-content">
            <div>
              <div class="section-title">System Instruction / Prompt</div>
              <textarea class="input prompt-editor" onchange="vscode.postMessage({type:'updateAgentPrompt',agentId:'\${agent.id}',systemPrompt:this.value})">\${agent.systemPrompt}</textarea>
            </div>
            <div style="display:flex; flex-direction:column; flex:1;">
              <div class="section-title" style="display:flex; justify-content:space-between;">
                <span>Output Viewer (\${(agent.tokensUsed || 0).toLocaleString()} tokens)</span>
              </div>
              <div class="output-viewer" id="visor-output">\${agent.lastResponse || 'Waiting for execution...'}</div>
            </div>
          </div>
        \`;
      }

      document.getElementById('btn-run').onclick = () => vscode.postMessage({ type: 'runAll', objective: document.getElementById('obj-input').value });
      document.getElementById('btn-stop').onclick = () => vscode.postMessage({ type: 'stopAll' });
      document.getElementById('btn-add').onclick = () => vscode.postMessage({ type: 'requestAddAgent' });
      document.getElementById('btn-login').onclick = () => vscode.postMessage({ type: 'oauthRequest' });
      document.getElementById('limit-input').onchange = (e) => vscode.postMessage({ type: 'updateLimit', limit: parseInt(e.target.value) || 0 });
      vscode.postMessage({ type: 'requestState' });
    })();
  </script>
</body>
</html>`;
  }
}
