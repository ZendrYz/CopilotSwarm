import * as vscode from 'vscode';
import { AgentStore } from './AgentStore';

export class SwarmEngine {
  private _isStopped = false;

  constructor(private readonly _store: AgentStore) {}

  public async runAll(objective: string) {
    this._isStopped = false;
    const agents = this._store.all();
    let fullHistoryContext = '';

    for (const agent of agents) {
      if (this._isStopped) break;
      const result = await this.runAgentSequential(agent.id, objective, fullHistoryContext);
      
      // Parsear posibles comandos de ficheros en el output del agente
      await this.parseAndExecuteFileSystemCommands(result);

      fullHistoryContext += `\n\n--- AGENT: ${agent.name} ---\n${result}\n----------------------------`;
    }
    
    if (!this._isStopped) {
      vscode.window.showInformationMessage('Swarm Hierarchy Completed Successfully!');
    }
  }

  public async stopAll() {
    this._isStopped = true;
    this._store.all().forEach(a => this._store.patch(a.id, { status: 'idle' }));
  }

  private async parseAndExecuteFileSystemCommands(text: string) {
    // Buscar patrones tipo: [WRITE_FILE: path/to/file] content [/WRITE_FILE]
    const regex = /\[WRITE_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      const filePath = match[1].trim();
      const content = match[2].trim();
      
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
          vscode.window.showErrorMessage('No workspace folder open to write file.');
          continue;
        }

        const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
        const data = Buffer.from(content, 'utf8');
        
        await vscode.workspace.fs.writeFile(uri, data);
        vscode.window.showInformationMessage(`Agent Action: File written to ${filePath}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to write file ${filePath}: ${err.message}`);
      }
    }
  }

  private async runAgentSequential(id: string, objective: string, history: string): Promise<string> {
    const agent = this._store.all().find(a => a.id === id);
    if (!agent) return '';

    this._store.patch(id, { status: 'running', objective });

    try {
      const authModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      const model = authModels.find(m => m.id === agent.modelId) || 
                    authModels.find(m => m.id.includes(agent.modelId)) ||
                    authModels[0];

      if (!model) throw new Error('No model found.');

      let prompt = `Role: ${agent.systemPrompt}\n\nObjective: ${objective}\n\n`;
      if (history) prompt += `Full Swarm History:\n${history}\n\n`;
      
      prompt += `\n\n--- ACTION PROTOCOL AUTHORIZED ---\n`;
      prompt += `You are authorized to write files to the current workspace. To write a file, you MUST use the following exact syntax in your response:\n`;
      prompt += `[WRITE_FILE: path/relative/to/root.txt]\nFile contents here\n[/WRITE_FILE]\n`;
      prompt += `Use this power responsibly to implement solutions decided by the swarm.`;

      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const request = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
      
      let fullResponse = '';
      for await (const chunk of request.text) {
        if (this._isStopped) break;
        fullResponse += chunk;
      }

      this._store.patch(id, { 
        status: 'success', 
        lastResponse: fullResponse.trim(),
        tokensUsed: Math.floor((fullResponse.length + prompt.length) / 4)
      });

      return fullResponse.trim();
    } catch (err: any) {
      this._store.patch(id, { status: 'error', lastResponse: `Error: ${err.message}` });
      return '';
    }
  }
}
