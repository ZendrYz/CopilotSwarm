import * as vscode from 'vscode';
import { AgentStore } from './AgentStore';

export class SwarmEngine {
  private _isStopped = false;

  constructor(private readonly _store: AgentStore) {}

  public async runAll(objective: string) {
    this._isStopped = false;
    const agents = this._store.all();
    let accumulatedContext = '';

    for (const agent of agents) {
      if (this._isStopped) break;

      // --- SECURITY CHECK ---
      const used = this._store.getTotalTokens();
      const limit = this._store.getTokenLimit();
      if (limit > 0 && used >= limit) {
        vscode.window.showErrorMessage(`Swarm Security System: Token budget exceeded (${used}/${limit}). Stopping execution.`);
        this._isStopped = true;
        break;
      }
      
      accumulatedContext = await this.runAgentSequential(agent.id, objective, accumulatedContext);
    }
  }

  public async stopAll() {
    this._isStopped = true;
    const agents = this._store.all();
    for (const agent of agents) {
      this._store.patch(agent.id, { status: 'idle' });
    }
  }

  private async runAgentSequential(id: string, objective: string, previousContext: string): Promise<string> {
    const agent = this._store.all().find(a => a.id === id);
    if (!agent) return previousContext;

    this._store.patch(id, { status: 'running', objective });

    try {
      const authModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      const model = authModels.find(m => m.id === agent.modelId) || 
                    authModels.find(m => m.id.includes(agent.modelId)) ||
                    authModels[0];

      if (!model) throw new Error(`Model not available.`);

      let systemMsg = `Autonomous Agent: "${agent.name}"\nRole: ${agent.systemPrompt}\nContext: ${previousContext}\nGlobal Objective: ${objective}`;
      const messages = [vscode.LanguageModelChatMessage.User(systemMsg)];

      const request = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
      let fullResponse = '';
      for await (const chunk of request.text) {
        if (this._isStopped) break;
        fullResponse += chunk;
      }

      const estimatedTokens = Math.floor(fullResponse.length / 4) + Math.floor(systemMsg.length / 4);
      this._store.incrementTotalTokens(estimatedTokens);
      
      this._store.patch(id, { 
        status: 'success', 
        lastResponse: fullResponse.trim(),
        tokensUsed: estimatedTokens
      });

      return fullResponse.trim();

    } catch (err: any) {
      this._store.patch(id, { status: 'error', lastResponse: `Error: ${err.message}` });
      return previousContext;
    }
  }
}
