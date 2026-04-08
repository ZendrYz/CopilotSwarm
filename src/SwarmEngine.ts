import * as vscode from 'vscode';
import { AgentStore } from './AgentStore';

export class SwarmEngine {
  private _isStopped = false;

  constructor(private readonly _store: AgentStore) {}

  public async runAll(
    objective: string, 
    onChunk?: (agentId: string, chunk: string) => void,
    onAction?: (action: { type: 'write', path: string, status: 'success' | 'error' }) => void
  ) {
    this._isStopped = false;
    const agents = this._store.all();
    const context = await this._getActiveFileContext();
    let fullHistoryContext = context ? `\n--- SOURCE CONTEXT ---\n${context}\n----------------------\n` : '';

    for (const agent of agents) {
      if (this._isStopped) break;
      const result = await this.runAgentSequential(agent.id, objective, fullHistoryContext, onChunk);
      
      // PROCESAMOS ARCHIVOS CON REGEX ROBUSTA
      await this.parseAndExecuteFileSystemCommands(result, onAction);

      fullHistoryContext += `\n\n--- COMPLETED STAGE: ${agent.name} ---\n${result}\n----------------------------`;
    }
  }

  private async _getActiveFileContext(): Promise<string | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    const doc = editor.document;
    const selection = editor.selection;
    if (!selection.isEmpty) return `Selected in ${doc.fileName}:\n${doc.getText(selection)}`;
    const text = doc.getText();
    if (text.length > 10000) return `File: ${doc.fileName} (First 10k chars):\n${text.substring(0, 10000)}`;
    return `File: ${doc.fileName}\nContent:\n${text}`;
  }

  public async stopAll() {
    this._isStopped = true;
    this._store.all().forEach(a => this._store.patch(a.id, { status: 'idle' }));
  }

  private async parseAndExecuteFileSystemCommands(
    text: string, 
    onAction?: (action: { type: 'write', path: string, status: 'success' | 'error' }) => void
  ) {
    // Regex mejorada: busca [WRITE_FILE: path] o [write_file: path]
    const regex = /\[WRITE_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/gi;
    let match;
    
    const workspaceEdit = new vscode.WorkspaceEdit();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    let hasEdits = false;
    while ((match = regex.exec(text)) !== null) {
      const filePath = match[1].trim();
      const content = match[2].trim();
      const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
      
      // Usamos create o overwrite
      workspaceEdit.createFile(uri, { overwrite: true, ignoreIfExists: false });
      workspaceEdit.replace(uri, new vscode.Range(0, 0, 100000, 0), content);
      
      if (onAction) onAction({ type: 'write', path: filePath, status: 'success' });
      hasEdits = true;
    }

    if (hasEdits) {
      await vscode.workspace.applyEdit(workspaceEdit);
      vscode.window.showInformationMessage('Swarm changes applied to workspace.');
    }
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
