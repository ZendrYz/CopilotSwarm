import * as vscode from 'vscode';
import { AgentState, AgentConfig } from './types';

export class AgentStore {
  private _agents: AgentState[] = [];
  private _totalTokens: number = 0;
  private _tokenLimit: number = 0; // 0 = sin límite o "seguridad"
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(private readonly _context: vscode.ExtensionContext) {
    this._load();
  }

  public all(): AgentState[] {
    return [...this._agents];
  }

  public getTotalTokens(): number {
    return this._totalTokens;
  }

  public getTokenLimit(): number {
    return this._tokenLimit;
  }

  public setTokenLimit(limit: number) {
    this._tokenLimit = limit;
    this._save();
  }

  public incrementTotalTokens(amount: number) {
    this._totalTokens += amount;
    this._save();
  }

  public add(config: AgentConfig) {
    const id = Math.random().toString(36).substring(2, 9);
    this._agents.push({
      id,
      name: config.name,
      modelId: config.modelId,
      systemPrompt: config.systemPrompt,
      objective: '',
      status: 'idle'
    });
    this._save();
  }

  public remove(id: string) {
    this._agents = this._agents.filter(a => a.id !== id);
    this._save();
  }

  public patch(id: string, patch: Partial<AgentState>) {
    const idx = this._agents.findIndex(a => a.id === id);
    if (idx !== -1) {
      this._agents[idx] = { ...this._agents[idx], ...patch };
      this._save();
    }
  }

  private _load() {
    const saved = this._context.globalState.get<AgentState[]>('swarm.agents', []);
    this._totalTokens = this._context.globalState.get<number>('swarm.totalTokens', 0);
    this._tokenLimit = this._context.globalState.get<number>('swarm.tokenLimit', 0);
    
    if (saved.length === 0) {
      this._agents = [
        {
          id: 'agent-1-research',
          name: 'Research Agent',
          modelId: 'gpt-4.1',
          systemPrompt: 'Eres un Investigador experto. Analiza el objetivo global e investiga y resume toda la información.',
          objective: '',
          status: 'idle'
        },
        {
          id: 'agent-2-architect',
          name: 'Architect Agent',
          modelId: 'gpt-4.1',
          systemPrompt: 'Eres un Arquitecto de Software. Diseña una solución técnica paso a paso.',
          objective: '',
          status: 'idle'
        },
        {
          id: 'agent-3-coder',
          name: 'Coder Agent',
          modelId: 'gpt-4.1',
          systemPrompt: 'Eres un Desarrollador Senior. Escribe el código real.',
          objective: '',
          status: 'idle'
        }
      ];
      this._save();
    } else {
      this._agents = saved.map(a => ({ ...a, status: 'idle' }));
    }
  }

  private _save() {
    this._context.globalState.update('swarm.agents', this._agents);
    this._context.globalState.update('swarm.totalTokens', this._totalTokens);
    this._context.globalState.update('swarm.tokenLimit', this._tokenLimit);
    this._onDidChange.fire();
  }

  public dispose() {}
}
