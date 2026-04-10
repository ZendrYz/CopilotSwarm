import * as vscode from 'vscode';
import { AgentStore } from './AgentStore';

export class SwarmEngine {
  private _isStopped = false;

  constructor(private readonly _store: AgentStore) {}

  public async runAll(
    objective: string, 
    onChunk?: (agentId: string, chunk: string) => void,
    onAction?: (action: { type: 'pending', path: string, content: string }) => void
  ) {
    this._isStopped = false;
    const agents = this._store.all();
    const context = await this._getWorkspaceContext();
    let fullHistoryContext = context ? `\n--- SOURCE CONTEXT ---\n${context}\n----------------------\n` : '';

    const allPendingActions: { path: string, content: string }[] = [];

    for (const agent of agents) {
      if (this._isStopped) break;
      const result = await this.runAgentSequential(agent.id, objective, fullHistoryContext, onChunk);
      
      const actions = await this.parsePendingActions(result);
      for (const action of actions) {
        // Collect all actions
        if (!allPendingActions.find(a => a.path === action.path)) {
           allPendingActions.push(action);
        } else {
           // Overwrite if same file and later stage
           const idx = allPendingActions.findIndex(a => a.path === action.path);
           allPendingActions[idx] = action;
        }
        if (onAction) onAction({ type: 'pending', path: action.path, content: action.content });
      }

      fullHistoryContext += `\n\n--- COMPLETED STAGE: ${agent.name} ---\n${result}\n----------------------------`;
    }
  }

  public async applyEdits(edits: { path: string, content: string }[]) {
    const workspaceEdit = new vscode.WorkspaceEdit();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    for (const edit of edits) {
      const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, edit.path);
      // Ensure file exists or create it
      workspaceEdit.createFile(uri, { overwrite: true, ignoreIfExists: true });
      workspaceEdit.replace(uri, new vscode.Range(0, 0, 1000000, 0), edit.content);
    }
    
    await vscode.workspace.applyEdit(workspaceEdit);
    vscode.window.showInformationMessage(`Successfully applied ${edits.length} swarm changes.`);
  }

  private async _getWorkspaceContext(): Promise<string> {
    let contextStr = '';

    // 1. Directory Tree
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      contextStr += "--- WORKSPACE DIRECTORY STRUCTURE (Top 1000 files) ---\n";
      try {
        const files = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**}', 1000);
        const paths = files.map(f => vscode.workspace.asRelativePath(f)).sort();
        contextStr += paths.join('\n') + '\n\n';
      } catch (e) {
        contextStr += "Could not load directory structure.\n\n";
      }
    }

    // 2. Open Documents
    contextStr += "--- CURRENTLY OPEN FILES ---\n";
    const docs = vscode.workspace.textDocuments.filter(d => !d.isClosed && !d.fileName.includes('.git') && !d.fileName.includes('extension-output'));
    for (const doc of docs) {
      if (doc.languageId === 'Log') continue;
      let text = doc.getText();
      const maxLength = 8000;
      if (text.length > maxLength) text = text.substring(0, maxLength) + '\n... (truncated due to length)';
      contextStr += `File: ${vscode.workspace.asRelativePath(doc.uri)}\n\`\`\`${doc.languageId}\n${text}\n\`\`\`\n\n`;
    }

    // 3. Active Selection
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      contextStr += `--- ACTIVE SELECTION in ${vscode.workspace.asRelativePath(editor.document.uri)} ---\n`;
      contextStr += `${editor.document.getText(editor.selection)}\n\n`;
    }

    return contextStr;
  }

  public async stopAll() {
    this._isStopped = true;
    this._store.all().forEach(a => this._store.patch(a.id, { status: 'idle' }));
  }

  private async parsePendingActions(text: string): Promise<{ path: string, content: string }[]> {
    const regex = /\[WRITE_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/gi;
    let match;
    const actions: { path: string, content: string }[] = [];
    
    while ((match = regex.exec(text)) !== null) {
      actions.push({
        path: match[1].trim(),
        content: match[2].trim()
      });
    }
    return actions;
  }

  private async runAgentSequential(id: string, objective: string, history: string, onChunk?: (agentId: string, chunk: string) => void): Promise<string> {
    const agent = this._store.all().find(a => a.id === id);
    if (!agent) return '';
    this._store.patch(id, { status: 'running', objective, lastResponse: '' });
    try {
      const authModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      const model = authModels.find(m => m.id === agent.modelId) || authModels[0];
      
      let prompt = `Role: ${agent.systemPrompt}\n\nGlobal Objective: ${objective}\n\n${history}\n\n`;
      prompt += `!!! CRITICAL INSTRUCTION !!!\n`;
      prompt += `If you need to write or update a file, you MUST use this syntax exactly:\n`;
      prompt += `[WRITE_FILE: relative/path/to/file.ext]\nContent goes here\n[/WRITE_FILE]\n`;
      prompt += `Do not include explanations or chat unless necessary. Focus on producing the output.`;

      const request = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, new vscode.CancellationTokenSource().token);
      let fullResponse = '';
      for await (const chunk of request.text) {
        if (this._isStopped) break;
        fullResponse += chunk;
        if (onChunk) onChunk(id, chunk);
      }
      this._store.incrementTotalTokens(Math.floor((fullResponse.length + prompt.length) / 4));
      this._store.patch(id, { status: 'success', lastResponse: fullResponse.trim() });
      return fullResponse.trim();
    } catch (err: any) {
      this._store.patch(id, { status: 'error', lastResponse: `Error: ${err.message}` });
      return '';
    }
  }
}
