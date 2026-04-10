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
        case 'applyChanges': {
          await this._engine.applyEdits(msg.edits);
          this._panel.webview.postMessage({ type: 'clearLogs' });
          break;
        }
        case 'compareFile': {
          const ws = vscode.workspace.workspaceFolders;
          if (ws) {
            const originalUri = vscode.Uri.joinPath(ws[0].uri, msg.path);
            
            // Create a temporary URI for the preview
            const tempUri = vscode.Uri.parse(`swarm-preview:/${msg.path}`);
            
            // We'll use a simple approach: write to an untitled document with specific context
            const doc = await vscode.workspace.openTextDocument({ 
              content: msg.content,
              language: originalUri.path.split('.').pop() || 'typescript'
            });
            
            try {
              await vscode.workspace.fs.stat(originalUri);
              await vscode.commands.executeCommand('vscode.diff', originalUri, doc.uri, `${msg.path} ↔ Swarm Proposal`);
            } catch {
              await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
              vscode.window.showInformationMessage(`Showing NEW file content for ${msg.path}`);
            }
          }
          break;
        }
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
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --sidebar-bg: var(--vscode-sideBar-background);
      --border: var(--vscode-panel-border);
      --text: var(--vscode-foreground);
      --text-muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-charts-blue);
      --accent-hover: var(--vscode-button-hoverBackground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --success: var(--vscode-testing-iconPassedColor);
      --warning: var(--vscode-charts-orange);
      --font-mono: var(--vscode-editor-font-family, 'SF Mono', Monaco, monospace);
    }
    
    @keyframes pulse-blue {
      0% { box-shadow: 0 0 0 0px rgba(0, 122, 204, 0.4); }
      70% { box-shadow: 0 0 0 4px rgba(0, 122, 204, 0); }
      100% { box-shadow: 0 0 0 0px rgba(0, 122, 204, 0); }
    }

    @keyframes pulse-dots {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 1; }
    }
    
    body { margin: 0; padding: 0; display: flex; height: 100vh; overflow: hidden; font-family: var(--vscode-font-family); color: var(--text); background: var(--bg); font-size: 12px; }
    
    /* SIDEBAR */
    .sidebar { width: 300px; min-width: 300px; background: var(--sidebar-bg); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
    .sidebar-header { padding: 16px; border-bottom: 1px solid var(--border); background: rgba(0,0,0,0.1); }
    .sidebar-title { font-size: 12px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
    
    .input { width: 100%; box-sizing: border-box; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); padding: 8px; font-family: var(--font-mono); font-size: 11px; border-radius: 0px; }
    .input:focus { outline: none; border-color: var(--accent); }
    
    .btn { background: var(--accent); color: white; border: none; padding: 8px 12px; cursor: pointer; border-radius: 0px; font-size: 11px; font-weight: bold; text-transform: uppercase; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.8; }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }

    .stages-list { flex: 1; overflow-y: auto; padding: 12px; gap: 4px; display: flex; flex-direction: column; }
    .stage-item { 
      padding: 12px; 
      border: 1px solid var(--border); 
      background: var(--bg); 
      position: relative; 
      cursor: pointer;
      transition: all 0.2s;
    }
    .stage-item:hover { border-color: var(--text-muted); }
    .stage-item.selected { border-left: 3px solid var(--accent); background: rgba(0, 122, 204, 0.05); border-color: var(--accent); }
    
    .stage-item.running { animation: pulse-blue 2s infinite; border-color: var(--accent); }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 6px; }
    .status-running { background: var(--accent); animation: pulse-dots 1s infinite; }
    .status-success { background: var(--success); }
    .status-error { background: var(--vscode-errorForeground); }

    .sidebar-footer { border-top: 1px solid var(--border); padding: 16px; background: rgba(0,0,0,0.1); }

    /* MAIN */
    .main { flex: 1; display: flex; flex-direction: column; background: var(--bg); min-width: 0; }
    .visor-header { padding: 12px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--sidebar-bg); }
    .visor-title { font-weight: bold; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
    
    .visor-content { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 20px; }
    .section-title { font-size: 10px; font-weight: bold; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px; border-left: 2px solid var(--border); padding-left: 8px; }
    
    .prompt-editor { width: 100%; min-height: 100px; }
    .output-viewer { 
      flex: 1; 
      background: rgba(0,0,0,0.2); 
      border: 1px solid var(--border); 
      padding: 16px; 
      font-family: var(--font-mono); 
      font-size: 12px; 
      color: var(--vscode-editor-foreground);
      line-height: 1.6;
      border-radius: 2px;
    }

    .log-panel { background: var(--sidebar-bg); border-bottom: 1px solid var(--border); padding: 12px 20px; }
    .log-item { font-family: var(--font-mono); font-size: 11px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
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
      <div style="font-size: 11px; margin-bottom: 6px; color: var(--text-muted); display:flex; justify-content:space-between;">
        <span>GLOBAL OBJECTIVE</span>
        <span style="color:var(--vscode-charts-blue);" title="The Swarm automatically reads your workspace structure and open files.">✦ Auto-Context</span>
      </div>
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
      let pendingChanges = []; // { path, content }

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
          // Add to pending if not exists or update
          const idx = pendingChanges.findIndex(c => c.path === msg.action.path);
          if (idx !== -1) {
            pendingChanges[idx] = msg.action;
          } else {
            pendingChanges.push(msg.action);
          }
          renderLogs();
        } else if (msg.type === 'clearLogs') {
          pendingChanges = [];
          renderLogs();
        }
      });

      function renderLogs() {
        if (pendingChanges.length === 0) {
          logPanel.style.display = 'none';
          return;
        }
        logPanel.style.display = 'block';
        logItems.innerHTML = '';
        
        const header = document.createElement('div');
        header.style = "display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; background:rgba(255,255,255,0.03); padding:8px; border-radius:4px;";
        header.innerHTML = \`
          <span style="font-weight:bold; color:var(--vscode-charts-orange)">\${pendingChanges.length} PROPOSED CHANGES</span>
          <button class="btn" style="background:var(--success)" onclick="commitAll()">Commit All Changes</button>
        \`;
        logItems.appendChild(header);

        pendingChanges.forEach(change => {
          const item = document.createElement('div');
          item.className = 'log-item';
          item.innerHTML = \`
            <span><span style="color:var(--vscode-charts-orange)">●</span> \${change.path}</span>
            <div style="display:flex; gap:10px;">
               <a href="#" style="color:var(--vscode-textLink-foreground)" onclick="vscode.postMessage({type:'openFile',path:'\${change.path}'})">Open Original</a>
               <a href="#" style="color:var(--vscode-textLink-foreground)" onclick="reviewChange('\${change.path}')">Review Diff</a>
            </div>
          \`;
          logItems.appendChild(item);
        });
      }

      window.reviewChange = (path) => {
        const change = pendingChanges.find(c => c.path === path);
        if (change) {
          vscode.postMessage({ type: 'compareFile', path: change.path, content: change.content });
        }
      };

      window.commitAll = () => {
        if (confirm(\`Apply all \${pendingChanges.length} changes to your workspace?\`)) {
          vscode.postMessage({ type: 'applyChanges', edits: pendingChanges });
          pendingChanges = [];
          renderLogs();
        }
      };

      window.selectStage = (id) => {
        selectedAgentId = id;
        renderSidebar();
        renderMain();
      };

      window.handleDeleteStage = (id) => {
        if (confirm('¿Eliminar este stage?')) {
          vscode.postMessage({ type: 'removeAgent', agentId: id });
          selectedAgentId = null;
        }
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
      }

      function renderSidebar() {
        stagesList.innerHTML = '';
        currentState.agents.forEach((a, index) => {
          const item = document.createElement('div');
          item.className = 'stage-item' + (a.id === selectedAgentId ? ' selected' : '') + (a.status === 'running' ? ' running' : '');
          item.onclick = () => selectStage(a.id);
          
          item.innerHTML = \`
            <div class="stage-item-header">
              <span class="stage-item-title">\${index + 1}. \${a.name}</span>
              <span class="status-dot status-\${a.status}"></span>
            </div>
            <div style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono); margin-bottom:8px;">
              PROMPT: \${a.systemPrompt.substring(0, 30)}...
            </div>
            <select class="input" style="padding:2px; font-size:9px;" onclick="event.stopPropagation()" onchange="vscode.postMessage({type:'updateAgentModel',agentId:'\${a.id}',modelId:this.value})">
              \${availableModels.map(m => \`<option value="\${m}" \${m===a.modelId ? 'selected':''}>\${m}</option>\`).join('')}
              \${!availableModels.includes(a.modelId) ? \`<option value="\${a.modelId}" selected>\${a.modelId}</option>\` : ''}
            </select>
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
            <div class="visor-title">STAGE MONITOR // \${agent.name}</div>
            <button class="btn btn-secondary" style="font-size:10px;" onclick="handleDeleteStage('\${agent.id}')">Drop Stage</button>
          </div>
          <div class="visor-content">
            <div style="background: rgba(0,122,204,0.1); padding: 12px; border: 1px solid var(--accent); margin-bottom: 5px; font-size: 11px; font-family: var(--font-mono);">
              <span style="color: var(--accent); font-weight: bold;">[ SYSTEM ]</span> 
              AUTO-CONTEXT ACTIVE // PROJECT STRUCTURE INDEXED // READY
            </div>
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
